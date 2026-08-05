from __future__ import annotations

import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
ROOT_AGENTS = ROOT / "AGENTS.md"
ZOHO_AGENTS = ROOT / "docs" / "zoho" / "AGENTS.md"
DOCUMENT_STANDARD = ROOT / "docs" / "standards" / "document-drafting-standard.md"
DOCUMENT_PROFILE = ROOT / "docs" / "standards" / "document-style-profile.json"
CODE_REVIEW = ROOT / "docs" / "standards" / "code-review.md"
STANDARDS_README = ROOT / "docs" / "standards" / "README.md"
MARKDOWN_LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")


def headings(text: str, level: int) -> set[str]:
    prefix = "#" * level + " "
    return {
        line.removeprefix(prefix).strip()
        for line in text.splitlines()
        if line.startswith(prefix) and not line.startswith(prefix + "#")
    }


class AgentInstructionsTests(unittest.TestCase):
    def test_root_instructions_define_operator_and_artifact_behavior(self) -> None:
        text = ROOT_AGENTS.read_text(encoding="utf-8")
        required = {
            "Operator And Delivery Preferences",
            "Task Modes And Authority",
            "Engineering And Review Quality",
            "Document Drafting And Presentation",
        }
        self.assertTrue(required.issubset(headings(text, 2)))
        self.assertIn("simplest robust implementation", text)
        self.assertIn("Repository approval never expands authority", text)
        self.assertIn("Render and visually inspect every page", text)
        self.assertIn("user-visible or business behavior change", text)
        self.assertIn("manual smoke-test steps", text)
        self.assertIn("pull-request, check, and merge status", text)
        self.assertIn("comments or documentation added or revised", text)

        for target in MARKDOWN_LINK_RE.findall(text):
            if target.startswith(("http://", "https://", "mailto:", "#")):
                continue
            resolved = (ROOT_AGENTS.parent / target.strip("<>").split("#", 1)[0]).resolve()
            with self.subTest(target=target):
                self.assertTrue(resolved.exists())

    def test_document_profile_matches_portable_font_and_qa_policy(self) -> None:
        profile = json.loads(DOCUMENT_PROFILE.read_text(encoding="utf-8"))
        self.assertEqual(1, profile["schema_version"])
        self.assertEqual("SYL-DOC-001", profile["standard_id"])
        self.assertEqual("Inter", profile["typography"]["portable_production_font"])
        self.assertEqual(
            "San Francisco through the native system-font API only",
            profile["typography"]["apple_interface_font"],
        )
        self.assertFalse(profile["typography"]["apple_font_files_may_be_bundled"])
        self.assertFalse(profile["typography"]["apple_font_files_may_be_embedded"])
        self.assertEqual("US Letter", profile["page"]["size"])
        self.assertEqual(
            ["paged_us_letter_business_documents"],
            profile["scope"]["page_and_type_defaults_apply_to"],
        )
        self.assertTrue(profile["scope"]["output_specific_overrides_allowed"])
        self.assertEqual(
            {"top": 0.8, "bottom": 0.78, "left": 1.0, "right": 1.0},
            profile["page"]["margins_in"],
        )
        self.assertTrue(profile["quality_assurance"]["render_every_page"])
        self.assertEqual("draft", profile["quality_assurance"]["unverified_artifact_status"])

    def test_human_readable_standards_keep_required_controls(self) -> None:
        standards_readme = STANDARDS_README.read_text(encoding="utf-8")
        self.assertTrue(
            {"Standards", "Use Rules", "Portability Boundary"}.issubset(
                headings(standards_readme, 2)
            )
        )

        drafting = DOCUMENT_STANDARD.read_text(encoding="utf-8")
        self.assertTrue(
            {
                "Purpose And Priority",
                "Typography",
                "Page And Type Defaults",
                "Required Final QA",
                "Exceptions And Repository Boundary",
            }.issubset(headings(drafting, 2))
        )
        self.assertIn("Inter", drafting)
        self.assertIn("San Francisco", drafting)

        review = CODE_REVIEW.read_text(encoding="utf-8")
        self.assertTrue(
            {"Review Order", "Severity", "Required Checks", "Review Output Contract"}.issubset(
                headings(review, 2)
            )
        )
        self.assertIn("untrusted", review.lower())

        for path in (STANDARDS_README, DOCUMENT_STANDARD, CODE_REVIEW):
            for target in MARKDOWN_LINK_RE.findall(path.read_text(encoding="utf-8")):
                if target.startswith(("http://", "https://", "mailto:", "#")):
                    continue
                resolved = (path.parent / target.strip("<>").split("#", 1)[0]).resolve()
                with self.subTest(path=path, target=target):
                    self.assertTrue(resolved.exists())

    def test_nested_zoho_agent_rules_preserve_evidence_boundaries(self) -> None:
        text = ZOHO_AGENTS.read_text(encoding="utf-8")
        self.assertTrue(
            {
                "Required Reading And Evidence Order",
                "Editing Rules",
                "High-Risk Work",
                "Documentation Completion Check",
            }.issubset(headings(text, 2))
        )
        for marker in (
            "official product support",
            "effective tenant access",
            "TBD_FROM_ZOHO_METADATA",
            "never authorizes a live Zoho read or write",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, text)


if __name__ == "__main__":
    unittest.main()
