"""Provider-neutral deterministic oracle for the disabled free-test v2 candidate.

The oracle evaluates symbolic facts only. It does not interpret caller text, parse
Retell payloads, emulate a model, contact a provider, or authorize runtime use.
"""

from __future__ import annotations

import dataclasses
import json
from dataclasses import dataclass
from typing import Any


COVERAGE_MODES = {
    "AfterHoursOnly",
    "NoAnswerOverflowOnly",
    "AfterHoursAndOverflow",
}
BOOLEAN_VARIABLES = {
    "handoff_enabled",
    "urgent_handoff_enabled",
    "existing_customer_handoff_enabled",
    "specific_person_handoff_enabled",
}
DYNAMIC_VARIABLES = {
    "resolver_status",
    "client_id",
    "deployment_id",
    "configuration_version",
    "engagement_type",
    "capability_profile",
    "coverage_mode",
    "company_name",
    "services_handled_json",
    "unsupported_services_json",
    "service_area_json",
    "urgent_conditions_json",
    "caller_number_candidate",
    "coverage_trigger",
    "coverage_trigger_source",
    "handoff_enabled",
    "handoff_number",
    "handoff_display_name",
    "handoff_destination_type",
    "urgent_handoff_enabled",
    "existing_customer_handoff_enabled",
    "specific_person_handoff_enabled",
    "handoff_failure_behavior",
}
ACTIONABLE_OUTCOMES = {
    "potential_job",
    "urgent_potential_job",
    "existing_customer",
}
NONTRANSFER_INTENTS = {
    "spam",
    "wrong_number",
    "vendor",
    "sales",
    "job_applicant",
}
HANDOFF_EVIDENCE_AUTHORITIES = {
    "caller_intent_authority": "structured_call_classification",
    "service_eligibility_authority": "immutable_client_configuration",
    "area_eligibility_authority": "immutable_client_configuration",
    "destination_authority": "immutable_client_configuration",
    "loop_proof_authority": "server_route_graph",
}
FAILURE_EVENTS = {
    "transfer_failed:no_answer",
    "transfer_failed:busy",
    "transfer_failed:voicemail_or_nonhuman",
    "transfer_failed:timeout",
    "transfer_failed:caller_cancelled",
    "transfer_failed:provider_error",
    "transfer_failed:invalid_destination",
    "transfer_failed:unknown",
}
MODEL_HANDOFF_DISPOSITIONS = {
    "not_applicable",
    "not_configured",
    "offered_declined",
    "attempted",
    "failure_branch",
    "unknown",
}
STRUCTURED_EVENT_STATE_PRECEDENCE = (
    "Bridged",
    "Failed",
    "Ended",
    "Cancelled",
    "Started",
)
NOTIFICATION_HANDOFF_STATE_PRECEDENCE = STRUCTURED_EVENT_STATE_PRECEDENCE + (
    "Declined",
    "Offered",
    "NotConfigured",
    "NotApplicable",
    "Unknown",
)
CLIENT_CONTEXTS = {
    "client_alpha": {
        "company_marker": "Synthetic Alpha Plumbing",
        "service_marker": "alpha_service",
        "area_marker": "alpha_area",
        "urgent_marker": "alpha_urgent_condition",
        "target_fingerprint": "target_fp_alpha",
        "recipient_fingerprint": "recipient_fp_alpha",
        "reporting_partition": "reporting_alpha",
    },
    "client_beta": {
        "company_marker": "Synthetic Beta Plumbing",
        "service_marker": "beta_service",
        "area_marker": "beta_area",
        "urgent_marker": "beta_urgent_condition",
        "target_fingerprint": "target_fp_beta",
        "recipient_fingerprint": "recipient_fp_beta",
        "reporting_partition": "reporting_beta",
    },
}


@dataclass(frozen=True)
class Rules:
    transfer_failure_truthful: bool = True
    routine_transfer: bool = False
    vendor_transfer: bool = False
    allow_invalid_handoff: bool = False
    allow_route_loop: bool = False
    accept_lowercase_resolver: bool = False
    allow_qa_literal: bool = False
    allow_extra_variable: bool = False
    callback_overrides_outcome: bool = False
    suppress_routine_notification: bool = False
    duplicate_notification: bool = False
    analysis_overrides_bridged: bool = False
    claim_notification_delivery: bool = False
    collect_on_configuration_failure: bool = False
    allow_mobile_notification: bool = False
    retain_sensitive_data: bool = False


