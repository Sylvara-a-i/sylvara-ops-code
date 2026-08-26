import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
MANIFEST = ROOT / "buttons" / "button-manifest.json"
FUNCTIONS = ROOT / "functions"
CATALYST_DISPATCHER = (
    REPOSITORY_ROOT
    / "src"
    / "zoho-catalyst"
    / "revenue-leak-test-request-form"
    / "functions"
    / "revenue_leak_test_request_form"
    / "lib"
    / "field-setup-dispatcher.js"
)
CATALYST_PROTOCOL = CATALYST_DISPATCHER.with_name("field-setup-protocol.js")


def catalyst_launch_contract():
    source = CATALYST_DISPATCHER.read_text(encoding="utf-8")
    contract = re.search(
        r"async function dispatchLaunch\(.*?exactKeys\(\s*"
        r"await jsonBody\(.*?\),\s*\[(?P<keys>.*?)\],\s*"
        r'"Field-setup launch body"',
        source,
        flags=re.DOTALL,
    )
    if contract is None:
        raise AssertionError("Catalyst launch request contract could not be read")
    protocol_source = CATALYST_PROTOCOL.read_text(encoding="utf-8")
    protocol = re.search(r"module\.exports\s*=\s*(\{.*\});\s*$", protocol_source, re.DOTALL)
    if protocol is None:
        raise AssertionError("Catalyst canonical protocol could not be read")
    canonical = json.loads(protocol.group(1))
    return (
        re.findall(r'"([A-Za-z][A-Za-z0-9]*)"', contract.group("keys")),
        canonical["protocolId"],
        str(canonical["schemaVersion"]),
    )


def deluge_payload(source):
    return re.findall(
        r'payload\.put\("([A-Za-z][A-Za-z0-9]*)",([^\r\n;]+)\);',
        source,
    )


class FreeTestButtonSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        cls.sources = {
            path.name: path.read_text(encoding="utf-8")
            for path in sorted(FUNCTIONS.glob("*.deluge"))
        }

    def test_all_four_parallel_buttons_are_disabled(self):
        self.assertEqual(4, len(self.manifest["buttons"]))
        self.assertFalse(self.manifest["installation_authorized"])
        self.assertFalse(self.manifest["execution_authorized"])
        self.assertEqual(
            [
                "Open Free-Test Setup",
                "Open Free-Test Setup",
                "Approve & Start Free Test",
                "Stop / Roll Back Test",
            ],
            [button["label"] for button in self.manifest["buttons"]],
        )

    def test_open_buttons_have_bounded_effects(self):
        lead = self.sources["open_free_test_setup_lead.deluge"]
        deal = self.sources["open_free_test_setup_deal.deluge"]
        for source in (lead, deal):
            self.assertIn("getRecordById", source)
            self.assertIn("openUrl", source)
            self.assertNotIn("sendmail", source.lower())
            self.assertNotIn("convertLead", source)
            self.assertNotIn("createRecord", source)
            self.assertNotIn("updateRecord", source)

    def test_open_button_protocol_version_matches_catalyst_launch_contract(self):
        accepted_keys, accepted_protocol_id, accepted_schema_version = catalyst_launch_contract()
        self.assertEqual(
            ["protocolId", "schemaVersion", "moduleApiName", "recordId"],
            accepted_keys,
        )
        for filename, module_name, record_variable in (
            ("open_free_test_setup_lead.deluge", "Leads", "lead_id"),
            ("open_free_test_setup_deal.deluge", "Deals", "deal_id"),
        ):
            source = self.sources[filename]
            payload_entries = deluge_payload(source)
            self.assertEqual(accepted_keys, [key for key, _ in payload_entries], filename)
            payload = dict(payload_entries)
            self.assertEqual(f'"{accepted_protocol_id}"', payload["protocolId"], filename)
            self.assertEqual(accepted_schema_version, payload["schemaVersion"], filename)
            self.assertEqual(f'"{module_name}"', payload["moduleApiName"], filename)
            self.assertEqual(record_variable, payload["recordId"], filename)
            self.assertNotIn('"field-setup-launch-v1"', source)

    def test_final_actions_are_separate_and_not_browser_exposed(self):
        final_buttons = self.manifest["buttons"][2:]
        self.assertTrue(all(button["browser_exposed"] is False for button in final_buttons))
        self.assertNotEqual(final_buttons[0]["source"], final_buttons[1]["source"])
        self.assertIn("activation_readback_confirmed", self.sources["approve_and_start_free_test.deluge"])
        self.assertIn("rollback_readback_confirmed", self.sources["stop_or_roll_back_free_test.deluge"])

    def test_no_private_binding_or_credential_is_committed(self):
        combined = "\n".join(self.sources.values())
        self.assertEqual(4, combined.count("<PRIVATE_FIELD_SETUP_CONNECTION_LINK_NAME>"))
        self.assertNotRegex(combined, r"(?i)(oauth|bearer|api[_ -]?key)\s*[:=]\s*['\"][^<'\"]+")
        self.assertNotRegex(combined, r"https://[^\"']+/(?:server|baas|api)/")
        self.assertNotRegex(combined, r"\b[0-9]{15,30}\b")

    def test_record_ids_never_enter_launch_url(self):
        for name in ("open_free_test_setup_lead.deluge", "open_free_test_setup_deal.deluge"):
            source = self.sources[name]
            open_call = re.search(r"openUrl\(([^,]+),", source)
            self.assertIsNotNone(open_call)
            self.assertEqual("launch_response.get(\"launchUrl\")", open_call.group(1).strip())


if __name__ == "__main__":
    unittest.main()
