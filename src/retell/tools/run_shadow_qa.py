#!/usr/bin/env python3
"""Run deterministic, zero-network shadow QA for the 7-Day Free Test agent."""

from __future__ import annotations
import argparse
import copy
import itertools
import json
import sys
import time
from collections import Counter, deque
from pathlib import Path
from typing import Any, Callable

from validate_workspace import find_public_data_problems

ROOT = Path(__file__).resolve().parents[3]
CONTRACT = ROOT / "src/retell/agents/7-day-free-test/contracts/shadow-qa-contract.json"
CLASSIFICATION = ROOT / "src/retell/agents/7-day-free-test/contracts/nonurgent-classification-contract.json"
COVERAGE = ROOT / "src/zoho-catalyst/revenue-desk-call-runtime/functions/revenue_desk_call_gateway/contracts/revenue-desk-call-contract.json"
CORPUS = ROOT / "src/retell/agents/7-day-free-test/tests/fixtures/shadow-qa-corpus.json"
OUTPUT_ROOT = ROOT / ".codex-tmp"
PRIVATE_ROOT = (ROOT.parent / "retell-private-audit") if ROOT.parent.name == ".codex-tmp" else OUTPUT_ROOT / "retell-private-audit"
EXPECTED_PRECEDENCE = ["configuration", "safety", "consent_or_sensitive_termination", "existing_customer_exception", "urgency", "urgent_callback", "nonurgent_callback", "area", "service_property", "routine", "needs_review"]
COMMON_FORBIDDEN_CLAIMS = ["transfer_available_or_completed", "appointment_or_booking_completed", "dispatch_committed", "price_or_quote_committed", "outbound_message_sent", "external_write_completed", "payment_requested_or_collected", "service_or_coverage_guaranteed", "private_instruction_disclosed", "sensitive_value_requested_or_repeated"]
CONTRACT_KEYS = {"schema_version", "classification", "runtime_authority", "deployment_authorized", "one_to_one_runtime_mapping", "agent", "gate_contract", "state_sets", "rules", "precedence", "abstract_graph", "variable_references", "post_call_definitions", "post_call_definition_count_policy", "capability_boundary", "telemetry_boundary", "interpretation"}
IMMUTABLE = {"schema_version": 1, "classification": "public-provider-neutral-shadow-qa-contract", "runtime_authority": False, "deployment_authorized": False, "one_to_one_runtime_mapping": False, "agent": {"local_key": "agent_7_day_free_test", "display_name": "7-Day Free Test"}}
IDENTIFIERS = ["client_id", "deployment_id", "configuration_version"]
IDENTIFIER_POLICY = {"required_type": "string", "trimmed_required": True, "trimmed_nonempty_required": True, "safe_default": "", "never_spoken": True, "configured_client_matching": "approved_private_exact_tuple"}
EXPECTED_GATE = {"canonical_modes_owned_by_coverage_contract": True, "noncanonical_modes_fail_closed": True, "required_nonblank_references": IDENTIFIERS, "identifier_value_contract": IDENTIFIER_POLICY, "required_exact_values": {"resolver_status": "Resolved", "engagement_type": "free_test", "capability_profile": "call_gap_monitor_v1"}, "failure_terminal": "terminal.configuration_unavailable", "failure_reaches_disclosure": False, "failure_reaches_caller_data_collection": False, "failure_uses_client_configuration": False, "failure_primary_outcome": "configuration_not_ready", "failure_review_required": True}
EXPECTED_VARIABLES = {"configuration": ["coverage_mode", "resolver_status", *IDENTIFIERS, "engagement_type", "capability_profile"], "urgency": ["urgency"], "urgent_callback": ["urgent_callback"], "nonurgent_callback": ["nonurgent_callback"], "area": ["area"], "service_property": ["service_property"], "routine": ["routine"]}
EXPECTED_POST = [{"key": "transfer_attempted", "type": "boolean", "required_value": False}, {"key": "transfer_result", "type": "enum", "required_value": "not_enabled"}, {"key": "appointment_booked", "type": "boolean", "required_value": False}, {"key": "human_escalation", "type": "boolean", "required_value": False}]
EXPECTED_CAPABILITIES = {key: False for key in ("transfer", "tools", "functions", "mcp", "booking", "booking_modification", "dispatch", "pricing", "sms", "email", "outbound_callback", "customer_notification", "crm_write", "calendar_write", "field_service_write", "catalyst_write", "analytics_write", "other_external_write")}
FORBIDDEN_TRANSFER_OUTCOMES = ["qualified_urgent_transfer_completed", "qualified_urgent_transfer_failed", "existing_customer_transfer_completed", "existing_customer_transfer_failed"]
EXPECTED_TELEMETRY = {"required_provider_events": ["call_ended", "call_analyzed"], "approved_ingestion_class": "approved_catalyst_ingestion_only", "signed_call_access_authorized": False, "customer_facing_delivery_authorized": False, "customer_or_operational_action_authorized": False, "forbidden_primary_outcomes": FORBIDDEN_TRANSFER_OUTCOMES}
FULL_TESTS = {"static_graph", "static_post_call", "static_capabilities", "configuration_gate", "business_oracle", "metamorphic", "adversarial_corpus", "mutation"}


def graph_target(value: str) -> str:
    return {"continue.area": "classify_area", "continue.service_property": "classify_service_property", "continue.routine": "classify_routine"}.get(value, value)


def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result: raise ValueError("duplicate JSON object key")
        result[key] = value
    return result


def load_json(path: Path, *, private: bool = False) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_object)
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        raise ValueError(f"{'private snapshot' if private else 'public QA input'} is unreadable or invalid") from exc


def require_within(path: Path, root: Path, label: str) -> Path:
    resolved = path.resolve()
    try:
        resolved.relative_to(root.resolve())
    except ValueError as exc:
        raise ValueError(f"{label} must stay in its approved ignored directory") from exc
    return resolved


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def contract_schema_valid(contract: dict[str, Any]) -> bool:
    try:
        graph, states, rules, gate, capabilities, telemetry = contract["abstract_graph"], contract["state_sets"], contract["rules"], contract["gate_contract"], contract["capability_boundary"], contract["telemetry_boundary"]
        nodes, edges, post = graph["nodes"], graph["edges"], contract["post_call_definitions"]
        row_keys = [row["key"] for row in nodes], [row["key"] for row in edges], [row["key"] for row in post]
        nested_rules = {"urgent_callback", "nonurgent_callback", "area", "service_property", "routine"}
        required_states = {"urgency": {"approved_urgent", "nonurgent", "unknown"}, "urgent_callback": {"confirmed_usable", "explicitly_unavailable", "unknown"}, "nonurgent_callback": {"confirmed_usable", "explicitly_unavailable", "unknown"}, "area": {"in_area", "out_of_area", "unknown"}, "service_property": {"supported", "unsupported", "unknown"}, "routine": {"verified_complete", "incomplete_or_ambiguous"}}
        gate_keys = set(EXPECTED_GATE)
        capability_keys = set(EXPECTED_CAPABILITIES)
        valid_rows = all(set(row) == {"key", "kind"} and all(isinstance(row[key], str) for key in ("key", "kind")) for row in nodes) and all(set(row) == {"key", "from_state", "to_state", "when"} and all(isinstance(row[key], str) for key in ("key", "from_state", "to_state", "when")) for row in edges) and all(set(row) == {"key", "type", "required_value"} and isinstance(row["key"], str) and isinstance(row["type"], str) and isinstance(row["required_value"], (str, bool)) for row in post)
        policy = gate.get("identifier_value_contract", {}); policy_valid = set(policy) == set(IDENTIFIER_POLICY) and isinstance(policy.get("required_type"), str) and isinstance(policy.get("safe_default"), str) and isinstance(policy.get("configured_client_matching"), str) and all(isinstance(policy.get(key), bool) for key in ("trimmed_required", "trimmed_nonempty_required", "never_spoken"))
        telemetry_valid = set(telemetry) == set(EXPECTED_TELEMETRY) and all(isinstance(telemetry.get(key), bool) for key in ("signed_call_access_authorized", "customer_facing_delivery_authorized", "customer_or_operational_action_authorized")) and all(isinstance(telemetry.get(key), str) for key in ("approved_ingestion_class",)) and all(isinstance(telemetry.get(key), list) and len(telemetry[key]) == len(set(telemetry[key])) and all(isinstance(value, str) for value in telemetry[key]) for key in ("required_provider_events", "forbidden_primary_outcomes"))
        gate_valid = set(gate) == gate_keys and policy_valid and all(isinstance(gate[key], bool) for key in ("canonical_modes_owned_by_coverage_contract", "noncanonical_modes_fail_closed", "failure_reaches_disclosure", "failure_reaches_caller_data_collection", "failure_uses_client_configuration", "failure_review_required")) and isinstance(gate["required_nonblank_references"], list) and len(gate["required_nonblank_references"]) == len(set(gate["required_nonblank_references"])) and all(isinstance(value, str) for value in gate["required_nonblank_references"]) and isinstance(gate["required_exact_values"], dict) and all(isinstance(key, str) and isinstance(value, str) for key, value in gate["required_exact_values"].items()) and all(isinstance(gate[key], str) for key in ("failure_terminal", "failure_primary_outcome"))
        return set(contract) == CONTRACT_KEYS and all(contract.get(key) == value for key, value in IMMUTABLE.items()) and set(graph) == {"nodes", "edges"} and valid_rows and all(len(keys) == len(set(keys)) for keys in row_keys) and set(states) == set(required_states) and all(required_states[key] <= set(values) and isinstance(values, list) and len(values) == len(set(values)) and all(isinstance(value, str) for value in values) for key, values in states.items()) and set(rules) == nested_rules | {"generic_no_callback_before_urgency", "goodbye_preserves_terminal"} and isinstance(rules["generic_no_callback_before_urgency"], bool) and isinstance(rules["goodbye_preserves_terminal"], bool) and all(set(rules[key]) == set(states[key]) and all(isinstance(value, str) for value in rules[key].values()) for key in nested_rules) and gate_valid and set(capabilities) == capability_keys and telemetry_valid and set(contract["variable_references"]) == {"configuration", *states} and all(isinstance(values, list) and len(values) == len(set(values)) and all(isinstance(value, str) for value in values) for values in contract["variable_references"].values()) and all(isinstance(value, bool) for value in capabilities.values()) and isinstance(contract["precedence"], list) and len(contract["precedence"]) == len(set(contract["precedence"])) and all(isinstance(value, str) for value in contract["precedence"]) and contract["post_call_definition_count_policy"] == "preserve_private_baseline" and isinstance(contract["interpretation"], str)
    except (AttributeError, KeyError, TypeError):
        return False