DEFAULT_RULES = Rules()


def _base_configuration() -> dict[str, str]:
    return {
        "resolver_status": "Resolved",
        "client_id": "client_alpha",
        "deployment_id": "deployment_alpha",
        "configuration_version": "configuration_alpha",
        "engagement_type": "free_test",
        "capability_profile": "call_gap_capture_handoff_v2",
        "coverage_mode": "AfterHoursOnly",
        "company_name": "Synthetic Plumbing",
        "services_handled_json": '["synthetic_service"]',
        "unsupported_services_json": "[]",
        "service_area_json": '["synthetic_area"]',
        "urgent_conditions_json": '["synthetic_urgent_condition"]',
        "caller_number_candidate": "synthetic_callback_candidate",
        "coverage_trigger": "Unknown",
        "coverage_trigger_source": "trusted_resolver",
        "handoff_enabled": "false",
        "handoff_number": "",
        "handoff_display_name": "",
        "handoff_destination_type": "",
        "urgent_handoff_enabled": "false",
        "existing_customer_handoff_enabled": "false",
        "specific_person_handoff_enabled": "false",
        "handoff_failure_behavior": "truthful_failure_close",
    }


def resolve_client_context(facts: dict[str, Any]) -> dict[str, str] | None:
    scope = str(facts.get("client_scope", "client_alpha"))
    event_scope = str(facts.get("event_scope", scope))
    if event_scope != scope:
        return None
    context = CLIENT_CONTEXTS.get(scope)
    return dict(context) if context is not None else None


def build_configuration(facts: dict[str, Any]) -> dict[str, str]:
    configuration = _base_configuration()
    scope = facts.get("client_scope", "client_alpha")
    context = CLIENT_CONTEXTS.get(str(scope), CLIENT_CONTEXTS["client_alpha"])
    configuration.update(
        {
            "company_name": context["company_marker"],
            "services_handled_json": json.dumps([context["service_marker"]]),
            "service_area_json": json.dumps([context["area_marker"]]),
            "urgent_conditions_json": json.dumps([context["urgent_marker"]]),
        }
    )
    if scope == "client_beta":
        configuration.update(
            {
                "client_id": "client_beta",
                "deployment_id": "deployment_beta",
                "configuration_version": "configuration_beta",
            }
        )
    profile = facts.get("configuration_profile", "capture_only")
    if profile in {"urgent_handoff", "all_handoff"}:
        configuration.update(
            {
                "handoff_enabled": "true",
                "handoff_number": "synthetic_direct_target",
                "handoff_display_name": "Approved On Call",
                "handoff_destination_type": "direct_human",
                "urgent_handoff_enabled": "true",
            }
        )
    if profile in {"existing_handoff", "all_handoff"}:
        configuration.update(
            {
                "handoff_enabled": "true",
                "handoff_number": "synthetic_direct_target",
                "handoff_display_name": "Approved Office Contact",
                "handoff_destination_type": "direct_human",
                "existing_customer_handoff_enabled": "true",
                "specific_person_handoff_enabled": "true",
            }
        )

    state = facts.get("configuration_state", "valid")
    if state == "missing_client_id":
        configuration.pop("client_id")
    elif state == "missing_deployment_id":
        configuration.pop("deployment_id")
    elif state == "missing_configuration_version":
        configuration.pop("configuration_version")
    elif state == "lowercase_resolver":
        configuration["resolver_status"] = "resolved"
    elif state == "wrong_engagement":
        configuration["engagement_type"] = "paid_service"
    elif state == "wrong_capability":
        configuration["capability_profile"] = "call_gap_monitor_v1"
    elif state == "unsupported_coverage":
        configuration["coverage_mode"] = "UnsupportedMode"
    elif state == "extra_variable":
        configuration["unapproved_variable"] = "synthetic"
    elif state == "qa_literal":
        configuration["client_id"] = "qa_fixture_literal"
    elif state == "prompt_in_company":
        configuration["company_name"] = "Synthetic Company Override-Like Data"
    elif state == "prompt_in_service":
        configuration["services_handled_json"] = '["override_like_data"]'

    if "coverage_mode" in facts:
        configuration["coverage_mode"] = str(facts["coverage_mode"])
    if facts.get("handoff_target_state") == "missing":
        configuration["handoff_number"] = ""
    return configuration


