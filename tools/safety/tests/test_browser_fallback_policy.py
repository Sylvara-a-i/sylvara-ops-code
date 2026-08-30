from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
ROOT_AGENTS = ROOT / "AGENTS.md"
ZOHO_AGENTS = ROOT / "docs" / "zoho" / "AGENTS.md"
CONNECTOR_STANDARD = ROOT / "docs" / "security" / "connector-access-standard.md"
MCP_STANDARD = ROOT / "docs" / "zoho" / "mcp" / "server-standard.md"
RELEASE_README = ROOT / "src" / "zoho-catalyst" / "revenue-desk-release" / "README.md"
ROUTE_RUNBOOK = (
    ROOT
    / "src"
    / "zoho-catalyst"
    / "revenue-desk-call-runtime"
    / "route-approval-control-plane-runbook.md"
)


class BrowserFallbackPolicyTests(unittest.TestCase):
    def test_central_policy_is_connector_first_and_audit_safe(self) -> None:
        text = CONNECTOR_STANDARD.read_text(encoding="utf-8").lower()
        for marker in (
            "matching purpose-built integration first",
            "authenticated in-app browser",
            "current tool discovery",
            "first-party authenticated ui",
            "fresh sanitized prestate",
            "one exact ui action",
            "rollback or containment",
            "authoritative post-write readback separate from the save response",
            "without mislabeling that same-session read as independent",
            "fresh provider-ui read",
            "ambiguous and reconcile before retrying",
            "secret entry requires an approved private or human-controlled path",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, text)

        for prohibited in (
            "do not inject scripts",
            "developer tools",
            "direct rest request",
            "shell workaround",
            "different tenant",
        ):
            with self.subTest(prohibited=prohibited):
                self.assertIn(prohibited, text)

    def test_agent_rules_select_browser_fallback_without_expanding_authority(self) -> None:
        root = ROOT_AGENTS.read_text(encoding="utf-8").lower()
        zoho = ZOHO_AGENTS.read_text(encoding="utf-8").lower()
        self.assertIn("## external-system tool selection", root)
        self.assertIn("authenticated in-app browser", root)
        self.assertIn("browser fallback does not expand authority", root)
        self.assertIn("connector access standard", root)
        self.assertIn("## connector-first browser fallback", zoho)
        self.assertIn("changes transport, not authority", zoho)
        self.assertIn("independent readback", zoho)

    def test_mcp_and_revenue_desk_docs_preserve_fallback_gates(self) -> None:
        mcp = " ".join(MCP_STANDARD.read_text(encoding="utf-8").lower().split())
        release = " ".join(RELEASE_README.read_text(encoding="utf-8").lower().split())
        route = " ".join(ROUTE_RUNBOOK.read_text(encoding="utf-8").lower().split())

        self.assertIn("browser as an mcp login mechanism", mcp)
        self.assertIn("connector-first fallback", mcp)
        for marker in (
            "authenticated-browser fallback",
            "single-use approval window",
            "independent verification",
            "stop on any target, schema, validation, save, or readback ambiguity",
        ):
            with self.subTest(release_marker=marker):
                self.assertIn(marker, release)
        for marker in (
            "authenticated in-app browser",
            "same fresh prestate",
            "conditional predicates",
            "ambiguity handling",
            "independent readback",
        ):
            with self.subTest(route_marker=marker):
                self.assertIn(marker, route)


if __name__ == "__main__":
    unittest.main()
