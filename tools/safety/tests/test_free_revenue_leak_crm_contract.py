import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = (
    ROOT
    / "src"
    / "zoho-crm"
    / "free-revenue-leak-test"
    / "config"
    / "automation-contract.json"
)


class FreeRevenueLeakCrmContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))

    def test_crm_contract_is_synthetic_only_and_contains_no_active_sign_or_sms_path(self):
        contract = self.contract
        self.assertEqual(contract["schema_version"], 2)
        self.assertEqual(contract["identifier_migration"]["from_schema_version"], 1)
        self.assertEqual(
            contract["identifier_migration"]["controller_aliases"]["form2_controller"],
            "revenue_leak_test_setup_form",
        )
        self.assertEqual(
            contract["environment_boundary"]["permitted_records"],
            "ZZZ SYNTHETIC only",
        )
        self.assertFalse(
            contract["environment_boundary"]["real_customer_or_prospect_mutation"]
        )
        rendered = json.dumps(contract).lower()
        self.assertTrue('"zoho sign action"' in rendered or '"zoho sign"' in rendered)
        self.assertIn('"sms"', rendered)
        self.assertNotIn("send sms", rendered)
        self.assertNotIn("create sign", rendered)

    def test_crm_contract_defines_each_required_additive_field_once(self):
        fields = self.contract["deal_fields_to_add"]
        names = [field["api_name"] for field in fields]
        self.assertEqual(len(names), 14)
        self.assertEqual(len(names), len(set(names)))
        self.assertIn("Approved_Deployment_Record_ID", names)
        self.assertIn("Approved_Configuration_Version", names)
        self.assertIn("Subscription_Acceptance_Version", names)
        self.assertIn("Test_Data_Confidence_Notes", names)

    def test_crm_contract_has_one_form2_rule_and_one_blueprint(self):
        form2_rules = [
            rule
            for rule in self.contract["workflow_set"]
            if rule["logical_name"] == "FORM2_SUBMISSION"
        ]
        self.assertEqual(len(form2_rules), 1)
        self.assertEqual(
            form2_rules[0]["single_active_rule"],
            "Deals Revenue Leak Test Setup Form Proof Candidate",
        )
        self.assertEqual(
            form2_rules[0]["observed_development_rule"],
            "Deals Form 2 Controller Proof Candidate",
        )
        self.assertEqual(
            form2_rules[0]["desired_development_rule"],
            form2_rules[0]["single_active_rule"],
        )
        self.assertTrue(form2_rules[0]["rename_requires_independent_readback"])
        self.assertFalse(form2_rules[0]["repeat"])
        self.assertEqual(
            self.contract["blueprint"]["name"],
            "Revenue Desk Free Test v6 - Control Candidate",
        )

    def test_go_live_and_paid_conversion_are_separate_fail_closed_gates(self):
        transitions = self.contract["blueprint"]["required_transition_invariants"]
        go_live = transitions["Approve Go Live"]
        paid = transitions["Activate Subscription"]
        self.assertIn("Approved Deployment Record ID equals Deployment Record ID", go_live)
        self.assertIn("Approved Configuration Version equals Configuration Version", go_live)
        self.assertIn("Subscription Acceptance Status equals Accepted", paid)
        self.assertIn("Billing Automation Status equals Paid Verified", paid)
        self.assertIn("no Billing subscription exists", transitions["Propose Subscription"])

    def test_synthetic_acceptance_requires_idempotent_record_and_task_counts(self):
        expected = self.contract["synthetic_acceptance"]["expected_records"]
        self.assertEqual(
            expected,
            {
                "lead": 1,
                "account": 1,
                "contact": 1,
                "deal": 1,
                "review_task": 1,
                "form2_task": 1,
            },
        )


if __name__ == "__main__":
    unittest.main()
