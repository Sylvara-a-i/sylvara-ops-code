#!/usr/bin/env python3
"""Atomically consume one validator-issued approval on this local host.

The SQLite ledger is intentionally permanent and fail closed. This module
never deletes, replaces, or repairs a database after an ambiguous result.
"""

from __future__ import annotations

import ctypes
import datetime as dt
import hashlib
import importlib.util
import json
import os
import re
import sqlite3
import stat
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, NoReturn, Sequence


SCHEMA = "sylvara.local-approval-consumption-ledger.v2"
DATABASE_NAME = "approval-consumption.sqlite3"
APPLICATION_ID = 0x53594C56
USER_VERSION = 2
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]

CRM_WORKFLOW_REPAIR_VALIDATOR = "crm-workflow-repair-v1"
ANALYTICS_MUTATION_VALIDATOR = "analytics-mutation-v3"
SUPPORTED_VALIDATORS = frozenset(
    (CRM_WORKFLOW_REPAIR_VALIDATOR, ANALYTICS_MUTATION_VALIDATOR)
)
LEDGER_DIRECTORY_ENV = "SYLVARA_APPROVAL_LEDGER_DIRECTORY"
NODE_EXECUTABLE_ENV = "SYLVARA_APPROVAL_NODE_EXECUTABLE"
NODE_EXECUTABLE_SHA256_ENV = "SYLVARA_APPROVAL_NODE_EXECUTABLE_SHA256"

_CRM_VALIDATOR_CLI = (
    REPOSITORY_ROOT
    / "src"
    / "zoho-crm"
    / "free-revenue-leak-test"
    / "tools"
    / "validate_private_workflow_repair_packet.py"
)
_ANALYTICS_VALIDATOR_CLI = (
    REPOSITORY_ROOT
    / "src"
    / "zoho-catalyst"
    / "revenue-desk-analytics"
    / "tools"
    / "validate-private-analytics-mutation-packet.js"
)
_VALIDATOR_RESULT_SCHEMA = "sylvara.bound-validator-result.v1"
_NODE_BRIDGE = r"""
"use strict";
const validator = require(process.argv[1]);
const originalWrite = process.stdout.write.bind(process.stdout);
let result;
process.stdout.write = () => true;
try {
  result = validator.run([process.argv[2], process.argv[3]]);
} finally {
  process.stdout.write = originalWrite;
}
originalWrite(JSON.stringify({
  schema: "sylvara.bound-validator-result.v1",
  validator: "analytics-mutation-v3",
  authorityId: result.operationAuthorizationId,
  consumptionDigest: result.consumptionDigest,
}));
"""
_BOUND_LEDGER_DIRECTORY: Path | None = None
_BOUND_NODE_EXECUTABLE: tuple[Path, str] | None = None

CLAIMED = "claimed"
ALREADY_CONSUMED = "already-consumed"
ERROR = "error"

EXIT_CLAIMED = 0
EXIT_ERROR = 1
EXIT_ALREADY_CONSUMED = 2

_DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")
_UUID_V4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
_UTC_MILLISECOND_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"
)

_CREATE_METADATA_SQL = """CREATE TABLE metadata (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    schema TEXT NOT NULL
) STRICT"""
_CREATE_CLAIMS_SQL = """CREATE TABLE claims (
    authority_id TEXT PRIMARY KEY,
    digest TEXT NOT NULL UNIQUE,
    claimed_at TEXT NOT NULL
) STRICT"""

_LOCAL_LINUX_FILESYSTEMS = {
    "apfs",
    "btrfs",
    "ext2",
    "ext3",
    "ext4",
    "exfat",
    "f2fs",
    "hfs",
    "hfsplus",
    "ntfs",
    "ntfs3",
    "overlay",
    "ufs",
    "vfat",
    "xfs",
    "zfs",
}


class ApprovalConsumptionError(Exception):
    """Base class for coarse, non-sensitive ledger failures."""


class InvalidClaimInput(ApprovalConsumptionError):
    """The authority ID, digest, or ledger-directory input is invalid."""


class UnsafeLedger(ApprovalConsumptionError):
    """The local ledger or its durable-storage boundary cannot be trusted."""


class ApprovalAlreadyConsumed(ApprovalConsumptionError):
    """This exact authority and digest pair was already durably consumed."""


@dataclass(frozen=True, slots=True)
class ApprovalClaimReceipt:
    """Coarse in-process success receipt with no approval identity fields."""

    claimed: bool = True


def _fail(error_type: type[ApprovalConsumptionError]) -> NoReturn:
    # Exceptions intentionally carry no path, ID, digest, or provider detail.
    raise error_type()


def _validate_digest(value: Any) -> str:
    if not isinstance(value, str) or _DIGEST_RE.fullmatch(value) is None:
        _fail(InvalidClaimInput)
    return value


def _validate_authority_id(value: Any) -> str:
    if not isinstance(value, str):
        _fail(InvalidClaimInput)
    if _UUID_V4_RE.fullmatch(value) is None and _DIGEST_RE.fullmatch(value) is None:
        _fail(InvalidClaimInput)
    return value


