from __future__ import annotations

import copy
import importlib.util
import itertools
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
RETELL_ROOT = REPOSITORY_ROOT / "src" / "retell"
VALIDATOR_PATH = RETELL_ROOT / "tools" / "validate_workspace.py"
CONTRACT_PATH = (
    RETELL_ROOT
    / "agents"
    / "7-day-free-test"
    / "contracts"
    / "nonurgent-classification-contract.json"
)
SHADOW_HARNESS_PATH = RETELL_ROOT / "tools" / "run_shadow_qa.py"
SHADOW_CONTRACT_PATH = CONTRACT_PATH.with_name("shadow-qa-contract.json")
SHADOW_CORPUS_PATH = RETELL_ROOT / "agents" / "7-day-free-test" / "tests" / "fixtures" / "shadow-qa-corpus.json"
COVERAGE_PATH = REPOSITORY_ROOT / "src" / "zoho-catalyst" / "revenue-desk-call-runtime" / "functions" / "revenue_desk_call_gateway" / "contracts" / "revenue-desk-call-contract.json"


def _load_validator():
    spec = importlib.util.spec_from_file_location(
        "retell_workspace_validator_nonurgent", VALIDATOR_PATH
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load the Retell workspace validator")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_shadow_harness():
    sys.path.insert(0, str(SHADOW_HARNESS_PATH.parent))
    try:
        spec = importlib.util.spec_from_file_location("retell_shadow_qa", SHADOW_HARNESS_PATH)
        if spec is None or spec.loader is None: raise RuntimeError("Could not load the Retell shadow-QA harness")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.pop(0)


def _resolve(contract: dict[str, object], facts: dict[str, str]) -> str:
    for rule in contract["nonurgent_precedence"]:
        if all(facts[key] in allowed for key, allowed in rule["match"].items()):
            return rule["outcome"]
    raise AssertionError("The fail-closed fallback rule is missing")


class RetellNonurgentClassificationContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.validator = _load_validator()
        cls.shadow = _load_shadow_harness()
        cls.contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))

    def test_contract_matches_exact_public_schema(self) -> None:
        self.assertEqual(
            [], self.validator.validate_nonurgent_contract_document(self.contract)
        )
        self.assertEqual([], self.validator.find_public_data_problems(self.contract))

    def test_contract_rejects_unknown_or_runtime_fields(self) -> None:
        extra = copy.deepcopy(self.contract)
        extra["runtime_export"] = True
        self.assertTrue(
            self.validator.validate_nonurgent_contract_document(extra)
        )

        changed = copy.deepcopy(self.contract)
        changed["publication_boundary"]["runtime_mapping_in_git"] = True
        self.assertTrue(
            self.validator.validate_nonurgent_contract_document(changed)
        )

    def test_all_symbolic_state_combinations_follow_precedence(self) -> None:
        states = self.contract["state_sets"]
        combinations = itertools.product(
            states["nonurgent_callback"],
            states["area"],
            states["service_property"],
            states["routine"],
        )
        observed = 0
        for callback, area, service_property, routine in combinations:
            facts = {
                "callback": callback,
                "area": area,
                "service_property": service_property,
                "routine": routine,
            }
            if callback != "confirmed_usable":
                expected = "no_callback"
            elif area == "out_of_area":
                expected = "out_of_area"
            elif area != "in_area":
                expected = "needs_review"
            elif service_property == "unsupported":
                expected = "unsupported_service_or_property"
            elif service_property != "supported":
                expected = "needs_review"
            elif routine == "verified_complete":
                expected = "standard"
            else:
                expected = "needs_review"

            with self.subTest(facts=facts):
                self.assertEqual(expected, _resolve(self.contract, facts))
            observed += 1

        self.assertEqual(54, observed)

    def test_area_ineligibility_precedes_service_property(self) -> None:
        for service_property in self.contract["state_sets"]["service_property"]:
            for routine in self.contract["state_sets"]["routine"]:
                with self.subTest(
                    service_property=service_property, routine=routine
                ):
                    self.assertEqual(
                        "out_of_area",
                        _resolve(
                            self.contract,
                            {
                                "callback": "confirmed_usable",
                                "area": "out_of_area",
                                "service_property": service_property,
                                "routine": routine,
                            },
                        ),
                    )

    def test_callback_confirmation_is_bounded_and_fail_closed(self) -> None:
        self.assertEqual(1, self.contract["bounded_confirmation_attempts"])
        self.assertEqual(
            "after-bounded-confirmation",
            self.contract["nonurgent_precedence_phase"],
        )
        self.assertEqual(
            {"outcome": "one_confirmation", "needs_review": False},
            self.contract["nonurgent_callback_policy"]["initial"]["unknown"],
        )
        self.assertEqual(
            {"outcome": "no_callback", "needs_review": True},
            self.contract["nonurgent_callback_policy"]["final"]["unknown"],
        )

    def test_urgent_and_safety_boundaries_remain_separate(self) -> None:
        self.assertEqual(
            {"outcome": "one_confirmation", "needs_review": False},
            self.contract["urgent_callback_policy"]["initial"]["unknown"],
        )
        self.assertEqual(
            {"outcome": "urgent_no_callback", "needs_review": True},
            self.contract["urgent_callback_policy"]["final"]["unknown"],
        )
        self.assertIs(
            self.contract["preserved_boundaries"]["safety_precedes_classification"],
            True,
        )
        self.assertEqual(
            "preserved",
            self.contract["preserved_boundaries"]["exception_behavior"],
        )

    def test_contract_does_not_authorize_runtime_or_capabilities(self) -> None:
        self.assertIs(self.contract["runtime_authority"], False)
        self.assertIs(self.contract["deployment_authorized"], False)
        self.assertTrue(
            all(
                value is False
                for value in self.contract["capability_boundary"].values()
            )
        )
        self.assertTrue(
            all(
                value is False
                for value in self.contract["publication_boundary"].values()
            )
        )

    def test_public_contract_does_not_reference_the_other_managed_agent(self) -> None:
        serialized = json.dumps(self.contract, sort_keys=True)
        self.assertNotIn("Revenue Desk — Master Template", serialized)

    def test_shadow_qa_public_layers_pass_without_private_runtime_data(self) -> None:
        shadow_contract = json.loads(SHADOW_CONTRACT_PATH.read_text(encoding="utf-8"))
        coverage = json.loads(COVERAGE_PATH.read_text(encoding="utf-8"))
        corpus = json.loads(SHADOW_CORPUS_PATH.read_text(encoding="utf-8"))
        self.assertEqual(set(), self.shadow.contract_failures(shadow_contract, coverage, self.contract))
        gate = self.shadow.gate_cases(shadow_contract, coverage)
        self.assertEqual(69, len(gate))
        self.assertTrue(all(row["pass"] for row in gate))
        self.assertTrue(all(row["primary_outcome"] == "configuration_not_ready" and row["review_required"] and not row["identifiers_spoken"] for row in gate if not row["expected_valid"]))
        business = self.shadow.business_state_report(shadow_contract, coverage)
        self.assertEqual((3172, 3172, 0), (business["cases"], business["passed"], business["failed"]))
        self.assertEqual((112, 112, 0), (business["request_intent"]["cases"], business["request_intent"]["passed"], business["request_intent"]["failed"]))
        self.assertEqual(36, len(business["configuration_dispositions"]))
        self.assertTrue(all(row["pass"] for row in business["configuration_dispositions"]))
        self.assertEqual(104, self.shadow.metamorphic_report(shadow_contract, coverage)["passed"])
        corpus_result = self.shadow.validate_corpus(corpus, shadow_contract)
        self.assertEqual((220, 36, 256), (corpus_result["fixtures"], corpus_result["configuration_cases"], corpus_result["passed"]))
        mutation = self.shadow.mutation_report(shadow_contract, coverage, self.contract, corpus)
        self.assertEqual("15/15", mutation["variant_score"])
        self.assertEqual("12/12", mutation["family_score"])
        self.assertEqual(15, mutation["detected_variants"])
        self.assertEqual(self.shadow.EXPECTED_TELEMETRY, shadow_contract["telemetry_boundary"])
        self.assertEqual([], self.shadow.differential(shadow_contract, shadow_contract)["tests_affected"])

    def test_shadow_request_intent_matches_canonical_fixtures(self) -> None:
        canonical = json.loads(self.shadow.REQUEST_INTENT.read_text(encoding="utf-8"))
        self.assertEqual(["new_service_request", "existing_job_follow_up", "unknown"], canonical["values"])
        self.assertEqual("unknown", canonical["missing_historical_value"])
        for fixture in canonical["fixtures"]:
            with self.subTest(fixture=fixture):
                before = copy.deepcopy(fixture)
                actual = self.shadow.request_intent_result(fixture)
                self.assertEqual(fixture["outcome"], actual["outcome"])
                self.assertEqual(fixture.get("expected"), actual["error"])
                if "expected_bookable" in fixture:
                    self.assertIs(fixture["expected_bookable"], actual["bookable_opportunity"])
                if "expected_request_kind" in fixture:
                    self.assertEqual(fixture["expected_request_kind"], actual["request_kind"])
                self.assertEqual(before, fixture)

    def test_relationship_cannot_override_new_urgent_work(self) -> None:
        contract = json.loads(SHADOW_CONTRACT_PATH.read_text(encoding="utf-8"))
        for relationship, callback in itertools.product(
            ("new", "existing", "unknown"),
            ("confirmed_usable", "explicitly_unavailable", "unknown"),
        ):
            expected = "terminal.urgent_callback" if callback == "confirmed_usable" else "terminal.urgent_no_callback"
            facts = {**self.shadow.base_facts(), "customer_type": relationship,
                     "exception": "existing_customer", "request_kind": "new_service_request",
                     "urgency": "approved_urgent", "urgent_callback": callback,
                     "bookable_opportunity": True, "outcome": "urgent_potential_job"}
            with self.subTest(relationship=relationship, callback=callback):
                self.assertEqual(expected, self.shadow.resolve(facts, contract)[0])
                self.assertEqual(expected, self.shadow.expected_terminal(facts))
                self.assertIs(True, self.shadow.request_intent_result(facts)["bookable_opportunity"])

    def test_historical_intent_is_unknown_without_relabeling_or_zero_count(self) -> None:
        # Valid outcome/urgency combinations; complete payload validation belongs
        # to the gateway tests, not this request-intent-only projection.
        historical_cases = (
            ("potential_job", "nonurgent", True, None),
            ("urgent_potential_job", "approved_urgent", True, None),
            ("existing_customer", "nonurgent", False, False),
        )
        for relationship, (original_outcome, urgency, supplied, expected_bookable) in itertools.product(
            ("new", "existing", "unknown"), historical_cases,
        ):
            facts = {**self.shadow.base_facts(), "customer_type": relationship,
                     "exception": "existing_customer", "outcome": original_outcome,
                     "bookable_opportunity": supplied, "urgency": urgency,
                     "urgent_callback": "confirmed_usable"}
            del facts["request_kind"]
            before = copy.deepcopy(facts)
            with self.subTest(relationship=relationship, outcome=original_outcome):
                actual = self.shadow.request_intent_result(facts)
                self.assertEqual({"request_kind": "unknown", "bookable_opportunity": expected_bookable,
                                  "outcome": original_outcome, "error": None}, actual)
                self.assertEqual(before, facts)

    def test_follow_up_opportunity_contradiction_is_held_after_protective_exits(self) -> None:
        contract = json.loads(SHADOW_CONTRACT_PATH.read_text(encoding="utf-8"))
        for relationship in ("new", "existing", "unknown"):
            facts = {**self.shadow.base_facts(), "customer_type": relationship,
                     "request_kind": "existing_job_follow_up", "bookable_opportunity": True,
                     "urgency": "approved_urgent", "urgent_callback": "confirmed_usable"}
            self.assertEqual("INVALID_ANALYSIS", self.shadow.request_intent_result(facts)["error"])
            self.assertIsNone(self.shadow.request_intent_result(facts)["bookable_opportunity"])
            for override, terminal in (
                ({}, "terminal.needs_review"),
                ({"configuration_status": "invalid"}, "terminal.configuration_unavailable"),
                ({"safety": "immediate_hazard"}, "terminal.safety"),
                ({"consent": "withdrawn"}, "terminal.consent_withdrawal"),
                ({"consent": "sensitive_termination_required"}, "terminal.sensitive_data"),
            ):
                with self.subTest(relationship=relationship, override=override):
                    self.assertEqual(terminal, self.shadow.resolve({**facts, **override}, contract)[0])
                    self.assertEqual(terminal, self.shadow.expected_terminal({**facts, **override}))

    def test_malformed_intent_or_opportunity_evidence_fails_closed(self) -> None:
        contract = json.loads(SHADOW_CONTRACT_PATH.read_text(encoding="utf-8"))
        for field, values in (
            ("request_kind", (None, "", "new", " new_service_request", True, 1, [], {})),
            ("bookable_opportunity", ("true", "false", 0, 1, [], {})),
        ):
            for value in values:
                facts = {**self.shadow.base_facts(), field: value}
                with self.subTest(field=field, value=value):
                    self.assertEqual("INVALID_ANALYSIS", self.shadow.request_intent_result(facts)["error"])
                    self.assertIsNone(self.shadow.request_intent_result(facts)["bookable_opportunity"])
                    self.assertEqual("terminal.needs_review", self.shadow.resolve(facts, contract)[0])
                    self.assertEqual("terminal.needs_review", self.shadow.expected_terminal(facts))

    def test_relationship_shortcut_regression_is_detected_by_intent_matrix(self) -> None:
        contract = json.loads(SHADOW_CONTRACT_PATH.read_text(encoding="utf-8"))
        original = self.shadow.resolve
        def relationship_shortcut(facts, candidate):
            terminal, observed = original(facts, candidate)
            if facts.get("exception") == "existing_customer":
                terminal = "terminal.existing_customer_message"
            return terminal, observed
        with patch.object(self.shadow, "resolve", side_effect=relationship_shortcut):
            self.assertGreater(self.shadow.request_intent_report(contract)["failed"], 0)

    def test_shadow_oracle_fails_closed_and_is_independent(self) -> None:
        shadow_contract = json.loads(SHADOW_CONTRACT_PATH.read_text(encoding="utf-8"))
        for facts in (
            {**self.shadow.base_facts(), "safety": "unknown"},
            {**self.shadow.base_facts(), "consent": "unknown"},
        ):
            self.assertEqual("terminal.needs_review", self.shadow.resolve(facts, shadow_contract)[0])
            self.assertEqual("terminal.needs_review", self.shadow.expected_terminal(facts))

        mutant = copy.deepcopy(shadow_contract)
        self.shadow.mutate_route(
            mutant, "area", "out_of_area", "terminal.unsupported_service_or_property", "area_out"
        )
        coverage = json.loads(COVERAGE_PATH.read_text(encoding="utf-8"))
        self.assertGreater(self.shadow.business_state_report(mutant, coverage)["failed"], 0)
        self.assertEqual(set(), self.shadow.abstract_graph_failures(mutant))

    def test_shadow_graph_and_differential_reject_unsafe_shapes(self) -> None:
        baseline = json.loads(SHADOW_CONTRACT_PATH.read_text(encoding="utf-8"))
        graph_only = copy.deepcopy(baseline)
        next(edge for edge in graph_only["abstract_graph"]["edges"] if edge["key"] == "area_out")["to_state"] = "terminal.unsupported_service_or_property"
        self.assertIn("graph.rules_match", self.shadow.abstract_graph_failures(graph_only))

        changed = copy.deepcopy(baseline)
        changed["state_sets"]["area"] = list(reversed(changed["state_sets"]["area"]))
        report = self.shadow.differential(baseline, changed)
        self.assertTrue(report["changed_enum_contracts"]["area"]["order_changed"])
        self.assertEqual(self.shadow.FULL_TESTS - {"static_post_call", "static_capabilities"}, set(report["tests_affected"]))

        unauthorized = copy.deepcopy(baseline)
        unauthorized["runtime_authority"] = True
        with self.assertRaises(ValueError):
            self.shadow.differential(baseline, unauthorized)
        malformed = copy.deepcopy(baseline)
        malformed["gate_contract"] = None
        self.assertFalse(self.shadow.contract_schema_valid(malformed))
        with self.assertRaises(ValueError):
            self.shadow.differential(baseline, malformed)
        with self.assertRaises(ValueError):
            self.shadow.unique_object([("authority", False), ("authority", True)])
        for field, value in (
            ("gate_contract", {**baseline["gate_contract"], "required_nonblank_references": []}),
            ("variable_references", {**baseline["variable_references"], "area": []}),
            ("post_call_definitions", []),
        ):
            unsafe = copy.deepcopy(baseline)
            unsafe[field] = value
            self.assertTrue(self.shadow.contract_failures(unsafe, json.loads(COVERAGE_PATH.read_text(encoding="utf-8")), self.contract))
        typed = copy.deepcopy(baseline)
        typed["abstract_graph"]["nodes"][0]["key"] = 7
        self.assertFalse(self.shadow.contract_schema_valid(typed))
        with self.assertRaises(ValueError):
            self.shadow.require_within(REPOSITORY_ROOT / "tracked-output.json", self.shadow.OUTPUT_ROOT, "test output")


if __name__ == "__main__":
    unittest.main()
