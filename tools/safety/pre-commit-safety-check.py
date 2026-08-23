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
import json
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath
from typing import Mapping, NamedTuple


ROOT = Path(__file__).resolve().parents[2]

SECRET_REGISTRY_PATHS = (
    PurePosixPath("src/zoho-catalyst/billing-webhook-gateway/config/variables.json"),
    PurePosixPath("src/zoho-catalyst/crm-billing-orchestrator/config/variables.json"),
    PurePosixPath("src/zoho-catalyst/form1-controller/config/variables.json"),
    PurePosixPath("src/zoho-catalyst/form2-controller/config/variables.json"),
    PurePosixPath("src/zoho-catalyst/retell-free-test/config/variables.json"),
)
SECRET_REGISTRY_CLASSIFICATIONS = frozenset({"secret", "stable-secret"})
LEGACY_REGISTRY_CLASSIFICATIONS = {
    "artifact-binding": "public-build-identity",
    "bounded-runtime": "bounded-runtime-policy",
    "environment-binding": "safe-enum",
    "feature-gate": "safe-boolean",
    "immutable-identity-secret": "stable-secret",
    "private-connection": "private-connection-identity",
    "private-crm-value": "private-crm-contract",
    "private-identifier": "private-platform-identifier",
    "private-operating-rule": "business-policy",
    "private-plan": "private-platform-identifier",
    "private-plan-map": "private-platform-identifier",
    "private-platform-name": "private-platform-identifier",
    "private-route": "private-deployment-routing",
    "private-route-auth": "private-auth-metadata",
    "public-api-base": "public-protocol-setting",
    "secret": "secret",
    "verified-platform-contract": "verified-platform-contract",
}
ALLOWED_REGISTRY_CLASSIFICATIONS = frozenset(
    {
        "bounded-runtime-policy",
        "bounded-security-policy",
        "business-contract",
        "business-policy",
        "fixed-security-policy",
        "private-auth-metadata",
        "private-connection-identity",
        "private-crm-contract",
        "private-data-contract",
        "private-deployment-identifier",
        "private-deployment-routing",
        "private-endpoint",
        "private-form-contract",
        "private-oauth-identity",
        "private-outbound-allowlist",
        "private-platform-identifier",
        "private-regional-endpoint",
        "private-route",
        "private-security-configuration",
        "private-source-identity",
        "public-build-identity",
        "public-protocol-setting",
        "runtime-metadata",
        "safe-boolean",
        "safe-bounded-scalar",
        "safe-enum",
        "secret",
        "security-and-reliability-policy",
        "security-policy",
        "security-protocol-setting",
        "stable-secret",
        "verified-platform-contract",
    }
)
ADDITIONAL_SECRET_ASSIGNMENT_NAMES = frozenset(
    {
        "CATALYST_TOKEN",
        "OPERATOR_HMAC_SECRET",
        "RETELL_API_KEY",
        "RETELL_WEBHOOK_API_KEY",
        "RETELL_WEBHOOK_SIGNING_SECRET",
        "SYLVARA_PII_HASH_KEY",
        "SYLVARA_ROUTE_HASH_KEY",
    }
)
CONFIG_VARIABLE_NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]{1,127}$")
GENERIC_UPPERCASE_SECRET_NAME_RE = re.compile(
    r"^[A-Z][A-Z0-9_]*(?:_SECRET|_TOKEN|_PEPPER|_PASSWORD|_PASSWD|"
    r"_CREDENTIAL|_API_KEY|_PRIVATE_KEY|_SIGNING_KEY|_ACCESS_KEY|_HEADER_VALUE)$"
    r"|^[A-Z][A-Z0-9_]*(?:_HASH_KEY|_HMAC_KEY|_WEBHOOK_KEY)$"
)
GENERIC_CODE_KEY_MATERIAL_NAME_RE = re.compile(
    r"^[A-Za-z_$][A-Za-z0-9_$]*(?:HashKey|HmacKey|HMACKey|HmacSecret|"
    r"HMACSecret|WebhookKey|WebhookSecret|SigningSecret)$"
)

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
SECRET_ASSIGNMENT_NAME_RE = re.compile(
    r"\b(?P<name>access[_-]?token|api[_-]?key|auth[_-]?token|bearer[_-]?token|"
    r"client[_-]?secret|consumer[_-]?secret|password|passwd|private[_-]?key|"
    r"refresh[_-]?token|secret[_-]?(?:access[_-]?)?key|signing[_-]?secret|"
    r"webhook[_-]?(?:secret|signing[_-]?key)|aws[_-]?secret[_-]?access[_-]?key|"
    r"github[_-]?token|openai[_-]?api[_-]?key|zoho[_-]?(?:access[_-]?token|"
    r"client[_-]?secret|refresh[_-]?token)|retell[_-]?(?:api[_-]?)?key|"
    r"make[_-]?(?:api[_-]?)?token)\b",
    re.IGNORECASE,
)
CONFIG_ASSIGNMENT_NAME_RE = re.compile(
    r"(?<![A-Za-z0-9_])(?<!\$\{)(?P<name_quote>['\"]?)"
    r"(?P<name>[A-Za-z][A-Za-z0-9_]{1,127})"
    r"(?P=name_quote)",
)
BRACKET_CONFIG_ASSIGNMENT_NAME_RE = re.compile(
    r"(?<![A-Za-z0-9_$])"
    r"[A-Za-z_$][A-Za-z0-9_$.]*\s*\[\s*"
    r"(?P<name_quote>['\"`])(?P<name>[A-Za-z][A-Za-z0-9_]{1,127})"
    r"(?P=name_quote)\s*\]",
)
COMPUTED_PROPERTY_ASSIGNMENT_NAME_RE = re.compile(
    r"(?<![A-Za-z0-9_$])\[\s*"
    r"(?P<name_quote>['\"`])(?P<name>[A-Za-z][A-Za-z0-9_]{1,127})"
    r"(?P=name_quote)\s*\]",
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

SAFE_SECRET_VALUE_WORDS = {
    "",
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
SAFE_PUBLIC_TEST_SECRET_WORDS = frozenset(
    {
        "abcdef123456",
        "short",
        "synthetic-secret-value",
        "syntheticbillingsecret1234",
        "syntheticfingerprintsecretvalue123456",
        "syntheticfixturevalue123456789",
    }
)

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


class SecretAssignment(NamedTuple):
    """One conservatively parsed assignment to a secret-bearing name."""

    value: str
    quoted: bool
    start_offset: int
    end_offset: int
    quote_offset: int


class SecretRegistryError(RuntimeError):
    """Raised when the reviewed secret-name registry cannot be trusted."""


def load_registry_secret_names_from_contents(
    registry_contents: Mapping[str, bytes],
    *,
    require_all: bool = True,
) -> frozenset[str]:
    """Parse exact registry bytes from one repository view, failing closed."""

    names = set(ADDITIONAL_SECRET_ASSIGNMENT_NAMES)
    loaded_registry_count = 0
    for relative_path in SECRET_REGISTRY_PATHS:
        registry_key = relative_path.as_posix()
        raw = registry_contents.get(registry_key)
        if raw is None:
            if not require_all:
                continue
            raise SecretRegistryError(
                f"Could not read secret variable registry {relative_path}"
            )
        loaded_registry_count += 1
        if len(raw) > MAX_TEXT_BYTES:
            raise SecretRegistryError(
                f"Secret variable registry exceeds the text limit: {relative_path}"
            )
        try:
            document = json.loads(raw.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise SecretRegistryError(
                f"Secret variable registry is not valid UTF-8 JSON: {relative_path}"
            ) from exc
        variables = document.get("variables") if isinstance(document, dict) else None
        if not isinstance(variables, list) or not variables:
            raise SecretRegistryError(
                f"Secret variable registry has no variable list: {relative_path}"
            )

        seen: set[str] = set()
        for index, entry in enumerate(variables, start=1):
            if not isinstance(entry, dict):
                raise SecretRegistryError(
                    f"Secret variable registry entry {index} is invalid: {relative_path}"
                )
            name = entry.get("name")
            classification = entry.get("classification")
            if classification is None:
                legacy_class = entry.get("class")
                classification = LEGACY_REGISTRY_CLASSIFICATIONS.get(legacy_class)
            if classification is None and isinstance(entry.get("secret"), bool):
                classification = "secret" if entry["secret"] else "runtime-metadata"
            if (
                not isinstance(name, str)
                or CONFIG_VARIABLE_NAME_RE.fullmatch(name) is None
                or not isinstance(classification, str)
                or classification not in ALLOWED_REGISTRY_CLASSIFICATIONS
                or name in seen
            ):
                raise SecretRegistryError(
                    f"Secret variable registry entry {index} is invalid: {relative_path}"
                )
            seen.add(name)
            if classification in SECRET_REGISTRY_CLASSIFICATIONS:
                names.add(name)

    if loaded_registry_count and names == set(ADDITIONAL_SECRET_ASSIGNMENT_NAMES):
        raise SecretRegistryError("Secret variable registries contain no secret names")
    return frozenset(names)


def load_registry_secret_names(root: Path = ROOT) -> frozenset[str]:
    """Load every secret-classified working-tree variable name, failing closed."""

    registry_contents: dict[str, bytes] = {}
    for relative_path in SECRET_REGISTRY_PATHS:
        path = root.joinpath(*relative_path.parts)
        try:
            registry_contents[relative_path.as_posix()] = path.read_bytes()
        except OSError as exc:
            raise SecretRegistryError(
                f"Could not read secret variable registry {relative_path}"
            ) from exc
    return load_registry_secret_names_from_contents(registry_contents)


def load_head_registry_secret_names(root: Path = ROOT) -> frozenset[str]:
    """Load the committed registry baseline so a candidate cannot downgrade it."""

    try:
        result = subprocess.run(
            [
                "git",
                "ls-tree",
                "-z",
                "HEAD",
                "--",
                *(path.as_posix() for path in SECRET_REGISTRY_PATHS),
            ],
            cwd=root,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise SecretRegistryError(
            "Could not read the committed secret variable registry baseline"
        ) from exc
    if result.returncode != 0:
        raise SecretRegistryError(
            "Could not read the committed secret variable registry baseline"
        )

    expected_paths = {path.as_posix() for path in SECRET_REGISTRY_PATHS}
    entries: dict[str, TrackedEntry] = {}
    for record in result.stdout.split(b"\0"):
        if not record:
            continue
        metadata, separator, raw_path = record.partition(b"\t")
        fields = metadata.split()
        if not separator or len(fields) != 3:
            raise SecretRegistryError(
                "Git returned an invalid committed secret registry entry"
            )
        try:
            mode = fields[0].decode("ascii")
            object_type = fields[1].decode("ascii")
            object_id = fields[2].decode("ascii")
        except UnicodeDecodeError as exc:
            raise SecretRegistryError(
                "Git returned invalid committed secret registry metadata"
            ) from exc
        rel, path_problems = _validate_repository_path(raw_path)
        if (
            path_problems
            or rel is None
            or rel not in expected_paths
            or mode not in ALLOWED_GIT_MODES
            or object_type != "blob"
            or GIT_OBJECT_ID_RE.fullmatch(object_id) is None
            or rel in entries
        ):
            raise SecretRegistryError(
                "Git returned an unsafe committed secret registry entry"
            )
        entries[rel] = TrackedEntry(mode, object_id.lower())

    contents, problems = load_index_blobs(root, entries)
    if problems:
        raise SecretRegistryError(
            "Could not inspect the committed secret variable registry baseline"
        )
    return load_registry_secret_names_from_contents(contents, require_all=False)


SECRET_ASSIGNMENT_NAMES = load_registry_secret_names()


def _is_example_filename(name: str) -> bool:
    lowered = name.lower()
    return lowered == ".env.example" or any(
        marker in lowered for marker in EXAMPLE_FILENAME_MARKERS
    )


def _is_safe_secret_reference(value: str, rel: str, quoted: bool) -> bool:
    stripped = value.strip()
    lowered = stripped.strip("'\"`").lower()
    if lowered in SAFE_SECRET_VALUE_WORDS:
        return True
    if re.fullmatch(r"<[^<>\r\n]{1,200}>", stripped):
        return True
    if re.fullmatch(r"<<[^<>\r\n]{1,200}>>", stripped):
        return True
    if re.fullmatch(r"\{\{[^{}\r\n]{1,200}\}\}", stripped):
        return True
    if re.fullmatch(r"\[[^\[\]\r\n]{1,200}\]", stripped):
        return True
    if re.fullmatch(r"\$[A-Za-z_][A-Za-z0-9_]*", stripped):
        return True
    if re.fullmatch(r"\$\{[A-Za-z_][A-Za-z0-9_]*\}", stripped):
        return True
    if quoted:
        return False

    safe_runtime_references = (
        r"(?:config|env|runtime|secrets|settings|parsed|response)"
        r"\.[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*",
        r"process\.env\.[A-Za-z_$][A-Za-z0-9_$]*",
        r"String\(process\.env\.[A-Za-z_$][A-Za-z0-9_$]*\)",
        r"os\.environ\[['\"][A-Za-z_][A-Za-z0-9_]*['\"]\]",
        r"(?:await\s+)?(?:get_secret|getsecret|load_secret|env)"
        r"\(\s*['\"][A-Za-z_][A-Za-z0-9_]*['\"]\s*\)",
    )
    if any(
        re.fullmatch(pattern, stripped, re.IGNORECASE)
        for pattern in safe_runtime_references
    ):
        return True
    code_suffixes = {".cjs", ".deluge", ".js", ".mjs", ".py", ".ts"}
    return (
        PurePosixPath(rel).suffix.lower() in code_suffixes
        and re.fullmatch(
            r"[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*",
            stripped,
        )
        is not None
    )


def _assignment_suffix_is_safe(source: str, end_offset: int) -> bool:
    """Require the parsed value to be the complete assignment expression."""

    cursor = end_offset
    crossed_line = False
    while cursor < len(source):
        while cursor < len(source) and source[cursor] in " \t":
            cursor += 1
        if cursor >= len(source):
            return True
        if not crossed_line and source[cursor] in ",;})]":
            return True
        if source.startswith("//", cursor) or source[cursor] == "#":
            newline = source.find("\n", cursor)
            if newline < 0:
                return True
            cursor = newline + 1
            crossed_line = True
            continue
        if source[cursor] == "\r":
            cursor += 1
            if cursor < len(source) and source[cursor] == "\n":
                cursor += 1
            crossed_line = True
            continue
        if source[cursor] == "\n":
            cursor += 1
            crossed_line = True
            continue
        break

    if not crossed_line:
        return False
    return not source.startswith(
        (
            "||",
            "??",
            "&&",
            "+",
            "-",
            "*",
            "/",
            "%",
            "^",
            "!",
            "<",
            ">",
            "?",
            ":",
            ".",
            "`",
            "(",
            "[",
        ),
        cursor,
    )


def _is_test_fixture_path(rel: str) -> bool:
    path = PurePosixPath(rel)
    lowered_parts = {part.lower() for part in path.parts}
    lowered_name = path.name.lower()
    return (
        bool(lowered_parts.intersection({"test", "tests"}))
        or lowered_name.startswith("test_")
        or ".test." in lowered_name
    )


def _is_safe_public_test_secret_fixture(
    value: str,
    rel: str,
    source: str,
    assignment: SecretAssignment,
) -> bool:
    """Allow only deterministic, visibly synthetic literals in test source."""

    if not _is_test_fixture_path(rel):
        return False
    lowered = value.strip().strip("'\"").lower()
    if lowered in SAFE_PUBLIC_TEST_SECRET_WORDS:
        return _assignment_suffix_is_safe(source, assignment.end_offset)

    quote_start = assignment.quote_offset
    if quote_start < 0:
        return False
    repeat = re.match(
        r"(?P<quote>['\"`])[A-Za-z0-9](?P=quote)\.repeat\([1-9][0-9]{0,2}\)",
        source[quote_start:],
    )
    return repeat is not None and _assignment_suffix_is_safe(
        source, quote_start + repeat.end()
    )


def _iter_secret_assignments(
    source: str, secret_names: frozenset[str]
):
    def skip_trivia(cursor: int) -> int | None:
        """Skip arbitrary whitespace and complete JS-style comments."""

        while cursor < len(source):
            if source[cursor].isspace():
                cursor += 1
                continue
            if source.startswith("/*", cursor):
                comment_end = source.find("*/", cursor + 2)
                if comment_end < 0:
                    return None
                cursor = comment_end + 2
                continue
            if source.startswith("//", cursor):
                newline = source.find("\n", cursor + 2)
                if newline < 0:
                    return len(source)
                cursor = newline + 1
                continue
            return cursor
        return cursor

    def skip_horizontal(cursor: int) -> int:
        while cursor < len(source) and source[cursor] in " \t":
            cursor += 1
        return cursor

    def locate_value_offset(name_match: re.Match[str], delimiter: str) -> int | None:
        cursor = skip_trivia(name_match.end())
        if cursor is None or cursor >= len(source):
            return None

        if delimiter == "equals":
            return skip_horizontal(cursor + 1) if source[cursor] == "=" else None
        if delimiter == "colon":
            return skip_horizontal(cursor + 1) if source[cursor] == ":" else None

        if source[cursor] == "=":
            return skip_horizontal(cursor + 1)
        if source[cursor] != ":":
            return None

        # Distinguish JSON/YAML's value colon from a common TypeScript/Python
        # annotation followed by '='. The type token is bounded and the
        # subsequent trivia parser handles any number of interposed comments.
        value_offset = skip_horizontal(cursor + 1)
        type_match = re.match(
            r"[A-Za-z_$][A-Za-z0-9_$<>,.?|\[\] &]{0,255}",
            source[value_offset:],
        )
        if type_match is not None:
            typed_end = value_offset + len(type_match.group(0).rstrip())
            equals_cursor = skip_trivia(typed_end)
            if (
                equals_cursor is not None
                and equals_cursor < len(source)
                and source[equals_cursor] == "="
            ):
                return skip_horizontal(equals_cursor + 1)
        return value_offset

    def parse_value(start_offset: int, value_offset: int) -> SecretAssignment:
        if value_offset < len(source) and source[value_offset] in "\r\n":
            newline_end = value_offset + 1
            if (
                source[value_offset] == "\r"
                and newline_end < len(source)
                and source[newline_end] == "\n"
            ):
                newline_end += 1
            next_line_end = source.find("\n", newline_end)
            if next_line_end < 0:
                next_line_end = len(source)
            next_line = source[newline_end:next_line_end]
            candidate = next_line.lstrip(" \t")
            indented = len(candidate) < len(next_line)
            obvious_literal = candidate.startswith(
                ("'", '"', "`", "<", "${", "{{", "[")
            ) or re.match(r"(?i:[fbru]{1,3})['\"]", candidate) is not None
            obvious_new_assignment = re.match(
                r"[A-Za-z_][A-Za-z0-9_]{1,127}\s*[:=]", candidate
            ) is not None
            if (
                candidate
                and not candidate.startswith(("#", "//"))
                and not obvious_new_assignment
                and (indented or obvious_literal)
            ):
                value_offset = newline_end + (len(next_line) - len(candidate))
        if source.startswith('"""', value_offset) or source.startswith("'''", value_offset):
            delimiter = source[value_offset : value_offset + 3]
            content_start = value_offset + 3
            content_end = source.find(delimiter, content_start)
            value = source[content_start:] if content_end < 0 else source[content_start:content_end]
            end_offset = len(source) if content_end < 0 else content_end + 3
            return SecretAssignment(
                value, True, start_offset, end_offset, value_offset
            )

        if value_offset < len(source) and source[value_offset] in "'\"`":
            delimiter = source[value_offset]
            cursor = value_offset + 1
            while cursor < len(source):
                if source[cursor] == "\\":
                    cursor += 2
                    continue
                if source[cursor] == delimiter:
                    break
                cursor += 1
            return SecretAssignment(
                source[value_offset + 1 : cursor],
                True,
                start_offset,
                len(source) if cursor >= len(source) else cursor + 1,
                value_offset,
            )

        structured_reference = re.match(
            r"(?:"
            r"\$\{[^}\r\n]*\}|"
            r"\{\{[^{}\r\n]{1,200}\}\}|"
            r"\[[^\[\]\r\n]{1,200}\]|"
            r"String\(process\.env\.[A-Za-z_$][A-Za-z0-9_$]*\)|"
            r"os\.environ\[['\"][A-Za-z_][A-Za-z0-9_]*['\"]\]|"
            r"(?:await\s+)?(?:get_secret|getsecret|load_secret|env)"
            r"\(\s*['\"][A-Za-z_][A-Za-z0-9_]*['\"]\s*\)"
            r")",
            source[value_offset:],
            re.IGNORECASE,
        )
        if structured_reference is not None:
            value = structured_reference.group(0)
            return SecretAssignment(
                value,
                False,
                start_offset,
                value_offset + len(value),
                -1,
            )

        unquoted = re.match(r"[^'\"`\\\s,;})\]]+", source[value_offset:])
        value = "" if unquoted is None else unquoted.group(0)
        return SecretAssignment(
            value,
            False,
            start_offset,
            value_offset + len(value),
            -1,
        )

    def is_secret_name(name: str) -> bool:
        normalized = name.upper()
        return normalized in secret_names or (
            name == normalized
            and GENERIC_UPPERCASE_SECRET_NAME_RE.fullmatch(name) is not None
        ) or GENERIC_CODE_KEY_MATERIAL_NAME_RE.fullmatch(name) is not None

    seen_value_offsets: set[int] = set()
    for name_match in SECRET_ASSIGNMENT_NAME_RE.finditer(source):
        value_offset = locate_value_offset(name_match, "standard")
        if value_offset is None or value_offset in seen_value_offsets:
            continue
        seen_value_offsets.add(value_offset)
        yield parse_value(name_match.start(), value_offset)

    for name_pattern, delimiter in (
        (CONFIG_ASSIGNMENT_NAME_RE, "standard"),
        (BRACKET_CONFIG_ASSIGNMENT_NAME_RE, "equals"),
        (COMPUTED_PROPERTY_ASSIGNMENT_NAME_RE, "colon"),
    ):
        for name_match in name_pattern.finditer(source):
            name = name_match.group("name")
            if not is_secret_name(name):
                continue
            value_offset = locate_value_offset(name_match, delimiter)
            if value_offset is None or value_offset in seen_value_offsets:
                continue
            seen_value_offsets.add(value_offset)
            yield parse_value(name_match.start(), value_offset)


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


def scan_text(
    rel: str,
    text: str,
    secret_names: frozenset[str] | None = None,
) -> list[str]:
    selected_secret_names = SECRET_ASSIGNMENT_NAMES if secret_names is None else secret_names
    problems: list[str] = []

    # Scan assignments over the complete document so pretty-printed JSON,
    # multiline JavaScript, and indented YAML cannot split a registry name from
    # its literal value. Other content checks stay line-oriented for precise
    # diagnostics and to avoid matching unrelated prose across line breaks.
    for assignment in _iter_secret_assignments(text, selected_secret_names):
        if not (
            (
                _is_safe_secret_reference(
                    assignment.value, rel, assignment.quoted
                )
                and _assignment_suffix_is_safe(text, assignment.end_offset)
            )
            or _is_safe_public_test_secret_fixture(
                assignment.value, rel, text, assignment
            )
        ):
            line_number = text.count("\n", 0, assignment.start_offset) + 1
            problems.append(f"secret assignment in {rel}:{line_number}")

    for line_number, line in enumerate(text.splitlines(), start=1):
        if PRIVATE_KEY_RE.search(line):
            problems.append(f"private key block in {rel}:{line_number}")

        for label, pattern in TOKEN_PATTERNS:
            if pattern.search(line):
                problems.append(f"{label} in {rel}:{line_number}")

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


def scan_decoded_text(
    rel: str,
    text: str,
    secret_names: frozenset[str] | None = None,
) -> list[str]:
    problems = scan_text(rel, text, secret_names)
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

    try:
        index_secret_names = load_registry_secret_names_from_contents(index_contents)
    except SecretRegistryError as exc:
        problems.append(f"{exc} [staged index]")
        index_secret_names = SECRET_ASSIGNMENT_NAMES
    try:
        working_secret_names = load_registry_secret_names(root)
    except SecretRegistryError as exc:
        problems.append(f"{exc} [working tree]")
        working_secret_names = SECRET_ASSIGNMENT_NAMES
    try:
        baseline_secret_names = load_head_registry_secret_names(root)
    except SecretRegistryError as exc:
        problems.append(f"{exc} [committed baseline]")
        baseline_secret_names = SECRET_ASSIGNMENT_NAMES

    protected_baseline_names = baseline_secret_names.difference(
        ADDITIONAL_SECRET_ASSIGNMENT_NAMES
    )
    for source, current_names in (
        ("staged index", index_secret_names),
        ("working tree", working_secret_names),
    ):
        retired_names = sorted(protected_baseline_names.difference(current_names))
        if retired_names:
            problems.append(
                "Secret registry names may not be removed or downgraded without "
                f"a reviewed scanner migration: {', '.join(retired_names)} [{source}]"
            )

    protected_secret_names = frozenset(
        baseline_secret_names | index_secret_names | working_secret_names
    )

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
                        scan_decoded_text(rel, index_text, protected_secret_names),
                        "staged index",
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
                    _label_problems(
                        scan_decoded_text(rel, working_text, protected_secret_names),
                        source,
                    )
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
