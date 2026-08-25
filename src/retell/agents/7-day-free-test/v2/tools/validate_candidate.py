#!/usr/bin/env python3
"""Validate the disabled provider-neutral Retell v2 candidate offline."""

from __future__ import annotations

import json
import re
import sys
from collections import deque
from collections.abc import Mapping
from pathlib import Path
from typing import Any


TOOLS_ROOT = Path(__file__).resolve().parent
if str(TOOLS_ROOT) not in sys.path:
    sys.path.insert(0, str(TOOLS_ROOT))

import oracle  # noqa: E402
from network_guard import network_blocked  # noqa: E402


V2_ROOT = TOOLS_ROOT.parent
CONTRACT_PATH = V2_ROOT / "contracts" / "candidate-contract.json"
ADAPTER_PATH = V2_ROOT / "contracts" / "transfer-adapter-contract.json"
SCENARIO_PATH = V2_ROOT / "tests" / "fixtures" / "scenario-matrix.json"

EXPECTED_FILES = {
    "README.md",
    "contracts/candidate-contract.json",
    "contracts/transfer-adapter-contract.json",
    "tests/fixtures/scenario-matrix.json",
    "tools/network_guard.py",
    "tools/oracle.py",
    "tools/validate_candidate.py",
}
EXPECTED_ANALYSIS_FIELDS = [
    "outcome",
    "coverage_trigger",
    "caller_name",
    "callback_number",
    "customer_type",
    "caller_intent",
    "issue_summary",
    "city_or_zip",
    "urgency",
    "specific_person_requested",
    "sensitive_data_detected",
    "bookable_opportunity",
    "office_follow_up_required",
    "workflow_failure_code",
    "workflow_failure_text",
    "handoff_reason",
    "handoff_disposition",
]
EXPECTED_HANDOFF_STATES = [
    "NotApplicable",
    "NotConfigured",
    "Offered",
    "Declined",
    "Started",
    "Bridged",
    "Cancelled",
    "Ended",
    "Failed",
    "Unknown",
]
EXPECTED_NOTIFICATION_FIELDS = [
    "caller_name",
    "confirmed_callback_number",
    "customer_type",
    "city_or_zip",
    "issue_summary",
    "urgency",
    "outcome",
    "handoff_reason",
    "handoff_state",
    "call_timestamp",
]
EXPECTED_CLOSING_LANGUAGE = {
    "routine_qualified": "Thanks. I’ve recorded your details for the team to review. This does not confirm an appointment, dispatch, or callback time. Goodbye.",
    "existing_customer_or_general_message": "Thanks. I’ve recorded your message for the team. I can’t access accounts or change appointments, and no callback time is confirmed. Goodbye.",
    "approved_urgent_transfer_offer": "This may need prompt attention. I can try to reach the approved on-call contact now, but I can’t guarantee someone will answer. Would you like me to try?",
    "before_dialing": "Okay. I’ll try the on-call contact now. Please hold.",
    "transfer_failure": "I wasn’t able to reach a person. I’ve recorded your details for the team to review. No callback, appointment, or dispatch is confirmed. If the situation becomes unsafe, move to a safe place and contact 911 or the appropriate utility emergency line. Goodbye.",
    "immediate_danger": "Move to a safe location and contact 911 or the appropriate utility emergency line now. I cannot diagnose or dispatch help. Goodbye.",
    "configuration_unavailable": "I’m sorry, the call configuration is unavailable, so I can’t safely collect any details. Please try again later. Goodbye.",
}
EXPECTED_PYTHON_NETWORK_SURFACES = [
    "socket.create_connection",
    "socket.socket.connect",
    "urllib.request.urlopen",
    "http.client.HTTPConnection.request",
    "requests.Session.request",
]
EXPECTED_NODE_NETWORK_SURFACES = [
    "net.connect",
    "net.createConnection",
    "http.request",
    "https.request",
    "global.fetch",
    "undici.request",
]
EXPECTED_SETTINGS = {
    "language": "en-US",
    "expressive_mode_enabled": False,
    "backchannel_enabled": True,
    "backchannel_frequency": 0.3,
    "responsiveness": 0.65,
    "interruption_sensitivity": 0.65,
    "speech_to_text_mode": "accurate",
    "dtmf_enabled": False,
    "noise_and_background_speech_cancellation_enabled": True,
    "data_storage": "everything_except_pii",
    "retention_days": 30,
    "provider_mapping_readback_required": True,
    "voice_and_carrier_behavior_validated": False,
}
EXPECTED_SCENARIO_NAMES = [
    "Eligible routine call with caller-ID confirmation",
    "Different callback number",
    "One callback correction",
    "No callback number",
    "Caller name refused",
    "Ambiguous issue clarified once",
    "Concise recap and goodbye",
    "Transfer enabled and accepted",
    "Transfer bridged",
    "Transfer declined",
    "Transfer disabled",
    "Handoff number missing",
    "Handoff number invalid",
    "No callback but transfer accepted",
    "No answer",
    "Busy",
    "Voicemail/nonhuman",
    "Timeout",
    "Provider error",
    "Caller cancels",
    "Failure plus one email record",
    "Word emergency without approved urgent facts",
    "Existing customer with transfer enabled",
    "Existing customer with transfer disabled",
    "Alert-and-capture configuration",
    "Billing question without payment handling",
    "Appointment-change request",
    "Complaint",
    "Legitimate person request with transfer enabled",
    "Legitimate person request with transfer disabled",
    "Salesperson asking for owner",
    "Vendor asking for manager",
    "Job applicant",
    "Gas odor",
    "Fire",
    "Water near energized equipment",
    "Serious injury",
    "Self-harm statement",
    "Property-damage urgency without immediate danger",
    "First payment-card occurrence",
    "Repeated payment-card occurrence",
    "Password/authentication code",
    "Government ID",
    "Unrelated medical information",
    "Consent withdrawal before intake",
    "Consent withdrawal after partial intake",
    "In-area supported service",
    "Out-of-area",
    "Unsupported service",
    "Ambiguous city",
    "Conflicting city and ZIP",
    "Missing service-area data",
    "Missing service list",
    "Ambiguous service after one clarification",
    "Property distinction not configured",
    "Spam",
    "Wrong number",
    "Vendor",
    "Job inquiry",
    "Unrelated request",
    "Unsupported language",
    "Background speech",
    "Silence",
    "Caller interruption",
    "Caller correction",
    "Valid AfterHoursOnly",
    "Valid NoAnswerOverflowOnly",
    "Valid AfterHoursAndOverflow",
    "Blank client ID",
    "Blank deployment ID",
    "Blank configuration version",
    "Wrong resolver-status case",
    "Wrong engagement type",
    "Wrong capability profile",
    "Unsupported coverage mode",
    "Extra unapproved variable",
    "Prompt injection in company name",
    "Prompt injection in service list",
    "QA fixture ID",
    "Cross-client handoff injection",
    "Handoff equals Retell number",
    "Handoff equals forwarding main number",
    "Handoff destination voicemail",
    "Missing notification recipient",
    "Mobile/SMS recipient on v2",
    "Duplicate call_ended",
    "Duplicate call_analyzed",
    "Analysis before call end",
    "Transfer event before analysis",
    "Transfer event after analysis",
    "Duplicate transfer_started",
    "Bridged then stale cancellation",
    "Conflicting deployment metadata",
    "Delayed event after test completion",
    "Notification retry replay",
    "Two clients on one shared agent",
    "Cross-client event replay",
    "Seven-day expiration",
    "Twenty-five-call stop",
    "Paused route",
]

