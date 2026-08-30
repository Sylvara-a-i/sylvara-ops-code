"""Fail-closed validation for one private Development CRM workflow repair packet.

This module performs no network or CRM operation.  It validates a private packet
whose values stay outside every Git worktree, and returns only a sanitized
summary.  The packet digest is exactly::

    SHA-256(
        UTF-8("sylvara.crm.workflow-trigger-repair-packet.v3")
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
SCHEMA_VERSION = 3
CLAIM_NAMESPACE = "crm-workflow-trigger-repair-v3"

PACKET_DIGEST_DOMAIN = "sylvara.crm.workflow-trigger-repair-packet.v3"
CAPABILITY_DIGEST_DOMAIN = (
    "sylvara.crm.workflow-trigger-repair-capability.v3"
)
TOOL_CONTRACT_DIGEST_DOMAIN = (
    "sylvara.crm.workflow-trigger-repair-tool-contract.v3"
)

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
FIELD_UPDATE_BY_ID_TOOL = (
    "mcp__codex_apps__sylvara_crm_audit_"
    "zohocrm_getfieldupdatebyid"
)
WORKFLOW_TASK_INVENTORY_TOOL = (
    "mcp__codex_apps__sylvara_crm_audit_"
    "zohocrm_getworkflowtasks"
)
OFFICIAL_UPDATE_CONTRACT = (
    "https://www.zoho.com/crm/developer/docs/api/v8/update-workflow.html"
)

SUPERSEDED_FORM2_RULE_NAME = "Deals Free Test Form 2 Submitted"
OBSERVED_FORM2_RULE_NAME = "Deals Form 2 Controller Proof Candidate"
CANONICAL_FORM2_RULE_NAME = (
    "Deals Revenue Leak Test Setup Form Proof Candidate"
)
FORM2_TASK_SUBJECT = (
    "Review Form 2 Setup and Begin QA — ${Deals.Deal Name}"
)
FORM2_TASK_DESCRIPTION = (
    "Trusted Form 2 controller proof was verified for ${Deals.Deal Name}. "
    "Review the submitted evidence, configure the approved route and "
    "fallback/rollback contacts, and complete QA for the exact configuration "
    "version. Do not activate routing; Test Live still requires separate "
    "internal Go-Live Approval Status = Approved."
)
FORM2_TASK_DESCRIPTION_SHA256 = hashlib.sha256(
    FORM2_TASK_DESCRIPTION.encode("utf-8")
).hexdigest()
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
_FORM2_CANDIDATE_CRITERIA = _criterion_group(
    "AND",
    _criterion("Entry_Offer", "equal", ENTRY_OFFER_VALUE),
    _criterion("Setup_Access_Status", "equal", "Submitted"),
    _criterion("Setup_Form_Submission_ID", "not_equal", EMPTY_CRITERION_VALUE),
    _criterion("Setup_Form_Submitted_At", "not_equal", EMPTY_CRITERION_VALUE),
    _criterion("Setup_Form_Version", "not_equal", EMPTY_CRITERION_VALUE),
    _criterion("Authorized_Representative_Confirmed", "equal", True),
    _criterion("Authority_Confirmed_At", "not_equal", EMPTY_CRITERION_VALUE),
    _criterion("Test_Scope_Accepted", "equal", True),
    _criterion("Test_Scope_Accepted_At", "not_equal", EMPTY_CRITERION_VALUE),
    _criterion("Test_Scope_Version", "not_equal", EMPTY_CRITERION_VALUE),
    _criterion_group(
        "OR",
        _criterion("Go_Live_Approval_Status", "equal", "Not Ready"),
        _criterion(
            "Go_Live_Approval_Status",
            "equal",
            "Pending Internal Approval",
        ),
    ),
)
_REVIEWED_CRITERIA = {
    "leadIntake": _LEAD_CRITERIA,
    "controls": _INITIALIZER_CRITERIA,
    "limits": _INITIALIZER_CRITERIA,
    "form2Candidate": _FORM2_CANDIDATE_CRITERIA,
}
_PRESTATE_REVIEWED_CRITERIA_KEYS = frozenset(
    {"leadIntake", "controls", "limits"}
)
_FORM2_CRITERION_API_NAMES = tuple(
    sorted(
        {
            "Entry_Offer",
            "Setup_Access_Status",
            "Setup_Form_Submission_ID",
            "Setup_Form_Submitted_At",
            "Setup_Form_Version",
            "Authorized_Representative_Confirmed",
            "Authority_Confirmed_At",
            "Test_Scope_Accepted",
            "Test_Scope_Accepted_At",
            "Test_Scope_Version",
            "Go_Live_Approval_Status",
        }
    )
)

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
        "name": OBSERVED_FORM2_RULE_NAME,
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
        "active": False,
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
    "schemaVersion": SCHEMA_VERSION,
    "officialApiVersion": "v8",
    "officialUpdateContract": OFFICIAL_UPDATE_CONTRACT,
    "oneWorkflowRulePerUpdateRequest": True,
    "partialUpdateSupported": True,
    "writeTool": WRITE_TOOL,
    "readByIdTool": READ_BY_ID_TOOL,
    "inventoryTool": INVENTORY_TOOL,
    "fieldUpdateByIdTool": FIELD_UPDATE_BY_ID_TOOL,
    "workflowTaskInventoryTool": WORKFLOW_TASK_INVENTORY_TOOL,
    "actionDefinitionNormalization": {
        "fieldUpdate": [
            "id",
            "moduleApiName",
            "featureType",
            "fieldApiName",
            "definitionType",
            "value",
        ],
        "workflowTask": [
            "id",
            "moduleApiName",
            "featureType",
            "subject",
            "dueDays",
            "priority",
            "status",
            "ownerId",
            "ownerInternal",
            "notifyAssignee",
            "recordAssociation",
            "descriptionSha256",
        ],
    },
    "workflowTaskInventoryQuery": {
        "module": "Deals",
        "page": 1,
        "per_page": 200,
        "nameFilterAuthorized": False,
    },
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
    "postMutationIndependentReadbackRequired": True,
    "failureReconciliationAllRulesRequired": True,
    "partialTriggerProgressionAccepted": "monotonic_prefix_only",
    "criterionDriftAccepted": False,
    "finalCriteriaReadbackRequired": True,
    "form2CriterionAuthority": "reviewed_desired",
    "form2CandidateMutationAuthorized": True,
    "form2ActivationAuthorized": True,
    "form2MutationAuthorized": True,
    "scheduledActionMutationOrDeletionAuthorized": False,
    "form2InactiveEditAndReadbackRequiredBeforeActivation": True,
    "form2UnsafeFieldUpdateDeletionAuthorized": True,
    "form2AmbiguousActivationMustBeDeactivated": True,
    "form2SubmissionsMustRemainZero": True,
    "independentActionDefinitionReadbackRequired": True,
    "taskInventoryMustBeComplete": True,
    "taskIdMatchCountMustEqualOne": True,
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
_SCHEDULE_PERIODS = frozenset(
    {
        "business_hours",
        "hours",
        "business_days",
        "days",
        "minutes",
        "weeks",
        "months",
        "years",
    }
)
_MAX_PROVIDER_INTEGER = 2_147_483_647


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
    main_operation_count: int = 11
    main_mutation_call_count: int = 5
    conditional_containment_operation_count: int = 3
    maximum_mutation_call_count: int = 6
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


def _positive_provider_integer(value: Any, code: str) -> int:
    _require(
        isinstance(value, int)
        and not isinstance(value, bool)
        and 1 <= value <= _MAX_PROVIDER_INTEGER,
        code,
    )
    return value


def _exact_integer(value: Any, expected: int, code: str) -> int:
    """Require an exact JSON integer, excluding bools and numeric floats."""

    _require(
        isinstance(value, int)
        and not isinstance(value, bool)
        and value == expected,
        code,
    )
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


def _validate_form2_action_semantics(value: Any) -> Mapping[str, Any]:
    semantics = _exact_mapping(
        value,
        [
            "setupAccessSubmitted",
            "setupAndQaTask",
            "authorizationSigned",
            "testStatusSetupPending",
        ],
        "binding_form2_action_semantics_shape_invalid",
    )
    setup = _exact_mapping(
        semantics["setupAccessSubmitted"],
        ["type", "apiName", "value"],
        "binding_form2_setup_action_invalid",
    )
    _require(
        setup
        == {
            "type": "field_update",
            "apiName": "Setup_Access_Status",
            "value": "Submitted",
        },
        "binding_form2_setup_action_invalid",
    )
    authorization = _exact_mapping(
        semantics["authorizationSigned"],
        ["type", "apiName", "value"],
        "binding_form2_authorization_action_invalid",
    )
    _require(
        authorization
        == {
            "type": "field_update",
            "apiName": "Free_Test_Authorization_Status",
            "value": "Signed",
        },
        "binding_form2_authorization_action_invalid",
    )
    test_status = _exact_mapping(
        semantics["testStatusSetupPending"],
        ["type", "apiName", "value"],
        "binding_form2_test_status_action_invalid",
    )
    _require(
        test_status
        == {
            "type": "field_update",
            "apiName": "Test_Status",
            "value": "Setup Pending",
        },
        "binding_form2_test_status_action_invalid",
    )
    task = _exact_mapping(
        semantics["setupAndQaTask"],
        [
            "type",
            "subject",
            "dueDays",
            "priority",
            "status",
            "ownerId",
            "ownerInternal",
            "notifyAssignee",
            "recordAssociation",
            "descriptionSha256",
        ],
        "binding_form2_task_action_invalid",
    )
    _require(
        task["type"] == "task"
        and task["subject"] == FORM2_TASK_SUBJECT
        and isinstance(task["dueDays"], int)
        and not isinstance(task["dueDays"], bool)
        and task["dueDays"] == 0
        and task["priority"] == "High"
        and task["status"] == "Not Started"
        and task["ownerInternal"] is True
        and task["notifyAssignee"] is False
        and task["recordAssociation"] == "current_deal",
        "binding_form2_task_action_invalid",
    )
    _identifier(task["ownerId"], "binding_form2_task_owner_invalid")
    _require(
        _sha256(
            task["descriptionSha256"],
            "binding_form2_task_description_invalid",
        )
        == FORM2_TASK_DESCRIPTION_SHA256,
        "binding_form2_task_description_invalid",
    )
    return semantics


def _validate_bindings(value: Any) -> Mapping[str, Any]:
    bindings = _exact_mapping(
        value,
        [
            "rules",
            "form2CandidateActionSemantics",
            "form2CriterionFieldIds",
        ],
        "bindings_shape_invalid",
    )
    _validate_form2_action_semantics(
        bindings["form2CandidateActionSemantics"]
    )
    field_ids = _exact_mapping(
        bindings["form2CriterionFieldIds"],
        _FORM2_CRITERION_API_NAMES,
        "binding_form2_criterion_field_ids_invalid",
    )
    normalized_field_ids = [
        _identifier(
            field_ids[api_name],
            "binding_form2_criterion_field_ids_invalid",
        )
        for api_name in _FORM2_CRITERION_API_NAMES
    ]
    _require(
        len(normalized_field_ids) == len(set(normalized_field_ids)),
        "binding_form2_criterion_field_ids_invalid",
    )
    rules = _exact_mapping(
        bindings["rules"], RULE_ORDER, "binding_rules_shape_invalid"
    )
    rule_ids: list[str] = []
    condition_ids: list[str] = []
    for key in RULE_ORDER:
        rule = _exact_mapping(
            rules[key],
            [
                "ruleId",
                "conditionId",
                "conditionSequenceNumber",
                "actionIds",
                "scheduledActionTiming",
            ],
            "binding_rule_shape_invalid",
        )
        rule_ids.append(_identifier(rule["ruleId"], "binding_identifier_invalid"))
        condition_ids.append(
            _identifier(rule["conditionId"], "binding_identifier_invalid")
        )
        _require(
            _positive_provider_integer(
                rule["conditionSequenceNumber"],
                "binding_condition_sequence_invalid",
            )
            == 1,
            "binding_condition_sequence_invalid",
        )
        scheduled_roles = [role for role, _ in RULE_SPECS[key]["scheduled"]]
        scheduled_timing = _exact_mapping(
            rule["scheduledActionTiming"],
            scheduled_roles,
            "binding_scheduled_timing_shape_invalid",
        )
        for role in scheduled_roles:
            timing = _exact_mapping(
                scheduled_timing[role],
                ["period", "unit"],
                "binding_scheduled_timing_shape_invalid",
            )
            _require(
                isinstance(timing["period"], str)
                and timing["period"] in _SCHEDULE_PERIODS,
                "binding_scheduled_period_invalid",
            )
            _positive_provider_integer(
                timing["unit"], "binding_scheduled_unit_invalid"
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
    rule_binding: Mapping[str, Any],
    specs: Sequence[tuple[str, str]],
    action_semantics: Mapping[str, Any] | None = None,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for role, action_type in specs:
        row: dict[str, Any] = {
            "role": role,
            "type": action_type,
            "id": rule_binding["actionIds"][role],
        }
        if action_semantics is not None:
            row["semantics"] = json.loads(
                _canonical_json(action_semantics[role])
            )
        rows.append(row)
    return rows


def _scheduled_action_rows(
    rule_binding: Mapping[str, Any], specs: Sequence[tuple[str, str]]
) -> list[dict[str, Any]]:
    return [
        {
            "role": role,
            "type": action_type,
            "id": rule_binding["actionIds"][role],
            "executeAfter": {
                "period": rule_binding["scheduledActionTiming"][role]["period"],
                "unit": rule_binding["scheduledActionTiming"][role]["unit"],
            },
        }
        for role, action_type in specs
    ]


def expected_prestate_rules(
    bindings: Mapping[str, Any],
    observed_form2_criteria: Mapping[str, Any],
) -> list[dict[str, Any]]:
    """Render exact prestate, including the contained Form2 repair source."""

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
                "conditionSequenceNumber": rule["conditionSequenceNumber"],
                "active": spec["active"],
                "triggerType": spec["triggerType"],
                "repeat": False,
                "criteria": (
                    expected_criterion_ast(key)
                    if key in _PRESTATE_REVIEWED_CRITERIA_KEYS
                    else form2_criteria[key]
                ),
                "criteriaAuthority": (
                    "reviewed_desired"
                    if key in _PRESTATE_REVIEWED_CRITERIA_KEYS
                    else (
                        "observed_repair_source_desired_committed"
                        if key == "form2Candidate"
                        else "observed_not_authoritative_inactive"
                    )
                ),
                "lastExecutionMarkerPresent": spec[
                    "lastExecutionMarkerPresent"
                ],
                "instantActions": _action_rows(
                    rule,
                    spec["instant"],
                    (
                        bindings["form2CandidateActionSemantics"]
                        if key == "form2Candidate"
                        else None
                    ),
                ),
                "scheduledActions": _scheduled_action_rows(
                    rule, spec["scheduled"]
                ),
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


def _field_update_definition_read_call(action_id: str) -> dict[str, Any]:
    return {
        "tool": FIELD_UPDATE_BY_ID_TOOL,
        "args": {"path_variables": {"id": action_id}},
    }


def _workflow_task_inventory_call() -> dict[str, Any]:
    # The connector's name filter is not a reliable read boundary. A complete,
    # unfiltered Deals inventory is small and lets the executor prove one exact
    # private task ID rather than trusting a name search.
    return {
        "tool": WORKFLOW_TASK_INVENTORY_TOOL,
        "args": {
            "query_params": {
                "module": "Deals",
                "page": 1,
                "per_page": 200,
            }
        },
    }


def _normalized_form2_field_update_definition(
    bindings: Mapping[str, Any], role: str
) -> dict[str, Any]:
    semantics = bindings["form2CandidateActionSemantics"][role]
    return {
        "id": bindings["rules"]["form2Candidate"]["actionIds"][role],
        "moduleApiName": "Deals",
        "featureType": "workflow",
        "fieldApiName": semantics["apiName"],
        "definitionType": "static",
        "value": semantics["value"],
    }


def _normalized_form2_task_definition(
    bindings: Mapping[str, Any], role: str
) -> dict[str, Any]:
    semantics = bindings["form2CandidateActionSemantics"][role]
    return {
        "id": bindings["rules"]["form2Candidate"]["actionIds"][role],
        "moduleApiName": "Deals",
        "featureType": "workflow",
        "subject": semantics["subject"],
        "dueDays": semantics["dueDays"],
        "priority": semantics["priority"],
        "status": semantics["status"],
        "ownerId": semantics["ownerId"],
        "ownerInternal": semantics["ownerInternal"],
        "notifyAssignee": semantics["notifyAssignee"],
        "recordAssociation": semantics["recordAssociation"],
        "descriptionSha256": semantics["descriptionSha256"],
    }


def _independent_form2_action_definition_gate(
    bindings: Mapping[str, Any], roles: Sequence[str]
) -> dict[str, Any]:
    _require(
        bool(roles)
        and len(roles) == len(set(roles))
        and set(roles).issubset(
            {
                "setupAccessSubmitted",
                "setupAndQaTask",
                "authorizationSigned",
                "testStatusSetupPending",
            }
        ),
        "internal_form2_action_definition_roles_invalid",
    )
    reads: list[dict[str, Any]] = []
    for role in roles:
        action_id = bindings["rules"]["form2Candidate"]["actionIds"][role]
        if role == "setupAndQaTask":
            reads.append(
                {
                    "role": role,
                    "definitionType": "workflow_task_inventory_match",
                    "call": _workflow_task_inventory_call(),
                    "acceptance": {
                        "paginationComplete": True,
                        "infoMoreRecords": False,
                        "exactTaskId": action_id,
                        "exactTaskIdMatchCount": 1,
                        "normalizedDefinition": (
                            _normalized_form2_task_definition(bindings, role)
                        ),
                        "additionalTaskDefinitionsAccepted": True,
                        "missingTruncatedOrDuplicateTargetAccepted": False,
                    },
                }
            )
            continue
        reads.append(
            {
                "role": role,
                "definitionType": "field_update_by_id",
                "call": _field_update_definition_read_call(action_id),
                "acceptance": {
                    "singleDefinitionResult": True,
                    "returnedActionId": action_id,
                    "normalizedDefinition": (
                        _normalized_form2_field_update_definition(
                            bindings, role
                        )
                    ),
                    "missingTruncatedOrAdditionalDataAccepted": False,
                },
            }
        )
    return {
        "type": "exact_independent_form2_action_definition_set",
        "requiredRoleOrder": list(roles),
        "normalizationContract": TOOL_CONTRACT[
            "actionDefinitionNormalization"
        ],
        "reads": reads,
        "allDefinitionsMustMatchBeforeContinuing": True,
        "workflowRuleActionReferenceAloneAccepted": False,
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
    independent_action_definition_gate: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    expected_rule = json.loads(_canonical_json(rule))
    criteria = normalize_criterion_ast(rule["criteria"])
    _require(
        _canonical_json(criteria) == _canonical_json(rule["criteria"]),
        "internal_criterion_ast_not_normalized",
    )
    gate = {
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
    if independent_action_definition_gate is not None:
        gate["independentActionDefinitionGate"] = json.loads(
            _canonical_json(independent_action_definition_gate)
        )
    return gate


def _readback_rule(
    prestate_rule: Mapping[str, Any],
    *,
    trigger_type: str | None = None,
) -> dict[str, Any]:
    selected = json.loads(_canonical_json(prestate_rule))
    if trigger_type is not None:
        selected["triggerType"] = trigger_type
    return selected


def _cleaned_form2_candidate_rule(
    prestate_rule: Mapping[str, Any],
    bindings: Mapping[str, Any],
    *,
    active: bool,
) -> dict[str, Any]:
    selected = json.loads(_canonical_json(prestate_rule))
    selected["name"] = CANONICAL_FORM2_RULE_NAME
    selected["active"] = active
    selected["criteria"] = expected_criterion_ast("form2Candidate")
    selected["criteriaAuthority"] = "reviewed_desired"
    selected["instantActions"] = _action_rows(
        bindings["rules"]["form2Candidate"],
        (
            ("setupAccessSubmitted", "field_updates"),
            ("setupAndQaTask", "tasks"),
        ),
        bindings["form2CandidateActionSemantics"],
    )
    return selected


def _provider_criterion_ast(
    value: Any, field_ids: Mapping[str, Any]
) -> dict[str, Any]:
    """Render the exact Zoho V8 criteria shape from reviewed semantics."""

    node = normalize_criterion_ast(value)
    if node["type"] == "condition":
        api_name = node["apiName"]
        _require(
            api_name in field_ids,
            "internal_form2_criterion_field_binding_missing",
        )
        return {
            "field": {
                "api_name": api_name,
                "id": field_ids[api_name],
            },
            "comparator": node["operator"],
            "type": "value",
            # Zoho's authoritative V8 readback preserves the literal marker;
            # rewriting it as JSON null would not round-trip exactly.
            "value": node["value"],
        }
    return {
        "group_operator": node["operator"],
        "group": [
            _provider_criterion_ast(child, field_ids)
            for child in node["children"]
        ],
    }


def _form2_inactive_edit_payload(bindings: Mapping[str, Any]) -> dict[str, Any]:
    rule = bindings["rules"]["form2Candidate"]
    return {
        "id": rule["ruleId"],
        "name": CANONICAL_FORM2_RULE_NAME,
        "conditions": [
            {
                "id": rule["conditionId"],
                "sequence_number": rule["conditionSequenceNumber"],
                "criteria": _provider_criterion_ast(
                    expected_criterion_ast("form2Candidate"),
                    bindings["form2CriterionFieldIds"],
                ),
                "instant_actions": {
                    "actions": [
                        {
                            "id": rule["actionIds"]["authorizationSigned"],
                            "type": "field_updates",
                            "_delete": None,
                        },
                        {
                            "id": rule["actionIds"]["testStatusSetupPending"],
                            "type": "field_updates",
                            "_delete": None,
                        },
                    ]
                },
            }
        ],
    }


def _operation(
    ordinal: int,
    name: str,
    kind: str,
    calls: Sequence[Mapping[str, Any]],
    acceptance: Mapping[str, Any],
    *,
    pre_mutation_rule: Mapping[str, Any] | None = None,
    pre_mutation_action_definition_gate: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    mutation_kind = kind in ("mutation", "conditional_mutation")
    _require(
        mutation_kind == (pre_mutation_rule is not None),
        "internal_pre_mutation_gate_invalid",
    )
    _require(
        pre_mutation_action_definition_gate is None
        or pre_mutation_rule is not None,
        "internal_pre_mutation_action_gate_invalid",
    )
    return {
        "ordinal": ordinal,
        "name": name,
        "kind": kind,
        "calls": list(calls),
        "acceptance": dict(acceptance),
        "preMutationExactRuleReadback": (
            _pre_mutation_exact_rule_readback(
                pre_mutation_rule,
                pre_mutation_action_definition_gate,
            )
            if pre_mutation_rule is not None
            else None
        ),
        "stopOnFailure": True,
        "retry": False,
    }


def _criterion_authority_state() -> dict[str, Any]:
    return {
        "reviewedDesiredRuleKeys": [
            "leadIntake",
            "controls",
            "limits",
            "form2Candidate",
        ],
        "observedRepairSourceRuleKeys": ["form2Candidate"],
        "observedNotAuthoritativeRuleKeys": ["form2Superseded"],
        "form2DesiredCriterionContractPresent": True,
        "form2ActivationAuthorized": True,
        "status": "reviewed_desired",
    }


def expected_operations(
    bindings: Mapping[str, Any],
    observed_form2_criteria: Mapping[str, Any],
) -> list[dict[str, Any]]:
    """Render trigger repair plus inactive Form2 cleanup and activation."""

    rules = bindings["rules"]
    prestate_by_key = {
        row["key"]: row
        for row in expected_prestate_rules(bindings, observed_form2_criteria)
    }
    lead = rules["leadIntake"]
    controls = rules["controls"]
    limits = rules["limits"]
    lead_poststate = _readback_rule(
        prestate_by_key["leadIntake"], trigger_type="create"
    )
    controls_poststate = _readback_rule(
        prestate_by_key["controls"], trigger_type="create"
    )
    limits_poststate = _readback_rule(
        prestate_by_key["limits"], trigger_type="create"
    )
    candidate_inactive = _cleaned_form2_candidate_rule(
        prestate_by_key["form2Candidate"], bindings, active=False
    )
    candidate_active = _cleaned_form2_candidate_rule(
        prestate_by_key["form2Candidate"], bindings, active=True
    )
    candidate_current_action_gate = (
        _independent_form2_action_definition_gate(
            bindings,
            (
                "setupAccessSubmitted",
                "setupAndQaTask",
                "authorizationSigned",
                "testStatusSetupPending",
            ),
        )
    )
    candidate_retained_action_gate = (
        _independent_form2_action_definition_gate(
            bindings,
            ("setupAccessSubmitted", "setupAndQaTask"),
        )
    )
    final_rules = [
        lead_poststate,
        controls_poststate,
        limits_poststate,
        candidate_active,
        prestate_by_key["form2Superseded"],
    ]
    all_rule_reads = [_read_call(rules[key]["ruleId"]) for key in RULE_ORDER]
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
                "supersededInactive": True,
                "bothForm2RulesInactive": True,
                "candidateObservedRepairSource": True,
                "criteriaAuthority": _criterion_authority_state(),
                "missingTruncatedOrAdditionalDataAccepted": False,
            },
        ),
        _operation(
            2,
            "make_lead_intake_create_only_preserving_scheduled_actions",
            "mutation",
            [
                _write_call(
                    {
                        "id": lead["ruleId"],
                        "execute_when": {"type": "create"},
                    }
                )
            ],
            _success_acceptance(lead["ruleId"]),
            pre_mutation_rule=prestate_by_key["leadIntake"],
        ),
        _operation(
            3,
            "lead_intake_exact_post_write_readback_gate",
            "readback_gate",
            [_read_call(lead["ruleId"])],
            {
                "type": "exact_rule_set",
                "rules": [lead_poststate],
                "allCriteriaExactlyMatchPacketBoundAst": True,
                "scheduledActionsExactlyMatchPacketBoundPrestate": True,
                "criteriaAuthority": _criterion_authority_state(),
                "missingTruncatedOrAdditionalDataAccepted": False,
            },
        ),
        _operation(
            4,
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
            pre_mutation_rule=prestate_by_key["controls"],
        ),
        _operation(
            5,
            "controls_exact_post_write_readback_gate",
            "readback_gate",
            [_read_call(controls["ruleId"])],
            {
                "type": "exact_rule_set",
                "rules": [controls_poststate],
                "allCriteriaExactlyMatchPacketBoundAst": True,
                "scheduledActionsExactlyMatchPacketBoundPrestate": True,
                "criteriaAuthority": _criterion_authority_state(),
                "missingTruncatedOrAdditionalDataAccepted": False,
            },
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
            pre_mutation_rule=prestate_by_key["limits"],
        ),
        _operation(
            7,
            "limits_exact_post_write_readback_gate",
            "readback_gate",
            [_read_call(limits["ruleId"])],
            {
                "type": "exact_rule_set",
                "rules": [limits_poststate],
                "allCriteriaExactlyMatchPacketBoundAst": True,
                "scheduledActionsExactlyMatchPacketBoundPrestate": True,
                "criteriaAuthority": _criterion_authority_state(),
                "missingTruncatedOrAdditionalDataAccepted": False,
            },
        ),
        _operation(
            8,
            "edit_form2_candidate_while_inactive",
            "mutation",
            [_write_call(_form2_inactive_edit_payload(bindings))],
            _success_acceptance(rules["form2Candidate"]["ruleId"]),
            pre_mutation_rule=prestate_by_key["form2Candidate"],
            pre_mutation_action_definition_gate=(
                candidate_current_action_gate
            ),
        ),
        _operation(
            9,
            "form2_candidate_inactive_exact_post_write_readback_gate",
            "readback_gate",
            [
                _read_call(rules["form2Candidate"]["ruleId"]),
                _read_call(rules["form2Superseded"]["ruleId"]),
                *[
                    row["call"]
                    for row in candidate_retained_action_gate["reads"]
                ],
            ],
            {
                "type": "exact_rule_set",
                "rules": [
                    candidate_inactive,
                    prestate_by_key["form2Superseded"],
                ],
                "candidateInactive": True,
                "supersededInactiveAndUnchanged": True,
                "canonicalNamePresent": True,
                "reviewedDesiredCriteriaPresent": True,
                "safeActionSemanticsPresent": True,
                "authorizationAndTestStatusActionsAbsent": True,
                "independentRetainedActionDefinitionGate": (
                    candidate_retained_action_gate
                ),
                "criteriaAuthority": _criterion_authority_state(),
                "missingTruncatedOrAdditionalDataAccepted": False,
            },
        ),
        _operation(
            10,
            "activate_cleaned_form2_candidate_status_only",
            "mutation",
            [
                _write_call(
                    {
                        "id": rules["form2Candidate"]["ruleId"],
                        "status": {"active": True},
                    }
                )
            ],
            _success_acceptance(rules["form2Candidate"]["ruleId"]),
            pre_mutation_rule=candidate_inactive,
            pre_mutation_action_definition_gate=(
                candidate_retained_action_gate
            ),
        ),
        _operation(
            11,
            "final_exact_rule_set_and_single_active_form2_inventory_gate",
            "readback_gate",
            [
                *all_rule_reads,
                inventory_call,
                *[
                    row["call"]
                    for row in candidate_retained_action_gate["reads"]
                ],
            ],
            {
                "type": "exact_rule_set_and_complete_deals_inventory",
                "rules": final_rules,
                "canonicalCandidateActive": True,
                "supersededInactive": True,
                "allCriteriaExactlyMatchPacketBoundAst": True,
                "criteriaAuthority": _criterion_authority_state(),
                "candidateMutationPerformed": True,
                "supersededMutationPerformed": False,
                "unsafeFieldUpdateDeletionPerformed": True,
                "scheduledActionMutationOrDeletionPerformed": False,
                "independentRetainedActionDefinitionGate": (
                    candidate_retained_action_gate
                ),
                "inventory": {
                    "paginationComplete": True,
                    "candidateCanonicalNameMatchCount": 1,
                    "candidateObservedNameMatchCount": 0,
                    "candidateActiveCount": 1,
                    "supersededObservedNameMatchCount": 1,
                    "supersededActiveCount": 0,
                    "logicalForm2ActiveCount": 1,
                    "form2DesiredCriteriaAuthorityPresent": True,
                },
                "missingTruncatedOrAdditionalDataAccepted": False,
            },
        ),
    ]


def expected_failure_containment(
    bindings: Mapping[str, Any],
    observed_form2_criteria: Mapping[str, Any],
) -> dict[str, Any]:
    """Render fail-closed reconciliation and one bounded deactivation."""

    rules = bindings["rules"]
    prestate_by_key = {
        row["key"]: row
        for row in expected_prestate_rules(bindings, observed_form2_criteria)
    }
    unchanged = [prestate_by_key[key] for key in RULE_ORDER]
    lead_only = json.loads(_canonical_json(unchanged))
    lead_only[0]["triggerType"] = "create"
    lead_and_controls = json.loads(_canonical_json(lead_only))
    lead_and_controls[1]["triggerType"] = "create"
    all_three = json.loads(_canonical_json(lead_and_controls))
    all_three[2]["triggerType"] = "create"
    candidate_inactive = _cleaned_form2_candidate_rule(
        prestate_by_key["form2Candidate"], bindings, active=False
    )
    candidate_active = _cleaned_form2_candidate_rule(
        prestate_by_key["form2Candidate"], bindings, active=True
    )
    all_three_candidate_cleaned = json.loads(_canonical_json(all_three))
    all_three_candidate_cleaned[3] = candidate_inactive
    all_three_candidate_active = json.loads(
        _canonical_json(all_three_candidate_cleaned)
    )
    all_three_candidate_active[3] = candidate_active
    allowed_states = [
        {"name": "no_trigger_write_observed", "rules": unchanged},
        {"name": "lead_only_observed", "rules": lead_only},
        {"name": "lead_and_controls_observed", "rules": lead_and_controls},
        {"name": "all_three_observed", "rules": all_three},
        {
            "name": "candidate_cleaned_inactive_observed",
            "rules": all_three_candidate_cleaned,
        },
        {
            "name": "candidate_active_observed",
            "rules": all_three_candidate_active,
        },
    ]
    terminal_states = allowed_states[:-1]
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
    return {
        "trigger": "failure_after_packet_start",
        "operations": [
            _operation(
                1,
                "read_all_rules_and_classify_bounded_trigger_prefix_without_retry",
                "conditional_readback_gate",
                [_read_call(rules[key]["ruleId"]) for key in RULE_ORDER],
                {
                    "type": "one_of_exact_packet_bound_rule_sets",
                    "allowedStates": allowed_states,
                    "allowedStateCount": 6,
                    "monotonicTriggerPrefixRequired": True,
                    "allFiveRulesReadByIdRequired": True,
                    "supersededRuleInactive": True,
                    "candidateActiveOnlyInFinalAllowedState": True,
                    "allCriteriaExactlyMatchPacketBoundAst": True,
                    "scheduledActionsExactlyMatchPacketBoundPrestate": True,
                    "criteriaAuthority": _criterion_authority_state(),
                    "missingTruncatedOrAdditionalDataAccepted": False,
                },
            ),
            _operation(
                2,
                "conditionally_deactivate_ambiguously_active_form2_candidate",
                "conditional_mutation",
                [
                    _write_call(
                        {
                            "id": rules["form2Candidate"]["ruleId"],
                            "status": {
                                "active": False,
                                "delete_schedule_action": False,
                            },
                        }
                    )
                ],
                {
                    "type": "execute_only_for_exact_classified_state",
                    "executeWhenState": "candidate_active_observed",
                    "skipWhenStates": [
                        state["name"] for state in terminal_states
                    ],
                    "executedAcceptance": _success_acceptance(
                        rules["form2Candidate"]["ruleId"]
                    ),
                    "automaticRetry": False,
                },
                pre_mutation_rule=candidate_active,
            ),
            _operation(
                3,
                "final_failure_containment_all_rule_readback_gate",
                "conditional_readback_gate",
                [
                    *[
                        _read_call(rules[key]["ruleId"])
                        for key in RULE_ORDER
                    ],
                    inventory_call,
                ],
                {
                    "type": (
                        "one_of_exact_packet_bound_rule_sets_and_"
                        "complete_deals_inventory"
                    ),
                    "allowedStates": terminal_states,
                    "allowedStateCount": 5,
                    "allFiveRulesReadByIdRequired": True,
                    "bothForm2RulesInactive": True,
                    "supersededRuleUnchanged": True,
                    "inventory": {
                        "paginationComplete": True,
                        "candidateCanonicalNameMatchCountMaximum": 1,
                        "candidateActiveCount": 0,
                        "supersededObservedNameMatchCount": 1,
                        "supersededActiveCount": 0,
                        "logicalForm2ActiveCount": 0,
                    },
                    "scheduledActionsExactlyMatchPacketBoundPrestate": True,
                    "criteriaAuthority": _criterion_authority_state(),
                    "missingTruncatedOrAdditionalDataAccepted": False,
                },
            ),
        ],
        "terminalState": {
            "canonicalCandidateActive": False,
            "supersededRuleActive": False,
            "triggerRepairState": "one_of_five_exact_contained_states",
            "scheduledActionsUnchanged": True,
        },
        "neverReactivateSupersededRule": True,
        "neverActivateSupersededRule": True,
        "candidateMutationAuthorized": True,
        "candidateActivationAuthorizedOnlyAfterInactiveReadback": True,
        "conditionalCandidateDeactivationAuthorized": True,
        "retrySupersededDeactivationAuthorized": False,
        "retryAnyMutationAuthorized": False,
        "onAmbiguousContainment": (
            "stop_and_require_manual_all_rule_readback_without_"
            "changing_scheduled_actions_or_retrying_any_mutation"
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
    _exact_integer(
        capability["schemaVersion"],
        SCHEMA_VERSION,
        "capability_schema_invalid",
    )
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
    _exact_integer(
        prestate["schemaVersion"],
        SCHEMA_VERSION,
        "prestate_schema_invalid",
    )
    _exact_integer(
        prestate["organizationMatchCount"],
        1,
        "prestate_target_invalid",
    )
    _require(
        prestate["organizationId"] == target_organization_id
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
    _exact_integer(
        form2["submissionCount"],
        0,
        "prestate_form2_not_contained",
    )
    _require(
        form2["publicFormDisabled"] is True
        and form2["submissionWebhookDisabled"] is True,
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
        if key in _PRESTATE_REVIEWED_CRITERIA_KEYS:
            _require(
                selected_rule.get("criteriaAuthority") == "reviewed_desired"
                and _canonical_json(normalized_criteria)
                == _canonical_json(expected_criterion_ast(key)),
                "prestate_reviewed_criterion_drift",
            )
        elif key == "form2Candidate":
            _require(
                selected_rule.get("criteriaAuthority")
                == "observed_repair_source_desired_committed",
                "prestate_form2_criterion_authority_invalid",
            )
        else:
            _require(
                selected_rule.get("criteriaAuthority")
                == "observed_not_authoritative_inactive",
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
            "form2CandidateActivationAuthorized",
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
    _exact_integer(
        approval["schemaVersion"],
        SCHEMA_VERSION,
        "approval_schema_invalid",
    )
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
    _exact_integer(
        approval["authorizedMainOperationCount"],
        11,
        "approval_authority_invalid",
    )
    _exact_integer(
        approval["authorizedConditionalContainmentOperationCount"],
        3,
        "approval_authority_invalid",
    )
    _exact_integer(
        approval["maximumAuthorizedMutationCallCount"],
        6,
        "approval_authority_invalid",
    )
    _require(
        approval["workflowMutationAuthorized"] is True
        and approval["form2CandidateActivationAuthorized"] is True
        and approval["containmentAuthorized"] is True
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
    _exact_integer(
        packet["schemaVersion"],
        SCHEMA_VERSION,
        "packet_schema_invalid",
    )
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
    "CLAIM_NAMESPACE",
    "EMPTY_CRITERION_VALUE",
    "ENTRY_OFFER_VALUE",
    "EXECUTION_POLICY",
    "FIELD_UPDATE_BY_ID_TOOL",
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
    "SCHEMA_VERSION",
    "SUPERSEDED_FORM2_RULE_NAME",
    "TOOL_CONTRACT",
    "TOOL_CONTRACT_DIGEST_DOMAIN",
    "WRITE_TOOL",
    "WORKFLOW_TASK_INVENTORY_TOOL",
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
