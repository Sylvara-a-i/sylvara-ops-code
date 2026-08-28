"""Validate private external evidence before a manual CRM Blueprint transition.

The validators are deliberately read-only. They accept independently read-back
private state, recompute every deterministic binding, and return a small
sanitized result. They never call CRM, Catalyst, Billing, or a route provider,
and error messages never include supplied values.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


INTERNAL_APPROVAL = "internal-approval-receipt-v1"
ROUTE_ACTIVATION = "route-activation-readback-v1"
TERMINAL_REPORT = "terminal-report-summary-readback-v2"
ROUTE_INACTIVE = "route-inactive-readback-v1"
BILLING_RECONCILIATION = "billing-closed-won-reconciliation-v1"

_HASH = re.compile(r"^[a-f0-9]{64}$")
_SOURCE_REVISION = re.compile(r"^[a-f0-9]{40}$")
_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
_CRM_TIMESTAMP = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$"
)
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_RECORD_ID = re.compile(r"^[1-9][0-9]{7,29}$")
_OPAQUE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
_REPORT_OPAQUE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$")
_BILLING_DEPLOYMENT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$")
_BILLING_CONFIGURATION_VERSION = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$"
)
_APPROVAL_EVENT = re.compile(r"^approval_[a-f0-9]{64}$")
_ACTIVATION_EVENT = re.compile(r"^activation_[a-f0-9]{64}$")
_OPERATOR_HASH = re.compile(r"^operator_[a-f0-9]{64}$")
_ROUTE_FINGERPRINT = re.compile(r"^route_[a-f0-9]{64}$")
_ROUTE_READBACK = re.compile(r"^readback_[a-f0-9]{64}$")
_SIGNATURE = re.compile(r"^v1=([a-f0-9]{64})$")
_ACCEPTANCE_VERSION = re.compile(r"^terms-v1:[a-f0-9]{64}$")
_DOMAIN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
_CLOCK_SKEW_MILLISECONDS = 30_000
_MAX_SAFE_INTEGER = 9_007_199_254_740_991

_APPROVAL_INTENT_FIELDS = (
    "schema_version",
    "event_id",
    "action",
    "deal_id",
    "deployment_id",
    "configuration_version_id",
    "route_fingerprint",
    "evidence_revision",
    "evidence_observed_at",
    "requested_at",
    "operator_id_hash",
    "expected_deployment_version",
)
_ACTIVATION_INTENT_FIELDS = (
    "schema_version",
    "event_id",
    "action",
    "deal_id",
    "deployment_id",
    "configuration_version_id",
    "approval_event_key",
    "route_fingerprint",
    "route_readback_fingerprint",
    "route_observed_at",
    "evidence_revision",
    "evidence_observed_at",
    "requested_at",
    "operator_id_hash",
    "expected_deployment_version",
)
_CONSUMPTION_FIELDS = (
    "contract_id",
    "status",
    "evidence_receipt",
    "unique_scope",
    "consumption_count",
    "consumed_at",
    "readback_at",
    "replay_detected",
)
_PRIOR_CONSUMPTION_FIELDS = (
    "contract_id",
    "status",
    "evidence_receipt",
    "unique_scope",
    "consumption_count",
    "consumed_at",
    "readback_at",
    "replay_detected",
)
_PRIOR_APPROVAL_SCOPE_FIELDS = (
    "environment",
    "deal_binding_digest",
    "approval_event_binding_digest",
    "evidence_nonce_digest",
)
_APPROVAL_PRESTATE_FIELDS = (
    "Deployment_Record_ID",
    "Configuration_Version",
    "Test_Status",
    "Test_Start_At",
    "Test_End_At",
)
_APPROVAL_OPERATOR_INPUT_FIELDS = (
    "Approved_Deployment_Record_ID",
    "Approved_Configuration_Version",
    "Go_Live_Approval_Status",
    "Go_Live_Approved_At",
)
_ACTIVATION_CRM_FIELDS = (
    "Deployment_Record_ID",
    "Configuration_Version",
    "Approved_Deployment_Record_ID",
    "Approved_Configuration_Version",
    "Go_Live_Approval_Status",
    "Go_Live_Approved_At",
    "Test_Status",
    "Test_Start_At",
    "Test_End_At",
)
_TERMINAL_OPERATION_FIELDS = (
    "OPERATION_KEY",
    "OPERATION_FINGERPRINT",
    "ACTION",
    "CRM_DEAL_ID",
    "STATUS",
    "SOURCE_REVISION",
    "SOURCE_ENVIRONMENT",
    "LAST_OUTCOME",
    "OPERATION_PAYLOAD_JSON",
    "OPERATION_VERSION",
    "CREATED_AT",
    "UPDATED_AT",
)
_BILLING_OPERATION_FIELDS = (
    "OPERATION_KEY",
    "OPERATION_FINGERPRINT",
    "ACTION",
    "CRM_DEAL_ID",
    "STATUS",
    "SOURCE_REVISION",
    "SOURCE_ENVIRONMENT",
    "LAST_OUTCOME",
    "OPERATION_VERSION",
    "CREATED_AT",
    "UPDATED_AT",
)
_BILLING_READBACK_FIELDS = (
    "customer_id",
    "customer_crm_reference",
    "subscription_id",
    "subscription_reference",
    "plan_code",
    "billing_organization_id",
    "currency",
    "recurring_minor",
    "setup_minor",
    "usage_addon_product_id",
    "usage_addon_code",
    "usage_addon_unit",
    "usage_rate_minor",
    "subscription_start_date",
    "provider_subscription_status",
    "crm_subscription_status",
    "observed_at",
)
_BILLING_RECONCILIATION_RECEIPT_FIELDS = (
    "schema_version",
    "evidence_type",
    "environment",
    "request_action",
    "created_resource_count",
    "operation",
    "crm_readback",
    "billing_readback",
    "observed_at",
)
_SUMMARY_FIELDS = (
    "schemaVersion",
    "dealId",
    "deploymentId",
    "configurationVersion",
    "reportSchemaVersion",
    "callSetDigest",
    "testStatus",
    "testStartAt",
    "testEndAt",
    "testEndReason",
    "callTotalsReconciled",
    "callsCaptured",
    "qualifiedOpportunities",
    "existingCustomerCalls",
    "actualAverageCallDurationSeconds",
    "outOfAreaOrWrongFitCalls",
    "urgentRequests",
    "bookableOpportunities",
    "officeFollowUpCalls",
    "observedWorkflowFailures",
    "recommendedPaidCoverage",
    "expectedMonthlyConnectedMinutesMin",
    "expectedMonthlyConnectedMinutesMax",
    "dataConfidenceNotes",
)
_REPORT_DOMAINS = {
    1: "sylvara.crm-report-summary.v1",
    2: "sylvara.crm-report-summary.v2",
}
_END_REASONS = frozenset(
    {
        "Seven-Day Limit Reached",
        "Call Limit Reached",
        "Client Requested Stop",
        "Sylvara Stopped",
        "Technical Failure",
        "Converted Early",
        "Other",
    }
)
_PAID_COVERAGE = frozenset(
    {"After Hours Only", "No Answer / Overflow Only", "After Hours + Overflow"}
)
_PLAN_BY_CRM_API_VALUE = {
    "Option 1": "Launch",
    "Option 2": "Growth",
    "Pro": "Scale",
}
_PLAN_FREQUENCY_KEYS = (
    "Launch::Monthly",
    "Growth::Monthly",
    "Scale::Monthly",
)


class EvidenceValidationError(ValueError):
    """A sanitized, stable failure raised by a fail-closed evidence validator."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True, slots=True)
class ValidationResult:
    """Sanitized proof that one contract passed without performing a mutation."""

    contract_id: str
    evidence_type: str
    observed_at: str
    one_time_consumption_readback_validated: bool
    one_time_consumption_runtime_enforced: bool = False
    mutation_performed: bool = False


def _fail(code: str) -> None:
    raise EvidenceValidationError(code)


def _require(condition: bool, code: str) -> None:
    if not condition:
        _fail(code)


def _mapping(value: Any, code: str) -> Mapping[str, Any]:
    _require(isinstance(value, Mapping), code)
    return value


def _exact_mapping(
    value: Any,
    fields: Sequence[str],
    code: str,
) -> Mapping[str, Any]:
    selected = _mapping(value, code)
    _require(set(selected) == set(fields), code)
    return selected


def _integer(value: Any, minimum: int, code: str) -> int:
    _require(
        isinstance(value, int)
        and not isinstance(value, bool)
        and minimum <= value <= _MAX_SAFE_INTEGER,
        code,
    )
    return value


def _string(value: Any, pattern: re.Pattern[str], code: str) -> str:
    _require(
        isinstance(value, str)
        and not re.search(r"[\ud800-\udfff]", value)
        and bool(pattern.fullmatch(value)),
        code,
    )
    return value


def _private_string(value: Any, code: str, maximum: int = 256) -> str:
    _require(
        isinstance(value, str)
        and 0 < len(value) <= maximum
        and not re.search(r"[\ud800-\udfff]", value)
        and not re.search(r"[\x00-\x1f\x7f]", value),
        code,
    )
    return value


