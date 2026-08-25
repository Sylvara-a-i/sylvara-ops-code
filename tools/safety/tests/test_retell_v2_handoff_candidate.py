from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
V2_ROOT = (
    REPOSITORY_ROOT
    / "src"
    / "retell"
    / "agents"
    / "7-day-free-test"
    / "v2"
)
TOOLS_ROOT = V2_ROOT / "tools"
VALIDATOR_PATH = TOOLS_ROOT / "validate_candidate.py"
V1_CONVERSATION_PATH = (
    REPOSITORY_ROOT
    / "src"
    / "retell"
    / "agents"
    / "7-day-free-test"
    / "contracts"
    / "conversation-contract.json"
)


def _load_validator():
    sys.path.insert(0, str(TOOLS_ROOT))
    try:
        spec = importlib.util.spec_from_file_location(
            "retell_v2_handoff_candidate_validator", VALIDATOR_PATH
        )
        if spec is None or spec.loader is None:
            raise RuntimeError("Could not load the Retell v2 candidate validator")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.pop(0)


class RetellV2HandoffCandidateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.validator = _load_validator()
        cls.suite_network_context = cls.validator.network_blocked()
        cls.suite_network_guard = cls.suite_network_context.__enter__()
        cls.oracle = cls.validator.oracle
        cls.contract = cls.validator.load_json_unique(
            V2_ROOT / "contracts" / "candidate-contract.json"
        )
        cls.adapter = cls.validator.load_json_unique(
            V2_ROOT / "contracts" / "transfer-adapter-contract.json"
        )
        cls.scenario_document = cls.validator.load_json_unique(
            V2_ROOT / "tests" / "fixtures" / "scenario-matrix.json"
        )
        cls.scenarios = cls.scenario_document["cases"]

    @classmethod
    def tearDownClass(cls) -> None:
        attempt_count = cls.suite_network_guard.attempt_count
        cls.suite_network_context.__exit__(None, None, None)
        if attempt_count:
            raise AssertionError(
                f"Retell v2 safety suite attempted network access {attempt_count} time(s)"
            )

    def test_candidate_passes_zero_network_offline_validation(self) -> None:
        with self.validator.network_blocked() as guard:
            problems = self.validator.validate_candidate()
        self.assertEqual([], problems)
        self.assertEqual(0, guard.attempt_count)
        boundary = self.contract["local_test_boundary"]
        self.assertEqual(
            self.validator.EXPECTED_PYTHON_NETWORK_SURFACES,
            boundary["guarded_python_surfaces"],
        )
        self.assertEqual(
            self.validator.EXPECTED_NODE_NETWORK_SURFACES,
            boundary["guarded_node_surfaces"],
        )

    def test_candidate_is_draft_disabled_unbound_and_not_ready(self) -> None:
        profile = self.contract["capability_profile"]
        self.assertEqual("call_gap_capture_handoff_v2", profile["name"])
        self.assertEqual("draft", profile["status"])
        self.assertIs(profile["enabled"], False)
        self.assertEqual([], profile["traffic_environments"])
        self.assertEqual("none", profile["billing_mode"])
        self.assertEqual("NOT_READY", self.contract["retell_source_status"])
        self.assertIs(self.contract["runtime_authority"], False)
        self.assertIs(self.contract["deployment_authorized"], False)
        self.assertEqual(
            self.validator.EXPECTED_SETTINGS,
            self.contract["settings_constraints"],
        )

    def test_v1_contract_retains_monitor_only_rollback_boundary(self) -> None:
        v1 = json.loads(V1_CONVERSATION_PATH.read_text(encoding="utf-8"))
        self.assertEqual(
            "call_gap_monitor_v1",
            v1["configuration_gate"]["required_exact_values"]["capability_profile"],
        )
        self.assertIs(v1["capability_restrictions"]["arbitrary_transfers"], False)
        self.assertNotIn("call_gap_capture_handoff_v2", json.dumps(v1, sort_keys=True))

    def test_provider_adapter_is_explicitly_blocked_without_fabricated_schema(self) -> None:
        parser = self.adapter["provider_parser"]
        self.assertIs(parser["implemented"], False)
        self.assertIs(parser["importable"], False)
        self.assertEqual({}, parser["field_mapping"])
        self.assertEqual("NOT_READY", self.adapter["retell_source_status"])
        self.assertIn(
            "exact_retell_transfer_lifecycle_schema",
            parser["blocker"],
        )
        handoff = self.contract["handoff_policy"]
        self.assertEqual("Warm Transfer", handoff["transfer_type"])
        self.assertEqual(1, handoff["warm_transfer_node_count"])
        self.assertIs(handoff["e164_target_required_when_enabled"], True)
        self.assertIs(handoff["human_detection_required"], True)
        self.assertIs(handoff["bridge_to_voicemail_or_nonhuman_allowed"], False)
        self.assertIs(handoff["press_digit_required"], False)
        self.assertIs(handoff["caller_id_override_allowed"], False)
        self.assertIs(handoff["provider_target_mapping_deferred"], True)
        self.assertEqual(5, len(handoff["loop_rejection_categories"]))

    def test_analysis_and_notification_allowlists_are_exact(self) -> None:
        self.assertEqual(
            self.validator.EXPECTED_ANALYSIS_FIELDS,
            self.contract["analysis_fields"],
        )
        self.assertEqual(17, len(self.contract["analysis_fields"]))
        constraints = self.contract["analysis_field_constraints"]
        constrained = (
            set(constraints["enum_fields"])
            | set(constraints["boolean_fields"])
            | set(constraints["bounded_string_maximum_characters"])
        )
        self.assertEqual(set(self.contract["analysis_fields"]), constrained)
        self.assertTrue(
            all(
                0 < maximum <= 500
                for maximum in constraints["bounded_string_maximum_characters"].values()
            )
        )
        notification = self.contract["notification_policy"]
        self.assertEqual(
            self.validator.EXPECTED_NOTIFICATION_FIELDS,
            notification["allowed_fields"],
        )
        self.assertEqual(1, notification["durable_rows_per_actionable_call"])
        self.assertEqual(0, notification["provider_calls_in_local_mode"])
        self.assertIs(notification["delivery_claim_allowed"], False)
        self.assertIn("handoff_number", notification["prohibited_content"])
        self.assertIn("recipient_address", notification["prohibited_content"])

    def test_exact_closing_language_and_question_budgets_are_bounded(self) -> None:
        conversation = self.contract["conversation_boundary"]
        self.assertEqual(
            self.validator.EXPECTED_CLOSING_LANGUAGE,
            conversation["closing_language"],
        )
        self.assertEqual((4, 6), (conversation["routine_target_questions"], conversation["routine_hard_cap_questions"]))
        self.assertEqual((3, 4), (conversation["existing_customer_target_questions"], conversation["existing_customer_hard_cap_questions"]))
        self.assertEqual(2, conversation["immediate_danger_max_agent_turns"])
        self.assertIs(conversation["open_ended_anything_else_question"], False)
        self.assertFalse(self.oracle.evaluate({"question_count": 7})["question_cap_passed"])
        self.assertFalse(
            self.oracle.evaluate(
                {"intent": "existing_customer", "question_count": 5}
            )["question_cap_passed"]
        )
        self.assertFalse(
            self.oracle.evaluate(
                {"safety": "immediate_danger", "question_count": 3}
            )["question_cap_passed"]
        )

    def test_exact_one_hundred_scenarios_pass_the_oracle(self) -> None:
        self.assertEqual(100, self.scenario_document["case_count"])
        self.assertEqual(100, len(self.scenarios))
        self.assertEqual(
            [f"v2_{index:03d}" for index in range(1, 101)],
            [row["id"] for row in self.scenarios],
        )
        self.assertEqual([], self.oracle.scenario_failures(self.scenarios))

    def test_all_critical_mutations_are_killed(self) -> None:
        report = self.oracle.mutation_report(self.scenarios)
        self.assertEqual(16, report["total"])
        self.assertEqual(16, report["killed"])
        self.assertEqual([], report["survived"])
        self.assertEqual(1.0, report["critical_kill_rate"])
        self.assertGreaterEqual(report["overall_kill_rate"], 0.9)

    def test_structured_bridged_evidence_cannot_be_downgraded(self) -> None:
        state = self.oracle.reduce_transfer(
            [
                "transfer_started",
                "transfer_bridged",
                "transfer_cancelled",
                "transfer_failed:provider_error",
            ],
            "failure_branch",
            self.oracle.DEFAULT_RULES,
        )
        self.assertEqual("Bridged", state)
        self.assertEqual(
            "Bridged",
            self.oracle.reduce_transfer(
                ["transfer_started", "transfer_bridged", "transfer_bridged"],
                "connected",
                self.oracle.DEFAULT_RULES,
            ),
        )

    def test_provider_neutral_transfer_lifecycle_covers_non_success_states(self) -> None:
        base = {
            "urgency": "urgent",
            "configuration_profile": "urgent_handoff",
            "transfer_consent": "accepted",
        }
        offered = self.oracle.evaluate(
            {**base, "transfer_consent": "not_offered"}
        )
        cancelled = self.oracle.evaluate(
            {**base, "transfer_events": ["transfer_started", "transfer_cancelled"]}
        )
        ended = self.oracle.evaluate(
            {**base, "transfer_events": ["transfer_started", "transfer_ended"]}
        )
        failure_branch = self.oracle.evaluate(
            {**base, "transfer_events": [], "analysis_disposition": "failure_branch"}
        )
        false_model_success = self.oracle.evaluate(
            {
                **base,
                "transfer_events": ["transfer_started"],
                "analysis_disposition": "connected",
            }
        )
        self.assertEqual("Offered", offered["handoff_state"])
        self.assertEqual("Cancelled", cancelled["handoff_state"])
        self.assertEqual("Ended", ended["handoff_state"])
        self.assertEqual("Failed", failure_branch["handoff_state"])
        self.assertEqual("Started", false_model_success["handoff_state"])

    def test_transfer_failure_and_decline_have_truthful_bounded_paths(self) -> None:
        failed = self.oracle.evaluate(
            {
                "urgency": "urgent",
                "configuration_profile": "urgent_handoff",
                "transfer_consent": "accepted",
                "transfer_events": ["transfer_started", "transfer_failed:no_answer"],
            }
        )
        declined = self.oracle.evaluate(
            {
                "urgency": "urgent",
                "configuration_profile": "urgent_handoff",
                "transfer_consent": "declined",
            }
        )
        self.assertEqual(("Failed", "transfer_failure_close"), (failed["handoff_state"], failed["terminal_path"]))
        self.assertEqual(("Declined", "actionable_close"), (declined["handoff_state"], declined["terminal_path"]))
        self.assertEqual(1, failed["notification_count"])
        self.assertEqual(1, declined["notification_count"])

    def test_routine_vendor_danger_and_invalid_targets_never_transfer(self) -> None:
        facts = (
            {"configuration_profile": "all_handoff"},
            {"intent": "vendor", "configuration_profile": "all_handoff"},
            {
                "safety": "immediate_danger",
                "configuration_profile": "all_handoff",
            },
            {
                "urgency": "urgent",
                "configuration_profile": "urgent_handoff",
                "handoff_target_state": "voicemail",
            },
            {
                "urgency": "urgent",
                "configuration_profile": "urgent_handoff",
                "handoff_target_state": "forwarding_main",
            },
        )
        for item in facts:
            with self.subTest(item=item):
                self.assertIs(self.oracle.evaluate(item)["handoff_eligible"], False)

    def test_configuration_failures_collect_nothing_and_notify_nobody(self) -> None:
        for state in (
            "missing_client_id",
            "missing_deployment_id",
            "missing_configuration_version",
            "lowercase_resolver",
            "wrong_engagement",
            "wrong_capability",
            "unsupported_coverage",
            "extra_variable",
            "qa_literal",
        ):
            with self.subTest(state=state):
                result = self.oracle.evaluate({"configuration_state": state})
                self.assertIs(result["configuration_valid"], False)
                self.assertIs(result["caller_data_collected"], False)
                self.assertEqual(0, result["notification_count"])

    def test_notification_replay_and_two_client_isolation_converge(self) -> None:
        replay = self.oracle.evaluate({"notification_replay": True})
        client_alpha = self.oracle.evaluate(
            {"client_scope": "client_alpha", "event_scope": "client_alpha"}
        )
        client_beta = self.oracle.evaluate(
            {"client_scope": "client_beta", "event_scope": "client_beta"}
        )
        cross_client = self.oracle.evaluate(
            {"client_scope": "client_alpha", "event_scope": "client_beta"}
        )
        self.assertEqual(1, replay["notification_count"])
        self.assertTrue(client_alpha["isolation_preserved"])
        self.assertTrue(client_beta["isolation_preserved"])
        isolated_fields = (
            "company_marker",
            "service_marker",
            "area_marker",
            "urgent_marker",
            "target_fingerprint",
            "recipient_fingerprint",
            "reporting_partition",
        )
        for field in isolated_fields:
            with self.subTest(field=field):
                self.assertNotEqual(client_alpha[field], client_beta[field])
        alpha_after_beta = self.oracle.evaluate(
            {"client_scope": "client_alpha", "event_scope": "client_alpha"}
        )
        self.assertEqual(
            {field: client_alpha[field] for field in isolated_fields},
            {field: alpha_after_beta[field] for field in isolated_fields},
        )
        self.assertFalse(cross_client["configuration_valid"])
        self.assertEqual(0, cross_client["notification_count"])
        self.assertIsNone(cross_client["reporting_partition"])

    def test_sensitive_terminal_minimizes_retention(self) -> None:
        result = self.oracle.evaluate({"sensitive": "persistent"})
        self.assertEqual("sensitive_data_ended", result["primary_outcome"])
        self.assertEqual(0, result["retained_sensitive_fields"])
        self.assertEqual(0, result["notification_count"])
        self.assertFalse(result["handoff_eligible"])


if __name__ == "__main__":
    unittest.main()
