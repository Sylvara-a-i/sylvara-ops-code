import hashlib
import hmac
import json
import sys
import unittest
from pathlib import Path


CRM_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CRM_ROOT))

from validators.external_evidence import (  # noqa: E402
    BILLING_RECONCILIATION,
    INTERNAL_APPROVAL,
    ROUTE_ACTIVATION,
    ROUTE_INACTIVE,
    TERMINAL_REPORT,
    EvidenceValidationError,
    activation_intent_signature,
    approval_intent_signature,
    billing_reconciliation_receipt,
    derive_binding_digest,
    derive_paid_commercial_terms_acceptance_version,
    derive_receipt_digest,
    validate_external_evidence,
)


CONTRACT_PATH = CRM_ROOT / "config" / "automation-contract.json"
CONTRACT = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
EXTERNAL_CONTRACTS = CONTRACT["blueprint"]["external_evidence_contracts"]

EVIDENCE_KEY = "e" * 43
APPROVAL_EVIDENCE_KEY = "p" * 43
OPERATOR_KEY = "o" * 43
ANALYTICS_KEY = "a" * 43
IDEMPOTENCY_KEY = "i" * 43
RECONCILIATION_KEY = "r" * 43


def _receipt_fields(contract_id):
    contract = EXTERNAL_CONTRACTS[contract_id]
    crypto = contract.get("cryptographic_boundary") or contract["keyed_binding"]
    return tuple(crypto["canonical_binding_fields"]), crypto["receipt_domain"]


def _seal(contract_id, evidence, secret=None):
    if secret is None:
        secret = (
            APPROVAL_EVIDENCE_KEY
            if contract_id == INTERNAL_APPROVAL
            else EVIDENCE_KEY
        )
    fields, domain = _receipt_fields(contract_id)
    evidence["evidence_receipt"] = derive_receipt_digest(
        secret, domain, evidence, fields
    )
    return evidence


def _consumption(contract_id, evidence, scope_fields, consumed_at, readback_at):
    return {
        "contract_id": contract_id,
        "status": "consumed",
        "evidence_receipt": evidence["evidence_receipt"],
        "unique_scope": {field: evidence[field] for field in scope_fields},
        "consumption_count": 1,
        "consumed_at": consumed_at,
        "readback_at": readback_at,
        "replay_detected": False,
    }


def _reseal_consumed_evidence(contract_id, evidence, context):
    _seal(contract_id, evidence)
    context["consumption"]["evidence_receipt"] = evidence["evidence_receipt"]


def _approval_fixture():
    deal_id = "100000000000001"
    deployment_id = "deployment-synthetic"
    configuration_version = "configuration-v1"
    route_fingerprint = f"route_{'a' * 64}"
    source_revision = "b" * 40
    intent = {
        "schema_version": 1,
        "event_id": f"approval_{'c' * 64}",
        "action": "approve",
        "deal_id": deal_id,
        "deployment_id": deployment_id,
        "configuration_version_id": configuration_version,
        "route_fingerprint": route_fingerprint,
        "evidence_revision": source_revision,
        "evidence_observed_at": "2026-08-28T12:00:00.000Z",
        "requested_at": "2026-08-28T12:00:10.000Z",
        "operator_id_hash": f"operator_{'d' * 64}",
        "expected_deployment_version": 7,
    }
    signature = approval_intent_signature(intent, OPERATOR_KEY)
    receipt_hash = "e" * 64
    evidence = {
        "schema_version": 1,
        "evidence_type": "internal_approval_receipt",
        "environment": "Development",
        "deal_binding_digest": derive_binding_digest(
            APPROVAL_EVIDENCE_KEY,
            "sylvara.crm.internal-approval-receipt.v1.deal",
            deal_id,
        ),
        "deployment_binding_digest": derive_binding_digest(
            APPROVAL_EVIDENCE_KEY,
            "sylvara.crm.internal-approval-receipt.v1.deployment",
            deployment_id,
        ),
        "configuration_binding_digest": derive_binding_digest(
            APPROVAL_EVIDENCE_KEY,
            "sylvara.crm.internal-approval-receipt.v1.configuration",
            configuration_version,
        ),
        "route_fingerprint_digest": derive_binding_digest(
            APPROVAL_EVIDENCE_KEY,
            "sylvara.crm.internal-approval-receipt.v1.route",
            route_fingerprint,
        ),
        "source_revision_digest": derive_binding_digest(
            APPROVAL_EVIDENCE_KEY,
            "sylvara.crm.internal-approval-receipt.v1.source",
            source_revision,
        ),
        "expected_deployment_version_digest": derive_binding_digest(
            APPROVAL_EVIDENCE_KEY,
            "sylvara.crm.internal-approval-receipt.v1.deployment-version",
            7,
        ),
        "current_deployment_version_digest": derive_binding_digest(
            APPROVAL_EVIDENCE_KEY,
            "sylvara.crm.internal-approval-receipt.v1.current-deployment-version",
            8,
        ),
        "approval_event_binding_digest": derive_binding_digest(
            APPROVAL_EVIDENCE_KEY,
            "sylvara.crm.internal-approval-receipt.v1.approval-event",
            intent["event_id"],
        ),
        "approval_intent_signature_digest": derive_binding_digest(
            APPROVAL_EVIDENCE_KEY,
            "sylvara.crm.internal-approval-receipt.v1.intent-signature",
            signature,
        ),
        "approval_intent_signature_valid": True,
        "approval_receipt_hash_digest": derive_binding_digest(
            APPROVAL_EVIDENCE_KEY,
            "sylvara.crm.internal-approval-receipt.v1.receipt-hash",
            receipt_hash,
        ),
        "approval_decision": "Approved",
        "runtime_test_status": "Scheduled",
        "approval_prestate_observed_at": "2026-08-28T12:00:00.000Z",
        "intent_requested_at": "2026-08-28T12:00:10.000Z",
        "approval_decided_at": "2026-08-28T12:00:20.000Z",
        "approval_receipt_readback_at": "2026-08-28T12:00:25.000Z",
        "observed_at": "2026-08-28T12:00:30.000Z",
        "activation_event_absent": True,
        "actual_start_at": None,
        "expires_at": None,
        "evidence_nonce_digest": "f" * 64,
    }
    _seal(INTERNAL_APPROVAL, evidence)
    context = {
        "deal_id": deal_id,
        "route_fingerprint": route_fingerprint,
        "source_revision": source_revision,
        "authoritative_current_deployment_version": 8,
        "approval_intent": intent,
        "approval_intent_signature": signature,
        "approval_receipt_hash": receipt_hash,
        "crm_prestate": {
            "Deployment_Record_ID": deployment_id,
            "Configuration_Version": configuration_version,
            "Test_Status": "Setup Pending",
            "Test_Start_At": None,
            "Test_End_At": None,
        },
        "operator_input": {
            "Approved_Deployment_Record_ID": deployment_id,
            "Approved_Configuration_Version": configuration_version,
            "Go_Live_Approval_Status": "Approved",
            "Go_Live_Approved_At": "2026-08-28T12:00:20.000Z",
        },
        "consumption": _consumption(
            INTERNAL_APPROVAL,
            evidence,
            (
                "environment",
                "deal_binding_digest",
                "approval_event_binding_digest",
                "evidence_nonce_digest",
            ),
            "2026-08-28T12:00:31.000Z",
            "2026-08-28T12:00:32.000Z",
        ),
    }
    secrets = {
        "evidence_secret": APPROVAL_EVIDENCE_KEY,
        "operator_verification_secret": OPERATOR_KEY,
    }
    return evidence, context, secrets, "2026-08-28T12:00:35.000Z"


