import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = ROOT / "docs" / "product" / "free-revenue-leak-test-release-contract.json"
FORM2_ROUTES_PATH = ROOT / "src" / "zoho-catalyst" / "revenue-leak-test-setup-form" / "config" / "routes.json"


class FreeRevenueLeakReleaseContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
        cls.form2_routes = json.loads(FORM2_ROUTES_PATH.read_text(encoding="utf-8"))

    def test_commercial_boundary_is_exact(self):
        contract = self.contract
        self.assertEqual(contract["schema_version"], 2)
        self.assertEqual(contract["contract_id"], "sylvara-free-revenue-leak-test-e2e-v2")
        migration = contract["identifier_migration"]
        self.assertEqual(migration["from_schema_version"], 1)
        self.assertEqual(
            migration["function_aliases"]["form1_assisted_controller"],
            "revenue_leak_test_request_form",
        )
        self.assertFalse(migration["legacy_aliases_are_deployment_targets"])
        self.assertEqual(contract["customer_facing_name"], "Free Revenue Leak Test")
        self.assertEqual(contract["commercial_boundary"]["duration_calendar_days"], 7)
        self.assertEqual(contract["commercial_boundary"]["connected_call_limit"], 25)
        self.assertFalse(contract["commercial_boundary"]["billing_required_to_start"])
        self.assertFalse(contract["commercial_boundary"]["automatic_paid_conversion"])

    def test_function_boundaries_do_not_expand_privilege(self):
        decisions = {entry["name"]: entry["decision"] for entry in self.contract["function_boundaries"]}
        self.assertEqual(decisions["retell_free_test"], "retain")
        self.assertEqual(decisions["retell_free_test_retry"], "retain_separate")
        self.assertEqual(decisions["revenue_leak_test_request_form"], "retain_separate")
        self.assertEqual(decisions["revenue_leak_test_setup_form"], "retain_separate")
        self.assertEqual(decisions["crm_billing_orchestrator"], "retain_separate")
        for obsolete in (
            "retell_events",
            "retell_inbound_resolver",
            "retell_route_approval_control",
            "process_retell_events",
            "analytics_sync",
        ):
            self.assertEqual(decisions[obsolete], "delete_development_function")
        cleanup = self.contract["development_cleanup"]
        self.assertTrue(cleanup["owner_authorized_without_clients"])
        self.assertFalse(cleanup["production_changed"])
        self.assertTrue(cleanup["canonical_retell_bindings_verified"])
        self.assertEqual(cleanup["obsolete_analytics_crons_deleted_count"], 7)

    def test_retell_and_coverage_contract_is_exact(self):
        self.assertEqual(self.contract["retell_integration"]["shared_agent_count"], 1)
        self.assertEqual(self.contract["retell_integration"]["current_development_number_limit"], 1)
        self.assertFalse(self.contract["retell_integration"]["agent_id_alone_establishes_tenant"])
        self.assertEqual(
            set(self.contract["canonical_coverage_modes"].values()),
            {"AfterHoursOnly", "NoAnswerOverflowOnly", "AfterHoursAndOverflow"},
        )

    def test_billing_mapping_and_acceptance_gate_are_exact(self):
        billing = self.contract["billing_test"]
        self.assertEqual(
            billing["commercial_terms_source"],
            "private Catalyst Development PAID_COMMERCIAL_TERMS_JSON",
        )
        self.assertEqual(billing["required_plan_frequency_keys"], [
            "Launch::Monthly",
            "Growth::Monthly",
            "Scale::Monthly",
        ])
        self.assertEqual(billing["commercial_terms_fields"], [
            "currency",
            "interval",
            "intervalUnit",
            "commonUsageRateMinor",
            "plans.<exact-key>.recurringMinor",
            "plans.<exact-key>.setupMinor",
        ])
        self.assertNotIn("plans", billing)
        self.assertEqual(billing["positive_acceptance_plan"], "Growth Monthly")
        self.assertFalse(billing["real_charge"])
        configured = {
            entry["name"]: entry
            for entry in self.contract["required_new_environment_variables"]
        }
        self.assertTrue(configured["PAID_COMMERCIAL_TERMS_JSON"]["secret"])

    def test_prohibited_capabilities_remain_out_of_scope(self):
        excluded = set(self.contract["out_of_scope"])
        for value in (
            "Production",
            "SMS",
            "second phone number",
            "Retell call",
            "Retell native simulation",
            "booking",
            "dispatch",
            "payment collection",
        ):
            self.assertIn(value, excluded)

    def test_form2_routes_and_runtime_tables_match_the_component_contract(self):
        expected_routes = [
            ("FORM2_ISSUE", "POST", "ISSUE_PATH"),
            ("FORM2_ACCESS", "GET", "FORM2_ACCESS_PATH"),
            ("FORM2_OTP_REQUEST", "POST", "FORM2_OTP_REQUEST_PATH"),
            ("FORM2_OTP_VERIFY", "POST", "FORM2_OTP_VERIFY_PATH"),
            ("FORM2_PREFILL", "POST", "PREFILL_PATH"),
            ("FORM2_SUBMISSION", "POST", "SUBMISSION_PATH"),
        ]
        self.assertEqual(self.contract["form2"]["routes"], [route[0] for route in expected_routes])
        component_routes = [
            (route["id"], route["method"], route["path_reference"])
            for route in self.form2_routes["routes"]
        ]
        self.assertEqual(component_routes, expected_routes)
        central_routes = [
            (route["id"], route["method"], route["path_reference"])
            for route in self.contract["route_manifest"]
            if route["id"].startswith("FORM2_")
        ]
        self.assertEqual(central_routes, expected_routes)
        self.assertTrue(all(
            route["function"] == "revenue_leak_test_setup_form"
            for route in self.contract["route_manifest"]
            if route["id"].startswith("FORM2_")
        ))

        data_contracts = self.contract["catalyst_data_contracts"]
        self.assertEqual(data_contracts["required_form2_v3_tables"], [
            "Form2SessionsV3Runtime",
            "Form2PrefillsV3",
            "Form2SubmissionsV3",
            "Form2VerificationProofsV3",
        ])
        self.assertEqual(data_contracts["form2_v3_legacy_source_mapping"], {
            "Form2SessionsV3": "Form2SessionsV3Runtime",
        })


if __name__ == "__main__":
    unittest.main()
