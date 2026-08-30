import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


CRM_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CRM_ROOT))

from validators.workflow_repair_packet import (  # noqa: E402
    CAPABILITY_DIGEST_DOMAIN,
    CLAIM_NAMESPACE,
    EXECUTION_POLICY,
    FORBIDDEN_ACTIONS,
    PACKET_DIGEST_DOMAIN,
    REPOSITORY_ROOT,
    RULE_ORDER,
    RULE_SPECS,
    SCHEMA_VERSION,
    TOOL_CONTRACT_DIGEST_DOMAIN,
    WorkflowRepairPacketValidationError,
    _git_subprocess_environment,
    assert_package_source_clean,
    assert_private_packet_path,
    digest_capability_attestation,
    digest_workflow_repair_packet,
    expected_criterion_ast,
    expected_criterion_asts,
    expected_failure_containment,
    expected_operations,
    expected_prestate_rules,
    expected_tool_contract_digest,
    normalize_criterion_ast,
    repository_source_revision,
    validate_workflow_repair_packet,
)


NOW_MS = int(
    datetime.fromisoformat("2026-08-28T18:05:00.000+00:00").timestamp()
    * 1000
)
AUTOMATION_CONTRACT_PATH = CRM_ROOT / "config" / "automation-contract.json"


def _bindings() -> dict:
    next_id = int("1" + "0" * 17 + "1")

    def identifier() -> str:
        nonlocal next_id
        value = str(next_id)
        next_id += 1
        return value

    rules = {}
    for key in RULE_ORDER:
        scheduled_roles = [
            role for role, _ in RULE_SPECS[key]["scheduled"]
        ]
        roles = [
            role
            for role, _ in (
                *RULE_SPECS[key]["instant"], *RULE_SPECS[key]["scheduled"]
            )
        ]
        rules[key] = {
            "ruleId": identifier(),
            "conditionId": identifier(),
            "conditionSequenceNumber": 1,
            "actionIds": {role: identifier() for role in roles},
            "scheduledActionTiming": {
                role: {"period": "business_days", "unit": 1}
                for role in scheduled_roles
            },
        }
    return {"rules": rules}


def _packet(**overrides) -> dict:
    bindings = _bindings()
    observed_form2_criteria = _observed_form2_criteria()
    organization_id = "9" + "0" * 17 + "1"
    capability = {
        "schemaVersion": SCHEMA_VERSION,
        "capturedAt": "2026-08-28T17:55:00.000Z",
        "expiresAt": "2026-08-28T18:10:00.000Z",
        "environment": "Development",
        "organizationId": organization_id,
        "source": (
            "installed_sylvara_connectors_and_official_zoho_crm_v8_contract"
        ),
        "effectiveTenantReadAccessProven": True,
        "effectiveTenantWriteAccessProven": True,
        "privateEvidenceSha256": "a" * 64,
        "toolContractSha256": expected_tool_contract_digest(),
    }
    prestate = {
        "schemaVersion": SCHEMA_VERSION,
        "capturedAt": "2026-08-28T17:56:00.000Z",
        "expiresAt": "2026-08-28T18:10:00.000Z",
        "organizationId": organization_id,
        "organizationMatchCount": 1,
        "paginationComplete": True,
        "privateEvidenceSha256": "b" * 64,
        "form2": {
            "publicFormDisabled": True,
            "submissionWebhookDisabled": True,
            "submissionCount": 0,
            "privateEvidenceSha256": "c" * 64,
        },
        "workflowRules": expected_prestate_rules(
            bindings, observed_form2_criteria
        ),
    }
    value = {
        "schemaVersion": SCHEMA_VERSION,
        "environment": "Development",
        "productionAuthorized": False,
        "approvedSourceRevision": repository_source_revision(),
        "operationAuthorizationId": "11111111-1111-4111-8111-111111111111",
        "target": {"organizationId": organization_id},
        "capabilityAttestation": capability,
        "prestate": prestate,
        "bindings": bindings,
        "operations": expected_operations(bindings, observed_form2_criteria),
        "failureContainment": expected_failure_containment(
            bindings, observed_form2_criteria
        ),
        "forbiddenActions": list(FORBIDDEN_ACTIONS),
        "executionPolicy": dict(EXECUTION_POLICY),
    }
    value.update(overrides)
    return value


def _approval(packet: dict, **overrides) -> dict:
    value = {
        "schemaVersion": SCHEMA_VERSION,
        "capturedAt": "2026-08-28T18:00:00.000Z",
        "expiresAt": "2026-08-28T18:09:00.000Z",
        "approvedSourceRevision": packet["approvedSourceRevision"],
        "targetOrganizationId": packet["target"]["organizationId"],
        "prestateEvidenceSha256": packet["prestate"][
            "privateEvidenceSha256"
        ],
        "capabilityAttestationSha256": digest_capability_attestation(
            packet["capabilityAttestation"]
        ),
        "packetSha256": digest_workflow_repair_packet(packet),
        "operationAuthorizationId": packet["operationAuthorizationId"],
        "workflowMutationAuthorized": True,
        "containmentAuthorized": True,
        "authorizedMainOperationCount": 8,
        "authorizedConditionalContainmentOperationCount": 1,
        "maximumAuthorizedMutationCallCount": 3,
        "singleUse": True,
        "durableConsumptionRequired": True,
        "retryAuthorized": False,
        "form2DisabledAndZeroSubmissionsRequired": True,
        "productionAuthorized": False,
    }
    value.update(overrides)
    return value


def _condition(tree: dict, api_name: str) -> dict:
    return next(
        child
        for child in tree["children"]
        if child["type"] == "condition" and child["apiName"] == api_name
    )


