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
    FIELD_UPDATE_BY_ID_TOOL,
    FORBIDDEN_ACTIONS,
    FORM2_TASK_DESCRIPTION,
    PACKET_DIGEST_DOMAIN,
    REPOSITORY_ROOT,
    RULE_ORDER,
    RULE_SPECS,
    SCHEMA_VERSION,
    TOOL_CONTRACT,
    TOOL_CONTRACT_DIGEST_DOMAIN,
    WORKFLOW_TASK_INVENTORY_TOOL,
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
    return {
        "rules": rules,
        "form2CandidateActionSemantics": {
            "setupAccessSubmitted": {
                "type": "field_update",
                "apiName": "Setup_Access_Status",
                "value": "Submitted",
            },
            "setupAndQaTask": {
                "type": "task",
                "subject": (
                    "Review Form 2 Setup and Begin QA — ${Deals.Deal Name}"
                ),
                "dueDays": 0,
                "priority": "High",
                "status": "Not Started",
                "ownerId": identifier(),
                "ownerInternal": True,
                "notifyAssignee": False,
                "recordAssociation": "current_deal",
                "descriptionSha256": hashlib.sha256(
                    FORM2_TASK_DESCRIPTION.encode("utf-8")
                ).hexdigest(),
            },
            "authorizationSigned": {
                "type": "field_update",
                "apiName": "Free_Test_Authorization_Status",
                "value": "Signed",
            },
            "testStatusSetupPending": {
                "type": "field_update",
                "apiName": "Test_Status",
                "value": "Setup Pending",
            },
        },
        "form2CriterionFieldIds": {
            api_name: identifier()
            for api_name in (
                "Authorized_Representative_Confirmed",
                "Authority_Confirmed_At",
                "Entry_Offer",
                "Go_Live_Approval_Status",
                "Setup_Access_Status",
                "Setup_Form_Submission_ID",
                "Setup_Form_Submitted_At",
                "Setup_Form_Version",
                "Test_Scope_Accepted",
                "Test_Scope_Accepted_At",
                "Test_Scope_Version",
            )
        },
    }


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
        "form2CandidateActivationAuthorized": True,
        "containmentAuthorized": True,
        "authorizedMainOperationCount": 11,
        "authorizedConditionalContainmentOperationCount": 3,
        "maximumAuthorizedMutationCallCount": 6,
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
    """Return the contained live defect plus inactive superseded evidence."""

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
            {
                "type": "condition",
                "apiName": "Setup_Form_Submitted_At",
                "operator": "not_equal",
                "value": "${EMPTY}",
            },
            {
                "type": "condition",
                "apiName": "Authorized_Representative_Confirmed",
                "operator": "equal",
                "value": True,
            },
            {
                "type": "condition",
                "apiName": "Authority_Confirmed_At",
                "operator": "not_equal",
                "value": "${EMPTY}",
            },
            {
                "type": "condition",
                "apiName": "Test_Scope_Accepted",
                "operator": "equal",
                "value": True,
            },
            {
                "type": "condition",
                "apiName": "Test_Scope_Accepted_At",
                "operator": "not_equal",
                "value": "${EMPTY}",
            },
            {
                "type": "condition",
                "apiName": "Test_Scope_Version",
                "operator": "not_equal",
                "value": "${EMPTY}",
            },
            {
                "type": "condition",
                "apiName": "Setup_Form_Version",
                "operator": "not_equal",
                "value": "${EMPTY}",
            },
            {
                "type": "condition",
                "apiName": "Form_2_Trusted_Proof_Accepted",
                "operator": "equal",
                "value": True,
            },
            {
                "type": "condition",
                "apiName": "Authorization_Signed_At",
                "operator": "not_equal",
                "value": "${EMPTY}",
            },
            {
                "type": "group",
                "operator": "OR",
                "children": [
                    {
                        "type": "condition",
                        "apiName": "Go_Live_Approval_Status",
                        "operator": "equal",
                        "value": "Not Ready",
                    },
                    {
                        "type": "condition",
                        "apiName": "Go_Live_Approval_Status",
                        "operator": "equal",
                        "value": "Pending Internal Approval",
                    },
                ],
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
        self.assertEqual(result.main_operation_count, 11)
        self.assertEqual(result.main_mutation_call_count, 5)
        self.assertEqual(result.conditional_containment_operation_count, 3)
        self.assertEqual(result.maximum_mutation_call_count, 6)
        self.assertFalse(result.mutation_performed)
        self.assertFalse(result.single_use_runtime_enforced)

    def test_uses_explicit_successor_schema_digest_and_claim_namespace(self) -> None:
        self.assertEqual(SCHEMA_VERSION, 3)
        self.assertEqual(CLAIM_NAMESPACE, "crm-workflow-trigger-repair-v3")
        self.assertEqual(
            PACKET_DIGEST_DOMAIN,
            "sylvara.crm.workflow-trigger-repair-packet.v3",
        )
        self.assertEqual(
            CAPABILITY_DIGEST_DOMAIN,
            "sylvara.crm.workflow-trigger-repair-capability.v3",
        )
        self.assertEqual(
            TOOL_CONTRACT_DIGEST_DOMAIN,
            "sylvara.crm.workflow-trigger-repair-tool-contract.v3",
        )
        self.assertEqual(
            TOOL_CONTRACT["fieldUpdateByIdTool"],
            FIELD_UPDATE_BY_ID_TOOL,
        )
        self.assertEqual(
            TOOL_CONTRACT["workflowTaskInventoryTool"],
            WORKFLOW_TASK_INVENTORY_TOOL,
        )
        self.assertFalse(
            TOOL_CONTRACT["workflowTaskInventoryQuery"][
                "nameFilterAuthorized"
            ]
        )

        legacy = _packet()
        legacy["schemaVersion"] = 2
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
            set(contract["rules"]),
            {"leadIntake", "controls", "limits", "form2Candidate"},
        )
        self.assertEqual(
            contract["form2_authority"]["status"],
            "deferred_full_automation_contract_separate_authorization_required",
        )
        self.assertEqual(
            contract["form2_authority"]["deployment_profile_scope"],
            "full-automation",
        )
        self.assertFalse(
            contract["form2_authority"]["free_test_journey_core_v1_authorized"]
        )
        self.assertTrue(
            contract["form2_authority"]["future_full_automation_contract_preserved"]
        )
        self.assertTrue(
            contract["form2_authority"]["separate_future_authorization_required"]
        )
        self.assertTrue(
            contract["form2_authority"]["desired_criterion_ast_committed"]
        )
        self.assertFalse(
            contract["form2_authority"]["candidate_mutation_authorized"]
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
            "reviewed_desired",
        )
        self.assertEqual(
            workflows["FORM2_SUBMISSION"]["criterion_ast_rule_key"],
            "form2Candidate",
        )
        self.assertEqual(
            workflows["FORM2_SUBMISSION"]["deployment_profile_scope"],
            "full-automation",
        )
        self.assertEqual(
            workflows["FORM2_SUBMISSION"]["journey_core_state"],
            "FORM2_WORKFLOW_DEFERRED_INACTIVE",
        )
        self.assertTrue(
            workflows["FORM2_SUBMISSION"][
                "future_full_automation_contract_preserved"
            ]
        )
        self.assertTrue(
            workflows["FORM2_SUBMISSION"]["separate_future_authorization_required"]
        )
        self.assertFalse(
            workflows["FORM2_SUBMISSION"][
                "workflow_repair_candidate_mutation_authorized"
            ]
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
        form2 = expected_criterion_ast("form2Candidate")
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
        rendered = json.dumps(form2, sort_keys=True)
        self.assertNotIn("Form_2_Trusted_Proof_Accepted", rendered)
        self.assertNotIn("Authorization_Signed_At", rendered)
        self.assertIn("Setup_Access_Status", rendered)

    def test_every_mutation_and_readback_binds_form2_authority(self) -> None:
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

        for index in (0, 2, 4, 6, 10):
            acceptance = packet["operations"][index]["acceptance"]
            self.assertTrue(
                acceptance["allCriteriaExactlyMatchPacketBoundAst"]
            )
            for rule in acceptance["rules"][:3]:
                self.assertEqual(
                    rule["criteria"], prestate_by_key[rule["key"]]["criteria"]
                )

        inactive_gate = packet["operations"][8]["acceptance"]
        self.assertTrue(inactive_gate["candidateInactive"])
        self.assertTrue(inactive_gate["supersededInactiveAndUnchanged"])
        self.assertTrue(inactive_gate["safeActionSemanticsPresent"])

        final = packet["operations"][10]["acceptance"]
        self.assertEqual(final["inventory"]["logicalForm2ActiveCount"], 1)
        self.assertTrue(final["inventory"]["form2DesiredCriteriaAuthorityPresent"])
        self.assertEqual(
            final["criteriaAuthority"]["status"],
            "reviewed_desired",
        )
        self.assertTrue(final["candidateMutationPerformed"])
        self.assertFalse(final["supersededMutationPerformed"])
        self.assertTrue(final["unsafeFieldUpdateDeletionPerformed"])
        self.assertFalse(final["scheduledActionMutationOrDeletionPerformed"])

        mutation_rules = [
            operation["calls"][0]["args"]["body"]["workflow_rules"][0]
            for operation in packet["operations"]
            if operation["kind"] == "mutation"
        ]
        candidate = packet["bindings"]["rules"]["form2Candidate"]
        superseded = packet["bindings"]["rules"]["form2Superseded"]
        mutation_rule_ids = [row["id"] for row in mutation_rules]
        self.assertEqual(mutation_rule_ids.count(candidate["ruleId"]), 2)
        self.assertNotIn(superseded["ruleId"], mutation_rule_ids)
        inactive_edit = mutation_rules[3]
        self.assertEqual(
            inactive_edit["name"],
            "Deals Revenue Leak Test Setup Form Proof Candidate",
        )
        condition = inactive_edit["conditions"][0]
        self.assertEqual(condition["sequence_number"], 1)
        self.assertIn("group_operator", condition["criteria"])
        provider_leaves = []

        def collect_provider_leaves(node: dict) -> None:
            if "group" in node:
                for child in node["group"]:
                    collect_provider_leaves(child)
                return
            provider_leaves.append(node)

        collect_provider_leaves(condition["criteria"])
        self.assertTrue(provider_leaves)
        self.assertEqual(condition["criteria"]["group_operator"], "AND")
        nested_provider_groups = [
            node
            for node in condition["criteria"]["group"]
            if "group_operator" in node
        ]
        self.assertEqual(
            [node["group_operator"] for node in nested_provider_groups],
            ["OR"],
        )
        self.assertTrue(
            all(leaf["type"] == "value" for leaf in provider_leaves)
        )
        self.assertTrue(
            all(
                set(leaf["field"]) == {"api_name", "id"}
                for leaf in provider_leaves
            )
        )
        self.assertTrue(
            all(
                leaf["value"] == "${EMPTY}"
                for leaf in provider_leaves
                if leaf["comparator"] == "not_equal"
            )
        )
        deletes = condition["instant_actions"]["actions"]
        self.assertEqual(
            deletes,
            [
                {
                    "id": candidate["actionIds"]["authorizationSigned"],
                    "type": "field_updates",
                    "_delete": None,
                },
                {
                    "id": candidate["actionIds"]["testStatusSetupPending"],
                    "type": "field_updates",
                    "_delete": None,
                },
            ],
        )
        self.assertEqual(
            mutation_rules[4],
            {"id": candidate["ruleId"], "status": {"active": True}},
        )
        rendered_writes = json.dumps(mutation_rules, sort_keys=True)
        self.assertNotIn('"scheduled_actions"', rendered_writes)
        self.assertNotIn("b_days", rendered_writes)

        containment = packet["failureContainment"]["operations"]
        self.assertEqual(len(containment), 3)
        self.assertEqual(containment[0]["kind"], "conditional_readback_gate")
        self.assertIsNone(containment[0]["preMutationExactRuleReadback"])
        self.assertEqual(containment[1]["kind"], "conditional_mutation")
        self.assertEqual(containment[2]["kind"], "conditional_readback_gate")
        self.assertTrue(
            containment[0]["acceptance"][
                "allCriteriaExactlyMatchPacketBoundAst"
            ]
        )

    def test_form2_action_definitions_are_independently_read_before_edit_activation_and_final_acceptance(
        self,
    ) -> None:
        packet = _packet()
        operations = packet["operations"]
        candidate = packet["bindings"]["rules"]["form2Candidate"]

        pre_edit = operations[7]["preMutationExactRuleReadback"][
            "independentActionDefinitionGate"
        ]
        self.assertEqual(
            pre_edit["requiredRoleOrder"],
            [
                "setupAccessSubmitted",
                "setupAndQaTask",
                "authorizationSigned",
                "testStatusSetupPending",
            ],
        )
        self.assertFalse(pre_edit["workflowRuleActionReferenceAloneAccepted"])
        self.assertEqual(
            [read["call"]["tool"] for read in pre_edit["reads"]],
            [
                FIELD_UPDATE_BY_ID_TOOL,
                WORKFLOW_TASK_INVENTORY_TOOL,
                FIELD_UPDATE_BY_ID_TOOL,
                FIELD_UPDATE_BY_ID_TOOL,
            ],
        )
        self.assertEqual(
            pre_edit["reads"][0]["call"]["args"],
            {
                "path_variables": {
                    "id": candidate["actionIds"]["setupAccessSubmitted"]
                }
            },
        )
        setup_definition = pre_edit["reads"][0]["acceptance"][
            "normalizedDefinition"
        ]
        self.assertEqual(
            setup_definition,
            {
                "id": candidate["actionIds"]["setupAccessSubmitted"],
                "moduleApiName": "Deals",
                "featureType": "workflow",
                "fieldApiName": "Setup_Access_Status",
                "definitionType": "static",
                "value": "Submitted",
            },
        )

        task_read = pre_edit["reads"][1]
        self.assertEqual(
            task_read["call"],
            {
                "tool": WORKFLOW_TASK_INVENTORY_TOOL,
                "args": {
                    "query_params": {
                        "module": "Deals",
                        "page": 1,
                        "per_page": 200,
                    }
                },
            },
        )
        task_acceptance = task_read["acceptance"]
        self.assertTrue(task_acceptance["paginationComplete"])
        self.assertFalse(task_acceptance["infoMoreRecords"])
        self.assertEqual(
            task_acceptance["exactTaskId"],
            candidate["actionIds"]["setupAndQaTask"],
        )
        self.assertEqual(task_acceptance["exactTaskIdMatchCount"], 1)
        self.assertEqual(
            task_acceptance["normalizedDefinition"]["subject"],
            "Review Form 2 Setup and Begin QA — ${Deals.Deal Name}",
        )
        self.assertEqual(
            task_acceptance["normalizedDefinition"]["dueDays"], 0
        )
        self.assertFalse(
            task_acceptance["normalizedDefinition"]["notifyAssignee"]
        )

        post_edit = operations[8]["acceptance"][
            "independentRetainedActionDefinitionGate"
        ]
        activation = operations[9]["preMutationExactRuleReadback"][
            "independentActionDefinitionGate"
        ]
        self.assertEqual(
            post_edit["requiredRoleOrder"],
            ["setupAccessSubmitted", "setupAndQaTask"],
        )
        self.assertEqual(activation, post_edit)
        self.assertEqual(
            operations[8]["calls"][2:],
            [read["call"] for read in post_edit["reads"]],
        )
        self.assertEqual(
            [read["call"] for read in activation["reads"]],
            [
                {
                    "tool": FIELD_UPDATE_BY_ID_TOOL,
                    "args": {
                        "path_variables": {
                            "id": candidate["actionIds"][
                                "setupAccessSubmitted"
                            ]
                        }
                    },
                },
                {
                    "tool": WORKFLOW_TASK_INVENTORY_TOOL,
                    "args": {
                        "query_params": {
                            "module": "Deals",
                            "page": 1,
                            "per_page": 200,
                        }
                    },
                },
            ],
        )
        final = operations[10]["acceptance"][
            "independentRetainedActionDefinitionGate"
        ]
        self.assertEqual(final, post_edit)
        self.assertEqual(
            operations[10]["calls"][-2:],
            [read["call"] for read in final["reads"]],
        )

    def test_action_definition_readback_drift_stops_before_activation(
        self,
    ) -> None:
        cases = (
            lambda value: value["operations"][7][
                "preMutationExactRuleReadback"
            ]["independentActionDefinitionGate"]["reads"][0]["call"].update(
                {"tool": "unapproved_action_reader"}
            ),
            lambda value: value["operations"][7][
                "preMutationExactRuleReadback"
            ]["independentActionDefinitionGate"]["reads"][2][
                "acceptance"
            ]["normalizedDefinition"].update({"value": "Not Signed"}),
            lambda value: value["operations"][8]["acceptance"][
                "independentRetainedActionDefinitionGate"
            ]["reads"][1]["acceptance"].update(
                {"paginationComplete": False}
            ),
            lambda value: value["operations"][9][
                "preMutationExactRuleReadback"
            ]["independentActionDefinitionGate"]["reads"][1][
                "acceptance"
            ].update({"exactTaskIdMatchCount": 0}),
            lambda value: value["operations"][10]["acceptance"][
                "independentRetainedActionDefinitionGate"
            ]["reads"][0]["acceptance"]["normalizedDefinition"].update(
                {"value": "Verified"}
            ),
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
                value["operations"][10]["acceptance"]["rules"][0]
                ["criteria"],
                "Entry_Offer",
            ).update({"value": "Changed Offer"}),
            lambda value: _condition(
                value["operations"][8]["acceptance"]["rules"][0]
                ["criteria"],
                "Setup_Access_Status",
            ).update({"value": "Changed Status"}),
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
        self.assertEqual(
            [row["ordinal"] for row in operations], list(range(1, 12))
        )
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
                "edit_form2_candidate_while_inactive",
                "form2_candidate_inactive_exact_post_write_readback_gate",
                "activate_cleaned_form2_candidate_status_only",
                "final_exact_rule_set_and_single_active_form2_inventory_gate",
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

        trigger_mutation_bodies = [
            operations[index]["calls"][0]["args"]["body"]
            for index in (1, 3, 5)
        ]
        rendered_trigger_mutations = json.dumps(
            trigger_mutation_bodies, sort_keys=True
        )
        self.assertNotIn('"conditions"', rendered_trigger_mutations)
        self.assertNotIn('"scheduled_actions"', rendered_trigger_mutations)
        self.assertNotIn('"_delete"', rendered_trigger_mutations)
        self.assertNotIn("b_days", rendered_trigger_mutations)

        candidate = packet["bindings"]["rules"]["form2Candidate"]
        inactive_edit = operations[7]["calls"][0]["args"]["body"][
            "workflow_rules"
        ][0]
        self.assertEqual(inactive_edit["id"], candidate["ruleId"])
        self.assertEqual(
            inactive_edit["conditions"][0]["instant_actions"]["actions"],
            [
                {
                    "id": candidate["actionIds"]["authorizationSigned"],
                    "type": "field_updates",
                    "_delete": None,
                },
                {
                    "id": candidate["actionIds"]["testStatusSetupPending"],
                    "type": "field_updates",
                    "_delete": None,
                },
            ],
        )
        self.assertEqual(
            operations[9]["calls"][0]["args"]["body"]["workflow_rules"],
            [{"id": candidate["ruleId"], "status": {"active": True}}],
        )

        lead_prestate = packet["prestate"]["workflowRules"][0]
        lead_final = operations[10]["acceptance"]["rules"][0]
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
            operations[10]["acceptance"]["rules"][0],
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
            (
                lambda value: value["bindings"][
                    "form2CandidateActionSemantics"
                ]["setupAndQaTask"].update({"dueDays": False}),
                "binding_form2_task_action_invalid",
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
                lambda value: value["operations"][10]["acceptance"]["rules"][0][
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

    def test_readback_gates_prove_staged_form2_activation_and_containment(
        self,
    ) -> None:
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
        inactive_gate = operations[8]["acceptance"]
        self.assertTrue(inactive_gate["candidateInactive"])
        self.assertTrue(inactive_gate["supersededInactiveAndUnchanged"])
        self.assertTrue(inactive_gate["safeActionSemanticsPresent"])
        self.assertTrue(
            inactive_gate["authorizationAndTestStatusActionsAbsent"]
        )
        self.assertEqual(
            [row["role"] for row in inactive_gate["rules"][0]["instantActions"]],
            ["setupAccessSubmitted", "setupAndQaTask"],
        )
        self.assertFalse(inactive_gate["rules"][0]["active"])
        self.assertEqual(
            inactive_gate["rules"][1],
            packet["prestate"]["workflowRules"][4],
        )

        final = operations[10]["acceptance"]
        self.assertTrue(final["canonicalCandidateActive"])
        self.assertTrue(final["supersededInactive"])
        self.assertEqual(final["inventory"]["candidateActiveCount"], 1)
        self.assertEqual(final["inventory"]["supersededActiveCount"], 0)
        self.assertEqual(final["inventory"]["logicalForm2ActiveCount"], 1)
        self.assertTrue(final["inventory"]["paginationComplete"])
        self.assertEqual(
            final["criteriaAuthority"]["status"],
            "reviewed_desired",
        )
        candidate_prestate = packet["prestate"]["workflowRules"][3]
        candidate_final = final["rules"][3]
        self.assertNotEqual(candidate_final, candidate_prestate)
        self.assertTrue(candidate_final["active"])
        self.assertEqual(
            candidate_final["name"],
            "Deals Revenue Leak Test Setup Form Proof Candidate",
        )
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
        self.assertEqual(result.main_operation_count, 11)

    def test_containment_deactivates_only_the_ambiguously_active_candidate(
        self,
    ) -> None:
        packet = _packet()
        containment = packet["failureContainment"]
        self.assertTrue(containment["neverReactivateSupersededRule"])
        self.assertTrue(containment["neverActivateSupersededRule"])
        self.assertTrue(containment["candidateMutationAuthorized"])
        self.assertTrue(
            containment["candidateActivationAuthorizedOnlyAfterInactiveReadback"]
        )
        self.assertTrue(containment["conditionalCandidateDeactivationAuthorized"])
        self.assertFalse(containment["retrySupersededDeactivationAuthorized"])
        self.assertFalse(containment["retryAnyMutationAuthorized"])
        self.assertEqual(
            containment["terminalState"],
            {
                "canonicalCandidateActive": False,
                "supersededRuleActive": False,
                "triggerRepairState": (
                    "one_of_five_exact_contained_states"
                ),
                "scheduledActionsUnchanged": True,
            },
        )
        self.assertEqual(len(containment["operations"]), 3)
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
        self.assertEqual(acceptance["allowedStateCount"], 6)
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
                "candidate_cleaned_inactive_observed",
                "candidate_active_observed",
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
            acceptance["allowedStates"][:4], expected_trigger_prefixes
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

        cleaned_inactive = acceptance["allowedStates"][4]["rules"]
        candidate_inactive = cleaned_inactive[3]
        self.assertEqual(
            tuple(rule["triggerType"] for rule in cleaned_inactive[:3]),
            ("create", "create", "create"),
        )
        self.assertFalse(candidate_inactive["active"])
        self.assertEqual(
            candidate_inactive["name"],
            "Deals Revenue Leak Test Setup Form Proof Candidate",
        )
        candidate_active = acceptance["allowedStates"][5]["rules"][3]
        self.assertTrue(candidate_active["active"])

        deactivation = containment["operations"][1]
        self.assertEqual(deactivation["kind"], "conditional_mutation")
        self.assertEqual(
            deactivation["acceptance"]["executeWhenState"],
            "candidate_active_observed",
        )
        self.assertEqual(
            deactivation["calls"][0]["args"]["body"]["workflow_rules"],
            [
                {
                    "id": packet["bindings"]["rules"]["form2Candidate"][
                        "ruleId"
                    ],
                    "status": {
                        "active": False,
                        "delete_schedule_action": False,
                    },
                }
            ],
        )

        final_gate = containment["operations"][2]
        self.assertEqual(final_gate["kind"], "conditional_readback_gate")
        self.assertEqual(len(final_gate["calls"]), len(RULE_ORDER) + 1)
        self.assertEqual(final_gate["acceptance"]["allowedStateCount"], 5)
        self.assertTrue(final_gate["acceptance"]["bothForm2RulesInactive"])
        self.assertEqual(
            final_gate["acceptance"]["inventory"]["logicalForm2ActiveCount"],
            0,
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

    def test_rejects_non_integer_schema_versions_and_counts(self) -> None:
        packet_cases = (
            (
                lambda value: value.update({"schemaVersion": 3.0}),
                "packet_schema_invalid",
            ),
            (
                lambda value: value["capabilityAttestation"].update(
                    {"schemaVersion": 3.0}
                ),
                "capability_schema_invalid",
            ),
            (
                lambda value: value["prestate"].update(
                    {"schemaVersion": 3.0}
                ),
                "prestate_schema_invalid",
            ),
            (
                lambda value: value["prestate"].update(
                    {"organizationMatchCount": True}
                ),
                "prestate_target_invalid",
            ),
            (
                lambda value: value["prestate"].update(
                    {"organizationMatchCount": 1.0}
                ),
                "prestate_target_invalid",
            ),
            (
                lambda value: value["prestate"]["form2"].update(
                    {"submissionCount": False}
                ),
                "prestate_form2_not_contained",
            ),
            (
                lambda value: value["prestate"]["form2"].update(
                    {"submissionCount": 0.0}
                ),
                "prestate_form2_not_contained",
            ),
        )
        for mutate, error_code in packet_cases:
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

        packet = _packet()
        approval_cases = (
            ({"schemaVersion": 3.0}, "approval_schema_invalid"),
            (
                {"authorizedMainOperationCount": 11.0},
                "approval_authority_invalid",
            ),
            (
                {"authorizedConditionalContainmentOperationCount": 3.0},
                "approval_authority_invalid",
            ),
            (
                {"maximumAuthorizedMutationCallCount": 6.0},
                "approval_authority_invalid",
            ),
        )
        for override, error_code in approval_cases:
            with self.subTest(error_code=error_code, override=override):
                with self.assertRaisesRegex(
                    WorkflowRepairPacketValidationError, error_code
                ):
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