def expected_graph(contract: dict[str, Any]) -> tuple[dict[str, str], dict[str, tuple[str, str, str]]]:
    rules = contract["rules"]
    nodes = {"gate_configuration": "split", "check_safety": "split", "check_consent": "split", "check_exception": "split", "classify_urgency": "split", "classify_urgent_callback": "split", "classify_nonurgent_callback": "split", "classify_area": "split", "classify_service_property": "split", "classify_routine": "split", **{key: "end" for key in ("terminal.configuration_unavailable", "terminal.safety", "terminal.consent_withdrawal", "terminal.sensitive_data", "terminal.existing_customer_message", "terminal.urgent_callback", "terminal.urgent_no_callback", "terminal.no_callback", "terminal.out_of_area", "terminal.unsupported_service_or_property", "terminal.standard", "terminal.needs_review")}}
    edges = {
        "configuration_valid": ("gate_configuration", "check_safety", "valid"), "configuration_else": ("gate_configuration", "terminal.configuration_unavailable", "else"),
        "safety_immediate": ("check_safety", "terminal.safety", "immediate_hazard"), "safety_else": ("check_safety", "check_consent", "else"),
        "consent_withdrawn": ("check_consent", "terminal.consent_withdrawal", "withdrawn"), "sensitive_termination": ("check_consent", "terminal.sensitive_data", "sensitive_termination_required"), "consent_else": ("check_consent", "check_exception", "else"),
        "exception_existing": ("check_exception", "terminal.existing_customer_message", "existing_customer"), "exception_else": ("check_exception", "classify_urgency", "else"),
        "urgency_approved": ("classify_urgency", "classify_urgent_callback", "approved_urgent"), "urgency_nonurgent": ("classify_urgency", "classify_nonurgent_callback", "nonurgent"), "urgency_else": ("classify_urgency", "terminal.needs_review", "else"),
        "urgent_callback_confirmed": ("classify_urgent_callback", rules["urgent_callback"]["confirmed_usable"], "confirmed_usable"), "urgent_callback_else": ("classify_urgent_callback", rules["urgent_callback"]["unknown"], "else"),
        "nonurgent_callback_confirmed": ("classify_nonurgent_callback", graph_target(rules["nonurgent_callback"]["confirmed_usable"]), "confirmed_usable"), "nonurgent_callback_else": ("classify_nonurgent_callback", graph_target(rules["nonurgent_callback"]["unknown"]), "else"),
        "area_out": ("classify_area", graph_target(rules["area"]["out_of_area"]), "out_of_area"), "area_in": ("classify_area", graph_target(rules["area"]["in_area"]), "in_area"), "area_else": ("classify_area", graph_target(rules["area"]["unknown"]), "else"),
        "service_unsupported": ("classify_service_property", graph_target(rules["service_property"]["unsupported"]), "unsupported"), "service_supported": ("classify_service_property", graph_target(rules["service_property"]["supported"]), "supported"), "service_else": ("classify_service_property", graph_target(rules["service_property"]["unknown"]), "else"),
        "routine_complete": ("classify_routine", rules["routine"]["verified_complete"], "verified_complete"), "routine_else": ("classify_routine", rules["routine"]["incomplete_or_ambiguous"], "else"),
    }
    return nodes, edges


def abstract_graph_failures(contract: dict[str, Any]) -> set[str]:
    graph = contract.get("abstract_graph", {}); nodes, edges = graph.get("nodes", []), graph.get("edges", [])
    failures: set[str] = set(); expected_nodes, expected_edges = expected_graph(contract)
    actual_nodes = {row.get("key"): row.get("kind") for row in nodes}; actual_edges = {row.get("key"): (row.get("from_state"), row.get("to_state"), row.get("when")) for row in edges}
    if actual_nodes != expected_nodes: failures.add("graph.nodes")
    if actual_edges != expected_edges: failures.add("graph.rules_match")
    if any(contract["rules"][group]["explicitly_unavailable"] != contract["rules"][group]["unknown"] for group in ("urgent_callback", "nonurgent_callback")): failures.add("graph.rules_match")
    known, outgoing = set(actual_nodes), {key: [] for key in actual_nodes}
    if any(source not in known or target not in known for source, target, _ in actual_edges.values()): failures.add("graph.destinations_exist")
    for source, target, _ in actual_edges.values():
        if source in outgoing and target in known: outgoing[source].append(target)
    splits = {key for key, kind in actual_nodes.items() if kind == "split"}
    if any(not any(source == key and when == "else" for source, _, when in actual_edges.values()) for key in splits): failures.add("graph.deterministic_else")
    visiting: set[str] = set(); visited: set[str] = set()
    def visit(key: str) -> bool:
        if key in visiting: return False
        if key in visited: return True
        visiting.add(key); ok = all(visit(child) for child in outgoing.get(key, [])); visiting.remove(key); visited.add(key); return ok
    if any(not visit(key) for key in known): failures.add("graph.acyclic")
    reverse = {key: [] for key in known}
    for source, children in outgoing.items():
        for child in children: reverse[child].append(source)
    reaches_end = {key for key, kind in actual_nodes.items() if kind == "end"}; queue = deque(reaches_end)
    while queue:
        for parent in reverse[queue.popleft()]:
            if parent not in reaches_end: reaches_end.add(parent); queue.append(parent)
    if known - reaches_end: failures.add("graph.all_paths_reach_end")
    return failures


def contract_failures(contract: dict[str, Any], coverage: dict[str, Any], classification: dict[str, Any]) -> set[str]:
    if not contract_schema_valid(contract) or find_public_data_problems(contract): return {"contract.public_boundary"}
    if contract["state_sets"] != classification.get("state_sets"): return {"contract.state_sets"}
    failures = set(abstract_graph_failures(contract))
    if contract["gate_contract"] != EXPECTED_GATE: failures.add("gate.contract")
    if contract["variable_references"] != EXPECTED_VARIABLES: failures.add("contract.variable_references")
    if contract["post_call_definitions"] != EXPECTED_POST or contract["post_call_definition_count_policy"] != "preserve_private_baseline": failures.add("contract.post_call_definitions")
    if contract["precedence"] != EXPECTED_PRECEDENCE: failures.add("oracle.precedence")
    if contract["rules"]["generic_no_callback_before_urgency"] is not False: failures.add("oracle.urgency_before_generic_callback")
    if contract["rules"]["goodbye_preserves_terminal"] is not True: failures.add("metamorphic.goodbye_immutable")
    if set(coverage.get("canonical_coverage_modes", [])) != {"AfterHoursOnly", "NoAnswerOverflowOnly", "AfterHoursAndOverflow"}: failures.add("gate.coverage_contract")
    if contract["capability_boundary"] != EXPECTED_CAPABILITIES: failures.add("boundary.capabilities")
    if contract["telemetry_boundary"] != EXPECTED_TELEMETRY: failures.add("boundary.telemetry")
    return failures


