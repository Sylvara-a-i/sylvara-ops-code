from __future__ import annotations

import copy
import importlib.util
import itertools
import json
import unittest
from pathlib import Path


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


def _load_validator():
    spec = importlib.util.spec_from_file_location(
        "retell_workspace_validator_nonurgent", VALIDATOR_PATH
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load the Retell workspace validator")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _resolve(contract: dict[str, object], facts: dict[str, str]) -> str:
    for rule in contract["nonurgent_precedence"]:
        if all(facts[key] in allowed for key, allowed in rule["match"].items()):
            return rule["outcome"]
    raise AssertionError("The fail-closed fallback rule is missing")


class RetellNonurgentClassificationContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.validator = _load_validator()
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


if __name__ == "__main__":
    unittest.main()
