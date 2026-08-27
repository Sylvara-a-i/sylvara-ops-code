import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = ROOT / "docs/product/free-revenue-leak-test-key-rotation-contract.json"
RUNBOOK_PATH = ROOT / "docs/runbooks/free-revenue-leak-test-key-rotation.md"
CLIENT_PORTAL_REGISTRY_PATH = (
    ROOT / "src/zoho-catalyst/billing-webhook-gateway/config/variables.json"
)

EXACT_FUNCTIONS = [
    "revenue_leak_test_request_form",
    "revenue_leak_test_setup_form",
    "revenue_desk_call_gateway",
    "revenue_desk_call_worker",
    "crm_billing_orchestrator",
    "analytics_sync",
]

REGISTRIES = {
    "revenue_leak_test_request_form": ROOT / "src/zoho-catalyst/revenue-leak-test-request-form/config/variables.json",
    "revenue_leak_test_setup_form": ROOT / "src/zoho-catalyst/revenue-leak-test-setup-form/config/variables.json",
    "revenue_desk_call_gateway": ROOT / "src/zoho-catalyst/revenue-desk-call-runtime/config/variables.json",
    "revenue_desk_call_worker": ROOT / "src/zoho-catalyst/revenue-desk-call-runtime/config/variables.json",
    "crm_billing_orchestrator": ROOT / "src/zoho-catalyst/crm-billing-orchestrator/config/variables.json",
    "analytics_sync": ROOT / "src/zoho-catalyst/revenue-desk-analytics/config/variables.json",
}


class SecretRotationContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
        cls.runbook = RUNBOOK_PATH.read_text(encoding="utf-8")
        cls.client_portal_registry = json.loads(
            CLIENT_PORTAL_REGISTRY_PATH.read_text(encoding="utf-8")
        )

    def test_contract_covers_exact_six_functions_and_two_job_pools(self) -> None:
        self.assertEqual(self.contract["functions"], EXACT_FUNCTIONS)
        self.assertIn("RevenueDeskCallJobs", json.dumps(self.contract))
        self.assertIn("RevenueDeskAnalyticsJobs", json.dumps(self.contract))
        self.assertIn("RevenueDeskCallJobs", self.runbook)
        self.assertIn("RevenueDeskAnalyticsJobs", self.runbook)

    def test_every_named_runtime_variable_exists_in_its_consumer_registry(self) -> None:
        registry_names = {
            consumer: {
                entry["name"]
                for entry in json.loads(path.read_text(encoding="utf-8"))["variables"]
            }
            for consumer, path in REGISTRIES.items()
        }
        sections = (
            self.contract["derivation_domains"]
            + self.contract["authentication_and_binding_secrets"]
        )
        for section in sections:
            for consumer in section["consumers"]:
                for variable in section["variables"]:
                    self.assertIn(
                        variable,
                        registry_names[consumer],
                        f"{variable} is absent from {consumer}'s variable registry",
                    )

    def test_client_portal_rotation_is_separate_pending_and_complete(self) -> None:
        components = self.contract["retained_separate_components"]
        self.assertEqual(len(components), 1)
        component = components[0]
        self.assertEqual(component["id"], "client_portal_billing_webhook_gateway")
        self.assertEqual(component["classification"], "required_hardening_pending")
        self.assertFalse(component["included_in_exact_six_revenue_desk_functions"])
        self.assertNotIn(
            component["development_function_target"],
            self.contract["functions"],
        )
        self.assertTrue(component["production_code_block_required"])
        self.assertFalse(component["development_deployment_authorized"])
        self.assertFalse(component["credential_rotation_authorized"])
        self.assertFalse(component["duplicate_removal_authorized"])

        rotation = self.contract["client_portal_gateway_rotation"]
        self.assertEqual(rotation["component_id"], component["id"])
        self.assertEqual(rotation["classification"], "required_hardening_pending")
        self.assertFalse(rotation["included_in_exact_six_revenue_desk_functions"])
        self.assertTrue(rotation["production_code_block_required"])
        for field in (
            "development_deployment_authorized",
            "credential_rotation_authorized",
            "duplicate_removal_authorized",
        ):
            self.assertFalse(rotation[field])

        registry_names = {
            entry["name"] for entry in self.client_portal_registry["variables"]
        }
        named_variables = set()
        for entry in rotation["authentication_and_signing_rotation"]:
            named_variables.update(entry["variables"])
        named_variables.update(rotation["durable_fingerprint_rotation"]["variables"])
        named_variables.update(rotation["source_identity_binding"]["variables"])
        named_variables.update(rotation["creator_connection_rotation"]["variables"])
        named_variables.update(rotation["retired_raw_oauth_revocation"]["variables"])
        self.assertTrue(named_variables.issubset(registry_names))
        self.assertTrue({
            "BILLING_WEBHOOK_SECRET",
            "BILLING_WEBHOOK_SECRET_PREVIOUS",
            "BILLING_WEBHOOK_SECRET_PREVIOUS_EXPIRES_AT",
            "BILLING_EVENT_FINGERPRINT_SECRET",
            "SHARED_HEADER_NAME",
            "SHARED_HEADER_VALUE",
            "CREATOR_CONNECTION_LINK_NAME",
            "ZOHO_CLIENT_ID",
            "ZOHO_CLIENT_SECRET",
            "ZOHO_REFRESH_TOKEN",
        }.issubset(named_variables))

        required_gates = " ".join(rotation["required_hardening_gates"])
        for term in (
            "Creator Custom API",
            "immutable reviewed Development artifact",
            "route ownership",
            "duplicate removal",
            "event-fingerprint secrets rotated",
            "Connection grant rotated",
            "raw OAuth grants revoked",
            "final Billing",
        ):
            self.assertIn(term, required_gates)
        for term in (
            "required_hardening_pending",
            "outside the Revenue Desk topology",
            "raw OAuth refresh grant",
            "Production code block",
        ):
            self.assertIn(term, self.runbook)

    def test_durable_domains_are_explicit_versioned_and_nonoverlapping(self) -> None:
        domain_ids = [entry["id"] for entry in self.contract["derivation_domains"]]
        self.assertEqual(len(domain_ids), len(set(domain_ids)))
        domains = []
        for entry in self.contract["derivation_domains"]:
            self.assertTrue(entry["durable_outputs"])
            self.assertIn("rotation_gate", entry)
            self.assertIn("previous_key_policy", entry)
            for domain in entry["domains"]:
                self.assertRegex(domain, r"(?:[.-]v[1-9][0-9]*)$")
                domains.append(domain)
        self.assertEqual(len(domains), len(set(domains)))

    def test_form2_bearer_and_workflow_keys_are_separate_in_source(self) -> None:
        setup_root = ROOT / "src/zoho-catalyst/revenue-leak-test-setup-form/functions/revenue_leak_test_setup_form"
        config_source = (setup_root / "lib/config.js").read_text(encoding="utf-8")
        handler_source = (setup_root / "lib/handler.js").read_text(encoding="utf-8")
        workflow_source = (setup_root / "lib/workflow-store.js").read_text(encoding="utf-8")
        self.assertIn('readRequired(environment, "WORKFLOW_HMAC_SECRET")', config_source)
        self.assertIn("dependencies.config.workflowKeyMaterial", handler_source)
        self.assertNotIn("config.tokenPepper", workflow_source)
        self.assertIn("sylvara.form2.workflow-key.v1", workflow_source)

    def test_crm_and_runtime_domains_exist_in_executable_source(self) -> None:
        crm_root = ROOT / "src/zoho-catalyst/crm-billing-orchestrator/functions/crm_billing_orchestrator/lib"
        crm_source = (
            (crm_root / "idempotency.js").read_text(encoding="utf-8")
            + (crm_root / "billing-client.js").read_text(encoding="utf-8")
            + (crm_root / "analytics-outbox.js").read_text(encoding="utf-8")
            + (crm_root / "report-summary.js").read_text(encoding="utf-8")
        )
        runtime_root = ROOT / "src/zoho-catalyst/revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib"
        runtime_source = "".join(
            path.read_text(encoding="utf-8")
            for path in (
                runtime_root / "security.js",
                runtime_root / "analytics-outbox.js",
                runtime_root / "runtime-service.js",
                runtime_root / "catalyst-mail.js",
                runtime_root / "crm-report-outbox.js",
            )
        )
        for domain in [
            "sylvara.crm-billing.idempotency.v1",
            "sylvara.crm-billing.test-customer.v1",
            "revenue-desk-analytics-conversion-v2",
            "sylvara.crm-report-summary.v1",
            "sylvara.crm-report-summary.v2",
        ]:
            self.assertIn(domain, crm_source)
        for domain in [
            "revenue-desk-event-v1",
            "revenue-desk-call-v1",
            "revenue-desk-event-payload-v1",
            "revenue-desk-inbound-receipt-v1",
            "revenue-desk-runtime-binding-v1",
            "revenue-desk-notification-v1",
            "free-test-mail-recipient-v1",
            "free-test-mail-result-v1",
            "revenue-desk-quarantine-event-v1",
            "revenue-desk-quarantine-call-v1",
            "revenue-desk-correlation-v1",
            "revenue-desk-number-v1",
            "revenue-desk-analytics-client-v1",
            "revenue-desk-analytics-deployment-v1",
            "sylvara.crm-report-summary.v2",
        ]:
            self.assertIn(domain, runtime_source)

        analytics_partition = next(
            entry for entry in self.contract["derivation_domains"]
            if entry["id"] == "revenue_desk_analytics_partition_v1"
        )
        serialized_outputs = " ".join(analytics_partition["durable_outputs"])
        for required in (
            "CRMBillingOperations.OPERATION_KEY",
            "CRMBillingOperations.OPERATION_FINGERPRINT",
            "CRMBillingOperations.OPERATION_PAYLOAD_JSON",
            "callSetDigest",
            "report revision",
        ):
            self.assertIn(required, serialized_outputs)
        self.assertIn("sylvara.crm-report-summary.v1", analytics_partition["domains"])
        self.assertIn("sylvara.crm-report-summary.v2", analytics_partition["domains"])
        self.assertNotIn(
            "ANALYTICS_CONNECTION_LINK_NAME",
            json.dumps(self.contract),
        )

    def test_final_state_revokes_old_values_and_never_authorizes_production(self) -> None:
        rules = self.contract["rules"]
        self.assertFalse(rules["exposed_previous_key_permitted_after_cutover"])
        self.assertFalse(rules["production_activation_authorized"])
        self.assertIn("Revoke every exposed old key", self.contract["rotation_order"][-2])
        self.assertIn("Keep Production dark", self.contract["rotation_order"][-1])
        self.assertIn("After revocation, do not restore an exposed value", self.runbook)


if __name__ == "__main__":
    unittest.main()