def configuration_problem(
    configuration: dict[str, str], facts: dict[str, Any], rules: Rules
) -> str | None:
    keys = set(configuration)
    if not rules.allow_extra_variable and keys != DYNAMIC_VARIABLES:
        return "dynamic_variable_set_invalid"
    if rules.allow_extra_variable and not DYNAMIC_VARIABLES.issubset(keys):
        return "dynamic_variable_missing"
    if any(not isinstance(value, str) for value in configuration.values()):
        return "dynamic_variable_not_string"

    resolver = configuration.get("resolver_status")
    if resolver != "Resolved" and not (
        rules.accept_lowercase_resolver and resolver == "resolved"
    ):
        return "resolver_status_invalid"
    if configuration.get("engagement_type") != "free_test":
        return "engagement_type_invalid"
    if configuration.get("capability_profile") != "call_gap_capture_handoff_v2":
        return "capability_profile_invalid"
    if configuration.get("coverage_mode") not in COVERAGE_MODES:
        return "coverage_mode_invalid"
    for key in ("client_id", "deployment_id", "configuration_version"):
        if not configuration.get(key, "").strip():
            return f"{key}_invalid"
        lowered = configuration[key].lower()
        if not rules.allow_qa_literal and ("qa_" in lowered or "fixture" in lowered):
            return "qa_literal_invalid"
    if any(configuration.get(key) not in {"true", "false"} for key in BOOLEAN_VARIABLES):
        return "boolean_string_invalid"
    for key in (
        "services_handled_json",
        "unsupported_services_json",
        "service_area_json",
        "urgent_conditions_json",
    ):
        try:
            parsed = json.loads(configuration[key])
        except (KeyError, json.JSONDecodeError):
            return "bounded_json_invalid"
        if not isinstance(parsed, list) or len(configuration[key]) > 2000:
            return "bounded_json_invalid"

    recipient_state = facts.get("notification_recipient_state", "approved_email")
    if recipient_state != "approved_email" and not (
        rules.allow_mobile_notification and recipient_state in {"mobile", "sms"}
    ):
        return "notification_recipient_invalid"

    if facts.get("event_scope", facts.get("client_scope", "client_alpha")) != facts.get(
        "client_scope", "client_alpha"
    ):
        return "cross_client_event"
    if facts.get("configuration_state") == "cross_client_handoff":
        return "cross_client_handoff"

    if configuration.get("handoff_enabled") == "true":
        target_state = facts.get("handoff_target_state", "valid_direct")
        invalid_states = {"missing", "invalid", "voicemail"}
        loop_states = {"assigned_number", "forwarding_main", "failover", "nested_loop"}
        if target_state in invalid_states and not rules.allow_invalid_handoff:
            return "handoff_target_invalid"
        if target_state in loop_states and not rules.allow_route_loop:
            return "handoff_route_loop"
        if not configuration.get("handoff_number") and not rules.allow_invalid_handoff:
            return "handoff_target_missing"
        if (
            configuration.get("handoff_destination_type") != "direct_human"
            and not rules.allow_invalid_handoff
        ):
            return "handoff_target_type_invalid"
    return None


