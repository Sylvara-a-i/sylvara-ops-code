from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SUPERSEDED = ROOT / "docs" / "adr" / "0005-client-specific-retell-test-agent-isolation.md"
CURRENT = ROOT / "docs" / "adr" / "0006-shared-seven-day-monitor-with-client-number-isolation.md"
RUNBOOK = ROOT / "docs" / "runbooks" / "shared-seven-day-monitor-number-routing.md"
LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")


class RetellAgentIsolationDecisionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.superseded_text = SUPERSEDED.read_text(encoding="utf-8")
        cls.current_text = CURRENT.read_text(encoding="utf-8")
        cls.runbook_text = RUNBOOK.read_text(encoding="utf-8")
        cls.current_lower = cls.current_text.lower()
        cls.runbook_lower = cls.runbook_text.lower()

    def test_decisions_and_runbook_have_one_h1_and_local_links_resolve(self) -> None:
        for path, text in (
            (SUPERSEDED, self.superseded_text),
            (CURRENT, self.current_text),
            (RUNBOOK, self.runbook_text),
        ):
            with self.subTest(path=path):
                h1s = [line for line in text.splitlines() if line.startswith("# ")]
                self.assertEqual(1, len(h1s))

                for target in LINK_RE.findall(text):
                    target = target.strip("<>").split("#", 1)[0]
                    if not target or target.startswith(("http://", "https://", "mailto:", "#")):
                        continue
                    self.assertTrue((path.parent / target).resolve().is_file())

    def test_old_client_monitor_clone_decision_is_superseded(self) -> None:
        lower = self.superseded_text.lower()
        self.assertIn("status: **superseded**", lower)
        self.assertIn("superseded by: [adr 0006]", lower)
        self.assertIn("do not implement the client-specific monitor-clone", lower)

    def test_current_topology_is_unambiguous(self) -> None:
        required = (
            "one shared monitor agent",
            "one dedicated retell number and deployment per active test client",
            "one dedicated revenue desk agent per converted client",
            "the client keeps the same forwarding destination",
            "all approved client numbers may use the same inbound-webhook endpoint",
            "no active retell number shared by two clients",
        )
        for marker in required:
            with self.subTest(marker=marker):
                self.assertIn(marker, self.current_lower)

    def test_monitor_and_revenue_desk_are_separate_agent_products(self) -> None:
        self.assertIn("seven-day call-gap monitor", self.current_lower)
        self.assertIn("revenue desk master and client clones", self.current_lower)
        self.assertIn(
            "the monitor and revenue desk remain separate agents",
            self.current_lower,
        )
        self.assertIn(
            "the monitor agent is not promoted into the revenue desk",
            self.runbook_lower,
        )

    def test_number_not_agent_is_the_shared_monitor_client_boundary(self) -> None:
        self.assertIn(
            "the additional number is intentional. it is the stable client-routing boundary",
            self.current_lower,
        )
        self.assertIn(
            "the shared monitor `agent_id` identifies the monitor product, not the client",
            self.runbook_lower,
        )
        self.assertIn("unique retell `to_number` mapping", self.current_lower)
        self.assertIn(
            "the shared monitor `agent_id` intentionally maps to multiple deployments",
            self.current_lower,
        )

    def test_one_shared_inbound_resolver_is_required(self) -> None:
        for marker in (
            "use one catalyst endpoint for all approved client numbers",
            "post /retell/inbound",
            "resolve `to_number` to exactly one active deployment",
            "return only the allowlisted metadata and string dynamic variables",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.current_lower)

    def test_post_call_resolution_does_not_use_shared_agent_as_tenancy_key(self) -> None:
        ordered_markers = (
            "validated explicit `deployment_id`",
            "existing immutable call-to-deployment binding",
            "unique retell `to_number` mapping",
            "retell `agent_id` only when that agent maps to exactly one active deployment",
        )
        positions = [self.current_lower.index(marker) for marker in ordered_markers]
        self.assertEqual(positions, sorted(positions))
        self.assertIn(
            "the processor must not quarantine a call merely because the shared monitor agent has multiple deployments",
            self.current_lower,
        )

    def test_neutral_fallback_and_client_reporting_are_explicit(self) -> None:
        self.assertIn("neutral fallback", self.current_lower)
        self.assertIn("resolver_status = degraded", self.current_lower)
        self.assertIn("client_id + deployment_id + call_id", self.current_lower)
        self.assertIn("one client per report", self.current_lower)
        self.assertIn("no cross-client metadata", self.current_lower)

    def test_two_client_acceptance_and_clone_fallback_are_required(self) -> None:
        self.assertIn("at least two synthetic clients and two dedicated retell numbers", self.current_lower)
        self.assertIn("both numbers reach the same pinned monitor version", self.current_lower)
        self.assertIn("use one monitor clone per client until the defect is corrected", self.current_lower)
        self.assertIn("rebind number a to revenue desk clone", self.runbook_lower)

    def test_scope_remains_narrow_and_live_authority_is_not_claimed(self) -> None:
        self.assertIn("not a generalized multi-tenant voice platform", self.current_lower)
        self.assertIn("does not authorize a live seven-day test", self.current_lower)
        self.assertIn("production authorization: **not granted**", self.runbook_lower)
        self.assertNotIn("is deployed and working", self.current_lower)

    def test_provider_claims_use_only_official_retell_sources(self) -> None:
        urls = [
            target
            for text in (self.current_text, self.runbook_text)
            for target in LINK_RE.findall(text)
            if target.startswith("https://")
        ]
        self.assertGreaterEqual(len(urls), 7)
        for url in urls:
            with self.subTest(url=url):
                self.assertTrue(url.startswith("https://docs.retellai.com/"))


if __name__ == "__main__":
    unittest.main()