def _canonical_claim_time() -> str:
    return (
        dt.datetime.now(dt.timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _valid_claim_time(value: Any) -> bool:
    if not isinstance(value, str) or _UTC_MILLISECOND_RE.fullmatch(value) is None:
        return False
    try:
        parsed = dt.datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        return False
    return parsed.tzinfo == dt.timezone.utc


def _is_link_like(path: Path) -> bool:
    try:
        metadata = os.lstat(path)
        if stat.S_ISLNK(metadata.st_mode):
            return True
        reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
        if getattr(metadata, "st_file_attributes", 0) & reparse_flag:
            return True
        is_junction = getattr(path, "is_junction", None)
        return bool(is_junction and is_junction())
    except OSError:
        _fail(UnsafeLedger)


def _reject_linked_components(path: Path) -> None:
    current = Path(path.anchor)
    parts = path.parts[1:] if path.anchor else path.parts
    for part in parts:
        current /= part
        if _is_link_like(current):
            _fail(UnsafeLedger)


def _decode_git_path(value: bytes) -> Path:
    try:
        decoded = value.decode("utf-8", "strict")
    except UnicodeDecodeError:
        _fail(UnsafeLedger)
    path = Path(decoded)
    if not path.is_absolute():
        _fail(UnsafeLedger)
    try:
        return path.resolve(strict=False)
    except OSError:
        _fail(UnsafeLedger)


def _git_subprocess_environment(
    source: Mapping[str, str] | None = None,
) -> dict[str, str]:
    selected = os.environ if source is None else source
    environment = {
        name: value
        for name, value in selected.items()
        if not name.upper().startswith("GIT_")
    }
    environment["GIT_OPTIONAL_LOCKS"] = "0"
    return environment


def _discover_attached_worktrees() -> tuple[Path, ...]:
    try:
        result = subprocess.run(
            [
                "git",
                "-c",
                f"safe.directory={REPOSITORY_ROOT}",
                "-C",
                str(REPOSITORY_ROOT),
                "worktree",
                "list",
                "--porcelain",
                "-z",
            ],
            check=False,
            env=_git_subprocess_environment(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        _fail(UnsafeLedger)
    if result.returncode != 0:
        _fail(UnsafeLedger)

    prefix = b"worktree "
    roots = {
        _decode_git_path(field[len(prefix) :])
        for field in result.stdout.split(b"\x00")
        if field.startswith(prefix)
    }
    if not roots:
        _fail(UnsafeLedger)
    return tuple(sorted(roots, key=lambda item: os.path.normcase(str(item))))


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _reject_git_ancestry(path: Path) -> None:
    current = path
    while True:
        if _lstat_exists(current / ".git"):
            _fail(UnsafeLedger)
        # Bare repositories have no .git child, but are still Git ancestry.
        bare_entries = (current / "HEAD", current / "objects", current / "refs")
        if all(_lstat_exists(candidate) for candidate in bare_entries):
            _fail(UnsafeLedger)
        if current.parent == current:
            return
        current = current.parent


def _lstat_exists(path: Path) -> bool:
    try:
        os.lstat(path)
    except FileNotFoundError:
        return False
    except OSError:
        _fail(UnsafeLedger)
    return True


def _decode_mount_path(value: str) -> str:
    return re.sub(
        r"\\([0-7]{3})", lambda match: chr(int(match.group(1), 8)), value
    )


def _validate_posix_local_filesystem(path: Path) -> None:
    mountinfo = Path("/proc/self/mountinfo")
    if mountinfo.is_file():
        try:
            records = mountinfo.read_text(encoding="utf-8").splitlines()
        except OSError:
            _fail(UnsafeLedger)
        matches: list[tuple[int, str]] = []
        path_text = str(path)
        for record in records:
            fields = record.split()
            try:
                separator = fields.index("-")
                mount_point = _decode_mount_path(fields[4])
                filesystem = fields[separator + 1].lower()
            except (IndexError, ValueError):
                _fail(UnsafeLedger)
            try:
                common = os.path.commonpath((path_text, mount_point))
            except ValueError:
                continue
            if common == mount_point:
                matches.append((len(mount_point), filesystem))
        if not matches or max(matches)[1] not in _LOCAL_LINUX_FILESYSTEMS:
            _fail(UnsafeLedger)
        return

    try:
        flags = os.statvfs(path).f_flag
    except OSError:
        _fail(UnsafeLedger)
    local_flag = getattr(os, "ST_LOCAL", None)
    if local_flag is None or not flags & local_flag:
        _fail(UnsafeLedger)


def _validate_posix_directory_security(path: Path) -> None:
    try:
        metadata = os.lstat(path)
    except OSError:
        _fail(UnsafeLedger)
    getuid = getattr(os, "geteuid", None)
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or getuid is None
        or metadata.st_uid != getuid()
        or stat.S_IMODE(metadata.st_mode) != 0o700
    ):
        _fail(UnsafeLedger)


def _windows_sid_string(sid: int | ctypes.c_void_p) -> str:
    from ctypes import wintypes

    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    sid_pointer = ctypes.c_void_p(sid if isinstance(sid, int) else sid.value)
    advapi32.IsValidSid.argtypes = [ctypes.c_void_p]
    advapi32.IsValidSid.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    if not sid_pointer.value or not advapi32.IsValidSid(sid_pointer):
        _fail(UnsafeLedger)
    output = wintypes.LPWSTR()
    advapi32.ConvertSidToStringSidW.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(wintypes.LPWSTR),
    ]
    advapi32.ConvertSidToStringSidW.restype = wintypes.BOOL
    if not advapi32.ConvertSidToStringSidW(sid_pointer, ctypes.byref(output)):
        _fail(UnsafeLedger)
    try:
        return output.value
    finally:
        kernel32.LocalFree(ctypes.cast(output, ctypes.c_void_p))


def _windows_current_user_sid() -> str:
    from ctypes import wintypes

    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    token = wintypes.HANDLE()
    kernel32.GetCurrentProcess.argtypes = []
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    advapi32.OpenProcessToken.argtypes = [
        wintypes.HANDLE,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.HANDLE),
    ]
    advapi32.OpenProcessToken.restype = wintypes.BOOL
    advapi32.GetTokenInformation.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
    ]
    advapi32.GetTokenInformation.restype = wintypes.BOOL
    if not advapi32.OpenProcessToken(kernel32.GetCurrentProcess(), 0x0008, ctypes.byref(token)):
        _fail(UnsafeLedger)
    try:
        needed = wintypes.DWORD()
        advapi32.GetTokenInformation(token, 1, None, 0, ctypes.byref(needed))
        if not needed.value:
            _fail(UnsafeLedger)
        buffer = ctypes.create_string_buffer(needed.value)
        if not advapi32.GetTokenInformation(
            token, 1, buffer, needed, ctypes.byref(needed)
        ):
            _fail(UnsafeLedger)

        class SID_AND_ATTRIBUTES(ctypes.Structure):
            _fields_ = [("Sid", ctypes.c_void_p), ("Attributes", wintypes.DWORD)]

        token_user = ctypes.cast(buffer, ctypes.POINTER(SID_AND_ATTRIBUTES)).contents
        return _windows_sid_string(token_user.Sid)
    finally:
        kernel32.CloseHandle(token)