URL_RE = re.compile(r"https?://", re.IGNORECASE)
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
FORMATTED_PHONE_RE = re.compile(
    r"(?<!\d)(?:\+?1[ .-])?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}(?!\d)"
)
E164_PHONE_RE = re.compile(r"(?<![A-Za-z0-9])\+?[1-9]\d{7,14}(?![A-Za-z0-9])")
PRECISE_TIMESTAMP_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}")
SECRET_RE = re.compile(
    r"\b(?:key_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._~+/-]{20,})\b",
    re.IGNORECASE,
)
PROHIBITED_JSON_KEYS = {
    "agent_id",
    "api_key",
    "authorization",
    "connection_alias",
    "conversation_flow_id",
    "default_value",
    "destination",
    "endpoint",
    "flow_id",
    "global_prompt",
    "headers",
    "knowledge_base_id",
    "llm_id",
    "password",
    "phone_number",
    "prompt",
    "raw_payload",
    "raw_response",
    "routing",
    "secret",
    "token",
    "url",
    "version_id",
    "voice_id",
    "webhook_url",
}


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def load_json_unique(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_unique_object)


def _public_text_problems(root: Path) -> list[str]:
    problems: list[str] = []
    for path in sorted(root.rglob("*")):
        if (
            not path.is_file()
            or "__pycache__" in path.parts
            or path.suffix not in {".json", ".md"}
        ):
            continue
        relative = path.relative_to(root).as_posix()
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            problems.append(f"{relative}: unreadable UTF-8")
            continue
        checks = (
            (URL_RE, "URL"),
            (EMAIL_RE, "email-like value"),
            (FORMATTED_PHONE_RE, "phone-like value"),
            (E164_PHONE_RE, "phone-like value"),
            (PRECISE_TIMESTAMP_RE, "precise timestamp"),
            (SECRET_RE, "credential-like value"),
        )
        for pattern, label in checks:
            if pattern.search(text):
                problems.append(f"{relative}: prohibited {label}")
        if "C:\\Users\\" in text or "C:/Users/" in text:
            problems.append(f"{relative}: private filesystem path")
    return problems


