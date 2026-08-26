from __future__ import annotations

import importlib.util
import itertools
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
CALL_GATEWAY_ROOT = (
    REPOSITORY_ROOT
    / "src"
    / "zoho-catalyst"
    / "revenue-desk-call-runtime"
    / "functions"
    / "revenue_desk_call_gateway"
)
PARSER_PATH = CALL_GATEWAY_ROOT / "lib" / "retell-handoff-v2-parser.js"
GATEWAY_MANIFEST_PATH = (
    CALL_GATEWAY_ROOT / "contracts" / "call-gap-capture-handoff-v2.proposed.json"
)
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

    def test_candidate_source_remains_not_ready_disabled_and_unbound(self) -> None:
        profile = self.contract["capability_profile"]
        self.assertEqual("call_gap_capture_handoff_v2", profile["name"])
        self.assertEqual("draft", profile["status"])
        self.assertIs(profile["enabled"], False)
        self.assertEqual([], profile["traffic_environments"])
        self.assertEqual("none", profile["billing_mode"])
        self.assertEqual(
            "NOT_READY",
            self.contract["retell_source_status"],
        )
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

    def test_provider_parser_is_implemented_but_unwired_and_non_importable(self) -> None:
        parser = self.adapter["provider_parser"]
        self.assertIs(parser["implemented"], True)
        self.assertIs(parser["runtime_wired"], False)
        self.assertIs(parser["importable"], False)
        self.assertEqual(
            self.validator.EXPECTED_ADAPTER_FIELD_MAPPING,
            parser["field_mapping"],
        )
        self.assertEqual(
            self.validator.EXPECTED_PROVIDER_EVENT_TYPES,
            parser["supported_provider_event_types"],
        )
        self.assertEqual(
            self.validator.EXPECTED_PROVIDER_BINDING_FIELDS,
            parser["verified_provider_binding_fields"],
        )
        self.assertIs(parser["verified_provider_binding_immutable"], True)
        self.assertEqual(
            self.validator.EXPECTED_HMAC_KEY_CONTRACT,
            parser["fingerprint_hmac_key_contract"],
        )
        self.assertEqual(
            self.validator.EXPECTED_WARM_TRANSFER_OPTION_FIELDS,
            parser["known_warm_transfer_option_fields"],
        )
        self.assertEqual(
            self.validator.EXPECTED_FORBIDDEN_WEBHOOK_OPTION_ALIASES,
            parser["forbidden_draft_security_aliases_in_webhook_option"],
        )
        self.assertEqual(
            "reject_until_exact_sanitized_live_fixtures_and_reviewed_contract_update",
            parser["unknown_transfer_option_fields"],
        )
        self.assertEqual(
            self.validator.EXPECTED_NORMALIZED_EVENT_REQUIRED_FIELDS,
            self.adapter["normalized_event_envelope"]["required_symbolic_fields"],
        )
        self.assertEqual(
            self.validator.EXPECTED_CUMULATIVE_CLAIM_LEDGER_CONTRACT,
            self.adapter["cumulative_claim_ledger_contract"],
        )
        self.assertIs(parser["raw_provider_payload_retained"], False)
        self.assertIs(parser["raw_target_retained"], False)
        self.assertIs(parser["failure_event_inference_allowed"], False)
        self.assertEqual(
            "NOT_READY",
            self.adapter["retell_source_status"],
        )
        self.assertEqual(
            parser["blocker"],
            self.contract["provider_boundary"]["reason"],
        )
        self.assertEqual(self.validator.EXPECTED_PROVIDER_BLOCKER, parser["blocker"])
        self.assertEqual(
            self.validator.EXPECTED_TRANSFER_CONFIGURATION_SCHEMA,
            self.adapter["retell_draft_transfer_configuration_schema"],
        )
        self.assertEqual(
            self.validator.EXPECTED_WEBHOOK_TRANSFER_PAYLOAD_SCHEMA,
            self.adapter["retell_webhook_transfer_payload_schema"],
        )

        gateway_manifest = json.loads(GATEWAY_MANIFEST_PATH.read_text(encoding="utf-8"))
        provider_boundary = gateway_manifest["provider_boundary"]
        self.assertIs(provider_boundary["provider_parser_implemented"], True)
        self.assertIs(provider_boundary["provider_parser_runtime_wired"], False)
        self.assertIs(provider_boundary["provider_parser_importable"], False)
        self.assertEqual(
            "cryptographically_random_256_bit_install_time",
            provider_boundary["fingerprint_hmac_key_generation_requirement"],
        )
        self.assertIs(
            provider_boundary[
                "transfer_configuration_fingerprint_required_on_every_normalized_event"
            ],
            True,
        )
        self.assertIs(
            self.contract["provider_boundary"][
                "transfer_configuration_fingerprint_required_on_every_normalized_event"
            ],
            True,
        )
        self.assertIs(
            self.contract["provider_boundary"][
                "transfer_configuration_fingerprint_immutable_per_call"
            ],
            True,
        )
        self.assertEqual(
            [
                "call_binding_key",
                "client_scope_key",
                "deployment_scope_key",
                "configuration_version_key",
                "transfer_configuration_fingerprint",
                "authorized_target_fingerprint",
            ],
            gateway_manifest["handoff_event_ledger"]["immutable_binding_fields"],
        )
        self.assertTrue(PARSER_PATH.is_file())
        self.assertIn(
            "function normalizeRetellTransferEvent(input)",
            PARSER_PATH.read_text(encoding="utf-8"),
        )
        for active_relative in (
            "index.js",
            "lib/runtime-boundary.js",
            "lib/runtime-service.js",
            "lib/job-handler.js",
        ):
            self.assertNotIn(
                "retell-handoff-v2-parser",
                (CALL_GATEWAY_ROOT / active_relative).read_text(encoding="utf-8"),
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
        self.assertEqual(
            self.validator.EXPECTED_HANDOFF_EVIDENCE,
            self.contract["handoff_evidence"],
        )
        self.assertEqual(
            self.validator.EXPECTED_STRUCTURED_STATE_PRECEDENCE,
            self.adapter["structured_event_state_precedence"],
        )

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
        self.assertEqual(1, notification["durable_rows_per_call_including_suppression"])
        self.assertIs(notification["durable_suppression_tombstone_required"], True)
        self.assertEqual(
            ["SensitiveSuppressed", "NonactionableSuppressed", "ActionableIntent"],
            notification["notification_disposition_precedence"],
        )
        self.assertIs(notification["suppressed_payload_must_be_null"], True)
        self.assertEqual(
            "handoff_state",
            notification["actionable_to_actionable_payload_mutable_only"],
        )
        self.assertEqual(
            {
                "channel": None,
                "delivery_state": "Suppressed",
                "delivery_claimed": False,
                "provider_calls": 0,
                "payload": None,
            },
            notification["irreversible_suppression_projection"],
        )
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
        with self.assertRaisesRegex(ValueError, "not allowlisted"):
            self.oracle.reduce_transfer(
                ["transfer_started", "transfer_bridged", "transfer_bridged"],
                "connected",
                self.oracle.DEFAULT_RULES,
            )

    def test_structured_lifecycle_convergence_is_order_independent(self) -> None:
        cases = (
            (
                [
                    "transfer_started",
                    "transfer_cancelled",
                    "transfer_ended",
                    "transfer_failed:no_answer",
                    "transfer_bridged",
                ],
                "Bridged",
            ),
            (
                [
                    "transfer_started",
                    "transfer_cancelled",
                    "transfer_ended",
                    "transfer_failed:no_answer",
                ],
                "Failed",
            ),
            (["transfer_started", "transfer_cancelled", "transfer_ended"], "Ended"),
            (["transfer_started", "transfer_cancelled"], "Cancelled"),
        )
        for events, expected in cases:
            for reordered in itertools.permutations(events):
                with self.subTest(events=reordered):
                    self.assertEqual(
                        expected,
                        self.oracle.reduce_transfer(
                            list(reordered), "failure_branch", self.oracle.DEFAULT_RULES
                        ),
                    )

    def test_handoff_requires_authoritative_consistent_eligibility_evidence(self) -> None:
        eligible = {
            "urgency": "urgent",
            "configuration_profile": "urgent_handoff",
            "transfer_consent": "accepted",
            "transfer_events": ["transfer_started"],
        }
        self.assertTrue(self.oracle.evaluate(eligible)["handoff_eligible"])

        for authority in self.validator.EXPECTED_HANDOFF_EVIDENCE:
            if not authority.endswith("_authority"):
                continue
            with self.subTest(authority=authority):
                result = self.oracle.evaluate({**eligible, authority: "untrusted"})
                self.assertFalse(result["configuration_valid"])
                self.assertEqual("handoff_evidence_untrusted", result["configuration_problem"])
                self.assertFalse(result["handoff_eligible"])
                self.assertEqual(0, result["notification_count"])

        hostile = (
            ({"authoritative_caller_intent": "vendor"}, "handoff_classification_inconsistent"),
            ({"authoritative_service_eligibility": "unsupported"}, "handoff_service_inconsistent"),
            ({"authoritative_area_eligibility": "out_of_area"}, "handoff_area_inconsistent"),
            ({"authoritative_destination_validity": "invalid"}, "handoff_destination_invalid"),
            ({"authoritative_destination_fingerprint": None}, "handoff_destination_fingerprint_missing"),
            ({"authoritative_loop_proof": "failed"}, "handoff_route_loop"),
        )
        for overrides, expected_problem in hostile:
            with self.subTest(overrides=overrides):
                result = self.oracle.evaluate({**eligible, **overrides})
                self.assertFalse(result["configuration_valid"])
                self.assertEqual(expected_problem, result["configuration_problem"])
                self.assertFalse(result["handoff_eligible"])
                self.assertEqual(0, result["notification_count"])

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
        self.assertEqual("Offered", offered["handoff_state"])
        self.assertEqual("Cancelled", cancelled["handoff_state"])
        self.assertEqual("Ended", ended["handoff_state"])
        self.assertEqual("Failed", failure_branch["handoff_state"])
        for prohibited_success in ("connected", "bridged", "human_connected", "transfer_succeeded"):
            with self.subTest(prohibited_success=prohibited_success):
                false_model_success = self.oracle.evaluate(
                    {
                        **base,
                        "transfer_events": ["transfer_started", "transfer_bridged"],
                        "analysis_disposition": prohibited_success,
                    }
                )
                self.assertFalse(false_model_success["configuration_valid"])
                self.assertEqual(
                    "model_handoff_disposition_invalid",
                    false_model_success["configuration_problem"],
                )
                self.assertEqual(0, false_model_success["notification_count"])

    def test_event_sequence_drives_staged_notification_reconciliation(self) -> None:
        base = {
            "urgency": "urgent",
            "configuration_profile": "urgent_handoff",
            "transfer_consent": "accepted",
            "transfer_events": ["transfer_started", "transfer_ended"],
        }
        analysis_first = self.oracle.evaluate(
            {**base, "event_sequence": ["call_analyzed", "transfer_ended"]}
        )
        terminal_first = self.oracle.evaluate(
            {**base, "event_sequence": ["transfer_ended", "call_analyzed"]}
        )
        self.assertEqual("Ended", analysis_first["handoff_state"])
        self.assertEqual("Ended", terminal_first["handoff_state"])
        self.assertEqual(1, analysis_first["notification_count"])
        self.assertEqual(1, terminal_first["notification_count"])
        self.assertEqual(
            ["inserted", "updated"],
            [stage["notification_action"] for stage in analysis_first["event_sequence_trace"]],
        )
        self.assertEqual(
            ["none", "inserted"],
            [stage["notification_action"] for stage in terminal_first["event_sequence_trace"]],
        )
        self.assertNotEqual(
            analysis_first["event_sequence_trace"],
            terminal_first["event_sequence_trace"],
        )

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