def _nested_lead_criteria() -> dict:
    children = expected_criterion_ast("leadIntake")["children"]
    return {
        "type": "group",
        "operator": "AND",
        "children": [
            children[3],
            {
                "type": "group",
                "operator": "AND",
                "children": [
                    children[2],
                    {
                        "type": "group",
                        "operator": "AND",
                        "children": [children[1], children[0]],
                    },
                ],
            },
        ],
    }


def _observed_form2_criteria() -> dict:
    """Return synthetic observations; these are deliberately not desired policy."""

    candidate = {
        "type": "group",
        "operator": "AND",
        "children": [
            {
                "type": "condition",
                "apiName": "Entry_Offer",
                "operator": "equal",
                "value": "7-Day Revenue Leak Test",
            },
            {
                "type": "condition",
                "apiName": "Setup_Form_Submission_ID",
                "operator": "not_equal",
                "value": "${EMPTY}",
            },
        ],
    }
    superseded = {
        "type": "group",
        "operator": "AND",
        "children": [
            {
                "type": "condition",
                "apiName": "Entry_Offer",
                "operator": "equal",
                "value": "7-Day Revenue Leak Test",
            },
            {
                "type": "condition",
                "apiName": "Legacy_Form2_Rule",
                "operator": "equal",
                "value": True,
            },
            {
                "type": "group",
                "operator": "OR",
                "children": [
                    {
                        "type": "condition",
                        "apiName": "Go_Live_Approval_Status",
                        "operator": "equal",
                        "value": "Pending Internal Approval",
                    },
                    {
                        "type": "condition",
                        "apiName": "Go_Live_Approval_Status",
                        "operator": "equal",
                        "value": "Not Ready",
                    },
                ],
            },
        ],
    }
    return {
        "form2Candidate": normalize_criterion_ast(candidate),
        "form2Superseded": normalize_criterion_ast(superseded),
    }