def _json_shape_problems(value: object, path: str) -> list[str]:
    problems: list[str] = []
    if isinstance(value, Mapping):
        for key, child in value.items():
            child_path = f"{path}/{key}"
            if str(key).lower() in PROHIBITED_JSON_KEYS:
                problems.append(f"{child_path}: prohibited public field")
            problems.extend(_json_shape_problems(child, child_path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            problems.extend(_json_shape_problems(child, f"{path}/{index}"))
    return problems


def _graph_problems(contract: Mapping[str, Any]) -> list[str]:
    graph = contract.get("flow_graph")
    if not isinstance(graph, Mapping):
        return ["candidate-contract: flow_graph missing"]
    nodes = graph.get("nodes")
    edges = graph.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return ["candidate-contract: graph collections invalid"]

    problems: list[str] = []
    node_map = {
        row.get("key"): row.get("type")
        for row in nodes
        if isinstance(row, Mapping)
    }
    if len(node_map) != len(nodes) or None in node_map:
        problems.append("candidate-contract: graph node keys must be unique")
        return problems
    allowed_types = set(graph.get("allowed_node_types", []))
    if not set(node_map.values()).issubset(allowed_types):
        problems.append("candidate-contract: graph contains prohibited node type")
    if any(node_type in {"Subagent", "Function", "Press Digit", "Agent Transfer", "In-Call SMS", "Code", "MCP"} for node_type in node_map.values()):
        problems.append("candidate-contract: prohibited Retell node type")

    adjacency: dict[str, list[str]] = {key: [] for key in node_map}
    edge_keys: set[str] = set()
    for edge in edges:
        if not isinstance(edge, Mapping):
            problems.append("candidate-contract: graph edge invalid")
            continue
        key = edge.get("key")
        source = edge.get("from")
        target = edge.get("to")
        if key in edge_keys:
            problems.append("candidate-contract: graph edge keys must be unique")
        edge_keys.add(str(key))
        if source not in node_map or target not in node_map:
            problems.append("candidate-contract: graph edge references missing node")
            continue
        adjacency[str(source)].append(str(target))

    first = graph.get("first_node")
    if first != "configuration_gate":
        problems.append("candidate-contract: configuration gate must be first")
    reachable: set[str] = set()
    queue: deque[str] = deque([str(first)])
    while queue:
        node = queue.popleft()
        if node in reachable or node not in adjacency:
            continue
        reachable.add(node)
        queue.extend(adjacency[node])
    if reachable != set(node_map):
        problems.append("candidate-contract: graph contains unreachable node")

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node: str) -> bool:
        if node in visiting:
            return True
        if node in visited:
            return False
        visiting.add(node)
        for target in adjacency[node]:
            if visit(target):
                return True
        visiting.remove(node)
        visited.add(node)
        return False

    if first in adjacency and visit(str(first)):
        problems.append("candidate-contract: graph contains a cycle")
    transfer_nodes = [key for key, node_type in node_map.items() if node_type == "Call Transfer"]
    if transfer_nodes != ["warm_transfer"]:
        problems.append("candidate-contract: exactly one standard transfer node required")
    required_edge_keys = {
        "configuration_invalid",
        "caller_accepts",
        "caller_declines",
        "transfer_failure",
    }
    if not required_edge_keys.issubset(edge_keys):
        problems.append("candidate-contract: required transfer or failure edge missing")
    configuration_failure_edges = [
        edge
        for edge in edges
        if isinstance(edge, Mapping) and edge.get("key") == "configuration_invalid"
    ]
    if not configuration_failure_edges or configuration_failure_edges[0].get("to") != "configuration_unavailable":
        problems.append("candidate-contract: invalid configuration must end directly")
    return problems


def _contract_problems(contract: Mapping[str, Any], adapter: Mapping[str, Any]) -> list[str]:
    problems: list[str] = []
    if contract.get("runtime_authority") is not False or contract.get("deployment_authorized") is not False:
        problems.append("candidate-contract: runtime authority must remain false")
    if contract.get("retell_source_status") != "NOT_READY":
        problems.append("candidate-contract: status must remain NOT_READY")
    profile = contract.get("capability_profile", {})
    if not isinstance(profile, Mapping) or profile != {
        "name": "call_gap_capture_handoff_v2",
        "engagement_type": "free_test",
        "status": "draft",
        "enabled": False,
        "traffic_environments": [],
        "billing_mode": "none",
        "limit_policy": "seven_calendar_days_or_25_connected_calls_v1",
        "v1_rollback_profile": "call_gap_monitor_v1",
    }:
        problems.append("candidate-contract: exact disabled capability profile mismatch")
    provider = contract.get("provider_boundary", {})
    if not isinstance(provider, Mapping) or any(
        provider.get(key) is not False
        for key in ("provider_parser_implemented", "importable_provider_configuration")
    ) or provider.get("provider_field_mapping") != {}:
        problems.append("candidate-contract: provider schema must remain unimplemented")
    gate = contract.get("configuration_gate", {})
    if not isinstance(gate, Mapping):
        problems.append("candidate-contract: configuration gate invalid")
    else:
        if set(gate.get("injected_string_variables", [])) != oracle.DYNAMIC_VARIABLES:
            problems.append("candidate-contract: dynamic variable set mismatch")
        if gate.get("required_exact_strings") != {
            "resolver_status": "Resolved",
            "engagement_type": "free_test",
            "capability_profile": "call_gap_capture_handoff_v2",
        }:
            problems.append("candidate-contract: exact gate values mismatch")
        if gate.get("undeclared_legacy_variables_prohibited") != [
            "configuration_ready",
            "route_activation_approved",
        ]:
            problems.append("candidate-contract: undeclared legacy variable boundary missing")
        if gate.get("failure_collects_caller_data") is not False:
            problems.append("candidate-contract: configuration failure may not collect caller data")
    if contract.get("analysis_fields") != EXPECTED_ANALYSIS_FIELDS:
        problems.append("candidate-contract: exact 17-field analysis schema mismatch")
    constraints = contract.get("analysis_field_constraints", {})
    if not isinstance(constraints, Mapping):
        problems.append("candidate-contract: analysis field bounds missing")
    else:
        bounded_fields = set(constraints.get("bounded_string_maximum_characters", {}))
        enum_fields = set(constraints.get("enum_fields", {}))
        boolean_fields = set(constraints.get("boolean_fields", []))
        if bounded_fields | enum_fields | boolean_fields != set(EXPECTED_ANALYSIS_FIELDS):
            problems.append("candidate-contract: analysis field bounds do not cover exact schema")
        if any(
            not isinstance(value, int) or isinstance(value, bool) or value <= 0 or value > 500
            for value in constraints.get("bounded_string_maximum_characters", {}).values()
        ):
            problems.append("candidate-contract: analysis string bound invalid")
        if constraints.get("transcript_or_recording_copy_allowed") is not False:
            problems.append("candidate-contract: transcript or recording copy prohibited")
    conversation = contract.get("conversation_boundary", {})
    if not isinstance(conversation, Mapping) or conversation.get("closing_language") != EXPECTED_CLOSING_LANGUAGE:
        problems.append("candidate-contract: exact closing language mismatch")
    elif conversation.get("open_ended_anything_else_question") is not False:
        problems.append("candidate-contract: open-ended final question prohibited")
    if contract.get("canonical_handoff_states") != EXPECTED_HANDOFF_STATES:
        problems.append("candidate-contract: canonical handoff state mismatch")
    handoff = contract.get("handoff_policy", {})
    if not isinstance(handoff, Mapping) or any(
        (
            handoff.get("transfer_type") != "Warm Transfer",
            handoff.get("warm_transfer_node_count") != 1,
            handoff.get("e164_target_required_when_enabled") is not True,
            handoff.get("human_detection_required") is not True,
            handoff.get("bridge_to_voicemail_or_nonhuman_allowed") is not False,
            handoff.get("press_digit_required") is not False,
            handoff.get("caller_id_override_allowed") is not False,
            handoff.get("provider_target_mapping_deferred") is not True,
            handoff.get("loop_rejection_categories") != [
                "assigned_retell_number",
                "forwarding_main_number",
                "route_failover_number",
                "known_forward_into_sylvara",
                "nested_return_to_same_retell_number",
            ],
        )
    ):
        problems.append("candidate-contract: bounded warm-transfer controls mismatch")
    notification = contract.get("notification_policy", {})
    if not isinstance(notification, Mapping):
        problems.append("candidate-contract: notification policy invalid")
    else:
        if notification.get("owner") != "catalyst":
            problems.append("candidate-contract: Catalyst must own notification")
        if notification.get("durable_rows_per_actionable_call") != 1:
            problems.append("candidate-contract: one durable notification row required")
        if notification.get("provider_calls_in_local_mode") != 0:
            problems.append("candidate-contract: local provider calls prohibited")
        if notification.get("allowed_fields") != EXPECTED_NOTIFICATION_FIELDS:
            problems.append("candidate-contract: bounded notification mapping mismatch")
        if notification.get("delivery_claim_allowed") is not False:
            problems.append("candidate-contract: notification delivery claim prohibited")
    local = contract.get("local_test_boundary", {})
    if not isinstance(local, Mapping) or local.get("required_network_attempt_count") != 0:
        problems.append("candidate-contract: zero-network boundary missing")
    elif (
        local.get("guarded_python_surfaces") != EXPECTED_PYTHON_NETWORK_SURFACES
        or local.get("guarded_node_surfaces") != EXPECTED_NODE_NETWORK_SURFACES
        or local.get("network_allowed") is not False
        or local.get("external_model_allowed") is not False
    ):
        problems.append("candidate-contract: exact network guard inventory mismatch")
    if contract.get("validation_boundary", {}).get("critical_mutation_count") != len(oracle.MUTATIONS):
        problems.append("candidate-contract: critical mutation inventory mismatch")
    if contract.get("settings_constraints") != EXPECTED_SETTINGS:
        problems.append("candidate-contract: preserved settings constraints mismatch")
    problems.extend(_graph_problems(contract))

    if adapter.get("runtime_authority") is not False or adapter.get("deployment_authorized") is not False:
        problems.append("transfer-adapter: runtime authority must remain false")
    if adapter.get("retell_source_status") != "NOT_READY":
        problems.append("transfer-adapter: status must remain NOT_READY")
    parser = adapter.get("provider_parser", {})
    if not isinstance(parser, Mapping) or parser.get("implemented") is not False or parser.get("importable") is not False or parser.get("field_mapping") != {}:
        problems.append("transfer-adapter: fabricated provider parser is prohibited")
    if adapter.get("canonical_states") != EXPECTED_HANDOFF_STATES:
        problems.append("transfer-adapter: state set mismatch")
    convergence = adapter.get("convergence_rules", {})
    if not isinstance(convergence, Mapping) or not all(value is True or value == 1 for value in convergence.values()):
        problems.append("transfer-adapter: convergence rules incomplete")
    return problems


def validate_candidate(root: Path = V2_ROOT) -> list[str]:
    problems: list[str] = []
    if not root.is_dir() or root.is_symlink():
        return ["Retell v2 candidate root is missing or unsafe"]
    observed = {
        path.relative_to(root).as_posix()
        for path in root.rglob("*")
        if path.is_file() and "__pycache__" not in path.parts
    }
    if observed != EXPECTED_FILES:
        problems.append("Retell v2 candidate file inventory mismatch")
    problems.extend(_public_text_problems(root))
    try:
        contract = load_json_unique(root / "contracts" / "candidate-contract.json")
        adapter = load_json_unique(root / "contracts" / "transfer-adapter-contract.json")
        scenario_document = load_json_unique(root / "tests" / "fixtures" / "scenario-matrix.json")
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
        return problems + ["Retell v2 candidate contains invalid or duplicate-key JSON"]
    if not isinstance(contract, Mapping) or not isinstance(adapter, Mapping) or not isinstance(scenario_document, Mapping):
        return problems + ["Retell v2 candidate JSON roots must be objects"]
    problems.extend(_json_shape_problems(contract, "candidate-contract"))
    problems.extend(_json_shape_problems(adapter, "transfer-adapter"))
    problems.extend(_json_shape_problems(scenario_document, "scenario-matrix"))
    problems.extend(_contract_problems(contract, adapter))

    scenarios = scenario_document.get("cases")
    if not isinstance(scenarios, list):
        return problems + ["scenario-matrix: cases must be a list"]
    if scenario_document.get("case_count") != 100 or len(scenarios) != 100:
        problems.append("scenario-matrix: exactly 100 scenarios required")
    expected_ids = [f"v2_{index:03d}" for index in range(1, 101)]
    if [row.get("id") for row in scenarios if isinstance(row, Mapping)] != expected_ids:
        problems.append("scenario-matrix: exact ordered identifiers mismatch")
    if [row.get("name") for row in scenarios if isinstance(row, Mapping)] != EXPECTED_SCENARIO_NAMES:
        problems.append("scenario-matrix: exact required names mismatch")
    for row in scenarios:
        if not isinstance(row, Mapping) or set(row) != {"id", "name", "inputs", "expected"}:
            problems.append("scenario-matrix: exact case schema mismatch")
            break
        if not isinstance(row["inputs"], Mapping) or not isinstance(row["expected"], Mapping) or not row["expected"]:
            problems.append("scenario-matrix: case inputs or expectations invalid")
            break
    if not problems:
        problems.extend(f"scenario-matrix: {failure}" for failure in oracle.scenario_failures(scenarios))
        mutation = oracle.mutation_report(scenarios)
        if mutation["survived"] or mutation["critical_kill_rate"] != 1.0 or mutation["overall_kill_rate"] < 0.9:
            problems.append("scenario-matrix: mutation threshold not met")
    return problems


def main() -> int:
    with network_blocked() as guard:
        problems = validate_candidate()
        scenario_document = load_json_unique(SCENARIO_PATH)
        mutation = oracle.mutation_report(scenario_document["cases"])
    report = {
        "status": "FAIL" if problems else "PASS",
        "retell_source_status": "NOT_READY",
        "scenario_count": len(scenario_document["cases"]),
        "network_attempt_count": guard.attempt_count,
        "critical_mutations_killed": mutation["killed"],
        "critical_mutations_total": mutation["total"],
        "critical_mutation_kill_rate": mutation["critical_kill_rate"],
        "overall_mutation_kill_rate": mutation["overall_kill_rate"],
        "provider_parser_implemented": False,
        "problem_count": len(problems),
    }
    print(json.dumps(report, sort_keys=True))
    for problem in problems:
        print(problem, file=sys.stderr)
    return 1 if problems or guard.attempt_count else 0


if __name__ == "__main__":
    raise SystemExit(main())