def primary_classification(facts: dict[str, Any], rules: Rules) -> tuple[str, str]:
    safety = facts.get("safety", "safe")
    if safety == "immediate_danger":
        return "unresolved", "immediate_danger"
    if facts.get("consent", "granted") == "withdrawn":
        return "caller_abandoned", "unknown"
    if facts.get("sensitive", "none") == "persistent":
        return "sensitive_data_ended", "unknown"
    if facts.get("language", "supported") != "supported":
        return "unresolved", "unknown"

    intent = facts.get("intent", "new_service")
    if intent in {"spam", "wrong_number", "vendor", "sales"}:
        return "spam", "routine"
    if intent == "job_applicant":
        return "other_general_inquiry", "routine"
    if intent == "existing_customer":
        return "existing_customer", facts.get("urgency", "routine")
    if intent in {"person_request", "general", "unrelated"}:
        return "other_general_inquiry", facts.get("urgency", "routine")
    if intent in {"silence", "abandoned"}:
        return "caller_abandoned", "unknown"

    area = facts.get("area", "in_area")
    service = facts.get("service", "supported")
    if area == "out_of_area":
        return "out_of_area", facts.get("urgency", "routine")
    if area in {"unknown", "ambiguous", "conflicting", "missing"}:
        return "unresolved", facts.get("urgency", "unknown")
    if service == "unsupported":
        return "unsupported_service", facts.get("urgency", "routine")
    if service in {"unknown", "ambiguous", "missing"}:
        return "unresolved", facts.get("urgency", "unknown")

    urgency = facts.get("urgency", "routine")
    outcome = "urgent_potential_job" if urgency == "urgent" else "potential_job"
    if rules.callback_overrides_outcome and facts.get("callback") in {"none", "unknown"}:
        outcome = "unresolved"
    return outcome, urgency


def handoff_reason(outcome: str, facts: dict[str, Any]) -> str:
    if facts.get("intent", "new_service") in NONTRANSFER_INTENTS:
        return "none"
    if facts.get("specific_person", False):
        return "specific_person"
    if outcome == "urgent_potential_job":
        return "urgent"
    if outcome == "existing_customer":
        return "existing_customer"
    return "none"


def _canonical_caller_intent(facts: dict[str, Any]) -> str:
    intent = str(facts.get("intent", "new_service"))
    return "service_request" if intent == "new_service" else intent


def _derived_eligibility(value: Any, eligible: str, ineligible: str) -> str:
    if value == eligible:
        return eligible
    if value == ineligible:
        return ineligible
    return "unknown"


def authoritative_handoff_evidence(
    facts: dict[str, Any],
    configuration: dict[str, str],
    context: dict[str, str],
) -> dict[str, Any]:
    """Build the provider-neutral evidence envelope from authoritative symbolic facts."""
    target_state = facts.get("handoff_target_state", "valid_direct")
    handoff_configured = configuration.get("handoff_enabled") == "true"
    if not handoff_configured:
        destination_validity = "not_configured"
    elif target_state in {"missing", "invalid", "voicemail"}:
        destination_validity = "invalid"
    else:
        destination_validity = "valid"
    destination_validity = str(
        facts.get("authoritative_destination_validity", destination_validity)
    )

    if destination_validity == "valid":
        destination_fingerprint: Any = context["target_fingerprint"]
    else:
        destination_fingerprint = None
    if "authoritative_destination_fingerprint" in facts:
        destination_fingerprint = facts["authoritative_destination_fingerprint"]

    if not handoff_configured:
        loop_proof = "not_required"
    elif target_state in {"assigned_number", "forwarding_main", "failover", "nested_loop"}:
        loop_proof = "failed"
    else:
        loop_proof = "passed"

    return {
        "caller_intent": str(
            facts.get("authoritative_caller_intent", _canonical_caller_intent(facts))
        ),
        "caller_intent_authority": str(
            facts.get(
                "caller_intent_authority",
                HANDOFF_EVIDENCE_AUTHORITIES["caller_intent_authority"],
            )
        ),
        "service_eligibility": str(
            facts.get(
                "authoritative_service_eligibility",
                _derived_eligibility(facts.get("service", "supported"), "supported", "unsupported"),
            )
        ),
        "service_eligibility_authority": str(
            facts.get(
                "service_eligibility_authority",
                HANDOFF_EVIDENCE_AUTHORITIES["service_eligibility_authority"],
            )
        ),
        "area_eligibility": str(
            facts.get(
                "authoritative_area_eligibility",
                _derived_eligibility(facts.get("area", "in_area"), "in_area", "out_of_area"),
            )
        ),
        "area_eligibility_authority": str(
            facts.get(
                "area_eligibility_authority",
                HANDOFF_EVIDENCE_AUTHORITIES["area_eligibility_authority"],
            )
        ),
        "destination_validity": destination_validity,
        "destination_fingerprint": destination_fingerprint,
        "destination_authority": str(
            facts.get(
                "destination_authority",
                HANDOFF_EVIDENCE_AUTHORITIES["destination_authority"],
            )
        ),
        "loop_proof": str(facts.get("authoritative_loop_proof", loop_proof)),
        "loop_proof_authority": str(
            facts.get(
                "loop_proof_authority",
                HANDOFF_EVIDENCE_AUTHORITIES["loop_proof_authority"],
            )
        ),
    }


