from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
RETELL_ROOT = REPOSITORY_ROOT / "src" / "retell"
FREE_TEST_ROOT = RETELL_ROOT / "agents" / "7-day-free-test"
CONVERSATION_PATH = FREE_TEST_ROOT / "contracts" / "conversation-contract.json"
SHADOW_PATH = FREE_TEST_ROOT / "contracts" / "shadow-qa-contract.json"
ACCEPTANCE_PATH = FREE_TEST_ROOT / "tests" / "fixtures" / "acceptance-cases.json"
CORPUS_PATH = FREE_TEST_ROOT / "tests" / "fixtures" / "shadow-qa-corpus.json"
COVERAGE_PATH = (
    REPOSITORY_ROOT
    / "src"
    / "zoho-catalyst"
    / "retell-inbound-resolver"
    / "contracts"
    / "coverage-mode-contract.json"
)
VALIDATOR_PATH = RETELL_ROOT / "tools" / "validate_workspace.py"

EXPECTED_CASE_IDS = [f"ft_{index:03d}" for index in range(1, 31)]
EXPECTED_CASE_TITLES = [
    "normal potential job",
    "existing customer",
    "urgent callback situation",
    "safety immediate danger",
    "unsupported service",
    "out of area caller",
    "spam or solicitation",
    "sensitive data attempt",
    "ambiguous intent",
    "caller changes answer",
    "caller interrupts agent",
    "noisy or incomplete answer",
    "invalid callback then correction",
    "caller refuses callback number",
    "specific person requested",
    "service request and location in first utterance",
    "configuration unavailable",
    "missing client id",
    "missing deployment id",
    "invalid coverage mode",
    "wrong engagement type",
    "wrong capability profile",
    "expired test",
    "twenty five call limit reached",
    "unknown Retell number",
    "duplicated post call webhook",
    "delayed webhook",
    "malformed webhook",
    "processing retry",
    "notification provider failure",
]
EXPECTED_CASE_KEYS = {
    "case_id",
    "title",
    "failure_priority",
    "execution_layer",
    "inputs",
    "expected_routing",
    "expected_extracted_fields",
    "expected_terminal_state",
    "expected_persistence",
    "expected_notification_behavior",
    "expected_analytics_behavior",
    "pass_fail_criteria",
}
EXPECTED_OUTCOMES = [
    "potential_job",
    "existing_customer",
    "urgent_potential_job",
    "spam",
    "unsupported_service",
    "out_of_area",
    "other_general_inquiry",
    "sensitive_data_ended",
    "configuration_failure",
    "caller_abandoned",
    "unresolved",
]
P0_CASES = {
    "ft_004",
    "ft_008",
    "ft_017",
    "ft_018",
    "ft_019",
    "ft_020",
    "ft_021",
    "ft_022",
    "ft_023",
    "ft_024",
    "ft_025",
}


