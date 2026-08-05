from __future__ import annotations

import json
import re
import unittest
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[3]
LEGAL_ROOT = ROOT / "docs" / "legal-compliance"
MANIFEST_PATH = LEGAL_ROOT / "reference" / "source-manifest.json"
PROFILE_PATH = LEGAL_ROOT / "demo-control-profile.json"

EXPECTED_MARKDOWN = {
    "README.md",
    "authority-scope-and-roles.md",
    "controlled-demo-standard.md",
    "official-source-register.md",
    "privacy-security-and-data.md",
    "regulated-and-expanded-use-gates.md",
    "risk-register.md",
    "state-jurisdiction-controls.md",
    "telephony-recording-and-messaging.md",
    "vendor-client-and-launch-gates.md",
}
EXPECTED_PUBLIC_FILES = EXPECTED_MARKDOWN | {
    "demo-control-profile.json",
    "reference/source-manifest.json",
}
EXPECTED_MANIFEST_KEYS = {
    "schema_version",
    "created_on",
    "verified_on",
    "status",
    "legal_advice",
    "publication_boundary",
    "scope",
    "methodology",
    "official_sources",
    "public_artifacts",
    "update_triggers",
}
EXPECTED_SOURCE_KEYS = {
    "authority_class",
    "jurisdiction",
    "url",
    "verified_on",
}
EXPECTED_REQUIRED_CONTROLS = {
    "ai_identity_at_start",
    "demo_purpose_at_start",
    "automated_processing_notice_at_start",
    "no_sensitive_data_instruction_at_start",
    "affirmative_assent_before_scenario",
    "prior_written_tester_authorization_required",
    "pre_call_metadata_notice_required",
    "carrier_one_way_media_gate_before_assent",
    "pre_assent_inbound_audio_not_forwarded",
    "pre_assent_barge_in_audio_discarded",
    "transport_buffer_abuse_and_support_paths_verified",
    "dtmf_assent_before_speech_recognition",
    "speech_recognition_disabled_before_assent",
    "ambiguous_assent_fails_closed",
    "withdrawal_ends_call",
    "recording_disabled_from_first_packet",
    "retained_transcription_disabled_from_first_packet",
    "content_logging_disabled",
    "human_vendor_review_disabled",
    "provider_model_training_disabled",
    "production_integrations_disabled",
    "outbound_channels_disabled",
    "real_world_side_effects_disabled",
    "synthetic_knowledge_only",
    "data_allowlist_enforced",
    "emergency_refusal_and_termination",
    "sensitive_data_refusal_and_termination",
    "operator_kill_switch",
    "private_launch_evidence_required",
    "minimal_consent_receipt_approved_and_segregated",
    "qualified_counsel_approval_required",
}
REQUIRED_PROHIBITIONS = {
    "outbound_call",
    "callback",
    "sms",
    "email",
    "recording",
    "retained_transcript",
    "real_booking",
    "real_dispatch",
    "price_or_quote_commitment",
    "contract_acceptance",
    "payment_or_financial_data",
    "credential_or_identity_verification",
    "health_or_regulated_data",
    "voiceprint_or_biometric_processing",
    "emotion_or_protected_trait_inference",
    "emergency_handling",
    "production_read_or_write",
    "lead_creation",
    "content_based_analytics",
    "prospect_or_sales_demonstration",
}
REQUIRED_SOURCE_IDS = {
    "FED-TCPA",
    "FED-TCPA-RULE",
    "FED-FCC-AI-VOICE",
    "FED-FCC-AI-NPRM",
    "FED-FCC-REVOCATION-WAIVER",
    "FED-TSR",
    "FED-WIRETAP",
    "FED-FTC-ACT",
    "FED-FTC-AIR-AI",
    "FED-ADA-COMMUNICATION",
    "KS-RECORDING",
    "KS-CONSUMER-CALLS",
    "KS-BREACH-NOTICE",
    "MO-TELEMARKETING-DISCLOSURE",
    "MO-BREACH",
    "CA-RECORDING",
    "FL-RECORDING",
    "PA-RECORDING",
    "WA-RECORDING",
    "CA-CCPA-REGULATIONS",
    "CO-BIOMETRIC-2024",
    "CT-PRIVACY",
    "TX-PRIVACY",
    "IL-BIPA-DEFINITIONS",
    "WA-CONSUMER-HEALTH",
    "UT-AI-DISCLOSURE",
    "CO-ADMT-2026",
}
ALLOWED_OFFICIAL_DOMAINS = {
    "ago.mo.gov",
    "app.leg.wa.gov",
    "cga.ct.gov",
    "coag.gov",
    "cppa.ca.gov",
    "docs.fcc.gov",
    "gc.nh.gov",
    "ksag.washburnlaw.edu",
    "le.utah.gov",
    "leg.colorado.gov",
    "leginfo.legislature.ca.gov",
    "malegislature.gov",
    "mca.legmt.gov",
    "mgaleg.maryland.gov",
    "oag.ca.gov",
    "revisor.mo.gov",
    "statutes.capitol.texas.gov",
    "www.ada.gov",
    "www.cga.ct.gov",
    "www.ecfr.gov",
    "www.fcc.gov",
    "www.federalregister.gov",
    "www.ftc.gov",
    "www.govinfo.gov",
    "www.ilga.gov",
    "www.ksrevisor.gov",
    "www.leg.state.fl.us",
    "www.legis.state.pa.us",
    "www.nist.gov",
    "www.pcisecuritystandards.org",
}
MARKDOWN_LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
SOURCE_CITATION_RE = re.compile(
    r"\[([A-Z][A-Z0-9-]*(?:; [A-Z][A-Z0-9-]*)*)\]"
)