def handoff_evidence_problem(
    outcome: str,
    reason: str,
    facts: dict[str, Any],
    evidence: dict[str, Any],
    rules: Rules,
) -> str | None:
    if any(
        evidence.get(field) != authority
        for field, authority in HANDOFF_EVIDENCE_AUTHORITIES.items()
    ):
        return "handoff_evidence_untrusted"

    intent = evidence["caller_intent"]
    if intent in NONTRANSFER_INTENTS:
        expected_outcome = "other_general_inquiry" if intent == "job_applicant" else "spam"
        if outcome != expected_outcome or reason != "none":
            return "handoff_classification_inconsistent"
    elif outcome in {
        "potential_job",
        "urgent_potential_job",
        "unsupported_service",
        "out_of_area",
    } and intent != "service_request":
        return "handoff_classification_inconsistent"
    elif outcome == "existing_customer" and intent != "existing_customer":
        return "handoff_classification_inconsistent"
    elif reason == "specific_person" and intent != "person_request":
        return "handoff_classification_inconsistent"

    if (evidence["service_eligibility"] == "unsupported") != (
        outcome == "unsupported_service"
    ):
        return "handoff_service_inconsistent"
    if (evidence["area_eligibility"] == "out_of_area") != (outcome == "out_of_area"):
        return "handoff_area_inconsistent"
    if (
        evidence["destination_validity"] == "valid"
        and not evidence["destination_fingerprint"]
    ):
        return "handoff_destination_fingerprint_missing"
    if evidence["destination_validity"] == "invalid" and not rules.allow_invalid_handoff:
        return "handoff_destination_invalid"
    if evidence["loop_proof"] == "failed" and not rules.allow_route_loop:
        return "handoff_route_loop"
    if facts.get("safety") == "immediate_danger" and reason != "none":
        return "handoff_classification_inconsistent"
    return None


def handoff_offer_allowed(
    outcome: str,
    reason: str,
    configuration: dict[str, str],
    facts: dict[str, Any],
    evidence: dict[str, Any],
    rules: Rules,
) -> bool:
    intent = evidence["caller_intent"]
    if facts.get("safety") == "immediate_danger":
        return False
    if intent in NONTRANSFER_INTENTS and not (rules.vendor_transfer and intent == "vendor"):
        return False
    if rules.vendor_transfer and intent == "vendor":
        return True
    if rules.routine_transfer and outcome == "potential_job":
        return True
    if evidence["service_eligibility"] != "supported":
        return False
    if evidence["area_eligibility"] != "in_area":
        return False
    if configuration.get("handoff_enabled") != "true":
        return False
    if evidence["destination_validity"] != "valid" and not rules.allow_invalid_handoff:
        return False
    if not evidence["destination_fingerprint"] and not rules.allow_invalid_handoff:
        return False
    if evidence["loop_proof"] != "passed" and not rules.allow_route_loop:
        return False
    flag = {
        "urgent": "urgent_handoff_enabled",
        "existing_customer": "existing_customer_handoff_enabled",
        "specific_person": "specific_person_handoff_enabled",
    }.get(reason)
    return flag is not None and configuration.get(flag) == "true"