def _validate_windows_acl(path: Path, *, require_protected: bool) -> None:
    from ctypes import wintypes

    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    owner = ctypes.c_void_p()
    dacl = ctypes.c_void_p()
    descriptor = ctypes.c_void_p()
    advapi32.GetNamedSecurityInfoW.argtypes = [
        wintypes.LPWSTR,
        ctypes.c_int,
        wintypes.DWORD,
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_void_p),
    ]
    advapi32.GetNamedSecurityInfoW.restype = wintypes.DWORD
    advapi32.GetSecurityDescriptorControl.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_ushort),
        ctypes.POINTER(wintypes.DWORD),
    ]
    advapi32.GetSecurityDescriptorControl.restype = wintypes.BOOL
    advapi32.GetAce.argtypes = [
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(ctypes.c_void_p),
    ]
    advapi32.GetAce.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    result = advapi32.GetNamedSecurityInfoW(
        str(path),
        1,
        0x00000001 | 0x00000004,
        ctypes.byref(owner),
        None,
        ctypes.byref(dacl),
        None,
        ctypes.byref(descriptor),
    )
    if result != 0 or not descriptor.value:
        _fail(UnsafeLedger)
    try:
        current_sid = _windows_current_user_sid()
        if _windows_sid_string(owner) != current_sid or not dacl.value:
            _fail(UnsafeLedger)

        control = ctypes.c_ushort()
        revision = wintypes.DWORD()
        if not advapi32.GetSecurityDescriptorControl(
            descriptor, ctypes.byref(control), ctypes.byref(revision)
        ):
            _fail(UnsafeLedger)
        if require_protected and not control.value & 0x1000:
            _fail(UnsafeLedger)

        class ACL(ctypes.Structure):
            _fields_ = [
                ("AclRevision", ctypes.c_ubyte),
                ("Sbz1", ctypes.c_ubyte),
                ("AclSize", ctypes.c_ushort),
                ("AceCount", ctypes.c_ushort),
                ("Sbz2", ctypes.c_ushort),
            ]

        class ACE_HEADER(ctypes.Structure):
            _fields_ = [
                ("AceType", ctypes.c_ubyte),
                ("AceFlags", ctypes.c_ubyte),
                ("AceSize", ctypes.c_ushort),
            ]

        acl = ACL.from_address(dacl.value)
        combined_mask = 0
        for index in range(acl.AceCount):
            ace = ctypes.c_void_p()
            if not advapi32.GetAce(dacl, index, ctypes.byref(ace)) or not ace.value:
                _fail(UnsafeLedger)
            header = ACE_HEADER.from_address(ace.value)
            # A current-user-only allow list is intentionally stricter than
            # trying to reason about effective access from mixed allow/deny ACEs.
            if header.AceType != 0 or header.AceSize < 12:
                _fail(UnsafeLedger)
            if require_protected and header.AceFlags & 0x10:
                _fail(UnsafeLedger)
            if _windows_sid_string(ace.value + 8) != current_sid:
                _fail(UnsafeLedger)
            combined_mask |= ctypes.c_uint32.from_address(ace.value + 4).value
        file_all_access = 0x001F01FF
        generic_all = 0x10000000
        if not (combined_mask & generic_all) and (
            combined_mask & file_all_access
        ) != file_all_access:
            _fail(UnsafeLedger)
    finally:
        kernel32.LocalFree(descriptor)


