from __future__ import annotations

import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SUPERSEDED = ROOT / "docs" / "adr" / "0005-client-specific-retell-test-agent-isolation.md"
HISTORICAL = ROOT / "docs" / "adr" / "0006-shared-seven-day-monitor-with-client-number-isolation.md"
RUNBOOK = ROOT / "docs" / "runbooks" / "shared-seven-day-monitor-number-routing.md"
RELEASE_CONTRACT = ROOT / "docs" / "product" / "free-revenue-leak-test-release-contract.json"
CAPABILITY_PROFILES = (
    ROOT
    / "src"
    / "zoho-catalyst"
    / "revenue-desk-call-runtime"
    / "functions"
    / "revenue_desk_call_gateway"
    / "contracts"
    / "capability-profiles.json"
)
LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")


class RetellAgentIsolationDecisionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.superseded_text = SUPERSEDED.read_text(encoding="utf-8")
        cls.historical_text = HISTORICAL.read_text(encoding="utf-8")
        cls.runbook_text = RUNBOOK.read_text(encoding="utf-8")
        cls.contract = json.loads(RELEASE_CONTRACT.read_text(encoding="utf-8"))
        cls.profiles = json.loads(CAPABILITY_PROFILES.read_text(encoding="utf-8"))
        cls.historical_lower = cls.historical_text.lower()
        cls.runbook_lower = cls.runbook_text.lower()

    def test_decisions_and_runbook_have_one_h1_and_local_links_resolve(self) -> None:
        for path, text in (
            (SUPERSEDED, self.superseded_text),
            (HISTORICAL, self.historical_text),
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

    def test_historical_agent_decisions_are_explicitly_superseded(self) -> None:
        old_lower = self.superseded_text.lower()
        self.assertIn("status: **superseded**", old_lower)
        self.assertIn("superseded by: [adr 0006]", old_lower)
        self.assertIn("do not implement the client-specific monitor-clone", old_lower)

        self.assertIn("status: superseded by", self.historical_lower)
        self.assertIn("final consolidated release contract", self.historical_lower)
        self.assertIn("not ready for retell agent testing", self.historical_lower)
        self.assertIn("historical number-isolation", self.historical_lower)

    def test_current_topology_uses_one_shared_free_and_paid_runtime(self) -> None:
        runtime = self.contract["shared_call_runtime"]
        self.assertEqual(runtime["engagement_types"], ["free_test", "paid_service"])
        self.assertEqual(runtime["gateway"], "revenue_desk_call_gateway")
        self.assertEqual(runtime["worker"], "revenue_desk_call_worker")
        self.assertEqual(runtime["gateway_routes"], [
            "POST /retell/inbound",
            "POST /retell/events",
            "GET /internal/readiness",
        ])
        self.assertEqual(runtime["gateway_route_count"], 3)
        self.assertIn("same gateway/worker", self.runbook_lower)

    def test_free_profile_is_bounded_and_paid_profiles_fail_closed(self) -> None:
        profiles = {item["id"]: item for item in self.profiles["profiles"]}
        self.assertEqual(self.profiles["engagement_types"], ["free_test", "paid_service"])
        self.assertEqual(self.profiles["unknown_or_disabled_behavior"], "fail_closed")
        self.assertFalse(self.profiles["production_traffic_enabled"])

        free = profiles["call_gap_monitor_v1"]
        self.assertTrue(free["enabled"])
        self.assertEqual(
            free["limit_policy"],
            "seven_calendar_days_or_25_connected_calls_v1",
        )
        for profile_id in ("launch_v1", "growth_v1", "scale_v1"):
            with self.subTest(profile_id=profile_id):
                profile = profiles[profile_id]
                self.assertEqual(profile["engagement_type"], "paid_service")
                self.assertEqual(profile["status"], "draft")
                self.assertFalse(profile["enabled"])
                self.assertEqual(profile["traffic_environments"], [])

    def test_number_and_immutable_configuration_establish_tenant(self) -> None:
        retell = self.contract["retell_integration"]
        self.assertEqual(retell["shared_agent_count"], 1)
        self.assertTrue(retell["dedicated_number_per_active_deployment"])
        self.assertFalse(retell["agent_id_alone_establishes_tenant"])
        self.assertEqual(retell["ownership_priority"], [
            "validated deployment_id",
            "durable call binding",
            "unique validated to_number",
            "unique agent_id mapping only when not shared",
        ])
        gate = retell["required_resolver_gate"]
        self.assertEqual(gate["resolver_status"], "Resolved")
        self.assertEqual(gate["engagement_type"], ["free_test", "paid_service"])

    def test_approval_never_activates_or_starts_the_clock(self) -> None:
        approval = self.contract["shared_call_runtime"]["approval_control"]
        self.assertTrue(approval["approval_and_activation_are_distinct"])
        self.assertTrue(approval["activation_requires_authoritative_route_readback"])
        self.assertEqual(
            approval["seven_day_clock_origin"],
            "activation_receipt_decision_after_route_readback",
        )
        self.assertEqual(approval["capacity_reservation_subsystem"], "absent")

    def test_scope_remains_dark_and_retell_testing_is_not_yet_authorized(self) -> None:
        production = self.contract["production_scope"]
        self.assertEqual(production["mode"], "dark")
        self.assertFalse(production["retell_number_or_webhook_binding"])
        self.assertFalse(production["real_calls_allowed"])
        self.assertFalse(production["traffic_activation_allowed"])
        self.assertIn("not ready for retell agent testing", self.runbook_lower)
        self.assertIn("production authorization: **not granted**", self.runbook_lower)
        self.assertNotIn("ready for controlled internal phone test", self.runbook_lower)

    def test_provider_claims_use_only_official_retell_sources(self) -> None:
        urls = [
            target
            for text in (self.historical_text, self.runbook_text)
            for target in LINK_RE.findall(text)
            if target.startswith("https://")
        ]
        self.assertGreaterEqual(len(urls), 7)
        for url in urls:
            with self.subTest(url=url):
                self.assertTrue(url.startswith("https://docs.retellai.com/"))


if __name__ == "__main__":
    unittest.main()
