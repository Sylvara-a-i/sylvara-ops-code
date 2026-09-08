"""Regression checks for the retry-stable Form 2 issuance identity boundary."""

import calendar
import hashlib
import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SYNTHETIC_DEAL_ID = "1" + "0" * 17 + "1"
OTHER_SYNTHETIC_DEAL_ID = "1" + "0" * 17 + "2"


def valid_history_timestamp(value, pattern):
    """Synthetic decision oracle, not a Deluge interpreter or live CRM test."""
    if not isinstance(value, str) or not re.fullmatch(pattern, value):
        return False
    year, month, day = int(value[:4]), int(value[5:7]), int(value[8:10])
    return day <= calendar.monthrange(year, month)[1]


def renewal_candidate(deal_id, issued_at, verified_at, pattern, domain):
    """Mirror the documented pure recipe; source checks bind its inputs/layout."""
    if not valid_history_timestamp(issued_at, pattern):
        return None
    if verified_at and not valid_history_timestamp(verified_at, pattern):
        return None
    digest = hashlib.sha256(f"{domain}{deal_id}:{issued_at}".encode("utf-8")).hexdigest()
    return f"{digest[:8]}-{digest[8:12]}-4{digest[12:15]}-8{digest[15:18]}-{digest[18:30]}"


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
        cls.history_pattern = re.search(
            r'history_timestamp_pattern = "([^"]+)";', cls.form2
        ).group(1)
        cls.renewal_domain = re.search(
            r'reissue_digest = zoho.encryption.sha256\("([^"]+)" '
            r'\+ deal_id_text \+ ":" \+ setup_access_issued_at\);', cls.form2
        ).group(1)

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
            "preserves Setup_Access_Status as Expired",
            initialization["issue_identity"]["expired_restart"],
        )
        self.assertEqual(form2["request"]["body_keys"], ["dealId", "issueRequestId"])
        self.assertIn(
            'request_body.put("issueRequestId",issue_request_id);',
            self.form2,
        )
        self.assertNotIn("input.issue_request_id", self.form2)
        self.assertIn("zoho.encryption.sha256", self.form2)
        self.assertEqual(
            self.renewal_domain, "sylvara:free-revenue-leak-test:setup-reissue:v2:"
        )
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
        self.assertNotIn('update_map.put("Setup_Access_Status",', expired_branch)
        self.assertNotIn('expected_setup_access_status =', expired_branch)
        self.assertIn('issue_request_id != initial_issue_request_id', expired_branch)
        self.assertLess(
            expired_branch.index('issue_request_id = "";'),
            expired_branch.index('reissue_digest ='),
        )
        self.assertIn(
            'if(reissue_digest != null && reissue_digest.matches("^[0-9a-f]{64}$"))',
            expired_branch,
        )
        self.assertIn(
            'reissue_digest.subString(0,8) + "-" + reissue_digest.subString(8,12) '
            '+ "-4" + reissue_digest.subString(12,15) + "-8" '
            '+ reissue_digest.subString(15,18) + "-" + reissue_digest.subString(18,30)',
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

    def test_expired_history_is_required_validated_and_never_written(self):
        self.assertIn('renewal_history_valid = setup_access_issued_at != "";', self.form2)
        self.assertIn('history_timestamps.add(setup_access_issued_at);', self.form2)
        self.assertIn('history_timestamps.add(setup_access_verified_at);', self.form2)
        self.assertIn(
            'if(eligible_context && governed_state_valid && identity_valid && renewal_history_valid)',
            self.form2,
        )
        for field in ("Setup_Access_Issued_At", "Setup_Access_Verified_At"):
            self.assertNotIn(f'update_map.put("{field}"', self.form2)
            self.assertNotIn(f'get("{field}"),"").toString().trim()', self.form2)
        self.assertIn('history_year % 400 == 0 || (history_year % 4 == 0 && history_year % 100 != 0)', self.form2)
        self.assertIn('history_month == 4 || history_month == 6 || history_month == 9 || history_month == 11', self.form2)
        for days in (28, 29, 30, 31):
            self.assertIn(f'maximum_day = {days};', self.form2)
        self.assertIn('renewal_history_valid = renewal_history_valid && history_day <= maximum_day;', self.form2)

    def test_all_reads_project_history_and_prewrite_and_postwrite_fence_exact_text(self):
        projected = re.search(r'read_query.put\("fields","([^"]+)"\);', self.form2).group(1).split(',')
        self.assertEqual(len(projected), 15)
        self.assertEqual(len(set(projected)), 15)
        for field, variable in (
            ("Setup_Access_Issued_At", "setup_access_issued_at"),
            ("Setup_Access_Verified_At", "setup_access_verified_at"),
        ):
            self.assertIn(field, projected)
            for record in ("deal_record", "prewrite_record", "readback_record"):
                self.assertIn(f'{record}.containKey("{field}")', self.form2)
            for record in ("prewrite_record", "readback_record"):
                self.assertIn(
                    f'ifnull({record}.get("{field}"),"").toString() == {variable}',
                    self.form2,
                )
        self.assertLess(self.form2.index('prewrite_exact = prewrite_exact'), self.form2.index('zoho.crm.v8.updateRecord'))
        self.assertLess(self.form2.index('readback_exact = readback_exact'), self.form2.index('issue_response = invokeurl'))

    def test_history_accepts_only_bounded_valid_calendar_and_timezone_shapes(self):
        valid = (
            '2026-01-31T23:59:59-06:00', '2024-02-29T12:00:00Z',
            '2000-02-29T12:00:00.123+14:00', '2026-04-30T00:00:00.1-14:00',
            '2026-06-30T00:00:00.12+05:30',
        )
        invalid = (
            None, '', ' ', '2026-02-29T12:00:00Z', '1900-02-29T12:00:00Z',
            '2100-02-29T12:00:00Z', '2026-04-31T12:00:00Z',
            '2026-09-31T12:00:00Z', '2026-11-31T12:00:00Z',
            '2026-00-01T12:00:00Z', '2026-13-01T12:00:00Z',
            '2026-01-00T12:00:00Z', '2026-01-32T12:00:00Z',
            '0000-01-01T12:00:00Z', '2026-01-01T24:00:00Z',
            '2026-01-01T00:60:00Z', '2026-01-01T00:00:60Z',
            '2026-01-01T00:00:00+14:01', '2026-01-01T00:00:00-15:00',
            '2026-01-01T00:00:00+05:60', '2026-01-01T00:00:00',
            '2026-01-01T00:00:00.1234Z', '2026-01-01T00:00:00Z\n',
            ' 2026-01-01T00:00:00Z',
        )
        for value in valid:
            with self.subTest(valid=value):
                self.assertTrue(valid_history_timestamp(value, self.history_pattern))
        for value in invalid:
            with self.subTest(invalid=value):
                self.assertFalse(valid_history_timestamp(value, self.history_pattern))

    def test_renewal_recipe_is_retry_stable_and_does_not_take_the_mutable_prior_uuid(self):
        candidate = renewal_candidate(SYNTHETIC_DEAL_ID, '2026-01-01T00:00:00Z', '', self.history_pattern, self.renewal_domain)
        self.assertRegex(candidate, r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$')
        for stored_identity in ('01234567-89ab-4cde-8f01-23456789abcd', candidate):
            # Persisted candidate is deliberately not an input, so a retry cannot rotate it again.
            with self.subTest(retry=stored_identity == candidate):
                self.assertEqual(candidate, renewal_candidate(SYNTHETIC_DEAL_ID, '2026-01-01T00:00:00Z', '', self.history_pattern, self.renewal_domain))
        self.assertNotEqual(candidate, renewal_candidate(OTHER_SYNTHETIC_DEAL_ID, '2026-01-01T00:00:00Z', '', self.history_pattern, self.renewal_domain))
        self.assertNotEqual(candidate, renewal_candidate(SYNTHETIC_DEAL_ID, '2026-01-01T00:00:01Z', '', self.history_pattern, self.renewal_domain))

    def test_renewal_requires_issued_history_and_rejects_malformed_optional_verified_history(self):
        for issued, verified in (
            ('', ''), ('', '2026-01-01T00:00:00Z'),
            ('not-a-date', ''), ('2026-01-01T00:00:00Z', 'not-a-date'),
        ):
            with self.subTest(issued_present=bool(issued), verified_present=bool(verified)):
                self.assertIsNone(renewal_candidate(SYNTHETIC_DEAL_ID, issued, verified, self.history_pattern, self.renewal_domain))
        self.assertIsNotNone(renewal_candidate(SYNTHETIC_DEAL_ID, '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', self.history_pattern, self.renewal_domain))

    def test_timestamp_representation_is_preserved_not_silently_normalized(self):
        first = renewal_candidate(SYNTHETIC_DEAL_ID, '2026-01-01T00:00:00Z', '', self.history_pattern, self.renewal_domain)
        equivalent = renewal_candidate(SYNTHETIC_DEAL_ID, '2025-12-31T18:00:00-06:00', '', self.history_pattern, self.renewal_domain)
        self.assertNotEqual(first, equivalent)
        self.assertIn('equivalent offsets are not normalized', self.form2)


if __name__ == "__main__":
    unittest.main()