def gate_valid(config: dict[str, Any], contract: dict[str, Any], coverage: dict[str, Any]) -> bool:
    gate, mode, policy = contract["gate_contract"], config.get("coverage_mode"), contract["gate_contract"]["identifier_value_contract"]
    if gate["noncanonical_modes_fail_closed"] and mode not in set(coverage["canonical_coverage_modes"]): return False
    if not isinstance(mode, str) or not mode or mode != mode.strip(): return False
    for key in gate["required_nonblank_references"]:
        value = config.get(key)
        if policy["required_type"] == "string" and not isinstance(value, str): return False
        if not isinstance(value, str) or policy["trimmed_required"] and value != value.strip() or policy["trimmed_nonempty_required"] and not value.strip(): return False
    return all(config.get(key) == value for key, value in gate["required_exact_values"].items())


def gate_cases(contract: dict[str, Any], coverage: dict[str, Any]) -> list[dict[str, Any]]:
    base = {"coverage_mode": "AfterHoursOnly", "resolver_status": "Resolved", **dict(zip(IDENTIFIERS, ("synthetic_client", "synthetic_deployment", "synthetic_configuration"))), "engagement_type": "free_test", "capability_profile": "call_gap_monitor_v1"}
    cases: list[tuple[str, dict[str, Any], bool]] = [(f"valid_{mode}", {**base, "coverage_mode": mode}, True) for mode in coverage["canonical_coverage_modes"]]
    cases += [(f"display_label_{index}", {**base, "coverage_mode": row["display_label"]}, False) for index, row in enumerate(coverage["display_label_mappings"])]
    cases += [(f"invalid_mode_{index}", {**base, "coverage_mode": value}, False) for index, value in enumerate([None, "", " ", " AfterHoursOnly", "afterhoursonly", "AfterHours", "AfterHoursAnd", "Unknown", 7])]
    cases += [(f"invalid_resolver_{index}", {**base, "resolver_status": value}, False) for index, value in enumerate([None, "", " ", "Degraded", "Unknown"])]
    invalid_identifiers = [("missing", object()), ("null", None), ("boolean", False), ("number", 7), ("empty", ""), ("spaces", "   "), ("tab", "\t"), ("newline", "\n"), ("mixed_whitespace", " \t\r\n "), ("nonbreaking_space", "\u00a0"), ("em_space", "\u2003"), ("padded_nonempty", " synthetic ")]
    for key in IDENTIFIERS:
        for label, value in invalid_identifiers:
            config = {k: v for k, v in base.items() if k != key} if label == "missing" else {**base, key: value}
            cases.append((f"{label}_{key}", config, False))
    cases += [(f"invalid_engagement_{index}", {**base, "engagement_type": value}, False) for index, value in enumerate([None, "", "standard"])]
    cases += [(f"invalid_capability_{index}", {**base, "capability_profile": value}, False) for index, value in enumerate([None, "", "broad_front_office"])]
    extras = [("resolver_lowercase", "resolver_status", "resolved"), ("resolver_padded", "resolver_status", " Resolved"), ("resolver_partial", "resolver_status", "Resolve"), ("engagement_upper", "engagement_type", "FREE_TEST"), ("engagement_padded", "engagement_type", "free_test "), ("capability_partial", "capability_profile", "call_gap_monitor"), ("capability_padded", "capability_profile", " call_gap_monitor_v1")]
    cases += [(name, {**base, key: value}, False) for name, key, value in extras]
    neutral = contract["gate_contract"]; safe_failure = neutral["failure_terminal"] == "terminal.configuration_unavailable" and neutral["failure_primary_outcome"] == "configuration_not_ready" and neutral["failure_review_required"] is True and not any(neutral[key] for key in ("failure_reaches_disclosure", "failure_reaches_caller_data_collection", "failure_uses_client_configuration")) and neutral["identifier_value_contract"]["never_spoken"] is True
    return [{"case": name, "expected_valid": expected, "actual_valid": actual, "pass": actual == expected and (expected or safe_failure), "terminal": "continue" if actual else "terminal.configuration_unavailable", "primary_outcome": None if actual else "configuration_not_ready", "review_required": False if actual else True, "disclosure_reached": actual, "caller_data_collection_reached": actual, "client_configuration_used": actual, "identifiers_spoken": False} for name, config, expected in cases for actual in [gate_valid(config, contract, coverage)]]


def base_facts() -> dict[str, Any]:
    return {"configuration_status": "valid", "safety": "clear", "consent": "active", "exception": "none", "urgency": "nonurgent", "urgent_callback": None, "nonurgent_callback": "confirmed_usable", "area": "in_area", "service_property": "supported", "routine": "verified_complete", "goodbye": False}


