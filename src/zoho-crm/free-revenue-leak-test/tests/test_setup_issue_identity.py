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

    def test_create_only_workflow_writer_is_preserved_for_the_deferred_profile(self):
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

    def test_form2_eligibility_and_readback_use_the_stored_offer_not_its_display_label(self):
        values = self.automation["entry_offer_values"]
        stored_value = values["crm_actual_reference_value"]
        display_value = values["crm_display_value"]
        self.assertNotEqual(stored_value, display_value)
        form2 = next(
            caller for caller in self.callers["callers"]
            if caller["logical_name"] == "FORM2_SETUP_ISSUE_CALLER"
        )
        self.assertEqual(form2["deal_initialization"]["eligible_entry_offer"], stored_value)
        self.assertEqual(
            re.findall(r'^expected_entry_offer = "([^"]+)";$', self.form2, re.MULTILINE),
            [stored_value],
        )
        self.assertIn(
            'eligible_context = entry_offer == expected_entry_offer && '
            'pipeline == "Revenue Desk Sales" && stage == "Setup and Authorization" '
            '&& submission_id == "";',
            self.form2,
        )
        self.assertIn(
            'readback_exact = ifnull(readback_record.get("Entry_Offer"),"")'
            '.toString().trim() == expected_entry_offer &&',
            self.form2,
        )
        self.assertNotIn(f'== "{display_value}"', self.form2)

    def test_core_button_derives_and_reads_back_identity_without_a_workflow_argument(self):
        form2 = next(
            caller
            for caller in self.callers["callers"]
            if caller["logical_name"] == "FORM2_SETUP_ISSUE_CALLER"
        )
        self.assertEqual(
            [item["name"] for item in form2["function_arguments"]], ["deal_id"]
        )
        initialization = form2["deal_initialization"]
        self.assertFalse(initialization["workflow_or_blueprint_triggered"])
        self.assertTrue(initialization["authoritative_readback_required"])
        self.assertEqual(
            initialization["issue_identity"]["field"],
            "Setup_Access_Issue_Request_ID",
        )
        self.assertFalse(
            initialization["issue_identity"]["browser_supplied_identity_accepted"]
        )
        self.assertIn(
            "domain-separated digest",
            initialization["issue_identity"]["expired_restart"],
        )
        self.assertIn(
            "resets Setup_Access_Status to Not Issued",
            initialization["issue_identity"]["expired_restart"],
        )
        self.assertEqual(form2["request"]["body_keys"], ["dealId", "issueRequestId"])
        self.assertIn(
            'request_body.put("issueRequestId",issue_request_id);',
            self.form2,
        )
        self.assertNotIn("input.issue_request_id", self.form2)
        self.assertIn("zoho.encryption.sha256", self.form2)
        self.assertIn("sylvara:free-revenue-leak-test:setup-reissue:v1:", self.form2)
        self.assertIn('else if(setup_access_status == "Expired")', self.form2)
        self.assertIn(
            'update_map.put("Setup_Access_Issue_Request_ID",issue_request_id);',
            self.form2,
        )
        expired_branch = self.form2.split(
            'else if(setup_access_status == "Expired")', 1
        )[1].split(
            '\n\t\t\t\tif(issue_request_id.matches(identity_pattern))\n', 1
        )[0]
        self.assertIn(
            'update_map.put("Setup_Access_Status","Not Issued");',
            expired_branch,
        )
        self.assertIn(
            'expected_setup_access_status = "Not Issued";',
            expired_branch,
        )
        self.assertIn(
            "readback_setup_status == expected_setup_access_status",
            self.form2,
        )
        self.assertNotIn("readback_setup_valid", self.form2)
        self.assertEqual(self.form2.count("zoho.crm.v8.updateRecord"), 1)
        self.assertEqual(self.form2.count("zoho.crm.v8.getRecordById"), 3)
        self.assertIn('trigger_options.put("trigger",List());', self.form2)
        self.assertIn("prewrite_exact", self.form2)
        self.assertIn("write_safe", self.form2)
        self.assertIn("Setup_Access_Issue_Request_ID", self.form2)


if __name__ == "__main__":
    unittest.main()