def _activation_fixture():
    deal_id = "100000000000001"
    deployment_id = "deployment-synthetic"
    configuration_version = "configuration-v1"
    route_fingerprint = f"route_{'a' * 64}"
    readback_fingerprint = f"readback_{'b' * 64}"
    source_revision = "c" * 40
    approval_event = f"approval_{'d' * 64}"
    intent = {
        "schema_version": 1,
        "event_id": f"activation_{'e' * 64}",
        "action": "activate",
        "deal_id": deal_id,
        "deployment_id": deployment_id,
        "configuration_version_id": configuration_version,
        "approval_event_key": approval_event,
        "route_fingerprint": route_fingerprint,
        "route_readback_fingerprint": readback_fingerprint,
        "route_observed_at": "2026-08-28T12:00:00.000Z",
        "evidence_revision": source_revision,
        "evidence_observed_at": "2026-08-28T12:00:00.000Z",
        "requested_at": "2026-08-28T12:00:02.000Z",
        "operator_id_hash": f"operator_{'f' * 64}",
        "expected_deployment_version": 8,
    }
    signature = activation_intent_signature(intent, OPERATOR_KEY)
    approval_evidence_receipt = "1" * 64
    approval_receipt_hash = "2" * 64
    activation_receipt_hash = "3" * 64
    evidence = {
        "schema_version": 1,
        "evidence_type": "route_activation_readback",
        "environment": "Development",
        "deal_binding_digest": derive_binding_digest(
            EVIDENCE_KEY,
            "sylvara.crm.route-activation-readback.v1.deal",
            deal_id,
        ),
        "deployment_binding_digest": derive_binding_digest(
            EVIDENCE_KEY,
            "sylvara.crm.route-activation-readback.v1.deployment",
            deployment_id,
        ),
        "configuration_binding_digest": derive_binding_digest(
            EVIDENCE_KEY,
            "sylvara.crm.route-activation-readback.v1.configuration",
            configuration_version,
        ),
        "route_fingerprint_digest": derive_binding_digest(
            EVIDENCE_KEY,
            "sylvara.crm.route-activation-readback.v1.route",
            route_fingerprint,
        ),
        "source_revision_digest": derive_binding_digest(
            EVIDENCE_KEY,
            "sylvara.crm.route-activation-readback.v1.source",
            source_revision,
        ),
        "activation_expected_deployment_version_digest": derive_binding_digest(
            EVIDENCE_KEY,
            "sylvara.crm.route-activation-readback.v1.deployment-version",
            8,
        ),
        "activation_current_deployment_version_digest": derive_binding_digest(
            EVIDENCE_KEY,
            "sylvara.crm.route-activation-readback.v1.current-deployment-version",
            9,
        ),
        "approval_evidence_receipt_digest": derive_binding_digest(
            EVIDENCE_KEY,
            "sylvara.crm.route-activation-readback.v1.approval-evidence",
            approval_evidence_receipt,
        ),
        "approval_event_binding_digest": derive_binding_digest(
            EVIDENCE_KEY,
            "sylvara.crm.route-activation-readback.v1.approval-event",
            approval_event,
        ),
        "approval_receipt_hash_digest": derive_binding_digest(
            EVIDENCE_KEY,
            "sylvara.crm.route-activation-readback.v1.approval-hash",
            [approval_receipt_hash, approval_receipt_hash],
        ),
        "activation_event_binding_digest": derive_binding_digest(
            EVIDENCE_KEY,
            "sylvara.crm.route-activation-readback.v1.activation-event",
            intent["event_id"],
        ),
        "activation_intent_signature_digest": derive_binding_digest(
            EVIDENCE_KEY,
            "sylvara.crm.route-activation-readback.v1.intent-signature",
            signature,
        ),
        "activation_intent_signature_valid": True,
        "activation_receipt_hash_digest": derive_binding_digest(
            EVIDENCE_KEY,
            "sylvara.crm.route-activation-readback.v1.activation-hash",
            activation_receipt_hash,
        ),
        "route_readback_fingerprint_digest": derive_binding_digest(
            EVIDENCE_KEY,
            "sylvara.crm.route-activation-readback.v1.route-readback",
            readback_fingerprint,
        ),
        "approval_chain_valid": True,
        "approval_decided_at": "2026-08-28T11:59:50.000Z",
        "route_observed_at": "2026-08-28T12:00:00.000Z",
        "activation_prestate_observed_at": "2026-08-28T12:00:00.000Z",
        "activation_intent_requested_at": "2026-08-28T12:00:02.000Z",
        "activation_decided_at": "2026-08-28T12:00:03.000Z",
        "actual_start_at": "2026-08-28T12:00:03.000Z",
        "expires_at": "2026-09-04T12:00:03.000Z",
        "activation_receipt_readback_at": "2026-08-28T12:00:04.000Z",
        "observed_at": "2026-08-28T12:00:05.000Z",
        "route_registry_state": "active",
        "provider_route_state": "active",
        "readiness_state": "active_authorized",
        "evidence_nonce_digest": "4" * 64,
    }
    _seal(ROUTE_ACTIVATION, evidence)
    context = {
        "deal_id": deal_id,
        "route_fingerprint": route_fingerprint,
        "source_revision": source_revision,
        "authoritative_current_deployment_version": 9,
        "approval_evidence_receipt": approval_evidence_receipt,
        "approval_consumption_readback": {
            "contract_id": INTERNAL_APPROVAL,
            "status": "consumed",
            "evidence_receipt": approval_evidence_receipt,
            "unique_scope": {
                "environment": "Development",
                "deal_binding_digest": derive_binding_digest(
                    APPROVAL_EVIDENCE_KEY,
                    "sylvara.crm.internal-approval-receipt.v1.deal",
                    deal_id,
                ),
                "approval_event_binding_digest": derive_binding_digest(
                    APPROVAL_EVIDENCE_KEY,
                    "sylvara.crm.internal-approval-receipt.v1.approval-event",
                    approval_event,
                ),
                "evidence_nonce_digest": "5" * 64,
            },
            "consumption_count": 1,
            "consumed_at": "2026-08-28T11:59:40.000Z",
            "readback_at": "2026-08-28T11:59:45.000Z",
            "replay_detected": False,
        },
        "approval_receipt_hash": approval_receipt_hash,
        "activation_previous_event_hash": approval_receipt_hash,
        "activation_receipt_hash": activation_receipt_hash,
        "activation_intent": intent,
        "activation_intent_signature": signature,
        "crm_readback": {
            "Deployment_Record_ID": deployment_id,
            "Configuration_Version": configuration_version,
            "Approved_Deployment_Record_ID": deployment_id,
            "Approved_Configuration_Version": configuration_version,
            "Go_Live_Approval_Status": "Approved",
            "Go_Live_Approved_At": "2026-08-28T11:59:50.000Z",
            "Test_Status": "Scheduled",
            "Test_Start_At": "2026-08-28T12:00:03.000Z",
            "Test_End_At": None,
        },
        "consumption": _consumption(
            ROUTE_ACTIVATION,
            evidence,
            (
                "environment",
                "deal_binding_digest",
                "activation_event_binding_digest",
                "evidence_nonce_digest",
            ),
            "2026-08-28T12:00:06.000Z",
            "2026-08-28T12:00:07.000Z",
        ),
    }
    secrets = {
        "evidence_secret": EVIDENCE_KEY,
        "approval_evidence_secret": APPROVAL_EVIDENCE_KEY,
        "operator_verification_secret": OPERATOR_KEY,
    }
    return evidence, context, secrets, "2026-08-28T12:00:10.000Z"


def _inactive_fixture():
    deal_id = "100000000000001"
    route_fingerprint = f"route_{'a' * 64}"
    evidence = {
        "schema_version": 1,
        "evidence_type": "route_inactive_readback",
        "environment": "Development",
        "deal_binding_digest": derive_binding_digest(
            EVIDENCE_KEY, "sylvara.crm.route-inactive-readback.v1.deal", deal_id
        ),
        "deployment_binding_digest": derive_binding_digest(
            EVIDENCE_KEY,
            "sylvara.crm.route-inactive-readback.v1.deployment",
            ["null"],
        ),
        "configuration_binding_digest": derive_binding_digest(
            EVIDENCE_KEY,
            "sylvara.crm.route-inactive-readback.v1.configuration",
            ["null"],
        ),
        "route_fingerprint_digest": derive_binding_digest(
            EVIDENCE_KEY,
            "sylvara.crm.route-inactive-readback.v1.route",
            route_fingerprint,
        ),
        "rollback_completed_at": "2026-08-28T12:00:05.000Z",
        "last_route_mutation_at": "2026-08-28T12:00:00.000Z",
        "observed_at": "2026-08-28T12:00:10.000Z",
        "route_registry_state": "inactive",
        "provider_route_state": "inactive",
        "evidence_nonce_digest": "b" * 64,
    }
    _seal(ROUTE_INACTIVE, evidence)
    context = {
        "deal_id": deal_id,
        "route_fingerprint": route_fingerprint,
        "last_route_mutation_at": "2026-08-28T12:00:00.000Z",
        "crm_readback": {
            "Deployment_Record_ID": None,
            "Configuration_Version": None,
            "Rollback_Completed_At": "2026-08-28T12:00:05.000Z",
        },
        "consumption": _consumption(
            ROUTE_INACTIVE,
            evidence,
            ("environment", "deal_binding_digest", "evidence_nonce_digest"),
            "2026-08-28T12:00:11.000Z",
            "2026-08-28T12:00:12.000Z",
        ),
    }
    return (
        evidence,
        context,
        {"evidence_secret": EVIDENCE_KEY},
        "2026-08-28T12:00:15.000Z",
    )