def _validate_windows_local_path(path: Path) -> None:
    from ctypes import wintypes

    raw = str(path)
    if raw.startswith(("\\\\", "//", "\\??\\")):
        _fail(UnsafeLedger)
    root = path.anchor
    if not root:
        _fail(UnsafeLedger)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GetDriveTypeW.argtypes = [wintypes.LPCWSTR]
    kernel32.GetDriveTypeW.restype = wintypes.UINT
    if kernel32.GetDriveTypeW(root) != 3:  # DRIVE_FIXED
        _fail(UnsafeLedger)


def _validate_ledger_directory(value: Any) -> Path:
    try:
        raw_text = os.fspath(value)
        if not isinstance(raw_text, str):
            _fail(InvalidClaimInput)
        raw = Path(raw_text)
    except (TypeError, ValueError, OSError):
        _fail(InvalidClaimInput)
    if not raw.is_absolute() or any(part == os.pardir for part in raw.parts):
        _fail(UnsafeLedger)
    if os.name == "nt" and raw_text.startswith(("\\\\", "//", "\\??\\")):
        _fail(UnsafeLedger)

    _reject_linked_components(raw)
    try:
        resolved = raw.resolve(strict=True)
        metadata = os.lstat(resolved)
    except OSError:
        _fail(UnsafeLedger)
    if not stat.S_ISDIR(metadata.st_mode) or _is_link_like(resolved):
        _fail(UnsafeLedger)
    if resolved == Path(resolved.anchor):
        _fail(UnsafeLedger)

    if os.name == "nt":
        _validate_windows_local_path(resolved)
        _validate_windows_acl(resolved, require_protected=True)
    else:
        _validate_posix_local_filesystem(resolved)
        _validate_posix_directory_security(resolved)

    _reject_git_ancestry(resolved)
    for worktree in _discover_attached_worktrees():
        if _is_within(resolved, worktree):
            _fail(UnsafeLedger)
    return resolved


def _same_path(first: Path, second: Path) -> bool:
    return os.path.normcase(os.path.normpath(str(first))) == os.path.normcase(
        os.path.normpath(str(second))
    )


def _configured_ledger_directory() -> Path:
    """Resolve the one executor-configured ledger and reject process drift."""

    global _BOUND_LEDGER_DIRECTORY
    configured = os.environ.get(LEDGER_DIRECTORY_ENV)
    if not configured:
        _fail(InvalidClaimInput)
    ledger = _validate_ledger_directory(configured)
    if _BOUND_LEDGER_DIRECTORY is None:
        _BOUND_LEDGER_DIRECTORY = ledger
    elif not _same_path(_BOUND_LEDGER_DIRECTORY, ledger):
        _fail(InvalidClaimInput)
    return ledger


def _sha256_regular_file(path: Path) -> str:
    try:
        before = os.lstat(path)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_nlink != 1
            or before.st_size <= 0
            or before.st_size > 256 * 1024 * 1024
        ):
            _fail(InvalidClaimInput)
        digest = hashlib.sha256()
        with path.open("rb") as source:
            opened = os.fstat(source.fileno())
            if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
                _fail(InvalidClaimInput)
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        after = os.lstat(path)
    except ApprovalConsumptionError:
        raise
    except (OSError, ValueError):
        _fail(InvalidClaimInput)
    if (
        (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
        != (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
        or after.st_nlink != 1
        or not stat.S_ISREG(after.st_mode)
    ):
        _fail(InvalidClaimInput)
    return digest.hexdigest()


def _configured_node_executable() -> Path:
    """Require one absolute, hash-pinned, local non-link Node executable."""

    global _BOUND_NODE_EXECUTABLE
    configured_path = os.environ.get(NODE_EXECUTABLE_ENV)
    configured_digest = os.environ.get(NODE_EXECUTABLE_SHA256_ENV)
    if not configured_path or _DIGEST_RE.fullmatch(configured_digest or "") is None:
        _fail(InvalidClaimInput)
    raw = Path(configured_path)
    if not raw.is_absolute() or any(part == os.pardir for part in raw.parts):
        _fail(InvalidClaimInput)
    _reject_linked_components(raw)
    try:
        resolved = raw.resolve(strict=True)
        metadata = os.lstat(resolved)
    except OSError:
        _fail(InvalidClaimInput)
    if (
        not _same_path(raw, resolved)
        or not stat.S_ISREG(metadata.st_mode)
        or metadata.st_nlink != 1
        or _is_link_like(resolved)
    ):
        _fail(InvalidClaimInput)
    if os.name == "nt":
        _validate_windows_local_path(resolved)
    else:
        _validate_posix_local_filesystem(resolved.parent)
        if not os.access(resolved, os.X_OK):
            _fail(InvalidClaimInput)
    _reject_git_ancestry(resolved.parent)
    for worktree in _discover_attached_worktrees():
        if _is_within(resolved, worktree):
            _fail(InvalidClaimInput)
    actual_digest = _sha256_regular_file(resolved)
    if actual_digest != configured_digest:
        _fail(InvalidClaimInput)
    binding = (resolved, actual_digest)
    if _BOUND_NODE_EXECUTABLE is None:
        _BOUND_NODE_EXECUTABLE = binding
    elif (
        not _same_path(_BOUND_NODE_EXECUTABLE[0], resolved)
        or _BOUND_NODE_EXECUTABLE[1] != actual_digest
    ):
        _fail(InvalidClaimInput)
    return resolved


def _assert_execution_boundary_source_clean() -> None:
    """Bind the wrapper itself to the same committed HEAD as the validators."""

    relative = "tools/safety/claim_approval_consumption.py"
    environment = _git_subprocess_environment()
    common = {
        "cwd": REPOSITORY_ROOT,
        "env": environment,
        "stdout": subprocess.PIPE,
        "stderr": subprocess.PIPE,
        "check": False,
        "encoding": "utf-8",
        "timeout": 15,
        "creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0),
    }
    try:
        status = subprocess.run(
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
                relative,
            ],
            **common,
        )
        index = subprocess.run(
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
                relative,
            ],
            **common,
        )
    except (OSError, subprocess.SubprocessError, TypeError, ValueError):
        _fail(InvalidClaimInput)
    if (
        status.returncode != 0
        or status.stdout.strip()
        or status.stderr
        or index.returncode != 0
        or index.stdout.strip() != f"H {relative}"
        or index.stderr
    ):
        _fail(InvalidClaimInput)


