import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
RELEASE = ROOT / "docs" / "product" / "free-revenue-leak-test-release-contract.json"
REQUEST = ROOT / "src" / "zoho-catalyst" / "revenue-leak-test-request-form"
SETUP = ROOT / "src" / "zoho-catalyst" / "revenue-leak-test-setup-form"
CRM = ROOT / "src" / "zoho-crm" / "free-revenue-leak-test"
FORMS = ROOT / "src" / "zoho-forms" / "free-revenue-leak-test" / "forms-manifest.json"


class FreeTestFieldSetupContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.release = json.loads(RELEASE.read_text(encoding="utf-8"))
        cls.field_setup = cls.release["field_setup_candidate"]
        cls.v2 = cls.release["retell_v2_candidate"]

    def test_release_keeps_field_setup_and_live_install_blocked(self):
        self.assertEqual("NOT_READY", self.field_setup["status"])
        self.assertEqual("NOT_AUTHORIZED", self.field_setup["live_install_status"])
        self.assertFalse(self.field_setup["web_client_deployment_or_publication_authorized"])
        self.assertFalse(self.field_setup["browser_activation_allowed"])
        self.assertEqual(0, self.field_setup["new_catalyst_function_count"])

    def test_only_two_existing_forms_are_preserved(self):
        self.assertEqual(
            ["REVENUE_LEAK_TEST_REQUEST_FORM", "REVENUE_LEAK_TEST_SETUP_FORM"],
            self.field_setup["forms_preserved"],
        )
        self.assertFalse(self.field_setup["form3_allowed"])
        forms_text = FORMS.read_text(encoding="utf-8").lower()
        self.assertNotIn("form 3", forms_text)
        self.assertNotIn("form3", forms_text)

    def test_one_narrow_journey_table_is_justified_and_disabled(self):
        schema = json.loads(
            (REQUEST / "config" / "field-setup-datastore-schema.proposed.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(1, schema["existing_store_reuse_decision"]["new_table_count"])
        self.assertEqual(
            "RevenueLeakTestFieldSetupJourneys", schema["table"]["api_name"]
        )
        self.assertEqual("none", schema["table"]["client_access"])
        self.assertFalse(schema["table"]["delete_permission"])
        prohibited = " ".join(schema["data_policy"]["prohibited"]).lower()
        self.assertIn("raw nonce", prohibited)
        self.assertIn("secret", prohibited)

    def test_launch_contract_is_fragment_only_digest_only_and_sixty_seconds(self):
        launch = self.field_setup["launch_protocol"]
        self.assertEqual(256, launch["nonce_entropy_bits"])
        self.assertEqual("keyed digest only", launch["nonce_storage"])
        self.assertEqual(60, launch["maximum_ttl_seconds"])
        self.assertEqual("fragment nonce only", launch["url_content"])
        self.assertEqual(
            [
                "Secure",
                "HttpOnly",
                "SameSite=Strict",
                "bounded idle expiry",
                "bounded absolute expiry",
            ],
            launch["session_cookie"],
        )

    def test_field_setup_routes_are_proposed_disabled_and_do_not_activate(self):
        manifest = json.loads(
            (REQUEST / "config" / "field-setup-routes.proposed.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual("source-only-disabled-not-wired", manifest["status"])
        self.assertEqual(4, len(manifest["routes"]))
        self.assertTrue(all(route["enabled"] is False for route in manifest["routes"]))
        rendered = json.dumps(manifest).lower()
        self.assertIn("browser_cannot_authorize", rendered)
        self.assertIn("activation", rendered)

    def test_client_has_exact_22_states_and_required_responsive_contract(self):
        client = REQUEST / "client" / "field-setup"
        state_source = (client / "state-model.js").read_text(encoding="utf-8")
        state_block = state_source.split("const FIELD_SETUP_STATES", 1)[1].split(
            "const STATE_BY_ID", 1
        )[0]
        self.assertEqual(22, len(re.findall(r'\bid:\s*"[a-z0-9-]+"', state_block)))
        self.assertIn("width: 768, height: 1024", state_source)
        self.assertIn("width: 1024, height: 1366", state_source)
        styles = (client / "styles.css").read_text(encoding="utf-8")
        self.assertRegex(styles, r"button\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*(?:44|4[5-9]|[5-9][0-9])px;", re.S)
        self.assertIn(":focus-visible", styles)

    def test_client_removes_fragment_and_contains_no_iframe_or_activation_adapter(self):
        client = REQUEST / "client" / "field-setup"
        fragment = (client / "launch-fragment.js").read_text(encoding="utf-8")
        self.assertIn("historyLike.replaceState", fragment)
        rendered = "\n".join(
            path.read_text(encoding="utf-8")
            for path in client.glob("*")
            if path.is_file()
        ).lower()
        self.assertNotIn("<iframe", rendered)
        adapter = (client / "api-adapter.js").read_text(encoding="utf-8").lower()
        self.assertNotIn("fetch(", adapter)
        self.assertNotIn("xmlhttprequest", adapter)
        self.assertIn("synthetic", adapter)

    def test_client_is_not_a_deploy_target(self):
        catalyst = json.loads((REQUEST / "catalyst.json").read_text(encoding="utf-8"))
        self.assertNotIn("client", catalyst)
        gate = catalyst["x-sylvara-source-only-client"]
        self.assertFalse(gate["deploymentAllowed"])
        self.assertFalse(gate["published"])

    def test_synthetic_ipad_screenshots_have_exact_required_dimensions(self):
        root = (
            ROOT
            / "docs"
            / "runbooks"
            / "assets"
            / "free-revenue-leak-test-field-setup"
        )
        for name, expected in [
            ("field-setup-768x1024.jpg", (768, 1024)),
            ("field-setup-1024x1366.jpg", (1024, 1366)),
        ]:
            payload = (root / name).read_bytes()
            self.assertEqual(b"\xff\xd8", payload[:2])
            self.assertEqual(expected, self._jpeg_dimensions(payload))

    @staticmethod
    def _jpeg_dimensions(payload):
        position = 2
        start_of_frame = {
            0xC0,
            0xC1,
            0xC2,
            0xC3,
            0xC5,
            0xC6,
            0xC7,
            0xC9,
            0xCA,
            0xCB,
            0xCD,
            0xCE,
            0xCF,
        }
        while position + 8 < len(payload):
            if payload[position] != 0xFF:
                position += 1
                continue
            while position < len(payload) and payload[position] == 0xFF:
                position += 1
            marker = payload[position]
            position += 1
            if marker in {0xD8, 0xD9}:
                continue
            if marker == 0xDA:
                break
            segment_length = int.from_bytes(payload[position : position + 2], "big")
            if segment_length < 2 or position + segment_length > len(payload):
                break
            if marker in start_of_frame:
                height = int.from_bytes(payload[position + 3 : position + 5], "big")
                width = int.from_bytes(payload[position + 5 : position + 7], "big")
                return width, height
            position += segment_length
        raise AssertionError("JPEG start-of-frame dimensions were not found")

    def test_crm_parallel_buttons_are_disabled_and_separate(self):
        manifest = json.loads(
            (CRM / "buttons" / "button-manifest.json").read_text(encoding="utf-8")
        )
        self.assertFalse(manifest["installation_authorized"])
        self.assertFalse(manifest["execution_authorized"])
        self.assertEqual(4, len(manifest["buttons"]))
        self.assertEqual(2, sum(button["label"] == "Open Free-Test Setup" for button in manifest["buttons"]))
        self.assertEqual(
            ["Approve & Start Free Test", "Stop / Roll Back Test"],
            [button["label"] for button in manifest["buttons"][2:]],
        )
        self.assertTrue(all(button["browser_exposed"] is False for button in manifest["buttons"][2:]))

    def test_crm_sources_have_no_committed_endpoint_or_credential(self):
        source = "\n".join(
            path.read_text(encoding="utf-8")
            for path in sorted((CRM / "functions").glob("*.deluge"))
        )
        self.assertEqual(4, source.count("<PRIVATE_FIELD_SETUP_CONNECTION_LINK_NAME>"))
        self.assertNotRegex(source, r"https://[^\"']+/(?:server|baas|api)/")
        self.assertNotRegex(source, r"(?i)(?:zcfkey|bearer|client_secret)\s*[:=]\s*['\"][^<][^'\"]+")
        self.assertNotRegex(source, r"\b[0-9]{15,30}\b")

    def test_route_verification_never_starts_intake_counts_or_notifies(self):
        self.assertFalse(self.field_setup["route_verification_normal_intake_allowed"])
        self.assertEqual(0, self.field_setup["route_verification_handled_call_increment"])
        self.assertFalse(self.field_setup["route_verification_notification_allowed"])
        proposed = json.loads(
            (SETUP / "config" / "field-setup-operations.proposed.json").read_text(
                encoding="utf-8"
            )
        )
        verification = proposed["route_verification"]
        disposition = verification["verified_qa_runtime_disposition"]
        self.assertFalse(disposition["collect_agent_intake"])
        self.assertFalse(disposition["start_agent"])
        self.assertFalse(disposition["increment_handled_call_count"])
        self.assertFalse(disposition["send_notification"])

    def test_v2_is_draft_disabled_no_traffic_and_v1_is_preserved(self):
        self.assertEqual("NOT_READY", self.v2["status"])
        self.assertEqual("call_gap_capture_handoff_v2", self.v2["profile"])
        self.assertTrue(self.v2["draft"])
        self.assertFalse(self.v2["enabled"])
        self.assertEqual([], self.v2["traffic_environments"])
        self.assertEqual("call_gap_monitor_v1", self.v2["v1_profile_preserved"])
        self.assertFalse(self.v2["provider_event_parser_implemented"])
        self.assertEqual(17, self.v2["analysis_field_count"])
        self.assertFalse(self.v2["routine_transfer_allowed"])
        self.assertFalse(self.v2["retell_email_allowed"])

    def test_runbook_and_adr_record_required_separations_and_rollback(self):
        runbook = (
            ROOT / "docs" / "runbooks" / "free-revenue-leak-test-field-setup.md"
        ).read_text(encoding="utf-8")
        adr = (
            ROOT
            / "docs"
            / "adr"
            / "0008-bounded-free-test-human-handoff-and-operator-led-field-setup.md"
        ).read_text(encoding="utf-8")
        combined = f"{runbook}\n{adr}".lower()
        for required in [
            "no form 3",
            "not a customer portal",
            "call_gap_monitor_v1",
            "call_gap_capture_handoff_v2",
            "routine actionable calls",
            "human handoff",
            "infrastructure fallback",
            "customer rollback",
            "route verification",
            "not_authorized",
        ]:
            self.assertIn(required, combined)


if __name__ == "__main__":
    unittest.main()
