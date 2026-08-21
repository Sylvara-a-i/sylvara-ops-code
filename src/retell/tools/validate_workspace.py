#!/usr/bin/env python3
"""Validate the public Retell workspace without contacting Retell.

Public snapshots are reconstructed from canonical allowlisted documents. They
are never masked copies of Retell responses.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from collections.abc import Mapping
from pathlib import Path, PurePosixPath
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
RETELL_ROOT = REPOSITORY_ROOT / "src" / "retell"

EXPECTED_AGENTS = {
    "7-day-free-test": ("agent_7_day_free_test", "7-Day Free Test"),
    "revenue-desk-master-template": (
        "agent_revenue_desk_master_template",
        "Revenue Desk — Master Template",
    ),
}
DRAFT_ARTIFACTS = (
    "agent-configuration-summary.json",
    "dynamic-variable-contract.json",
    "flow-configuration-summary.json",
    "function-definitions.json",
    "test-definitions.json",
)
UNRESOLVED_PUBLISHED_FILES = {"resolution.json"}
RESOLVED_PUBLISHED_FILES = set(DRAFT_ARTIFACTS)

NONURGENT_CONTRACT_RELATIVE_PATH = (
    "agents/7-day-free-test/contracts/nonurgent-classification-contract.json"
)
NONURGENT_CLASSIFICATION_CONTRACT = {
    "schema_version": 1,
    "classification": "public-provider-neutral-acceptance-contract",
    "runtime_authority": False,
    "deployment_authorized": False,
    "source_system": "provider-neutral-contract",
    "agent": {
        "local_key": "agent_7_day_free_test",
        "display_name": "7-Day Free Test",
    },
    "scope": "bounded-intake-classification",
    "state_sets": {
        "urgency": ["approved_urgent", "nonurgent", "unknown"],
        "urgent_callback": [
            "confirmed_usable",
            "explicitly_unavailable",
            "unknown",
        ],
        "nonurgent_callback": [
            "confirmed_usable",
            "explicitly_unavailable",
            "unknown",
        ],
        "area": ["in_area", "out_of_area", "unknown"],
        "service_property": ["supported", "unsupported", "unknown"],
        "routine": ["verified_complete", "incomplete_or_ambiguous"],
    },
    "preserved_boundaries": {
        "configuration_failure": "configuration_unavailable",
        "safety_precedes_classification": True,
        "approved_urgency": "urgent_callback_policy",
        "nonurgent_urgency": "nonurgent_policy",
        "unresolved_urgency": "needs_review",
        "exception_behavior": "preserved",
    },
    "urgent_callback_policy": {
        "initial": {
            "confirmed_usable": {
                "outcome": "urgent_callback",
                "needs_review": False,
            },
            "explicitly_unavailable": {
                "outcome": "urgent_no_callback",
                "needs_review": True,
            },
            "unknown": {"outcome": "one_confirmation", "needs_review": False},
        },
        "final": {
            "confirmed_usable": {
                "outcome": "urgent_callback",
                "needs_review": False,
            },
            "explicitly_unavailable": {
                "outcome": "urgent_no_callback",
                "needs_review": True,
            },
            "unknown": {"outcome": "urgent_no_callback", "needs_review": True},
        },
    },
    "nonurgent_callback_policy": {
        "initial": {
            "confirmed_usable": {
                "outcome": "area_classification",
                "needs_review": False,
            },
            "explicitly_unavailable": {
                "outcome": "no_callback",
                "needs_review": False,
            },
            "unknown": {"outcome": "one_confirmation", "needs_review": False},
        },
        "final": {
            "confirmed_usable": {
                "outcome": "area_classification",
                "needs_review": False,
            },
            "explicitly_unavailable": {
                "outcome": "no_callback",
                "needs_review": False,
            },
            "unknown": {"outcome": "no_callback", "needs_review": True},
        },
    },
    "nonurgent_precedence_phase": "after-bounded-confirmation",
    "nonurgent_precedence": [
        {
            "rank": 1,
            "match": {
                "callback": ["explicitly_unavailable", "unknown"]
            },
            "outcome": "no_callback",
        },
        {
            "rank": 2,
            "match": {
                "callback": ["confirmed_usable"],
                "area": ["out_of_area"],
            },
            "outcome": "out_of_area",
        },
        {
            "rank": 3,
            "match": {
                "callback": ["confirmed_usable"],
                "area": ["in_area"],
                "service_property": ["unsupported"],
            },
            "outcome": "unsupported_service_or_property",
        },
        {
            "rank": 4,
            "match": {
                "callback": ["confirmed_usable"],
                "area": ["in_area"],
                "service_property": ["supported"],
                "routine": ["verified_complete"],
            },
            "outcome": "standard",
        },
        {"rank": 5, "match": {}, "outcome": "needs_review"},
    ],
    "bounded_confirmation_attempts": 1,
    "capability_boundary": {
        "function_calls": False,
        "transfers": False,
        "booking": False,
        "dispatch": False,
        "messages": False,
        "external_writes": False,
    },
    "publication_boundary": {
        "runtime_mapping_in_git": False,
        "manual_chat_evidence_in_git": False,
        "runtime_prompts_in_git": False,
        "runtime_topology_in_git": False,
    },
    "interpretation": (
        "Provider-neutral acceptance semantics only; not deployable Retell "
        "configuration or proof of runtime behavior."
    ),
}

SNAPSHOT_ID_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-audit-\d{2}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
URL_RE = re.compile(r"https?://", re.IGNORECASE)
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
FORMATTED_PHONE_RE = re.compile(
    r"(?<!\d)(?:\+?1[ .-])?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}(?!\d)"
)
E164_PHONE_RE = re.compile(r"(?<![A-Za-z0-9])\+?[1-9]\d{7,14}(?![A-Za-z0-9])")
PRECISE_TIMESTAMP_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}")
ID_LIKE_RE = re.compile(r"^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_-]{24,}$")
SECRET_RE = re.compile(
    r"\b(?:key_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._~+/-]{20,})\b",
    re.IGNORECASE,
)
FORBIDDEN_EXACT_KEYS = {
    "agent_id",
    "api_key",
    "authorization",
    "condition",
    "connection_alias",
    "conversation_flow_id",
    "default_value",
    "destination",
    "endpoint",
    "flow_id",
    "global_prompt",
    "headers",
    "knowledge_base_id",
    "llm_id",
    "password",
    "phone_number",
    "prompt",
    "raw_payload",
    "raw_response",
    "routing",
    "secret",
    "source_default_present",
    "token",
    "url",
    "version_id",
    "voice_id",
    "webhook_url",
}
FORBIDDEN_KEY_MARKERS = (
    "destination_",
    "private_endpoint",
    "raw_prompt",
    "route_target",
    "runtime_variable_name",
)
SAFE_ID_LIKE_KEYS = {"canonicalization", "local_key", "sha256", "snapshot_id"}

CONFIGURATION_SUMMARY = {
    "channel_class": "voice",
    "language_class": "english",
    "response_engine_class": "conversation-flow",
    "runtime_identifiers_in_git": False,
    "runtime_values_in_git": False,
    "sensitive_runtime_details_in_git": False,
}
CONFIGURATION_PRIVATE_SCOPE = [
    "complete agent version",
    "referenced engine version",
    "referenced resource versions",
]
FLOW_SUMMARY = {
    "response_engine_class": "conversation-flow",
    "resource_boundary": "agent-specific",
    "public_detail_level": "resource-class-only",
    "topology_in_git": False,
    "runtime_text_in_git": False,
    "runtime_decisions_in_git": False,
}
FLOW_PRIVATE_SCOPE = [
    "complete flow version",
    "runtime text",
    "decision topology",
    "referenced runtime resources",
]
RESOURCE_REVIEW_CLASSES = [
    "agent version inventory",
    "conversation-flow version",
    "voice resource",
    "knowledge-base references",
    "shared flow-component references",
    "MCP references",
    "test-definition inventory",
]

PUBLICATION_BOUNDARY = (
    "Public resource classes and lifecycle resolution only; all runtime-derived "
    "details are private."
)
AUDIT_INTERPRETATION = (
    "Historical evidence only; not deployable configuration or proof of "
    "publication, deployment, phone binding, or routing."
)
CONFIGURATION_INTERPRETATION = (
    "Public resource classes only; complete runtime configuration remains private "
    "and authoritative in Retell."
)
FLOW_INTERPRETATION = (
    "The agent has a separate private flow resource; this summary contains no "
    "deployable flow content."
)
VARIABLE_INTERPRETATION = (
    "Exact runtime names, types, defaults, and mappings remain private; no "
    "provider-neutral public contract is approved."
)
FUNCTION_INTERPRETATION = (
    "Exact runtime tool presence and definitions remain private; no public "
    "function contract is approved."
)
TEST_INTERPRETATION = (
    "This is an offline repository-boundary test only; Retell test inventory and "
    "results remain private."
)
RESOLUTION_INTERPRETATION = (
    "A published configuration did not resolve through the audited read path; "
    "this is not categorical proof of nonexistence."
)
UNRESOLVED_COMPARISON_INTERPRETATION = (
    "No draft-versus-published comparison is asserted because a published "
    "configuration was not resolved."
)
RESOLVED_COMPARISON_INTERPRETATION = (
    "Only the listed public sanitized artifacts were compared; private fields "
    "remain excluded."
)


def _relative(root: Path, path: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return str(path)


def _load_json(root: Path, path: Path) -> tuple[Any | None, list[str]]:
    try:
        return json.loads(path.read_text(encoding="utf-8")), []
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return None, [f"{_relative(root, path)}: invalid JSON: {exc}"]


def _join_json_path(parent: str, key: object) -> str:
    return f"{parent}/{str(key).replace('~', '~0').replace('/', '~1')}"


def find_public_data_problems(value: object, path: str = "$") -> list[str]:
    """Return sanitized diagnostics without echoing offending values."""

    problems: list[str] = []
    if isinstance(value, Mapping):
        for key, child in value.items():
            lowered = str(key).lower()
            child_path = _join_json_path(path, key)
            if lowered in FORBIDDEN_EXACT_KEYS or any(
                marker in lowered for marker in FORBIDDEN_KEY_MARKERS
            ):
                problems.append(f"{child_path}: prohibited public field")
            problems.extend(find_public_data_problems(child, child_path))
        return problems

    if isinstance(value, list):
        for index, child in enumerate(value):
            problems.extend(find_public_data_problems(child, f"{path}/{index}"))
        return problems
    if not isinstance(value, str):
        return problems

    leaf_key = path.rsplit("/", 1)[-1]
    checks = (
        (URL_RE, "URL or endpoint"),
        (EMAIL_RE, "email-like"),
        (FORMATTED_PHONE_RE, "phone-like"),
        (E164_PHONE_RE, "phone-like"),
        (PRECISE_TIMESTAMP_RE, "precise timestamp"),
        (SECRET_RE, "credential-like"),
    )
    for regex, label in checks:
        if regex.search(value):
            problems.append(f"{path}: {label} value is prohibited")
    if "C:\\Users\\" in value or "C:/Users/" in value:
        problems.append(f"{path}: private filesystem path is prohibited")
    if ID_LIKE_RE.fullmatch(value) and leaf_key not in SAFE_ID_LIKE_KEYS:
        problems.append(f"{path}: live-identifier-like value is prohibited")
    return problems


def _common(classification: str, snapshot_id: str) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "classification": classification,
        "runtime_authority": False,
        "source_system": "retell",
        "snapshot_id": snapshot_id,
        "observed_on": snapshot_id[:10],
    }


def _agent(local_key: str, display_name: str) -> dict[str, str]:
    return {"local_key": local_key, "display_name": display_name}


def _expected_configuration(
    snapshot_id: str,
    local_key: str,
    display_name: str,
    lifecycle_slot: str,
) -> dict[str, Any]:
    return {
        **_common("public-sanitized-configuration-summary", snapshot_id),
        "agent": _agent(local_key, display_name),
        "lifecycle_slot": lifecycle_slot,
        "configuration_summary": CONFIGURATION_SUMMARY,
        "private_evidence_scope": CONFIGURATION_PRIVATE_SCOPE,
        "interpretation": CONFIGURATION_INTERPRETATION,
    }


def _expected_flow(
    snapshot_id: str,
    local_key: str,
    display_name: str,
    lifecycle_slot: str,
) -> dict[str, Any]:
    return {
        **_common("public-sanitized-flow-summary", snapshot_id),
        "agent": _agent(local_key, display_name),
        "lifecycle_slot": lifecycle_slot,
        "flow_summary": FLOW_SUMMARY,
        "private_evidence_scope": FLOW_PRIVATE_SCOPE,
        "interpretation": FLOW_INTERPRETATION,
    }


def _expected_empty_contract(
    snapshot_id: str,
    local_key: str,
    display_name: str,
    lifecycle_slot: str,
    inventory_field: str,
    interpretation: str,
) -> dict[str, Any]:
    return {
        **_common("public-provider-neutral-contract-status", snapshot_id),
        "agent": _agent(local_key, display_name),
        "lifecycle_slot": lifecycle_slot,
        "contract_status": "public-provider-neutral-contract-not-approved",
        inventory_field: False,
        "public_definition_count": 0,
        "definitions": [],
        "interpretation": interpretation,
    }


def _expected_tests(
    snapshot_id: str,
    local_key: str,
    display_name: str,
    lifecycle_slot: str,
) -> dict[str, Any]:
    return {
        **_common("public-synthetic-test-contract", snapshot_id),
        "agent": _agent(local_key, display_name),
        "lifecycle_slot": lifecycle_slot,
        "runtime_test_inventory_in_git": False,
        "retell_test_runs_performed": 0,
        "public_definition_count": 1,
        "definitions": [
            {
                "local_key": "repository_boundary_validation",
                "kind": "offline-repository-contract",
                "fixture_class": "synthetic",
                "expected_outcome": "public-boundary-valid",
                "external_call": False,
            }
        ],
        "interpretation": TEST_INTERPRETATION,
    }


def _expected_resolution(
    snapshot_id: str, local_key: str, display_name: str
) -> dict[str, Any]:
    return {
        **_common("public-sanitized-lifecycle-resolution", snapshot_id),
        "agent": _agent(local_key, display_name),
        "lifecycle_slot": "published",
        "resolution": "not-resolved-at-observation",
        "evidence_location": "private-audit-only",
        "interpretation": RESOLUTION_INTERPRETATION,
    }


def _expected_manifest(
    local_key: str, display_name: str, snapshot_ids: list[str]
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "local_key": local_key,
        "display_name": display_name,
        "separate_configuration_boundary": True,
        "runtime_authority": False,
        "snapshots": snapshot_ids,
    }


def _normalized_for_comparison(document: Mapping[str, Any]) -> dict[str, Any]:
    normalized = dict(document)
    normalized.pop("lifecycle_slot", None)
    return normalized


def _expected_sanitized_changes(root: Path, slug: str, snapshot_id: str) -> list[str]:
    changes: list[str] = []
    base = root / "agents" / slug / "snapshots" / snapshot_id
    for name in DRAFT_ARTIFACTS:
        draft, draft_problems = _load_json(root, base / "draft" / name)
        published, published_problems = _load_json(root, base / "published" / name)
        if draft_problems or published_problems:
            continue
        if not isinstance(draft, Mapping) or not isinstance(published, Mapping):
            continue
        if _normalized_for_comparison(draft) != _normalized_for_comparison(published):
            changes.append(name)
    return changes


def _expected_comparison(
    root: Path,
    slug: str,
    snapshot_id: str,
    local_key: str,
    display_name: str,
    layout: str,
) -> dict[str, Any]:
    common = {
        **_common("public-sanitized-comparison-status", snapshot_id),
        "agent": _agent(local_key, display_name),
        "draft_resolution": "resolved-at-observation",
        "private_fields_excluded": True,
    }
    if layout == "resolved":
        return {
            **common,
            "published_resolution": "resolved-at-observation",
            "comparison_status": "sanitized-diff-available",
            "reason": "sanitized-public-artifacts-compared",
            "sanitized_changes": _expected_sanitized_changes(root, slug, snapshot_id),
            "interpretation": RESOLVED_COMPARISON_INTERPRETATION,
        }
    return {
        **common,
        "published_resolution": "not-resolved-at-observation",
        "comparison_status": "unavailable",
        "reason": "published-configuration-not-resolved-at-observation",
        "sanitized_changes": [],
        "interpretation": UNRESOLVED_COMPARISON_INTERPRETATION,
    }


def _expected_audit(
    snapshot_id: str, layouts: Mapping[tuple[str, str], str]
) -> dict[str, Any]:
    managed_agents: list[dict[str, Any]] = []
    for slug, (local_key, display_name) in EXPECTED_AGENTS.items():
        resolved = layouts.get((slug, snapshot_id)) == "resolved"
        managed_agents.append(
            {
                "local_key": local_key,
                "display_name": display_name,
                "lifecycle_observation": {
                    "draft_resolution": "resolved-at-observation",
                    "published_resolution": (
                        "resolved-at-observation"
                        if resolved
                        else "not-resolved-at-observation"
                    ),
                    "comparison_status": (
                        "sanitized-diff-available" if resolved else "unavailable"
                    ),
                },
                "local_path": f"agents/{slug}",
            }
        )
    return {
        **_common("public-sanitized-historical-observation", snapshot_id),
        "environment_classification": "unverified",
        "observation_method": "authenticated-read-only-resource-traversal",
        "retell_write_operations_performed": 0,
        "prohibited_operations_performed": [],
        "publication_boundary": PUBLICATION_BOUNDARY,
        "interpretation": AUDIT_INTERPRETATION,
        "managed_agents": managed_agents,
        "resource_review": {
            "inspected_classes": RESOURCE_REVIEW_CLASSES,
            "public_detail_level": "resource-class-only",
            "runtime_details_in_git": False,
        },
        "integrity": "See integrity.json for hashes of sanitized artifacts only.",
    }


def _expected_artifact(
    root: Path,
    slug: str,
    snapshot_id: str,
    local_key: str,
    display_name: str,
    lifecycle_slot: str,
    name: str,
) -> dict[str, Any]:
    if name == "agent-configuration-summary.json":
        return _expected_configuration(
            snapshot_id, local_key, display_name, lifecycle_slot
        )
    if name == "flow-configuration-summary.json":
        return _expected_flow(snapshot_id, local_key, display_name, lifecycle_slot)
    if name == "dynamic-variable-contract.json":
        return _expected_empty_contract(
            snapshot_id,
            local_key,
            display_name,
            lifecycle_slot,
            "runtime_mapping_in_git",
            VARIABLE_INTERPRETATION,
        )
    if name == "function-definitions.json":
        return _expected_empty_contract(
            snapshot_id,
            local_key,
            display_name,
            lifecycle_slot,
            "runtime_inventory_in_git",
            FUNCTION_INTERPRETATION,
        )
    if name == "test-definitions.json":
        return _expected_tests(snapshot_id, local_key, display_name, lifecycle_slot)
    raise ValueError(f"Unknown public artifact class: {name}")


def _validate_exact_document(
    root: Path, path: Path, expected: Mapping[str, Any]
) -> list[str]:
    document, problems = _load_json(root, path)
    context = _relative(root, path)
    if not isinstance(document, Mapping):
        return problems or [f"{context}: must be an object"]
    problems.extend(find_public_data_problems(document, f"$/{context}"))
    if document != expected:
        problems.append(f"{context}: document does not match its exact public schema")
    return problems


def validate_configuration_document(
    document: Mapping[str, Any],
    snapshot_id: str,
    local_key: str,
    display_name: str,
    lifecycle_slot: str = "draft",
) -> list[str]:
    """Validate a configuration shape in isolation for regression tests."""

    expected = _expected_configuration(
        snapshot_id, local_key, display_name, lifecycle_slot
    )
    problems = find_public_data_problems(document, "$/configuration-document")
    if document != expected:
        problems.append("configuration-document: exact public schema mismatch")
    return problems


def validate_nonurgent_contract_document(
    document: Mapping[str, Any],
) -> list[str]:
    """Validate the provider-neutral classification contract in isolation."""

    problems = find_public_data_problems(document, "$/nonurgent-contract")
    if document != NONURGENT_CLASSIFICATION_CONTRACT:
        problems.append("nonurgent-contract: exact public schema mismatch")
    return problems


def published_layout_problems(file_names: set[str]) -> list[str]:
    """Validate the mutually exclusive published lifecycle file union."""

    if file_names in (UNRESOLVED_PUBLISHED_FILES, RESOLVED_PUBLISHED_FILES):
        return []
    return ["published lifecycle file set is invalid"]


def _read_published_layout(
    root: Path, slug: str, snapshot_id: str
) -> tuple[str, list[str]]:
    directory = root / "agents" / slug / "snapshots" / snapshot_id / "published"
    if not directory.is_dir() or directory.is_symlink():
        return "invalid", [f"{_relative(root, directory)}: missing or unsafe"]
    observed = {
        path.name
        for path in directory.iterdir()
        if path.is_file() and not path.is_symlink()
    }
    if observed == UNRESOLVED_PUBLISHED_FILES:
        return "unresolved", []
    if observed == RESOLVED_PUBLISHED_FILES:
        return "resolved", []
    return (
        "invalid",
        [
            f"{_relative(root, directory)}: must contain either resolution.json or "
            "the complete sanitized published artifact set"
        ],
    )


def _expected_file_inventory(
    snapshot_ids: list[str], layouts: Mapping[tuple[str, str], str]
) -> set[str]:
    expected = {
        "README.md",
        "tools/validate_workspace.py",
        NONURGENT_CONTRACT_RELATIVE_PATH,
    }
    expected.update(f"agents/{slug}/manifest.json" for slug in EXPECTED_AGENTS)
    for snapshot_id in snapshot_ids:
        expected.update(
            {
                f"snapshots/{snapshot_id}/audit-manifest.json",
                f"snapshots/{snapshot_id}/integrity.json",
            }
        )
        for slug in EXPECTED_AGENTS:
            prefix = f"agents/{slug}/snapshots/{snapshot_id}"
            expected.add(f"{prefix}/comparison.json")
            expected.update(f"{prefix}/draft/{name}" for name in DRAFT_ARTIFACTS)
            if layouts.get((slug, snapshot_id)) == "resolved":
                expected.update(
                    f"{prefix}/published/{name}" for name in DRAFT_ARTIFACTS
                )
            elif layouts.get((slug, snapshot_id)) == "unresolved":
                expected.add(f"{prefix}/published/resolution.json")
    return expected


def _observed_file_inventory(root: Path) -> tuple[set[str], list[str]]:
    files: set[str] = set()
    problems: list[str] = []
    for path in root.rglob("*"):
        relative = PurePosixPath(_relative(root, path))
        if path.is_symlink():
            problems.append(f"{relative.as_posix()}: symbolic links are prohibited")
        elif path.is_file():
            if "__pycache__" in relative.parts and path.suffix == ".pyc":
                continue
            files.add(relative.as_posix())
    return files, problems


def _validate_readme(root: Path) -> list[str]:
    path = root / "README.md"
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        return [f"README.md: unreadable: {exc}"]

    problems: list[str] = []
    if len(text.encode("utf-8")) > 12_000:
        problems.append("README.md: exceeds the bounded public size")
    required = (
        "7-Day Free Test",
        "Revenue Desk — Master Template",
        "Modify a draft only",
        "Complete raw responses",
        "published configuration did not resolve",
        "No Retell API call is required",
        "runtime-derived variable names",
    )
    if any(marker not in text for marker in required):
        problems.append("README.md: required public-boundary statement is missing")
    for regex, label in (
        (URL_RE, "URL"),
        (EMAIL_RE, "email"),
        (FORMATTED_PHONE_RE, "phone"),
        (E164_PHONE_RE, "phone"),
        (PRECISE_TIMESTAMP_RE, "precise timestamp"),
        (SECRET_RE, "credential"),
    ):
        if regex.search(text):
            problems.append(f"README.md: {label} value is prohibited")
    if "C:\\Users\\" in text or "C:/Users/" in text:
        problems.append("README.md: private filesystem path is prohibited")
    return problems


def _expected_integrity_paths(
    snapshot_id: str, layouts: Mapping[tuple[str, str], str]
) -> set[str]:
    expected = {f"snapshots/{snapshot_id}/audit-manifest.json"}
    for slug in EXPECTED_AGENTS:
        prefix = f"agents/{slug}/snapshots/{snapshot_id}"
        expected.add(f"{prefix}/comparison.json")
        expected.update(f"{prefix}/draft/{name}" for name in DRAFT_ARTIFACTS)
        if layouts.get((slug, snapshot_id)) == "resolved":
            expected.update(f"{prefix}/published/{name}" for name in DRAFT_ARTIFACTS)
        else:
            expected.add(f"{prefix}/published/resolution.json")
    return expected


def _validate_integrity(
    root: Path,
    snapshot_id: str,
    layouts: Mapping[tuple[str, str], str],
) -> list[str]:
    path = root / "snapshots" / snapshot_id / "integrity.json"
    document, problems = _load_json(root, path)
    context = _relative(root, path)
    if not isinstance(document, Mapping):
        return problems or [f"{context}: must be an object"]

    allowed_keys = {
        "schema_version",
        "snapshot_id",
        "algorithm",
        "scope",
        "canonicalization",
        "files",
    }
    fixed = {
        "schema_version": 1,
        "snapshot_id": snapshot_id,
        "algorithm": "sha256",
        "scope": "sanitized-artifacts-only",
        "canonicalization": "sha256-over-repository-file-bytes",
    }
    if set(document) != allowed_keys or any(
        document.get(key) != value for key, value in fixed.items()
    ):
        problems.append(f"{context}: exact integrity schema mismatch")

    entries = document.get("files")
    if not isinstance(entries, list):
        return problems + [f"{context}/files: must be a list"]

    expected_paths = _expected_integrity_paths(snapshot_id, layouts)
    observed_paths: set[str] = set()
    previous_path = ""
    for index, entry in enumerate(entries):
        entry_context = f"{context}/files/{index}"
        if not isinstance(entry, Mapping) or set(entry) != {"path", "sha256"}:
            problems.append(f"{entry_context}: exact entry schema mismatch")
            continue
        relative = entry.get("path")
        digest = entry.get("sha256")
        if not isinstance(relative, str):
            problems.append(f"{entry_context}/path: must be a string")
            continue
        pure = PurePosixPath(relative)
        if pure.is_absolute() or ".." in pure.parts or "\\" in relative:
            problems.append(f"{entry_context}/path: unsafe path")
            continue
        if relative <= previous_path:
            problems.append(f"{entry_context}/path: entries must be unique and sorted")
        previous_path = relative
        observed_paths.add(relative)
        if not isinstance(digest, str) or SHA256_RE.fullmatch(digest) is None:
            problems.append(f"{entry_context}/sha256: invalid digest")
            continue
        artifact = root.joinpath(*pure.parts)
        if not artifact.is_file() or artifact.is_symlink():
            problems.append(f"{entry_context}: artifact is missing or unsafe")
        elif hashlib.sha256(artifact.read_bytes()).hexdigest() != digest:
            problems.append(f"{entry_context}/sha256: digest does not match artifact")

    missing = sorted(expected_paths - observed_paths)
    extra = sorted(observed_paths - expected_paths)
    if missing:
        problems.append(f"{context}: missing integrity paths: {', '.join(missing)}")
    if extra:
        problems.append(f"{context}: unexpected integrity paths: {', '.join(extra)}")
    return problems


def validate_workspace(root: Path = RETELL_ROOT) -> list[str]:
    problems: list[str] = []
    if not root.is_dir() or root.is_symlink():
        return [f"{root}: Retell workspace is missing or unsafe"]

    observed_files, inventory_problems = _observed_file_inventory(root)
    problems.extend(inventory_problems)

    agent_root = root / "agents"
    observed_slugs = (
        {
            path.name
            for path in agent_root.iterdir()
            if path.is_dir() and not path.is_symlink()
        }
        if agent_root.is_dir()
        else set()
    )
    if observed_slugs != set(EXPECTED_AGENTS):
        problems.append("Retell workspace must contain exactly the two managed agent trees")

    snapshot_root = root / "snapshots"
    snapshot_ids = (
        sorted(
            path.name
            for path in snapshot_root.iterdir()
            if path.is_dir() and not path.is_symlink()
        )
        if snapshot_root.is_dir()
        else []
    )
    if not snapshot_ids:
        problems.append("Retell workspace contains no sanitized snapshots")
    if any(SNAPSHOT_ID_RE.fullmatch(item) is None for item in snapshot_ids):
        problems.append("Retell workspace has an invalid append-only snapshot identifier")

    layouts: dict[tuple[str, str], str] = {}
    for slug in EXPECTED_AGENTS:
        agent_snapshot_root = root / "agents" / slug / "snapshots"
        observed_agent_snapshots = (
            {
                path.name
                for path in agent_snapshot_root.iterdir()
                if path.is_dir() and not path.is_symlink()
            }
            if agent_snapshot_root.is_dir()
            else set()
        )
        if observed_agent_snapshots != set(snapshot_ids):
            problems.append(f"agents/{slug}: snapshot registrations do not match")
        for snapshot_id in snapshot_ids:
            layout, layout_problems = _read_published_layout(
                root, slug, snapshot_id
            )
            layouts[(slug, snapshot_id)] = layout
            problems.extend(layout_problems)

    expected_files = _expected_file_inventory(snapshot_ids, layouts)
    missing_files = sorted(expected_files - observed_files)
    extra_files = sorted(observed_files - expected_files)
    if missing_files:
        problems.append(f"Missing public files: {', '.join(missing_files)}")
    if extra_files:
        problems.append(f"Unexpected public files: {', '.join(extra_files)}")

    problems.extend(_validate_readme(root))
    problems.extend(
        _validate_exact_document(
            root,
            root.joinpath(*PurePosixPath(NONURGENT_CONTRACT_RELATIVE_PATH).parts),
            NONURGENT_CLASSIFICATION_CONTRACT,
        )
    )
    for slug, (local_key, display_name) in EXPECTED_AGENTS.items():
        manifest_path = root / "agents" / slug / "manifest.json"
        problems.extend(
            _validate_exact_document(
                root,
                manifest_path,
                _expected_manifest(local_key, display_name, snapshot_ids),
            )
        )

    for snapshot_id in snapshot_ids:
        problems.extend(
            _validate_exact_document(
                root,
                root / "snapshots" / snapshot_id / "audit-manifest.json",
                _expected_audit(snapshot_id, layouts),
            )
        )
        for slug, (local_key, display_name) in EXPECTED_AGENTS.items():
            base = root / "agents" / slug / "snapshots" / snapshot_id
            for name in DRAFT_ARTIFACTS:
                problems.extend(
                    _validate_exact_document(
                        root,
                        base / "draft" / name,
                        _expected_artifact(
                            root,
                            slug,
                            snapshot_id,
                            local_key,
                            display_name,
                            "draft",
                            name,
                        ),
                    )
                )

            layout = layouts.get((slug, snapshot_id), "invalid")
            if layout == "resolved":
                for name in DRAFT_ARTIFACTS:
                    problems.extend(
                        _validate_exact_document(
                            root,
                            base / "published" / name,
                            _expected_artifact(
                                root,
                                slug,
                                snapshot_id,
                                local_key,
                                display_name,
                                "published",
                                name,
                            ),
                        )
                    )
            elif layout == "unresolved":
                problems.extend(
                    _validate_exact_document(
                        root,
                        base / "published" / "resolution.json",
                        _expected_resolution(snapshot_id, local_key, display_name),
                    )
                )
            problems.extend(
                _validate_exact_document(
                    root,
                    base / "comparison.json",
                    _expected_comparison(
                        root,
                        slug,
                        snapshot_id,
                        local_key,
                        display_name,
                        layout,
                    ),
                )
            )
        problems.extend(_validate_integrity(root, snapshot_id, layouts))

    return sorted(set(problems))


def main() -> int:
    problems = validate_workspace()
    if problems:
        print("Retell workspace validation failed:")
        for problem in problems:
            print(f"- {problem}")
        return 1
    print("Retell workspace validation passed (offline; no Retell calls performed).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