def reduce_transfer(
    events: list[str], analysis_disposition: str, rules: Rules
) -> str:
    if analysis_disposition not in MODEL_HANDOFF_DISPOSITIONS:
        raise ValueError("model handoff disposition is not allowlisted")
    observed = set(events)
    structured_states: set[str] = set()
    if "transfer_bridged" in observed:
        structured_states.add("Bridged")
    if observed & FAILURE_EVENTS:
        structured_states.add("Failed")
    if "transfer_ended" in observed:
        structured_states.add("Ended")
    if "transfer_cancelled" in observed:
        structured_states.add("Cancelled")
    if "transfer_started" in observed:
        structured_states.add("Started")

    state = next(
        (candidate for candidate in STRUCTURED_EVENT_STATE_PRECEDENCE if candidate in structured_states),
        "Offered",
    )
    if state == "Offered" and any(
        event.startswith("transfer_") for event in observed
    ):
        state = "Unknown"

    if rules.analysis_overrides_bridged and analysis_disposition in {
        "failure_branch",
        "connected",
    }:
        return "Failed" if analysis_disposition == "failure_branch" else "Bridged"
    if state == "Offered" and analysis_disposition == "failure_branch":
        return "Failed"
    return state


def staged_event_trace(
    facts: dict[str, Any],
    initial_state: str,
    notification_required: bool,
    offer_allowed: bool,
    consent: str,
    rules: Rules,
) -> list[dict[str, Any]]:
    """Evaluate symbolic event order instead of reusing only final aggregate facts."""
    sequence = facts.get("event_sequence", [])
    if not isinstance(sequence, list) or not sequence:
        return []
    observed_transfer_events: list[str] = []
    current_state = initial_state
    notification_state: str | None = None
    analysis_available = False
    trace: list[dict[str, Any]] = []
    disposition = str(facts.get("analysis_disposition", "attempted"))

    for event_name_value in sequence:
        event_name = str(event_name_value)
        if event_name.startswith("transfer_"):
            normalized_event = (
                "transfer_failed:unknown" if event_name == "transfer_failed" else event_name
            )
            observed_transfer_events.append(normalized_event)
            if offer_allowed and consent == "accepted":
                current_state = reduce_transfer(
                    observed_transfer_events, disposition, rules
                )
        if event_name in {"call_analyzed", "call_ended"}:
            analysis_available = True
            if offer_allowed and consent == "accepted":
                current_state = reduce_transfer(
                    observed_transfer_events, disposition, rules
                )

        action = "none"
        should_reconcile = analysis_available and event_name != "notification_retry"
        if event_name == "notification_retry" and notification_state is not None:
            should_reconcile = True
        if notification_required and should_reconcile:
            if notification_state is None:
                notification_state = current_state
                action = "inserted"
            else:
                previous_rank = NOTIFICATION_HANDOFF_STATE_PRECEDENCE.index(
                    notification_state
                )
                requested_rank = NOTIFICATION_HANDOFF_STATE_PRECEDENCE.index(
                    current_state
                )
                if requested_rank < previous_rank:
                    notification_state = current_state
                    action = "updated"
                else:
                    action = "unchanged"
        trace.append(
            {
                "event": event_name,
                "handoff_state": current_state,
                "notification_intent_count": 1 if notification_state is not None else 0,
                "notification_handoff_state": notification_state,
                "notification_action": action,
            }
        )
    return trace


def _question_cap(facts: dict[str, Any]) -> bool:
    questions = int(facts.get("question_count", 4))
    if facts.get("safety") == "immediate_danger":
        return questions <= 2
    if facts.get("intent") in {"existing_customer", "person_request"}:
        return questions <= 4
    return questions <= 6


def _configuration_failure(problem: str, facts: dict[str, Any], rules: Rules) -> dict[str, Any]:
    return {
        "configuration_valid": False,
        "configuration_problem": problem,
        "primary_outcome": "configuration_failure",
        "urgency": "unknown",
        "handoff_eligible": False,
        "handoff_reason": "none",
        "handoff_state": "NotApplicable",
        "office_follow_up_required": False,
        "notification_required": False,
        "notification_count": 0,
        "notification_delivery_claimed": False,
        "notification_provider_calls": 0,
        "terminal_path": "configuration_unavailable",
        "caller_data_collected": rules.collect_on_configuration_failure,
        "retained_sensitive_fields": 0,
        "isolation_preserved": True,
        "question_cap_passed": True,
        "context_scope": None,
        "company_marker": None,
        "service_marker": None,
        "area_marker": None,
        "urgent_marker": None,
        "target_fingerprint": None,
        "recipient_fingerprint": None,
        "reporting_partition": None,
        "event_sequence_trace": [],
    }


