"""Fail-closed validation for one private Development CRM workflow repair packet.

This module performs no network or CRM operation.  It validates a private packet
whose values stay outside every Git worktree, and returns only a sanitized
summary.  The packet digest is exactly::

    SHA-256(
        UTF-8("sylvara.crm.workflow-repair-packet.v1")
        || 0x00
        || UTF-8(canonical_json(packet))
    )

``canonical_json`` sorts every object key recursively, emits no insignificant
whitespace, preserves array order, rejects NaN/infinity, and emits UTF-8 JSON.
The same construction, with a distinct domain, binds the capability attestation.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
PACKAGE_ROOT = Path(__file__).resolve().parents[1]
MAX_START_WINDOW_SECONDS = 15 * 60
MAX_PRIVATE_FILE_BYTES = 1024 * 1024

PACKET_DIGEST_DOMAIN = "sylvara.crm.workflow-repair-packet.v1"
CAPABILITY_DIGEST_DOMAIN = "sylvara.crm.workflow-repair-capability.v1"
TOOL_CONTRACT_DIGEST_DOMAIN = "sylvara.crm.workflow-repair-tool-contract.v1"

WRITE_TOOL = (
    "mcp__codex_apps__sylvara_crm_changes_v2_"
    "zohocrm_updateworkflowrule"
)
READ_BY_ID_TOOL = (
    "mcp__codex_apps__sylvara_crm_audit_"
    "zohocrm_getworkflowrulebyid"
)
INVENTORY_TOOL = (
    "mcp__codex_apps__sylvara_crm_audit_"
    "zohocrm_getworkflowrules"
)
OFFICIAL_UPDATE_CONTRACT = (
    "https://www.zoho.com/crm/developer/docs/api/v8/update-workflow.html"
)

SUPERSEDED_FORM2_RULE_NAME = "Deals Free Test Form 2 Submitted"
ENTRY_OFFER_VALUE = "7-Day Revenue Leak Test"
EMPTY_CRITERION_VALUE = "${EMPTY}"


def _criterion(api_name: str, operator: str, value: Any) -> dict[str, Any]:
    return {
        "type": "condition",
        "apiName": api_name,
        "operator": operator,
        "value": value,
    }


def _criterion_group(
    operator: str, *children: Mapping[str, Any]
) -> dict[str, Any]:
    return {
        "type": "group",
        "operator": operator,
        "children": list(children),
    }


_LEAD_CRITERIA = _criterion_group(
    "AND",
    _criterion("Entry_Offer", "equal", ENTRY_OFFER_VALUE),
    _criterion("Intake_Submission_ID", "not_equal", EMPTY_CRITERION_VALUE),
    _criterion("Lead_Status", "equal", "Free Test Requested"),
    _criterion("Free_Test_Contact_Consent", "equal", True),
)
_INITIALIZER_CRITERIA = _criterion_group(
    "AND",
    _criterion("Entry_Offer", "equal", ENTRY_OFFER_VALUE),
    _criterion("Setup_Form_Submission_ID", "equal", EMPTY_CRITERION_VALUE),
)
_REVIEWED_CRITERIA = {
    "leadIntake": _LEAD_CRITERIA,
    "controls": _INITIALIZER_CRITERIA,
    "limits": _INITIALIZER_CRITERIA,
}

RULE_SPECS = {
    "leadIntake": {
        "module": "Leads",
        "name": "Leads Free Test Intake Review",
        "active": True,
        "triggerType": "create_or_edit",
        "lastExecutionMarkerPresent": True,
        "instant": (("reviewTask", "tasks"),),
        "scheduled": (("followUpTask", "tasks"),),
    },
    "controls": {
        "module": "Deals",
        "name": "Deals Free Test Initialize Controls",
        "active": True,
        "triggerType": "create_or_edit",
        "lastExecutionMarkerPresent": True,
        "instant": (
            ("setupAccessNotIssued", "field_updates"),
            ("authorizationNotSent", "field_updates"),
            ("goLiveNotReady", "field_updates"),
            ("testStatusNotStarted", "field_updates"),
            ("testDurationSevenDays", "field_updates"),
        ),
        "scheduled": (),
    },
    "limits": {
        "module": "Deals",
        "name": "Deals Free Test Initialize Limits",
        "active": True,
        "triggerType": "create_or_edit",
        "lastExecutionMarkerPresent": True,
        "instant": (
            ("testCallLimitTwentyFive", "field_updates"),
            ("testScopeVersion", "field_updates"),
            ("typeInitialSale", "field_updates"),
        ),
        "scheduled": (),
    },
    "form2Candidate": {
        "module": "Deals",
        "name": "Deals Form 2 Controller Proof Candidate",
        "active": False,
        "triggerType": "create_or_edit",
        "lastExecutionMarkerPresent": False,
        "instant": (
            ("setupAccessSubmitted", "field_updates"),
            ("setupAndQaTask", "tasks"),
            ("authorizationSigned", "field_updates"),
            ("testStatusSetupPending", "field_updates"),
        ),
        "scheduled": (),
    },
    "form2Superseded": {
        "module": "Deals",
        "name": SUPERSEDED_FORM2_RULE_NAME,
        "active": True,
        "triggerType": "create_or_edit",
        "lastExecutionMarkerPresent": True,
        "instant": (
            ("setupAccessSubmitted", "field_updates"),
            ("setupAndQaTask", "tasks"),
            ("authorizationSigned", "field_updates"),
            ("testStatusSetupPending", "field_updates"),
        ),
        "scheduled": (),
    },
}

RULE_ORDER = tuple(RULE_SPECS)
FORBIDDEN_ACTIONS = (
    "Production",
    "Retell agent development, invocation, test, or simulation",
    "CRM record mutation",
    "customer or prospect mutation",
    "Form2 enablement or submission",
    "Billing",
    "Analytics",
    "Catalyst",
    "call routing",
    "customer communication",
)

TOOL_CONTRACT = {
    "schemaVersion": 1,
    "officialApiVersion": "v8",
    "officialUpdateContract": OFFICIAL_UPDATE_CONTRACT,
    "oneWorkflowRulePerUpdateRequest": True,
    "partialUpdateSupported": True,
    "actionDeleteMarker": {"_delete": None},
    "statusUpdateSupported": True,
    "deactivationRetainsScheduledExecutionsWhenFalse": True,
    "writeTool": WRITE_TOOL,
    "readByIdTool": READ_BY_ID_TOOL,
    "inventoryTool": INVENTORY_TOOL,
}

EXECUTION_POLICY = {
    "executeSerially": True,
    "firstMutationConsumesApproval": True,
    "durableConsumptionRequired": True,
    "noAutomaticRetry": True,
    "stopOnDrift": True,
    "stopOnAmbiguousResponse": True,
    "responseMustMatchBeforeNextOperation": True,
    "preMutationExactRuleReadbackRequired": True,
    "criterionDriftAccepted": False,
    "finalCriteriaReadbackRequired": True,
    "form2CriterionAuthority": "blocked_observed_not_authoritative",
    "form2CandidateMutationAuthorized": False,
    "form2ActivationAuthorized": False,
    "onlyForm2Mutation": "deactivate_superseded_rule_status_false",
    "form2MustRemainDisabled": True,
    "form2SubmissionsMustRemainZero": True,
}

_IDENTIFIER = re.compile(r"^[1-9][0-9]{18}$")
_SHA256 = re.compile(r"^[a-f0-9]{64}$")
_REVISION = re.compile(r"^[a-f0-9]{40}$")
_UUID_V4 = re.compile(
    r"^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$"
)
_UTC_TIMESTAMP = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"
)
_CRITERION_API_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,99}$")


class WorkflowRepairPacketValidationError(ValueError):
    """A stable rejection that never includes private values or file paths."""

    def __init__(self, code: str) -> None:
        super().__init__(f"CRM workflow repair packet rejected: {code}")
        self.code = code


@dataclass(frozen=True, slots=True)
class WorkflowRepairValidationResult:
    """Sanitized validation result; this is not evidence of a CRM mutation."""

    digest: str
    consumption_digest: str
    authority_id: str
    environment: str = "Development"
    main_operation_count: int = 7
    main_mutation_call_count: int = 4
    conditional_containment_operation_count: int = 1
    maximum_mutation_call_count: int = 4
    mutation_performed: bool = False
    single_use_runtime_enforced: bool = False


def _fail(code: str) -> None:
    raise WorkflowRepairPacketValidationError(code)


def _require(condition: bool, code: str) -> None:
    if not condition:
        _fail(code)


def _plain_mapping(value: Any, code: str) -> Mapping[str, Any]:
    _require(isinstance(value, Mapping), code)
    return value


def _exact_mapping(
    value: Any, fields: Sequence[str], code: str
) -> Mapping[str, Any]:
    selected = _plain_mapping(value, code)
    _require(set(selected) == set(fields), code)
    return selected


def _identifier(value: Any, code: str) -> str:
    _require(isinstance(value, str) and bool(_IDENTIFIER.fullmatch(value)), code)
    return value


def _sha256(value: Any, code: str) -> str:
    _require(isinstance(value, str) and bool(_SHA256.fullmatch(value)), code)
    return value


def _source_revision(value: Any, code: str) -> str:
    _require(isinstance(value, str) and bool(_REVISION.fullmatch(value)), code)
    return value


def _authority_id(value: Any, code: str) -> str:
    _require(isinstance(value, str) and bool(_UUID_V4.fullmatch(value)), code)
    return value


def _timestamp(value: Any, code: str) -> int:
    _require(
        isinstance(value, str) and bool(_UTC_TIMESTAMP.fullmatch(value)), code
    )
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(
            tzinfo=timezone.utc
        )
    except ValueError:
        _fail(code)
    canonical = parsed.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    _require(canonical == value, code)
    return int(parsed.timestamp() * 1000)


def _canonical_json(value: Any) -> str:
    try:
        rendered = json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        rendered.encode("utf-8")
        return rendered
    except (TypeError, UnicodeEncodeError, ValueError):
        _fail("canonical_json_invalid")


def normalize_criterion_ast(value: Any) -> dict[str, Any]:
    """Return the one deterministic provider-criterion representation.

    Zoho may associate a chain of AND nodes differently without changing its
    meaning.  AND groups are therefore flattened and canonically ordered.  OR
    children are ordered too, but their group boundary is never flattened into
    the surrounding AND tree.
    """

    node = _plain_mapping(value, "criterion_ast_node_invalid")
    node_type = node.get("type")
    if node_type == "condition":
        selected = _exact_mapping(
            node,
            ["type", "apiName", "operator", "value"],
            "criterion_ast_condition_invalid",
        )
        _require(
            isinstance(selected["apiName"], str)
            and bool(_CRITERION_API_NAME.fullmatch(selected["apiName"])),
            "criterion_ast_api_name_invalid",
        )
        _require(
            selected["operator"] in ("equal", "not_equal"),
            "criterion_ast_operator_invalid",
        )
        _require(
            isinstance(selected["value"], (str, bool)),
            "criterion_ast_value_invalid",
        )
        return {
            "type": "condition",
            "apiName": selected["apiName"],
            "operator": selected["operator"],
            "value": selected["value"],
        }

    if node_type == "group":
        selected = _exact_mapping(
            node,
            ["type", "operator", "children"],
            "criterion_ast_group_invalid",
        )
        operator = selected["operator"]
        _require(operator in ("AND", "OR"), "criterion_ast_operator_invalid")
        _require(
            isinstance(selected["children"], list)
            and len(selected["children"]) >= 2,
            "criterion_ast_children_invalid",
        )
        children = [
            normalize_criterion_ast(child) for child in selected["children"]
        ]
        if operator == "AND":
            flattened: list[dict[str, Any]] = []
            for child in children:
                if (
                    child["type"] == "group"
                    and child["operator"] == "AND"
                ):
                    flattened.extend(child["children"])
                else:
                    flattened.append(child)
            children = flattened
        children.sort(key=_canonical_json)
        canonical_children = [_canonical_json(child) for child in children]
        _require(
            len(canonical_children) == len(set(canonical_children)),
            "criterion_ast_duplicate_child",
        )
        return {
            "type": "group",
            "operator": operator,
            "children": children,
        }

    _fail("criterion_ast_node_invalid")


def expected_criterion_ast(rule_key: str) -> dict[str, Any]:
    """Return a detached exact normalized tree for one reviewed workflow."""

    _require(rule_key in _REVIEWED_CRITERIA, "criterion_rule_invalid")
    return normalize_criterion_ast(_REVIEWED_CRITERIA[rule_key])


def expected_criterion_asts() -> dict[str, dict[str, Any]]:
    """Return only reviewed desired trees, without any live workflow IDs."""

    return {key: expected_criterion_ast(key) for key in _REVIEWED_CRITERIA}


def normalize_observed_form2_criteria(
    value: Any,
) -> dict[str, dict[str, Any]]:
    """Normalize private Form2 observations without granting desired authority."""

    selected = _exact_mapping(
        value,
        ["form2Candidate", "form2Superseded"],
        "form2_observed_criteria_shape_invalid",
    )
    normalized: dict[str, dict[str, Any]] = {}
    for key in ("form2Candidate", "form2Superseded"):
        normalized[key] = normalize_criterion_ast(selected[key])
        _require(
            _canonical_json(selected[key]) == _canonical_json(normalized[key]),
            "form2_observed_criteria_not_normalized",
        )
    return normalized


def _domain_digest(domain: str, value: Any) -> str:
    material = domain.encode("utf-8") + b"\0" + _canonical_json(value).encode(
        "utf-8"
    )
    return hashlib.sha256(material).hexdigest()


def _digests_equal(left: Any, right: str) -> bool:
    return (
        isinstance(left, str)
        and bool(_SHA256.fullmatch(left))
        and bool(_SHA256.fullmatch(right))
        and hmac.compare_digest(left, right)
    )


def digest_workflow_repair_packet(packet: Mapping[str, Any]) -> str:
    """Derive the exact domain-separated approval digest for a private packet."""

    return _domain_digest(PACKET_DIGEST_DOMAIN, packet)


def digest_capability_attestation(attestation: Mapping[str, Any]) -> str:
    """Derive the exact domain-separated digest for connector/API evidence."""

    return _domain_digest(CAPABILITY_DIGEST_DOMAIN, attestation)


def expected_tool_contract_digest() -> str:
    """Return the reviewed official API and installed-tool contract digest."""

    return _domain_digest(TOOL_CONTRACT_DIGEST_DOMAIN, TOOL_CONTRACT)


def _validate_window(
    value: Mapping[str, Any], label: str, now_ms: int
) -> tuple[int, int]:
    captured_ms = _timestamp(value.get("capturedAt"), f"{label}_window_invalid")
    expires_ms = _timestamp(value.get("expiresAt"), f"{label}_window_invalid")
    _require(
        captured_ms < expires_ms
        and expires_ms - captured_ms <= MAX_START_WINDOW_SECONDS * 1000,
        f"{label}_window_invalid",
    )
    _require(captured_ms <= now_ms, f"{label}_not_yet_valid")
    _require(now_ms < expires_ms, f"{label}_expired")
    return captured_ms, expires_ms


_UNTRUSTED_GIT_ENVIRONMENT_NAMES = frozenset(
    {
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_COMMON_DIR",
        "GIT_CONFIG",
        "GIT_CONFIG_GLOBAL",
        "GIT_CONFIG_SYSTEM",
        "GIT_CONFIG_COUNT",
    }
)
_UNTRUSTED_GIT_CONFIG_SLOT = re.compile(
    r"^GIT_CONFIG_(?:KEY|VALUE)_[0-9]+$", re.IGNORECASE
)


def _git_subprocess_environment(
    source: Mapping[str, str] | None = None,
) -> dict[str, str]:
    """Remove repository/config overrides while preserving the host runtime."""

    selected = os.environ if source is None else source
    environment = {}
    for name, value in selected.items():
        normalized_name = name.upper()
        if normalized_name in _UNTRUSTED_GIT_ENVIRONMENT_NAMES:
            continue
        if _UNTRUSTED_GIT_CONFIG_SLOT.fullmatch(normalized_name):
            continue
        environment[name] = value
    environment["GIT_OPTIONAL_LOCKS"] = "0"
    return environment


def repository_source_revision() -> str:
    """Read HEAD without exposing the repository path in any raised error."""

    try:
        result = subprocess.run(
            [
                "git",
                "-c",
                f"safe.directory={REPOSITORY_ROOT}",
                "--no-optional-locks",
                "-C",
                str(REPOSITORY_ROOT),
                "rev-parse",
                "HEAD",
            ],
            capture_output=True,
            check=True,
            encoding="utf-8",
            env=_git_subprocess_environment(),
            timeout=15,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError):
        _fail("source_revision_unavailable")
    return _source_revision(result.stdout.strip(), "source_revision_unavailable")


def assert_package_source_clean() -> None:
    """Require the committed CRM package to be the source being approved."""

    try:
        result = subprocess.run(
            [
                "git",
                "-c",
                f"safe.directory={REPOSITORY_ROOT}",
                "--no-optional-locks",
                "-C",
                str(REPOSITORY_ROOT),
                "status",
                "--porcelain=v1",
                "--untracked-files=all",
                "--",
                str(PACKAGE_ROOT.relative_to(REPOSITORY_ROOT)),
            ],
            capture_output=True,
            check=True,
            encoding="utf-8",
            env=_git_subprocess_environment(),
            timeout=15,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError, ValueError):
        _fail("source_tree_status_unavailable")
    _require(not result.stdout.strip(), "source_tree_not_committed")
    try:
        hidden = subprocess.run(
            [
                "git",
                "-c",
                f"safe.directory={REPOSITORY_ROOT}",
                "--no-optional-locks",
                "-C",
                str(REPOSITORY_ROOT),
                "ls-files",
                "-v",
                "--",
                str(PACKAGE_ROOT.relative_to(REPOSITORY_ROOT)),
            ],
            capture_output=True,
            check=True,
            encoding="utf-8",
            env=_git_subprocess_environment(),
            timeout=15,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError, ValueError):
        _fail("source_tree_status_unavailable")
    # Lowercase tags are assume-unchanged and S is skip-worktree. Either can
    # hide a modified tracked file from ordinary status output.
    _require(
        not any(
            line and (line[0].islower() or line.startswith("S "))
            for line in hidden.stdout.splitlines()
        ),
        "source_tree_hidden_index_state",
    )


def _attached_worktree_roots() -> tuple[Path, ...]:
    try:
        result = subprocess.run(
            [
                "git",
                "-c",
                f"safe.directory={REPOSITORY_ROOT}",
                "--no-optional-locks",
                "-C",
                str(REPOSITORY_ROOT),
                "worktree",
                "list",
                "--porcelain",
                "-z",
            ],
            capture_output=True,
            check=True,
            encoding="utf-8",
            env=_git_subprocess_environment(),
            timeout=15,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError):
        _fail("git_worktree_inventory_unavailable")
    roots: list[Path] = []
    for field in result.stdout.split("\0"):
        if not field.startswith("worktree "):
            continue
        try:
            roots.append(Path(field[len("worktree ") :]).resolve(strict=True))
        except OSError:
            # A prunable missing worktree cannot contain a supplied existing file.
            continue
    _require(bool(roots), "git_worktree_inventory_unavailable")
    return tuple(roots)


def _is_within(path: Path, parent: Path) -> bool:
    try:
        common = os.path.commonpath(
            (os.path.normcase(str(path)), os.path.normcase(str(parent)))
        )
    except ValueError:
        return False
    return common == os.path.normcase(str(parent))


def assert_private_packet_path(value: str | os.PathLike[str]) -> Path:
    """Reject a private packet/approval inside any attached Git worktree.

    Resolution is strict and follows links, so a temporary symlink into a
    worktree is rejected as well.  Failures never include the supplied path.
    """

    try:
        selected = Path(value).resolve(strict=True)
        stat = selected.stat()
    except (OSError, RuntimeError, TypeError, ValueError):
        _fail("private_file_unavailable")
    _require(selected.is_file(), "private_file_unavailable")
    _require(stat.st_nlink == 1, "private_file_link_count_invalid")
    _require(stat.st_size <= MAX_PRIVATE_FILE_BYTES, "private_file_too_large")
    for root in _attached_worktree_roots():
        _require(not _is_within(selected, root), "private_file_inside_git_worktree")
    return selected


def _validate_bindings(value: Any) -> Mapping[str, Any]:
    bindings = _exact_mapping(value, ["rules"], "bindings_shape_invalid")
    rules = _exact_mapping(
        bindings["rules"], RULE_ORDER, "binding_rules_shape_invalid"
    )
    rule_ids: list[str] = []
    condition_ids: list[str] = []
    for key in RULE_ORDER:
        rule = _exact_mapping(
            rules[key],
            ["ruleId", "conditionId", "actionIds"],
            "binding_rule_shape_invalid",
        )
        rule_ids.append(_identifier(rule["ruleId"], "binding_identifier_invalid"))
        condition_ids.append(
            _identifier(rule["conditionId"], "binding_identifier_invalid")
        )
        expected_roles = [
            role
            for role, _ in (
                *RULE_SPECS[key]["instant"], *RULE_SPECS[key]["scheduled"]
            )
        ]
        actions = _exact_mapping(
            rule["actionIds"], expected_roles, "binding_actions_shape_invalid"
        )
        action_ids = [
            _identifier(actions[role], "binding_identifier_invalid")
            for role in expected_roles
        ]
        # Zoho associative action definitions can be shared by two rules.  They
        # must be unique within one condition, but cross-rule reuse is valid.
        _require(
            len(action_ids) == len(set(action_ids)),
            "binding_action_identifier_collision",
        )
    _require(len(rule_ids) == len(set(rule_ids)), "binding_rule_identifier_collision")
    _require(
        len(condition_ids) == len(set(condition_ids)),
        "binding_condition_identifier_collision",
    )
    return bindings


def _action_rows(
    rule_binding: Mapping[str, Any], specs: Sequence[tuple[str, str]]
) -> list[dict[str, str]]:
    return [
        {
            "role": role,
            "type": action_type,
            "id": rule_binding["actionIds"][role],
        }
        for role, action_type in specs
    ]


def expected_prestate_rules(
    bindings: Mapping[str, Any],
    observed_form2_criteria: Mapping[str, Any],
) -> list[dict[str, Any]]:
    """Render desired criteria and immutable non-authoritative Form2 evidence."""

    rules = bindings["rules"]
    form2_criteria = normalize_observed_form2_criteria(
        observed_form2_criteria
    )
    rendered: list[dict[str, Any]] = []
    for key in RULE_ORDER:
        spec = RULE_SPECS[key]
        rule = rules[key]
        rendered.append(
            {
                "key": key,
                "module": spec["module"],
                "name": spec["name"],
                "ruleId": rule["ruleId"],
                "conditionId": rule["conditionId"],
                "active": spec["active"],
                "triggerType": spec["triggerType"],
                "repeat": False,
                "criteria": (
                    expected_criterion_ast(key)
                    if key in _REVIEWED_CRITERIA
                    else form2_criteria[key]
                ),
                "criteriaAuthority": (
                    "reviewed_desired"
                    if key in _REVIEWED_CRITERIA
                    else "observed_not_authoritative_activation_blocked"
                ),
                "lastExecutionMarkerPresent": spec[
                    "lastExecutionMarkerPresent"
                ],
                "instantActions": _action_rows(rule, spec["instant"]),
                "scheduledActions": _action_rows(rule, spec["scheduled"]),
            }
        )
    return rendered


def _write_call(rule: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "tool": WRITE_TOOL,
        "args": {"body": {"workflow_rules": [rule]}},
    }


def _read_call(rule_id: str) -> dict[str, Any]:
    return {
        "tool": READ_BY_ID_TOOL,
        "args": {"path_variables": {"id": rule_id}},
    }


def _success_acceptance(rule_id: str) -> dict[str, Any]:
    return {
        "singleRuleResult": True,
        "status": "success",
        "code": "SUCCESS",
        "returnedRuleId": rule_id,
    }


def _pre_mutation_exact_rule_readback(
    rule: Mapping[str, Any],
) -> dict[str, Any]:
    expected_rule = json.loads(_canonical_json(rule))
    criteria = normalize_criterion_ast(rule["criteria"])
    _require(
        _canonical_json(criteria) == _canonical_json(rule["criteria"]),
        "internal_criterion_ast_not_normalized",
    )
    return {
        "call": _read_call(rule["ruleId"]),
        "acceptance": {
            "type": "exact_packet_bound_rule",
            "rule": expected_rule,
            "completeRuleRequired": True,
            "ruleDriftAccepted": False,
            "criteriaAssertion": {
                "type": "exact_normalized_criterion_ast",
                "criteria": criteria,
                "completeCriteriaAstRequired": True,
                "criterionDriftAccepted": False,
            },
            "missingTruncatedOrAdditionalDataAccepted": False,
        },
        "mustPassBeforeMutation": True,
    }


def _readback_rule(
    prestate_rule: Mapping[str, Any],
    *,
    active: bool | None = None,
    trigger_type: str | None = None,
    clear_scheduled: bool = False,
) -> dict[str, Any]:
    selected = json.loads(_canonical_json(prestate_rule))
    if active is not None:
        selected["active"] = active
    if trigger_type is not None:
        selected["triggerType"] = trigger_type
    if clear_scheduled:
        selected["scheduledActions"] = []
    return selected


def _operation(
    ordinal: int,
    name: str,
    kind: str,
    calls: Sequence[Mapping[str, Any]],
    acceptance: Mapping[str, Any],
    *,
    pre_mutation_rule: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    mutation_kind = kind in ("mutation", "conditional_mutation")
    _require(
        mutation_kind == (pre_mutation_rule is not None),
        "internal_pre_mutation_gate_invalid",
    )
    return {
        "ordinal": ordinal,
        "name": name,
        "kind": kind,
        "calls": list(calls),
        "acceptance": dict(acceptance),
        "preMutationExactRuleReadback": (
            _pre_mutation_exact_rule_readback(pre_mutation_rule)
            if pre_mutation_rule is not None
            else None
        ),
        "stopOnFailure": True,
        "retry": False,
    }


def _criterion_authority_state() -> dict[str, Any]:
    return {
        "reviewedDesiredRuleKeys": ["leadIntake", "controls", "limits"],
        "observedNotAuthoritativeRuleKeys": [
            "form2Candidate",
            "form2Superseded",
        ],
        "form2DesiredCriterionContractPresent": False,
        "form2ActivationAuthorized": False,
        "status": "blocked_observed_not_authoritative",
    }


def expected_operations(
    bindings: Mapping[str, Any],
    observed_form2_criteria: Mapping[str, Any],
) -> list[dict[str, Any]]:
    """Render containment first, then the three desired-criteria repairs."""

    rules = bindings["rules"]
    prestate_by_key = {
        row["key"]: row
        for row in expected_prestate_rules(bindings, observed_form2_criteria)
    }
    lead = rules["leadIntake"]
    controls = rules["controls"]
    limits = rules["limits"]
    candidate = rules["form2Candidate"]
    superseded = rules["form2Superseded"]

    after_deactivation = json.loads(
        _canonical_json([prestate_by_key[key] for key in RULE_ORDER])
    )
    after_deactivation[4]["active"] = False
    after_deactivation_by_key = {
        row["key"]: row for row in after_deactivation
    }

    final_rules = [
        _readback_rule(
            after_deactivation_by_key["leadIntake"],
            trigger_type="create",
            clear_scheduled=True,
        ),
        _readback_rule(
            after_deactivation_by_key["controls"], trigger_type="create"
        ),
        _readback_rule(
            after_deactivation_by_key["limits"], trigger_type="create"
        ),
        after_deactivation_by_key["form2Candidate"],
        after_deactivation_by_key["form2Superseded"],
    ]
    all_rule_reads = [_read_call(rules[key]["ruleId"]) for key in RULE_ORDER]
    form2_reads = [
        _read_call(candidate["ruleId"]),
        _read_call(superseded["ruleId"]),
    ]
    inventory_call = {
        "tool": INVENTORY_TOOL,
        "args": {
            "query_params": {
                "module": "Deals",
                "include_inner_details": True,
                "page": 1,
                "per_page": 200,
            }
        },
    }

    return [
        _operation(
            1,
            "pre_mutation_exact_rule_and_criteria_readback_gate",
            "readback_gate",
            all_rule_reads,
            {
                "type": "exact_rule_set",
                "rules": [prestate_by_key[key] for key in RULE_ORDER],
                "allCriteriaExactlyMatchPacketBoundAst": True,
                "candidateInactive": True,
                "supersededActive": True,
                "criteriaAuthority": _criterion_authority_state(),
                "missingTruncatedOrAdditionalDataAccepted": False,
            },
        ),
        _operation(
            2,
            "deactivate_superseded_form2_rule_for_containment",
            "mutation",
            [
                _write_call(
                    {
                        "id": superseded["ruleId"],
                        "status": {
                            "active": False,
                            "delete_schedule_action": False,
                        },
                    }
                )
            ],
            _success_acceptance(superseded["ruleId"]),
            pre_mutation_rule=prestate_by_key["form2Superseded"],
        ),
        _operation(
            3,
            "both_form2_rules_inactive_exact_readback_gate",
            "readback_gate",
            form2_reads,
            {
                "type": "exact_rule_set",
                "rules": [after_deactivation[3], after_deactivation[4]],
                "bothForm2RulesInactive": True,
                "allCriteriaExactlyMatchPacketBoundAst": True,
                "criteriaAuthority": _criterion_authority_state(),
                "missingTruncatedOrAdditionalDataAccepted": False,
            },
        ),
        _operation(
            4,
            "make_lead_intake_create_only_and_delete_follow_up",
            "mutation",
            [
                _write_call(
                    {
                        "id": lead["ruleId"],
                        "execute_when": {"type": "create"},
                        "conditions": [
                            {
                                "id": lead["conditionId"],
                                "scheduled_actions": [
                                    {
                                        "execute_after": {
                                            "period": "b_days",
                                            "unit": 1,
                                        },
                                        "actions": [
                                            {
                                                "id": lead["actionIds"][
                                                    "followUpTask"
                                                ],
                                                "type": "tasks",
                                                "_delete": None,
                                            }
                                        ],
                                    }
                                ],
                            }
                        ],
                    }
                )
            ],
            _success_acceptance(lead["ruleId"]),
            pre_mutation_rule=after_deactivation_by_key["leadIntake"],
        ),
        _operation(
            5,
            "make_controls_create_only",
            "mutation",
            [
                _write_call(
                    {
                        "id": controls["ruleId"],
                        "execute_when": {"type": "create"},
                    }
                )
            ],
            _success_acceptance(controls["ruleId"]),
            pre_mutation_rule=after_deactivation_by_key["controls"],
        ),
        _operation(
            6,
            "make_limits_create_only",
            "mutation",
            [
                _write_call(
                    {
                        "id": limits["ruleId"],
                        "execute_when": {"type": "create"},
                    }
                )
            ],
            _success_acceptance(limits["ruleId"]),
            pre_mutation_rule=after_deactivation_by_key["limits"],
        ),
        _operation(
            7,
            "final_exact_rule_set_and_both_form2_inactive_readback_gate",
            "readback_gate",
            [*all_rule_reads, inventory_call],
            {
                "type": "exact_rule_set_and_complete_deals_inventory",
                "rules": final_rules,
                "bothForm2RulesInactive": True,
                "allCriteriaExactlyMatchPacketBoundAst": True,
                "criteriaAuthority": _criterion_authority_state(),
                "candidateMutationPerformed": False,
                "supersededMutationScope": "status_false_only",
                "inventory": {
                    "paginationComplete": True,
                    "candidateObservedNameMatchCount": 1,
                    "candidateActiveCount": 0,
                    "supersededObservedNameMatchCount": 1,
                    "supersededActiveCount": 0,
                    "logicalForm2ActiveCount": 0,
                    "form2DesiredCriteriaAuthorityPresent": False,
                },
                "missingTruncatedOrAdditionalDataAccepted": False,
            },
        ),
    ]


def expected_failure_containment(
    bindings: Mapping[str, Any],
    observed_form2_criteria: Mapping[str, Any],
) -> dict[str, Any]:
    """Render the read-only stop path after the only Form2 mutation."""

    candidate = bindings["rules"]["form2Candidate"]
    superseded = bindings["rules"]["form2Superseded"]
    prestate_by_key = {
        row["key"]: row
        for row in expected_prestate_rules(bindings, observed_form2_criteria)
    }
    inactive_candidate = prestate_by_key["form2Candidate"]
    inactive_superseded = _readback_rule(
        prestate_by_key["form2Superseded"], active=False
    )
    return {
        "trigger": "failure_at_or_after_superseded_deactivation",
        "operations": [
            _operation(
                1,
                "confirm_both_form2_rules_inactive_without_retry",
                "conditional_readback_gate",
                [
                    _read_call(candidate["ruleId"]),
                    _read_call(superseded["ruleId"]),
                ],
                {
                    "type": "exact_rule_set",
                    "rules": [inactive_candidate, inactive_superseded],
                    "bothForm2RulesInactive": True,
                    "allCriteriaExactlyMatchPacketBoundAst": True,
                    "criteriaAuthority": _criterion_authority_state(),
                    "missingTruncatedOrAdditionalDataAccepted": False,
                },
            ),
        ],
        "terminalState": {
            "canonicalCandidateActive": False,
            "supersededRuleActive": False,
        },
        "neverReactivateSupersededRule": True,
        "neverActivateEitherForm2Rule": True,
        "candidateMutationAuthorized": False,
        "retrySupersededDeactivationAuthorized": False,
        "onAmbiguousContainment": (
            "stop_and_require_manual_independent_readback_without_"
            "activating_either_form2_rule_or_retrying_mutation"
        ),
    }


def _validate_capability(
    value: Any, target_organization_id: str, now_ms: int
) -> tuple[int, int]:
    capability = _exact_mapping(
        value,
        [
            "schemaVersion",
            "capturedAt",
            "expiresAt",
            "environment",
            "organizationId",
            "source",
            "effectiveTenantReadAccessProven",
            "effectiveTenantWriteAccessProven",
            "privateEvidenceSha256",
            "toolContractSha256",
        ],
        "capability_shape_invalid",
    )
    _require(capability["schemaVersion"] == 1, "capability_schema_invalid")
    _require(
        capability["environment"] == "Development"
        and capability["organizationId"] == target_organization_id
        and capability["source"]
        == "installed_sylvara_connectors_and_official_zoho_crm_v8_contract"
        and capability["effectiveTenantReadAccessProven"] is True
        and capability["effectiveTenantWriteAccessProven"] is True,
        "capability_boundary_invalid",
    )
    _identifier(capability["organizationId"], "capability_boundary_invalid")
    _sha256(capability["privateEvidenceSha256"], "capability_evidence_invalid")
    _require(
        _digests_equal(
            capability["toolContractSha256"], expected_tool_contract_digest()
        ),
        "capability_tool_contract_invalid",
    )
    return _validate_window(capability, "capability", now_ms)


def _validate_prestate(
    value: Any,
    target_organization_id: str,
    bindings: Mapping[str, Any],
    now_ms: int,
) -> tuple[tuple[int, int], dict[str, dict[str, Any]]]:
    prestate = _exact_mapping(
        value,
        [
            "schemaVersion",
            "capturedAt",
            "expiresAt",
            "organizationId",
            "organizationMatchCount",
            "paginationComplete",
            "privateEvidenceSha256",
            "form2",
            "workflowRules",
        ],
        "prestate_shape_invalid",
    )
    _require(prestate["schemaVersion"] == 1, "prestate_schema_invalid")
    _require(
        prestate["organizationId"] == target_organization_id
        and prestate["organizationMatchCount"] == 1
        and prestate["paginationComplete"] is True,
        "prestate_target_invalid",
    )
    _identifier(prestate["organizationId"], "prestate_target_invalid")
    _sha256(prestate["privateEvidenceSha256"], "prestate_evidence_invalid")
    form2 = _exact_mapping(
        prestate["form2"],
        [
            "publicFormDisabled",
            "submissionWebhookDisabled",
            "submissionCount",
            "privateEvidenceSha256",
        ],
        "prestate_form2_shape_invalid",
    )
    _require(
        form2["publicFormDisabled"] is True
        and form2["submissionWebhookDisabled"] is True
        and form2["submissionCount"] == 0,
        "prestate_form2_not_contained",
    )
    _sha256(form2["privateEvidenceSha256"], "prestate_form2_evidence_invalid")
    workflow_rules = prestate["workflowRules"]
    _require(
        isinstance(workflow_rules, list)
        and len(workflow_rules) == len(RULE_ORDER),
        "prestate_workflow_drift",
    )
    rules_by_key: dict[str, Mapping[str, Any]] = {}
    for rule in workflow_rules:
        selected_rule = _plain_mapping(rule, "prestate_workflow_drift")
        key = selected_rule.get("key")
        _require(
            isinstance(key, str)
            and key in RULE_ORDER
            and key not in rules_by_key,
            "prestate_workflow_drift",
        )
        rules_by_key[key] = selected_rule
        normalized_criteria = normalize_criterion_ast(
            selected_rule.get("criteria")
        )
        _require(
            _canonical_json(selected_rule.get("criteria"))
            == _canonical_json(normalized_criteria),
            "prestate_criterion_ast_not_normalized",
        )
        if key in _REVIEWED_CRITERIA:
            _require(
                selected_rule.get("criteriaAuthority") == "reviewed_desired"
                and _canonical_json(normalized_criteria)
                == _canonical_json(expected_criterion_ast(key)),
                "prestate_reviewed_criterion_drift",
            )
        else:
            _require(
                selected_rule.get("criteriaAuthority")
                == "observed_not_authoritative_activation_blocked",
                "prestate_form2_criterion_authority_invalid",
            )
    _require(tuple(rules_by_key) == RULE_ORDER, "prestate_workflow_drift")
    observed_form2_criteria = normalize_observed_form2_criteria(
        {
            key: rules_by_key[key]["criteria"]
            for key in ("form2Candidate", "form2Superseded")
        }
    )
    _require(
        _canonical_json(workflow_rules)
        == _canonical_json(
            expected_prestate_rules(bindings, observed_form2_criteria)
        ),
        "prestate_workflow_drift",
    )
    return (
        _validate_window(prestate, "prestate", now_ms),
        observed_form2_criteria,
    )


def _validate_approval(
    approval_value: Any,
    packet: Mapping[str, Any],
    packet_digest: str,
    prestate_window: tuple[int, int],
    capability_window: tuple[int, int],
    now_ms: int,
) -> None:
    approval = _exact_mapping(
        approval_value,
        [
            "schemaVersion",
            "capturedAt",
            "expiresAt",
            "approvedSourceRevision",
            "targetOrganizationId",
            "prestateEvidenceSha256",
            "capabilityAttestationSha256",
            "packetSha256",
            "operationAuthorizationId",
            "workflowMutationAuthorized",
            "containmentAuthorized",
            "authorizedMainOperationCount",
            "authorizedConditionalContainmentOperationCount",
            "maximumAuthorizedMutationCallCount",
            "singleUse",
            "durableConsumptionRequired",
            "retryAuthorized",
            "form2DisabledAndZeroSubmissionsRequired",
            "productionAuthorized",
        ],
        "approval_shape_invalid",
    )
    _require(approval["schemaVersion"] == 1, "approval_schema_invalid")
    approval_window = _validate_window(approval, "approval", now_ms)
    _require(
        approval_window[0] >= prestate_window[0]
        and approval_window[1] <= prestate_window[1]
        and approval_window[0] >= capability_window[0]
        and approval_window[1] <= capability_window[1],
        "approval_window_outside_evidence",
    )
    _require(
        approval["approvedSourceRevision"] == packet["approvedSourceRevision"]
        and approval["operationAuthorizationId"]
        == packet["operationAuthorizationId"]
        and approval["targetOrganizationId"]
        == packet["target"]["organizationId"]
        and approval["prestateEvidenceSha256"]
        == packet["prestate"]["privateEvidenceSha256"]
        and _digests_equal(
            approval["capabilityAttestationSha256"],
            digest_capability_attestation(packet["capabilityAttestation"]),
        )
        and _digests_equal(approval["packetSha256"], packet_digest),
        "approval_binding_invalid",
    )
    _require(
        approval["workflowMutationAuthorized"] is True
        and approval["containmentAuthorized"] is True
        and approval["authorizedMainOperationCount"] == 7
        and approval["authorizedConditionalContainmentOperationCount"] == 1
        and approval["maximumAuthorizedMutationCallCount"] == 4
        and approval["singleUse"] is True
        and approval["durableConsumptionRequired"] is True
        and approval["retryAuthorized"] is False
        and approval["form2DisabledAndZeroSubmissionsRequired"] is True
        and approval["productionAuthorized"] is False,
        "approval_authority_invalid",
    )


def validate_workflow_repair_packet(
    packet_value: Any,
    approval_value: Any,
    now_ms: int | None = None,
    current_source_revision: str | None = None,
) -> WorkflowRepairValidationResult:
    """Validate one exact packet without performing or calling any mutation."""

    if now_ms is None:
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    _require(
        isinstance(now_ms, int) and not isinstance(now_ms, bool),
        "validation_time_invalid",
    )
    packet = _exact_mapping(
        packet_value,
        [
            "schemaVersion",
            "environment",
            "productionAuthorized",
            "approvedSourceRevision",
            "operationAuthorizationId",
            "target",
            "capabilityAttestation",
            "prestate",
            "bindings",
            "operations",
            "failureContainment",
            "forbiddenActions",
            "executionPolicy",
        ],
        "packet_shape_invalid",
    )
    _require(packet["schemaVersion"] == 1, "packet_schema_invalid")
    _require(
        packet["environment"] == "Development"
        and packet["productionAuthorized"] is False,
        "packet_environment_invalid",
    )
    approved_revision = _source_revision(
        packet["approvedSourceRevision"], "packet_source_revision_invalid"
    )
    observed_revision = (
        repository_source_revision()
        if current_source_revision is None
        else _source_revision(
            current_source_revision, "source_revision_unavailable"
        )
    )
    _require(
        hmac.compare_digest(approved_revision, observed_revision),
        "packet_source_revision_drift",
    )
    operation_authorization_id = _authority_id(
        packet["operationAuthorizationId"],
        "packet_operation_authorization_invalid",
    )
    target = _exact_mapping(
        packet["target"], ["organizationId"], "target_shape_invalid"
    )
    organization_id = _identifier(
        target["organizationId"], "target_organization_invalid"
    )
    bindings = _validate_bindings(packet["bindings"])
    capability_window = _validate_capability(
        packet["capabilityAttestation"], organization_id, now_ms
    )
    prestate_window, observed_form2_criteria = _validate_prestate(
        packet["prestate"], organization_id, bindings, now_ms
    )
    _require(
        _canonical_json(packet["operations"])
        == _canonical_json(
            expected_operations(bindings, observed_form2_criteria)
        ),
        "packet_operations_drift",
    )
    _require(
        _canonical_json(packet["failureContainment"])
        == _canonical_json(
            expected_failure_containment(bindings, observed_form2_criteria)
        ),
        "packet_containment_drift",
    )
    _require(
        packet["forbiddenActions"] == list(FORBIDDEN_ACTIONS),
        "packet_forbidden_actions_drift",
    )
    _require(
        _canonical_json(packet["executionPolicy"])
        == _canonical_json(EXECUTION_POLICY),
        "packet_execution_policy_drift",
    )
    packet_digest = digest_workflow_repair_packet(packet)
    _validate_approval(
        approval_value,
        packet,
        packet_digest,
        prestate_window,
        capability_window,
        now_ms,
    )
    return WorkflowRepairValidationResult(
        digest=packet_digest,
        consumption_digest=packet_digest,
        authority_id=operation_authorization_id,
    )


__all__ = [
    "CAPABILITY_DIGEST_DOMAIN",
    "EMPTY_CRITERION_VALUE",
    "ENTRY_OFFER_VALUE",
    "EXECUTION_POLICY",
    "FORBIDDEN_ACTIONS",
    "INVENTORY_TOOL",
    "MAX_PRIVATE_FILE_BYTES",
    "MAX_START_WINDOW_SECONDS",
    "OFFICIAL_UPDATE_CONTRACT",
    "PACKET_DIGEST_DOMAIN",
    "PACKAGE_ROOT",
    "READ_BY_ID_TOOL",
    "REPOSITORY_ROOT",
    "RULE_ORDER",
    "RULE_SPECS",
    "SUPERSEDED_FORM2_RULE_NAME",
    "TOOL_CONTRACT",
    "WRITE_TOOL",
    "WorkflowRepairPacketValidationError",
    "WorkflowRepairValidationResult",
    "assert_package_source_clean",
    "assert_private_packet_path",
    "digest_capability_attestation",
    "digest_workflow_repair_packet",
    "expected_failure_containment",
    "expected_criterion_ast",
    "expected_criterion_asts",
    "expected_operations",
    "expected_prestate_rules",
    "expected_tool_contract_digest",
    "repository_source_revision",
    "normalize_criterion_ast",
    "normalize_observed_form2_criteria",
    "validate_workflow_repair_packet",
]