def _report_hmac(secret, schema_version, purpose, material):
    domain = {
        1: "sylvara.crm-report-summary.v1",
        2: "sylvara.crm-report-summary.v2",
    }[schema_version]
    return hmac.new(
        secret.encode(), f"{domain}\0{purpose}\0{material}".encode(), hashlib.sha256
    ).hexdigest()


def _terminal_fixture():
    summary = {
        "schemaVersion": 2,
        "dealId": "100000000000001",
        "deploymentId": "deployment-synthetic",
        "configurationVersion": "configuration-v1",
        "reportSchemaVersion": 2,
        "callSetDigest": "a" * 64,
        "testStatus": "Completed",
        "testStartAt": "2026-08-20T12:00:00.000Z",
        "testEndAt": "2026-08-27T12:00:00.000Z",
        "testEndReason": "Seven-Day Limit Reached",
        "callTotalsReconciled": True,
        "callsCaptured": 4,
        "qualifiedOpportunities": 2,
        "existingCustomerCalls": 1,
        "actualAverageCallDurationSeconds": 42.6,
        "outOfAreaOrWrongFitCalls": 1,
        "urgentRequests": 0,
        "bookableOpportunities": None,
        "officeFollowUpCalls": None,
        "observedWorkflowFailures": None,
        "recommendedPaidCoverage": None,
        "expectedMonthlyConnectedMinutesMin": 100.2,
        "expectedMonthlyConnectedMinutesMax": 199.8,
        "dataConfidenceNotes": "Synthetic reconciled fixture.",
    }
    payload = json.dumps(summary, separators=(",", ":"))
    canonical = json.dumps(list(map(list, summary.items())), separators=(",", ":"))
    revision = _report_hmac(ANALYTICS_KEY, 2, "report-revision", canonical)
    stable = "\0".join(
        (
            "development",
            summary["dealId"],
            summary["deploymentId"],
            summary["configurationVersion"],
            "2",
            summary["callSetDigest"],
            revision,
            "sync_report_summary",
        )
    )
    operation = {
        "OPERATION_KEY": _report_hmac(ANALYTICS_KEY, 2, "operation", stable),
        "OPERATION_FINGERPRINT": _report_hmac(
            ANALYTICS_KEY, 2, "fingerprint", f"{stable}\0{canonical}"
        ),
        "ACTION": "sync_report_summary",
        "CRM_DEAL_ID": summary["dealId"],
        "STATUS": "completed",
        "SOURCE_REVISION": "b" * 40,
        "SOURCE_ENVIRONMENT": "development",
        "LAST_OUTCOME": "report_summary_readback_confirmed",
        "OPERATION_PAYLOAD_JSON": payload,
        "OPERATION_VERSION": 4,
        "CREATED_AT": "2026-08-28T13:00:00.000Z",
        "UPDATED_AT": "2026-08-28T13:00:10.000Z",
    }
    crm = {
        "Deployment_Record_ID": summary["deploymentId"],
        "Configuration_Version": summary["configurationVersion"],
        "Test_Status": "Completed",
        "Test_Start_At": summary["testStartAt"],
        "Test_End_At": summary["testEndAt"],
        "Test_End_Reason": summary["testEndReason"],
        "Call_Totals_Reconciled": True,
        "Test_Calls_Reaching_Route": 4,
        "Test_Qualified_Opportunities": 2,
        "Test_Existing_Customer_Calls": 1,
        "Test_Actual_Avg_Call_Duration_Seconds": 43,
        "Test_Out_Of_Area_Or_Wrong_Fit_Calls": 1,
        "Test_Urgent_Requests": 0,
        "Test_Bookable_Opportunities": None,
        "Test_Office_Follow_Up_Calls": None,
        "Test_Observed_Workflow_Failures": None,
        "Recommended_Paid_Coverage": None,
        "Expected_Monthly_Connected_Minutes_Min": 100,
        "Expected_Monthly_Connected_Minutes_Max": 200,
        "Test_Data_Confidence_Notes": summary["dataConfidenceNotes"],
    }
    evidence = {
        "schema_version": 2,
        "evidence_type": "terminal_report_summary_readback",
        "environment": "Development",
        "operation": operation,
        "crm_readback": crm,
        "observed_at": "2026-08-28T13:00:15.000Z",
    }
    context = {
        "deal_id": summary["dealId"],
        "source_revision": "b" * 40,
        "canonical_summary_json": canonical,
    }
    return (
        evidence,
        context,
        {"analytics_partition_secret": ANALYTICS_KEY},
        "2026-08-28T13:00:20.000Z",
    )


def _bind_terminal_summary(evidence, context, summary, canonical):
    payload = json.dumps(summary, separators=(",", ":"))
    revision = _report_hmac(
        ANALYTICS_KEY, summary["schemaVersion"], "report-revision", canonical
    )
    stable = "\0".join(
        (
            "development",
            summary["dealId"],
            summary["deploymentId"],
            summary["configurationVersion"],
            str(summary["reportSchemaVersion"]),
            summary["callSetDigest"],
            revision,
            "sync_report_summary",
        )
    )
    evidence["operation"]["OPERATION_PAYLOAD_JSON"] = payload
    evidence["operation"]["OPERATION_KEY"] = _report_hmac(
        ANALYTICS_KEY, summary["schemaVersion"], "operation", stable
    )
    evidence["operation"]["OPERATION_FINGERPRINT"] = _report_hmac(
        ANALYTICS_KEY,
        summary["schemaVersion"],
        "fingerprint",
        f"{stable}\0{canonical}",
    )
    context["canonical_summary_json"] = canonical


def _paid_identity(secret, deal_id, material):
    stable = f"development\0{deal_id}\0prepare_paid_subscription"
    canonical = json.dumps(
        [[key, value] for key, value in sorted(material.items())], separators=(",", ":")
    )
    key = hmac.new(
        secret.encode(),
        f"sylvara.crm-billing.idempotency.v1\0operation\0{stable}".encode(),
        hashlib.sha256,
    ).hexdigest()
    fingerprint = hmac.new(
        secret.encode(),
        f"sylvara.crm-billing.idempotency.v1\0fingerprint\0{stable}\0{canonical}".encode(),
        hashlib.sha256,
    ).hexdigest()
    return key, fingerprint


