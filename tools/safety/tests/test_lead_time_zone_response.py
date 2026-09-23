"""Synthetic decision/source guards, not a Deluge interpreter or CRM acceptance."""

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "src/zoho-crm/lead-time-zone/normalize_lead_time_zone.deluge"
RECORD_ID = "1" + "0" * 17 + "1"


def accepted_receipt(response, record_id=RECORD_ID):
    """Documented single-task success shape, mirrored for a synthetic matrix."""
    def response_text(key):
        value = response.get(key)
        return "" if value is None else str(value)

    return (
        isinstance(response, dict)
        and response_text("id") == record_id
        and response_text("status") == ""
        and response_text("code") == ""
    )


def normalized_target(raw):
    """Existing normalization policy; intentionally not an IANA validity check."""
    tz = (raw or "").strip().split(" (", 1)[0].strip()
    if tz.lower() in ("utc", "z", "gmt", "etc/utc"):
        tz = "UTC"
    if "/" in tz and " " in tz:
        tz = tz.replace(" ", "_")
    return tz if tz == "UTC" or "/" in tz else ""


class LeadTimeZoneResponseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = SOURCE.read_text(encoding="utf-8")
        cls.code = re.sub(r"/\*.*?\*/|//[^\n]*", "", cls.source, flags=re.S)

    def test_documented_success_reproduces_old_false_failure(self):
        response = {"id": RECORD_ID, "Modified_Time": "2026-01-01T12:00:00-06:00"}
        old_failure = response.get("status", "").lower() != "success"
        self.assertTrue(old_failure)
        self.assertTrue(accepted_receipt(response))

    def test_null_error_mismatch_and_unexpected_success_are_not_accepted(self):
        for response in (
            None, {}, [], "unexpected", {"status": "success"},
            {"id": RECORD_ID + "1"},
            {"id": RECORD_ID, "status": "error", "code": "INVALID_DATA"},
            {"id": RECORD_ID, "status": "success"},
            {"id": RECORD_ID, "code": "SUCCESS"},
            {"id": RECORD_ID, "status": False},
            {"id": RECORD_ID, "code": 0},
        ):
            with self.subTest(response=response):
                self.assertFalse(accepted_receipt(response))

    def test_normalization_and_clear_policy_remains_explicit(self):
        for raw, expected in (
            (None, ""), ("  ", ""), ("CST", ""), ("Not a zone", ""),
            ("UTC", "UTC"), ("z", "UTC"), ("gmt", "UTC"),
            ("Etc/UTC", "UTC"), ("America/Chicago", "America/Chicago"),
            ("America/New York", "America/New_York"),
            ("America/Chicago (Central)", "America/Chicago"),
        ):
            with self.subTest(raw=raw):
                self.assertEqual(normalized_target(raw), expected)
        self.assertIn('if(existing == tz)', self.code)
        self.assertIn('tz.getPrefix(" (").toString().trim()', self.code)
        self.assertIn('tz.replaceAll(" ","_")', self.code)
        self.assertIn('if(!(tz == "UTC" || tz.contains("/")))', self.code)

    def test_one_update_no_retry_or_audit_omission_path(self):
        calls = re.findall(r"zoho\.crm\.updateRecord\((.*?)\);", self.code)
        self.assertEqual(calls, ["moduleName,recId,upd"])
        self.assertNotRegex(self.code, r"\b(for each|while|invokeurl|sendmail)\b")
        self.assertNotIn('"trigger"', self.code)
        self.assertIn('upd.put(targetField,tz);', self.code)
        self.assertIn('upd.put(auditField,zoho.currenttime.toString(', self.code)
        self.assertNotRegex(self.code, r"\.(remove|clear)\(")
        self.assertLess(self.code.index('if(existing == tz)'), self.code.index('zoho.crm.updateRecord'))

    def test_response_predicate_is_bound_to_the_source(self):
        self.assertIn('responseId = ifnull(resp.get("id"),"").toString();', self.code)
        self.assertIn('responseStatus = ifnull(resp.get("status"),"").toString().toLowerCase();', self.code)
        self.assertIn('responseCode = ifnull(resp.get("code"),"").toString();', self.code)
        self.assertIn('if(responseId == recId.toString() && responseStatus == "" && responseCode == "")', self.code)
        self.assertIn('if(resp != null)', self.code)
        self.assertIn('catch(failure)', self.code)

    def test_logs_are_constant_and_do_not_claim_readback(self):
        logs = [line.strip() for line in self.code.splitlines() if "info " in line]
        self.assertGreaterEqual(len(logs), 5)
        for line in logs:
            self.assertRegex(line, r'^info "tz_[a-z_]+";$')
        self.assertIn('info "tz_update_accepted_readback_required";', logs)
        self.assertIn('info "tz_update_reconciliation_required";', logs)

    def test_existing_workflow_argument_order_is_preserved(self):
        args = re.search(r"void automation\.normalize_time_zone_iana_v4e2\(([^)]+)\)", self.code).group(1)
        self.assertEqual(args.split(", "), [
            "string module_api_name", "string record_id", "string source_field_api",
            "string target_field_api", "string source_value", "string target_value",
            "string audit_field_api",
        ])

    def test_import_envelope_starts_with_declaration_and_contains_header(self):
        # The native CRM editor rejects a file-level header before the declaration.
        self.assertRegex(
            self.source.lstrip(),
            r"\Avoid automation\.normalize_time_zone_iana_v4e2\([^\n]+\)\s*\{\s*/\*",
        )
        self.assertLess(self.source.index("{"), self.source.index("/*"))
        self.assertLess(self.source.index("*/"), self.source.index("\ttry"))
        self.assertIn("the declaration above corresponds to the create function.", self.source)


if __name__ == "__main__":
    unittest.main()
