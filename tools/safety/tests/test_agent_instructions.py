from __future__ import annotations

import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
ROOT_AGENTS = ROOT / "AGENTS.md"
ZOHO_AGENTS = ROOT / "docs" / "zoho" / "AGENTS.md"
SAFETY_AGENTS = ROOT / "tools" / "safety" / "AGENTS.md"
GATEWAY_AGENTS = (
    ROOT / "src" / "zoho-catalyst" / "billing-webhook-gateway" / "AGENTS.md"
)
ROOT_VERIFIER = ROOT / "tools" / "verify.cmd"
DOCUMENT_STANDARD = ROOT / "docs" / "standards" / "document-drafting-standard.md"
DOCUMENT_PROFILE = ROOT / "docs" / "standards" / "document-style-profile.json"
CODE_REVIEW = ROOT / "docs" / "standards" / "code-review.md"
STANDARDS_README = ROOT / "docs" / "standards" / "README.md"
MARKDOWN_LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")

INSTRUCTION_BYTE_BUDGETS = {
    ROOT_AGENTS: 10_000,
    ZOHO_AGENTS: 4_000,
    SAFETY_AGENTS: 3_500,
    GATEWAY_AGENTS: 4_500,
}
MAX_ROOT_AND_NESTED_BYTES = 12_000


def headings(text: str, level: int) -> set[str]:
    prefix = "#" * level + " "
    return {
        line.removeprefix(prefix).strip()
        for line in text.splitlines()
        if line.startswith(prefix) and not line.startswith(prefix + "#")
    }


def section(text: str, heading: str) -> str:
    match = re.search(
        rf"^## {re.escape(heading)}\s*$\n(?P<body>.*?)(?=^## |\Z)",
        text,
        re.MULTILINE | re.DOTALL,
    )
    if match is None:
        raise AssertionError(f"Missing section: {heading}")
    return match.group("body")


def local_link_targets(path: Path) -> set[Path]:
    targets: set[Path] = set()
    for raw_target in MARKDOWN_LINK_RE.findall(path.read_text(encoding="utf-8")):
        if raw_target.startswith(("http://", "https://", "mailto:", "#")):
            continue
        relative = raw_target.strip("<>").split("#", 1)[0]
        targets.add((path.parent / relative).resolve())
    return targets


class AgentInstructionsTests(unittest.TestCase):
    def test_instruction_hierarchy_stays_within_context_budget(self) -> None:
        for path, budget in INSTRUCTION_BYTE_BUDGETS.items():
            with self.subTest(path=path):
                self.assertTrue(path.is_file())
                self.assertLessEqual(len(path.read_bytes()), budget)

        root_bytes = len(ROOT_AGENTS.read_bytes())
        for nested in (ZOHO_AGENTS, SAFETY_AGENTS, GATEWAY_AGENTS):
            with self.subTest(combined_with=nested):
                self.assertLessEqual(
                    root_bytes + len(nested.read_bytes()),
                    MAX_ROOT_AND_NESTED_BYTES,
                )

    def test_root_instructions_route_work_and_preserve_authority(self) -> None:
        text = ROOT_AGENTS.read_text(encoding="utf-8")
        required = {
            "Mission And Decision Standard",
            "Task Authority",
            "Required Reading Router",
            "Permanent Public Boundary",
            "Current Product Boundary",
            "Engineering And Verification",
            "Git And Pull Requests",
            "Completion Contract",
        }
        self.assertTrue(required.issubset(headings(text, 2)))

        authority = section(text, "Task Authority").lower()
        for control in ("live tenant write", "customer communication", "deployment", "exact target"):
            with self.subTest(authority_control=control):
                self.assertIn(control, authority)

        public_boundary = section(text, "Permanent Public Boundary").lower()
        for control in ("permanently public", "credentials", "pii", "synthetic", "archive/"):
            with self.subTest(public_control=control):
                self.assertIn(control, public_boundary)

        expected_routes = {
            ROOT / "docs" / "product" / "README.md",
            ROOT / "docs" / "legal-compliance" / "README.md",
            ROOT / "docs" / "zoho" / "README.md",
            ROOT / "docs" / "accounting" / "README.md",
            ROOT / "docs" / "copywriting" / "README.md",
            ROOT / "docs" / "standards" / "code-review.md",
            ROOT / "docs" / "standards" / "document-drafting-standard.md",
            ROOT / "docs" / "standards" / "document-style-profile.json",
        }
        self.assertTrue(expected_routes.issubset(local_link_targets(ROOT_AGENTS)))

    def test_instruction_links_resolve_inside_repository(self) -> None:
        for path in INSTRUCTION_BYTE_BUDGETS:
            for target in local_link_targets(path):
                with self.subTest(path=path, target=target):
                    self.assertTrue(target.is_relative_to(ROOT.resolve()))
                    self.assertTrue(target.is_file())

    def test_root_defines_one_canonical_verification_command(self) -> None:
        text = ROOT_AGENTS.read_text(encoding="utf-8")
        self.assertEqual(1, text.count(r".\tools\verify.cmd"))
        self.assertTrue(ROOT_VERIFIER.is_file())

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
        text = ZOHO_AGENTS.read_text(encoding="utf-8").lower()
        self.assertTrue(
            {
                "Evidence Layers",
                "Documentation Scope",
                "Live Evidence And Authority",
            }.issubset(headings(ZOHO_AGENTS.read_text(encoding="utf-8"), 2))
        )
        for marker in (
            "official zoho documentation",
            "advertised tool contract",
            "effective tenant access",
            "approved sylvara requirement",
            "independent readback",
            "does not authorize a live zoho read or write",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, text)

    def test_nested_safety_rules_preserve_fail_closed_scope(self) -> None:
        text = SAFETY_AGENTS.read_text(encoding="utf-8").lower()
        for invariant in (
            "fail closed",
            "git index",
            "untracked, non-ignored",
            "working-tree edits",
            "deterministic",
            "offline",
            "failed check",
            "sanitized diagnostics",
        ):
            with self.subTest(invariant=invariant):
                self.assertIn(invariant, text)

    def test_nested_gateway_rules_preserve_high_risk_contract(self) -> None:
        text = GATEWAY_AGENTS.read_text(encoding="utf-8").lower()
        for invariant in (
            "production remains code-blocked",
            "unchanged raw bytes before parsing",
            "durable unique key",
            "reconciliation_required",
            "authoritative readback",
            "books remains accounting truth",
            "explicitly allowlisted",
            "npm run ci",
        ):
            with self.subTest(invariant=invariant):
                self.assertIn(invariant, text)


if __name__ == "__main__":
    unittest.main()