def _billing_fixture(
    *,
    results_review_at="2026-08-28T14:00:00.000Z",
    context_results_review_at=None,
):
    terms_material = {
        "currency": "USD",
        "interval": 1,
        "intervalUnit": "months",
        "commonUsageRateMinor": 11,
        "plans": {
            "Launch::Monthly": {"recurringMinor": 500, "setupMinor": 100},
            "Growth::Monthly": {"recurringMinor": 750, "setupMinor": 250},
            "Scale::Monthly": {"recurringMinor": 1000, "setupMinor": 400},
        },
    }
    acceptance = derive_paid_commercial_terms_acceptance_version(terms_material)
    commercial_terms = {"acceptanceVersion": acceptance, **terms_material}
    deal_id = "100000000000001"
    account_id = "100000000000002"
    crm = {
        "Account_Name": account_id,
        "Results_Review_At": results_review_at,
        "Plan": "Option 2",
        "Billing_Frequency": "Monthly",
        "Monthly_Recurring_Revenue": 7.5,
        "Setup_Fee": 2.5,
        "Subscription_Start_Date": "2026-09-01",
        "Subscription_Acceptance_Status": "Accepted",
        "Subscription_Accepted_At": "2026-08-28T14:05:00.000Z",
        "Subscription_Acceptance_Version": acceptance,
        "Deployment_Record_ID": "deployment-synthetic",
        "Configuration_Version": "configuration-v1",
        "Approved_Deployment_Record_ID": "deployment-synthetic",
        "Approved_Configuration_Version": "configuration-v1",
        "Billing_Automation_Status": "Paid Verified",
        "Billing_Automation_Error": None,
        "Billing_Last_Sync_At": "2026-08-28T14:07:00.000Z",
        "Billing_Customer_ID": "100000000000003",
        "Billing_Subscription_ID": "100000000000004",
        "Subscription_Status": "Active",
    }
    catalog = {
        "billing_organization_id": "billing-test-organization",
        "plan_code_map": {
            "Launch::Monthly": "launch-monthly-synthetic",
            "Growth::Monthly": "growth-monthly-synthetic",
            "Scale::Monthly": "scale-monthly-synthetic",
        },
        "usage_addon_product_id": "usage-product-synthetic",
        "usage_addon_code": "connected-minute-synthetic",
        "usage_addon_unit": "minute",
        "subscription_status_map": {"future": "Scheduled", "live": "Active"},
    }
    material = {
        "accountId": account_id,
        "billingFrequency": "Monthly",
        "billingOrganizationId": catalog["billing_organization_id"],
        "currency": "USD",
        "interval": 1,
        "intervalUnit": "months",
        "plan": "Growth",
        "planCode": catalog["plan_code_map"]["Growth::Monthly"],
        "recurringMinor": 750,
        "resultsReviewAt": crm["Results_Review_At"],
        "setupMinor": 250,
        "subscriptionAcceptanceVersion": acceptance,
        "subscriptionAcceptedAt": crm["Subscription_Accepted_At"],
        "subscriptionStartDate": crm["Subscription_Start_Date"],
        "usageAddonCode": catalog["usage_addon_code"],
        "usageAddonProductId": catalog["usage_addon_product_id"],
        "usageAddonUnit": catalog["usage_addon_unit"],
        "usageRateMinor": 11,
        "deploymentId": crm["Deployment_Record_ID"],
        "configurationVersion": crm["Configuration_Version"],
    }
    key, fingerprint = _paid_identity(IDEMPOTENCY_KEY, deal_id, material)
    operation = {
        "OPERATION_KEY": key,
        "OPERATION_FINGERPRINT": fingerprint,
        "ACTION": "prepare_paid_subscription",
        "CRM_DEAL_ID": deal_id,
        "STATUS": "completed",
        "SOURCE_REVISION": "c" * 40,
        "SOURCE_ENVIRONMENT": "development",
        "LAST_OUTCOME": "paid_subscription_readback_confirmed",
        "OPERATION_VERSION": 3,
        "CREATED_AT": "2026-08-28T14:05:10.000Z",
        "UPDATED_AT": "2026-08-28T14:07:10.000Z",
    }
    billing = {
        "customer_id": crm["Billing_Customer_ID"],
        "customer_crm_reference": account_id,
        "subscription_id": crm["Billing_Subscription_ID"],
        "subscription_reference": f"syl-paid-{key[:32]}",
        "plan_code": catalog["plan_code_map"]["Growth::Monthly"],
        "billing_organization_id": catalog["billing_organization_id"],
        "currency": "USD",
        "recurring_minor": 750,
        "setup_minor": 250,
        "usage_addon_product_id": catalog["usage_addon_product_id"],
        "usage_addon_code": catalog["usage_addon_code"],
        "usage_addon_unit": catalog["usage_addon_unit"],
        "usage_rate_minor": 11,
        "subscription_start_date": crm["Subscription_Start_Date"],
        "provider_subscription_status": "live",
        "crm_subscription_status": "Active",
        "observed_at": "2026-08-28T14:06:00.000Z",
    }
    evidence = {
        "schema_version": 1,
        "evidence_type": "billing_closed_won_reconciliation",
        "environment": "Development",
        "request_action": "reconcile",
        "created_resource_count": 0,
        "operation": operation,
        "crm_readback": crm,
        "billing_readback": billing,
        "observed_at": "2026-08-28T14:07:20.000Z",
        "reconciliation_receipt": "",
    }
    evidence["reconciliation_receipt"] = billing_reconciliation_receipt(
        evidence, RECONCILIATION_KEY
    )
    context = {
        "deal_id": deal_id,
        "account_id": account_id,
        "source_revision": "c" * 40,
        "results_review_at": context_results_review_at or results_review_at,
        "commercial_terms": commercial_terms,
        "catalog": catalog,
    }
    return (
        evidence,
        context,
        {
            "idempotency_pepper": IDEMPOTENCY_KEY,
            "reconciliation_evidence_secret": RECONCILIATION_KEY,
        },
        "2026-08-28T14:07:25.000Z",
    )


