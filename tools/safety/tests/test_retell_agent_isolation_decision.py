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
            "use one shared free-test agent",
            "one dedicated retell number per active test client",
            "one versioned catalyst deployment/configuration record per active test",
            "one shared inbound resolver",
            "the shared free-test agent is never promoted into a revenue desk",
            "not a generalized multi-tenant voice platform",
        )
        for marker in required:
            with self.subTest(marker=marker):
                self.assertIn(marker, self.current_lower)

    def test_monitor_and_revenue_desk_are_separate_agent_products(self) -> None:
        self.assertIn("shared **7-day free test** agent", self.current_lower)
        self.assertIn("**revenue desk**", self.current_lower)
        self.assertIn(
            "the shared free-test agent is never promoted into a revenue desk",
            self.current_lower,
        )
        self.assertIn(
            "never auto-extend, auto-convert, or start a revenue desk",
            self.runbook_lower,
        )

    def test_number_not_agent_is_the_shared_monitor_client_boundary(self) -> None:
        self.assertIn(
            "called `to_number` identifies the dedicated forwarding destination",
            self.current_lower,
        )
        self.assertIn(
            "catalyst binds that number to exactly one client deployment",
            self.current_lower,
        )
        self.assertIn(
            "the shared retell `agent_id` identifies the free-test product; it is not sufficient evidence of client ownership",
            self.current_lower,
        )
        self.assertIn(
            "the shared `agent_id` identifies the product, never the tenant",
            self.runbook_lower,
        )

    def test_one_shared_inbound_resolver_is_required(self) -> None:
        for marker in (
            "one shared inbound resolver",
            "the called `to_number` maps to exactly one eligible number assignment",
            "return only allowlisted metadata, shared agent/version, and approved dynamic variables",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.current_lower + self.runbook_lower)

    def test_post_call_resolution_does_not_use_shared_agent_as_tenancy_key(self) -> None:
        ordered_markers = (
            "validated `deployment_id` from call metadata",
            "existing durable call-to-deployment binding",
            "unique validated `to_number` assignment effective for the call",
            "`agent_id` only if it maps to exactly one deployment",
        )
        positions = [self.current_lower.index(marker) for marker in ordered_markers]
        self.assertEqual(positions, sorted(positions))
        self.assertIn(
            "the shared free-test `agent_id` maps to multiple deployments and therefore is not sufficient ownership evidence",
            self.current_lower,
        )

    def test_configuration_failure_terminates_before_intake(self) -> None:
        self.assertIn("neutral **configuration unavailable** termination", self.current_lower)
        self.assertIn("collects no caller details", self.current_lower)
        self.assertIn("continues with a degraded generic intake", self.current_lower)
        self.assertIn("configuration unavailable is a direct neutral termination", self.runbook_lower)
        self.assertIn("call_lookup_key = hmac", self.current_lower)
        self.assertIn("the raw provider identifier is not stored", self.current_lower)
        self.assertIn("reporting remains partitioned by `client_id`, `deployment_id`", self.current_lower)

    def test_two_client_acceptance_is_required_and_clone_fallback_is_rejected(self) -> None:
        self.assertIn(
            "two synthetic clients, two distinct synthetic numbers, and the same shared agent",
            self.current_lower,
        )
        self.assertIn("number reassignment cannot resolve stale ownership", self.current_lower)
        self.assertIn("the two-client suite must additionally prove", self.runbook_lower)
        self.assertIn("do not switch to a client clone or degraded intake", self.runbook_lower)

    def test_scope_remains_narrow_and_live_authority_is_not_claimed(self) -> None:
        self.assertIn("not a generalized multi-tenant voice platform", self.current_lower)
        self.assertIn("production authorization: not granted", self.current_lower)
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
