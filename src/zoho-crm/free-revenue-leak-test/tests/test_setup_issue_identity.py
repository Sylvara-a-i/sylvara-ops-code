"""Regression checks for the retry-stable Form 2 issuance identity boundary."""

import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class SetupIssueIdentityContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.automation = json.loads(
            (ROOT / "config" / "automation-contract.json").read_text(encoding="utf-8")
        )
        cls.callers = json.loads(
            (ROOT / "config" / "caller-manifest.json").read_text(encoding="utf-8")
        )
        cls.initializer = (
            ROOT / "functions" / "initialize_setup_access_issue_request_id.deluge"
        ).read_text(encoding="utf-8")
        cls.form2 = (ROOT / "functions" / "issue_revenue_leak_test_setup.deluge").read_text(
            encoding="utf-8"
        )

    def test_create_only_workflow_is_the_single_writer(self):
        workflow = next(
            item
            for item in self.automation["workflow_set"]
            if item["logical_name"] == "SETUP_ACCESS_ISSUE_IDENTITY"
        )
        self.assertEqual(workflow["trigger"], "create_only")
        self.assertFalse(workflow["repeat"])
        self.assertEqual(
            workflow["field"]["api_name"], "Setup_Access_Issue_Request_ID"
        )
        identity = workflow["identity_contract"]
        self.assertEqual(identity["sole_writer"], "initialize_setup_access_issue_request_id")
        self.assertEqual(identity["maximum_writes_per_execution"], 1)
        self.assertFalse(identity["automatic_write_retry"])
        self.assertFalse(identity["cryptographic_randomness_claimed"])
        self.assertEqual(identity["security_classification"], "non-secret idempotency identifier")
        self.assertIn("SHA-256", identity["derivation"])
        self.assertIn("same candidate", identity["concurrency_behavior"])
        self.assertEqual(
            identity["missing_field_in_read_response_behavior"],
            "fail_closed_no_write",
        )

    def test_initializer_fails_closed_and_has_one_bounded_write(self):
        source = self.initializer
        self.assertIn(
            "void automation.initialize_setup_access_issue_request_id(string deal_id)", source
        )
        self.assertEqual(source.count("zoho.crm.v8.getRecordById"), 3)
        self.assertEqual(
            source.count(
                'zoho.crm.v8.getRecordById("Deals",deal_id_long,read_query)'
            ),
            3,
        )
        self.assertEqual(source.count("zoho.crm.v8.updateRecord"), 1)
        self.assertIn(
            'read_query.put("fields","Setup_Access_Issue_Request_ID");', source
        )
        self.assertEqual(
            source.count(
                '!initial_record.containKey("Setup_Access_Issue_Request_ID")'
            ),
            1,
        )
        self.assertEqual(
            source.count('containKey("Setup_Access_Issue_Request_ID")'), 3
        )
        self.assertIn('trigger_options.put("trigger",List());', source)
        self.assertIn('if(initial_value != "")', source)
        self.assertIn('if(prewrite_value != "")', source)
        self.assertIn("if(postwrite_value == candidate)", source)
        self.assertNotIn("invokeurl", source.lower())
        self.assertNotIn("openurl", source.lower())
        self.assertNotIn("update_response +", source)

    def test_initializer_deterministically_derives_only_canonical_uuid_v4_shape(self):
        source = self.initializer
        self.assertIn(
            'zoho.encryption.sha256("sylvara:free-revenue-leak-test:setup-issue:v1:" + deal_id_text)',
            source,
        )
        self.assertNotIn("randomNumber(", source)
        self.assertIn("if(prewrite_value == candidate)", source)
        pattern = next(
            item
            for item in self.automation["workflow_set"]
            if item["logical_name"] == "SETUP_ACCESS_ISSUE_IDENTITY"
        )["identity_contract"]["pattern"]
        self.assertRegex("01234567-89ab-4cde-8f01-23456789abcd", re.compile(pattern))
        self.assertNotRegex("01234567-89ab-3cde-8f01-23456789abcd", re.compile(pattern))

    def test_logs_are_constant_and_coarse(self):
        info_lines = [line.strip() for line in self.initializer.splitlines() if "info " in line]
        self.assertGreaterEqual(len(info_lines), 6)
        for line in info_lines:
            self.assertRegex(line, r'^info "setup_issue_identity_[a-z_]+";$')

    def test_button_uses_persisted_identity_and_keeps_exact_post_body(self):
        form2 = next(
            caller
            for caller in self.callers["callers"]
            if caller["logical_name"] == "FORM2_SETUP_ISSUE_CALLER"
        )
        issue_argument = next(
            item for item in form2["function_arguments"] if item["name"] == "issue_request_id"
        )
        self.assertIn("Setup_Access_Issue_Request_ID", issue_argument["source"])
        self.assertEqual(issue_argument["security_classification"], "non-secret idempotency identifier; never an access token")
        self.assertEqual(form2["request"]["body_keys"], ["dealId", "issueRequestId"])
        self.assertIn(
            'request_body.put("issueRequestId",input.issue_request_id.toString());',
            self.form2,
        )
        self.assertIn("Setup_Access_Issue_Request_ID", self.form2)


if __name__ == "__main__":
    unittest.main()