def evaluate(facts: dict[str, Any], rules: Rules = DEFAULT_RULES) -> dict[str, Any]:
    configuration = build_configuration(facts)
    problem = configuration_problem(configuration, facts, rules)
    if problem is not None:
        return _configuration_failure(problem, facts, rules)
    if str(facts.get("analysis_disposition", "attempted")) not in MODEL_HANDOFF_DISPOSITIONS:
        return _configuration_failure("model_handoff_disposition_invalid", facts, rules)

    test_state = facts.get("test_state", "Live")
    existing_binding = bool(facts.get("existing_call_binding", False))
    if test_state != "Live" and not existing_binding:
        result = _configuration_failure("route_not_live", facts, rules)
        result["terminal_path"] = "inbound_rejected"
        return result
    if facts.get("limit_state", "within") in {"expired", "at_limit", "past_limit"} and not existing_binding:
        result = _configuration_failure("test_limit_reached", facts, rules)
        result["terminal_path"] = "inbound_rejected"
        return result

    outcome, urgency = primary_classification(facts, rules)
    context = resolve_client_context(facts)
    if context is None:
        return _configuration_failure("client_context_unresolved", facts, rules)
    reason = handoff_reason(outcome, facts)
    evidence = authoritative_handoff_evidence(facts, configuration, context)
    evidence_problem = handoff_evidence_problem(outcome, reason, facts, evidence, rules)
    if evidence_problem is not None:
        return _configuration_failure(evidence_problem, facts, rules)
    offer_allowed = handoff_offer_allowed(
        outcome, reason, configuration, facts, evidence, rules
    )
    consent = facts.get("transfer_consent", "not_offered")
    if reason == "none":
        state = "NotApplicable"
    elif not offer_allowed:
        state = "NotConfigured"
    elif consent == "declined":
        state = "Declined"
    elif consent == "accepted":
        state = reduce_transfer(
            list(facts.get("transfer_events", [])),
            str(facts.get("analysis_disposition", "attempted")),
            rules,
        )
    else:
        state = "Offered"

    office_follow_up = outcome in ACTIONABLE_OUTCOMES
    if outcome == "other_general_inquiry":
        office_follow_up = bool(facts.get("office_follow_up", False)) or (
            facts.get("intent") == "person_request"
            and bool(facts.get("specific_person", False))
        )
    if outcome == "unresolved":
        office_follow_up = bool(facts.get("safe_follow_up", False))
    if facts.get("safety") == "immediate_danger":
        office_follow_up = False

    notification_required = office_follow_up
    if rules.suppress_routine_notification and outcome == "potential_job":
        notification_required = False
    notification_count = 1 if notification_required else 0
    if rules.duplicate_notification and facts.get("notification_replay") and notification_required:
        notification_count = 2
    if reason == "none":
        staged_initial_state = "NotApplicable"
    elif not offer_allowed:
        staged_initial_state = "NotConfigured"
    elif consent == "declined":
        staged_initial_state = "Declined"
    else:
        staged_initial_state = "Offered"
    event_sequence_trace = staged_event_trace(
        facts,
        staged_initial_state,
        notification_required,
        offer_allowed,
        str(consent),
        rules,
    )

    if facts.get("safety") == "immediate_danger":
        terminal = "immediate_danger"
    elif outcome == "sensitive_data_ended":
        terminal = "sensitive_data_end"
    elif state == "Bridged":
        terminal = "transfer_bridged"
    elif state == "Started":
        terminal = "handoff_attempt"
    elif state in {"Failed", "Cancelled", "Ended", "Unknown"} and consent == "accepted":
        terminal = (
            "transfer_failure_close"
            if rules.transfer_failure_truthful
            else "handoff_incomplete_disconnect"
        )
    elif state == "Declined":
        terminal = "actionable_close"
    elif notification_required:
        terminal = "actionable_close"
    else:
        terminal = "nonactionable_close"

    retained_sensitive_fields = 0
    if rules.retain_sensitive_data and facts.get("sensitive") == "persistent":
        retained_sensitive_fields = 1

    return {
        "configuration_valid": True,
        "configuration_problem": None,
        "primary_outcome": outcome,
        "urgency": urgency,
        "handoff_eligible": offer_allowed,
        "handoff_reason": reason,
        "handoff_state": state,
        "office_follow_up_required": office_follow_up,
        "notification_required": notification_required,
        "notification_count": notification_count,
        "notification_delivery_claimed": bool(
            rules.claim_notification_delivery and notification_required
        ),
        "notification_provider_calls": 0,
        "terminal_path": terminal,
        "caller_data_collected": (
            facts.get("safety") != "immediate_danger"
            and facts.get("consent", "granted") != "withdrawn"
        ),
        "retained_sensitive_fields": retained_sensitive_fields,
        "isolation_preserved": True,
        "question_cap_passed": _question_cap(facts),
        "event_sequence_trace": event_sequence_trace,
        "context_scope": facts.get("client_scope", "client_alpha"),
        **context,
    }