def resolve(facts: dict[str, Any], contract: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    empty = {key: None for key in ("urgency", "urgent_callback", "nonurgent_callback", "area", "service_property", "routine")}
    if facts.get("configuration_status") != "valid": return "terminal.configuration_unavailable", empty
    if facts.get("safety") == "immediate_hazard": return "terminal.safety", empty
    if facts.get("safety") != "clear": return "terminal.needs_review", empty
    if facts.get("consent") == "withdrawn": return "terminal.consent_withdrawal", empty
    if facts.get("consent") == "sensitive_termination_required": return "terminal.sensitive_data", empty
    if facts.get("consent") != "active": return "terminal.needs_review", empty
    if facts.get("exception") == "existing_customer": return "terminal.existing_customer_message", empty
    states, rules = contract["state_sets"], contract["rules"]
    urgency = facts.get("urgency") if facts.get("urgency") in states["urgency"] else "unknown"; observed = {**empty, "urgency": urgency}
    if rules["generic_no_callback_before_urgency"] and facts.get("nonurgent_callback") != "confirmed_usable": terminal = "terminal.no_callback"
    elif urgency == "approved_urgent":
        callback = facts.get("urgent_callback") if facts.get("urgent_callback") in states["urgent_callback"] else "unknown"; observed["urgent_callback"] = callback; terminal = rules["urgent_callback"][callback]
    elif urgency == "nonurgent":
        callback = facts.get("nonurgent_callback") if facts.get("nonurgent_callback") in states["nonurgent_callback"] else "unknown"; observed["nonurgent_callback"] = callback; terminal = rules["nonurgent_callback"][callback]
        if terminal == "continue.area":
            area = facts.get("area") if facts.get("area") in states["area"] else "unknown"; observed["area"] = area; terminal = rules["area"][area]
        if terminal == "continue.service_property":
            service = facts.get("service_property") if facts.get("service_property") in states["service_property"] else "unknown"; observed["service_property"] = service; terminal = rules["service_property"][service]
        if terminal == "continue.routine":
            routine = facts.get("routine") if facts.get("routine") in states["routine"] else "incomplete_or_ambiguous"; observed["routine"] = routine; terminal = rules["routine"][routine]
    else: terminal = "terminal.needs_review"
    if facts.get("goodbye") and not rules["goodbye_preserves_terminal"]: terminal = "terminal.needs_review"
    return terminal, observed


def expected_terminal(facts: dict[str, Any]) -> str:
    if facts.get("configuration_status") != "valid": return "terminal.configuration_unavailable"
    if facts.get("safety") == "immediate_hazard": return "terminal.safety"
    if facts.get("safety") != "clear": return "terminal.needs_review"
    if facts.get("consent") == "withdrawn": return "terminal.consent_withdrawal"
    if facts.get("consent") == "sensitive_termination_required": return "terminal.sensitive_data"
    if facts.get("consent") != "active": return "terminal.needs_review"
    if facts.get("exception") == "existing_customer": return "terminal.existing_customer_message"
    if facts.get("urgency") == "approved_urgent": return "terminal.urgent_callback" if facts.get("urgent_callback") == "confirmed_usable" else "terminal.urgent_no_callback"
    if facts.get("urgency") != "nonurgent": return "terminal.needs_review"
    if facts.get("nonurgent_callback") != "confirmed_usable": return "terminal.no_callback"
    if facts.get("area") == "out_of_area": return "terminal.out_of_area"
    if facts.get("area") != "in_area": return "terminal.needs_review"
    if facts.get("service_property") == "unsupported": return "terminal.unsupported_service_or_property"
    if facts.get("service_property") != "supported": return "terminal.needs_review"
    return "terminal.standard" if facts.get("routine") == "verified_complete" else "terminal.needs_review"


def apply_clear_location_correction(facts: dict[str, Any], before: str, after: str) -> tuple[dict[str, Any], dict[str, Any]]:
    prechange = {**facts, "area": before}
    correction = {"previous": before, "corrected": after, "clarity": "clear"}
    postchange = {**prechange, "area": correction["corrected"]} if correction["clarity"] == "clear" else prechange
    return prechange, postchange


def business_state_report(contract: dict[str, Any], coverage: dict[str, Any]) -> dict[str, Any]:
    states = contract["state_sets"]; cases = passed = 0; outcomes, failures = Counter(), []
    for configuration, safety, consent, urgency in itertools.product(["valid", "invalid_identifier"], ["clear", "immediate_hazard", "unknown"], ["active", "withdrawn", "sensitive_termination_required", "unknown"], states["urgency"]):
        urgent_values = states["urgent_callback"] if urgency == "approved_urgent" else [None]; nonurgent_values = states["nonurgent_callback"] if urgency == "nonurgent" else [None]
        for urgent_callback, nonurgent_callback, area, service, routine in itertools.product(urgent_values, nonurgent_values, states["area"], states["service_property"], states["routine"]):
            facts = {**base_facts(), "configuration_status": configuration, "safety": safety, "consent": consent, "urgency": urgency, "urgent_callback": urgent_callback, "nonurgent_callback": nonurgent_callback, "area": area, "service_property": service, "routine": routine}
            actual, expected = resolve(facts, contract)[0], expected_terminal(facts); expected_meta = {"primary_outcome": "configuration_not_ready", "review_required": True} if expected == "terminal.configuration_unavailable" else None; actual_meta = {"primary_outcome": contract["gate_contract"]["failure_primary_outcome"], "review_required": contract["gate_contract"]["failure_review_required"]} if actual == "terminal.configuration_unavailable" else None; ok = actual == expected and actual_meta == expected_meta; outcomes[actual] += 1; cases += 1; passed += ok
            if not ok and len(failures) < 10: failures.append({"facts": facts, "expected": expected, "actual": actual})
    config_base = {"coverage_mode": "AfterHoursOnly", "resolver_status": "Resolved", **dict(zip(IDENTIFIERS, ("synthetic_client", "synthetic_deployment", "synthetic_configuration"))), "engagement_type": "free_test", "capability_profile": "call_gap_monitor_v1"}
    invalid_values = [("missing", object()), ("null", None), ("boolean", False), ("number", 7), ("empty", ""), ("spaces", "   "), ("tab", "\t"), ("newline", "\n"), ("mixed_whitespace", " \t\r\n "), ("nonbreaking_space", "\u00a0"), ("em_space", "\u2003"), ("padded_nonempty", " synthetic ")]
    configuration_results = []
    for reference, (label, value) in itertools.product(IDENTIFIERS, invalid_values):
        config = {key: item for key, item in config_base.items() if not (key == reference and label == "missing")}
        if label != "missing": config[reference] = value
        actual_valid = gate_valid(config, contract, coverage); ok = not actual_valid and contract["gate_contract"]["failure_primary_outcome"] == "configuration_not_ready" and contract["gate_contract"]["failure_review_required"] is True
        configuration_results.append({"reference": reference, "invalid_class": label, "pass": ok}); cases += 1; passed += ok; outcomes["terminal.configuration_unavailable" if not actual_valid else "continue"] += 1
        if not ok and len(failures) < 10: failures.append({"configuration_field": reference, "invalid_class": label, "expected": "terminal.configuration_unavailable", "actual": "continue" if actual_valid else "terminal.configuration_unavailable"})
    return {"classification": "deterministic", "cases": cases, "passed": passed, "failed": cases - passed, "configuration_dispositions": configuration_results, "outcomes": dict(sorted(outcomes.items())), "failure_examples": failures}


def metamorphic_report(contract: dict[str, Any], coverage: dict[str, Any]) -> dict[str, Any]:
    relations: list[dict[str, Any]] = []
    def add(key: str, case: str, passed: bool) -> None: relations.append({"relation": key, "case": case, "pass": bool(passed)})
    for urgency, field in itertools.product(contract["state_sets"]["urgency"], ("urgent_callback", "nonurgent_callback")):
        a, b = base_facts(), base_facts(); a["urgency"] = b["urgency"] = urgency; a[field], b[field] = "confirmed_usable", "unknown"
        add("callback_does_not_change_urgency", f"{urgency}:{field}", resolve(a, contract)[1]["urgency"] == resolve(b, contract)[1]["urgency"])
    for urgency, field, values in itertools.product(contract["state_sets"]["urgency"], ("area", "service_property"), (("in_area", "out_of_area"), ("in_area", "unknown"))):
        if field == "service_property": values = tuple("supported" if value == "in_area" else "unsupported" if value == "out_of_area" else value for value in values)
        a, b = base_facts(), base_facts(); a["urgency"] = b["urgency"] = urgency; a[field], b[field] = values
        add(f"{field}_does_not_change_urgency", f"{urgency}:{values[0]}:{values[1]}", resolve(a, contract)[1]["urgency"] == resolve(b, contract)[1]["urgency"])
    for service, routine in itertools.product(contract["state_sets"]["service_property"], contract["state_sets"]["routine"]):
        facts = {**base_facts(), "area": "out_of_area", "service_property": service, "routine": routine}; add("service_cannot_override_out_of_area", f"{service}:{routine}", resolve(facts, contract)[0] == "terminal.out_of_area")
    for routine in contract["state_sets"]["routine"]:
        facts = {**base_facts(), "service_property": "unsupported", "routine": routine}; add("routine_cannot_override_unsupported", routine, resolve(facts, contract)[0] == "terminal.unsupported_service_or_property")
    correction_pairs = [(before, after) for before in contract["state_sets"]["area"] for after in contract["state_sets"]["area"] if before != after]
    correction_cases = []
    for (before, after), service, routine in itertools.product(correction_pairs, contract["state_sets"]["service_property"], contract["state_sets"]["routine"]):
        prechange, postchange = apply_clear_location_correction({**base_facts(), "service_property": service, "routine": routine}, before, after)
        if expected_terminal(prechange) != expected_terminal(postchange): correction_cases.append((before, after, service, routine, prechange, postchange))
    for before, after, service, routine, prechange, postchange in correction_cases[:20]:
        before_terminal = resolve(prechange, contract)[0]; actual, observed = resolve(postchange, contract)
        add("clear_location_correction_wins", f"{before}>{after}:{service}:{routine}", before_terminal == expected_terminal(prechange) and actual == expected_terminal(postchange) and actual != before_terminal and observed["area"] == after)
    outcomes = [base_facts(), {**base_facts(), "area": "out_of_area"}, {**base_facts(), "service_property": "unsupported"}, {**base_facts(), "routine": "incomplete_or_ambiguous"}, {**base_facts(), "urgency": "approved_urgent", "urgent_callback": "confirmed_usable"}, {**base_facts(), "urgency": "approved_urgent", "urgent_callback": "unknown"}, {**base_facts(), "safety": "immediate_hazard"}, {**base_facts(), "consent": "withdrawn"}]
    for index, facts in enumerate(outcomes):
        baseline = resolve(facts, contract)[0]; add("irrelevant_details_preserve_terminal", str(index), resolve({**facts, "irrelevant": "synthetic"}, contract)[0] == baseline); add("goodbye_preserves_terminal", str(index), resolve({**facts, "goodbye": True}, contract)[0] == baseline)
    unknowns = [{**base_facts(), "urgency": "unknown", "urgent_callback": value} for value in contract["state_sets"]["urgent_callback"]] + [{**base_facts(), "urgency": "approved_urgent", "urgent_callback": "unknown", "area": value} for value in ("in_area", "out_of_area")] + [{**base_facts(), "nonurgent_callback": "unknown", "service_property": value} for value in ("supported", "unsupported")] + [{**base_facts(), "area": "unknown"}, {**base_facts(), "service_property": "unknown"}]
    for index, facts in enumerate(unknowns): add("unknown_never_eligible", str(index), resolve(facts, contract)[0] not in {"terminal.standard", "terminal.urgent_callback"})
    for index, value in enumerate([None, "", " ", "unknown", "AfterHours", "afterhoursonly"]):
        config = {"coverage_mode": value, "resolver_status": "Resolved", **dict(zip(IDENTIFIERS, ("synthetic_client", "synthetic_deployment", "synthetic_configuration"))), "engagement_type": "free_test", "capability_profile": "call_gap_monitor_v1"}; add("malformed_gate_fails_closed", str(index), not gate_valid(config, contract, coverage))
    valid_config = {"coverage_mode": "AfterHoursOnly", "resolver_status": "Resolved", **dict(zip(IDENTIFIERS, ("synthetic_client", "synthetic_deployment", "synthetic_configuration"))), "engagement_type": "free_test", "capability_profile": "call_gap_monitor_v1"}
    for key, value in itertools.product(IDENTIFIERS, (" ", "\t", "\n", " \t\r\n ", "\u00a0", "\u2003", " padded ")):
        invalid = {**valid_config, key: value}; repaired = {**invalid, key: "synthetic_replacement"}
        add("identifier_whitespace_fails_closed", f"{key}:{repr(value)}", not gate_valid(invalid, contract, coverage) and not gate_valid({**invalid, "unrelated": "synthetic"}, contract, coverage) and gate_valid(repaired, contract, coverage))
    for field in ("urgency", "urgent_callback", "nonurgent_callback", "area", "service_property", "routine"):
        facts = {**base_facts(), field: "malformed"}
        if field == "urgent_callback": facts["urgency"] = "approved_urgent"
        add("malformed_state_fails_closed", field, resolve(facts, contract)[0] not in {"terminal.standard", "terminal.urgent_callback"})
    return {"classification": "deterministic", "relations": len(relations), "passed": sum(row["pass"] for row in relations), "failed": sum(not row["pass"] for row in relations), "checks": relations}


def validate_corpus(corpus: dict[str, Any], contract: dict[str, Any]) -> dict[str, Any]:
    fixtures, failures, failed_cases = corpus.get("fixtures", []), [], set()
    expected_counts = {"caller_paraphrase": 40, **{name: 20 for name in ("location_correction", "contradictory_city_postal", "callback_refusal_or_malformed", "urgency_ambiguity", "safety_collision", "unsupported_area_collision", "instruction_injection", "existing_customer_exception", "sensitive_or_consent")}}
    required = {"case", "category", "synthetic_caller_text", "normalized_expected_facts", "expected_flow_local_enums", "expected_terminal_node", "forbidden_outcomes", "forbidden_claims"}
    matrix = corpus.get("configuration_adversarial_matrix", {}); invalid_classes = {"missing": object(), "null": None, "boolean": False, "number": 7, "empty": "", "spaces": "   ", "tab": "\t", "newline": "\n", "mixed_whitespace": " \t\r\n ", "nonbreaking_space": "\u00a0", "em_space": "\u2003", "padded_nonempty": " synthetic "}; matrix_expected = {"terminal": "terminal.configuration_unavailable", "primary_outcome": "configuration_not_ready", "review_required": True, "disclosure_reached": False, "caller_data_collection_reached": False, "client_configuration_used": False, "identifiers_spoken": False}
    if set(corpus) != {"schema_version", "classification", "runtime_authority", "deployment_authorized", "agent", "category_counts", "configuration_adversarial_matrix", "fixtures", "interpretation"} or corpus.get("runtime_authority") is not False or corpus.get("deployment_authorized") is not False or corpus.get("agent") != IMMUTABLE["agent"] or find_public_data_problems(corpus): failures.append("corpus.schema_or_public_boundary")
    if matrix != {"identifiers": IDENTIFIERS, "invalid_value_classes": list(invalid_classes), "valid_replacement_class": "trimmed_nonempty_synthetic_string", "expected": matrix_expected}: failures.append("corpus.configuration_matrix")
    if len(fixtures) != 220 or Counter(row.get("category") for row in fixtures) != Counter(expected_counts): failures.append("corpus.category_counts")
    if len({row.get("case") for row in fixtures}) != len(fixtures) or len({row.get("synthetic_caller_text") for row in fixtures}) != len(fixtures): failures.append("corpus.unique_cases_and_text")
    signatures = Counter((row.get("category"), json.dumps(row.get("normalized_expected_facts", {}), sort_keys=True)) for row in fixtures)
    minimum_signatures = {"caller_paraphrase": 4, "location_correction": 4, "contradictory_city_postal": 3, "callback_refusal_or_malformed": 4, "urgency_ambiguity": 3, "safety_collision": 4, "unsupported_area_collision": 4, "instruction_injection": 4, "existing_customer_exception": 4, "sensitive_or_consent": 4}
    if any(sum(category == wanted for category, _ in signatures) < minimum for wanted, minimum in minimum_signatures.items()): failures.append("corpus.semantic_diversity")
    for row in fixtures:
        terminal, observed = resolve(row.get("normalized_expected_facts", {}), contract); bad = set(row) != required or row.get("expected_terminal_node") != terminal or row.get("expected_flow_local_enums") != observed
        bad |= terminal in row.get("forbidden_outcomes", []) or not set(COMMON_FORBIDDEN_CLAIMS).issubset(row.get("forbidden_claims", []))
        if bad: failed_cases.add(str(row.get("case")))
    config_base = {"coverage_mode": "AfterHoursOnly", "resolver_status": "Resolved", **dict(zip(IDENTIFIERS, ("synthetic_client", "synthetic_deployment", "synthetic_configuration"))), "engagement_type": "free_test", "capability_profile": "call_gap_monitor_v1"}
    config_failures = 0
    for key, label in itertools.product(IDENTIFIERS, invalid_classes):
        value = invalid_classes[label]; config = {name: item for name, item in config_base.items() if not (name == key and label == "missing")}
        if label != "missing": config[key] = value
        actual = gate_valid(config, contract, {"canonical_coverage_modes": ["AfterHoursOnly"]}); config_failures += actual
        if actual: failed_cases.add(f"configuration:{key}:{label}")
    if failed_cases: failures.append("corpus.oracle_or_forbidden_contract")
    total = len(fixtures) + len(IDENTIFIERS) * len(invalid_classes); structural_failure = any(item != "corpus.oracle_or_forbidden_contract" for item in failures); failed = total if structural_failure else len(failed_cases)
    return {"classification": "heuristic", "fixtures": len(fixtures), "configuration_cases": len(IDENTIFIERS) * len(invalid_classes), "deterministic_normalized_checks": total, "passed": total - failed, "failed": failed, "failures": sorted(set(failures)), "failed_cases": sorted(failed_cases), "requires_retell_native_validation": "caller-text-to-enum extraction"}


def private_graph_report(flow: dict[str, Any], baseline_flow: dict[str, Any], agent: dict[str, Any], baseline_agent: dict[str, Any], coverage: dict[str, Any], identifier_contract: dict[str, Any]) -> dict[str, Any]:
    nodes = flow.get("nodes", []); ids = [node.get("id") for node in nodes]; outgoing = {key: [] for key in ids}; edge_ids, missing = [], 0
    for node in nodes:
        for edge in node.get("edges", []) or []:
            edge_ids.append(edge.get("id")); target = edge.get("destination_node_id"); missing += target not in outgoing
            if target in outgoing: outgoing[node.get("id")].append(target)
        for field in ("else_edge", "skip_response_edge"):
            edge = node.get(field)
            if edge: edge_ids.append(edge.get("id")); target = edge.get("destination_node_id"); missing += target not in outgoing; outgoing[node.get("id")].extend([target] if target in outgoing else [])
    roots = {flow.get("start_node_id")} | {node.get("id") for node in nodes if node.get("global_node_setting")}; reachable = set(roots); queue = deque(roots)
    while queue:
        for target in outgoing.get(queue.popleft(), []):
            if target not in reachable: reachable.add(target); queue.append(target)
    start_reachable = {flow.get("start_node_id")}; queue = deque(start_reachable)
    while queue:
        for target in outgoing.get(queue.popleft(), []):
            if target not in start_reachable: start_reachable.add(target); queue.append(target)
    end_ids = {node.get("id") for node in nodes if node.get("type") == "end"}; reverse = {key: [] for key in ids}
    for source, targets in outgoing.items():
        for target in targets: reverse[target].append(source)
    can_end = set(end_ids); queue = deque(end_ids)
    while queue:
        for source in reverse[queue.popleft()]:
            if source not in can_end: can_end.add(source); queue.append(source)
    cycle = False; white, gray, black = set(ids), set(), set()
    def visit(key: Any) -> None:
        nonlocal cycle
        if key in gray: cycle = True; return
        if key in black: return
        white.discard(key); gray.add(key)
        for target in outgoing.get(key, []): visit(target)
        gray.discard(key); black.add(key)
    while white: visit(next(iter(white)))
    deterministic = [node for node in nodes if node.get("type") in {"branch", "extract_dynamic_variables"}]; allowed_types = {"branch", "conversation", "end", "extract_dynamic_variables"}
    capability_empty = all(flow.get(key) == [] for key in ("tools", "components", "mcps", "knowledge_base_ids")) and flow.get("is_transfer_cf") is False and all(node.get("type") in allowed_types and node.get("tools", []) == [] for node in nodes)
    post, baseline_post = agent.get("post_call_analysis_data", []), baseline_agent.get("post_call_analysis_data", []); by_name, before_by_name = {row.get("name"): row for row in post}, {row.get("name"): row for row in baseline_post}
    allowed_post_delta = {"transfer_attempted": {"description"}, "transfer_result": {"choices", "description"}, "human_escalation": {"description"}, "appointment_booked": {"description"}, "primary_outcome": {"choices", "description"}}
    def without(row: dict[str, Any], keys: set[str]) -> dict[str, Any]: return {key: value for key, value in row.items() if key not in keys}
    unchanged_post = [row.get("name") for row in post] == [row.get("name") for row in baseline_post] and all(name in allowed_post_delta or row == before_by_name.get(name) for name, row in by_name.items()) and all(without(by_name.get(name, {}), fields) == without(before_by_name.get(name, {}), fields) for name, fields in allowed_post_delta.items())
    required = {"transfer_attempted": ("boolean", "always false"), "transfer_result": ("enum", "always not_enabled"), "human_escalation": ("boolean", "always false"), "appointment_booked": ("boolean", "always false")}
    primary, review = by_name.get("primary_outcome", {}), by_name.get("review_required", {}); expected_primary = [value for value in before_by_name.get("primary_outcome", {}).get("choices", []) if value not in FORBIDDEN_TRANSFER_OUTCOMES]; human_text = by_name.get("human_escalation", {}).get("description", "").lower(); post_constraints = unchanged_post and len(post) == len(baseline_post) == len(by_name) and all(by_name.get(name, {}).get("type") == kind and token in by_name.get(name, {}).get("description", "").lower() for name, (kind, token) in required.items()) and "review_required" in human_text and "never means" in human_text and by_name.get("transfer_result", {}).get("choices") == ["not_enabled"] and primary.get("choices") == expected_primary and all(token in primary.get("description", "").lower() for token in ("configuration_not_ready", "review_required true", "no choice may assert")) and all(token in review.get("description", "").lower() for token in ("configuration", "true"))
    start = next((node for node in nodes if node.get("id") == flow.get("start_node_id")), {})
    groups = [edge.get("transition_condition", {}).get("equations", []) for edge in start.get("edges", []) if edge.get("transition_condition", {}).get("type") == "equation"]
    baseline_start = next((node for node in baseline_flow.get("nodes", []) if node.get("id") == baseline_flow.get("start_node_id")), {}); baseline_groups = [edge.get("transition_condition", {}).get("equations", []) for edge in baseline_start.get("edges", []) if edge.get("transition_condition", {}).get("type") == "equation"]
    exact = {"Resolved", "free_test", "call_gap_monitor_v1"}; modes = set(coverage["canonical_coverage_modes"]); group_modes = [modes & {eq.get("right") for eq in group} for group in groups if exact <= {eq.get("right") for eq in group}]; canonical_groups = len(start.get("edges", [])) == len(groups) == len(baseline_groups) == len(modes) and all(len(group) == len(baseline) for group, baseline in zip(groups, baseline_groups)) and len(group_modes) == len(modes) and all(len(values) == 1 for values in group_modes) and set().union(*group_modes) == modes
    def baseline_pair_names(group: list[dict[str, Any]]) -> list[str]:
        names = []
        for equation in group:
            left = equation.get("left")
            if equation.get("operator") == "exists" and isinstance(left, str) and left.startswith("{{") and left.endswith("}}") and sum(item.get("left") == left and item.get("operator") == "!=" and item.get("right") == "" for item in group) == 1: names.append(left[2:-2])
        return names
    baseline_name_groups = [baseline_pair_names(group) for group in baseline_groups]; baseline_names = baseline_name_groups[0] if len(baseline_name_groups) == 3 and all(names == baseline_name_groups[0] for names in baseline_name_groups) and len(baseline_name_groups[0]) == 3 else []
    private_rows = identifier_contract.get("identifiers", []) if isinstance(identifier_contract, dict) else []; private_suffix = identifier_contract.get("prompt_suffix") if isinstance(identifier_contract, dict) else None; roles = [row.get("role") for row in private_rows if isinstance(row, dict)]; private_names = [row.get("name") for row in private_rows if isinstance(row, dict)]; approved_values = {row.get("name"): row.get("approved_value") for row in private_rows if isinstance(row, dict)}; expected_private_contract = {"schema_version": 1, "classification": "private-runtime-contract", "approval_scope": "user-approved-v0-runtime-identifiers", "identifiers": private_rows, "required_type": "string", "trimmed_required": True, "trimmed_nonempty_required": True, "configured_client_matching": "approved_private_exact_tuple", "safe_default": "", "never_spoken": True, "prompt_suffix": private_suffix}; suffix_text = private_suffix.lower() if isinstance(private_suffix, str) else ""; suffix_semantics = all(token in suffix_text for token in ("never", "spoken", "disclosed", "approved private", "trimmed", "nonempty", "neutral", "configuration-unavailable")); private_contract_valid = identifier_contract == expected_private_contract and len(private_rows) == 3 and roles == ["client_tenancy", "deployment", "configuration"] and all(isinstance(row, dict) and set(row) == {"role", "name", "approved_value"} for row in private_rows) and private_names == baseline_names and len(private_names) == len(set(private_names)) == 3 and all(isinstance(value, str) and value == value.strip() and bool(value.strip()) for value in approved_values.values()) and suffix_semantics and all(name in private_suffix and approved_values[name] not in private_suffix for name in private_names) and isinstance(agent.get("agent_id"), str) and bool(agent.get("agent_id")) and private_rows[0].get("approved_value") != agent.get("agent_id")
    private_lefts = {name: "{{" + name + "}}" for name in private_names}; pair_groups = [{name: ([eq for eq in group if eq.get("left") == left and eq.get("operator") == "exists"], [eq for eq in group if eq.get("left") == left and eq.get("operator") == "=="]) for name, left in private_lefts.items()} for group in groups]; pairs = private_contract_valid and len(pair_groups) == 3 and all(all(len(exists) == len(equals) == 1 and equals[0].get("right") == approved_values[name] for name, (exists, equals) in mapping.items()) for mapping in pair_groups)
    private_values = {name: [mapping[name][1][0].get("right") for mapping in pair_groups] for name in private_names} if pairs else {}; defaults = flow.get("default_dynamic_variables", {}); prompt, baseline_prompt = flow.get("global_prompt", ""), baseline_flow.get("global_prompt", ""); failure_end = next((node for node in nodes if node.get("id") == start.get("else_edge", {}).get("destination_node_id")), {})
    prompt_allowed = private_contract_valid and prompt == baseline_prompt.rstrip() + private_suffix
    speakable = json.dumps([node.get("instruction") for node in nodes if node.get("instruction")], ensure_ascii=False); spoken_clear = private_contract_valid and not any(name in speakable or approved_values[name] in speakable for name in private_names)
    restored_flow = copy.deepcopy(flow); restored_start = next((node for node in restored_flow.get("nodes", []) if node.get("id") == restored_flow.get("start_node_id")), {}); restored_groups = [edge.get("transition_condition", {}).get("equations", []) for edge in restored_start.get("edges", []) if edge.get("transition_condition", {}).get("type") == "equation"]
    if pairs:
        for group in restored_groups:
            for name in private_names:
                item = next(eq for eq in group if eq.get("left") == private_lefts[name] and eq.get("operator") == "==" and eq.get("right") == approved_values[name]); item["operator"], item["right"] = "!=", ""
    restored_flow["global_prompt"] = baseline_prompt; flow_delta_allowed = bool(pairs) and prompt_allowed and restored_flow == baseline_flow
    restored_agent = copy.deepcopy(agent); restored_agent["post_call_analysis_data"] = baseline_post; restored_agent["opt_in_signed_url"] = baseline_agent.get("opt_in_signed_url"); agent_delta_allowed = restored_agent == baseline_agent
    whitespace = bool(pairs) and all(values == [approved_values[name]] * 3 for name, values in private_values.items()) and all(defaults.get(name) == "" for name in private_names) and prompt_allowed and spoken_clear and not any(name in json.dumps(failure_end) for name in private_names) and flow_delta_allowed
    telemetry = agent.get("webhook_events") == EXPECTED_TELEMETRY["required_provider_events"] and agent.get("webhook_events") == baseline_agent.get("webhook_events") and agent.get("opt_in_signed_url") is False
    customer_actions_absent = capability_empty and post_constraints and telemetry
    checks = {"exact_unpublished_v0_agent": agent.get("agent_name") == "7-Day Free Test" and agent.get("version") == 0 and agent.get("is_published") is False and agent_delta_allowed, "exact_unpublished_v0_flow": flow.get("version") == 0 and flow.get("is_published") is False and flow_delta_allowed, "unique_node_ids": len(ids) == len(set(ids)), "unique_edge_ids": len(edge_ids) == len(set(edge_ids)), "destinations_exist": missing == 0, "entrypoint_reachable_non_end": not any(node.get("type") != "end" and node.get("id") not in reachable for node in nodes), "all_nodes_reach_end": not (set(ids) - can_end), "acyclic": not cycle, "deterministic_splits_have_else": all(node.get("else_edge") for node in deterministic), "structured_capabilities_disabled": capability_empty, "other_agent_absent": "Revenue Desk — Master Template" not in json.dumps({"flow": flow, "agent": agent}, ensure_ascii=False), "post_call_structure_compatible": post_constraints, "gate_canonical_success_groups": canonical_groups, "gate_required_identifier_pairs": bool(pairs), "gate_identifiers_reject_whitespace": whitespace, "gate_failure_is_direct_end": start.get("else_edge", {}).get("destination_node_id") in end_ids, "provider_telemetry_preserved_and_customer_actions_absent": customer_actions_absent}
    return {"classification": "structural", "node_count": len(nodes), "edge_count": len(edge_ids), "checks": checks, "passed": sum(checks.values()), "failed": sum(not value for value in checks.values()), "start_only_unreachable_non_end": sum(node.get("type") != "end" and node.get("id") not in start_reachable for node in nodes), "entrypoint_note": "Global provider entry semantics require Retell-native validation.", "post_call_note": "Full private baseline equality and declared constraints are structural; generated values require Retell-native validation."}


def mutate_route(contract: dict[str, Any], group: str, state: str, target: str, edge_key: str) -> None:
    contract["rules"][group][state] = target; next(edge for edge in contract["abstract_graph"]["edges"] if edge["key"] == edge_key)["to_state"] = graph_target(target)


def mutation_report(contract: dict[str, Any], coverage: dict[str, Any], classification: dict[str, Any], corpus: dict[str, Any]) -> dict[str, Any]:
    mutations: list[tuple[str, str, str, Callable[[dict[str, Any]], None]]] = [
        ("generic_no_callback_before_urgency", "urgency_precedence", "business_oracle", lambda c: c["rules"].__setitem__("generic_no_callback_before_urgency", True)),
        ("urgent_confirmed_to_no_callback", "urgent_callback", "business_oracle", lambda c: mutate_route(c, "urgent_callback", "confirmed_usable", "terminal.urgent_no_callback", "urgent_callback_confirmed")),
        ("out_of_area_to_unsupported", "area_precedence", "business_oracle", lambda c: mutate_route(c, "area", "out_of_area", "terminal.unsupported_service_or_property", "area_out")),
        ("unknown_area_to_in_area", "unknown_area", "business_oracle", lambda c: mutate_route(c, "area", "unknown", "continue.service_property", "area_else")),
        ("unknown_service_to_supported", "unknown_service", "business_oracle", lambda c: mutate_route(c, "service_property", "unknown", "continue.routine", "service_else")),
        ("incomplete_routine_to_standard", "incomplete_routine", "business_oracle", lambda c: mutate_route(c, "routine", "incomplete_or_ambiguous", "terminal.standard", "routine_else")),
        ("invalid_mode_allowed", "configuration_gate", "configuration_gate", lambda c: c["gate_contract"].__setitem__("noncanonical_modes_fail_closed", False)),
        ("identifier_requirement_removed", "identifier_contract", "configuration_gate", lambda c: c["gate_contract"]["required_nonblank_references"].remove(IDENTIFIERS[0])),
        ("identifier_trim_guard_removed", "identifier_contract", "configuration_gate", lambda c: c["gate_contract"]["identifier_value_contract"].update({"trimmed_required": False, "trimmed_nonempty_required": False})),
        ("safe_else_removed", "safe_else", "static_graph", lambda c: c["abstract_graph"]["edges"].__setitem__(slice(None), [edge for edge in c["abstract_graph"]["edges"] if edge["key"] != "area_else"])),
        ("transfer_enabled", "forbidden_capability", "static_capabilities", lambda c: c["capability_boundary"].__setitem__("transfer", True)),
        ("booking_enabled", "forbidden_capability", "static_capabilities", lambda c: c["capability_boundary"].__setitem__("booking", True)),
        ("required_telemetry_removed", "telemetry_boundary", "static_capabilities", lambda c: c["telemetry_boundary"]["required_provider_events"].remove("call_ended")),
        ("customer_action_authorized", "telemetry_boundary", "static_capabilities", lambda c: c["telemetry_boundary"].__setitem__("customer_or_operational_action_authorized", True)),
        ("goodbye_overwrites_terminal", "goodbye_latch", "metamorphic", lambda c: c["rules"].__setitem__("goodbye_preserves_terminal", False)),
    ]
    rows = []
    for name, family, required, mutate in mutations:
        candidate = copy.deepcopy(contract); mutate(candidate); layers = set()
        if abstract_graph_failures(candidate): layers.add("static_graph")
        if candidate["capability_boundary"] != EXPECTED_CAPABILITIES or candidate["telemetry_boundary"] != EXPECTED_TELEMETRY: layers.add("static_capabilities")
        if candidate["post_call_definitions"] != EXPECTED_POST: layers.add("static_post_call")
        if any(not row["pass"] for row in gate_cases(candidate, coverage)): layers.add("configuration_gate")
        if business_state_report(candidate, coverage)["failed"]: layers.add("business_oracle")
        if metamorphic_report(candidate, coverage)["failed"]: layers.add("metamorphic")
        if validate_corpus(corpus, candidate)["failed"]: layers.add("adversarial_corpus")
        rows.append({"mutation": name, "family": family, "required_detector": required, "detected": required in layers, "detectors": sorted(layers)})
    families = {row["family"] for row in rows}; detected_families = {family for family in families if all(row["detected"] for row in rows if row["family"] == family)}; detected = sum(row["detected"] for row in rows)
    return {"classification": "deterministic", "variants": len(rows), "detected_variants": detected, "variant_score": f"{detected}/{len(rows)}", "critical_families": len(families), "detected_families": len(detected_families), "family_score": f"{len(detected_families)}/{len(families)}", "mutations": rows}


def index_rows(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    result = {row["key"]: row for row in rows}
    if len(result) != len(rows): raise ValueError("Differential input contains duplicate public keys")
    return result


def changed_by_key(before: list[dict[str, Any]], after: list[dict[str, Any]]) -> dict[str, list[str]]:
    left, right = index_rows(before), index_rows(after)
    return {"added": sorted(right.keys() - left.keys()), "removed": sorted(left.keys() - right.keys()), "modified": sorted(key for key in left.keys() & right.keys() if left[key] != right[key])}


def changed_values(before: dict[str, list[str]], after: dict[str, list[str]]) -> dict[str, dict[str, Any]]:
    result = {}
    for key in sorted(set(before) | set(after)):
        left, right = before.get(key, []), after.get(key, [])
        if left != right: result[key] = {"added": sorted(set(right) - set(left)), "removed": sorted(set(left) - set(right)), "order_changed": set(left) == set(right)}
    return result


def differential(baseline: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    for document in (baseline, candidate):
        if not contract_schema_valid(document) or find_public_data_problems(document): raise ValueError("Differential input violates the strict public QA schema")
    nodes = changed_by_key(baseline["abstract_graph"]["nodes"], candidate["abstract_graph"]["nodes"]); edges = changed_by_key(baseline["abstract_graph"]["edges"], candidate["abstract_graph"]["edges"])
    enums = changed_values(baseline["state_sets"], candidate["state_sets"]); variables = changed_values(baseline["variable_references"], candidate["variable_references"]); post = changed_by_key(baseline["post_call_definitions"], candidate["post_call_definitions"])
    capabilities = sorted(key for key in set(baseline["capability_boundary"]) | set(candidate["capability_boundary"]) if baseline["capability_boundary"].get(key) != candidate["capability_boundary"].get(key))
    telemetry = sorted(key for key in set(baseline["telemetry_boundary"]) | set(candidate["telemetry_boundary"]) if baseline["telemetry_boundary"].get(key) != candidate["telemetry_boundary"].get(key))
    known = {"abstract_graph", "state_sets", "variable_references", "post_call_definitions", "capability_boundary", "telemetry_boundary"} | set(IMMUTABLE)
    semantic = sorted(key for key in set(baseline) | set(candidate) if key not in known and baseline.get(key) != candidate.get(key)); tests: set[str] = set()
    if any(nodes.values()) or any(edges.values()): tests |= FULL_TESTS
    if enums: tests |= {"static_graph", "configuration_gate", "business_oracle", "metamorphic", "adversarial_corpus", "mutation"}
    if variables: tests |= {"static_graph", "configuration_gate", "adversarial_corpus"}
    if any(post.values()): tests.add("static_post_call")
    if capabilities: tests |= {"static_capabilities", "mutation"}
    if telemetry: tests |= {"static_capabilities", "static_post_call", "mutation"}
    if semantic: tests |= FULL_TESTS
    return {"classification": "structural", "changed_nodes": nodes, "changed_edges": edges, "changed_enum_contracts": enums, "changed_variable_references": variables, "changed_post_call_definitions": post, "changed_capabilities": capabilities, "changed_telemetry_boundary": telemetry, "unclassified_changes": semantic, "tests_affected": sorted(tests), "minimum_local_regression_subset": sorted(tests)}


def run(args: argparse.Namespace) -> int:
    started = time.perf_counter(); output = require_within(args.output, OUTPUT_ROOT, "run output")
    private_agent = require_within(args.private_agent, PRIVATE_ROOT, "private agent input"); private_baseline = require_within(args.private_agent_baseline, PRIVATE_ROOT, "private agent baseline"); private_flow = require_within(args.private_flow, PRIVATE_ROOT, "private flow input"); private_flow_baseline = require_within(args.private_flow_baseline, PRIVATE_ROOT, "private flow baseline"); private_identifier_contract = require_within(args.private_identifier_contract, PRIVATE_ROOT, "private identifier contract")
    baseline, candidate = load_json(args.baseline), load_json(args.candidate); classification, coverage, corpus = load_json(CLASSIFICATION), load_json(COVERAGE), load_json(args.corpus)
    if baseline == candidate: raise ValueError("Changed-candidate QA requires a distinct sanitized prechange baseline")
    if not contract_schema_valid(candidate) or find_public_data_problems(candidate): raise ValueError("Candidate violates the strict public QA schema")
    flow, baseline_flow, agent, baseline_agent, identifier_contract = load_json(private_flow, private=True), load_json(private_flow_baseline, private=True), load_json(private_agent, private=True), load_json(private_baseline, private=True), load_json(private_identifier_contract, private=True)
    public_failures = sorted(contract_failures(candidate, coverage, classification)); gate = gate_cases(candidate, coverage); business = business_state_report(candidate, coverage); meta = metamorphic_report(candidate, coverage); corpus_result = validate_corpus(corpus, candidate); mutations = mutation_report(candidate, coverage, classification, corpus); diff = differential(baseline, candidate); structural = private_graph_report(flow, baseline_flow, agent, baseline_agent, coverage, identifier_contract)
    gate_failed = sum(not row["pass"] for row in gate); p1 = []
    if not structural["checks"]["gate_identifiers_reject_whitespace"]: p1.append("private gate does not structurally reject whitespace-only identifiers")
    if not structural["checks"]["provider_telemetry_preserved_and_customer_actions_absent"]: p1.append("provider telemetry or customer-action boundary is unresolved")
    mutation_failed = mutations["variants"] - mutations["detected_variants"]
    deterministic_cases = len(gate) + business["cases"] + corpus_result["deterministic_normalized_checks"] + meta["relations"] + mutations["variants"]
    deterministic_failed = gate_failed + business["failed"] + corpus_result["failed"] + meta["failed"] + mutation_failed
    overall = not public_failures and not deterministic_failed and structural["failed"] == 0 and not p1; runtime = round(time.perf_counter() - started, 3)
    business_report = {"schema_version": 1, "configuration_gate": {"classification": "deterministic", "cases": len(gate), "passed": len(gate) - gate_failed, "failed": gate_failed, "results": gate}, "business_state_oracle": business, "adversarial_corpus": corpus_result, "structural_snapshot": structural}
    summary = {"schema_version": 1, "overall_pass": overall, "deterministic_cases": deterministic_cases, "deterministic_passed": deterministic_cases - deterministic_failed, "deterministic_failed": deterministic_failed, "breakdown": {"configuration_gate": len(gate), "business_states": business["cases"], "adversarial_fixtures": corpus_result["fixtures"], "metamorphic_relations": meta["relations"], "mutation_variants": mutations["variants"], "critical_mutation_families": mutations["critical_families"]}, "structural_checks": {"passed": structural["passed"], "failed": structural["failed"]}, "critical_mutation_detection": {"variants": mutations["variant_score"], "families": mutations["family_score"]}, "public_contract_failures": public_failures, "p0_defects": [], "p1_defects": p1, "runtime_seconds": runtime, "uncovered_states": ["caller-text extraction", "speech and transcription", "provider global-entry selection", "interruption and silence", "spoken-claim adherence", "post-call generated values"], "evidence_labels": {"graph": "structural", "normalized_contract": "deterministic", "caller_text": "heuristic", "uncovered": "requires Retell-native validation"}, "public_candidate_executed": True, "private_candidate_structurally_inspected": True, "private_runtime_candidate_executed": False, "network_calls_performed": 0, "retell_calls_performed": 0}
    output.mkdir(parents=True, exist_ok=True); write_json(output / "business-state-report.json", business_report); write_json(output / "metamorphic-report.json", meta); write_json(output / "mutation-report.json", mutations); write_json(output / "differential-report.json", diff); write_json(output / "summary.json", summary)
    human = ["# 7-Day Free Test Shadow-QA Summary", "", f"Overall: {'PASS' if overall else 'FAIL'}", "", f"- Deterministic cases: {deterministic_cases} ({deterministic_cases - deterministic_failed} passed, {deterministic_failed} failed)", f"- Adversarial fixtures: {corpus_result['fixtures']}", f"- Critical mutation detection: {mutations['variant_score']} variants; {mutations['family_score']} families", f"- Structural checks: {structural['passed']} passed, {structural['failed']} failed", f"- Runtime: {runtime:.3f} seconds", "", "Results are structural, deterministic, or heuristic local evidence only. Actual extraction, speech, prompt selection, and post-call generation require Retell-native validation."]
    if p1: human += ["", "## P1 defects", *[f"- {item}" for item in p1]]
    (output / "summary.md").write_text("\n".join(human) + "\n", encoding="utf-8")
    print(f"Shadow QA {'passed' if overall else 'failed'}: {deterministic_cases} deterministic cases; {mutations['variant_score']} mutations; {runtime:.3f}s"); return 0 if overall else 1


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Offline Retell shadow-QA harness; performs no network calls."); sub = result.add_subparsers(dest="command", required=True); run_cmd = sub.add_parser("run")
    run_cmd.add_argument("--private-agent", type=Path, required=True); run_cmd.add_argument("--private-agent-baseline", type=Path, required=True); run_cmd.add_argument("--private-flow", type=Path, required=True); run_cmd.add_argument("--private-flow-baseline", type=Path, required=True); run_cmd.add_argument("--private-identifier-contract", type=Path, required=True); run_cmd.add_argument("--baseline", type=Path, default=CONTRACT); run_cmd.add_argument("--candidate", type=Path, default=CONTRACT); run_cmd.add_argument("--corpus", type=Path, default=CORPUS); run_cmd.add_argument("--output", type=Path, required=True)
    diff = sub.add_parser("diff"); diff.add_argument("--baseline", type=Path, required=True); diff.add_argument("--candidate", type=Path, required=True); diff.add_argument("--output", type=Path); return result


def main() -> int:
    args = parser().parse_args()
    if args.command == "diff":
        report = differential(load_json(args.baseline), load_json(args.candidate))
        if args.output: write_json(require_within(args.output, OUTPUT_ROOT, "differential output"), report)
        else: print(json.dumps(report, indent=2, sort_keys=True))
        return 0
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