def _load_validator():
    spec = importlib.util.spec_from_file_location(
        "retell_workspace_validator_acceptance", VALIDATOR_PATH
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load the Retell workspace validator")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RetellFreeTestAcceptanceContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.validator = _load_validator()
        cls.conversation = json.loads(CONVERSATION_PATH.read_text(encoding="utf-8"))
        cls.shadow = json.loads(SHADOW_PATH.read_text(encoding="utf-8"))
        cls.acceptance = json.loads(ACCEPTANCE_PATH.read_text(encoding="utf-8"))
        cls.corpus = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))
        cls.coverage = json.loads(COVERAGE_PATH.read_text(encoding="utf-8"))
        cls.cases = {row["case_id"]: row for row in cls.acceptance["cases"]}

    def test_public_contracts_contain_no_private_or_runtime_values(self) -> None:
        for path, document in (
            (CONVERSATION_PATH, self.conversation),
            (ACCEPTANCE_PATH, self.acceptance),
        ):
            with self.subTest(path=path):
                self.assertEqual(
                    [],
                    self.validator.find_public_data_problems(document, f"$/{path.name}"),
                )
                self.assertIs(document["runtime_authority"], False)
                self.assertIs(document["deployment_authorized"], False)

    def test_exact_seven_field_gate_is_shared_by_contracts(self) -> None:
        expected_nonblank = ["client_id", "deployment_id", "configuration_version"]
        expected_exact = {
            "resolver_status": "Resolved",
            "engagement_type": "free_test",
            "capability_profile": "call_gap_monitor_v1",
        }
        expected_modes = [
            "AfterHoursOnly",
            "NoAnswerOverflowOnly",
            "AfterHoursAndOverflow",
        ]
        self.assertEqual(expected_nonblank, self.shadow["gate_contract"]["required_nonblank_references"])
        self.assertEqual(expected_nonblank, self.conversation["configuration_gate"]["required_nonblank_strings"])
        self.assertEqual(expected_exact, self.shadow["gate_contract"]["required_exact_values"])
        self.assertEqual(expected_exact, self.conversation["configuration_gate"]["required_exact_values"])
        self.assertEqual(expected_modes, self.coverage["canonical_coverage_modes"])
        self.assertEqual(expected_modes, self.conversation["configuration_gate"]["canonical_coverage_modes"])

    def test_gate_failure_is_direct_neutral_and_collects_nothing(self) -> None:
        shadow_gate = self.shadow["gate_contract"]
        conversation_failure = self.conversation["configuration_gate"]["failure_behavior"]
        self.assertEqual("terminal.configuration_unavailable", shadow_gate["failure_terminal"])
        self.assertIs(shadow_gate["failure_reaches_disclosure"], False)
        self.assertIs(shadow_gate["failure_reaches_caller_data_collection"], False)
        self.assertIs(shadow_gate["failure_uses_client_configuration"], False)
        self.assertEqual("configuration_unavailable", conversation_failure["terminal_state"])
        self.assertIs(conversation_failure["normal_intake_allowed"], False)
        self.assertIs(conversation_failure["caller_data_collection_allowed"], False)
        self.assertIs(conversation_failure["fallback_to_another_client_allowed"], False)
        configuration_else = next(
            edge
            for edge in self.shadow["abstract_graph"]["edges"]
            if edge["key"] == "configuration_else"
        )
        self.assertEqual("terminal.configuration_unavailable", configuration_else["to_state"])

    def test_coverage_display_mapping_has_no_obsolete_alias(self) -> None:
        labels = [row["display_label"] for row in self.coverage["display_label_mappings"]]
        self.assertEqual(
            [
                "After Hours Only",
                "No Answer / Overflow Only",
                "After Hours + Overflow",
            ],
            labels,
        )
        self.assertNotIn("No Answer/Overflow Only", labels)

    def test_conversation_contract_has_exact_minimum_intake_and_outcomes(self) -> None:
        intake_keys = [row["key"] for row in self.conversation["minimum_intake"]]
        self.assertEqual(
            [
                "caller_name",
                "callback_number",
                "customer_relationship",
                "caller_intent",
                "issue_summary",
                "service_area_signal",
                "urgency_classification",
                "specific_person_requested",
                "call_outcome",
            ],
            intake_keys,
        )
        outcomes = [row["canonical_value"] for row in self.conversation["outcome_taxonomy"]]
        self.assertEqual(EXPECTED_OUTCOMES, outcomes)
        self.assertEqual(len(outcomes), len(set(outcomes)))
        self.assertIs(
            self.conversation["outcome_rules"]["exactly_one_high_level_outcome_required"],
            True,
        )

    def test_sensitive_data_and_retell_capability_boundaries_are_exact(self) -> None:
        sensitive = self.conversation["sensitive_data_boundary"]
        self.assertIs(sensitive["intentionally_collected"], False)
        self.assertIs(sensitive["payment_collection_allowed"], False)
        self.assertGreaterEqual(len(sensitive["prohibited_categories"]), 8)
        capabilities = self.conversation["capability_restrictions"]
        self.assertEqual(
            {
                "appointment_booking",
                "live_dispatch",
                "technician_assignment",
                "pricing_or_estimates",
                "payment_collection",
                "direct_crm_mutation",
                "direct_catalyst_mutation",
                "direct_analytics_mutation",
                "direct_field_service_mutation",
                "custom_client_integrations",
                "autonomous_outbound_calls",
                "direct_sms",
                "direct_email",
                "direct_client_notification",
                "arbitrary_transfers",
                "unbounded_function_calls",
            },
            set(capabilities),
        )
        self.assertTrue(all(value is False for value in capabilities.values()))
        self.assertTrue(all(value is False for value in self.shadow["capability_boundary"].values()))

    def test_normal_close_and_naturalness_require_retell_native_validation(self) -> None:
        close = self.conversation["normal_close_contract"]
        self.assertEqual(
            [
                "summarize_material_information",
                "confirm_uncertain_material_facts",
                "state_that_details_were_recorded_for_company_review",
                "state_that_no_appointment_or_dispatch_is_confirmed",
                "ask_whether_anything_else_should_be_shared",
                "polite_goodbye",
            ],
            close["ordered_elements"],
        )
        self.assertIs(close["notification_delivery_claim_allowed"], False)
        self.assertIs(close["unexplained_hangup_allowed"], False)
        naturalness = self.conversation["naturalness_acceptance"]
        self.assertEqual(
            "retell_native_text_simulation_passed_voice_audio_pending",
            naturalness["validation_status"],
        )
        self.assertEqual(4, len(naturalness["settings"]))
        for setting in naturalness["settings"][:3]:
            self.assertGreaterEqual(setting["minimum"], 0)
            self.assertLessEqual(setting["maximum"], 1)
            self.assertLess(setting["minimum"], setting["maximum"])
        expressive = naturalness["settings"][3]
        self.assertEqual("expressive_mode", expressive["key"])
        self.assertIs(expressive["configured_development_value"], False)
        self.assertIs(naturalness["provider_mapping_must_be_read_back"], True)
        self.assertIs(naturalness["synthetic_voice_test_required"], True)

    def test_acceptance_suite_has_exact_thirty_cases_and_schema(self) -> None:
        cases = self.acceptance["cases"]
        self.assertEqual(30, self.acceptance["case_count"])
        self.assertEqual(EXPECTED_CASE_IDS, self.acceptance["required_case_ids"])
        self.assertEqual(EXPECTED_CASE_IDS, [row["case_id"] for row in cases])
        self.assertEqual(EXPECTED_CASE_TITLES, [row["title"] for row in cases])
        self.assertEqual(30, len(self.cases))
        self.assertEqual(EXPECTED_CASE_KEYS, set(self.acceptance["case_schema"]))
        for row in cases:
            with self.subTest(case_id=row["case_id"]):
                self.assertEqual(EXPECTED_CASE_KEYS, set(row))
                self.assertIsInstance(row["inputs"], dict)
                self.assertIsInstance(row["expected_routing"], dict)
                self.assertIsInstance(row["expected_extracted_fields"], dict)
                self.assertIsInstance(row["expected_persistence"], dict)
                self.assertIsInstance(row["expected_notification_behavior"], dict)
                self.assertIsInstance(row["expected_analytics_behavior"], dict)
                self.assertTrue(row["expected_terminal_state"])
                self.assertGreaterEqual(len(row["pass_fail_criteria"]), 3)
                self.assertEqual(len(row["pass_fail_criteria"]), len(set(row["pass_fail_criteria"])))

    def test_acceptance_priorities_and_backend_ownership_are_explicit(self) -> None:
        self.assertEqual(P0_CASES, {key for key, row in self.cases.items() if row["failure_priority"] == "P0"})
        self.assertTrue(all(row["failure_priority"] in {"P0", "P1"} for row in self.cases.values()))
        for index in range(23, 31):
            row = self.cases[f"ft_{index:03d}"]
            with self.subTest(case_id=row["case_id"]):
                self.assertIn("catalyst", row["execution_layer"])
                self.assertIn("catalyst_path", row["expected_routing"])
                self.assertNotEqual("", row["expected_routing"]["catalyst_path"])
        for index in range(1, 23):
            self.assertIn("retell", self.cases[f"ft_{index:03d}"]["execution_layer"])

    def test_failure_replay_retry_and_notification_contracts_are_idempotent(self) -> None:
        for index in range(17, 23):
            row = self.cases[f"ft_{index:03d}"]
            with self.subTest(case_id=row["case_id"]):
                self.assertEqual({}, row["expected_extracted_fields"])
                self.assertEqual("configuration_unavailable", row["expected_terminal_state"])
                self.assertEqual("none", row["expected_notification_behavior"]["action"])
        for index in range(23, 26):
            row = self.cases[f"ft_{index:03d}"]
            with self.subTest(case_id=row["case_id"]):
                self.assertEqual({}, row["expected_extracted_fields"])
                self.assertEqual("inbound_rejected", row["expected_terminal_state"])
                expected_action = "none_for_pre_call_rejection" if index == 24 else "none"
                self.assertEqual(expected_action, row["expected_notification_behavior"]["action"])
        replay = self.cases["ft_026"]
        self.assertEqual("create_once", replay["expected_persistence"]["canonical_call"])
        self.assertEqual("enqueue_once_total", replay["expected_notification_behavior"]["action"])
        retry = self.cases["ft_029"]
        self.assertEqual("create_once", retry["expected_persistence"]["canonical_call"])
        notification_failure = self.cases["ft_030"]
        self.assertEqual("terminal_failed", notification_failure["expected_persistence"]["notification_state"])
        self.assertIs(notification_failure["expected_notification_behavior"]["duplicate_delivery"], False)

    def test_shadow_corpus_adversarial_identifiers_use_exact_gate_names(self) -> None:
        self.assertEqual(
            ["client_id", "deployment_id", "configuration_version"],
            self.corpus["configuration_adversarial_matrix"]["identifiers"],
        )
        self.assertEqual(220, len(self.corpus["fixtures"]))


if __name__ == "__main__":
    unittest.main()