MUTATIONS: dict[str, Rules] = {
    "remove_transfer_failure_close": dataclasses.replace(
        DEFAULT_RULES, transfer_failure_truthful=False
    ),
    "transfer_routine_calls": dataclasses.replace(DEFAULT_RULES, routine_transfer=True),
    "transfer_vendors": dataclasses.replace(DEFAULT_RULES, vendor_transfer=True),
    "allow_invalid_handoff": dataclasses.replace(
        DEFAULT_RULES, allow_invalid_handoff=True
    ),
    "allow_route_loop": dataclasses.replace(DEFAULT_RULES, allow_route_loop=True),
    "accept_lowercase_resolver": dataclasses.replace(
        DEFAULT_RULES, accept_lowercase_resolver=True
    ),
    "restore_qa_literal": dataclasses.replace(DEFAULT_RULES, allow_qa_literal=True),
    "allow_undeclared_variable": dataclasses.replace(
        DEFAULT_RULES, allow_extra_variable=True
    ),
    "callback_overrides_outcome": dataclasses.replace(
        DEFAULT_RULES, callback_overrides_outcome=True
    ),
    "suppress_routine_notification": dataclasses.replace(
        DEFAULT_RULES, suppress_routine_notification=True
    ),
    "duplicate_notification": dataclasses.replace(
        DEFAULT_RULES, duplicate_notification=True
    ),
    "analysis_overrides_bridged": dataclasses.replace(
        DEFAULT_RULES, analysis_overrides_bridged=True
    ),
    "claim_notification_delivery": dataclasses.replace(
        DEFAULT_RULES, claim_notification_delivery=True
    ),
    "collect_on_configuration_failure": dataclasses.replace(
        DEFAULT_RULES, collect_on_configuration_failure=True
    ),
    "allow_mobile_or_sms_notification": dataclasses.replace(
        DEFAULT_RULES, allow_mobile_notification=True
    ),
    "retain_sensitive_data": dataclasses.replace(
        DEFAULT_RULES, retain_sensitive_data=True
    ),
}


def scenario_failures(scenarios: list[dict[str, Any]], rules: Rules = DEFAULT_RULES) -> list[str]:
    failures: list[str] = []
    for scenario in scenarios:
        result = evaluate(dict(scenario["inputs"]), rules)
        for key, expected in scenario["expected"].items():
            if result.get(key) != expected:
                failures.append(f"{scenario['id']}:{key}")
    return failures


def mutation_report(scenarios: list[dict[str, Any]]) -> dict[str, Any]:
    killed: list[str] = []
    survived: list[str] = []
    for name, rules in MUTATIONS.items():
        if scenario_failures(scenarios, rules):
            killed.append(name)
        else:
            survived.append(name)
    total = len(MUTATIONS)
    return {
        "total": total,
        "killed": len(killed),
        "survived": survived,
        "critical_kill_rate": len(killed) / total if total else 0.0,
        "overall_kill_rate": len(killed) / total if total else 0.0,
    }