def relative_markdown_targets(text: str) -> set[str]:
    return {
        target.strip("<>").split("#", 1)[0]
        for target in MARKDOWN_LINK_RE.findall(text)
        if target
        and not target.startswith(("http://", "https://", "mailto:", "#"))
    }


class LegalComplianceKnowledgeBaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        cls.profile = json.loads(PROFILE_PATH.read_text(encoding="utf-8"))
        cls.markdown_files = sorted(LEGAL_ROOT.rglob("*.md"))
        cls.public_files = sorted(
            path for path in LEGAL_ROOT.rglob("*") if path.is_file()
        )

    def test_expected_public_file_set_is_exact(self) -> None:
        actual_markdown = {
            path.relative_to(LEGAL_ROOT).as_posix()
            for path in self.markdown_files
        }
        actual_files = {
            path.relative_to(LEGAL_ROOT).as_posix()
            for path in self.public_files
        }
        self.assertEqual(EXPECTED_MARKDOWN, actual_markdown)
        self.assertEqual(EXPECTED_PUBLIC_FILES, actual_files)

    def test_markdown_has_one_h1_and_resolving_local_links(self) -> None:
        for path in self.markdown_files:
            text = path.read_text(encoding="utf-8")
            h1_lines = [line for line in text.splitlines() if line.startswith("# ")]
            self.assertEqual(1, len(h1_lines), path)
            for target in relative_markdown_targets(text):
                resolved = (path.parent / target).resolve()
                self.assertTrue(
                    resolved.is_relative_to(ROOT.resolve()),
                    f"Link escapes repository: {path} -> {target}",
                )
                self.assertTrue(resolved.exists(), f"Broken link: {path} -> {target}")

    def test_manifest_is_dated_and_fail_closed(self) -> None:
        self.assertEqual(EXPECTED_MANIFEST_KEYS, set(self.manifest))
        self.assertEqual(1, self.manifest["schema_version"])
        self.assertEqual("2026-08-04", self.manifest["created_on"])
        self.assertEqual("2026-08-04", self.manifest["verified_on"])
        self.assertEqual("dated-research-counsel-review-required", self.manifest["status"])
        self.assertFalse(self.manifest["legal_advice"])
        self.assertEqual(
            {
                "classification": "sylvara-original-synthesis",
                "source_text_reproduced": False,
                "caller_or_client_data_included": False,
                "legal_advice_included": False,
                "live_configuration_included": False,
            },
            self.manifest["publication_boundary"],
        )
        self.assertIn("none", self.manifest["scope"]["approved_profile"])
        self.assertFalse(self.manifest["methodology"]["state_matrix_complete"])
        self.assertFalse(self.manifest["methodology"]["case_law_citator_completed"])
        self.assertTrue(
            self.manifest["methodology"]["qualified_counsel_approval_required"]
        )

    def test_sources_are_dated_unique_and_official(self) -> None:
        sources = self.manifest["official_sources"]
        self.assertGreaterEqual(len(sources), 90)
        self.assertTrue(REQUIRED_SOURCE_IDS.issubset(sources))
        urls = [source["url"] for source in sources.values()]
        self.assertEqual(len(urls), len(set(urls)))
        for source_id, source in sources.items():
            with self.subTest(source=source_id):
                self.assertRegex(source_id, r"^[A-Z][A-Z0-9-]+$")
                self.assertEqual(EXPECTED_SOURCE_KEYS, set(source))
                self.assertEqual("2026-08-04", source["verified_on"])
                parsed = urlparse(source["url"])
                self.assertEqual("https", parsed.scheme)
                self.assertIn(parsed.netloc, ALLOWED_OFFICIAL_DOMAINS)

    def test_all_citations_and_external_links_are_registered(self) -> None:
        sources = self.manifest["official_sources"]
        registered_urls = {source["url"] for source in sources.values()}
        cited_ids: set[str] = set()
        external_urls: set[str] = set()
        for path in self.markdown_files:
            text = path.read_text(encoding="utf-8")
            for match in SOURCE_CITATION_RE.findall(text):
                cited_ids.update(part.strip() for part in match.split(";"))
            external_urls.update(
                target
                for target in MARKDOWN_LINK_RE.findall(text)
                if target.startswith(("http://", "https://"))
            )
        self.assertTrue(cited_ids)
        self.assertEqual(set(), cited_ids - set(sources))
        self.assertEqual(set(), external_urls - registered_urls)

    def test_source_register_contains_every_manifest_url_and_id(self) -> None:
        register = (LEGAL_ROOT / "official-source-register.md").read_text(
            encoding="utf-8"
        )
        for source_id, source in self.manifest["official_sources"].items():
            with self.subTest(source=source_id):
                self.assertIn(f"`{source_id}`", register)
                self.assertIn(source["url"], register)

    def test_public_artifacts_match_files(self) -> None:
        self.assertEqual(
            EXPECTED_PUBLIC_FILES,
            set(self.manifest["public_artifacts"]),
        )

    def test_demo_profile_is_not_launch_authorization(self) -> None:
        self.assertEqual(1, self.profile["schema_version"])
        self.assertEqual(
            "controlled-inbound-ai-receptionist-internal-qa",
            self.profile["profile_id"],
        )
        self.assertEqual(
            "proposed-counsel-review-required", self.profile["status"]
        )
        self.assertEqual(
            "not-environment-verified", self.profile["implementation_status"]
        )
        self.assertEqual("2026-08-04", self.profile["verified_on"])
        self.assertFalse(self.profile["launch_authorized"])
        self.assertEqual(
            "non-public-allowlisted-and-rate-limited",
            self.profile["scope"]["access"],
        )
        self.assertEqual(
            "internal-non-sales-quality-assurance-only",
            self.profile["scope"]["purpose"],
        )

    def test_proposed_demo_control_profile_declares_fail_closed_requirements(self) -> None:
        controls = self.profile["required_controls"]
        self.assertEqual(EXPECTED_REQUIRED_CONTROLS, set(controls))
        self.assertTrue(all(controls.values()))
        self.assertEqual(
            REQUIRED_PROHIBITIONS,
            set(self.profile["prohibited_capabilities"]),
        )
        self.assertNotIn("name", self.profile["allowed_fictional_fields"])
        self.assertNotIn("email", self.profile["allowed_fictional_fields"])
        self.assertNotIn("telephone_number", self.profile["allowed_fictional_fields"])
        self.assertIn(
            "fictional_plumbing_service_category",
            self.profile["allowed_fictional_fields"],
        )

    def test_repository_navigation_and_architecture_link_controls(self) -> None:
        root_readme = (ROOT / "README.md").read_text(encoding="utf-8")
        agent_policy = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
        architecture = (ROOT / "docs" / "architecture" / "system-overview.md").read_text(
            encoding="utf-8"
        )
        for text in (root_readme, agent_policy, architecture):
            self.assertIn("legal-compliance", text)
        self.assertIn("not launch-approved", agent_policy)
        self.assertIn("using a carrier media gate, keypad assent", root_readme)
        self.assertIn("Prospect-facing telephone demonstrations remain blocked", root_readme)
        self.assertIn("no post-call handoff", architecture)

    def test_no_unqualified_compliance_or_completeness_claim(self) -> None:
        combined = "\n".join(
            path.read_text(encoding="utf-8") for path in self.markdown_files
        ).lower()
        self.assertIn("not legal advice", combined)
        self.assertIn("not a fifty-state", combined)
        self.assertIn("proposed", combined)
        self.assertIn("qualified counsel", combined)
        self.assertIn(
            "no person can promise that a software stack is “perfectly legal.”",
            combined,
        )
        self.assertNotIn("fully compliant", combined)
        self.assertNotIn("launch authorized", combined)

    def test_public_files_are_small_utf8_text(self) -> None:
        for path in self.public_files:
            self.assertLess(path.stat().st_size, 2 * 1024 * 1024, path)
            path.read_text(encoding="utf-8")
            self.assertIn(path.suffix, {".md", ".json"})


if __name__ == "__main__":
    unittest.main()
