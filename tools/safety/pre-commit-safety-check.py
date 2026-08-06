#!/usr/bin/env python3
"""Fail-closed public-repository safety scan for Sylvara source assets.

The scanner inspects the Git index plus untracked, non-ignored candidates so a
risky new file is caught before staging. It intentionally rejects binary assets
and common sensitive-data shapes. Passing this check is a guardrail, not a
substitute for human review.
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath
from typing import NamedTuple


ROOT = Path(__file__).resolve().parents[2]

MAX_TEXT_BYTES = 2 * 1024 * 1024
MAX_APPROVED_BINARY_BYTES = 5 * 1024 * 1024

# No binaries are approved in the initial public repository. A future binary
# must be deliberately added here with an independently reviewed SHA-256 hash.
APPROVED_BINARY_SHA256: dict[str, str] = {}

ALLOWED_GIT_MODES = {"100644", "100755"}
VENDOR_OR_CACHE_DIRS = {
    ".cache",
    ".mypy_cache",
    ".next",
    ".npm",
    ".pytest_cache",
    ".ruff_cache",
    ".tox",
    ".venv",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "target",
    "vendor",
    "venv",
}

BLOCKED_BINARY_SUFFIXES = {
    ".7z",
    ".avi",
    ".bin",
    ".bmp",
    ".db",
    ".dll",
    ".doc",
    ".docm",
    ".docx",
    ".dump",
    ".exe",
    ".gif",
    ".gz",
    ".heic",
    ".ico",
    ".jpeg",
    ".jpg",
    ".kdbx",
    ".mov",
    ".mp3",
    ".mp4",
    ".ods",
    ".odt",
    ".p12",
    ".pdf",
    ".pfx",
    ".png",
    ".ppt",
    ".pptx",
    ".psd",
    ".rar",
    ".sqlite",
    ".sqlite3",
    ".tar",
    ".tgz",
    ".tif",
    ".tiff",
    ".wav",
    ".webp",
    ".woff",
    ".woff2",
    ".xls",
    ".xlsb",
    ".xlsm",
    ".xlsx",
    ".zip",
}

DANGEROUS_EXACT_NAMES = {
    ".netrc",
    ".npmrc",
    ".pypirc",
    "auth.json",
    "credentials",
    "credentials.json",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "id_rsa",
    "kubeconfig",
    "service-account.json",
    "terraform.tfstate",
    "token.json",
}
DANGEROUS_SUFFIXES = {".jks", ".key", ".ovpn", ".pem", ".tfstate"}
EXAMPLE_FILENAME_MARKERS = (".example.", "-example.", "_example.", ".sample.", "-sample.", ".template.")
CREDENTIAL_FILENAME_RE = re.compile(
    r"(?:^|[._-])(?:auth|credential|credentials|secret|secrets|service-account|token)"
    r"(?:[._-]|$)",
    re.IGNORECASE,
)

PRIVATE_KEY_RE = re.compile(
    r"-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----", re.IGNORECASE
)
SECRET_ASSIGNMENT_RE = re.compile(
    r"\b(?P<name>access[_-]?token|api[_-]?key|auth[_-]?token|bearer[_-]?token|"
    r"client[_-]?secret|consumer[_-]?secret|password|passwd|private[_-]?key|"
    r"refresh[_-]?token|secret[_-]?(?:access[_-]?)?key|signing[_-]?secret|"
    r"webhook[_-]?(?:secret|signing[_-]?key)|aws[_-]?secret[_-]?access[_-]?key|"
    r"github[_-]?token|openai[_-]?api[_-]?key|zoho[_-]?(?:access[_-]?token|"
    r"client[_-]?secret|refresh[_-]?token)|retell[_-]?(?:api[_-]?)?key|"
    r"make[_-]?(?:api[_-]?)?token)\b\s*[:=]\s*(?P<quote>['\"]?)"
    r"(?P<value>[^'\"`\s,;})\]]+)",
    re.IGNORECASE,
)

TOKEN_PATTERNS = (
    ("GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{30,}\b")),
    (
        "OpenAI API key",
        re.compile(r"\bsk-(?!(?:live|test)_)(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b"),
    ),
    ("AWS access key", re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
    ("Slack token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b")),
    (
        "Stripe secret key",
        re.compile(r"\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b"),
    ),
    ("Stripe webhook secret", re.compile(r"\bwhsec_[A-Za-z0-9]{16,}\b")),
    (
        "Zoho OAuth token",
        re.compile(r"\b1000\.[A-Za-z0-9]{20,}\.[A-Za-z0-9]{20,}\b"),
    ),
    ("Retell API key", re.compile(r"\bkey_[A-Za-z0-9]{24,}\b")),
    (
        "Make webhook credential",
        re.compile(
            r"https://hooks?\.(?:make\.com|integromat\.com)/[A-Za-z0-9_-]{16,}",
            re.IGNORECASE,
        ),
    ),
    (
        "Bearer credential",
        re.compile(r"\bBearer\s+[A-Za-z0-9._~+/-]{24,}={0,2}\b", re.IGNORECASE),
    ),
    (
        "credential-bearing URL",
        re.compile(r"\bhttps?://[^/@\s:]+:[^/@\s]+@", re.IGNORECASE),
    ),
)

SAFE_SECRET_VALUE_PREFIXES = (
    "<",
    "${",
    "$",
    "{{",
    "[",
    "config.",
    "env.",
    "env(",
    "get_secret(",
    "getsecret(",
    "load_secret(",
    "os.environ",
    "process.env",
    "runtime",
    "secrets.",
    "settings.",
    "string(process.env",
    "await",
    "parsed.",
    "response.",
)
SAFE_SECRET_VALUE_WORDS = {
    "change_me",
    "changeme",
    "example",
    "none",
    "null",
    "placeholder",
    "redacted",
    "replace_me",
    "runtime",
    "sample",
    "undefined",
}

EMAIL_RE = re.compile(
    r"\b[A-Z0-9._%+-]+@(?P<domain>[A-Z0-9.-]+\.[A-Z]{2,})\b", re.IGNORECASE
)
SAMPLE_EMAIL_DOMAINS = {"example.com", "example.net", "example.org", "test.invalid"}
PHONE_RE = re.compile(
    r"(?<!\d)(?:\+?1[ .-])?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}(?!\d)"
)
SSN_RE = re.compile(r"\b(?P<area>\d{3})-(?P<group>\d{2})-(?P<serial>\d{4})\b")
BANK_MARKER_RE = re.compile(
    r"\b(?P<label>routing(?:[_ -]?(?:number|no))?|bank[_ -]?account"
    r"(?:[_ -]?(?:number|no))?|account[_ -](?:number|no))\b\s*(?:#)?\s*[:=]\s*"
    r"['\"]?(?P<value>\d[\d -]{5,20})",
    re.IGNORECASE,
)
LONG_NUMERIC_IDENTIFIER_RE = re.compile(
    r"(?<![A-Za-z0-9])(?P<value>\d{16,22})(?![A-Za-z0-9])"
)

CHART_OF_ACCOUNTS_PATH = "src/zoho-books/reference/chart-of-accounts.csv"
CHART_OF_ACCOUNTS_HEADERS = (
    "Account Name",
    "Account Code",
    "Description",
    "Account Type",
    "Account Status",
    "Currency",
    "Parent Account",
)
CHART_OF_ACCOUNTS_SOURCE_ONLY_HEADERS = {
    "Account ID",
    "Account #",
    "Mileage Rate",
    "Mileage Unit",
    "IsMileage",
}
SHORT_ACCOUNT_IDENTIFIER_RE = re.compile(
    r"(?:\b(?:account|bank|checking|routing|savings|suffix)\b|"
    r"\b(?:ending|last)\s+(?:in\s+)?(?:four|4)\b)"
    r"[^\r\n\d]{0,32}(?:[*xX.-]*\s*)?\d{3,15}\b|"
    r"(?:[*xX]{2,}|\.{3,})\s*\d{3,15}\b",
    re.IGNORECASE,
)
GIT_OBJECT_ID_RE = re.compile(r"[0-9a-fA-F]{40}|[0-9a-fA-F]{64}")


class TrackedEntry(NamedTuple):
    """A stage-zero Git index entry used as the authoritative staged source."""

    mode: str
    object_id: str


def _is_example_filename(name: str) -> bool:
    lowered = name.lower()
    return lowered == ".env.example" or any(
        marker in lowered for marker in EXAMPLE_FILENAME_MARKERS
    )


def _is_safe_secret_reference(value: str, rel: str, quoted: bool) -> bool:
    lowered = value.strip().strip("'\"").lower()
    if lowered in SAFE_SECRET_VALUE_WORDS or any(
        lowered.startswith(prefix) for prefix in SAFE_SECRET_VALUE_PREFIXES
    ):
        return True
    code_suffixes = {".cjs", ".deluge", ".js", ".mjs", ".py", ".ts"}
    return (
        not quoted
        and PurePosixPath(rel).suffix.lower() in code_suffixes
        and re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*", value)
        is not None
    )


def _looks_like_real_phone(value: str) -> bool:
    digits = re.sub(r"\D", "", value)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10 or len(set(digits)) == 1:
        return False
    area, exchange, subscriber = digits[:3], digits[3:6], digits[6:]
    if area[0] not in "23456789" or exchange[0] not in "23456789":
        return False
    # NANP reserves 555-0100 through 555-0199 for fictional use.
    return not (exchange == "555" and subscriber.startswith("01"))


def _looks_like_real_ssn(match: re.Match[str]) -> bool:
    area = int(match.group("area"))
    group = int(match.group("group"))
    serial = int(match.group("serial"))
    return area not in {0, 666} and area < 900 and group != 0 and serial != 0


def _validate_repository_path(raw_path: bytes) -> tuple[str | None, list[str]]:
    try:
        rel = raw_path.decode("utf-8")
    except UnicodeDecodeError:
        return None, ["Git reported a non-UTF-8 tracked path; safety scan fails closed"]
    if "\\" in rel or any(ord(character) < 32 or ord(character) == 127 for character in rel):
        return None, [f"Tracked path contains unsafe characters: {rel!r}"]
    pure = PurePosixPath(rel)
    if not rel or pure.is_absolute() or ".." in pure.parts:
        return None, [f"Tracked path is unsafe: {rel!r}"]
    return rel, []


def load_tracked_entries(root: Path) -> tuple[dict[str, TrackedEntry], list[str]]:
    """Return stage-zero index entries; fail closed on ambiguous enumeration."""

    try:
        result = subprocess.run(
            ["git", "ls-files", "--stage", "-z", "--cached"],
            cwd=root,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        return {}, ["Could not enumerate Git-tracked files; safety scan fails closed"]
    if result.returncode != 0:
        return {}, ["Could not enumerate Git-tracked files; safety scan fails closed"]

    entries: dict[str, TrackedEntry] = {}
    problems: list[str] = []
    for record in result.stdout.split(b"\0"):
        if not record:
            continue
        metadata, separator, raw_path = record.partition(b"\t")
        fields = metadata.split()
        if not separator or len(fields) != 3:
            problems.append("Git returned an unparseable tracked-file entry; safety scan fails closed")
            continue
        try:
            mode = fields[0].decode("ascii")
            object_id = fields[1].decode("ascii")
            stage = fields[2].decode("ascii")
        except UnicodeDecodeError:
            problems.append("Git returned invalid tracked-file metadata; safety scan fails closed")
            continue
        rel, path_problems = _validate_repository_path(raw_path)
        problems.extend(path_problems)
        if rel is None:
            continue
        if stage != "0":
            problems.append(f"Unmerged Git index entry is prohibited: {rel}")
            continue
        if GIT_OBJECT_ID_RE.fullmatch(object_id) is None:
            problems.append(f"Git returned an invalid object ID for tracked path: {rel}")
            continue
        entry = TrackedEntry(mode=mode, object_id=object_id.lower())
        if rel in entries and entries[rel] != entry:
            problems.append(f"Conflicting Git index entries for tracked path: {rel}")
            continue
        entries[rel] = entry
    return entries, problems


def load_index_blob(
    root: Path, rel: str, entry: TrackedEntry
) -> tuple[bytes | None, list[str]]:
    """Read one index blob through the bounded batch implementation."""

    contents, problems = load_index_blobs(root, {rel: entry})
    return contents.get(rel), problems


BATCH_CONTENT_LIMIT = 16 * 1024 * 1024
BATCH_OBJECT_LIMIT = 1024


def _run_cat_file_batch(
    root: Path, arguments: list[str], object_ids: list[str]
) -> tuple[bytes | None, list[str]]:
    """Run one bounded Git batch request without exposing repository content."""

    request = "".join(f"{object_id}\n" for object_id in object_ids).encode("ascii")
    try:
        result = subprocess.run(
            ["git", "cat-file", *arguments],
            cwd=root,
            check=False,
            input=request,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return None, ["Could not inspect staged Git blobs; safety scan fails closed"]
    if result.returncode != 0:
        return None, ["Could not inspect staged Git blobs; safety scan fails closed"]
    return result.stdout, []


def _parse_batch_metadata(
    output: bytes, object_ids: list[str]
) -> tuple[dict[str, int], list[str]]:
    lines = output.splitlines()
    if len(lines) != len(object_ids):
        return {}, ["Git returned incomplete staged-blob metadata; safety scan fails closed"]

    sizes: dict[str, int] = {}
    for expected_id, line in zip(object_ids, lines, strict=True):
        try:
            fields = line.decode("ascii").split()
        except UnicodeDecodeError:
            return {}, ["Git returned invalid staged-blob metadata; safety scan fails closed"]
        if len(fields) != 3 or fields[0].lower() != expected_id or fields[1] != "blob":
            return {}, ["Git returned invalid staged-blob metadata; safety scan fails closed"]
        try:
            size = int(fields[2])
        except ValueError:
            return {}, ["Git returned an invalid staged-blob size; safety scan fails closed"]
        if size < 0 or str(size) != fields[2]:
            return {}, ["Git returned an invalid staged-blob size; safety scan fails closed"]
        sizes[expected_id] = size
    return sizes, []


def _parse_batch_contents(
    output: bytes, object_ids: list[str], expected_sizes: dict[str, int]
) -> tuple[dict[str, bytes], list[str]]:
    contents: dict[str, bytes] = {}
    offset = 0
    for expected_id in object_ids:
        header_end = output.find(b"\n", offset)
        if header_end < 0 or header_end - offset > 200:
            return {}, ["Git returned incomplete staged-blob content; safety scan fails closed"]
        try:
            fields = output[offset:header_end].decode("ascii").split()
        except UnicodeDecodeError:
            return {}, ["Git returned invalid staged-blob content; safety scan fails closed"]
        expected_size = expected_sizes[expected_id]
        if (
            len(fields) != 3
            or fields[0].lower() != expected_id
            or fields[1] != "blob"
            or fields[2] != str(expected_size)
        ):
            return {}, ["Git returned invalid staged-blob content; safety scan fails closed"]

        content_start = header_end + 1
        content_end = content_start + expected_size
        if content_end >= len(output) or output[content_end : content_end + 1] != b"\n":
            return {}, ["Git returned incomplete staged-blob content; safety scan fails closed"]
        contents[expected_id] = output[content_start:content_end]
        offset = content_end + 1

    if offset != len(output):
        return {}, ["Git returned excess staged-blob content; safety scan fails closed"]
    return contents, []


def load_index_blobs(
    root: Path, entries: dict[str, TrackedEntry]
) -> tuple[dict[str, bytes], list[str]]:
    """Read staged blobs in bounded batches instead of spawning Git per file."""

    invalid_paths = [
        rel
        for rel, entry in entries.items()
        if GIT_OBJECT_ID_RE.fullmatch(entry.object_id) is None
    ]
    if invalid_paths:
        return {}, [
            f"Invalid Git object ID for staged path {rel}; safety scan fails closed"
            for rel in sorted(invalid_paths)
        ]
    if not entries:
        return {}, []

    entries = {
        rel: TrackedEntry(entry.mode, entry.object_id.lower())
        for rel, entry in entries.items()
    }
    object_ids = sorted({entry.object_id for entry in entries.values()})
    problems: list[str] = []
    sizes: dict[str, int] = {}
    for start in range(0, len(object_ids), BATCH_OBJECT_LIMIT):
        metadata_ids = object_ids[start : start + BATCH_OBJECT_LIMIT]
        metadata_output, metadata_run_problems = _run_cat_file_batch(
            root,
            ["--batch-check=%(objectname) %(objecttype) %(objectsize)"],
            metadata_ids,
        )
        if metadata_output is None:
            problems.extend(metadata_run_problems)
            return {}, problems
        metadata_sizes, metadata_parse_problems = _parse_batch_metadata(
            metadata_output, metadata_ids
        )
        if metadata_parse_problems:
            problems.extend(metadata_parse_problems)
            return {}, problems
        sizes.update(metadata_sizes)

    allowed_ids: set[str] = set()
    allowed_paths: set[str] = set()
    for rel, entry in sorted(entries.items()):
        size_problems = scan_size_policy(rel, sizes[entry.object_id])
        problems.extend(size_problems)
        if not size_problems:
            allowed_ids.add(entry.object_id)
            allowed_paths.add(rel)

    content_by_id: dict[str, bytes] = {}
    batch: list[str] = []
    batch_size = 0
    batches: list[list[str]] = []
    for object_id in sorted(allowed_ids):
        size = sizes[object_id]
        if batch and (
            batch_size + size > BATCH_CONTENT_LIMIT
            or len(batch) >= BATCH_OBJECT_LIMIT
        ):
            batches.append(batch)
            batch = []
            batch_size = 0
        batch.append(object_id)
        batch_size += size
    if batch:
        batches.append(batch)

    for object_id_batch in batches:
        batch_output, batch_problems = _run_cat_file_batch(
            root, ["--batch"], object_id_batch
        )
        if batch_output is None:
            problems.extend(batch_problems)
            return {}, problems
        parsed_contents, parse_problems = _parse_batch_contents(
            batch_output, object_id_batch, sizes
        )
        if parse_problems:
            problems.extend(parse_problems)
            return {}, problems
        content_by_id.update(parsed_contents)

    return {
        rel: content_by_id[entry.object_id]
        for rel, entry in entries.items()
        if rel in allowed_paths and entry.object_id in content_by_id
    }, problems


def load_candidate_paths(root: Path) -> tuple[set[str], list[str]]:
    """Return tracked and untracked, non-ignored paths for pre-commit review."""

    try:
        result = subprocess.run(
            ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
            cwd=root,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        return set(), ["Could not enumerate repository candidate files; safety scan fails closed"]
    if result.returncode != 0:
        return set(), ["Could not enumerate repository candidate files; safety scan fails closed"]

    paths: set[str] = set()
    problems: list[str] = []
    for raw_path in result.stdout.split(b"\0"):
        if not raw_path:
            continue
        rel, path_problems = _validate_repository_path(raw_path)
        problems.extend(path_problems)
        if rel is not None:
            paths.add(rel)
    return paths, problems


def scan_filename(rel: str) -> list[str]:
    name = PurePosixPath(rel).name
    lowered = name.lower()
    if lowered == ".env.example":
        return []
    if lowered == ".env" or lowered.startswith(".env."):
        return [f"Non-example environment file is prohibited: {rel}"]
    if lowered in DANGEROUS_EXACT_NAMES or PurePosixPath(rel).suffix.lower() in DANGEROUS_SUFFIXES:
        return [f"Credential-bearing filename is prohibited: {rel}"]
    if CREDENTIAL_FILENAME_RE.search(lowered) and not _is_example_filename(lowered):
        return [f"Non-example credential file is prohibited: {rel}"]
    return []


def scan_text(rel: str, text: str) -> list[str]:
    problems: list[str] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        if PRIVATE_KEY_RE.search(line):
            problems.append(f"private key block in {rel}:{line_number}")

        for label, pattern in TOKEN_PATTERNS:
            if pattern.search(line):
                problems.append(f"{label} in {rel}:{line_number}")

        for match in SECRET_ASSIGNMENT_RE.finditer(line):
            if not _is_safe_secret_reference(
                match.group("value"), rel, bool(match.group("quote"))
            ):
                problems.append(f"secret assignment in {rel}:{line_number}")

        for match in EMAIL_RE.finditer(line):
            domain = match.group("domain").lower()
            if domain not in SAMPLE_EMAIL_DOMAINS and not domain.endswith(".invalid"):
                problems.append(f"non-sample email address in {rel}:{line_number}")

        for match in PHONE_RE.finditer(line):
            if _looks_like_real_phone(match.group(0)):
                problems.append(f"phone-like value in {rel}:{line_number}")

        for match in SSN_RE.finditer(line):
            if _looks_like_real_ssn(match):
                problems.append(f"SSN-like value in {rel}:{line_number}")

        for match in BANK_MARKER_RE.finditer(line):
            digits = re.sub(r"\D", "", match.group("value"))
            if 6 <= len(digits) <= 17 and set(digits) != {"0"}:
                problems.append(f"bank account/routing marker in {rel}:{line_number}")

        for match in LONG_NUMERIC_IDENTIFIER_RE.finditer(line):
            value = match.group("value")
            if len(set(value)) > 1:
                problems.append(f"long numeric identifier in {rel}:{line_number}")
    return problems


def scan_chart_of_accounts_csv(text: str) -> list[str]:
    """Enforce the allowlisted public schema for the sanitized Books reference."""

    try:
        rows = list(csv.reader(io.StringIO(text, newline=""), strict=True))
    except csv.Error as exc:
        return [f"Invalid chart-of-accounts CSV: {exc}"]
    if not rows:
        return ["Chart-of-accounts CSV is empty"]

    problems: list[str] = []
    header = rows[0]
    source_only = sorted(set(header).intersection(CHART_OF_ACCOUNTS_SOURCE_ONLY_HEADERS))
    if source_only:
        problems.append(
            "Chart-of-accounts CSV contains prohibited source-only columns: "
            + ", ".join(source_only)
        )
    if tuple(header) != CHART_OF_ACCOUNTS_HEADERS:
        problems.append(
            "Chart-of-accounts CSV must use exactly these seven columns in order: "
            + ",".join(CHART_OF_ACCOUNTS_HEADERS)
        )

    expected_width = len(CHART_OF_ACCOUNTS_HEADERS)
    for row_number, row in enumerate(rows[1:], start=2):
        if len(row) != expected_width:
            problems.append(
                f"Chart-of-accounts CSV row {row_number} has {len(row)} columns; "
                f"expected {expected_width}"
            )
            continue
        # Account codes are intentionally allowed to be short numeric values.
        # Short identifiers elsewhere must carry explicit account/bank context
        # so legitimate years and ordinary prose do not become false positives.
        for column_index in (0, 2, 3, 4, 5, 6):
            if SHORT_ACCOUNT_IDENTIFIER_RE.search(row[column_index]):
                problems.append(
                    "bank suffix or account identifier in chart-of-accounts CSV "
                    f"row {row_number}, column {CHART_OF_ACCOUNTS_HEADERS[column_index]}"
                )
    return problems


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def scan_size_policy(rel: str, size: int) -> list[str]:
    """Reject unapproved document types and files too large to inspect safely."""

    suffix = PurePosixPath(rel).suffix.lower()
    if suffix in BLOCKED_BINARY_SUFFIXES:
        expected_hash = APPROVED_BINARY_SHA256.get(rel)
        if expected_hash is None:
            return [f"Unapproved binary/document type {suffix}: {rel}"]
        if size > MAX_APPROVED_BINARY_BYTES:
            return [f"Approved binary exceeds {MAX_APPROVED_BINARY_BYTES}-byte limit: {rel}"]
        return []

    if size > MAX_TEXT_BYTES:
        return [f"Text or unknown file exceeds {MAX_TEXT_BYTES}-byte limit: {rel}"]
    return []


def scan_content_policy(rel: str, content: bytes) -> tuple[list[str], str | None]:
    """Apply binary/UTF-8 policy to supplied staged or working-tree bytes."""

    problems = scan_size_policy(rel, len(content))
    if problems:
        return problems, None

    suffix = PurePosixPath(rel).suffix.lower()
    if suffix in BLOCKED_BINARY_SUFFIXES:
        expected_hash = APPROVED_BINARY_SHA256[rel]
        if _sha256(content) != expected_hash:
            return [f"Approved binary hash mismatch: {rel}"], None
        return [], None

    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError as exc:
        return [f"Tracked file is not valid UTF-8 text ({exc}): {rel}"], None
    if b"\x00" in content:
        return [f"Unapproved binary content: {rel}"], None
    return [], text


def scan_file_policy(rel: str, path: Path) -> tuple[list[str], str | None]:
    """Apply content policy to a working-tree file."""

    try:
        size = path.stat().st_size
    except OSError as exc:
        return [f"Could not inspect repository file {rel}: {exc}"], None
    size_problems = scan_size_policy(rel, size)
    if size_problems:
        return size_problems, None
    try:
        content = path.read_bytes()
    except OSError as exc:
        return [f"Could not read repository file {rel}: {exc}"], None
    if len(content) != size:
        return [f"Repository file changed while being inspected: {rel}"], None
    return scan_content_policy(rel, content)


def scan_decoded_text(rel: str, text: str) -> list[str]:
    problems = scan_text(rel, text)
    if rel == CHART_OF_ACCOUNTS_PATH:
        problems.extend(scan_chart_of_accounts_csv(text))
    return problems


def _label_problems(problems: list[str], source: str) -> list[str]:
    return [f"{problem} [{source}]" for problem in problems]


def scan_repository(root: Path = ROOT) -> list[str]:
    entries, problems = load_tracked_entries(root)
    candidate_paths, candidate_problems = load_candidate_paths(root)
    problems.extend(candidate_problems)
    missing_candidates = sorted(set(entries).difference(candidate_paths))
    for rel in missing_candidates:
        problems.append(
            f"Tracked path was omitted from repository candidate enumeration: {rel}"
        )

    scannable_entries = {
        rel: entry
        for rel, entry in entries.items()
        if entry.mode in ALLOWED_GIT_MODES
    }
    index_contents, index_load_problems = load_index_blobs(root, scannable_entries)
    problems.extend(_label_problems(index_load_problems, "staged index"))

    for rel in sorted(candidate_paths):
        entry = entries.get(rel)
        mode = entry.mode if entry is not None else "100644"
        parts = set(PurePosixPath(rel).parts)
        prohibited_dirs = sorted(parts.intersection(VENDOR_OR_CACHE_DIRS))
        if prohibited_dirs:
            problems.append(
                f"Repository file is prohibited inside vendor/cache directory {prohibited_dirs[0]}: {rel}"
            )

        if mode == "120000":
            problems.append(f"Symbolic links are prohibited: {rel}")
            continue
        if mode not in ALLOWED_GIT_MODES:
            problems.append(f"Unsupported tracked Git mode {mode}: {rel}")
            continue

        problems.extend(scan_filename(rel))

        index_content = index_contents.get(rel)
        if index_content is not None:
            index_policy_problems, index_text = scan_content_policy(rel, index_content)
            problems.extend(_label_problems(index_policy_problems, "staged index"))
            if index_text is not None:
                problems.extend(
                    _label_problems(
                        scan_decoded_text(rel, index_text), "staged index"
                    )
                )

        path = root.joinpath(*PurePosixPath(rel).parts)
        if path.is_symlink():
            problems.append(f"Symbolic links are prohibited: {rel}")
            continue
        if not path.is_file():
            problems.append(f"Repository path is missing or not a regular file: {rel}")
            continue

        try:
            working_size = path.stat().st_size
        except OSError as exc:
            problems.append(f"Could not inspect repository file {rel}: {exc}")
            continue
        working_size_problems = scan_size_policy(rel, working_size)
        if working_size_problems:
            problems.extend(_label_problems(working_size_problems, "working tree"))
            continue
        try:
            working_content = path.read_bytes()
        except OSError as exc:
            problems.append(f"Could not read repository file {rel}: {exc}")
            continue
        if len(working_content) != working_size:
            problems.append(f"Repository file changed while being inspected: {rel}")
            continue

        # The index is the commit candidate. A differing worktree is scanned
        # separately so neither staged-only nor unstaged-only private data can
        # hide behind the other copy.
        if entry is None or index_content is None or working_content != index_content:
            source = "untracked file" if entry is None else "working tree"
            working_policy_problems, working_text = scan_content_policy(
                rel, working_content
            )
            problems.extend(_label_problems(working_policy_problems, source))
            if working_text is not None:
                problems.extend(
                    _label_problems(scan_decoded_text(rel, working_text), source)
                )
    return problems


def main() -> int:
    problems = scan_repository(ROOT)
    if problems:
        print("Safety check found issues:\n")
        for problem in problems:
            print(f"- {problem}")
        return 1

    print("Safety check passed. Manually verify that no private data is committed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