def _timestamp(value: Any, code: str) -> int:
    selected = _string(value, _TIMESTAMP, code)
    try:
        parsed = datetime.strptime(selected, "%Y-%m-%dT%H:%M:%S.%fZ").replace(
            tzinfo=timezone.utc
        )
    except ValueError:
        _fail(code)
    _require(parsed.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z" == selected, code)
    return int(parsed.timestamp() * 1000)


def _crm_timestamp(value: Any, code: str) -> int:
    """Normalize a Zoho datetime while evidence timestamps stay strict millisecond UTC."""

    selected = _string(value, _CRM_TIMESTAMP, code)
    try:
        parsed = datetime.fromisoformat(selected.replace("Z", "+00:00"))
    except ValueError:
        _fail(code)
    _require(parsed.tzinfo is not None, code)
    return int(parsed.astimezone(timezone.utc).timestamp() * 1000)


def _normalized_crm_timestamp(value: Any, code: str) -> tuple[int, str]:
    """Return one CRM datetime instant and its canonical UTC millisecond form."""

    milliseconds = _crm_timestamp(value, code)
    normalized = datetime.fromtimestamp(
        milliseconds / 1000, tz=timezone.utc
    ).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    return milliseconds, normalized


def _calendar_date(value: Any, code: str) -> str:
    selected = _string(value, _DATE, code)
    try:
        parsed = datetime.strptime(selected, "%Y-%m-%d")
    except ValueError:
        _fail(code)
    _require(parsed.strftime("%Y-%m-%d") == selected, code)
    return selected


def _canonical_json(value: Any) -> str:
    try:
        rendered = json.dumps(
            value, ensure_ascii=False, separators=(",", ":"), sort_keys=False
        )
        rendered.encode("utf-8")
        return rendered
    except (TypeError, UnicodeEncodeError, ValueError):
        _fail("evidence_canonicalization_invalid")


def _same_json_value(left: Any, right: Any) -> bool:
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left is right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return (
            (not isinstance(left, float) or math.isfinite(left))
            and (not isinstance(right, float) or math.isfinite(right))
            and left == right
        )
    if type(left) is not type(right):
        return False
    if isinstance(left, list):
        return len(left) == len(right) and all(
            _same_json_value(left_item, right_item)
            for left_item, right_item in zip(left, right)
        )
    if isinstance(left, Mapping):
        return tuple(left) == tuple(right) and all(
            _same_json_value(left[key], right[key]) for key in left
        )
    return left == right


def _secret(value: Any, code: str) -> bytes:
    if isinstance(value, str):
        try:
            selected = value.encode("utf-8")
        except UnicodeEncodeError:
            _fail(code)
    elif isinstance(value, bytes):
        selected = value
    else:
        _fail(code)
    _require(len(selected) >= 32, code)
    return selected


def _hmac_hex(secret: bytes, domain: str, material: str) -> str:
    _string(domain, _DOMAIN, "evidence_domain_invalid")
    return hmac.new(secret, f"{domain}\0{material}".encode("utf-8"), hashlib.sha256).hexdigest()


def derive_binding_digest(secret: str | bytes, domain: str, value: Any) -> str:
    """Create the domain-separated digest used for a private binding claim."""

    return _hmac_hex(
        _secret(secret, "evidence_secret_invalid"),
        domain,
        _canonical_json(value),
    )


def derive_receipt_digest(
    secret: str | bytes,
    domain: str,
    evidence: Mapping[str, Any],
    binding_fields: Sequence[str],
) -> str:
    """Create an evidence receipt over an ordered ``[field, value]`` tuple."""

    selected = _mapping(evidence, "evidence_invalid")
    _require(all(field in selected for field in binding_fields), "evidence_invalid")
    canonical = [[field, selected[field]] for field in binding_fields]
    return _hmac_hex(
        _secret(secret, "evidence_secret_invalid"), domain, _canonical_json(canonical)
    )


def billing_reconciliation_receipt(
    evidence: Mapping[str, Any], secret: str | bytes
) -> str:
    """Authenticate a normalized, non-creating Billing reconciliation readback."""

    selected = _exact_mapping(
        evidence,
        (*_BILLING_RECONCILIATION_RECEIPT_FIELDS, "reconciliation_receipt"),
        "billing_reconciliation_receipt_invalid",
    )
    operation = _exact_mapping(
        selected["operation"],
        _BILLING_OPERATION_FIELDS,
        "billing_reconciliation_receipt_invalid",
    )
    crm_fields = tuple(
        _contract()[BILLING_RECONCILIATION]["exact_crm_readback_fields"]
    )
    crm = _exact_mapping(
        selected["crm_readback"], crm_fields, "billing_reconciliation_receipt_invalid"
    )
    billing = _exact_mapping(
        selected["billing_readback"],
        _BILLING_READBACK_FIELDS,
        "billing_reconciliation_receipt_invalid",
    )
    normalized_crm = {field: crm[field] for field in crm_fields}
    for field in ("Monthly_Recurring_Revenue", "Setup_Fee"):
        normalized_crm[field] = _money_minor(crm[field])
    normalized_crm["Account_Name"] = _string(
        crm["Account_Name"], _RECORD_ID, "billing_reconciliation_receipt_invalid"
    )
    _, normalized_crm["Results_Review_At"] = _normalized_crm_timestamp(
        crm["Results_Review_At"], "billing_reconciliation_receipt_invalid"
    )
    normalized = {
        **selected,
        "operation": {field: operation[field] for field in _BILLING_OPERATION_FIELDS},
        "crm_readback": normalized_crm,
        "billing_readback": {field: billing[field] for field in _BILLING_READBACK_FIELDS},
    }
    return derive_receipt_digest(
        secret,
        "sylvara.crm.billing-closed-won-reconciliation.v1",
        normalized,
        _BILLING_RECONCILIATION_RECEIPT_FIELDS,
    )


def _constant_time_equal(left: Any, right: str, code: str) -> None:
    _require(
        isinstance(left, str)
        and _HASH.fullmatch(left) is not None
        and _HASH.fullmatch(right) is not None
        and hmac.compare_digest(left, right),
        code,
    )


def _contract() -> Mapping[str, Any]:
    path = Path(__file__).resolve().parents[1] / "config" / "automation-contract.json"
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
        contracts = loaded["blueprint"]["external_evidence_contracts"]
    except (OSError, json.JSONDecodeError, KeyError, TypeError):
        _fail("external_evidence_contract_unavailable")
    _require(isinstance(contracts, Mapping), "external_evidence_contract_unavailable")
    return contracts


def _contract_fields(contract_id: str) -> tuple[str, ...]:
    selected = _contract().get(contract_id)
    _require(isinstance(selected, Mapping), "external_evidence_contract_unknown")
    crypto = selected.get("cryptographic_boundary") or selected.get("keyed_binding")
    _require(isinstance(crypto, Mapping), "external_evidence_contract_invalid")
    fields = crypto.get("canonical_binding_fields")
    _require(
        isinstance(fields, list)
        and fields
        and all(isinstance(field, str) for field in fields),
        "external_evidence_contract_invalid",
    )
    return tuple(fields)


def _receipt_domain(contract_id: str) -> str:
    selected = _contract().get(contract_id)
    crypto = selected.get("cryptographic_boundary") or selected.get("keyed_binding")
    return _string(crypto.get("receipt_domain"), _DOMAIN, "external_evidence_contract_invalid")


def _binding(
    evidence: Mapping[str, Any],
    path: str,
    secret: bytes,
    domain: str,
    value: Any,
    code: str,
) -> None:
    expected = derive_binding_digest(secret, domain, value)
    _constant_time_equal(evidence.get(path), expected, code)


def _verify_receipt(
    contract_id: str,
    evidence: Mapping[str, Any],
    secret: bytes,
) -> None:
    fields = _contract_fields(contract_id)
    _exact_mapping(evidence, (*fields, "evidence_receipt"), "evidence_shape_invalid")
    expected = derive_receipt_digest(secret, _receipt_domain(contract_id), evidence, fields)
    _constant_time_equal(evidence.get("evidence_receipt"), expected, "evidence_receipt_invalid")


def _verify_freshness(
    observed_at: Any,
    transition_at: Any,
    maximum_age_seconds: int,
    code: str,
) -> tuple[int, int]:
    observed_ms = _timestamp(observed_at, code)
    transition_ms = _timestamp(transition_at, "transition_timestamp_invalid")
    _require(
        observed_ms <= transition_ms + _CLOCK_SKEW_MILLISECONDS
        and transition_ms - observed_ms <= maximum_age_seconds * 1000,
        code,
    )
    return observed_ms, transition_ms


def _verify_consumption(
    contract_id: str,
    evidence: Mapping[str, Any],
    consumption: Any,
    transition_at: str,
    unique_scope_fields: Sequence[str],
) -> None:
    selected = _exact_mapping(consumption, _CONSUMPTION_FIELDS, "consumption_readback_invalid")
    scope = _exact_mapping(
        selected["unique_scope"], unique_scope_fields, "consumption_readback_invalid"
    )
    _require(
        selected["contract_id"] == contract_id
        and selected["status"] == "consumed"
        and _integer(
            selected["consumption_count"], 1, "consumption_readback_invalid"
        )
        == 1
        and selected["replay_detected"] is False
        and hmac.compare_digest(
            str(selected["evidence_receipt"]), str(evidence["evidence_receipt"])
        )
        and all(scope[field] == evidence[field] for field in unique_scope_fields),
        "consumption_readback_invalid",
    )
    observed_ms = _timestamp(evidence["observed_at"], "consumption_readback_invalid")
    consumed_ms = _timestamp(selected["consumed_at"], "consumption_readback_invalid")
    readback_ms = _timestamp(selected["readback_at"], "consumption_readback_invalid")
    transition_ms = _timestamp(transition_at, "transition_timestamp_invalid")
    _require(
        observed_ms <= consumed_ms <= readback_ms <= transition_ms + _CLOCK_SKEW_MILLISECONDS,
        "consumption_readback_invalid",
    )


def _verify_prior_approval_consumption(
    readback: Any,
    evidence_secret: bytes,
    deal_id: str,
    evidence_receipt: str,
    approval_event_key: str,
    activation_requested_at: str,
) -> None:
    selected = _exact_mapping(
        readback, _PRIOR_CONSUMPTION_FIELDS, "activation_chain_invalid"
    )
    scope = _exact_mapping(
        selected["unique_scope"],
        _PRIOR_APPROVAL_SCOPE_FIELDS,
        "activation_chain_invalid",
    )
    _require(
        selected["contract_id"] == INTERNAL_APPROVAL
        and selected["status"] == "consumed"
        and selected["evidence_receipt"] == evidence_receipt
        and scope["environment"] == "Development"
        and _integer(selected["consumption_count"], 1, "activation_chain_invalid") == 1
        and selected["replay_detected"] is False,
        "activation_chain_invalid",
    )
    # A consumed approval for one Deal must never authorize another Deal's route.
    # Recompute the private durable-scope digests instead of trusting a raw ID.
    _constant_time_equal(
        scope["deal_binding_digest"],
        derive_binding_digest(
            evidence_secret,
            "sylvara.crm.internal-approval-receipt.v1.deal",
            deal_id,
        ),
        "activation_chain_invalid",
    )
    _constant_time_equal(
        scope["approval_event_binding_digest"],
        derive_binding_digest(
            evidence_secret,
            "sylvara.crm.internal-approval-receipt.v1.approval-event",
            approval_event_key,
        ),
        "activation_chain_invalid",
    )
    _string(scope["evidence_nonce_digest"], _HASH, "activation_chain_invalid")
    consumed_ms = _timestamp(selected["consumed_at"], "activation_chain_invalid")
    readback_ms = _timestamp(selected["readback_at"], "activation_chain_invalid")
    requested_ms = _timestamp(activation_requested_at, "activation_chain_invalid")
    _require(consumed_ms <= readback_ms <= requested_ms, "activation_chain_invalid")


def _canonical_intent(intent: Any, fields: Sequence[str], code: str) -> Mapping[str, Any]:
    selected = _exact_mapping(intent, fields, code)
    return selected


def approval_intent_signature(intent: Mapping[str, Any], secret: str | bytes) -> str:
    """Sign an approval intent exactly as the Development call gateway does."""

    selected = _canonical_intent(intent, _APPROVAL_INTENT_FIELDS, "approval_intent_invalid")
    material = _canonical_json({field: selected[field] for field in _APPROVAL_INTENT_FIELDS})
    digest = hmac.new(
        _secret(secret, "operator_verification_secret_invalid"),
        f"revenue-desk-approval-intent-v1\0{material}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"v1={digest}"


def activation_intent_signature(intent: Mapping[str, Any], secret: str | bytes) -> str:
    """Sign an activation intent exactly as the Development call gateway does."""

    selected = _canonical_intent(intent, _ACTIVATION_INTENT_FIELDS, "activation_intent_invalid")
    material = _canonical_json({field: selected[field] for field in _ACTIVATION_INTENT_FIELDS})
    digest = hmac.new(
        _secret(secret, "operator_verification_secret_invalid"),
        f"revenue-desk-activation-intent-v1\0{material}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"v1={digest}"


def _verify_signature(actual: Any, expected: str, code: str) -> str:
    selected = _string(actual, _SIGNATURE, code)
    _require(hmac.compare_digest(selected, expected), code)
    return selected


def _validate_approval_intent(intent: Any) -> Mapping[str, Any]:
    selected = _canonical_intent(intent, _APPROVAL_INTENT_FIELDS, "approval_intent_invalid")
    _require(
        _integer(selected["schema_version"], 1, "approval_intent_invalid") == 1
        and selected["action"] == "approve",
        "approval_intent_invalid",
    )
    _string(selected["event_id"], _APPROVAL_EVENT, "approval_intent_invalid")
    _string(selected["deal_id"], _RECORD_ID, "approval_intent_invalid")
    _string(selected["deployment_id"], _OPAQUE_ID, "approval_intent_invalid")
    _string(selected["configuration_version_id"], _OPAQUE_ID, "approval_intent_invalid")
    _string(selected["route_fingerprint"], _ROUTE_FINGERPRINT, "approval_intent_invalid")
    _string(selected["evidence_revision"], _SOURCE_REVISION, "approval_intent_invalid")
    _timestamp(selected["evidence_observed_at"], "approval_intent_invalid")
    _timestamp(selected["requested_at"], "approval_intent_invalid")
    _string(selected["operator_id_hash"], _OPERATOR_HASH, "approval_intent_invalid")
    _integer(selected["expected_deployment_version"], 0, "approval_intent_invalid")
    return selected


def _validate_activation_intent(intent: Any) -> Mapping[str, Any]:
    selected = _canonical_intent(intent, _ACTIVATION_INTENT_FIELDS, "activation_intent_invalid")
    _require(
        _integer(selected["schema_version"], 1, "activation_intent_invalid") == 1
        and selected["action"] == "activate",
        "activation_intent_invalid",
    )
    _string(selected["event_id"], _ACTIVATION_EVENT, "activation_intent_invalid")
    _string(selected["deal_id"], _RECORD_ID, "activation_intent_invalid")
    _string(selected["deployment_id"], _OPAQUE_ID, "activation_intent_invalid")
    _string(selected["configuration_version_id"], _OPAQUE_ID, "activation_intent_invalid")
    _string(selected["approval_event_key"], _APPROVAL_EVENT, "activation_intent_invalid")
    _string(selected["route_fingerprint"], _ROUTE_FINGERPRINT, "activation_intent_invalid")
    _string(selected["route_readback_fingerprint"], _ROUTE_READBACK, "activation_intent_invalid")
    _timestamp(selected["route_observed_at"], "activation_intent_invalid")
    _string(selected["evidence_revision"], _SOURCE_REVISION, "activation_intent_invalid")
    _timestamp(selected["evidence_observed_at"], "activation_intent_invalid")
    _timestamp(selected["requested_at"], "activation_intent_invalid")
    _string(selected["operator_id_hash"], _OPERATOR_HASH, "activation_intent_invalid")
    _integer(selected["expected_deployment_version"], 0, "activation_intent_invalid")
    return selected


def _validate_internal_approval(
    evidence: Mapping[str, Any],
    context: Mapping[str, Any],
    secrets: Mapping[str, Any],
    transition_at: str,
) -> ValidationResult:
    context = _exact_mapping(
        context,
        (
            "deal_id",
            "route_fingerprint",
            "source_revision",
            "authoritative_current_deployment_version",
            "approval_intent",
            "approval_intent_signature",
            "approval_receipt_hash",
            "crm_prestate",
            "operator_input",
            "consumption",
        ),
        "approval_context_invalid",
    )
    secrets = _exact_mapping(
        secrets,
        ("evidence_secret", "operator_verification_secret"),
        "approval_secret_set_invalid",
    )
    evidence_secret = _secret(secrets["evidence_secret"], "evidence_secret_invalid")
    operator_secret = _secret(
        secrets["operator_verification_secret"], "operator_verification_secret_invalid"
    )
    _require(
        not hmac.compare_digest(evidence_secret, operator_secret),
        "approval_secret_independence_invalid",
    )
    intent = _validate_approval_intent(context["approval_intent"])
    crm_prestate = _exact_mapping(
        context["crm_prestate"],
        _APPROVAL_PRESTATE_FIELDS,
        "approval_crm_prestate_invalid",
    )
    operator_input = _exact_mapping(
        context["operator_input"],
        _APPROVAL_OPERATOR_INPUT_FIELDS,
        "approval_operator_input_invalid",
    )

    deal_id = _string(context["deal_id"], _RECORD_ID, "approval_context_invalid")
    route_fingerprint = _string(
        context["route_fingerprint"], _ROUTE_FINGERPRINT, "approval_context_invalid"
    )
    source_revision = _string(
        context["source_revision"], _SOURCE_REVISION, "approval_context_invalid"
    )
    signature = _verify_signature(
        context["approval_intent_signature"],
        approval_intent_signature(intent, operator_secret),
        "approval_intent_signature_invalid",
    )
    receipt_hash = _string(
        context["approval_receipt_hash"], _HASH, "approval_receipt_hash_invalid"
    )
    authoritative_current_version = _integer(
        context["authoritative_current_deployment_version"],
        1,
        "approval_context_invalid",
    )
    _require(
        intent["deal_id"] == deal_id
        and intent["deployment_id"] == crm_prestate["Deployment_Record_ID"]
        and intent["configuration_version_id"] == crm_prestate["Configuration_Version"]
        and intent["route_fingerprint"] == route_fingerprint
        and intent["evidence_revision"] == source_revision
        and authoritative_current_version
        == intent["expected_deployment_version"] + 1,
        "approval_current_binding_invalid",
    )
    _require(
        crm_prestate["Test_Status"] == "Setup Pending"
        and crm_prestate["Test_Start_At"] is None
        and crm_prestate["Test_End_At"] is None
        and operator_input["Approved_Deployment_Record_ID"]
        == crm_prestate["Deployment_Record_ID"]
        and operator_input["Approved_Configuration_Version"]
        == crm_prestate["Configuration_Version"]
        and operator_input["Go_Live_Approval_Status"] == "Approved",
        "approval_operator_input_invalid",
    )

    _verify_receipt(INTERNAL_APPROVAL, evidence, evidence_secret)
    _require(
        _integer(evidence["schema_version"], 1, "approval_claim_invalid") == 1
        and evidence["evidence_type"] == "internal_approval_receipt"
        and evidence["environment"] == "Development"
        and evidence["approval_intent_signature_valid"] is True
        and evidence["approval_decision"] == "Approved"
        and evidence["runtime_test_status"] == "Scheduled"
        and evidence["activation_event_absent"] is True
        and evidence["actual_start_at"] is None
        and evidence["expires_at"] is None,
        "approval_claim_invalid",
    )
    _binding(
        evidence,
        "deal_binding_digest",
        evidence_secret,
        "sylvara.crm.internal-approval-receipt.v1.deal",
        deal_id,
        "approval_deal_binding_invalid",
    )
    for path, domain, value in (
        (
            "deployment_binding_digest",
            "sylvara.crm.internal-approval-receipt.v1.deployment",
            crm_prestate["Deployment_Record_ID"],
        ),
        (
            "configuration_binding_digest",
            "sylvara.crm.internal-approval-receipt.v1.configuration",
            crm_prestate["Configuration_Version"],
        ),
        (
            "route_fingerprint_digest",
            "sylvara.crm.internal-approval-receipt.v1.route",
            route_fingerprint,
        ),
        (
            "source_revision_digest",
            "sylvara.crm.internal-approval-receipt.v1.source",
            source_revision,
        ),
        (
            "expected_deployment_version_digest",
            "sylvara.crm.internal-approval-receipt.v1.deployment-version",
            intent["expected_deployment_version"],
        ),
        (
            "current_deployment_version_digest",
            "sylvara.crm.internal-approval-receipt.v1.current-deployment-version",
            authoritative_current_version,
        ),
        (
            "approval_event_binding_digest",
            "sylvara.crm.internal-approval-receipt.v1.approval-event",
            intent["event_id"],
        ),
        (
            "approval_intent_signature_digest",
            "sylvara.crm.internal-approval-receipt.v1.intent-signature",
            signature,
        ),
        (
            "approval_receipt_hash_digest",
            "sylvara.crm.internal-approval-receipt.v1.receipt-hash",
            receipt_hash,
        ),
    ):
        _binding(evidence, path, evidence_secret, domain, value, "approval_binding_invalid")
    _string(evidence["evidence_nonce_digest"], _HASH, "approval_nonce_invalid")

    prestate_ms = _timestamp(
        evidence["approval_prestate_observed_at"], "approval_chronology_invalid"
    )
    requested_ms = _timestamp(evidence["intent_requested_at"], "approval_chronology_invalid")
    decided_ms = _timestamp(evidence["approval_decided_at"], "approval_chronology_invalid")
    readback_ms = _timestamp(
        evidence["approval_receipt_readback_at"], "approval_chronology_invalid"
    )
    observed_ms, _ = _verify_freshness(
        evidence["observed_at"], transition_at, 300, "approval_evidence_stale"
    )
    _require(
        evidence["approval_prestate_observed_at"] == intent["evidence_observed_at"]
        and evidence["intent_requested_at"] == intent["requested_at"]
        and _crm_timestamp(
            operator_input["Go_Live_Approved_At"], "approval_chronology_invalid"
        )
        == decided_ms
        and prestate_ms <= requested_ms <= decided_ms <= readback_ms <= observed_ms,
        "approval_chronology_invalid",
    )
    _require(
        decided_ms - prestate_ms <= 900_000
        and decided_ms - requested_ms <= 300_000,
        "approval_intent_stale",
    )
    _verify_consumption(
        INTERNAL_APPROVAL,
        evidence,
        context["consumption"],
        transition_at,
        (
            "environment",
            "deal_binding_digest",
            "approval_event_binding_digest",
            "evidence_nonce_digest",
        ),
    )
    return ValidationResult(
        INTERNAL_APPROVAL,
        "internal_approval_receipt",
        evidence["observed_at"],
        True,
    )


def _validate_route_activation(
    evidence: Mapping[str, Any],
    context: Mapping[str, Any],
    secrets: Mapping[str, Any],
    transition_at: str,
) -> ValidationResult:
    context = _exact_mapping(
        context,
        (
            "deal_id",
            "route_fingerprint",
            "source_revision",
            "authoritative_current_deployment_version",
            "approval_evidence_receipt",
            "approval_consumption_readback",
            "approval_receipt_hash",
            "activation_previous_event_hash",
            "activation_receipt_hash",
            "activation_intent",
            "activation_intent_signature",
            "crm_readback",
            "consumption",
        ),
        "activation_context_invalid",
    )
    secrets = _exact_mapping(
        secrets,
        (
            "evidence_secret",
            "approval_evidence_secret",
            "operator_verification_secret",
        ),
        "activation_secret_set_invalid",
    )
    activation_evidence_secret = _secret(
        secrets["evidence_secret"], "activation_evidence_secret_invalid"
    )
    approval_evidence_secret = _secret(
        secrets["approval_evidence_secret"], "approval_evidence_secret_invalid"
    )
    operator_secret = _secret(
        secrets["operator_verification_secret"], "operator_verification_secret_invalid"
    )
    _require(
        not hmac.compare_digest(
            activation_evidence_secret, approval_evidence_secret
        )
        and not hmac.compare_digest(activation_evidence_secret, operator_secret)
        and not hmac.compare_digest(approval_evidence_secret, operator_secret),
        "activation_secret_independence_invalid",
    )
    intent = _validate_activation_intent(context["activation_intent"])
    crm = _exact_mapping(
        context["crm_readback"], _ACTIVATION_CRM_FIELDS, "activation_crm_readback_invalid"
    )
    signature = _verify_signature(
        context["activation_intent_signature"],
        activation_intent_signature(intent, operator_secret),
        "activation_intent_signature_invalid",
    )
    deal_id = _string(context["deal_id"], _RECORD_ID, "activation_context_invalid")
    route_fingerprint = _string(
        context["route_fingerprint"], _ROUTE_FINGERPRINT, "activation_context_invalid"
    )
    source_revision = _string(
        context["source_revision"], _SOURCE_REVISION, "activation_context_invalid"
    )
    approval_receipt_hash = _string(
        context["approval_receipt_hash"], _HASH, "activation_chain_invalid"
    )
    previous_event_hash = _string(
        context["activation_previous_event_hash"], _HASH, "activation_chain_invalid"
    )
    activation_receipt_hash = _string(
        context["activation_receipt_hash"], _HASH, "activation_receipt_hash_invalid"
    )
    approval_evidence_receipt = _string(
        context["approval_evidence_receipt"], _HASH, "activation_chain_invalid"
    )
    authoritative_current_version = _integer(
        context["authoritative_current_deployment_version"],
        1,
        "activation_context_invalid",
    )
    _require(
        hmac.compare_digest(approval_receipt_hash, previous_event_hash),
        "activation_chain_invalid",
    )
    _verify_prior_approval_consumption(
        context["approval_consumption_readback"],
        approval_evidence_secret,
        deal_id,
        approval_evidence_receipt,
        intent["approval_event_key"],
        intent["requested_at"],
    )
    _require(
        intent["deal_id"] == deal_id
        and intent["deployment_id"] == crm["Deployment_Record_ID"]
        and intent["configuration_version_id"] == crm["Configuration_Version"]
        and intent["route_fingerprint"] == route_fingerprint
        and intent["evidence_revision"] == source_revision
        and authoritative_current_version
        == intent["expected_deployment_version"] + 1
        and crm["Approved_Deployment_Record_ID"] == crm["Deployment_Record_ID"]
        and crm["Approved_Configuration_Version"] == crm["Configuration_Version"]
        and crm["Go_Live_Approval_Status"] == "Approved"
        and crm["Test_Status"] == "Scheduled"
        and crm["Test_End_At"] is None,
        "activation_current_binding_invalid",
    )

    _verify_receipt(ROUTE_ACTIVATION, evidence, activation_evidence_secret)
    _require(
        _integer(evidence["schema_version"], 1, "activation_claim_invalid") == 1
        and evidence["evidence_type"] == "route_activation_readback"
        and evidence["environment"] == "Development"
        and evidence["activation_intent_signature_valid"] is True
        and evidence["approval_chain_valid"] is True
        and evidence["route_registry_state"] == "active"
        and evidence["provider_route_state"] == "active"
        and evidence["readiness_state"] == "active_authorized",
        "activation_claim_invalid",
    )
    _binding(
        evidence,
        "deal_binding_digest",
        activation_evidence_secret,
        "sylvara.crm.route-activation-readback.v1.deal",
        deal_id,
        "activation_deal_binding_invalid",
    )
    for path, domain, value in (
        (
            "deployment_binding_digest",
            "sylvara.crm.route-activation-readback.v1.deployment",
            crm["Deployment_Record_ID"],
        ),
        (
            "configuration_binding_digest",
            "sylvara.crm.route-activation-readback.v1.configuration",
            crm["Configuration_Version"],
        ),
        (
            "route_fingerprint_digest",
            "sylvara.crm.route-activation-readback.v1.route",
            route_fingerprint,
        ),
        (
            "source_revision_digest",
            "sylvara.crm.route-activation-readback.v1.source",
            source_revision,
        ),
        (
            "activation_expected_deployment_version_digest",
            "sylvara.crm.route-activation-readback.v1.deployment-version",
            intent["expected_deployment_version"],
        ),
        (
            "activation_current_deployment_version_digest",
            "sylvara.crm.route-activation-readback.v1.current-deployment-version",
            authoritative_current_version,
        ),
        (
            "approval_evidence_receipt_digest",
            "sylvara.crm.route-activation-readback.v1.approval-evidence",
            approval_evidence_receipt,
        ),
        (
            "approval_event_binding_digest",
            "sylvara.crm.route-activation-readback.v1.approval-event",
            intent["approval_event_key"],
        ),
        (
            "approval_receipt_hash_digest",
            "sylvara.crm.route-activation-readback.v1.approval-hash",
            [approval_receipt_hash, previous_event_hash],
        ),
        (
            "activation_event_binding_digest",
            "sylvara.crm.route-activation-readback.v1.activation-event",
            intent["event_id"],
        ),
        (
            "activation_intent_signature_digest",
            "sylvara.crm.route-activation-readback.v1.intent-signature",
            signature,
        ),
        (
            "activation_receipt_hash_digest",
            "sylvara.crm.route-activation-readback.v1.activation-hash",
            activation_receipt_hash,
        ),
        (
            "route_readback_fingerprint_digest",
            "sylvara.crm.route-activation-readback.v1.route-readback",
            intent["route_readback_fingerprint"],
        ),
    ):
        _binding(
            evidence,
            path,
            activation_evidence_secret,
            domain,
            value,
            "activation_binding_invalid",
        )
    _string(evidence["evidence_nonce_digest"], _HASH, "activation_nonce_invalid")

    approval_ms = _timestamp(evidence["approval_decided_at"], "activation_chronology_invalid")
    route_ms = _timestamp(evidence["route_observed_at"], "activation_chronology_invalid")
    prestate_ms = _timestamp(
        evidence["activation_prestate_observed_at"], "activation_chronology_invalid"
    )
    requested_ms = _timestamp(
        evidence["activation_intent_requested_at"], "activation_chronology_invalid"
    )
    decided_ms = _timestamp(evidence["activation_decided_at"], "activation_chronology_invalid")
    actual_start_ms = _timestamp(evidence["actual_start_at"], "activation_chronology_invalid")
    expires_ms = _timestamp(evidence["expires_at"], "activation_chronology_invalid")
    receipt_readback_ms = _timestamp(
        evidence["activation_receipt_readback_at"], "activation_chronology_invalid"
    )
    observed_ms, _ = _verify_freshness(
        evidence["observed_at"], transition_at, 300, "activation_evidence_stale"
    )
    _require(
        _crm_timestamp(crm["Go_Live_Approved_At"], "activation_chronology_invalid")
        == approval_ms
        and evidence["route_observed_at"] == intent["route_observed_at"]
        and evidence["activation_prestate_observed_at"] == intent["evidence_observed_at"]
        and evidence["route_observed_at"]
        == evidence["activation_prestate_observed_at"]
        and evidence["activation_intent_requested_at"] == intent["requested_at"]
        and evidence["actual_start_at"] == evidence["activation_decided_at"]
        and _crm_timestamp(crm["Test_Start_At"], "activation_chronology_invalid")
        == actual_start_ms
        and approval_ms <= route_ms <= requested_ms
        and approval_ms <= prestate_ms <= requested_ms
        and requested_ms <= decided_ms == actual_start_ms
        and expires_ms == actual_start_ms + 604_800_000
        and decided_ms - route_ms <= 900_000
        and decided_ms <= receipt_readback_ms <= observed_ms,
        "activation_chronology_invalid",
    )
    _require(
        decided_ms - requested_ms <= 300_000
        and decided_ms - prestate_ms <= 900_000,
        "activation_intent_stale",
    )
    _verify_consumption(
        ROUTE_ACTIVATION,
        evidence,
        context["consumption"],
        transition_at,
        (
            "environment",
            "deal_binding_digest",
            "activation_event_binding_digest",
            "evidence_nonce_digest",
        ),
    )
    return ValidationResult(
        ROUTE_ACTIVATION,
        "route_activation_readback",
        evidence["observed_at"],
        True,
    )


def _validate_route_inactive(
    evidence: Mapping[str, Any],
    context: Mapping[str, Any],
    secrets: Mapping[str, Any],
    transition_at: str,
) -> ValidationResult:
    context = _exact_mapping(
        context,
        ("deal_id", "route_fingerprint", "last_route_mutation_at", "crm_readback", "consumption"),
        "route_inactive_context_invalid",
    )
    secrets = _exact_mapping(
        secrets, ("evidence_secret",), "route_inactive_secret_set_invalid"
    )
    evidence_secret = _secret(secrets["evidence_secret"], "evidence_secret_invalid")
    crm = _exact_mapping(
        context["crm_readback"],
        ("Deployment_Record_ID", "Configuration_Version", "Rollback_Completed_At"),
        "route_inactive_crm_readback_invalid",
    )
    route_fingerprint = _string(
        context["route_fingerprint"], _ROUTE_FINGERPRINT, "route_inactive_context_invalid"
    )
    deal_id = _string(context["deal_id"], _RECORD_ID, "route_inactive_context_invalid")
    for field in ("Deployment_Record_ID", "Configuration_Version"):
        if crm[field] is not None:
            _string(crm[field], _OPAQUE_ID, "route_inactive_crm_readback_invalid")
    last_mutation_ms = _timestamp(
        context["last_route_mutation_at"], "route_inactive_chronology_invalid"
    )
    rollback_ms = _crm_timestamp(
        crm["Rollback_Completed_At"], "route_inactive_chronology_invalid"
    )
    _verify_receipt(ROUTE_INACTIVE, evidence, evidence_secret)
    _require(
        _integer(evidence["schema_version"], 1, "route_inactive_claim_invalid") == 1
        and evidence["evidence_type"] == "route_inactive_readback"
        and evidence["environment"] == "Development"
        and evidence["route_registry_state"] == "inactive"
        and evidence["provider_route_state"] == "inactive",
        "route_inactive_claim_invalid",
    )
    _binding(
        evidence,
        "deal_binding_digest",
        evidence_secret,
        "sylvara.crm.route-inactive-readback.v1.deal",
        deal_id,
        "route_inactive_deal_binding_invalid",
    )
    for path, domain, value in (
        (
            "deployment_binding_digest",
            "sylvara.crm.route-inactive-readback.v1.deployment",
            ["null"]
            if crm["Deployment_Record_ID"] is None
            else ["value", crm["Deployment_Record_ID"]],
        ),
        (
            "configuration_binding_digest",
            "sylvara.crm.route-inactive-readback.v1.configuration",
            ["null"]
            if crm["Configuration_Version"] is None
            else ["value", crm["Configuration_Version"]],
        ),
        (
            "route_fingerprint_digest",
            "sylvara.crm.route-inactive-readback.v1.route",
            route_fingerprint,
        ),
    ):
        _binding(evidence, path, evidence_secret, domain, value, "route_inactive_binding_invalid")
    _string(evidence["evidence_nonce_digest"], _HASH, "route_inactive_nonce_invalid")
    observed_ms, _ = _verify_freshness(
        evidence["observed_at"], transition_at, 300, "route_inactive_evidence_stale"
    )
    evidence_rollback_ms = _timestamp(
        evidence["rollback_completed_at"], "route_inactive_chronology_invalid"
    )
    _require(
        evidence_rollback_ms == rollback_ms
        and evidence["last_route_mutation_at"] == context["last_route_mutation_at"]
        and max(last_mutation_ms, rollback_ms) <= observed_ms,
        "route_inactive_chronology_invalid",
    )
    _verify_consumption(
        ROUTE_INACTIVE,
        evidence,
        context["consumption"],
        transition_at,
        ("environment", "deal_binding_digest", "evidence_nonce_digest"),
    )
    return ValidationResult(
        ROUTE_INACTIVE,
        "route_inactive_readback",
        evidence["observed_at"],
        True,
    )


def _nonnegative_integer(value: Any, code: str) -> int:
    return _integer(value, 0, code)


def _nullable_nonnegative_number(value: Any, code: str) -> int | float | None:
    if value is None:
        return None
    if isinstance(value, int) and not isinstance(value, bool):
        _require(0 <= value <= _MAX_SAFE_INTEGER, code)
    else:
        _require(
            isinstance(value, float)
            and math.isfinite(value)
            and 0 <= value <= _MAX_SAFE_INTEGER,
            code,
        )
    return value


def _report_hmac(secret: bytes, schema_version: int, purpose: str, material: str) -> str:
    domain = _REPORT_DOMAINS.get(schema_version)
    _require(domain is not None, "terminal_report_schema_invalid")
    return hmac.new(
        secret,
        f"{domain}\0{purpose}\0{material}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _parse_report_summary(payload: Any) -> Mapping[str, Any]:
    _require(
        isinstance(payload, str)
        and not re.search(r"[\ud800-\udfff]", payload)
        and 1 <= len(payload.encode("utf-8")) <= 20_000,
        "terminal_report_payload_invalid",
    )
    try:
        summary = json.loads(payload)
    except (json.JSONDecodeError, TypeError):
        _fail("terminal_report_payload_invalid")
    _require(
        isinstance(summary, Mapping) and tuple(summary) == _SUMMARY_FIELDS,
        "terminal_report_payload_invalid",
    )
    schema_version = summary["schemaVersion"]
    _require(
        isinstance(schema_version, int)
        and not isinstance(schema_version, bool)
        and schema_version in _REPORT_DOMAINS
        and _integer(
            summary["reportSchemaVersion"], 2, "terminal_report_schema_invalid"
        )
        == 2,
        "terminal_report_schema_invalid",
    )
    _string(summary["dealId"], _RECORD_ID, "terminal_report_identity_invalid")
    _string(
        summary["deploymentId"],
        _REPORT_OPAQUE_ID,
        "terminal_report_identity_invalid",
    )
    _string(
        summary["configurationVersion"],
        _REPORT_OPAQUE_ID,
        "terminal_report_identity_invalid",
    )
    _string(summary["callSetDigest"], _HASH, "terminal_report_identity_invalid")
    start_ms = _timestamp(summary["testStartAt"], "terminal_report_identity_invalid")
    end_ms = _timestamp(summary["testEndAt"], "terminal_report_identity_invalid")
    end_reason = summary["testEndReason"]
    _require(
        summary["testStatus"] == "Completed"
        and isinstance(end_reason, str)
        and end_reason in _END_REASONS
        and summary["callTotalsReconciled"] is True
        and end_ms >= start_ms,
        "terminal_report_identity_invalid",
    )
    for field in (
        "callsCaptured",
        "qualifiedOpportunities",
        "existingCustomerCalls",
        "outOfAreaOrWrongFitCalls",
        "urgentRequests",
    ):
        _nonnegative_integer(summary[field], "terminal_report_count_invalid")
    if schema_version == 1:
        _nonnegative_integer(summary["observedWorkflowFailures"], "terminal_report_count_invalid")
    elif summary["observedWorkflowFailures"] is not None:
        _nonnegative_integer(summary["observedWorkflowFailures"], "terminal_report_count_invalid")
    for field in (
        "actualAverageCallDurationSeconds",
        "bookableOpportunities",
        "officeFollowUpCalls",
        "expectedMonthlyConnectedMinutesMin",
        "expectedMonthlyConnectedMinutesMax",
    ):
        _nullable_nonnegative_number(summary[field], "terminal_report_number_invalid")
    minimum = summary["expectedMonthlyConnectedMinutesMin"]
    maximum = summary["expectedMonthlyConnectedMinutesMax"]
    _require(
        (minimum is None) == (maximum is None)
        and (minimum is None or minimum <= maximum),
        "terminal_report_range_invalid",
    )
    paid_coverage = summary["recommendedPaidCoverage"]
    _require(
        paid_coverage is None
        or (isinstance(paid_coverage, str) and paid_coverage in _PAID_COVERAGE),
        "terminal_report_coverage_invalid",
    )
    notes = summary["dataConfidenceNotes"]
    _require(
        isinstance(notes, str)
        and not re.search(r"[\ud800-\udfff]", notes)
        and 0 < len(notes.encode("utf-8")) <= 2000
        and not re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", notes),
        "terminal_report_confidence_invalid",
    )
    return summary


def _parse_canonical_report_summary(value: Any, summary: Mapping[str, Any]) -> str:
    """Accept the producer's exact JS canonical bytes after semantic cross-checking."""

    _require(
        isinstance(value, str)
        and not re.search(r"[\ud800-\udfff]", value)
        and 1 <= len(value.encode("utf-8")) <= 24_000,
        "terminal_report_canonical_summary_invalid",
    )
    try:
        parsed = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        _fail("terminal_report_canonical_summary_invalid")
    expected = [[field, summary[field]] for field in _SUMMARY_FIELDS]
    _require(
        _same_json_value(parsed, expected),
        "terminal_report_canonical_summary_invalid",
    )
    return value


def _report_identity(
    secret: bytes,
    environment: str,
    summary: Mapping[str, Any],
    canonical: str,
) -> tuple[str, str]:
    revision = _report_hmac(secret, summary["schemaVersion"], "report-revision", canonical)
    stable = "\0".join(
        (
            environment,
            summary["dealId"],
            summary["deploymentId"],
            summary["configurationVersion"],
            str(summary["reportSchemaVersion"]),
            summary["callSetDigest"],
            revision,
            "sync_report_summary",
        )
    )
    return (
        _report_hmac(secret, summary["schemaVersion"], "operation", stable),
        _report_hmac(
            secret, summary["schemaVersion"], "fingerprint", f"{stable}\0{canonical}"
        ),
    )


def _bounded_report_integer(value: Any, mode: str = "round") -> int | None:
    if value is None:
        return None
    _nullable_nonnegative_number(value, "terminal_report_number_invalid")
    if mode == "floor":
        normalized = math.floor(value)
    elif mode == "ceil":
        normalized = math.ceil(value)
    else:
        normalized = math.floor(value + 0.5)
    _require(0 <= normalized <= 999_999_999, "terminal_report_number_invalid")
    return normalized


def _report_patch(summary: Mapping[str, Any]) -> Mapping[str, Any]:
    minimum = _bounded_report_integer(summary["expectedMonthlyConnectedMinutesMin"], "floor")
    maximum = _bounded_report_integer(summary["expectedMonthlyConnectedMinutesMax"], "ceil")
    _require(
        (minimum is None) == (maximum is None)
        and (minimum is None or minimum <= maximum),
        "terminal_report_range_invalid",
    )
    failures = summary["observedWorkflowFailures"]
    return {
        # These are current-state bindings, not fields written by the report operation.
        # Re-reading them immediately before the manual transition prevents a completed
        # operation for an older deployment/configuration from authorizing a rebound Deal.
        "Deployment_Record_ID": summary["deploymentId"],
        "Configuration_Version": summary["configurationVersion"],
        "Test_Status": "Completed",
        "Test_Start_At": summary["testStartAt"],
        "Test_End_At": summary["testEndAt"],
        "Test_End_Reason": summary["testEndReason"],
        "Call_Totals_Reconciled": True,
        "Test_Calls_Reaching_Route": _bounded_report_integer(summary["callsCaptured"]),
        "Test_Qualified_Opportunities": _bounded_report_integer(summary["qualifiedOpportunities"]),
        "Test_Existing_Customer_Calls": _bounded_report_integer(summary["existingCustomerCalls"]),
        "Test_Actual_Avg_Call_Duration_Seconds": _bounded_report_integer(
            summary["actualAverageCallDurationSeconds"]
        ),
        "Test_Out_Of_Area_Or_Wrong_Fit_Calls": _bounded_report_integer(
            summary["outOfAreaOrWrongFitCalls"]
        ),
        "Test_Urgent_Requests": _bounded_report_integer(summary["urgentRequests"]),
        "Test_Bookable_Opportunities": _bounded_report_integer(summary["bookableOpportunities"]),
        "Test_Office_Follow_Up_Calls": _bounded_report_integer(summary["officeFollowUpCalls"]),
        "Test_Observed_Workflow_Failures": None
        if failures is None
        else f"Observed workflow failure count: {_bounded_report_integer(failures)}.",
        "Recommended_Paid_Coverage": summary["recommendedPaidCoverage"],
        "Expected_Monthly_Connected_Minutes_Min": minimum,
        "Expected_Monthly_Connected_Minutes_Max": maximum,
        "Test_Data_Confidence_Notes": summary["dataConfidenceNotes"],
    }


def _validate_terminal_report(
    evidence: Mapping[str, Any],
    context: Mapping[str, Any],
    secrets: Mapping[str, Any],
    transition_at: str,
) -> ValidationResult:
    evidence = _exact_mapping(
        evidence,
        (
            "schema_version",
            "evidence_type",
            "environment",
            "operation",
            "crm_readback",
            "observed_at",
        ),
        "terminal_report_evidence_invalid",
    )
    context = _exact_mapping(
        context,
        ("deal_id", "source_revision", "canonical_summary_json"),
        "terminal_report_context_invalid",
    )
    secrets = _exact_mapping(
        secrets, ("analytics_partition_secret",), "terminal_report_secret_set_invalid"
    )
    secret = _secret(
        secrets["analytics_partition_secret"], "analytics_partition_secret_invalid"
    )
    _require(
        _integer(evidence["schema_version"], 2, "terminal_report_evidence_invalid") == 2
        and evidence["evidence_type"] == "terminal_report_summary_readback"
        and evidence["environment"] == "Development",
        "terminal_report_evidence_invalid",
    )
    operation = _exact_mapping(
        evidence["operation"], _TERMINAL_OPERATION_FIELDS, "terminal_report_operation_invalid"
    )
    summary = _parse_report_summary(operation["OPERATION_PAYLOAD_JSON"])
    canonical = _parse_canonical_report_summary(
        context["canonical_summary_json"], summary
    )
    expected_key, expected_fingerprint = _report_identity(
        secret, "development", summary, canonical
    )
    _require(
        hmac.compare_digest(str(operation["OPERATION_KEY"]), expected_key)
        and hmac.compare_digest(str(operation["OPERATION_FINGERPRINT"]), expected_fingerprint)
        and operation["ACTION"] == "sync_report_summary"
        and operation["CRM_DEAL_ID"] == context["deal_id"] == summary["dealId"]
        and operation["STATUS"] == "completed"
        and operation["SOURCE_REVISION"] == context["source_revision"]
        and operation["SOURCE_ENVIRONMENT"] == "development"
        and operation["LAST_OUTCOME"] == "report_summary_readback_confirmed",
        "terminal_report_operation_invalid",
    )
    _string(operation["SOURCE_REVISION"], _SOURCE_REVISION, "terminal_report_operation_invalid")
    _integer(operation["OPERATION_VERSION"], 1, "terminal_report_operation_invalid")
    created_ms = _timestamp(operation["CREATED_AT"], "terminal_report_operation_invalid")
    updated_ms = _timestamp(operation["UPDATED_AT"], "terminal_report_operation_invalid")
    observed_ms, transition_ms = _verify_freshness(
        evidence["observed_at"], transition_at, 300, "terminal_report_evidence_stale"
    )
    _require(
        created_ms <= updated_ms <= observed_ms <= transition_ms + _CLOCK_SKEW_MILLISECONDS,
        "terminal_report_chronology_invalid",
    )
    expected_patch = _report_patch(summary)
    crm = _exact_mapping(
        evidence["crm_readback"], tuple(expected_patch), "terminal_report_crm_readback_invalid"
    )
    _string(
        crm["Deployment_Record_ID"],
        _REPORT_OPAQUE_ID,
        "terminal_report_crm_readback_invalid",
    )
    _string(
        crm["Configuration_Version"],
        _REPORT_OPAQUE_ID,
        "terminal_report_crm_readback_invalid",
    )
    for field, expected in expected_patch.items():
        if field in {"Test_Start_At", "Test_End_At"}:
            _require(
                _crm_timestamp(crm[field], "terminal_report_crm_readback_invalid")
                == _timestamp(expected, "terminal_report_crm_readback_invalid"),
                "terminal_report_crm_readback_invalid",
            )
        else:
            _require(
                _same_json_value(crm[field], expected),
                "terminal_report_crm_readback_invalid",
            )
    return ValidationResult(
        TERMINAL_REPORT,
        "terminal_report_summary_readback",
        evidence["observed_at"],
        False,
    )


def derive_paid_commercial_terms_acceptance_version(value: Mapping[str, Any]) -> str:
    """Derive the same content address used by the private Billing contract."""

    selected = _exact_mapping(
        value,
        ("currency", "interval", "intervalUnit", "commonUsageRateMinor", "plans"),
        "commercial_terms_invalid",
    )
    _require(
        selected["currency"] == "USD"
        and _integer(selected["interval"], 1, "commercial_terms_invalid") == 1
        and selected["intervalUnit"] == "months",
        "commercial_terms_invalid",
    )
    usage_rate = _integer(
        selected["commonUsageRateMinor"], 1, "commercial_terms_invalid"
    )
    _require(usage_rate <= 1_000_000_000, "commercial_terms_invalid")
    plans = _exact_mapping(selected["plans"], _PLAN_FREQUENCY_KEYS, "commercial_terms_invalid")
    canonical_plans: list[list[Any]] = []
    for key in _PLAN_FREQUENCY_KEYS:
        plan = _exact_mapping(
            plans[key],
            ("recurringMinor", "setupMinor"),
            "commercial_terms_invalid",
        )
        recurring = _integer(plan["recurringMinor"], 1, "commercial_terms_invalid")
        setup = _integer(plan["setupMinor"], 1, "commercial_terms_invalid")
        _require(recurring <= 1_000_000_000 and setup <= 1_000_000_000, "commercial_terms_invalid")
        canonical_plans.append([key, recurring, setup])
    canonical = _canonical_json(
        [
            ["currency", selected["currency"]],
            ["interval", selected["interval"]],
            ["intervalUnit", selected["intervalUnit"]],
            ["commonUsageRateMinor", selected["commonUsageRateMinor"]],
            ["plans", canonical_plans],
        ]
    )
    return f"terms-v1:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"


def _money_minor(value: Any) -> int:
    if isinstance(value, bool):
        _fail("billing_money_invalid")
    raw = str(value)
    _require(
        len(raw) <= 20
        and re.fullmatch(r"(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?", raw) is not None,
        "billing_money_invalid",
    )
    whole, _, fraction = raw.partition(".")
    result = int(whole) * 100 + int(fraction.ljust(2, "0") or "0")
    _require(result <= _MAX_SAFE_INTEGER, "billing_money_invalid")
    return result


def _paid_identity(
    secret: bytes,
    environment: str,
    deal_id: str,
    material: Mapping[str, Any],
) -> tuple[str, str, str]:
    entries = sorted(material.items(), key=lambda item: item[0])
    _require(
        1 <= len(entries) <= 20
        and all(
            re.fullmatch(r"[a-z][a-zA-Z0-9]{0,39}", key) is not None
            and isinstance(value, (str, int, bool))
            and not (
                isinstance(value, str)
                and (len(value) > 200 or re.search(r"[\x00-\x1f\x7f]", value))
            )
            and not (
                isinstance(value, int)
                and not isinstance(value, bool)
                and abs(value) > _MAX_SAFE_INTEGER
            )
            for key, value in entries
        ),
        "billing_operation_material_invalid",
    )
    stable = f"{environment}\0{deal_id}\0prepare_paid_subscription"
    canonical = _canonical_json([[key, value] for key, value in entries])
    operation_key = hmac.new(
        secret,
        f"sylvara.crm-billing.idempotency.v1\0operation\0{stable}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    fingerprint = hmac.new(
        secret,
        f"sylvara.crm-billing.idempotency.v1\0fingerprint\0{stable}\0{canonical}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return operation_key, fingerprint, f"syl-paid-{operation_key[:32]}"


def _validate_billing_reconciliation(
    evidence: Mapping[str, Any],
    context: Mapping[str, Any],
    secrets: Mapping[str, Any],
    transition_at: str,
) -> ValidationResult:
    evidence = _exact_mapping(
        evidence,
        (
            "schema_version",
            "evidence_type",
            "environment",
            "request_action",
            "created_resource_count",
            "operation",
            "crm_readback",
            "billing_readback",
            "observed_at",
            "reconciliation_receipt",
        ),
        "billing_evidence_invalid",
    )
    context = _exact_mapping(
        context,
        (
            "deal_id",
            "account_id",
            "source_revision",
            "results_review_at",
            "commercial_terms",
            "catalog",
        ),
        "billing_context_invalid",
    )
    secrets = _exact_mapping(
        secrets,
        ("idempotency_pepper", "reconciliation_evidence_secret"),
        "billing_secret_set_invalid",
    )
    secret = _secret(secrets["idempotency_pepper"], "idempotency_pepper_invalid")
    reconciliation_secret = _secret(
        secrets["reconciliation_evidence_secret"],
        "reconciliation_evidence_secret_invalid",
    )
    _require(
        not hmac.compare_digest(secret, reconciliation_secret),
        "billing_secret_independence_invalid",
    )
    _require(
        _integer(evidence["schema_version"], 1, "billing_evidence_invalid") == 1
        and evidence["evidence_type"] == "billing_closed_won_reconciliation"
        and evidence["environment"] == "Development"
        and evidence["request_action"] == "reconcile"
        and _integer(
            evidence["created_resource_count"], 0, "billing_evidence_invalid"
        )
        == 0,
        "billing_evidence_invalid",
    )
    deal_id = _string(context["deal_id"], _RECORD_ID, "billing_context_invalid")
    account_id = _string(context["account_id"], _RECORD_ID, "billing_context_invalid")
    source_revision = _string(
        context["source_revision"], _SOURCE_REVISION, "billing_context_invalid"
    )
    context_results_review_ms, _ = _normalized_crm_timestamp(
        context["results_review_at"], "billing_acceptance_chronology_invalid"
    )
    commercial_terms = _exact_mapping(
        context["commercial_terms"],
        (
            "acceptanceVersion",
            "currency",
            "interval",
            "intervalUnit",
            "commonUsageRateMinor",
            "plans",
        ),
        "commercial_terms_invalid",
    )
    acceptance_material = {
        "currency": commercial_terms["currency"],
        "interval": commercial_terms["interval"],
        "intervalUnit": commercial_terms["intervalUnit"],
        "commonUsageRateMinor": commercial_terms["commonUsageRateMinor"],
        "plans": commercial_terms["plans"],
    }
    expected_acceptance = derive_paid_commercial_terms_acceptance_version(acceptance_material)
    acceptance_version = _string(
        commercial_terms["acceptanceVersion"],
        _ACCEPTANCE_VERSION,
        "commercial_terms_invalid",
    )
    _require(
        hmac.compare_digest(acceptance_version, expected_acceptance),
        "commercial_terms_invalid",
    )
    catalog = _exact_mapping(
        context["catalog"],
        (
            "billing_organization_id",
            "plan_code_map",
            "usage_addon_product_id",
            "usage_addon_code",
            "usage_addon_unit",
            "subscription_status_map",
        ),
        "billing_catalog_invalid",
    )
    plan_code_map = _exact_mapping(
        catalog["plan_code_map"], _PLAN_FREQUENCY_KEYS, "billing_catalog_invalid"
    )
    status_map = _exact_mapping(
        catalog["subscription_status_map"],
        ("future", "live"),
        "billing_catalog_invalid",
    )
    _require(
        status_map["future"] == "Scheduled"
        and status_map["live"] == "Active"
        and catalog["usage_addon_unit"] == "minute",
        "billing_catalog_invalid",
    )
    for field in (
        "billing_organization_id",
        "usage_addon_product_id",
        "usage_addon_code",
        "usage_addon_unit",
    ):
        _private_string(catalog[field], "billing_catalog_invalid")
    for value in plan_code_map.values():
        _private_string(value, "billing_catalog_invalid", maximum=200)
    _require(
        len(set(plan_code_map.values())) == len(plan_code_map),
        "billing_catalog_invalid",
    )
    crm_fields = tuple(
        _contract()[BILLING_RECONCILIATION]["exact_crm_readback_fields"]
    )
    crm = _exact_mapping(evidence["crm_readback"], crm_fields, "billing_crm_readback_invalid")
    crm_account_id = _string(
        crm["Account_Name"], _RECORD_ID, "billing_crm_readback_invalid"
    )
    crm_results_review_ms, _ = _normalized_crm_timestamp(
        crm["Results_Review_At"], "billing_crm_readback_invalid"
    )
    _require(
        crm_account_id == account_id
        and crm_results_review_ms == context_results_review_ms,
        "billing_crm_readback_invalid",
    )
    crm_plan = _private_string(crm["Plan"], "billing_plan_binding_invalid", maximum=80)
    billing_frequency = _private_string(
        crm["Billing_Frequency"], "billing_plan_binding_invalid", maximum=80
    )
    canonical_plan = _PLAN_BY_CRM_API_VALUE.get(crm_plan)
    plan_key = f"{canonical_plan}::{billing_frequency}"
    _require(
        canonical_plan is not None and plan_key in _PLAN_FREQUENCY_KEYS,
        "billing_plan_binding_invalid",
    )
    selected_terms = _mapping(commercial_terms["plans"], "commercial_terms_invalid")[plan_key]
    selected_terms = _exact_mapping(
        selected_terms, ("recurringMinor", "setupMinor"), "commercial_terms_invalid"
    )
    recurring_minor = _integer(selected_terms["recurringMinor"], 1, "commercial_terms_invalid")
    setup_minor = _integer(selected_terms["setupMinor"], 1, "commercial_terms_invalid")
    for field in ("Deployment_Record_ID", "Approved_Deployment_Record_ID"):
        _string(crm[field], _BILLING_DEPLOYMENT_ID, "billing_crm_readback_invalid")
    for field in ("Configuration_Version", "Approved_Configuration_Version"):
        _string(
            crm[field],
            _BILLING_CONFIGURATION_VERSION,
            "billing_crm_readback_invalid",
        )
    _require(
        _money_minor(crm["Monthly_Recurring_Revenue"]) == recurring_minor
        and _money_minor(crm["Setup_Fee"]) == setup_minor
        and crm["Subscription_Acceptance_Status"] == "Accepted"
        and crm["Subscription_Acceptance_Version"] == expected_acceptance
        and crm["Deployment_Record_ID"] == crm["Approved_Deployment_Record_ID"]
        and crm["Configuration_Version"] == crm["Approved_Configuration_Version"]
        and crm["Billing_Automation_Status"] == "Paid Verified"
        and crm["Billing_Automation_Error"] is None
        and crm["Subscription_Status"] == "Active",
        "billing_crm_readback_invalid",
    )
    _calendar_date(crm["Subscription_Start_Date"], "billing_start_date_invalid")
    accepted_ms = _crm_timestamp(
        crm["Subscription_Accepted_At"], "billing_acceptance_chronology_invalid"
    )
    results_review_ms = crm_results_review_ms
    _string(crm["Billing_Customer_ID"], _RECORD_ID, "billing_crm_readback_invalid")
    _string(crm["Billing_Subscription_ID"], _RECORD_ID, "billing_crm_readback_invalid")

    # Relationship ownership and review timing come only from the authenticated
    # current CRM projection; matching request context is a comparison, not truth.
    # Preserve the exact CRM datetime string in operation material because the
    # JavaScript producer fingerprints the validated Zoho value without rewriting
    # its offset. UTC normalization is used only for instant comparisons above.
    material = {
        "accountId": crm_account_id,
        "billingFrequency": billing_frequency,
        "billingOrganizationId": catalog["billing_organization_id"],
        "currency": commercial_terms["currency"],
        "interval": commercial_terms["interval"],
        "intervalUnit": commercial_terms["intervalUnit"],
        "plan": canonical_plan,
        "planCode": plan_code_map[plan_key],
        "recurringMinor": recurring_minor,
        "resultsReviewAt": crm["Results_Review_At"],
        "setupMinor": setup_minor,
        "subscriptionAcceptanceVersion": acceptance_version,
        "subscriptionAcceptedAt": crm["Subscription_Accepted_At"],
        "subscriptionStartDate": crm["Subscription_Start_Date"],
        "usageAddonCode": catalog["usage_addon_code"],
        "usageAddonProductId": catalog["usage_addon_product_id"],
        "usageAddonUnit": catalog["usage_addon_unit"],
        "usageRateMinor": commercial_terms["commonUsageRateMinor"],
        "deploymentId": crm["Deployment_Record_ID"],
        "configurationVersion": crm["Configuration_Version"],
    }
    expected_key, expected_fingerprint, expected_reference = _paid_identity(
        secret, "development", deal_id, material
    )
    operation = _exact_mapping(
        evidence["operation"], _BILLING_OPERATION_FIELDS, "billing_operation_invalid"
    )
    _require(
        hmac.compare_digest(str(operation["OPERATION_KEY"]), expected_key)
        and hmac.compare_digest(str(operation["OPERATION_FINGERPRINT"]), expected_fingerprint)
        and operation["ACTION"] == "prepare_paid_subscription"
        and operation["CRM_DEAL_ID"] == deal_id
        and operation["STATUS"] == "completed"
        and operation["SOURCE_REVISION"] == source_revision
        and operation["SOURCE_ENVIRONMENT"] == "development"
        and operation["LAST_OUTCOME"] == "paid_subscription_readback_confirmed",
        "billing_operation_invalid",
    )
    _integer(operation["OPERATION_VERSION"], 1, "billing_operation_invalid")
    operation_created_ms = _timestamp(operation["CREATED_AT"], "billing_operation_invalid")
    operation_updated_ms = _timestamp(operation["UPDATED_AT"], "billing_operation_invalid")
    _require(operation_created_ms <= operation_updated_ms, "billing_operation_invalid")

    billing = _exact_mapping(
        evidence["billing_readback"], _BILLING_READBACK_FIELDS, "billing_provider_readback_invalid"
    )
    _string(billing["customer_id"], _RECORD_ID, "billing_provider_readback_invalid")
    _string(billing["subscription_id"], _RECORD_ID, "billing_provider_readback_invalid")
    billing_organization_id = _private_string(
        billing["billing_organization_id"],
        "billing_provider_readback_invalid",
        maximum=200,
    )
    provider_status = _private_string(
        billing["provider_subscription_status"],
        "billing_provider_readback_invalid",
        maximum=120,
    )
    _private_string(
        billing["crm_subscription_status"],
        "billing_provider_readback_invalid",
        maximum=120,
    )
    provider_recurring_minor = _integer(
        billing["recurring_minor"], 1, "billing_provider_readback_invalid"
    )
    provider_setup_minor = _integer(
        billing["setup_minor"], 1, "billing_provider_readback_invalid"
    )
    provider_usage_rate_minor = _integer(
        billing["usage_rate_minor"], 1, "billing_provider_readback_invalid"
    )
    _require(
        billing["customer_crm_reference"] == crm_account_id
        and billing["subscription_reference"] == expected_reference
        and billing["plan_code"] == plan_code_map[plan_key]
        and billing_organization_id == catalog["billing_organization_id"]
        and billing["currency"] == commercial_terms["currency"] == "USD"
        and provider_recurring_minor == recurring_minor
        and provider_setup_minor == setup_minor
        and billing["usage_addon_product_id"] == catalog["usage_addon_product_id"]
        and billing["usage_addon_code"] == catalog["usage_addon_code"]
        and billing["usage_addon_unit"] == catalog["usage_addon_unit"] == "minute"
        and provider_usage_rate_minor == commercial_terms["commonUsageRateMinor"]
        and billing["subscription_start_date"] == crm["Subscription_Start_Date"]
        and provider_status == "live"
        and status_map["live"]
        == billing["crm_subscription_status"]
        == crm["Subscription_Status"]
        == "Active"
        and billing["customer_id"] == crm["Billing_Customer_ID"]
        and billing["subscription_id"] == crm["Billing_Subscription_ID"],
        "billing_provider_readback_invalid",
    )
    provider_observed_ms = _timestamp(
        billing["observed_at"], "billing_provider_readback_invalid"
    )
    crm_sync_ms = _crm_timestamp(
        crm["Billing_Last_Sync_At"], "billing_crm_readback_invalid"
    )
    observed_ms, transition_ms = _verify_freshness(
        evidence["observed_at"], transition_at, 300, "billing_evidence_stale"
    )
    _require(
        results_review_ms <= accepted_ms <= operation_created_ms
        and operation_created_ms <= provider_observed_ms <= observed_ms
        and operation_created_ms <= crm_sync_ms <= observed_ms
        and operation_updated_ms <= observed_ms <= transition_ms + _CLOCK_SKEW_MILLISECONDS,
        "billing_chronology_invalid",
    )
    _require(
        observed_ms - provider_observed_ms <= 300_000,
        "billing_provider_readback_stale",
    )
    expected_receipt = billing_reconciliation_receipt(
        evidence, reconciliation_secret
    )
    _constant_time_equal(
        evidence["reconciliation_receipt"],
        expected_receipt,
        "billing_reconciliation_receipt_invalid",
    )
    return ValidationResult(
        BILLING_RECONCILIATION,
        "billing_closed_won_reconciliation",
        evidence["observed_at"],
        False,
    )


_VALIDATORS: Mapping[
    str,
    Callable[
        [Mapping[str, Any], Mapping[str, Any], Mapping[str, Any], str],
        ValidationResult,
    ],
] = {
    INTERNAL_APPROVAL: _validate_internal_approval,
    ROUTE_ACTIVATION: _validate_route_activation,
    TERMINAL_REPORT: _validate_terminal_report,
    ROUTE_INACTIVE: _validate_route_inactive,
    BILLING_RECONCILIATION: _validate_billing_reconciliation,
}


def validate_external_evidence(
    contract_id: str,
    evidence: Mapping[str, Any],
    context: Mapping[str, Any],
    secrets: Mapping[str, Any],
    *,
    transition_at: str,
) -> ValidationResult:
    """Validate one exact evidence contract without mutating external state.

    All inputs are private runtime values. Callers must not log them or persist
    them to Git. A successful result is intentionally sanitized and contains no
    private identifier, receipt, signature, payload, or provider value.
    """

    _require(isinstance(contract_id, str), "external_evidence_contract_unknown")
    validator = _VALIDATORS.get(contract_id)
    _require(validator is not None, "external_evidence_contract_unknown")
    contracts = _contract()
    selected = contracts.get(contract_id)
    _require(
        isinstance(selected, Mapping)
        and selected.get("validator_status") == "implemented_repository_only",
        "external_evidence_validator_not_enabled",
    )
    return validator(
        _mapping(evidence, "evidence_invalid"),
        _mapping(context, "evidence_context_invalid"),
        _mapping(secrets, "evidence_secret_set_invalid"),
        transition_at,
    )
