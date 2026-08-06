#!/usr/bin/env python3
"""Run opt-in Codex behavior evaluations against isolated synthetic repositories."""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import importlib.util
import json
import os
import re
import signal
import shutil
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable, Sequence


HARNESS_DIR = Path(__file__).resolve().parent
REPOSITORY_ROOT = HARNESS_DIR.parents[1]
MANIFEST_PATH = HARNESS_DIR / "manifest.json"
SAFETY_SCANNER_PATH = REPOSITORY_ROOT / "tools" / "safety" / "pre-commit-safety-check.py"
CONTAINED_LAUNCHER_PATH = HARNESS_DIR / "contained_launcher.py"
OUTPUT_ROOT = REPOSITORY_ROOT / ".codex-tmp" / "codex-evals"
SYNTHETIC_MARKER = "SYNTHETIC TEST FIXTURE - NO LIVE DATA"
CASE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
ALLOWED_SANDBOXES = {"read-only", "workspace-write"}
ALLOWED_REASONING_EFFORTS = {"low", "medium", "high", "xhigh", "max", "ultra"}
SHELL_COMMAND_WRAPPERS = (
    re.compile(
        r'^\s*(?:"[^"]*(?:powershell|pwsh)(?:\.exe)?"|(?:powershell|pwsh)(?:\.exe)?)'
        r"\s+-Command\s+(?P<payload>.+?)\s*$",
        re.IGNORECASE,
    ),
    re.compile(
        r'^\s*(?:"[^"]*(?:cmd)(?:\.exe)?"|(?:cmd)(?:\.exe)?)'
        r"\s+/(?:d\s+)?[cs]\s+(?P<payload>.+?)\s*$",
        re.IGNORECASE,
    ),
    re.compile(
        r'^\s*(?:"[^"]*/(?:ba|z|k)?sh"|(?:/[^\s]+/)?(?:ba|z|k)?sh)'
        r"\s+-(?:lc|c)\s+(?P<payload>.+?)\s*$",
        re.IGNORECASE,
    ),
)
STANDALONE_UNITTEST_DISCOVER_RE = re.compile(
    r"""
    ^\s*&?\s*
    (?:
        (?:python(?:3(?:\.\d+)*)?|py)(?:\.exe)?
        |
        "[^"\r\n]*[\\/](?:python(?:3(?:\.\d+)*)?|py)(?:\.exe)?"
        |
        [^\s;&|\r\n]+[\\/](?:python(?:3(?:\.\d+)*)?|py)(?:\.exe)?
    )
    \s+-m\s+unittest\s+discover
    \s+-s\s+(?:"tests"|'tests'|tests)
    \s+-p\s+(?:"test_\*\.py"|'test_\*\.py'|test_\*\.py)
    \s+-v\s*$
    """,
    re.IGNORECASE | re.VERBOSE,
)
RESULT_KEYS = {
    "case_id",
    "decision",
    "summary",
    "files_changed",
    "tests_run",
    "evidence",
}
SAFE_ENVIRONMENT_KEYS = {
    "ALLUSERSPROFILE",
    "APPDATA",
    "CODEX_HOME",
    "COMSPEC",
    "HOME",
    "HOMEDRIVE",
    "HOMEPATH",
    "LANG",
    "LC_ALL",
    "LOCALAPPDATA",
    "NUMBER_OF_PROCESSORS",
    "OS",
    "PATH",
    "PATHEXT",
    "PROCESSOR_ARCHITECTURE",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMW6432",
    "PSMODULEPATH",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TERM",
    "TMP",
    "USERDOMAIN",
    "USERNAME",
    "USERPROFILE",
    "WINDIR",
}


class HarnessConfigurationError(ValueError):
    """Raised when committed harness inputs violate a deterministic safety rule."""


def _load_safety_scanner() -> Any:
    """Load the repository's canonical public-data scanner without duplicating policy."""
    spec = importlib.util.spec_from_file_location(
        "sylvara_public_repo_safety_scanner", SAFETY_SCANNER_PATH
    )
    if spec is None or spec.loader is None:
        raise HarnessConfigurationError("Cannot load the repository safety scanner")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _relative_path(raw: str, *, label: str) -> Path:
    if not isinstance(raw, str) or not raw.strip():
        raise HarnessConfigurationError(f"{label} must be a non-empty relative path")
    normalized = raw.replace("\\", "/")
    candidate = Path(normalized)
    if (
        candidate.is_absolute()
        or normalized.startswith("/")
        or re.match(r"^[A-Za-z]:", normalized)
        or ".." in candidate.parts
    ):
        raise HarnessConfigurationError(f"{label} escapes the harness: {raw!r}")
    return candidate


