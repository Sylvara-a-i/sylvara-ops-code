import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = ROOT / "docs" / "product" / "free-revenue-leak-test-release-contract.json"


class FreeRevenueLeakReleaseContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))

    def test_commercial_boundary_is_exact(self):
        contract = self.contract
        self.assertEqual(contract["customer_facing_name"], "Free Revenue Leak Test")
        self.assertEqual(contract["commercial_boundary"]["duration_calendar_days"], 7)
        self.assertEqual(contract["commercial_boundary"]["connected_call_limit"], 25)
        self.assertFalse(contract["commercial_boundary"]["billing_required_to_start"])
        self.assertFalse(contract["commercial_boundary"]["automatic_paid_conversion"])

    def test_function_boundaries_do_not_expand_privilege(self):
        decisions = {entry["name"]: entry["decision"] for entry in self.contract["function_boundaries"]}
        self.assertEqual(decisions["retell_free_test"], "retain")
        self.assertEqual(decisions["retell_free_test_retry"], "retain_separate")
        self.assertEqual(decisions["form1_assisted_controller"], "retain_separate")
        self.assertEqual(decisions["form2_controller"], "retain_separate")
        self.assertEqual(decisions["crm_billing_orchestrator"], "retain_separate")
        for obsolete in (
            "retell_events",
            "retell_inbound_resolver",
            "retell_route_approval_control",
            "process_retell_events",
        ):
            self.assertIn("disable", decisions[obsolete])

    def test_retell_and_coverage_contract_is_exact(self):
        self.assertEqual(self.contract["retell_integration"]["shared_agent_count"], 1)
        self.assertEqual(self.contract["retell_integration"]["current_development_number_limit"], 1)
        self.assertFalse(self.contract["retell_integration"]["agent_id_alone_establishes_tenant"])
        self.assertEqual(
            set(self.contract["canonical_coverage_modes"].values()),
            {"AfterHoursOnly", "NoAnswerOverflowOnly", "AfterHoursAndOverflow"},
        )

    def test_billing_mapping_and_acceptance_gate_are_exact(self):
        plans = self.contract["billing_test"]["plans"]
        self.assertEqual(plans["Launch Monthly"], {"management_fee_usd": 349, "setup_fee_usd": 750, "connected_minute_usd": 0.4})
        self.assertEqual(plans["Growth Monthly"], {"management_fee_usd": 749, "setup_fee_usd": 1500, "connected_minute_usd": 0.4})
        self.assertEqual(plans["Scale Monthly"], {"management_fee_usd": 1299, "setup_fee_usd": 2500, "connected_minute_usd": 0.4})
        self.assertEqual(self.contract["billing_test"]["positive_acceptance_plan"], "Growth Monthly")
        self.assertFalse(self.contract["billing_test"]["real_charge"])

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


if __name__ == "__main__":
    unittest.main()