@dataclass
class _DirectoryAnchor:
    handle: int
    identity: tuple[int, ...]
    windows: bool


def _windows_handle_identity(handle: int) -> tuple[int, ...]:
    from ctypes import wintypes

    class BY_HANDLE_FILE_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("dwFileAttributes", wintypes.DWORD),
            ("ftCreationTime", wintypes.FILETIME),
            ("ftLastAccessTime", wintypes.FILETIME),
            ("ftLastWriteTime", wintypes.FILETIME),
            ("dwVolumeSerialNumber", wintypes.DWORD),
            ("nFileSizeHigh", wintypes.DWORD),
            ("nFileSizeLow", wintypes.DWORD),
            ("nNumberOfLinks", wintypes.DWORD),
            ("nFileIndexHigh", wintypes.DWORD),
            ("nFileIndexLow", wintypes.DWORD),
        ]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    information = BY_HANDLE_FILE_INFORMATION()
    kernel32.GetFileInformationByHandle.argtypes = [
        wintypes.HANDLE,
        ctypes.POINTER(BY_HANDLE_FILE_INFORMATION),
    ]
    kernel32.GetFileInformationByHandle.restype = wintypes.BOOL
    if not kernel32.GetFileInformationByHandle(
        wintypes.HANDLE(handle), ctypes.byref(information)
    ):
        _fail(UnsafeLedger)
    if information.dwFileAttributes & 0x400:
        _fail(UnsafeLedger)
    return (
        information.dwVolumeSerialNumber,
        information.nFileIndexHigh,
        information.nFileIndexLow,
    )


def _open_directory_anchor(path: Path) -> _DirectoryAnchor:
    if os.name != "nt":
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
        try:
            descriptor = os.open(path, flags)
            metadata = os.fstat(descriptor)
        except OSError:
            _fail(UnsafeLedger)
        if not stat.S_ISDIR(metadata.st_mode):
            os.close(descriptor)
            _fail(UnsafeLedger)
        return _DirectoryAnchor(
            descriptor, (metadata.st_dev, metadata.st_ino), windows=False
        )

    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateFileW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.c_void_p,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    ]
    kernel32.CreateFileW.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    handle = kernel32.CreateFileW(
        str(path),
        0x00020000 | 0x00000080,
        0x00000001 | 0x00000002,
        None,
        3,
        0x02000000 | 0x00200000,
        None,
    )
    invalid_handle = ctypes.c_void_p(-1).value
    if handle is None or handle == invalid_handle:
        _fail(UnsafeLedger)
    numeric_handle = int(handle)
    try:
        identity = _windows_handle_identity(numeric_handle)
    except ApprovalConsumptionError:
        kernel32.CloseHandle(wintypes.HANDLE(numeric_handle))
        raise
    return _DirectoryAnchor(numeric_handle, identity, windows=True)


def _close_directory_anchor(anchor: _DirectoryAnchor) -> None:
    try:
        if anchor.windows:
            from ctypes import wintypes

            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
            kernel32.CloseHandle.restype = wintypes.BOOL
            kernel32.CloseHandle(wintypes.HANDLE(anchor.handle))
        else:
            os.close(anchor.handle)
    except OSError:
        pass


def _fsync_directory(anchor: _DirectoryAnchor) -> None:
    if anchor.windows:
        return
    try:
        os.fsync(anchor.handle)
    except OSError:
        _fail(UnsafeLedger)


def _verify_directory_identity(path: Path, anchor: _DirectoryAnchor) -> None:
    _reject_linked_components(path)
    try:
        if path.resolve(strict=True) != path:
            _fail(UnsafeLedger)
    except OSError:
        _fail(UnsafeLedger)
    if os.name == "nt":
        _validate_windows_local_path(path)
        _validate_windows_acl(path, require_protected=True)
        if _windows_handle_identity(anchor.handle) != anchor.identity:
            _fail(UnsafeLedger)
        probe = _open_directory_anchor(path)
        try:
            if probe.identity != anchor.identity:
                _fail(UnsafeLedger)
        finally:
            _close_directory_anchor(probe)
    else:
        _validate_posix_local_filesystem(path)
        _validate_posix_directory_security(path)
        try:
            metadata = os.stat(path, follow_symlinks=False)
            opened = os.fstat(anchor.handle)
        except OSError:
            _fail(UnsafeLedger)
        identity = (metadata.st_dev, metadata.st_ino)
        if identity != anchor.identity or (opened.st_dev, opened.st_ino) != anchor.identity:
            _fail(UnsafeLedger)


