"""CLI for validating private CRM workflow repair and approval JSON files."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any, Sequence


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
VALIDATOR_PATH = PACKAGE_ROOT / "validators" / "workflow_repair_packet.py"
_VALIDATOR_MODULE_NAME = "_sylvara_crm_workflow_repair_packet_validator"
_VALIDATOR_SPEC = importlib.util.spec_from_file_location(
    _VALIDATOR_MODULE_NAME, VALIDATOR_PATH
)
if _VALIDATOR_SPEC is None or _VALIDATOR_SPEC.loader is None:
    raise RuntimeError("CRM workflow repair validator unavailable")
_VALIDATOR_MODULE = importlib.util.module_from_spec(_VALIDATOR_SPEC)
sys.modules[_VALIDATOR_MODULE_NAME] = _VALIDATOR_MODULE
_VALIDATOR_SPEC.loader.exec_module(_VALIDATOR_MODULE)

WorkflowRepairPacketValidationError = (
    _VALIDATOR_MODULE.WorkflowRepairPacketValidationError
)
WorkflowRepairValidationResult = _VALIDATOR_MODULE.WorkflowRepairValidationResult
CLAIM_NAMESPACE = _VALIDATOR_MODULE.CLAIM_NAMESPACE
assert_package_source_clean = _VALIDATOR_MODULE.assert_package_source_clean
assert_private_packet_path = _VALIDATOR_MODULE.assert_private_packet_path
validate_workflow_repair_packet = (
    _VALIDATOR_MODULE.validate_workflow_repair_packet
)


def _load_private_json(path: Path, code: str) -> Any:
    def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        selected: dict[str, Any] = {}
        for key, value in pairs:
            if key in selected:
                raise ValueError("duplicate JSON object key")
            selected[key] = value
        return selected

    try:
        return json.loads(
            path.read_bytes().decode("utf-8"),
            object_pairs_hook=reject_duplicate_keys,
        )
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError):
        raise WorkflowRepairPacketValidationError(code) from None


def _safe_error(error: BaseException) -> str:
    if isinstance(error, WorkflowRepairPacketValidationError):
        return str(error)
    return "CRM workflow repair packet rejected: unexpected_validation_failure"


def validate_private_workflow_repair_paths(
    packet_value: str | Path,
    approval_value: str | Path,
) -> WorkflowRepairValidationResult:
    """Validate two private files and return the bound result in-process.

    This is the machine-consumable boundary used by the durable approval-claim
    wrapper. It deliberately does not serialize the private authority ID.
    """

    packet_path = assert_private_packet_path(packet_value)
    approval_path = assert_private_packet_path(approval_value)
    if packet_path == approval_path:
        raise WorkflowRepairPacketValidationError(
            "private_packet_and_approval_must_be_distinct"
        )
    packet = _load_private_json(packet_path, "private_packet_json_invalid")
    approval = _load_private_json(
        approval_path, "private_approval_json_invalid"
    )
    assert_package_source_clean()
    return validate_workflow_repair_packet(packet, approval)


def main(argv: Sequence[str] | None = None) -> int:
    selected = list(sys.argv[1:] if argv is None else argv)
    if len(selected) != 2:
        sys.stderr.write(
            "usage: validate_private_workflow_repair_packet.py "
            "<private-packet-json> <private-approval-json>\n"
        )
        return 2
    try:
        result = validate_private_workflow_repair_paths(selected[0], selected[1])
    except BaseException as error:  # Keep private values out of every CLI failure.
        sys.stderr.write(_safe_error(error) + "\n")
        return 1
    sys.stdout.write(
        json.dumps(
            {
                "conditionalContainmentOperationCount": (
                    result.conditional_containment_operation_count
                ),
                "digest": result.digest,
                "consumptionDigest": result.consumption_digest,
                "environment": result.environment,
                "mainOperationCount": result.main_operation_count,
                "maximumMutationCallCount": result.maximum_mutation_call_count,
                "mutationPerformed": result.mutation_performed,
                "singleUseRuntimeEnforced": result.single_use_runtime_enforced,
                "valid": True,
            },
            separators=(",", ":"),
            sort_keys=True,
        )
        + "\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