class ExternalEvidenceValidatorTests(unittest.TestCase):
    def _assert_valid(self, contract_id, fixture):
        evidence, context, secrets, transition_at = fixture
        result = validate_external_evidence(
            contract_id,
            evidence,
            context,
            secrets,
            transition_at=transition_at,
        )
        self.assertEqual(result.contract_id, contract_id)
        self.assertFalse(result.mutation_performed)
        self.assertFalse(result.one_time_consumption_runtime_enforced)
        self.assertEqual(
            result.one_time_consumption_readback_validated,
            contract_id in {INTERNAL_APPROVAL, ROUTE_ACTIVATION, ROUTE_INACTIVE},
        )
        rendered = repr(result)
        for private_value in ("100000000000001", "deployment-synthetic", "configuration-v1"):
            self.assertNotIn(private_value, rendered)
        return result

    def test_all_five_repository_validators_accept_exact_synthetic_evidence(self):
        fixtures = {
            INTERNAL_APPROVAL: _approval_fixture(),
            ROUTE_ACTIVATION: _activation_fixture(),
            TERMINAL_REPORT: _terminal_fixture(),
            ROUTE_INACTIVE: _inactive_fixture(),
            BILLING_RECONCILIATION: _billing_fixture(),
        }
        for contract_id, fixture in fixtures.items():
            with self.subTest(contract_id=contract_id):
                self._assert_valid(contract_id, fixture)

    def test_python_canonicalization_matches_authoritative_node_known_vectors(self):
        approval = _approval_fixture()
        self.assertEqual(
            approval[1]["approval_intent_signature"],
            "v1=aa2cc16ee59c1d4abc737e89a610be2325c9c16569bebdc714c60911fa2cff8b",
        )
        activation = _activation_fixture()
        self.assertEqual(
            activation[1]["activation_intent_signature"],
            "v1=e15673259bb90171f17ad53a75f971556836b4fd98c80564cab30cad22f40573",
        )
        terminal_operation = _terminal_fixture()[0]["operation"]
        self.assertEqual(
            terminal_operation["OPERATION_KEY"],
            "65235616299a379d5f6210ebd2e937e90f4192d6afa36622fb8315fb7acf4bf5",
        )
        self.assertEqual(
            terminal_operation["OPERATION_FINGERPRINT"],
            "ef3cef33b60a8fb7c47e7481706ad32cd4a899fc0fcc0a642f139524f6b4258c",
        )
        billing = _billing_fixture()
        self.assertEqual(
            billing[1]["commercial_terms"]["acceptanceVersion"],
            "terms-v1:483835d9add2a9b8b292201cd451f5ac8ee7e7301a87d4274308efc3027d1051",
        )
        self.assertEqual(
            billing[0]["operation"]["OPERATION_KEY"],
            "e7075cdc0defca57cf3df010eecdd765f527d8e9397470d7bc0c5a5bbe86807f",
        )
        self.assertEqual(
            billing[0]["operation"]["OPERATION_FINGERPRINT"],
            "c43371ecc0fe7c08dc30f7c3ae794f2db5daf8c3cbc18bf592a597434cfd16a9",
        )

    def test_internal_approval_rejects_wrong_binding_stale_evidence_and_replay(self):
        evidence, context, secrets, transition_at = _approval_fixture()
        evidence["deal_binding_digest"] = "0" * 64
        _seal(INTERNAL_APPROVAL, evidence)
        context["consumption"] = _consumption(
            INTERNAL_APPROVAL,
            evidence,
            (
                "environment",
                "deal_binding_digest",
                "approval_event_binding_digest",
                "evidence_nonce_digest",
            ),
            "2026-08-28T12:00:31.000Z",
            "2026-08-28T12:00:32.000Z",
        )
        with self.assertRaises(EvidenceValidationError):
            validate_external_evidence(
                INTERNAL_APPROVAL, evidence, context, secrets, transition_at=transition_at
            )

        evidence, context, secrets, _ = _approval_fixture()
        with self.assertRaisesRegex(EvidenceValidationError, "approval_evidence_stale"):
            validate_external_evidence(
                INTERNAL_APPROVAL,
                evidence,
                context,
                secrets,
                transition_at="2026-08-28T12:06:00.000Z",
            )

        evidence, context, secrets, transition_at = _approval_fixture()
        context["consumption"]["replay_detected"] = True
        with self.assertRaisesRegex(EvidenceValidationError, "consumption_readback_invalid"):
            validate_external_evidence(
                INTERNAL_APPROVAL, evidence, context, secrets, transition_at=transition_at
            )

    def test_internal_approval_rejects_signature_failure_and_secret_reuse(self):
        evidence, context, secrets, transition_at = _approval_fixture()
        context["approval_intent_signature"] = f"v1={'0' * 64}"
        with self.assertRaisesRegex(EvidenceValidationError, "approval_intent_signature_invalid"):
            validate_external_evidence(
                INTERNAL_APPROVAL, evidence, context, secrets, transition_at=transition_at
            )

    def test_signed_intents_cannot_be_replayed_for_another_deal(self):
        other_deal_id = "100000000000002"

        evidence, context, secrets, transition_at = _approval_fixture()
        context["deal_id"] = other_deal_id
        with self.assertRaisesRegex(
            EvidenceValidationError, "approval_current_binding_invalid"
        ):
            validate_external_evidence(
                INTERNAL_APPROVAL,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

        evidence, context, secrets, transition_at = _activation_fixture()
        context["deal_id"] = other_deal_id
        context["approval_consumption_readback"]["unique_scope"][
            "deal_binding_digest"
        ] = derive_binding_digest(
            APPROVAL_EVIDENCE_KEY,
            "sylvara.crm.internal-approval-receipt.v1.deal",
            other_deal_id,
        )
        with self.assertRaisesRegex(
            EvidenceValidationError, "activation_current_binding_invalid"
        ):
            validate_external_evidence(
                ROUTE_ACTIVATION,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

    def test_activation_requires_prior_approval_consumption_for_the_same_deal(self):
        evidence, context, secrets, transition_at = _activation_fixture()
        context["approval_consumption_readback"]["unique_scope"][
            "deal_binding_digest"
        ] = derive_binding_digest(
            APPROVAL_EVIDENCE_KEY,
            "sylvara.crm.internal-approval-receipt.v1.deal",
            "100000000000002",
        )
        with self.assertRaisesRegex(EvidenceValidationError, "activation_chain_invalid"):
            validate_external_evidence(
                ROUTE_ACTIVATION,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

    def test_activation_separates_approval_scope_activation_receipt_and_operator_keys(self):
        evidence, context, secrets, transition_at = _activation_fixture()
        self.assertEqual(len(set(secrets.values())), 3)
        self._assert_valid(
            ROUTE_ACTIVATION, (evidence, context, secrets, transition_at)
        )

        evidence, context, secrets, transition_at = _activation_fixture()
        secrets["approval_evidence_secret"] = "w" * 43
        with self.assertRaisesRegex(EvidenceValidationError, "activation_chain_invalid"):
            validate_external_evidence(
                ROUTE_ACTIVATION,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

        for target, source in (
            ("approval_evidence_secret", "evidence_secret"),
            ("approval_evidence_secret", "operator_verification_secret"),
            ("operator_verification_secret", "evidence_secret"),
        ):
            with self.subTest(target=target, source=source):
                evidence, context, secrets, transition_at = _activation_fixture()
                secrets[target] = secrets[source]
                with self.assertRaisesRegex(
                    EvidenceValidationError,
                    "activation_secret_independence_invalid",
                ):
                    validate_external_evidence(
                        ROUTE_ACTIVATION,
                        evidence,
                        context,
                        secrets,
                        transition_at=transition_at,
                    )

        evidence, context, secrets, transition_at = _activation_fixture()
        del secrets["approval_evidence_secret"]
        with self.assertRaisesRegex(
            EvidenceValidationError, "activation_secret_set_invalid"
        ):
            validate_external_evidence(
                ROUTE_ACTIVATION,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

    def test_signed_intent_deal_ids_use_the_crm_record_id_grammar(self):
        cases = (
            (
                INTERNAL_APPROVAL,
                _approval_fixture,
                "approval_intent",
                "approval_intent_invalid",
                "approval_context_invalid",
            ),
            (
                ROUTE_ACTIVATION,
                _activation_fixture,
                "activation_intent",
                "activation_intent_invalid",
                "activation_context_invalid",
            ),
        )
        for (
            contract_id,
            fixture_factory,
            intent_key,
            intent_error_code,
            context_error_code,
        ) in cases:
            with self.subTest(contract_id=contract_id):
                evidence, context, secrets, transition_at = fixture_factory()
                context[intent_key]["deal_id"] = "not-a-crm-record-id"
                with self.assertRaisesRegex(EvidenceValidationError, intent_error_code):
                    validate_external_evidence(
                        contract_id,
                        evidence,
                        context,
                        secrets,
                        transition_at=transition_at,
                    )

            with self.subTest(contract_id=contract_id, source="current_context"):
                evidence, context, secrets, transition_at = fixture_factory()
                context["deal_id"] = "not-a-crm-record-id"
                with self.assertRaisesRegex(EvidenceValidationError, context_error_code):
                    validate_external_evidence(
                        contract_id,
                        evidence,
                        context,
                        secrets,
                        transition_at=transition_at,
                    )

    def test_signed_intents_reject_stale_authoritative_prestate(self):
        evidence, context, secrets, transition_at = _approval_fixture()
        context["approval_intent"]["evidence_observed_at"] = (
            "2026-08-28T11:40:00.000Z"
        )
        evidence["approval_prestate_observed_at"] = "2026-08-28T11:40:00.000Z"
        signature = approval_intent_signature(context["approval_intent"], OPERATOR_KEY)
        context["approval_intent_signature"] = signature
        evidence["approval_intent_signature_digest"] = derive_binding_digest(
            APPROVAL_EVIDENCE_KEY,
            "sylvara.crm.internal-approval-receipt.v1.intent-signature",
            signature,
        )
        _reseal_consumed_evidence(INTERNAL_APPROVAL, evidence, context)
        with self.assertRaisesRegex(EvidenceValidationError, "approval_intent_stale"):
            validate_external_evidence(
                INTERNAL_APPROVAL,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

        evidence, context, secrets, transition_at = _approval_fixture()
        context["approval_intent"]["evidence_observed_at"] = (
            "2026-08-28T11:45:15.000Z"
        )
        evidence["approval_prestate_observed_at"] = (
            "2026-08-28T11:45:15.000Z"
        )
        signature = approval_intent_signature(
            context["approval_intent"], OPERATOR_KEY
        )
        context["approval_intent_signature"] = signature
        evidence["approval_intent_signature_digest"] = derive_binding_digest(
            APPROVAL_EVIDENCE_KEY,
            "sylvara.crm.internal-approval-receipt.v1.intent-signature",
            signature,
        )
        _reseal_consumed_evidence(INTERNAL_APPROVAL, evidence, context)
        with self.assertRaisesRegex(EvidenceValidationError, "approval_intent_stale"):
            validate_external_evidence(
                INTERNAL_APPROVAL,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

        evidence, context, secrets, transition_at = _activation_fixture()
        evidence["approval_decided_at"] = "2026-08-28T11:39:50.000Z"
        context["crm_readback"]["Go_Live_Approved_At"] = (
            "2026-08-28T11:39:50.000Z"
        )
        context["activation_intent"]["route_observed_at"] = (
            "2026-08-28T11:40:00.000Z"
        )
        context["activation_intent"]["evidence_observed_at"] = (
            "2026-08-28T11:40:00.000Z"
        )
        evidence["route_observed_at"] = "2026-08-28T11:40:00.000Z"
        evidence["activation_prestate_observed_at"] = "2026-08-28T11:40:00.000Z"
        signature = activation_intent_signature(context["activation_intent"], OPERATOR_KEY)
        context["activation_intent_signature"] = signature
        evidence["activation_intent_signature_digest"] = derive_binding_digest(
            EVIDENCE_KEY,
            "sylvara.crm.route-activation-readback.v1.intent-signature",
            signature,
        )
        _reseal_consumed_evidence(ROUTE_ACTIVATION, evidence, context)
        with self.assertRaisesRegex(
            EvidenceValidationError, "activation_chronology_invalid"
        ):
            validate_external_evidence(
                ROUTE_ACTIVATION,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

    def test_signed_intents_require_incremented_authoritative_poststate_version(self):
        cases = (
            (
                INTERNAL_APPROVAL,
                _approval_fixture,
                "approval_current_binding_invalid",
            ),
            (
                ROUTE_ACTIVATION,
                _activation_fixture,
                "activation_current_binding_invalid",
            ),
        )
        for contract_id, fixture_factory, error_code in cases:
            with self.subTest(contract_id=contract_id):
                evidence, context, secrets, transition_at = fixture_factory()
                context["authoritative_current_deployment_version"] += 1
                with self.assertRaisesRegex(EvidenceValidationError, error_code):
                    validate_external_evidence(
                        contract_id,
                        evidence,
                        context,
                        secrets,
                        transition_at=transition_at,
                    )

        evidence, context, secrets, transition_at = _approval_fixture()
        context["approval_intent"]["expected_deployment_version"] = (
            9_007_199_254_740_992
        )
        context["authoritative_current_deployment_version"] = (
            9_007_199_254_740_992
        )
        with self.assertRaisesRegex(EvidenceValidationError, "approval_intent_invalid"):
            validate_external_evidence(
                INTERNAL_APPROVAL,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

        evidence, context, secrets, transition_at = _approval_fixture()
        secrets["operator_verification_secret"] = APPROVAL_EVIDENCE_KEY
        with self.assertRaisesRegex(
            EvidenceValidationError, "approval_secret_independence_invalid"
        ):
            validate_external_evidence(
                INTERNAL_APPROVAL, evidence, context, secrets, transition_at=transition_at
            )

        evidence, context, secrets, transition_at = _approval_fixture()
        context["approval_intent"]["schema_version"] = True
        with self.assertRaisesRegex(EvidenceValidationError, "approval_intent_invalid"):
            validate_external_evidence(
                INTERNAL_APPROVAL, evidence, context, secrets, transition_at=transition_at
            )

    def test_activation_rejects_broken_chain_wrong_expiry_and_inactive_provider(self):
        evidence, context, secrets, transition_at = _activation_fixture()
        context["activation_previous_event_hash"] = "9" * 64
        with self.assertRaisesRegex(EvidenceValidationError, "activation_chain_invalid"):
            validate_external_evidence(
                ROUTE_ACTIVATION, evidence, context, secrets, transition_at=transition_at
            )

        evidence, context, secrets, transition_at = _activation_fixture()
        evidence["expires_at"] = "2026-09-04T12:00:04.000Z"
        _seal(ROUTE_ACTIVATION, evidence)
        context["consumption"]["evidence_receipt"] = evidence["evidence_receipt"]
        with self.assertRaisesRegex(EvidenceValidationError, "activation_chronology_invalid"):
            validate_external_evidence(
                ROUTE_ACTIVATION, evidence, context, secrets, transition_at=transition_at
            )

        evidence, context, secrets, transition_at = _activation_fixture()
        evidence["provider_route_state"] = "inactive"
        _seal(ROUTE_ACTIVATION, evidence)
        context["consumption"]["evidence_receipt"] = evidence["evidence_receipt"]
        with self.assertRaisesRegex(EvidenceValidationError, "activation_claim_invalid"):
            validate_external_evidence(
                ROUTE_ACTIVATION, evidence, context, secrets, transition_at=transition_at
            )

        evidence, context, secrets, transition_at = _activation_fixture()
        context["activation_intent"]["evidence_observed_at"] = (
            "2026-08-28T12:00:01.000Z"
        )
        evidence["activation_prestate_observed_at"] = (
            "2026-08-28T12:00:01.000Z"
        )
        signature = activation_intent_signature(
            context["activation_intent"], OPERATOR_KEY
        )
        context["activation_intent_signature"] = signature
        evidence["activation_intent_signature_digest"] = derive_binding_digest(
            EVIDENCE_KEY,
            "sylvara.crm.route-activation-readback.v1.intent-signature",
            signature,
        )
        _reseal_consumed_evidence(ROUTE_ACTIVATION, evidence, context)
        with self.assertRaisesRegex(
            EvidenceValidationError, "activation_chronology_invalid"
        ):
            validate_external_evidence(
                ROUTE_ACTIVATION,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

    def test_route_inactive_requires_exact_null_binding_and_both_inactive_states(self):
        self._assert_valid(ROUTE_INACTIVE, _inactive_fixture())

        evidence, context, secrets, transition_at = _inactive_fixture()
        context["deal_id"] = "not-a-crm-record-id"
        with self.assertRaisesRegex(
            EvidenceValidationError, "route_inactive_context_invalid"
        ):
            validate_external_evidence(
                ROUTE_INACTIVE,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

        evidence, context, secrets, transition_at = _inactive_fixture()
        context["crm_readback"]["Deployment_Record_ID"] = "deployment-synthetic"
        with self.assertRaisesRegex(EvidenceValidationError, "route_inactive_binding_invalid"):
            validate_external_evidence(
                ROUTE_INACTIVE, evidence, context, secrets, transition_at=transition_at
            )

        for field in ("Deployment_Record_ID", "Configuration_Version"):
            with self.subTest(tagged_null_binding=field):
                evidence, context, secrets, transition_at = _inactive_fixture()
                context["crm_readback"][field] = "sylvara:null:v1"
                with self.assertRaisesRegex(
                    EvidenceValidationError, "route_inactive_binding_invalid"
                ):
                    validate_external_evidence(
                        ROUTE_INACTIVE,
                        evidence,
                        context,
                        secrets,
                        transition_at=transition_at,
                    )

        evidence, context, secrets, transition_at = _inactive_fixture()
        evidence["route_registry_state"] = "active"
        _seal(ROUTE_INACTIVE, evidence)
        context["consumption"]["evidence_receipt"] = evidence["evidence_receipt"]
        with self.assertRaisesRegex(EvidenceValidationError, "route_inactive_claim_invalid"):
            validate_external_evidence(
                ROUTE_INACTIVE, evidence, context, secrets, transition_at=transition_at
            )

    def test_terminal_report_requires_operation_identity_and_present_exact_nulls(self):
        self._assert_valid(TERMINAL_REPORT, _terminal_fixture())

        for field in ("Deployment_Record_ID", "Configuration_Version"):
            with self.subTest(current_binding=field):
                evidence, context, secrets, transition_at = _terminal_fixture()
                evidence["crm_readback"][field] = f"different-{field.lower()}"
                with self.assertRaisesRegex(
                    EvidenceValidationError,
                    "terminal_report_crm_readback_invalid",
                ):
                    validate_external_evidence(
                        TERMINAL_REPORT,
                        evidence,
                        context,
                        secrets,
                        transition_at=transition_at,
                    )

        evidence, context, secrets, transition_at = _terminal_fixture()
        evidence["crm_readback"].pop("Test_Bookable_Opportunities")
        with self.assertRaisesRegex(
            EvidenceValidationError, "terminal_report_crm_readback_invalid"
        ):
            validate_external_evidence(
                TERMINAL_REPORT, evidence, context, secrets, transition_at=transition_at
            )

        evidence, context, secrets, transition_at = _terminal_fixture()
        evidence["operation"]["OPERATION_FINGERPRINT"] = "0" * 64
        with self.assertRaisesRegex(EvidenceValidationError, "terminal_report_operation_invalid"):
            validate_external_evidence(
                TERMINAL_REPORT, evidence, context, secrets, transition_at=transition_at
            )

        evidence, context, secrets, _ = _terminal_fixture()
        with self.assertRaisesRegex(EvidenceValidationError, "terminal_report_evidence_stale"):
            validate_external_evidence(
                TERMINAL_REPORT,
                evidence,
                context,
                secrets,
                transition_at="2026-08-28T13:06:00.000Z",
            )

        for field, alias in (
            ("Test_Urgent_Requests", False),
            ("Call_Totals_Reconciled", 1),
        ):
            with self.subTest(strict_crm_type=field):
                evidence, context, secrets, transition_at = _terminal_fixture()
                evidence["crm_readback"][field] = alias
                with self.assertRaisesRegex(
                    EvidenceValidationError,
                    "terminal_report_crm_readback_invalid",
                ):
                    validate_external_evidence(
                        TERMINAL_REPORT,
                        evidence,
                        context,
                        secrets,
                        transition_at=transition_at,
                    )

    def test_terminal_report_uses_authoritative_javascript_canonical_number_bytes(self):
        cases = ((1e-7, "1e-07", "1e-7"), (1e-6, "1e-06", "0.000001"))
        for value, python_number, javascript_number in cases:
            with self.subTest(value=value):
                evidence, context, secrets, transition_at = _terminal_fixture()
                summary = json.loads(evidence["operation"]["OPERATION_PAYLOAD_JSON"])
                summary["actualAverageCallDurationSeconds"] = value
                python_canonical = json.dumps(
                    list(map(list, summary.items())), separators=(",", ":")
                )
                self.assertIn(python_number, python_canonical)
                javascript_canonical = python_canonical.replace(
                    python_number, javascript_number
                )
                self.assertNotEqual(python_canonical, javascript_canonical)
                _bind_terminal_summary(
                    evidence, context, summary, javascript_canonical
                )
                evidence["crm_readback"]["Test_Actual_Avg_Call_Duration_Seconds"] = 0
                self._assert_valid(
                    TERMINAL_REPORT,
                    (evidence, context, secrets, transition_at),
                )

    def test_terminal_report_enforces_authoritative_identifier_width(self):
        for field, crm_field in (
            ("deploymentId", "Deployment_Record_ID"),
            ("configurationVersion", "Configuration_Version"),
        ):
            with self.subTest(field=field):
                evidence, context, secrets, transition_at = _terminal_fixture()
                summary = json.loads(evidence["operation"]["OPERATION_PAYLOAD_JSON"])
                summary[field] = "x" * 101
                canonical = json.dumps(
                    list(map(list, summary.items())), separators=(",", ":")
                )
                _bind_terminal_summary(evidence, context, summary, canonical)
                evidence["crm_readback"][crm_field] = summary[field]
                with self.assertRaisesRegex(
                    EvidenceValidationError, "terminal_report_identity_invalid"
                ):
                    validate_external_evidence(
                        TERMINAL_REPORT,
                        evidence,
                        context,
                        secrets,
                        transition_at=transition_at,
                    )

    def test_crm_datetimes_compare_as_normalized_instants(self):
        evidence, context, secrets, transition_at = _approval_fixture()
        context["operator_input"]["Go_Live_Approved_At"] = (
            "2026-08-28T07:00:20-05:00"
        )
        self._assert_valid(
            INTERNAL_APPROVAL, (evidence, context, secrets, transition_at)
        )

        evidence, context, secrets, transition_at = _activation_fixture()
        context["crm_readback"]["Go_Live_Approved_At"] = (
            "2026-08-28T06:59:50-05:00"
        )
        context["crm_readback"]["Test_Start_At"] = "2026-08-28T07:00:03-05:00"
        self._assert_valid(
            ROUTE_ACTIVATION, (evidence, context, secrets, transition_at)
        )

        evidence, context, secrets, transition_at = _inactive_fixture()
        context["crm_readback"]["Rollback_Completed_At"] = (
            "2026-08-28T07:00:05-05:00"
        )
        self._assert_valid(
            ROUTE_INACTIVE, (evidence, context, secrets, transition_at)
        )

        evidence, context, secrets, transition_at = _terminal_fixture()
        evidence["crm_readback"]["Test_Start_At"] = "2026-08-20T07:00:00-05:00"
        evidence["crm_readback"]["Test_End_At"] = "2026-08-27T07:00:00-05:00"
        self._assert_valid(
            TERMINAL_REPORT, (evidence, context, secrets, transition_at)
        )

        # This is the exact offset shape used by the authoritative JavaScript
        # lifecycle fixture. The operation fingerprint must preserve those bytes,
        # while the private context may express the same instant in UTC.
        evidence, context, secrets, transition_at = _billing_fixture(
            results_review_at="2026-08-21T09:00:00-05:00",
            context_results_review_at="2026-08-21T14:00:00.000Z",
        )
        self.assertEqual(
            evidence["operation"]["OPERATION_FINGERPRINT"],
            "d3640102fb14ea484e9f079bcf85c85b7024a09c2f510176854a58f1f74d8b54",
        )
        evidence["crm_readback"]["Billing_Last_Sync_At"] = (
            "2026-08-28T09:07:00-05:00"
        )
        evidence["reconciliation_receipt"] = billing_reconciliation_receipt(
            evidence, RECONCILIATION_KEY
        )
        self._assert_valid(
            BILLING_RECONCILIATION, (evidence, context, secrets, transition_at)
        )

    def test_billing_reconciliation_binds_current_account_and_results_review_state(self):
        different_account_id = "100000000000009"

        evidence, context, secrets, transition_at = _billing_fixture()
        evidence["crm_readback"]["Account_Name"] = different_account_id
        evidence["reconciliation_receipt"] = billing_reconciliation_receipt(
            evidence, RECONCILIATION_KEY
        )
        with self.assertRaisesRegex(
            EvidenceValidationError, "billing_crm_readback_invalid"
        ) as captured:
            validate_external_evidence(
                BILLING_RECONCILIATION,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )
        self.assertNotIn(different_account_id, str(captured.exception))

        evidence, context, secrets, transition_at = _billing_fixture()
        evidence["crm_readback"]["Account_Name"] = different_account_id
        context["account_id"] = different_account_id
        evidence["reconciliation_receipt"] = billing_reconciliation_receipt(
            evidence, RECONCILIATION_KEY
        )
        with self.assertRaisesRegex(EvidenceValidationError, "billing_operation_invalid"):
            validate_external_evidence(
                BILLING_RECONCILIATION,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

        stale_results_review_at = "2026-08-28T14:01:00.000Z"
        evidence, context, secrets, transition_at = _billing_fixture()
        evidence["crm_readback"]["Results_Review_At"] = stale_results_review_at
        evidence["reconciliation_receipt"] = billing_reconciliation_receipt(
            evidence, RECONCILIATION_KEY
        )
        with self.assertRaisesRegex(
            EvidenceValidationError, "billing_crm_readback_invalid"
        ) as captured:
            validate_external_evidence(
                BILLING_RECONCILIATION,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )
        self.assertNotIn(stale_results_review_at, str(captured.exception))

        evidence, context, secrets, transition_at = _billing_fixture()
        evidence["crm_readback"]["Results_Review_At"] = stale_results_review_at
        context["results_review_at"] = stale_results_review_at
        evidence["reconciliation_receipt"] = billing_reconciliation_receipt(
            evidence, RECONCILIATION_KEY
        )
        with self.assertRaisesRegex(EvidenceValidationError, "billing_operation_invalid"):
            validate_external_evidence(
                BILLING_RECONCILIATION,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

    def test_billing_reconciliation_recomputes_current_fingerprint_and_is_noncreating(self):
        self._assert_valid(BILLING_RECONCILIATION, _billing_fixture())

        evidence, context, secrets, transition_at = _billing_fixture()
        evidence["billing_readback"]["observed_at"] = (
            "2026-08-28T14:07:15.000Z"
        )
        evidence["reconciliation_receipt"] = billing_reconciliation_receipt(
            evidence, RECONCILIATION_KEY
        )
        self._assert_valid(
            BILLING_RECONCILIATION,
            (evidence, context, secrets, transition_at),
        )

        evidence, context, secrets, transition_at = _billing_fixture()
        evidence["created_resource_count"] = 1
        with self.assertRaisesRegex(EvidenceValidationError, "billing_evidence_invalid"):
            validate_external_evidence(
                BILLING_RECONCILIATION,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

        evidence, context, secrets, transition_at = _billing_fixture()
        evidence["crm_readback"]["Monthly_Recurring_Revenue"] = 7.51
        with self.assertRaisesRegex(EvidenceValidationError, "billing_crm_readback_invalid"):
            validate_external_evidence(
                BILLING_RECONCILIATION,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

        evidence, context, secrets, transition_at = _billing_fixture()
        evidence["billing_readback"]["usage_rate_minor"] = 12
        with self.assertRaisesRegex(EvidenceValidationError, "billing_provider_readback_invalid"):
            validate_external_evidence(
                BILLING_RECONCILIATION,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

        for field, approved_field, invalid_value in (
            (
                "Deployment_Record_ID",
                "Approved_Deployment_Record_ID",
                "x" * 101,
            ),
            (
                "Configuration_Version",
                "Approved_Configuration_Version",
                "x" * 101,
            ),
            (
                "Deployment_Record_ID",
                "Approved_Deployment_Record_ID",
                "deployment.invalid",
            ),
        ):
            with self.subTest(private_identifier=field, invalid_value=invalid_value):
                evidence, context, secrets, transition_at = _billing_fixture()
                evidence["crm_readback"][field] = invalid_value
                evidence["crm_readback"][approved_field] = invalid_value
                with self.assertRaisesRegex(
                    EvidenceValidationError, "billing_crm_readback_invalid"
                ):
                    validate_external_evidence(
                        BILLING_RECONCILIATION,
                        evidence,
                        context,
                        secrets,
                        transition_at=transition_at,
                    )

        evidence, context, secrets, _ = _billing_fixture()
        with self.assertRaisesRegex(EvidenceValidationError, "billing_evidence_stale"):
            validate_external_evidence(
                BILLING_RECONCILIATION,
                evidence,
                context,
                secrets,
                transition_at="2026-08-28T14:13:00.000Z",
            )

    def test_billing_reconciliation_requires_exact_currency_unit_and_status_semantics(self):
        _, context, _, _ = _billing_fixture()
        cad_terms = {
            key: value
            for key, value in context["commercial_terms"].items()
            if key != "acceptanceVersion"
        }
        cad_terms["currency"] = "CAD"
        with self.assertRaisesRegex(EvidenceValidationError, "commercial_terms_invalid"):
            derive_paid_commercial_terms_acceptance_version(cad_terms)

        for status_map in (
            {"future": "Active", "live": "Scheduled"},
            {"future": "Pending", "live": "Active"},
        ):
            with self.subTest(status_map=status_map):
                evidence, context, secrets, transition_at = _billing_fixture()
                context["catalog"]["subscription_status_map"] = status_map
                with self.assertRaisesRegex(
                    EvidenceValidationError, "billing_catalog_invalid"
                ):
                    validate_external_evidence(
                        BILLING_RECONCILIATION,
                        evidence,
                        context,
                        secrets,
                        transition_at=transition_at,
                    )

        evidence, context, secrets, transition_at = _billing_fixture()
        context["catalog"]["usage_addon_unit"] = "connected_minute"
        with self.assertRaisesRegex(EvidenceValidationError, "billing_catalog_invalid"):
            validate_external_evidence(
                BILLING_RECONCILIATION,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

        for field, value in (
            ("usage_addon_unit", "connected_minute"),
            ("provider_subscription_status", "future"),
            ("currency", "CAD"),
        ):
            with self.subTest(provider_field=field):
                evidence, context, secrets, transition_at = _billing_fixture()
                evidence["billing_readback"][field] = value
                with self.assertRaisesRegex(
                    EvidenceValidationError, "billing_provider_readback_invalid"
                ):
                    validate_external_evidence(
                        BILLING_RECONCILIATION,
                        evidence,
                        context,
                        secrets,
                        transition_at=transition_at,
                    )

        evidence, context, secrets, transition_at = _billing_fixture()
        context["commercial_terms"]["currency"] = "CAD"
        with self.assertRaisesRegex(EvidenceValidationError, "commercial_terms_invalid"):
            validate_external_evidence(
                BILLING_RECONCILIATION,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

    def test_billing_reconciliation_rejects_cross_organization_signed_readback(self):
        evidence, context, secrets, transition_at = _billing_fixture()
        original_receipt = evidence["reconciliation_receipt"]
        different_organization = "different-synthetic-test-organization"
        evidence["billing_readback"]["billing_organization_id"] = different_organization
        resealed_receipt = billing_reconciliation_receipt(
            evidence, RECONCILIATION_KEY
        )
        self.assertNotEqual(resealed_receipt, original_receipt)
        evidence["reconciliation_receipt"] = resealed_receipt
        with self.assertRaisesRegex(
            EvidenceValidationError, "billing_provider_readback_invalid"
        ) as captured:
            validate_external_evidence(
                BILLING_RECONCILIATION,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )
        self.assertNotIn(different_organization, str(captured.exception))

    def test_billing_reconciliation_authenticates_noncreating_claims_and_order(self):
        evidence, context, secrets, transition_at = _billing_fixture()
        evidence["reconciliation_receipt"] = "0" * 64
        with self.assertRaisesRegex(
            EvidenceValidationError, "billing_reconciliation_receipt_invalid"
        ):
            validate_external_evidence(
                BILLING_RECONCILIATION,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

        evidence, context, secrets, transition_at = _billing_fixture()
        secrets["reconciliation_evidence_secret"] = IDEMPOTENCY_KEY
        with self.assertRaisesRegex(
            EvidenceValidationError, "billing_secret_independence_invalid"
        ):
            validate_external_evidence(
                BILLING_RECONCILIATION,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

        evidence, context, secrets, transition_at = _billing_fixture()
        evidence["created_resource_count"] = False
        with self.assertRaisesRegex(EvidenceValidationError, "billing_evidence_invalid"):
            validate_external_evidence(
                BILLING_RECONCILIATION,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

        evidence, context, secrets, transition_at = _billing_fixture()
        evidence["created_resource_count"] = 9_007_199_254_740_992
        with self.assertRaisesRegex(EvidenceValidationError, "billing_evidence_invalid"):
            validate_external_evidence(
                BILLING_RECONCILIATION,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

        evidence, context, secrets, transition_at = _billing_fixture()
        evidence["operation"]["CREATED_AT"] = "2026-08-28T14:04:59.000Z"
        evidence["reconciliation_receipt"] = billing_reconciliation_receipt(
            evidence, RECONCILIATION_KEY
        )
        with self.assertRaisesRegex(EvidenceValidationError, "billing_chronology_invalid"):
            validate_external_evidence(
                BILLING_RECONCILIATION,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

        evidence, context, secrets, transition_at = _billing_fixture()
        evidence["billing_readback"]["observed_at"] = "2026-08-28T14:05:05.000Z"
        evidence["reconciliation_receipt"] = billing_reconciliation_receipt(
            evidence, RECONCILIATION_KEY
        )
        with self.assertRaisesRegex(EvidenceValidationError, "billing_chronology_invalid"):
            validate_external_evidence(
                BILLING_RECONCILIATION,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

        evidence, context, secrets, _ = _billing_fixture()
        evidence["observed_at"] = "2026-08-29T14:07:20.000Z"
        evidence["reconciliation_receipt"] = billing_reconciliation_receipt(
            evidence, RECONCILIATION_KEY
        )
        with self.assertRaisesRegex(
            EvidenceValidationError, "billing_provider_readback_stale"
        ):
            validate_external_evidence(
                BILLING_RECONCILIATION,
                evidence,
                context,
                secrets,
                transition_at="2026-08-29T14:07:25.000Z",
            )

    def test_malformed_nested_scalars_fail_closed_without_value_echo(self):
        marker = "PRIVATE-SYNTHETIC-MARKER"
        evidence, context, secrets, transition_at = _terminal_fixture()
        summary = json.loads(evidence["operation"]["OPERATION_PAYLOAD_JSON"])
        summary["testEndReason"] = [marker]
        evidence["operation"]["OPERATION_PAYLOAD_JSON"] = json.dumps(
            summary, separators=(",", ":")
        )
        with self.assertRaises(EvidenceValidationError) as captured:
            validate_external_evidence(
                TERMINAL_REPORT,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )
        self.assertNotIn(marker, str(captured.exception))

        evidence, context, secrets, transition_at = _billing_fixture()
        evidence["crm_readback"]["Plan"] = [marker]
        with self.assertRaises(EvidenceValidationError) as captured:
            validate_external_evidence(
                BILLING_RECONCILIATION,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )
        self.assertNotIn(marker, str(captured.exception))

        evidence, context, secrets, transition_at = _billing_fixture()
        evidence["billing_readback"]["provider_subscription_status"] = [marker]
        with self.assertRaises(EvidenceValidationError) as captured:
            validate_external_evidence(
                BILLING_RECONCILIATION,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )
        self.assertNotIn(marker, str(captured.exception))

        evidence, context, secrets, transition_at = _billing_fixture()
        evidence["crm_readback"]["Deployment_Record_ID"] = True
        evidence["crm_readback"]["Approved_Deployment_Record_ID"] = True
        with self.assertRaisesRegex(
            EvidenceValidationError, "billing_crm_readback_invalid"
        ):
            validate_external_evidence(
                BILLING_RECONCILIATION,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

    def test_all_validator_entrypoints_sanitize_unpaired_surrogates(self):
        surrogate = "\ud800"
        fixtures = {
            INTERNAL_APPROVAL: _approval_fixture,
            ROUTE_ACTIVATION: _activation_fixture,
            TERMINAL_REPORT: _terminal_fixture,
            ROUTE_INACTIVE: _inactive_fixture,
            BILLING_RECONCILIATION: _billing_fixture,
        }
        for contract_id, fixture_factory in fixtures.items():
            with self.subTest(contract_id=contract_id):
                evidence, context, secrets, transition_at = fixture_factory()
                context["deal_id"] = surrogate
                with self.assertRaises(EvidenceValidationError) as captured:
                    validate_external_evidence(
                        contract_id,
                        evidence,
                        context,
                        secrets,
                        transition_at=transition_at,
                    )
                self.assertNotIn(surrogate, str(captured.exception))

        evidence, context, secrets, transition_at = _approval_fixture()
        secrets["evidence_secret"] = surrogate * 32
        with self.assertRaises(EvidenceValidationError):
            validate_external_evidence(
                INTERNAL_APPROVAL,
                evidence,
                context,
                secrets,
                transition_at=transition_at,
            )

    def test_consumption_validation_does_not_claim_or_perform_runtime_cas(self):
        evidence, context, secrets, transition_at = _approval_fixture()
        first = validate_external_evidence(
            INTERNAL_APPROVAL,
            evidence,
            context,
            secrets,
            transition_at=transition_at,
        )
        second = validate_external_evidence(
            INTERNAL_APPROVAL,
            evidence,
            context,
            secrets,
            transition_at=transition_at,
        )
        self.assertTrue(first.one_time_consumption_readback_validated)
        self.assertTrue(second.one_time_consumption_readback_validated)
        self.assertFalse(first.one_time_consumption_runtime_enforced)
        self.assertFalse(second.one_time_consumption_runtime_enforced)
        self.assertFalse(first.mutation_performed)
        self.assertFalse(second.mutation_performed)

    def test_unknown_contract_fails_closed_without_echoing_inputs(self):
        for contract_id in ("unknown-contract", [], {"not": "hashable"}):
            with self.subTest(contract_id_type=type(contract_id).__name__):
                with self.assertRaisesRegex(
                    EvidenceValidationError, "external_evidence_contract_unknown"
                ) as captured:
                    validate_external_evidence(
                        contract_id,
                        {"private": "100000000000001"},
                        {},
                        {},
                        transition_at="2026-08-28T12:00:00.000Z",
                    )
                self.assertNotIn("100000000000001", str(captured.exception))


if __name__ == "__main__":
    unittest.main()
