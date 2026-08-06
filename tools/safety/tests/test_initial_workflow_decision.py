from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
DECISION = ROOT / "docs" / "adr" / "0003-initial-after-hours-service-request-workflow.md"
PRODUCT_DIRECTION = ROOT / "docs" / "product" / "README.md"
LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")


class InitialWorkflowDecisionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = DECISION.read_text(encoding="utf-8")
        cls.product_text = PRODUCT_DIRECTION.read_text(encoding="utf-8")

    def test_decision_has_one_h1_and_resolving_local_links(self) -> None:
        self.assertEqual(1, sum(line.startswith("# ") for line in self.text.splitlines()))
        for raw_target in LINK_RE.findall(self.text):
            target = raw_target.split("#", 1)[0]
            if not target or target.startswith(("https://", "http://", "mailto:")):
                continue
            resolved = (DECISION.parent / target).resolve()
            self.assertTrue(resolved.is_relative_to(ROOT.resolve()), raw_target)
            self.assertTrue(resolved.exists(), raw_target)

    def test_contract_is_bounded_and_provider_neutral(self) -> None:
        for marker in (
            "after-hours-new-residential-service-request-v1",
            "Accepted for offline validation",
            "provider-neutral contract",
            "structured rules",
            "state machine",
            "synthetic scenarios",
            "deterministic evaluator",
            "No voice-provider prompt is the authoritative contract",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.text)

    def test_every_initial_disposition_is_explicit(self) -> None:
        for disposition in (
            "eligible_callback_queue",
            "urgent_human_route_requested",
            "ineligible",
            "unresolved_fallback",
        ):
            with self.subTest(disposition=disposition):
                self.assertIn(f"`{disposition}`", self.text)

    def test_callback_handoff_and_duplicate_inputs_are_explicit(self) -> None:
        for marker in (
            "callback-contact status",
            "opaque synthetic contact reference",
            "stable synthetic request key",
            "must not create a second queue item",
            "identity-conflict reason",
            "A missing or invalid callback contact cannot reach `eligible_callback_queue`",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.text)
        for prohibited_fixture in (
            "real name",
            "address",
            "phone number",
            "customer identifier",
            "production contact reference",
        ):
            self.assertIn(prohibited_fixture, self.text)

    def test_synthetic_operator_profile_makes_scenarios_deterministic(self) -> None:
        for marker in (
            "fictional synthetic operator profile and environment",
            "coverage mode as `after_hours` or `overflow`",
            "synthetic service-area eligibility bands",
            "allowed and excluded property types and service categories",
            "urgency and escalation table",
            "human-route state as `available` or `unavailable`",
            "queue result as `accepted`, `rejected`, or `ambiguous`",
            "missing profile field ends in `unresolved_fallback`",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.text)
        self.assertIn(
            "Fixtures must not contain or infer a real customer's rules, schedule, "
            "service area, destination, contact details, or queue state.",
            self.text,
        )

    def test_known_exclusions_and_unknown_conditions_map_to_named_dispositions(self) -> None:
        self.assertIn(
            "A known excluded condition ends in `ineligible` with an explicit "
            "limitation reason code and static limitation output.",
            self.text,
        )
        self.assertIn(
            "A condition that cannot be classified from the complete synthetic "
            "contract ends in `unresolved_fallback`.",
            self.text,
        )

    def test_repo_decision_does_not_authorize_live_behavior(self) -> None:
        self.assertIn(
            "It does not authorize a live call, prospect-facing telephone demo, "
            "customer pilot, recording, transcript, transfer, callback, message, "
            "booking, dispatch, or production-system write.",
            self.text,
        )
        for prohibited in (
            "live call",
            "prospect-facing telephone demo",
            "customer pilot",
            "recording",
            "transfer",
            "callback",
            "message",
            "booking",
            "dispatch",
            "production-system write",
        ):
            with self.subTest(prohibited=prohibited):
                self.assertIn(prohibited, self.text)
        self.assertIn("offline, synthetic product validation only", self.text)
        self.assertIn(
            "accepted for offline synthetic validation only",
            self.product_text,
        )
        self.assertNotIn("authorizes a live call", self.text)

    def test_verified_business_systems_do_not_expand_authority(self) -> None:
        self.assertIn("Books has no role in this workflow", self.text)
        self.assertIn("does not make either system necessary or authorize a live write", self.text)
        for control in (
            "duplicate",
            "idempotency",
            "least-privilege",
            "readback",
        ):
            self.assertIn(control, self.text)

    def test_product_direction_records_workflow_as_decided(self) -> None:
        self.assertIn(
            "../adr/0003-initial-after-hours-service-request-workflow.md",
            self.product_text,
        )
        self.assertNotIn(
            "the exact first residential-plumbing workflow template and which plumbing call types",
            self.product_text,
        )

    def test_decision_contains_stop_rules_without_private_commercial_data(self) -> None:
        self.assertIn("## Kill Or Pivot Criteria", self.text)
        self.assertIn("A repository test pass is not demand proof", self.text)
        self.assertIsNone(re.search(r"\$\s*\d", self.text))
        self.assertNotIn("C:\\Users", self.text)


if __name__ == "__main__":
    unittest.main()