class WorkflowRepairPacketTests(unittest.TestCase):
    def test_git_subprocess_environment_rejects_repository_override_poisoning(
        self,
    ) -> None:
        self.assertEqual(
            {
                "GIT_OPTIONAL_LOCKS": "0",
                "GIT_TRACE": "1",
                "PATH": "synthetic-path",
            },
            _git_subprocess_environment(
                {
                    "GIT_ALTERNATE_OBJECT_DIRECTORIES": "PRIVATE-ALTERNATES",
                    "GIT_COMMON_DIR": "PRIVATE-COMMON-DIR",
                    "GIT_CONFIG": "PRIVATE-CONFIG",
                    "GIT_CONFIG_COUNT": "1",
                    "GIT_CONFIG_GLOBAL": "PRIVATE-GLOBAL-CONFIG",
                    "GIT_CONFIG_KEY_0": "core.hooksPath",
                    "GIT_CONFIG_KEY_999": "core.worktree",
                    "GIT_CONFIG_SYSTEM": "PRIVATE-SYSTEM-CONFIG",
                    "GIT_CONFIG_VALUE_0": "PRIVATE-HOOKS",
                    "GIT_CONFIG_VALUE_999": "PRIVATE-WORKTREE",
                    "GIT_DIR": "PRIVATE-GIT-DIR",
                    "GIT_INDEX_FILE": "PRIVATE-GIT-INDEX",
                    "GIT_OBJECT_DIRECTORY": "PRIVATE-GIT-OBJECTS",
                    "GIT_OPTIONAL_LOCKS": "1",
                    "GIT_TRACE": "1",
                    "GIT_WORK_TREE": "PRIVATE-GIT-WORKTREE",
                    "PATH": "synthetic-path",
                }
            ),
        )

    def test_git_checks_use_the_bound_repo_and_index_under_poisoned_host_env(
        self,
    ) -> None:
        poison = {
            "GIT_DIR": "PRIVATE-GIT-DIR",
            "GIT_WORK_TREE": "PRIVATE-GIT-WORKTREE",
            "GIT_INDEX_FILE": "PRIVATE-GIT-INDEX",
            "GIT_OBJECT_DIRECTORY": "PRIVATE-GIT-OBJECTS",
            "GIT_ALTERNATE_OBJECT_DIRECTORIES": "PRIVATE-ALTERNATES",
            "GIT_COMMON_DIR": "PRIVATE-COMMON-DIR",
            "GIT_CONFIG": "PRIVATE-CONFIG",
            "GIT_CONFIG_GLOBAL": "PRIVATE-GLOBAL-CONFIG",
            "GIT_CONFIG_SYSTEM": "PRIVATE-SYSTEM-CONFIG",
            "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "core.worktree",
            "GIT_CONFIG_VALUE_0": "PRIVATE-WORKTREE",
        }
        responses = [
            SimpleNamespace(stdout="a" * 40),
            SimpleNamespace(stdout=""),
            SimpleNamespace(stdout="H package-file\n"),
        ]
        with patch.dict(os.environ, poison, clear=False):
            with patch(
                "validators.workflow_repair_packet.subprocess.run",
                side_effect=responses,
            ) as runner:
                self.assertEqual(repository_source_revision(), "a" * 40)
                assert_package_source_clean()

        package_path = str(CRM_ROOT.relative_to(REPOSITORY_ROOT))
        self.assertEqual(len(runner.call_args_list), 3)
        for invocation in runner.call_args_list:
            command = invocation.args[0]
            environment = invocation.kwargs["env"]
            self.assertEqual(
                command[:6],
                [
                    "git",
                    "-c",
                    f"safe.directory={REPOSITORY_ROOT}",
                    "--no-optional-locks",
                    "-C",
                    str(REPOSITORY_ROOT),
                ],
            )
            self.assertEqual(environment["GIT_OPTIONAL_LOCKS"], "0")
            for name in poison:
                self.assertNotIn(name, environment)
        self.assertEqual(
            runner.call_args_list[1].args[0][-2:], ["--", package_path]
        )
        self.assertEqual(
            runner.call_args_list[2].args[0][-2:], ["--", package_path]
        )

    def test_validates_exact_development_packet_without_mutation(self) -> None:
        packet = _packet()
        result = validate_workflow_repair_packet(
            packet,
            _approval(packet),
            NOW_MS,
            packet["approvedSourceRevision"],
        )
        self.assertRegex(result.digest, r"^[a-f0-9]{64}$")
        self.assertEqual(result.consumption_digest, result.digest)
        self.assertEqual(
            result.authority_id, packet["operationAuthorizationId"]
        )
        self.assertEqual(result.main_operation_count, 8)
        self.assertEqual(result.main_mutation_call_count, 3)
        self.assertEqual(result.conditional_containment_operation_count, 1)
        self.assertEqual(result.maximum_mutation_call_count, 3)
        self.assertFalse(result.mutation_performed)
        self.assertFalse(result.single_use_runtime_enforced)

    def test_uses_explicit_successor_schema_digest_and_claim_namespace(self) -> None:
        self.assertEqual(SCHEMA_VERSION, 2)
        self.assertEqual(CLAIM_NAMESPACE, "crm-workflow-trigger-repair-v2")
        self.assertEqual(
            PACKET_DIGEST_DOMAIN,
            "sylvara.crm.workflow-trigger-repair-packet.v2",
        )
        self.assertEqual(
            CAPABILITY_DIGEST_DOMAIN,
            "sylvara.crm.workflow-trigger-repair-capability.v2",
        )
        self.assertEqual(
            TOOL_CONTRACT_DIGEST_DOMAIN,
            "sylvara.crm.workflow-trigger-repair-tool-contract.v2",
        )

        legacy = _packet()
        legacy["schemaVersion"] = 1
        with self.assertRaisesRegex(
            WorkflowRepairPacketValidationError, "packet_schema_invalid"
        ):
            validate_workflow_repair_packet(
                legacy,
                _approval(legacy),
                NOW_MS,
                legacy["approvedSourceRevision"],
            )

    def test_public_contract_and_validator_share_the_exact_normalized_trees(self) -> None:
        contract = json.loads(
            AUTOMATION_CONTRACT_PATH.read_text(encoding="utf-8")
        )["workflow_criterion_ast"]
        self.assertEqual(contract["schema_version"], 1)
        self.assertFalse(contract["private_identifiers_committed"])
        self.assertEqual(contract["rules"], expected_criterion_asts())
        self.assertEqual(
            set(contract["rules"]), {"leadIntake", "controls", "limits"}
        )
        self.assertEqual(
            contract["form2_authority"]["status"],
            "blocked_observed_not_authoritative",
        )
        self.assertFalse(
            contract["form2_authority"]["desired_criterion_ast_committed"]
        )
        self.assertFalse(
            contract["form2_authority"]["candidate_activation_authorized"]
        )

        workflows = {
            row["logical_name"]: row
            for row in json.loads(
                AUTOMATION_CONTRACT_PATH.read_text(encoding="utf-8")
            )["workflow_set"]
        }
        self.assertEqual(
            workflows["FORM1_INTAKE_REVIEW"]["criterion_ast_rule_keys"],
            ["leadIntake"],
        )
        initializer_keys = {
            row["criterion_ast_rule_key"]
            for row in workflows["DEAL_INITIALIZATION"]["provider_rules"]
        }
        self.assertEqual(initializer_keys, {"controls", "limits"})
        self.assertEqual(
            workflows["FORM2_SUBMISSION"]["criterion_authority"],
            "blocked_observed_not_authoritative",
        )
        self.assertNotIn(
            "criterion_ast_rule_keys", workflows["FORM2_SUBMISSION"]
        )
        self.assertFalse(
            workflows["FORM2_SUBMISSION"][
                "workflow_repair_activation_authorized"
            ]
        )

    def test_normalization_flattens_associative_and_but_preserves_or(self) -> None:
        self.assertEqual(
            normalize_criterion_ast(_nested_lead_criteria()),
            expected_criterion_ast("leadIntake"),
        )
        form2 = _observed_form2_criteria()["form2Superseded"]
        or_groups = [
            child
            for child in form2["children"]
            if child["type"] == "group" and child["operator"] == "OR"
        ]
        self.assertEqual(len(or_groups), 1)
        self.assertEqual(
            [child["value"] for child in or_groups[0]["children"]],
            ["Not Ready", "Pending Internal Approval"],
        )
        with self.assertRaisesRegex(
            WorkflowRepairPacketValidationError, "criterion_rule_invalid"
        ):
            expected_criterion_ast("form2Candidate")

    def test_every_mutation_and_readback_binds_packet_criteria_without_form2_authority(
        self,
    ) -> None:
        packet = _packet()
        prestate_by_key = {
            row["key"]: row for row in packet["prestate"]["workflowRules"]
        }
        operation_keys = {
            1: "leadIntake",
            3: "controls",
            5: "limits",
        }
        for index, key in operation_keys.items():
            gate = packet["operations"][index][
                "preMutationExactRuleReadback"
            ]
            with self.subTest(operation=index + 1, key=key):
                self.assertTrue(gate["mustPassBeforeMutation"])
                self.assertEqual(
                    gate["acceptance"]["rule"],
                    prestate_by_key[key],
                )
                self.assertTrue(gate["acceptance"]["completeRuleRequired"])
                self.assertFalse(gate["acceptance"]["ruleDriftAccepted"])
                self.assertEqual(
                    gate["acceptance"]["criteriaAssertion"]["criteria"],
                    prestate_by_key[key]["criteria"],
                )
                self.assertFalse(
                    gate["acceptance"]["criteriaAssertion"][
                        "criterionDriftAccepted"
                    ]
                )

        for index in (0, 2, 4, 6, 7):
            acceptance = packet["operations"][index]["acceptance"]
            self.assertTrue(
                acceptance["allCriteriaExactlyMatchPacketBoundAst"]
            )
            for rule in acceptance["rules"]:
                self.assertEqual(
                    rule["criteria"], prestate_by_key[rule["key"]]["criteria"]
                )

        final = packet["operations"][7]["acceptance"]
        self.assertEqual(final["inventory"]["logicalForm2ActiveCount"], 0)
        self.assertFalse(
            final["inventory"]["form2DesiredCriteriaAuthorityPresent"]
        )
        self.assertEqual(
            final["criteriaAuthority"]["status"],
            "blocked_observed_not_authoritative",
        )
        self.assertFalse(final["candidateMutationPerformed"])
        self.assertFalse(final["supersededMutationPerformed"])
        self.assertFalse(final["scheduledActionMutationOrDeletionPerformed"])

        mutation_rules = [
            operation["calls"][0]["args"]["body"]["workflow_rules"][0]
            for operation in packet["operations"]
            if operation["kind"] == "mutation"
        ]
        candidate = packet["bindings"]["rules"]["form2Candidate"]
        superseded = packet["bindings"]["rules"]["form2Superseded"]
        mutation_rule_ids = [row["id"] for row in mutation_rules]
        self.assertNotIn(candidate["ruleId"], mutation_rule_ids)
        self.assertNotIn(superseded["ruleId"], mutation_rule_ids)
        rendered_writes = json.dumps(mutation_rules, sort_keys=True)
        self.assertNotIn('"active": true', rendered_writes.lower())
        self.assertNotIn('"name"', rendered_writes)
        self.assertNotIn('"scheduled_actions"', rendered_writes)
        self.assertNotIn('"_delete"', rendered_writes)
        self.assertNotIn("b_days", rendered_writes)
        for action_id in candidate["actionIds"].values():
            self.assertNotIn(action_id, rendered_writes)

        containment = packet["failureContainment"]["operations"]
        self.assertEqual(len(containment), 1)
        self.assertEqual(containment[0]["kind"], "conditional_readback_gate")
        self.assertIsNone(containment[0]["preMutationExactRuleReadback"])
        self.assertTrue(
            containment[0]["acceptance"][
                "allCriteriaExactlyMatchPacketBoundAst"
            ]
        )

    def test_criterion_drift_stops_in_prestate_and_every_readback_gate(self) -> None:
        non_normalized = _packet()
        non_normalized["prestate"]["workflowRules"][0][
            "criteria"
        ] = _nested_lead_criteria()
        with self.assertRaisesRegex(
            WorkflowRepairPacketValidationError,
            "prestate_criterion_ast_not_normalized",
        ):
            validate_workflow_repair_packet(
                non_normalized,
                _approval(non_normalized),
                NOW_MS,
                non_normalized["approvedSourceRevision"],
            )

        prestate_drift = _packet()
        _condition(
            prestate_drift["prestate"]["workflowRules"][0]["criteria"],
            "Entry_Offer",
        )["value"] = "Changed Offer"
        with self.assertRaisesRegex(
            WorkflowRepairPacketValidationError,
            "prestate_reviewed_criterion_drift",
        ):
            validate_workflow_repair_packet(
                prestate_drift,
                _approval(prestate_drift),
                NOW_MS,
                prestate_drift["approvedSourceRevision"],
            )

        observed_not_normalized = _packet()
        observed_not_normalized["prestate"]["workflowRules"][4][
            "criteria"
        ]["children"].reverse()
        with self.assertRaisesRegex(
            WorkflowRepairPacketValidationError,
            "prestate_criterion_ast_not_normalized",
        ):
            validate_workflow_repair_packet(
                observed_not_normalized,
                _approval(observed_not_normalized),
                NOW_MS,
                observed_not_normalized["approvedSourceRevision"],
            )

        for mutate in (
            lambda value: _condition(
                value["operations"][1]["preMutationExactRuleReadback"]
                ["acceptance"]["criteriaAssertion"]["criteria"],
                "Entry_Offer",
            ).update({"value": "Changed Offer"}),
            lambda value: _condition(
                value["operations"][0]["acceptance"]["rules"][0]
                ["criteria"],
                "Entry_Offer",
            ).update({"value": "Changed Offer"}),
            lambda value: _condition(
                value["operations"][7]["acceptance"]["rules"][0]
                ["criteria"],
                "Entry_Offer",
            ).update({"value": "Changed Offer"}),
        ):
            packet = _packet()
            mutate(packet)
            with self.subTest(mutate=mutate):
                with self.assertRaisesRegex(
                    WorkflowRepairPacketValidationError,
                    "packet_operations_drift",
                ):
                    validate_workflow_repair_packet(
                        packet,
                        _approval(packet),
                        NOW_MS,
                        packet["approvedSourceRevision"],
                    )

    def test_non_criterion_drift_is_bound_in_every_immediate_rule_gate(
        self,
    ) -> None:
        cases = (
            lambda value: value["operations"][1][
                "preMutationExactRuleReadback"
            ]["acceptance"]["rule"].update({"active": False}),
            lambda value: value["operations"][3][
                "preMutationExactRuleReadback"
            ]["acceptance"]["rule"].update({"name": "Unexpected Name"}),
            lambda value: value["operations"][5][
                "preMutationExactRuleReadback"
            ]["acceptance"]["rule"]["instantActions"].append(
                {
                    "role": "unexpectedAction",
                    "type": "tasks",
                    "id": "9" * 19,
                }
            ),
            lambda value: value["operations"][5][
                "preMutationExactRuleReadback"
            ]["acceptance"]["rule"].update({"triggerType": "create"}),
        )
        for mutate in cases:
            packet = _packet()
            mutate(packet)
            with self.subTest(mutate=mutate):
                with self.assertRaisesRegex(
                    WorkflowRepairPacketValidationError,
                    "packet_operations_drift",
                ):
                    validate_workflow_repair_packet(
                        packet,
                        _approval(packet),
                        NOW_MS,
                        packet["approvedSourceRevision"],
                    )

    def test_digest_derivation_is_domain_separated_and_key_order_stable(self) -> None:
        packet = _packet()
        reordered = dict(reversed(list(packet.items())))
        self.assertEqual(
            digest_workflow_repair_packet(packet),
            digest_workflow_repair_packet(reordered),
        )
        raw_json_digest = hashlib.sha256(
            json.dumps(packet, sort_keys=True).encode("utf-8")
        ).hexdigest()
        self.assertNotEqual(digest_workflow_repair_packet(packet), raw_json_digest)

    def test_consumption_binding_is_stable_across_approval_reissue(self) -> None:
        packet = _packet()
        first = validate_workflow_repair_packet(
            packet,
            _approval(packet),
            NOW_MS,
            packet["approvedSourceRevision"],
        )
        reissued = validate_workflow_repair_packet(
            packet,
            _approval(
                packet,
                capturedAt="2026-08-28T18:01:00.000Z",
                expiresAt="2026-08-28T18:08:00.000Z",
            ),
            NOW_MS,
            packet["approvedSourceRevision"],
        )
        self.assertEqual(first.authority_id, reissued.authority_id)
        self.assertEqual(first.consumption_digest, reissued.consumption_digest)

        conflicting_packet = deepcopy(packet)
        conflicting_packet["prestate"]["privateEvidenceSha256"] = "d" * 64
        conflicting = validate_workflow_repair_packet(
            conflicting_packet,
            _approval(conflicting_packet),
            NOW_MS,
            conflicting_packet["approvedSourceRevision"],
        )
        self.assertEqual(first.authority_id, conflicting.authority_id)
        self.assertNotEqual(first.consumption_digest, conflicting.consumption_digest)

    def test_source_clean_check_rejects_hidden_git_index_state(self) -> None:
        clean = SimpleNamespace(stdout="")
        hidden = SimpleNamespace(stdout="h src/zoho-crm/free-revenue-leak-test/README.md\n")
        with patch(
            "validators.workflow_repair_packet.subprocess.run",
            side_effect=[clean, hidden],
        ):
            with self.assertRaisesRegex(
                WorkflowRepairPacketValidationError,
                "source_tree_hidden_index_state",
            ):
                assert_package_source_clean()

    def test_exact_order_and_payloads_preserve_all_scheduled_actions(self) -> None:
        packet = _packet()
        operations = packet["operations"]
        self.assertEqual([row["ordinal"] for row in operations], list(range(1, 9)))
        self.assertEqual(
            [row["name"] for row in operations],
            [
                "pre_mutation_exact_rule_and_criteria_readback_gate",
                "make_lead_intake_create_only_preserving_scheduled_actions",
                "lead_intake_exact_post_write_readback_gate",
                "make_controls_create_only",
                "controls_exact_post_write_readback_gate",
                "make_limits_create_only",
                "limits_exact_post_write_readback_gate",
                "final_exact_rule_set_and_both_form2_inactive_readback_gate",
            ],
        )

        lead_rule = operations[1]["calls"][0]["args"]["body"][
            "workflow_rules"
        ][0]
        self.assertEqual(
            lead_rule,
            {
                "id": packet["bindings"]["rules"]["leadIntake"]["ruleId"],
                "execute_when": {"type": "create"},
            },
        )

        controls_rule = operations[3]["calls"][0]["args"]["body"][
            "workflow_rules"
        ]
        limits_rule = operations[5]["calls"][0]["args"]["body"][
            "workflow_rules"
        ]
        self.assertEqual(
            controls_rule,
            [
                {
                    "id": packet["bindings"]["rules"]["controls"]["ruleId"],
                    "execute_when": {"type": "create"},
                }
            ],
        )

        mutation_bodies = [
            operation["calls"][0]["args"]["body"]
            for operation in operations
            if operation["kind"] == "mutation"
        ]
        rendered_mutations = json.dumps(mutation_bodies, sort_keys=True)
        self.assertNotIn('"conditions"', rendered_mutations)
        self.assertNotIn('"scheduled_actions"', rendered_mutations)
        self.assertNotIn('"_delete"', rendered_mutations)
        self.assertNotIn("b_days", rendered_mutations)

        lead_prestate = packet["prestate"]["workflowRules"][0]
        lead_final = operations[7]["acceptance"]["rules"][0]
        self.assertEqual(
            lead_final["scheduledActions"], lead_prestate["scheduledActions"]
        )
        self.assertEqual(
            limits_rule,
            [
                {
                    "id": packet["bindings"]["rules"]["limits"]["ruleId"],
                    "execute_when": {"type": "create"},
                }
            ],
        )

    def test_every_exact_lead_state_binds_condition_order_and_schedule_timing(
        self,
    ) -> None:
        packet = _packet()
        operations = packet["operations"]
        expected_scheduled = [
            {
                "role": "followUpTask",
                "type": "tasks",
                "id": packet["bindings"]["rules"]["leadIntake"]["actionIds"][
                    "followUpTask"
                ],
                "executeAfter": {"period": "business_days", "unit": 1},
            }
        ]
        lead_states = [
            packet["prestate"]["workflowRules"][0],
            operations[0]["acceptance"]["rules"][0],
            operations[1]["preMutationExactRuleReadback"]["acceptance"]["rule"],
            operations[2]["acceptance"]["rules"][0],
            operations[7]["acceptance"]["rules"][0],
            *[
                state["rules"][0]
                for state in packet["failureContainment"]["operations"][0][
                    "acceptance"
                ]["allowedStates"]
            ],
        ]
        for state in lead_states:
            self.assertEqual(state["conditionSequenceNumber"], 1)
            self.assertEqual(state["scheduledActions"], expected_scheduled)

        for rule in packet["prestate"]["workflowRules"][1:]:
            self.assertEqual(rule["conditionSequenceNumber"], 1)
            self.assertEqual(rule["scheduledActions"], [])

    def test_rejects_unsafe_condition_and_schedule_binding_scalars(self) -> None:
        cases = (
            (
                lambda value: value["bindings"]["rules"]["leadIntake"].update(
                    {"conditionSequenceNumber": True}
                ),
                "binding_condition_sequence_invalid",
            ),
            (
                lambda value: value["bindings"]["rules"]["leadIntake"].update(
                    {"conditionSequenceNumber": 2}
                ),
                "binding_condition_sequence_invalid",
            ),
            (
                lambda value: value["bindings"]["rules"]["leadIntake"][
                    "scheduledActionTiming"
                ]["followUpTask"].update({"period": "b_days"}),
                "binding_scheduled_period_invalid",
            ),
            (
                lambda value: value["bindings"]["rules"]["leadIntake"][
                    "scheduledActionTiming"
                ]["followUpTask"].update({"period": 1}),
                "binding_scheduled_period_invalid",
            ),
            (
                lambda value: value["bindings"]["rules"]["leadIntake"][
                    "scheduledActionTiming"
                ]["followUpTask"].update({"unit": True}),
                "binding_scheduled_unit_invalid",
            ),
            (
                lambda value: value["bindings"]["rules"]["leadIntake"][
                    "scheduledActionTiming"
                ]["followUpTask"].update({"unit": 0}),
                "binding_scheduled_unit_invalid",
            ),
        )
        for mutate, error_code in cases:
            packet = _packet()
            mutate(packet)
            with self.subTest(error_code=error_code):
                with self.assertRaisesRegex(
                    WorkflowRepairPacketValidationError, error_code
                ):
                    validate_workflow_repair_packet(
                        packet,
                        _approval(packet),
                        NOW_MS,
                        packet["approvedSourceRevision"],
                    )

    def test_rejects_condition_sequence_period_and_unit_readback_drift(
        self,
    ) -> None:
        cases = (
            (
                lambda value: value["prestate"]["workflowRules"][0].update(
                    {"conditionSequenceNumber": 2}
                ),
                "prestate_workflow_drift",
            ),
            (
                lambda value: value["operations"][2]["acceptance"]["rules"][0][
                    "scheduledActions"
                ][0]["executeAfter"].update({"period": "days"}),
                "packet_operations_drift",
            ),
            (
                lambda value: value["operations"][7]["acceptance"]["rules"][0][
                    "scheduledActions"
                ][0]["executeAfter"].update({"unit": 2}),
                "packet_operations_drift",
            ),
            (
                lambda value: value["failureContainment"]["operations"][0][
                    "acceptance"
                ]["allowedStates"][1]["rules"][0].update(
                    {"conditionSequenceNumber": 2}
                ),
                "packet_containment_drift",
            ),
            (
                lambda value: value["failureContainment"]["operations"][0][
                    "acceptance"
                ]["allowedStates"][2]["rules"][0]["scheduledActions"][0][
                    "executeAfter"
                ].update({"period": "days", "unit": 2}),
                "packet_containment_drift",
            ),
        )
        for mutate, error_code in cases:
            packet = _packet()
            mutate(packet)
            with self.subTest(error_code=error_code):
                with self.assertRaisesRegex(
                    WorkflowRepairPacketValidationError, error_code
                ):
                    validate_workflow_repair_packet(
                        packet,
                        _approval(packet),
                        NOW_MS,
                        packet["approvedSourceRevision"],
                    )

    def test_readback_gates_prove_both_form2_rules_stay_inactive(self) -> None:
        packet = _packet()
        operations = packet["operations"]
        self.assertEqual(operations[0]["kind"], "readback_gate")
        self.assertTrue(operations[0]["acceptance"]["bothForm2RulesInactive"])
        for mutation_index, readback_index, key in (
            (1, 2, "leadIntake"),
            (3, 4, "controls"),
            (5, 6, "limits"),
        ):
            self.assertEqual(operations[mutation_index]["kind"], "mutation")
            self.assertEqual(operations[readback_index]["kind"], "readback_gate")
            self.assertEqual(
                operations[readback_index]["calls"],
                [
                    {
                        "tool": operations[0]["calls"][0]["tool"],
                        "args": {
                            "path_variables": {
                                "id": packet["bindings"]["rules"][key][
                                    "ruleId"
                                ]
                            }
                        },
                    }
                ],
            )
            self.assertEqual(
                operations[readback_index]["acceptance"]["rules"][0][
                    "triggerType"
                ],
                "create",
            )
            self.assertTrue(
                operations[readback_index]["acceptance"][
                    "scheduledActionsExactlyMatchPacketBoundPrestate"
                ]
            )
        final = operations[7]["acceptance"]
        self.assertTrue(final["bothForm2RulesInactive"])
        self.assertEqual(final["inventory"]["candidateActiveCount"], 0)
        self.assertEqual(final["inventory"]["supersededActiveCount"], 0)
        self.assertEqual(final["inventory"]["logicalForm2ActiveCount"], 0)
        self.assertTrue(final["inventory"]["paginationComplete"])
        self.assertEqual(
            final["criteriaAuthority"]["status"],
            "blocked_observed_not_authoritative",
        )
        candidate_prestate = packet["prestate"]["workflowRules"][3]
        candidate_final = final["rules"][3]
        self.assertEqual(candidate_final, candidate_prestate)
        self.assertEqual(final["rules"][4], packet["prestate"]["workflowRules"][4])

    def test_allows_the_same_associative_action_definition_in_both_form2_rules(self) -> None:
        packet = _packet()
        observed_form2_criteria = {
            row["key"]: row["criteria"]
            for row in packet["prestate"]["workflowRules"]
            if row["key"] in ("form2Candidate", "form2Superseded")
        }
        candidate_actions = packet["bindings"]["rules"]["form2Candidate"][
            "actionIds"
        ]
        superseded_actions = packet["bindings"]["rules"]["form2Superseded"][
            "actionIds"
        ]
        superseded_actions.update(candidate_actions)
        packet["prestate"]["workflowRules"] = expected_prestate_rules(
            packet["bindings"], observed_form2_criteria
        )
        packet["operations"] = expected_operations(
            packet["bindings"], observed_form2_criteria
        )
        packet["failureContainment"] = expected_failure_containment(
            packet["bindings"], observed_form2_criteria
        )
        result = validate_workflow_repair_packet(
            packet,
            _approval(packet),
            NOW_MS,
            packet["approvedSourceRevision"],
        )
        self.assertEqual(result.main_operation_count, 8)

    def test_containment_is_read_only_and_never_activates_form2(self) -> None:
        packet = _packet()
        containment = packet["failureContainment"]
        self.assertTrue(containment["neverReactivateSupersededRule"])
        self.assertTrue(containment["neverActivateEitherForm2Rule"])
        self.assertFalse(containment["candidateMutationAuthorized"])
        self.assertFalse(containment["retrySupersededDeactivationAuthorized"])
        self.assertFalse(containment["retryAnyMutationAuthorized"])
        self.assertEqual(
            containment["terminalState"],
            {
                "canonicalCandidateActive": False,
                "supersededRuleActive": False,
                "triggerRepairState": (
                    "one_of_four_exact_monotonic_prefix_states"
                ),
                "scheduledActionsUnchanged": True,
            },
        )
        self.assertEqual(len(containment["operations"]), 1)
        operation = containment["operations"][0]
        self.assertEqual(operation["kind"], "conditional_readback_gate")
        self.assertEqual(len(operation["calls"]), len(RULE_ORDER))
        self.assertTrue(
            all(
                call["tool"].endswith("zohocrm_getworkflowrulebyid")
                for call in operation["calls"]
            )
        )
        self.assertEqual(
            [call["args"]["path_variables"]["id"] for call in operation["calls"]],
            [packet["bindings"]["rules"][key]["ruleId"] for key in RULE_ORDER],
        )
        acceptance = operation["acceptance"]
        self.assertEqual(acceptance["type"], "one_of_exact_packet_bound_rule_sets")
        self.assertEqual(acceptance["allowedStateCount"], 4)
        self.assertTrue(acceptance["monotonicTriggerPrefixRequired"])
        self.assertTrue(acceptance["allFiveRulesReadByIdRequired"])
        self.assertTrue(
            acceptance["scheduledActionsExactlyMatchPacketBoundPrestate"]
        )
        self.assertEqual(
            [state["name"] for state in acceptance["allowedStates"]],
            [
                "no_trigger_write_observed",
                "lead_only_observed",
                "lead_and_controls_observed",
                "all_three_observed",
            ],
        )
        expected_trigger_prefixes = (
            ("create_or_edit", "create_or_edit", "create_or_edit"),
            ("create", "create_or_edit", "create_or_edit"),
            ("create", "create", "create_or_edit"),
            ("create", "create", "create"),
        )
        prestate = packet["prestate"]["workflowRules"]
        for state, trigger_prefix in zip(
            acceptance["allowedStates"], expected_trigger_prefixes
        ):
            self.assertEqual(len(state["rules"]), len(RULE_ORDER))
            expected_rules = deepcopy(prestate)
            for index, trigger_type in enumerate(trigger_prefix):
                expected_rules[index]["triggerType"] = trigger_type
            self.assertEqual(state["rules"], expected_rules)
            self.assertEqual(
                tuple(rule["triggerType"] for rule in state["rules"][:3]),
                trigger_prefix,
            )
            self.assertFalse(state["rules"][3]["active"])
            self.assertFalse(state["rules"][4]["active"])
            self.assertEqual(
                [rule["scheduledActions"] for rule in state["rules"]],
                [rule["scheduledActions"] for rule in prestate],
            )
        tampered = json.loads(json.dumps(packet))
        tampered["failureContainment"]["neverReactivateSupersededRule"] = False
        with self.assertRaisesRegex(
            WorkflowRepairPacketValidationError, "packet_containment_drift"
        ):
            validate_workflow_repair_packet(
                tampered,
                _approval(tampered),
                NOW_MS,
                tampered["approvedSourceRevision"],
            )

    def test_rejects_source_environment_form2_and_freshness_drift(self) -> None:
        packet = _packet()
        with self.assertRaisesRegex(
            WorkflowRepairPacketValidationError, "packet_source_revision_drift"
        ):
            validate_workflow_repair_packet(
                packet, _approval(packet), NOW_MS, "f" * 40
            )

        production = _packet(environment="Production")
        with self.assertRaisesRegex(
            WorkflowRepairPacketValidationError, "packet_environment_invalid"
        ):
            validate_workflow_repair_packet(
                production,
                _approval(production),
                NOW_MS,
                production["approvedSourceRevision"],
            )

        enabled = _packet()
        enabled["prestate"]["form2"]["publicFormDisabled"] = False
        with self.assertRaisesRegex(
            WorkflowRepairPacketValidationError, "prestate_form2_not_contained"
        ):
            validate_workflow_repair_packet(
                enabled,
                _approval(enabled),
                NOW_MS,
                enabled["approvedSourceRevision"],
            )

        with self.assertRaisesRegex(
            WorkflowRepairPacketValidationError, "expired"
        ):
            validate_workflow_repair_packet(
                packet,
                _approval(packet),
                NOW_MS + 5 * 60 * 1000,
                packet["approvedSourceRevision"],
            )

    def test_rejects_operation_order_tool_scheduled_and_form2_write_drift(
        self,
    ) -> None:
        for mutate in (
            lambda value: value["operations"].reverse(),
            lambda value: value["operations"][0]["calls"][0].update(
                {"tool": "unapproved_writer"}
            ),
            lambda value: value["operations"][1]["calls"][0]["args"][
                "body"
            ]["workflow_rules"][0]["execute_when"].update({"type": "edit"}),
            lambda value: value["operations"][1]["calls"][0]["args"][
                "body"
            ]["workflow_rules"][0].update(
                {
                    "conditions": [
                        {
                            "id": value["bindings"]["rules"]["leadIntake"][
                                "conditionId"
                            ],
                            "sequence_number": 1,
                            "scheduled_actions": [],
                        }
                    ]
                }
            ),
            lambda value: value["operations"][1]["calls"][0]["args"][
                "body"
            ]["workflow_rules"][0].update(
                {
                    "id": value["bindings"]["rules"]["form2Superseded"][
                        "ruleId"
                    ]
                }
            ),
        ):
            packet = _packet()
            mutate(packet)
            with self.subTest(mutate=mutate):
                with self.assertRaisesRegex(
                    WorkflowRepairPacketValidationError,
                    "packet_operations_drift",
                ):
                    validate_workflow_repair_packet(
                        packet,
                        _approval(packet),
                        NOW_MS,
                        packet["approvedSourceRevision"],
                    )

    def test_approval_is_exact_short_lived_and_single_use(self) -> None:
        packet = _packet()
        cases = (
            {"packetSha256": "0" * 64},
            {"targetOrganizationId": "9" + "0" * 17 + "2"},
            {"singleUse": False},
            {"durableConsumptionRequired": False},
            {"operationAuthorizationId": "22222222-2222-4222-8222-222222222222"},
            {"retryAuthorized": True},
            {"authorizedMainOperationCount": 5},
            {"maximumAuthorizedMutationCallCount": 4},
            {"productionAuthorized": True},
            {"expiresAt": "2026-08-28T18:10:00.001Z"},
        )
        for override in cases:
            with self.subTest(override=override):
                with self.assertRaises(WorkflowRepairPacketValidationError):
                    validate_workflow_repair_packet(
                        packet,
                        _approval(packet, **override),
                        NOW_MS,
                        packet["approvedSourceRevision"],
                    )

    def test_private_files_must_resolve_outside_every_git_worktree(self) -> None:
        with self.assertRaisesRegex(
            WorkflowRepairPacketValidationError,
            "private_file_inside_git_worktree",
        ):
            assert_private_packet_path(__file__)
        with tempfile.TemporaryDirectory() as directory:
            external = Path(directory) / "packet.json"
            external.write_text("{}\n", encoding="utf-8")
            self.assertEqual(assert_private_packet_path(external), external.resolve())

            hard_link = Path(directory) / "packet-hard-link.json"
            try:
                os.link(external, hard_link)
            except OSError:
                pass
            else:
                with self.assertRaisesRegex(
                    WorkflowRepairPacketValidationError,
                    "private_file_link_count_invalid",
                ):
                    assert_private_packet_path(hard_link)

            linked = Path(directory) / "linked.json"
            try:
                os.symlink(__file__, linked)
            except (OSError, NotImplementedError):
                return
            with self.assertRaisesRegex(
                WorkflowRepairPacketValidationError,
                "private_file_inside_git_worktree",
            ):
                assert_private_packet_path(linked)

    def test_cli_never_echoes_private_json_or_private_paths(self) -> None:
        cli = CRM_ROOT / "tools" / "validate_private_workflow_repair_packet.py"
        canary = "PRIVATE-WORKFLOW-PACKET-CANARY"
        with tempfile.TemporaryDirectory() as directory:
            private_dir = Path(directory)
            packet_path = private_dir / "packet.json"
            approval_path = private_dir / "approval.json"
            cases = (
                (
                    f'{{"secret":"{canary}",',
                    "{}",
                    "private_packet_json_invalid",
                ),
                (
                    "{}",
                    f'{{"secret":"{canary}",',
                    "private_approval_json_invalid",
                ),
                (
                    f'{{"secret":"{canary}","secret":"duplicate"}}',
                    "{}",
                    "private_packet_json_invalid",
                ),
                (
                    "{}",
                    f'{{"secret":"{canary}","secret":"duplicate"}}',
                    "private_approval_json_invalid",
                ),
            )
            for packet_json, approval_json, error_code in cases:
                packet_path.write_text(packet_json, encoding="utf-8")
                approval_path.write_text(approval_json, encoding="utf-8")
                result = subprocess.run(
                    [sys.executable, str(cli), str(packet_path), str(approval_path)],
                    capture_output=True,
                    encoding="utf-8",
                    timeout=30,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, "")
                self.assertEqual(
                    result.stderr,
                    f"CRM workflow repair packet rejected: {error_code}\n",
                )
                self.assertNotIn(canary, result.stderr)
                self.assertNotIn(str(private_dir), result.stderr)

    def test_validation_errors_never_echo_private_values(self) -> None:
        packet = _packet()
        canary = "PRIVATE-ORGANIZATION-CANARY"
        packet["target"]["organizationId"] = canary
        with self.assertRaises(WorkflowRepairPacketValidationError) as raised:
            validate_workflow_repair_packet(
                packet,
                _approval(packet),
                NOW_MS,
                packet["approvedSourceRevision"],
            )
        self.assertNotIn(canary, str(raised.exception))


if __name__ == "__main__":
    unittest.main()