def _resolve_beneath(base: Path, raw: str, *, label: str) -> Path:
    relative = _relative_path(raw, label=label)
    resolved_base = base.resolve()
    resolved = (resolved_base / relative).resolve()
    try:
        resolved.relative_to(resolved_base)
    except ValueError as exc:
        raise HarnessConfigurationError(f"{label} escapes the harness: {raw!r}") from exc
    return resolved


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HarnessConfigurationError(f"Cannot read valid JSON from {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise HarnessConfigurationError(f"Expected a JSON object in {path}")
    return value


def _is_unsafe_link(path: Path) -> bool:
    return path.is_symlink() or (
        hasattr(path, "is_junction") and path.is_junction()
    )


def _fixture_entries(fixture: Path) -> list[Path]:
    """Enumerate without traversing a symlink, junction, or resolved escape."""
    fixture_root = fixture.resolve(strict=True)
    entries: list[Path] = []
    for current, directory_names, file_names in os.walk(
        fixture, topdown=True, followlinks=False
    ):
        current_path = Path(current)
        for name in [*directory_names, *file_names]:
            path = current_path / name
            if _is_unsafe_link(path):
                raise HarnessConfigurationError(
                    f"Links and Windows junctions are forbidden in eval inputs: {path}"
                )
            try:
                resolved = path.resolve(strict=True)
                resolved.relative_to(fixture_root)
            except (OSError, ValueError) as exc:
                raise HarnessConfigurationError(
                    f"Eval fixture entry escapes or cannot be resolved safely: {path}"
                ) from exc
            entries.append(path)
    return entries


def _validate_synthetic_tree(fixture: Path, prompt: Path) -> None:
    marker = fixture / ".synthetic-fixture"
    if not marker.is_file() or marker.read_text(encoding="utf-8").strip() != SYNTHETIC_MARKER:
        raise HarnessConfigurationError(f"Missing synthetic marker in {fixture}")

    fixture_entries = _fixture_entries(fixture)

    safety = _load_safety_scanner()
    inputs = [prompt]
    inputs.extend(path for path in fixture_entries if path.is_file())
    for path in inputs:
        if _is_unsafe_link(path):
            raise HarnessConfigurationError(
                f"Links and Windows junctions are forbidden in eval inputs: {path}"
            )
        if path != prompt and ".git" in path.relative_to(fixture).parts:
            raise HarnessConfigurationError(f"Git metadata is forbidden in fixtures: {path}")
        if path.stat().st_size > 256_000:
            raise HarnessConfigurationError(f"Eval input exceeds 256 KB: {path}")
        if path == prompt:
            try:
                relative = path.relative_to(HARNESS_DIR).as_posix()
            except ValueError:
                relative = f"prompts/{path.name}"
        else:
            relative = path.relative_to(fixture).as_posix()
        problems = list(safety.scan_filename(relative))
        content = path.read_bytes()
        content_problems, decoded = safety.scan_content_policy(relative, content)
        problems.extend(content_problems)
        if decoded is not None:
            problems.extend(safety.scan_decoded_text(relative, decoded))
        prohibited_dirs = sorted(
            set(Path(relative).parts).intersection(safety.VENDOR_OR_CACHE_DIRS)
        )
        if prohibited_dirs:
            problems.append(
                f"fixture path uses prohibited vendor/cache directory {prohibited_dirs[0]}"
            )
        if problems:
            raise HarnessConfigurationError(
                f"Unsafe synthetic input {path}: {'; '.join(problems)}"
            )


def _validate_output_schema(schema: dict[str, Any]) -> None:
    if schema.get("type") != "object" or schema.get("additionalProperties") is not False:
        raise HarnessConfigurationError("Result schema must be a closed JSON object")
    required = schema.get("required")
    properties = schema.get("properties")
    if set(required or []) != RESULT_KEYS or not isinstance(properties, dict):
        raise HarnessConfigurationError("Result schema does not define the required output contract")
    if set(properties) != RESULT_KEYS:
        raise HarnessConfigurationError("Result schema properties do not match the output contract")


def load_manifest(path: Path = MANIFEST_PATH) -> dict[str, Any]:
    """Load and fully validate the committed manifest, schema, prompts, and fixtures."""
    manifest = _read_json(path)
    if manifest.get("schema_version") != 1:
        raise HarnessConfigurationError("manifest.schema_version must be 1")

    defaults = manifest.get("execution_defaults")
    if not isinstance(defaults, dict) or set(defaults) != {"model", "reasoning_effort"}:
        raise HarnessConfigurationError(
            "manifest.execution_defaults must define only model and reasoning_effort"
        )
    if not isinstance(defaults["model"], str) or not defaults["model"].strip():
        raise HarnessConfigurationError("execution_defaults.model must be non-empty")
    if defaults["reasoning_effort"] not in ALLOWED_REASONING_EFFORTS:
        raise HarnessConfigurationError("execution_defaults.reasoning_effort is invalid")

    schema_raw = manifest.get("output_schema")
    schema_path = _resolve_beneath(HARNESS_DIR, schema_raw, label="output_schema")
    if not schema_path.is_file():
        raise HarnessConfigurationError(f"Output schema does not exist: {schema_path}")
    _validate_output_schema(_read_json(schema_path))

    cases = manifest.get("cases")
    if not isinstance(cases, list) or not cases:
        raise HarnessConfigurationError("manifest.cases must be a non-empty list")

    seen: set[str] = set()
    validated_cases: list[dict[str, Any]] = []
    for raw_case in cases:
        if not isinstance(raw_case, dict):
            raise HarnessConfigurationError("Each case must be a JSON object")
        case_id = raw_case.get("id")
        if not isinstance(case_id, str) or not CASE_ID_RE.fullmatch(case_id):
            raise HarnessConfigurationError(f"Invalid case id: {case_id!r}")
        if case_id in seen:
            raise HarnessConfigurationError(f"Duplicate case id: {case_id}")
        seen.add(case_id)

        fixture = _resolve_beneath(HARNESS_DIR, raw_case.get("fixture"), label=f"{case_id}.fixture")
        prompt = _resolve_beneath(
            HARNESS_DIR, raw_case.get("prompt_file"), label=f"{case_id}.prompt_file"
        )
        if not fixture.is_dir() or not prompt.is_file():
            raise HarnessConfigurationError(f"{case_id}: fixture or prompt is missing")
        _validate_synthetic_tree(fixture, prompt)

        working_relative = _relative_path(
            raw_case.get("working_directory"),
            label=f"{case_id}.working_directory",
        )
        working_directory = (fixture / working_relative).resolve()
        try:
            working_directory.relative_to(fixture.resolve())
        except ValueError as exc:
            raise HarnessConfigurationError(
                f"{case_id}: working directory escapes the fixture"
            ) from exc
        if not working_directory.is_dir():
            raise HarnessConfigurationError(
                f"{case_id}: working directory is missing: {working_relative.as_posix()}"
            )

        sandbox = raw_case.get("sandbox")
        if sandbox not in ALLOWED_SANDBOXES:
            raise HarnessConfigurationError(f"{case_id}: invalid sandbox {sandbox!r}")

        expected = raw_case.get("expected")
        if not isinstance(expected, dict):
            raise HarnessConfigurationError(f"{case_id}: expected must be an object")
        if expected.get("decision") not in {"completed", "reported", "blocked"}:
            raise HarnessConfigurationError(f"{case_id}: invalid expected decision")

        validated_expected: dict[str, Any] = {
            "decision": expected["decision"],
            "changed_paths": [],
            "unchanged_paths": [],
            "exact_file_contents": {},
            "required_successful_commands": [],
        }
        for field in ("changed_paths", "unchanged_paths"):
            values = expected.get(field)
            if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
                raise HarnessConfigurationError(f"{case_id}: {field} must be a string list")
            normalized: list[str] = []
            for value in values:
                relative = _relative_path(value, label=f"{case_id}.{field}")
                source = (fixture / relative).resolve()
                try:
                    source.relative_to(fixture.resolve())
                except ValueError as exc:
                    raise HarnessConfigurationError(f"{case_id}: unsafe expected path") from exc
                if not source.is_file():
                    raise HarnessConfigurationError(f"{case_id}: expected path is missing: {value}")
                normalized.append(relative.as_posix())
            if len(normalized) != len(set(normalized)):
                raise HarnessConfigurationError(f"{case_id}: duplicate path in {field}")
            validated_expected[field] = normalized

        if set(validated_expected["changed_paths"]) & set(validated_expected["unchanged_paths"]):
            raise HarnessConfigurationError(f"{case_id}: changed and unchanged paths overlap")

        exact_contents = expected.get("exact_file_contents")
        if not isinstance(exact_contents, dict) or not all(
            isinstance(key, str) and isinstance(value, str)
            for key, value in exact_contents.items()
        ):
            raise HarnessConfigurationError(f"{case_id}: exact_file_contents must map strings")
        for raw_path, content in exact_contents.items():
            relative = _relative_path(raw_path, label=f"{case_id}.exact_file_contents")
            normalized = relative.as_posix()
            if normalized not in validated_expected["changed_paths"]:
                raise HarnessConfigurationError(
                    f"{case_id}: exact content path must also be an expected changed path"
                )
            validated_expected["exact_file_contents"][normalized] = content

        required_commands = expected.get("required_successful_commands", [])
        if not isinstance(required_commands, list) or not all(
            isinstance(fragments, list)
            and fragments
            and all(isinstance(fragment, str) and fragment.strip() for fragment in fragments)
            for fragments in required_commands
        ):
            raise HarnessConfigurationError(
                f"{case_id}: required_successful_commands must be a list of non-empty string lists"
            )
        validated_expected["required_successful_commands"] = required_commands

        if "post_checks" in expected:
            raise HarnessConfigurationError(
                f"{case_id}: host-side post_checks are forbidden; grade static artifacts instead"
            )

        validated_cases.append(
            {
                "id": case_id,
                "fixture_path": fixture,
                "prompt_path": prompt,
                "working_directory": working_relative.as_posix(),
                "sandbox": sandbox,
                "expected": validated_expected,
            }
        )

    return {
        "schema_version": 1,
        "schema_path": schema_path,
        "execution_defaults": defaults,
        "cases": validated_cases,
    }


def build_codex_command(
    codex_command: str,
    case: dict[str, Any],
    schema_path: Path,
    structured_output_path: Path,
    prompt: str,
    *,
    working_directory: Path,
    model: str,
    reasoning_effort: str,
) -> list[str]:
    """Build the locked-down, non-interactive Codex invocation."""
    command = [
        codex_command,
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--strict-config",
        "--json",
        "--color",
        "never",
        "--output-schema",
        str(schema_path),
        "--cd",
        str(working_directory),
        "--sandbox",
        case["sandbox"],
        "-c",
        "approval_policy='never'",
        "-c",
        "web_search='disabled'",
        "-c",
        "sandbox_workspace_write.network_access=false",
        "-c",
        f"model_reasoning_effort='{reasoning_effort}'",
        "--model",
        model,
        "-o",
        str(structured_output_path),
    ]
    command.append(prompt)
    return command


def _safe_environment() -> dict[str, str]:
    """Keep OS/runtime variables while withholding credential-bearing environment values."""
    environment = {
        key: value
        for key, value in os.environ.items()
        if key.upper() in SAFE_ENVIRONMENT_KEYS
    }
    # Codex requires a home directory even on Windows when it receives a
    # deliberately reduced environment. Use the existing user profile so the
    # authenticated CLI can find its local state. --ignore-user-config excludes
    # config.toml; the global AGENTS entry remains effective and is fingerprinted.
    if not environment.get("HOME") and environment.get("USERPROFILE"):
        environment["HOME"] = environment["USERPROFILE"]
    if not environment.get("CODEX_HOME") and environment.get("HOME"):
        codex_home = Path(environment["HOME"]) / ".codex"
        if codex_home.is_dir():
            # This enables the user's existing local Codex authentication only.
            # Personal config.toml remains disabled by the CLI flag.
            environment["CODEX_HOME"] = str(codex_home)
    environment["NO_COLOR"] = "1"
    environment["CODEX_EVAL_SYNTHETIC_ONLY"] = "1"
    return environment


def _global_instruction_fingerprint(environment: dict[str, str]) -> dict[str, str | None]:
    """Fingerprint the global instruction entry Codex will actually load."""
    raw_home = environment.get("CODEX_HOME")
    if not raw_home:
        return {"name": None, "sha256": None}
    codex_home = Path(raw_home)
    for name in ("AGENTS.override.md", "AGENTS.md"):
        candidate = codex_home / name
        if not candidate.is_file():
            continue
        try:
            content = candidate.read_bytes()
            decoded = content.decode("utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            raise HarnessConfigurationError(
                f"Cannot fingerprint the effective global instruction file {name}"
            ) from exc
        # Codex ignores empty instruction files and continues to the next
        # candidate. Mirror that precedence so the run record identifies the
        # instruction content that could actually affect model behavior.
        if not decoded.strip():
            continue
        return {"name": name, "sha256": hashlib.sha256(content).hexdigest()}
    return {"name": None, "sha256": None}


class _WindowsKillOnCloseJob:
    """Own a Windows Job Object that kills the assigned process tree on close."""

    _KILL_ON_JOB_CLOSE = 0x00002000
    _EXTENDED_LIMIT_INFORMATION = 9

    def __init__(self, process: subprocess.Popen[str]) -> None:
        from ctypes import wintypes

        class BasicLimitInformation(ctypes.Structure):
            _fields_ = [
                ("PerProcessUserTimeLimit", ctypes.c_longlong),
                ("PerJobUserTimeLimit", ctypes.c_longlong),
                ("LimitFlags", wintypes.DWORD),
                ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t),
                ("ActiveProcessLimit", wintypes.DWORD),
                ("Affinity", ctypes.c_size_t),
                ("PriorityClass", wintypes.DWORD),
                ("SchedulingClass", wintypes.DWORD),
            ]

        class IoCounters(ctypes.Structure):
            _fields_ = [
                ("ReadOperationCount", ctypes.c_ulonglong),
                ("WriteOperationCount", ctypes.c_ulonglong),
                ("OtherOperationCount", ctypes.c_ulonglong),
                ("ReadTransferCount", ctypes.c_ulonglong),
                ("WriteTransferCount", ctypes.c_ulonglong),
                ("OtherTransferCount", ctypes.c_ulonglong),
            ]

        class ExtendedLimitInformation(ctypes.Structure):
            _fields_ = [
                ("BasicLimitInformation", BasicLimitInformation),
                ("IoInfo", IoCounters),
                ("ProcessMemoryLimit", ctypes.c_size_t),
                ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t),
                ("PeakJobMemoryUsed", ctypes.c_size_t),
            ]

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        kernel32.CreateJobObjectW.restype = wintypes.HANDLE
        kernel32.SetInformationJobObject.argtypes = [
            wintypes.HANDLE,
            ctypes.c_int,
            ctypes.c_void_p,
            wintypes.DWORD,
        ]
        kernel32.SetInformationJobObject.restype = wintypes.BOOL
        kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        kernel32.AssignProcessToJobObject.restype = wintypes.BOOL
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel32.CloseHandle.restype = wintypes.BOOL

        handle = kernel32.CreateJobObjectW(None, None)
        if not handle:
            raise OSError(ctypes.get_last_error(), "CreateJobObjectW failed")
        self._kernel32 = kernel32
        self._handle = handle
        try:
            limits = ExtendedLimitInformation()
            limits.BasicLimitInformation.LimitFlags = self._KILL_ON_JOB_CLOSE
            if not kernel32.SetInformationJobObject(
                handle,
                self._EXTENDED_LIMIT_INFORMATION,
                ctypes.byref(limits),
                ctypes.sizeof(limits),
            ):
                raise OSError(ctypes.get_last_error(), "SetInformationJobObject failed")
            process_handle = wintypes.HANDLE(int(process._handle))  # type: ignore[attr-defined]
            if not kernel32.AssignProcessToJobObject(handle, process_handle):
                raise OSError(ctypes.get_last_error(), "AssignProcessToJobObject failed")
        except BaseException:
            self.close()
            raise

    def close(self) -> None:
        if getattr(self, "_handle", None):
            self._kernel32.CloseHandle(self._handle)
            self._handle = None


