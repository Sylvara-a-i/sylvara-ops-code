#!/usr/bin/env python3
"""Enforce a fail-closed, read-only GitHub Actions policy."""

from __future__ import annotations

import re
import sys
from collections.abc import Mapping
from pathlib import Path, PurePosixPath
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[2]
FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
ALLOWED_ACTION_OWNERS = {"actions", "github"}
REQUIRED_NODE_VERSION = "24"
REQUIRED_RUNNER = "ubuntu-24.04"
MAX_JOB_TIMEOUT_MINUTES = 30
PERMISSION_VALUES = {"none", "read", "write"}


class GitHubActionsLoader(yaml.SafeLoader):
    """Parse GitHub workflow YAML with YAML 1.2 booleans and unique keys."""


# PyYAML uses YAML 1.1 by default, which incorrectly resolves the key `on` as
# True. Copy the resolver table, remove that rule, and restore true/false only.
GitHubActionsLoader.yaml_implicit_resolvers = {
    key: list(resolvers)
    for key, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
}
for first_character, resolvers in GitHubActionsLoader.yaml_implicit_resolvers.items():
    GitHubActionsLoader.yaml_implicit_resolvers[first_character] = [
        resolver
        for resolver in resolvers
        if resolver[0] != "tag:yaml.org,2002:bool"
    ]
GitHubActionsLoader.add_implicit_resolver(
    "tag:yaml.org,2002:bool",
    re.compile(r"^(?:true|false)$", re.IGNORECASE),
    list("tTfF"),
)


def _construct_unique_mapping(
    loader: GitHubActionsLoader, node: yaml.MappingNode, deep: bool = False
) -> dict[Any, Any]:
    loader.flatten_mapping(node)
    mapping: dict[Any, Any] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in mapping:
            raise yaml.constructor.ConstructorError(
                "while constructing a mapping",
                node.start_mark,
                f"duplicate key: {key!r}",
                key_node.start_mark,
            )
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


GitHubActionsLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    _construct_unique_mapping,
)


def _lower(value: object) -> str:
    return str(value).strip().lower()


def _trigger_names(value: object) -> set[str]:
    if isinstance(value, Mapping):
        return {_lower(key) for key in value}
    if isinstance(value, list):
        return {_lower(item) for item in value}
    if value is None:
        return set()
    return {_lower(value)}


def _permissions(value: object) -> dict[str, str] | None:
    if not isinstance(value, Mapping):
        return None
    return {_lower(key): _lower(permission) for key, permission in value.items()}


def _validate_permission_mapping(
    permissions: dict[str, str], context: str
) -> list[str]:
    problems: list[str] = []
    for name, value in permissions.items():
        if value not in PERMISSION_VALUES:
            problems.append(f"{context} {name} permission has invalid value: {value}")
        elif value == "write":
            problems.append(f"{context} {name}: write permission is prohibited")
    return problems


def _validate_action_reference(reference: object, context: str) -> list[str]:
    if not isinstance(reference, str) or not reference.strip():
        return [f"{context} action reference must be a non-empty string"]
    reference = reference.strip()
    if reference.startswith("./"):
        local_path = PurePosixPath(reference[2:])
        if local_path.is_absolute() or ".." in local_path.parts:
            return [f"{context} local action path is unsafe: {reference}"]
        return []
    if "@" not in reference:
        return [f"{context} action reference is not pinned: {reference}"]
    action, revision = reference.rsplit("@", 1)
    if not action or not FULL_SHA_RE.fullmatch(revision):
        return [f"{context} action reference must use a full commit SHA: {reference}"]
    owner = action.split("/", 1)[0].lower()
    if owner not in ALLOWED_ACTION_OWNERS:
        return [f"{context} action owner is not allowlisted: {owner}"]
    return []


def _persist_credentials_disabled(value: object) -> bool:
    return value is False or (isinstance(value, str) and value.lower() == "false")


def _valid_timeout(value: object) -> bool:
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and 1 <= value <= MAX_JOB_TIMEOUT_MINUTES
    )


def _string_uses_secrets_context(value: str) -> bool:
    """Return whether a GitHub expression references the secrets context.

    Expression string literals are skipped so a literal word such as
    ``'secrets'`` is not confused with the privileged GitHub context. GitHub
    expressions escape a single quote by doubling it.
    """
    lowered = value.lower()
    search_from = 0
    while True:
        expression_start = value.find("${{", search_from)
        if expression_start < 0:
            return False

        index = expression_start + 3
        in_string = False
        while index < len(value):
            character = value[index]
            if character == "'":
                if in_string and index + 1 < len(value) and value[index + 1] == "'":
                    index += 2
                    continue
                in_string = not in_string
                index += 1
                continue

            if not in_string:
                if value.startswith("}}", index):
                    search_from = index + 2
                    break
                if lowered.startswith("secrets", index):
                    before = value[index - 1] if index > expression_start + 3 else ""
                    after_index = index + len("secrets")
                    after = value[after_index] if after_index < len(value) else ""
                    if (not before or not (before.isalnum() or before == "_")) and (
                        not after or not (after.isalnum() or after == "_")
                    ):
                        return True
            index += 1
        else:
            # An unclosed expression is invalid at runtime. Continue scanning its
            # complete tail so it cannot conceal a secrets-context reference.
            return False


