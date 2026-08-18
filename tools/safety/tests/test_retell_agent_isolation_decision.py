from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
DECISION = ROOT / "docs" / "adr" / "0005-client-specific-retell-test-agent-isolation.md"
LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")


class RetellAgentIsolationDecisionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = DECISION.read_text(encoding="utf-8")
        cls.lower = cls.text.lower()

    def test_decision_has_one_h1_and_local_links_resolve(self) -> None:
        h1s = [line for line in self.text.splitlines() if line.startswith("# ")]
        self.assertEqual(1, len(h1s))

        for target in LINK_RE.findall(self.text):
            target = target.strip("<>").split("#", 1)[0]
            if not target or target.startswith(("http://", "https://", "mailto:", "#")):
                continue
            with self.subTest(target=target):
                self.assertTrue((DECISION.parent / target).resolve().is_file())

    def test_master_and_client_agent_are_unambiguous(self) -> None:
        required = (
            "one private, reusable, versioned free-test master",
            "must not receive live client calls",
            "for every company whose real calls enter a seven-day test, create one client-specific retell agent",
            "an active retell `agent_id` must resolve to exactly one active client deployment",
            "no active client deployment shares an agent identifier with another client",
        )
        for marker in required:
            with self.subTest(marker=marker):
                self.assertIn(marker, self.lower)

    def test_paid_conversion_does_not_require_duplicate_agents(self) -> None:
        self.assertIn(
            "do not create both a free-test agent and a paid agent for every client by default",
            self.lower,
        )
        self.assertIn(
            "prefer to keep the same client-specific retell agent and promote it through a new immutable version",
            self.lower,
        )
        self.assertIn(
            "create a separate paid-service agent only when a real environment, contractual, rollback, provider, data, or capability-isolation requirement justifies it",
            self.lower,
        )

    def test_environment_tags_are_not_customer_tenancy(self) -> None:
        self.assertIn("use environment tags for environments and release lanes", self.lower)
        self.assertIn("do not use tags such as `client-a`, `client-b`", self.lower)
        self.assertIn("they are not an access-control boundary", self.lower)

    def test_shared_live_agent_is_explicitly_rejected_until_resolver_gates_pass(self) -> None:
        self.assertIn("shared live multi-client agent is rejected", self.lower)
        self.assertIn("per-number inbound-call webhook", self.lower)
        self.assertIn("explicit `deployment_id`, `client_id`", self.lower)
        self.assertIn("fail-closed behavior with no cross-client fallback", self.lower)
        self.assertIn("measured evidence that client-specific cloning creates more operating cost", self.lower)

    def test_evidence_uncertainty_and_live_authority_are_preserved(self) -> None:
        self.assertIn(
            "exact deployed catalyst resolver order and the exact `route_ambiguous` implementation were not independently read",
            self.lower,
        )
        self.assertIn("remain **unknown**", self.lower)
        self.assertIn("this decision does not authorize a live seven-day test", self.lower)
        self.assertNotIn("is deployed and working", self.lower)

    def test_only_official_retell_sources_are_used_for_provider_claims(self) -> None:
        urls = [target for target in LINK_RE.findall(self.text) if target.startswith("https://")]
        self.assertGreaterEqual(len(urls), 5)
        for url in urls:
            with self.subTest(url=url):
                self.assertTrue(url.startswith("https://docs.retellai.com/"))


if __name__ == "__main__":
    unittest.main()