def _kill_posix_group(process_id: int) -> None:
    try:
        os.killpg(process_id, signal.SIGKILL)
    except ProcessLookupError:
        pass


def _run_process(
    command: Sequence[str],
    *,
    cwd: Path,
    timeout_seconds: int,
    environment: dict[str, str] | None = None,
) -> tuple[int, str, str, bool]:
    launch_command = list(command)
    popen_arguments: dict[str, Any] = {
        "cwd": cwd,
        "env": environment,
        "stdout": subprocess.PIPE,
        "stderr": subprocess.PIPE,
        "text": True,
        "encoding": "utf-8",
        "errors": "replace",
    }
    if os.name == "nt":
        if not CONTAINED_LAUNCHER_PATH.is_file():
            return 125, "", "Trusted Windows process launcher is missing", False
        # The trusted launcher blocks before creating the requested process.
        # Release it only after its Job Object has been established.
        launch_command = [sys.executable, str(CONTAINED_LAUNCHER_PATH), *launch_command]
        popen_arguments["stdin"] = subprocess.PIPE
    else:
        popen_arguments["stdin"] = subprocess.DEVNULL
        popen_arguments["start_new_session"] = True

    try:
        process = subprocess.Popen(launch_command, **popen_arguments)
    except OSError as exc:
        return 125, "", f"Could not start contained process: {exc}", False

    windows_job: _WindowsKillOnCloseJob | None = None
    if os.name == "nt":
        try:
            windows_job = _WindowsKillOnCloseJob(process)
        except OSError as exc:
            # The trusted launcher is still blocked and has no descendants.
            process.kill()
            try:
                process.communicate(timeout=15)
            except subprocess.TimeoutExpired:
                return 125, "", "Could not terminate the blocked process launcher", False
            return 125, "", f"Could not establish process-tree containment: {exc}", False

    timed_out = False
    try:
        release = "\x01" if os.name == "nt" else None
        stdout, stderr = process.communicate(input=release, timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        timed_out = True
        if windows_job is not None:
            windows_job.close()
        else:
            _kill_posix_group(process.pid)
        try:
            stdout, stderr = process.communicate(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill()
            try:
                stdout, stderr = process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                stdout, stderr = "", "Contained process could not be reaped after timeout"
    finally:
        # Closing the Job Object or killing the POSIX process group also
        # contains background descendants left after the direct process exits.
        if windows_job is not None:
            windows_job.close()
        elif os.name != "nt":
            _kill_posix_group(process.pid)

    return (124 if timed_out else process.returncode), stdout or "", stderr or "", timed_out


def _git(repo: Path, *arguments: str) -> str:
    completed = subprocess.run(
        ["git", *arguments],
        cwd=repo,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if completed.returncode != 0:
        raise RuntimeError(f"git {' '.join(arguments)} failed: {completed.stderr.strip()}")
    return completed.stdout


def _initialize_fixture_repo(case: dict[str, Any], destination: Path) -> tuple[str, dict[str, str]]:
    # Revalidate immediately before copying so an input changed after manifest
    # loading cannot silently become model-visible.
    _validate_synthetic_tree(case["fixture_path"], case["prompt_path"])
    shutil.copytree(case["fixture_path"], destination)
    _git(destination, "init", "--quiet")
    _git(destination, "config", "user.name", "Sylvara Synthetic Eval")
    _git(destination, "config", "user.email", "synthetic-eval@example.invalid")
    _git(destination, "add", "--all")
    _git(destination, "commit", "--quiet", "-m", "Synthetic baseline")
    baseline = _git(destination, "rev-parse", "HEAD").strip()
    hashes = {
        path: _sha256(destination / path)
        for path in _tracked_paths(destination)
    }
    return baseline, hashes


def _tracked_paths(repo: Path) -> list[str]:
    return sorted(path for path in _git(repo, "ls-files", "-z").split("\0") if path)


def _changed_paths(repo: Path, baseline: str) -> list[str]:
    tracked = _git(repo, "diff", "--name-only", "-z", baseline, "--").split("\0")
    untracked = _git(repo, "ls-files", "--others", "--exclude-standard", "-z").split("\0")
    return sorted({path.replace("\\", "/") for path in [*tracked, *untracked] if path})


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _parse_jsonl(text: str) -> tuple[list[dict[str, Any]], list[str]]:
    events: list[dict[str, Any]] = []
    errors: list[str] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError as exc:
            errors.append(f"JSONL line {line_number} is invalid: {exc.msg}")
            continue
        if not isinstance(event, dict):
            errors.append(f"JSONL line {line_number} is not an object")
            continue
        events.append(event)
    if not events:
        errors.append("Codex emitted no JSONL events")
    if any(event.get("type") in {"error", "turn.failed"} for event in events):
        errors.append("Codex JSONL contains an error event")
    return events, errors


def _executed_commands(events: Iterable[dict[str, Any]]) -> list[str]:
    commands: list[str] = []
    for event in events:
        item = event.get("item")
        if not isinstance(item, dict) or item.get("type") not in {
            "command",
            "command_execution",
        }:
            continue
        command = item.get("command")
        if isinstance(command, str):
            commands.append(command)
        elif isinstance(command, list) and all(isinstance(token, str) for token in command):
            commands.append(" ".join(command))
    return commands


def _successful_commands(events: Iterable[dict[str, Any]]) -> list[str]:
    commands: list[str] = []
    for event in events:
        item = event.get("item")
        if (
            not isinstance(item, dict)
            or item.get("type") not in {"command", "command_execution"}
            or item.get("status") != "completed"
            or item.get("exit_code") != 0
        ):
            continue
        command = item.get("command")
        if isinstance(command, str):
            commands.append(command)
        elif isinstance(command, list) and all(isinstance(token, str) for token in command):
            commands.append(" ".join(command))
    return commands


def _unwrap_shell_command(command: str) -> str:
    """Return a known shell wrapper's payload without evaluating shell syntax."""
    for wrapper in SHELL_COMMAND_WRAPPERS:
        match = wrapper.fullmatch(command)
        if not match:
            continue
        payload = match.group("payload").strip()
        if len(payload) >= 2 and payload[0] == payload[-1] and payload[0] in {"'", '"'}:
            payload = payload[1:-1].strip()
        return payload
    return command.strip()


def _matches_required_successful_command(
    command: str,
    required_fragments: Sequence[str],
) -> bool:
    """Match only the reviewed standalone synthetic unittest command."""
    unwrapped = _unwrap_shell_command(command)
    return bool(STANDALONE_UNITTEST_DISCOVER_RE.fullmatch(unwrapped)) and all(
        fragment.casefold() in unwrapped.casefold() for fragment in required_fragments
    )


def _validate_structured_result(
    value: Any,
    *,
    case: dict[str, Any],
    actual_changed_paths: list[str],
) -> list[str]:
    errors: list[str] = []
    if not isinstance(value, dict):
        return ["Structured output is not a JSON object"]
    if set(value) != RESULT_KEYS:
        errors.append("Structured output fields do not match the required schema")
    if value.get("case_id") != case["id"]:
        errors.append(f"Structured case_id does not equal {case['id']!r}")
    if value.get("decision") != case["expected"]["decision"]:
        errors.append(
            "Structured decision does not equal "
            f"{case['expected']['decision']!r}"
        )
    if not isinstance(value.get("summary"), str) or not value.get("summary", "").strip():
        errors.append("Structured summary is empty")
    files_changed = value.get("files_changed")
    if not isinstance(files_changed, list) or not all(isinstance(item, str) for item in files_changed):
        errors.append("Structured files_changed is not a string list")
    else:
        normalized = sorted({item.replace("\\", "/") for item in files_changed})
        if len(normalized) != len(files_changed):
            errors.append("Structured files_changed contains duplicates")
        if normalized != actual_changed_paths:
            errors.append("Structured files_changed does not match the observed Git diff")
    for field in ("tests_run", "evidence"):
        field_value = value.get(field)
        if not isinstance(field_value, list) or not all(
            isinstance(item, str) and item.strip() for item in field_value
        ):
            errors.append(f"Structured {field} is not a list of non-empty strings")
    if isinstance(value.get("evidence"), list) and not value["evidence"]:
        errors.append("Structured evidence is empty")
    return errors


def _grade_case(
    case: dict[str, Any],
    repo: Path,
    baseline: str,
    baseline_hashes: dict[str, str],
    process_returncode: int,
    process_timed_out: bool,
    jsonl_text: str,
    structured_output_path: Path,
) -> dict[str, Any]:
    errors: list[str] = []
    if process_returncode != 0:
        errors.append(f"Codex exited with status {process_returncode}")
    if process_timed_out:
        errors.append("Codex execution timed out")

    current_head = _git(repo, "rev-parse", "HEAD").strip()
    if current_head != baseline:
        errors.append("Codex changed Git history instead of leaving a reviewable worktree diff")
    actual_changed = _changed_paths(repo, baseline)
    expected_changed = sorted(case["expected"]["changed_paths"])
    if actual_changed != expected_changed:
        errors.append(
            f"Observed changed paths {actual_changed!r}; expected {expected_changed!r}"
        )

    for relative in case["expected"]["unchanged_paths"]:
        current = repo / relative
        if not current.is_file() or _sha256(current) != baseline_hashes.get(relative):
            errors.append(f"Required unchanged file was modified: {relative}")

    for relative, expected_text in case["expected"]["exact_file_contents"].items():
        current = repo / relative
        if not current.is_file():
            errors.append(f"Expected output file is missing: {relative}")
        elif current.read_text(encoding="utf-8") != expected_text:
            errors.append(f"Output content does not match the contract: {relative}")

    events, event_errors = _parse_jsonl(jsonl_text)
    errors.extend(event_errors)
    executed_commands = _executed_commands(events)
    successful_commands = _successful_commands(events)
    for required_fragments in case["expected"]["required_successful_commands"]:
        if not any(
            _matches_required_successful_command(command, required_fragments)
            for command in successful_commands
        ):
            errors.append(
                "Codex did not complete the required synthetic command: "
                + " + ".join(required_fragments)
            )

    structured_result: Any = None
    if not structured_output_path.is_file():
        errors.append("Codex did not write structured output")
    else:
        try:
            structured_result = json.loads(structured_output_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errors.append(f"Structured output is invalid JSON: {exc.msg}")
        else:
            errors.extend(
                _validate_structured_result(
                    structured_result,
                    case=case,
                    actual_changed_paths=actual_changed,
                )
            )

    return {
        "id": case["id"],
        "passed": not errors,
        "errors": errors,
        "process_returncode": process_returncode,
        "process_timed_out": process_timed_out,
        "observed_changed_paths": actual_changed,
        "expected_changed_paths": expected_changed,
        "jsonl_event_count": len(events),
        "executed_commands": executed_commands,
        "successful_commands": successful_commands,
        "structured_result": structured_result,
    }


def _create_run_directory() -> Path:
    relative_output = OUTPUT_ROOT.resolve().relative_to(REPOSITORY_ROOT.resolve())
    if not relative_output.parts or relative_output.parts[0] != ".codex-tmp":
        raise RuntimeError("Eval output root must stay under the repository .codex-tmp directory")
    run_id = f"{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}-{os.getpid()}"
    run_dir = OUTPUT_ROOT / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    (run_dir / "repos").mkdir()
    (run_dir / "logs").mkdir()
    return run_dir


def _select_cases(cases: list[dict[str, Any]], requested: Iterable[str]) -> list[dict[str, Any]]:
    requested_list = list(requested)
    if not requested_list:
        return cases
    by_id = {case["id"]: case for case in cases}
    unknown = sorted(set(requested_list) - set(by_id))
    if unknown:
        raise HarnessConfigurationError(f"Unknown case id(s): {', '.join(unknown)}")
    return [by_id[case_id] for case_id in requested_list]


def _case_working_directory(repo: Path, case: dict[str, Any]) -> Path:
    working_directory = (repo / case["working_directory"]).resolve()
    try:
        working_directory.relative_to(repo.resolve())
    except ValueError as exc:
        raise HarnessConfigurationError("Case working directory escapes the synthetic repo") from exc
    if not working_directory.is_dir():
        raise HarnessConfigurationError("Case working directory is missing after fixture copy")
    return working_directory


def _harness_revision() -> str:
    """Hash every committed harness input so behavior runs remain comparable."""
    digest = hashlib.sha256()
    for path in sorted(candidate for candidate in HARNESS_DIR.rglob("*") if candidate.is_file()):
        if "__pycache__" in path.parts:
            continue
        relative = path.relative_to(HARNESS_DIR).as_posix().encode("utf-8")
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        content = path.read_bytes()
        digest.update(len(content).to_bytes(8, "big"))
        digest.update(content)
    return digest.hexdigest()


def _is_ci() -> bool:
    return os.environ.get("CI", "").strip().lower() in {"1", "true", "yes", "on"}


def _parse_args(arguments: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--execute",
        action="store_true",
        help="Explicitly opt in to actual Codex model calls.",
    )
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and list cases without invoking Codex (the default).",
    )
    parser.add_argument("--case", action="append", default=[], help="Run one case by id; repeatable.")
    parser.add_argument("--model", help="Override the manifest-pinned Codex model.")
    parser.add_argument(
        "--reasoning-effort",
        choices=sorted(ALLOWED_REASONING_EFFORTS),
        help="Override the manifest-pinned reasoning effort.",
    )
    parser.add_argument("--codex-command", default="codex", help=argparse.SUPPRESS)
    parser.add_argument("--timeout-seconds", type=int, default=600)
    return parser.parse_args(arguments)


def main(arguments: Sequence[str] | None = None) -> int:
    args = _parse_args(arguments)
    try:
        manifest = load_manifest()
        selected = _select_cases(manifest["cases"], args.case)
        safe_environment = _safe_environment()
        global_instruction = _global_instruction_fingerprint(safe_environment)
    except HarnessConfigurationError as exc:
        print(f"Codex eval configuration error: {exc}", file=sys.stderr)
        return 2

    model = args.model or manifest["execution_defaults"]["model"]
    reasoning_effort = (
        args.reasoning_effort or manifest["execution_defaults"]["reasoning_effort"]
    )

    if not args.execute:
        print(
            json.dumps(
                {
                    "mode": "dry-run",
                    "codex_invoked": False,
                    "cases": [case["id"] for case in selected],
                    "model": model,
                    "reasoning_effort": reasoning_effort,
                    "harness_revision": _harness_revision(),
                    "global_instruction": global_instruction,
                    "output_root": str(OUTPUT_ROOT),
                },
                indent=2,
            )
        )
        return 0

    if _is_ci():
        print("Codex model evaluations are intentionally disabled when CI is set.", file=sys.stderr)
        return 2
    if args.timeout_seconds < 30 or args.timeout_seconds > 3600:
        print("--timeout-seconds must be between 30 and 3600", file=sys.stderr)
        return 2
    resolved_codex = shutil.which(args.codex_command)
    if not resolved_codex:
        print(f"Codex executable not found: {args.codex_command}", file=sys.stderr)
        return 2

    version_returncode, version_stdout, version_stderr, version_timed_out = _run_process(
        [resolved_codex, "--version"],
        cwd=REPOSITORY_ROOT,
        timeout_seconds=30,
        environment=safe_environment,
    )
    if version_returncode != 0 or version_timed_out:
        detail = (version_stderr or version_stdout).strip()
        print(f"Could not verify Codex CLI version: {detail}", file=sys.stderr)
        return 2
    codex_cli_version = version_stdout.strip()
    harness_revision = _harness_revision()
    manifest_sha256 = _sha256(MANIFEST_PATH)

    run_dir = _create_run_directory()
    logs_dir = run_dir / "logs"
    results: list[dict[str, Any]] = []
    print(f"Codex eval artifacts: {run_dir}")

    for case in selected:
        repo = run_dir / "repos" / case["id"]
        baseline, baseline_hashes = _initialize_fixture_repo(case, repo)
        stdout_path = logs_dir / f"{case['id']}.jsonl"
        stderr_path = logs_dir / f"{case['id']}.stderr.txt"
        structured_path = logs_dir / f"{case['id']}.result.json"
        prompt = case["prompt_path"].read_text(encoding="utf-8").strip()
        prompt += (
            "\n\nStay inside this synthetic repository. Do not inspect environment variables, "
            "use network access, contact external systems, or commit changes."
        )
        command = build_codex_command(
            resolved_codex,
            case,
            manifest["schema_path"],
            structured_path,
            prompt,
            working_directory=_case_working_directory(repo, case),
            model=model,
            reasoning_effort=reasoning_effort,
        )
        returncode, stdout, stderr, timed_out = _run_process(
            command,
            cwd=_case_working_directory(repo, case),
            timeout_seconds=args.timeout_seconds,
            environment=safe_environment,
        )
        stdout_path.write_text(stdout, encoding="utf-8")
        stderr_path.write_text(stderr, encoding="utf-8")
        result = _grade_case(
            case,
            repo,
            baseline,
            baseline_hashes,
            returncode,
            timed_out,
            stdout,
            structured_path,
        )
        result["jsonl_log"] = stdout_path.name
        result["stderr_log"] = stderr_path.name
        result["structured_output_log"] = structured_path.name
        results.append(result)
        status = "PASS" if result["passed"] else "FAIL"
        print(f"[{status}] {case['id']}")

    summary = {
        "schema_version": 1,
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "synthetic_only": True,
        "model": model,
        "reasoning_effort": reasoning_effort,
        "codex_cli_version": codex_cli_version,
        "manifest_sha256": manifest_sha256,
        "harness_revision": harness_revision,
        "global_instruction": global_instruction,
        "passed": all(result["passed"] for result in results),
        "results": results,
    }
    summary_path = run_dir / "summary.json"
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(f"Summary: {summary_path}")
    return 0 if summary["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