def _uses_secrets_context(value: object, visited: set[int] | None = None) -> bool:
    """Recursively inspect all workflow scalar values and mapping keys."""
    if isinstance(value, str):
        return _string_uses_secrets_context(value)
    if not isinstance(value, (Mapping, list)):
        return False

    if visited is None:
        visited = set()
    object_id = id(value)
    if object_id in visited:
        return False
    visited.add(object_id)

    if isinstance(value, Mapping):
        return any(
            _uses_secrets_context(key, visited)
            or _uses_secrets_context(item, visited)
            for key, item in value.items()
        )
    return any(_uses_secrets_context(item, visited) for item in value)


def validate_workflow(path: Path, text: str) -> list[str]:
    rel = path.as_posix()
    problems: list[str] = []
    try:
        document = yaml.load(text, Loader=GitHubActionsLoader)
    except yaml.YAMLError as exc:
        return [f"{rel}: workflow YAML is invalid or ambiguous: {exc}"]
    if not isinstance(document, Mapping):
        return [f"{rel}: workflow must be a YAML mapping"]

    if _uses_secrets_context(document):
        problems.append("GitHub Actions secrets context is prohibited")

    top_permissions_raw = document.get("permissions")
    top_permissions = _permissions(top_permissions_raw)
    if top_permissions is None:
        problems.append("top-level permissions must be an explicit mapping")
        top_permissions = {}
    else:
        problems.extend(_validate_permission_mapping(top_permissions, "top-level"))
    if top_permissions.get("contents") != "read":
        problems.append("top-level permissions must include contents: read")

    if "pull_request_target" in _trigger_names(document.get("on")):
        problems.append("pull_request_target is prohibited")

    jobs = document.get("jobs")
    if not isinstance(jobs, Mapping) or not jobs:
        problems.append("workflow must define at least one job")
        return [f"{rel}: {problem}" for problem in problems]

    for raw_job_name, raw_job in jobs.items():
        job_name = str(raw_job_name)
        if not isinstance(raw_job, Mapping):
            problems.append(f"job {job_name} must be a mapping")
            continue

        if "container" in raw_job:
            problems.append(f"job {job_name} container usage is not approved")
        if "services" in raw_job:
            problems.append(f"job {job_name} services usage is not approved")

        if raw_job.get("runs-on") != REQUIRED_RUNNER:
            problems.append(f"job {job_name} runner must be exactly {REQUIRED_RUNNER}")
        if not _valid_timeout(raw_job.get("timeout-minutes")):
            problems.append(
                f"job {job_name} timeout-minutes must be an integer from 1 to "
                f"{MAX_JOB_TIMEOUT_MINUTES}"
            )

        job_permissions_raw = raw_job.get("permissions", top_permissions_raw)
        job_permissions = _permissions(job_permissions_raw)
        if job_permissions is None:
            problems.append(f"job {job_name} permissions must resolve to a mapping")
            job_permissions = {}
        else:
            problems.extend(
                _validate_permission_mapping(job_permissions, f"job {job_name}")
            )

        if "uses" in raw_job:
            problems.extend(
                _validate_action_reference(raw_job.get("uses"), f"job {job_name}")
            )
            problems.append(f"job {job_name} reusable workflow calls are not approved")

        steps = raw_job.get("steps")
        if not isinstance(steps, list) or not steps:
            problems.append(f"job {job_name} steps must be a non-empty list")
            continue
        for index, step in enumerate(steps, start=1):
            if not isinstance(step, Mapping):
                problems.append(f"job {job_name} step {index} must be a mapping")
                continue
            reference = step.get("uses")
            if reference is not None:
                problems.extend(
                    _validate_action_reference(
                        reference, f"job {job_name} step {index}"
                    )
                )

            step_with = step.get("with", {})
            if isinstance(reference, str) and reference.lower().startswith(
                "actions/checkout@"
            ):
                persist = (
                    step_with.get("persist-credentials")
                    if isinstance(step_with, Mapping)
                    else None
                )
                if not _persist_credentials_disabled(persist):
                    problems.append(
                        f"job {job_name} step {index} must set persist-credentials: false"
                    )

            if isinstance(reference, str) and reference.lower().startswith(
                "actions/setup-node@"
            ):
                if not isinstance(step_with, Mapping):
                    problems.append(
                        f"job {job_name} setup-node must pin node-version: "
                        f"{REQUIRED_NODE_VERSION}"
                    )
                else:
                    if "node-version-file" in step_with:
                        problems.append(f"job {job_name} node-version-file is prohibited")
                    if str(step_with.get("node-version", "")).strip() != REQUIRED_NODE_VERSION:
                        problems.append(
                            f"job {job_name} setup-node must pin Node.js "
                            f"{REQUIRED_NODE_VERSION}"
                        )

    return [f"{rel}: {problem}" for problem in problems]


def validate_repository(root: Path = ROOT) -> list[str]:
    workflow_directory = root / ".github" / "workflows"
    paths = sorted(
        (*workflow_directory.glob("*.yml"), *workflow_directory.glob("*.yaml"))
    )
    if not paths:
        return ["No GitHub Actions workflows were found"]
    problems: list[str] = []
    for path in paths:
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            problems.append(f"Could not read workflow as UTF-8 text {path}: {exc}")
            continue
        problems.extend(validate_workflow(path.relative_to(root), text))
    return problems


def main() -> int:
    problems = validate_repository()
    if problems:
        print("Workflow security policy violations:\n")
        for problem in problems:
            print(f"- {problem}")
        return 1

    print("Workflow security policy passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