def _validate_storage_file(path: Path, *, allow_empty: bool) -> None:
    try:
        metadata = os.lstat(path)
    except OSError:
        _fail(UnsafeLedger)
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    if (
        not stat.S_ISREG(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or getattr(metadata, "st_file_attributes", 0) & reparse_flag
        or metadata.st_nlink != 1
        or (not allow_empty and metadata.st_size <= 0)
    ):
        _fail(UnsafeLedger)
    if os.name == "nt":
        _validate_windows_acl(path, require_protected=False)
    else:
        getuid = getattr(os, "geteuid", None)
        if (
            getuid is None
            or metadata.st_uid != getuid()
            or stat.S_IMODE(metadata.st_mode) != 0o600
        ):
            _fail(UnsafeLedger)


def _validate_ledger_contents(ledger: Path, *, database_required: bool) -> None:
    try:
        entries = list(ledger.iterdir())
    except OSError:
        _fail(UnsafeLedger)
    allowed = {DATABASE_NAME, DATABASE_NAME + "-journal"}
    if any(entry.name not in allowed for entry in entries):
        _fail(UnsafeLedger)
    entries_by_name = {entry.name: entry for entry in entries}
    database = ledger / DATABASE_NAME
    journal = ledger / (DATABASE_NAME + "-journal")
    if DATABASE_NAME in entries_by_name:
        _validate_storage_file(database, allow_empty=True)
    elif database_required or DATABASE_NAME + "-journal" in entries_by_name:
        _fail(UnsafeLedger)
    if DATABASE_NAME + "-journal" in entries_by_name:
        _validate_storage_file(journal, allow_empty=False)


def _ensure_database_file(
    ledger: Path, anchor: _DirectoryAnchor
) -> tuple[Path, bool]:
    database = ledger / DATABASE_NAME
    flags = os.O_RDWR | os.O_CREAT | os.O_EXCL
    flags |= getattr(os, "O_BINARY", 0) | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(database, flags, 0o600)
    except FileExistsError:
        _validate_storage_file(database, allow_empty=True)
        # Another concurrent process may be between exclusive creation and its
        # first SQLite write. Wait only for that bounded initialization window;
        # a pre-existing or crash-left empty file remains an unrepaired hard stop.
        deadline = time.monotonic() + 2.0
        try:
            while database.stat().st_size == 0 and time.monotonic() < deadline:
                time.sleep(0.01)
        except OSError:
            _fail(UnsafeLedger)
        return database, False
    except OSError:
        _fail(UnsafeLedger)
    try:
        if os.name != "nt":
            os.fchmod(descriptor, 0o600)
        os.fsync(descriptor)
    except OSError:
        _fail(UnsafeLedger)
    finally:
        try:
            os.close(descriptor)
        except OSError:
            pass
    _fsync_directory(anchor)
    _validate_storage_file(database, allow_empty=True)
    return database, True


def _integrity_check(connection: sqlite3.Connection) -> None:
    if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
        _fail(UnsafeLedger)


def _validate_schema(connection: sqlite3.Connection) -> None:
    if connection.execute("PRAGMA application_id").fetchone() != (APPLICATION_ID,):
        _fail(UnsafeLedger)
    if connection.execute("PRAGMA user_version").fetchone() != (USER_VERSION,):
        _fail(UnsafeLedger)
    objects = connection.execute(
        "SELECT type, name, sql FROM sqlite_schema "
        "WHERE name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    if objects != [
        ("table", "claims", _CREATE_CLAIMS_SQL),
        ("table", "metadata", _CREATE_METADATA_SQL),
    ]:
        _fail(UnsafeLedger)
    if connection.execute("SELECT singleton, schema FROM metadata").fetchall() != [
        (1, SCHEMA)
    ]:
        _fail(UnsafeLedger)
    indexes = connection.execute("PRAGMA index_list('claims')").fetchall()
    if (
        len(indexes) != 2
        or {row[3] for row in indexes} != {"pk", "u"}
        or any(row[2] != 1 or row[4] != 0 for row in indexes)
    ):
        _fail(UnsafeLedger)
    for authority_id, digest, claimed_at in connection.execute(
        "SELECT authority_id, digest, claimed_at FROM claims"
    ):
        if not isinstance(authority_id, str) or (
            _UUID_V4_RE.fullmatch(authority_id) is None
            and _DIGEST_RE.fullmatch(authority_id) is None
        ):
            _fail(UnsafeLedger)
        if not isinstance(digest, str) or _DIGEST_RE.fullmatch(digest) is None:
            _fail(UnsafeLedger)
        if not _valid_claim_time(claimed_at):
            _fail(UnsafeLedger)
    _integrity_check(connection)


def _initialize_or_validate_schema(
    connection: sqlite3.Connection, *, allow_initialize: bool
) -> None:
    objects = connection.execute(
        "SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'"
    ).fetchall()
    if not objects:
        if not allow_initialize:
            _fail(UnsafeLedger)
        connection.execute(f"PRAGMA application_id = {APPLICATION_ID}")
        connection.execute(f"PRAGMA user_version = {USER_VERSION}")
        connection.execute(_CREATE_METADATA_SQL)
        connection.execute(_CREATE_CLAIMS_SQL)
        connection.execute(
            "INSERT INTO metadata(singleton, schema) VALUES (1, ?)", (SCHEMA,)
        )
    _validate_schema(connection)


def _transactional_claim(
    database: Path,
    digest: str,
    authority_id: str,
    *,
    allow_initialize: bool,
) -> str:
    connection: sqlite3.Connection | None = None
    try:
        connection = sqlite3.connect(
            str(database), timeout=30.0, isolation_level=None
        )
        connection.execute("PRAGMA busy_timeout = 30000")
        connection.execute("PRAGMA trusted_schema = OFF")
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA synchronous = FULL")
        connection.execute("PRAGMA fullfsync = ON")
        if connection.execute("PRAGMA trusted_schema").fetchone() != (0,):
            _fail(UnsafeLedger)
        if connection.execute("PRAGMA foreign_keys").fetchone() != (1,):
            _fail(UnsafeLedger)
        if connection.execute("PRAGMA synchronous").fetchone() != (2,):
            _fail(UnsafeLedger)
        if connection.execute("PRAGMA fullfsync").fetchone() != (1,):
            _fail(UnsafeLedger)
        journal_mode = connection.execute("PRAGMA journal_mode = DELETE").fetchone()
        if journal_mode != ("delete",):
            _fail(UnsafeLedger)
        connection.execute("BEGIN IMMEDIATE")
        _initialize_or_validate_schema(
            connection, allow_initialize=allow_initialize
        )

        authority_row = connection.execute(
            "SELECT digest FROM claims WHERE authority_id = ?", (authority_id,)
        ).fetchone()
        digest_row = connection.execute(
            "SELECT authority_id FROM claims WHERE digest = ?", (digest,)
        ).fetchone()
        if authority_row is None and digest_row is None:
            connection.execute(
                "INSERT INTO claims(authority_id, digest, claimed_at) VALUES (?, ?, ?)",
                (authority_id, digest, _canonical_claim_time()),
            )
            connection.execute("COMMIT")
            _integrity_check(connection)
            return CLAIMED
        if authority_row == (digest,) and digest_row == (authority_id,):
            connection.execute("ROLLBACK")
            _integrity_check(connection)
            return ALREADY_CONSUMED
        # Either uniqueness dimension points at a different row. This is not
        # a retry; it is an authority-binding conflict and must fail closed.
        connection.execute("ROLLBACK")
        _fail(UnsafeLedger)
    except ApprovalConsumptionError:
        if connection is not None and connection.in_transaction:
            try:
                connection.execute("ROLLBACK")
            except sqlite3.Error:
                pass
        raise
    except (OSError, sqlite3.Error, TypeError, ValueError):
        if connection is not None and connection.in_transaction:
            try:
                connection.execute("ROLLBACK")
            except sqlite3.Error:
                pass
        _fail(UnsafeLedger)
    finally:
        if connection is not None:
            try:
                connection.close()
            except sqlite3.Error:
                pass


def _claim_approval_consumption(
    ledger_directory: str | os.PathLike[str],
    digest: str,
    authority_id: str,
) -> None:
    """Internal SQLite primitive; supported callers use validate-and-claim.

    Keeping the raw pair primitive private prevents ordinary executor misuse by
    removing any supported raw-pair API. It is not an in-process authentication
    boundary against code that can introspect or modify this module.
    """

    validated_digest = _validate_digest(digest)
    validated_authority = _validate_authority_id(authority_id)
    ledger = _validate_ledger_directory(ledger_directory)
    anchor = _open_directory_anchor(ledger)
    outcome: str | None = None
    try:
        _verify_directory_identity(ledger, anchor)
        _validate_ledger_contents(ledger, database_required=False)
        database, created_database = _ensure_database_file(ledger, anchor)
        _validate_storage_file(database, allow_empty=True)
        outcome = _transactional_claim(
            database,
            validated_digest,
            validated_authority,
            allow_initialize=created_database,
        )
        _fsync_directory(anchor)
        _validate_storage_file(database, allow_empty=False)
        _validate_ledger_contents(ledger, database_required=True)
    finally:
        try:
            # Verify the anchored identity even after a database error. A path
            # swap must never be masked as an ordinary retryable failure.
            _verify_directory_identity(ledger, anchor)
        finally:
            _close_directory_anchor(anchor)

    if outcome == ALREADY_CONSUMED:
        _fail(ApprovalAlreadyConsumed)
    if outcome != CLAIMED:
        _fail(UnsafeLedger)


def _load_crm_validator_module() -> Any:
    try:
        spec = importlib.util.spec_from_file_location(
            "_sylvara_crm_workflow_repair_cli", _CRM_VALIDATOR_CLI
        )
        if spec is None or spec.loader is None:
            _fail(InvalidClaimInput)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    except ApprovalConsumptionError:
        raise
    except (ImportError, OSError, RuntimeError, TypeError, ValueError):
        _fail(InvalidClaimInput)
    return module


def _validate_crm_workflow_repair(
    packet_path: str | os.PathLike[str],
    approval_path: str | os.PathLike[str],
) -> tuple[str, str]:
    try:
        module = _load_crm_validator_module()
        result = module.validate_private_workflow_repair_paths(
            packet_path, approval_path
        )
        return result.authority_id, result.consumption_digest
    except ApprovalConsumptionError:
        raise
    except (AttributeError, ImportError, OSError, RuntimeError, TypeError, ValueError):
        _fail(InvalidClaimInput)


def _strict_json_object(value: str) -> dict[str, Any]:
    if not isinstance(value, str) or len(value.encode("utf-8")) > 4096:
        _fail(InvalidClaimInput)

    def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        selected: dict[str, Any] = {}
        for key, item in pairs:
            if key in selected:
                _fail(InvalidClaimInput)
            selected[key] = item
        return selected

    try:
        result = json.loads(value, object_pairs_hook=reject_duplicate_keys)
    except ApprovalConsumptionError:
        raise
    except (UnicodeError, json.JSONDecodeError, TypeError, ValueError):
        _fail(InvalidClaimInput)
    if not isinstance(result, dict):
        _fail(InvalidClaimInput)
    return result


def _validate_analytics_mutation(
    packet_path: str | os.PathLike[str],
    approval_path: str | os.PathLike[str],
) -> tuple[str, str]:
    node_path = _configured_node_executable()
    try:
        if not _ANALYTICS_VALIDATOR_CLI.is_file():
            _fail(InvalidClaimInput)
        environment = _git_subprocess_environment()
        # Caller-controlled Node preload/module paths could replace the fixed
        # committed validator before it returns the approval-bound identity.
        for name in (
            "NODE_OPTIONS",
            "NODE_PATH",
            "NODE_REPL_EXTERNAL_MODULE",
            NODE_EXECUTABLE_ENV,
            NODE_EXECUTABLE_SHA256_ENV,
            LEDGER_DIRECTORY_ENV,
        ):
            environment.pop(name, None)
        process = subprocess.run(
            [
                str(node_path),
                "-e",
                _NODE_BRIDGE,
                str(_ANALYTICS_VALIDATOR_CLI),
                os.fspath(packet_path),
                os.fspath(approval_path),
            ],
            cwd=REPOSITORY_ROOT,
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            encoding="utf-8",
            timeout=60,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except ApprovalConsumptionError:
        raise
    except (OSError, subprocess.SubprocessError, TypeError, ValueError):
        _fail(InvalidClaimInput)
    if process.returncode != 0 or process.stderr != "":
        _fail(InvalidClaimInput)
    if not _same_path(node_path, _configured_node_executable()):
        _fail(InvalidClaimInput)
    result = _strict_json_object(process.stdout)
    if set(result) != {
        "authorityId",
        "consumptionDigest",
        "schema",
        "validator",
    }:
        _fail(InvalidClaimInput)
    if (
        result["schema"] != _VALIDATOR_RESULT_SCHEMA
        or result["validator"] != ANALYTICS_MUTATION_VALIDATOR
    ):
        _fail(InvalidClaimInput)
    return result["authorityId"], result["consumptionDigest"]


def _validated_pair(
    validator: str,
    packet_path: str | os.PathLike[str],
    approval_path: str | os.PathLike[str],
) -> tuple[str, str]:
    if validator == CRM_WORKFLOW_REPAIR_VALIDATOR:
        return _validate_crm_workflow_repair(packet_path, approval_path)
    elif validator == ANALYTICS_MUTATION_VALIDATOR:
        return _validate_analytics_mutation(packet_path, approval_path)
    _fail(InvalidClaimInput)


def validate_and_claim_approval(
    validator: str,
    packet_path: str | os.PathLike[str],
    approval_path: str | os.PathLike[str],
) -> ApprovalClaimReceipt:
    """Validate private files and durably claim their exact returned pair.

    An executor must call this boundary immediately before provider execution
    and continue only when it returns. No ledger path, authority ID, or digest
    is accepted as a caller-controlled argument.
    """

    _assert_execution_boundary_source_clean()
    ledger_directory = _configured_ledger_directory()
    authority_id, consumption_digest = _validated_pair(
        validator, packet_path, approval_path
    )
    _claim_approval_consumption(
        ledger_directory, consumption_digest, authority_id
    )
    return ApprovalClaimReceipt()


def _parse_cli(argv: Sequence[str]) -> tuple[str, str, str]:
    if len(argv) == 3 and argv[0] in SUPPORTED_VALIDATORS:
        return argv[0], argv[1], argv[2]
    _fail(InvalidClaimInput)


def main(argv: Sequence[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    try:
        validator, packet, approval = _parse_cli(arguments)
        validate_and_claim_approval(validator, packet, approval)
    except ApprovalAlreadyConsumed:
        print(ALREADY_CONSUMED)
        return EXIT_ALREADY_CONSUMED
    except (Exception, KeyboardInterrupt):
        # Never reflect a private path, authority, digest, SQL detail, or
        # provider response through the command-line boundary.
        print(ERROR, file=sys.stderr)
        return EXIT_ERROR
    print(CLAIMED)
    return EXIT_CLAIMED


if __name__ == "__main__":
    raise SystemExit(main())
