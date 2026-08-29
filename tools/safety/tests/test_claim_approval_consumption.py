from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import inspect
import io
import json
import os
import sqlite3
import stat
import subprocess
import sys
import tempfile
import unittest
import unittest.mock as mock
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "claim_approval_consumption.py"
REPOSITORY_ROOT = SCRIPT.parents[2]
SPEC = importlib.util.spec_from_file_location("claim_approval_consumption", SCRIPT)
assert SPEC and SPEC.loader
ledger_tool = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = ledger_tool
SPEC.loader.exec_module(ledger_tool)
RAW_PAIR_API_WAS_EXPOSED = hasattr(ledger_tool, "claim_approval_consumption")
# Storage-hardening tests exercise the private primitive directly. Production
# callers do not receive this test-only compatibility alias.
ledger_tool.claim_approval_consumption = ledger_tool._claim_approval_consumption

_INTERNAL_CLAIM_PROGRAM = """
import sys
from tools.safety import claim_approval_consumption as ledger
try:
    ledger._claim_approval_consumption(sys.argv[1], sys.argv[2], sys.argv[3])
except ledger.ApprovalAlreadyConsumed:
    print(ledger.ALREADY_CONSUMED)
    raise SystemExit(ledger.EXIT_ALREADY_CONSUMED)
except BaseException:
    print(ledger.ERROR, file=sys.stderr)
    raise SystemExit(ledger.EXIT_ERROR)
print(ledger.CLAIMED)
"""

DIGEST = hashlib.sha256(
    b"sylvara.synthetic-validator-consumption.v1\x00packet-a"
).hexdigest()
OTHER_DIGEST = hashlib.sha256(
    b"sylvara.synthetic-validator-consumption.v1\x00packet-b"
).hexdigest()
THIRD_DIGEST = hashlib.sha256(
    b"sylvara.synthetic-validator-consumption.v1\x00packet-c"
).hexdigest()
AUTHORITY_ID = "123e4567-e89b-42d3-a456-426614174000"
OTHER_AUTHORITY_ID = "123e4567-e89b-42d3-b456-426614174001"
THIRD_AUTHORITY_ID = hashlib.sha256(
    b"sylvara.synthetic-stable-authority.v1\x00authority-c"
).hexdigest()


def _secure_directory(path: Path) -> None:
    if os.name != "nt":
        path.chmod(0o700)
        return
    try:
        sid = ledger_tool._windows_current_user_sid()
        result = subprocess.run(
            [
                "icacls",
                str(path),
                "/inheritance:r",
                "/grant:r",
                f"*{sid}:(OI)(CI)F",
            ],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise unittest.SkipTest(
            f"native Windows ACL fixture setup unavailable: {type(error).__name__}"
        ) from error
    if result.returncode != 0:
        raise unittest.SkipTest("native Windows ACL fixture setup unavailable")
    # A successful native setup must pass the production verifier; a verifier
    # defect is a test failure, not a reason to skip Windows coverage.
    ledger_tool._validate_windows_acl(path, require_protected=True)


class ApprovalConsumptionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.ledger = self.root / "ledger"
        self.worktree = self.root / "attached-worktree"
        self.ledger.mkdir()
        self.worktree.mkdir()
        _secure_directory(self.ledger)
        self.worktree_patch = mock.patch.object(
            ledger_tool,
            "_discover_attached_worktrees",
            return_value=(self.worktree,),
        )
        self.worktree_patch.start()
        self.environment_patch = mock.patch.dict(
            os.environ,
            {ledger_tool.LEDGER_DIRECTORY_ENV: str(self.ledger)},
        )
        self.environment_patch.start()
        ledger_tool._BOUND_LEDGER_DIRECTORY = None
        ledger_tool._BOUND_NODE_EXECUTABLE = None

    def tearDown(self) -> None:
        ledger_tool._BOUND_LEDGER_DIRECTORY = None
        ledger_tool._BOUND_NODE_EXECUTABLE = None
        self.environment_patch.stop()
        self.worktree_patch.stop()
        self.temporary.cleanup()

    @property
    def database(self) -> Path:
        return self.ledger / ledger_tool.DATABASE_NAME

    def rows(self) -> list[tuple[str, str, str]]:
        with contextlib.closing(sqlite3.connect(self.database)) as connection:
            return connection.execute(
                "SELECT authority_id, digest, claimed_at FROM claims "
                "ORDER BY authority_id"
            ).fetchall()

    def run_cli(
        self,
        digest: str = DIGEST,
        authority_id: str = AUTHORITY_ID,
        ledger: Path | None = None,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                "-c",
                _INTERNAL_CLAIM_PROGRAM,
                str(self.ledger if ledger is None else ledger),
                digest,
                authority_id,
            ],
            cwd=REPOSITORY_ROOT,
            check=False,
            capture_output=True,
            text=True,
            timeout=45,
        )

    def precreate_database(self, content: bytes = b"") -> None:
        descriptor = os.open(self.database, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            if os.name != "nt":
                os.fchmod(descriptor, 0o600)
            if content:
                os.write(descriptor, content)
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    def test_raw_pair_api_is_not_exposed_and_legacy_cli_shape_is_rejected(self) -> None:
        self.assertFalse(RAW_PAIR_API_WAS_EXPOSED)
        cases = (
            [
                sys.executable,
                str(SCRIPT),
                str(self.ledger),
                DIGEST,
                "--authority-id",
                AUTHORITY_ID,
            ],
            [
                sys.executable,
                str(SCRIPT),
                ledger_tool.CRM_WORKFLOW_REPAIR_VALIDATOR,
                str(self.ledger),
                str(self.root / "packet.json"),
                str(self.root / "approval.json"),
            ],
        )
        for command in cases:
            result = subprocess.run(
                command,
                cwd=REPOSITORY_ROOT,
                check=False,
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(ledger_tool.EXIT_ERROR, result.returncode)
            self.assertEqual("", result.stdout)
            self.assertEqual("error\n", result.stderr)
        self.assertEqual([], list(self.ledger.iterdir()))

    def test_exact_wrapper_claims_only_the_fixed_validator_result(self) -> None:
        with mock.patch.object(
            ledger_tool, "_assert_execution_boundary_source_clean"
        ), mock.patch.object(
            ledger_tool,
            "_validate_crm_workflow_repair",
            return_value=(AUTHORITY_ID, DIGEST),
        ) as validator:
            receipt = ledger_tool.validate_and_claim_approval(
                ledger_tool.CRM_WORKFLOW_REPAIR_VALIDATOR,
                self.root / "private-packet.json",
                self.root / "private-approval.json",
            )

        validator.assert_called_once()
        self.assertEqual({"claimed"}, set(receipt.__dataclass_fields__))
        self.assertTrue(receipt.claimed)
        rendered = repr(receipt)
        self.assertNotIn(AUTHORITY_ID, rendered)
        self.assertNotIn(DIGEST, rendered)
        self.assertEqual(1, len(self.rows()))
        self.assertEqual((AUTHORITY_ID, DIGEST), self.rows()[0][:2])

    def test_independent_pair_cannot_be_supplied_to_public_boundary(self) -> None:
        self.assertFalse(hasattr(ledger_tool, "claim_authenticated_validator_result"))
        self.assertFalse(hasattr(ledger_tool, "_authenticate_validator_result"))
        self.assertEqual(
            ["validator", "packet_path", "approval_path"],
            list(inspect.signature(ledger_tool.validate_and_claim_approval).parameters),
        )

        with self.assertRaises(TypeError):
            ledger_tool.validate_and_claim_approval(
                ledger_tool.CRM_WORKFLOW_REPAIR_VALIDATOR,
                self.ledger,
                OTHER_AUTHORITY_ID,
                OTHER_DIGEST,
            )

        self.assertEqual([], list(self.ledger.iterdir()))

    def test_canonical_ledger_binding_rejects_configuration_drift(self) -> None:
        alternate = self.root / "alternate-ledger"
        alternate.mkdir()
        _secure_directory(alternate)

        self.assertEqual(self.ledger, ledger_tool._configured_ledger_directory())
        with mock.patch.dict(
            os.environ,
            {ledger_tool.LEDGER_DIRECTORY_ENV: str(alternate)},
        ):
            with self.assertRaises(ledger_tool.InvalidClaimInput):
                ledger_tool._configured_ledger_directory()

        self.assertEqual([], list(self.ledger.iterdir()))
        self.assertEqual([], list(alternate.iterdir()))

    def test_canonical_ledger_binding_is_mandatory(self) -> None:
        ledger_tool._BOUND_LEDGER_DIRECTORY = None
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop(ledger_tool.LEDGER_DIRECTORY_ENV, None)
            with self.assertRaises(ledger_tool.InvalidClaimInput):
                ledger_tool._configured_ledger_directory()
        self.assertEqual([], list(self.ledger.iterdir()))

    def test_configured_node_is_absolute_hash_pinned_and_drift_rejected(self) -> None:
        first = self.root / "synthetic-node-one.exe"
        second = self.root / "synthetic-node-two.exe"
        first.write_bytes(b"synthetic-node-one")
        second.write_bytes(b"synthetic-node-two")
        if os.name != "nt":
            first.chmod(0o700)
            second.chmod(0o700)
        first_digest = hashlib.sha256(first.read_bytes()).hexdigest()
        second_digest = hashlib.sha256(second.read_bytes()).hexdigest()

        with mock.patch.dict(
            os.environ,
            {
                ledger_tool.NODE_EXECUTABLE_ENV: str(first),
                ledger_tool.NODE_EXECUTABLE_SHA256_ENV: first_digest,
            },
        ):
            self.assertEqual(first, ledger_tool._configured_node_executable())

        with mock.patch.dict(
            os.environ,
            {
                ledger_tool.NODE_EXECUTABLE_ENV: str(second),
                ledger_tool.NODE_EXECUTABLE_SHA256_ENV: second_digest,
            },
        ):
            with self.assertRaises(ledger_tool.InvalidClaimInput):
                ledger_tool._configured_node_executable()

        ledger_tool._BOUND_NODE_EXECUTABLE = None
        with mock.patch.dict(
            os.environ,
            {
                ledger_tool.NODE_EXECUTABLE_ENV: str(first),
                ledger_tool.NODE_EXECUTABLE_SHA256_ENV: "0" * 64,
            },
        ):
            with self.assertRaises(ledger_tool.InvalidClaimInput):
                ledger_tool._configured_node_executable()

    def test_analytics_machine_result_is_strict_and_never_relayed(self) -> None:
        machine_result = json.dumps(
            {
                "authorityId": AUTHORITY_ID,
                "consumptionDigest": DIGEST,
                "schema": ledger_tool._VALIDATOR_RESULT_SCHEMA,
                "validator": ledger_tool.ANALYTICS_MUTATION_VALIDATOR,
            },
            separators=(",", ":"),
        )
        completed = subprocess.CompletedProcess(
            args=[], returncode=0, stdout=machine_result, stderr=""
        )
        with mock.patch.object(
            ledger_tool,
            "_configured_node_executable",
            return_value=Path(sys.executable),
        ) as configured_node, mock.patch.object(
            ledger_tool.subprocess, "run", return_value=completed
        ) as runner, mock.patch.dict(
            os.environ,
            {
                "NODE_OPTIONS": "PRIVATE-NODE-PRELOAD",
                "NODE_PATH": "PRIVATE-NODE-PATH",
                "NODE_REPL_EXTERNAL_MODULE": "PRIVATE-NODE-MODULE",
                ledger_tool.NODE_EXECUTABLE_ENV: "PRIVATE-NODE-PATH",
                ledger_tool.NODE_EXECUTABLE_SHA256_ENV: "f" * 64,
            },
        ):
            pair = ledger_tool._validate_analytics_mutation(
                self.root / "packet.json", self.root / "approval.json"
            )

        self.assertEqual((AUTHORITY_ID, DIGEST), pair)
        self.assertEqual(2, configured_node.call_count)
        invoked = runner.call_args.kwargs
        self.assertNotIn("NODE_OPTIONS", invoked["env"])
        self.assertNotIn("NODE_PATH", invoked["env"])
        self.assertNotIn("NODE_REPL_EXTERNAL_MODULE", invoked["env"])
        self.assertNotIn(ledger_tool.LEDGER_DIRECTORY_ENV, invoked["env"])
        self.assertNotIn(ledger_tool.NODE_EXECUTABLE_ENV, invoked["env"])
        self.assertNotIn(ledger_tool.NODE_EXECUTABLE_SHA256_ENV, invoked["env"])

    def test_execution_boundary_source_must_be_committed_and_visible(self) -> None:
        normal = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="H tools/safety/claim_approval_consumption.py\n",
            stderr="",
        )
        clean = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="", stderr=""
        )
        with mock.patch.object(
            ledger_tool.subprocess, "run", side_effect=[clean, normal]
        ) as runner:
            ledger_tool._assert_execution_boundary_source_clean()
        for call in runner.call_args_list:
            command = call.args[0]
            self.assertIn(
                f"safe.directory={ledger_tool.REPOSITORY_ROOT}", command
            )
            environment = call.kwargs["env"]
            self.assertEqual("0", environment["GIT_OPTIONAL_LOCKS"])
            self.assertFalse(
                any(
                    name.startswith("GIT_") and name != "GIT_OPTIONAL_LOCKS"
                    for name in environment
                )
            )

        dirty = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout=" M tools/safety/claim_approval_consumption.py\n",
            stderr="",
        )
        with mock.patch.object(
            ledger_tool.subprocess, "run", side_effect=[dirty, normal]
        ):
            with self.assertRaises(ledger_tool.InvalidClaimInput):
                ledger_tool._assert_execution_boundary_source_clean()

    def test_git_subprocess_environment_rejects_repository_override_poisoning(
        self,
    ) -> None:
        self.assertEqual(
            {"GIT_OPTIONAL_LOCKS": "0", "PATH": "synthetic-path"},
            ledger_tool._git_subprocess_environment(
                {
                    "GIT_CONFIG_COUNT": "1",
                    "GIT_CONFIG_KEY_0": "core.hooksPath",
                    "GIT_CONFIG_VALUE_0": "PRIVATE-HOOKS",
                    "GIT_DIR": "PRIVATE-GIT-DIR",
                    "GIT_INDEX_FILE": "PRIVATE-GIT-INDEX",
                    "GIT_OBJECT_DIRECTORY": "PRIVATE-GIT-OBJECTS",
                    "GIT_OPTIONAL_LOCKS": "1",
                    "GIT_WORK_TREE": "PRIVATE-GIT-WORKTREE",
                    "PATH": "synthetic-path",
                }
            ),
        )

    def test_first_claim_creates_restrictive_exact_schema_and_one_row(self) -> None:
        claim_time = "2026-08-28T12:34:56.789Z"
        with mock.patch.object(
            ledger_tool, "_canonical_claim_time", return_value=claim_time
        ):
            ledger_tool.claim_approval_consumption(
                self.ledger, DIGEST, AUTHORITY_ID
            )

        self.assertEqual([(AUTHORITY_ID, DIGEST, claim_time)], self.rows())
        self.assertEqual([self.database], list(self.ledger.iterdir()))
        with contextlib.closing(sqlite3.connect(self.database)) as connection:
            self.assertEqual(
                (ledger_tool.APPLICATION_ID,),
                connection.execute("PRAGMA application_id").fetchone(),
            )
            self.assertEqual(
                (ledger_tool.USER_VERSION,),
                connection.execute("PRAGMA user_version").fetchone(),
            )
            indexes = connection.execute("PRAGMA index_list('claims')").fetchall()
            self.assertEqual({"pk", "u"}, {row[3] for row in indexes})
        if os.name == "posix":
            self.assertEqual(0o600, stat.S_IMODE(self.database.stat().st_mode))
        else:
            ledger_tool._validate_windows_acl(
                self.ledger, require_protected=True
            )
            ledger_tool._validate_windows_acl(
                self.database, require_protected=False
            )

    def test_exact_pair_replay_is_rejected_without_new_row(self) -> None:
        ledger_tool.claim_approval_consumption(self.ledger, DIGEST, AUTHORITY_ID)
        before = self.rows()

        with self.assertRaises(ledger_tool.ApprovalAlreadyConsumed):
            ledger_tool.claim_approval_consumption(
                self.ledger, DIGEST, AUTHORITY_ID
            )

        self.assertEqual(before, self.rows())

    def test_same_authority_with_different_digest_fails_closed(self) -> None:
        ledger_tool.claim_approval_consumption(self.ledger, DIGEST, AUTHORITY_ID)
        before = self.rows()

        with self.assertRaises(ledger_tool.UnsafeLedger):
            ledger_tool.claim_approval_consumption(
                self.ledger, OTHER_DIGEST, AUTHORITY_ID
            )

        self.assertEqual(before, self.rows())

    def test_same_digest_with_different_authority_fails_closed(self) -> None:
        ledger_tool.claim_approval_consumption(self.ledger, DIGEST, AUTHORITY_ID)
        before = self.rows()

        with self.assertRaises(ledger_tool.UnsafeLedger):
            ledger_tool.claim_approval_consumption(
                self.ledger, DIGEST, OTHER_AUTHORITY_ID
            )

        self.assertEqual(before, self.rows())

    def test_distinct_pair_and_64_hex_authority_are_accepted(self) -> None:
        ledger_tool.claim_approval_consumption(self.ledger, DIGEST, AUTHORITY_ID)
        ledger_tool.claim_approval_consumption(
            self.ledger, OTHER_DIGEST, THIRD_AUTHORITY_ID
        )
        self.assertEqual(2, len(self.rows()))

    def test_subprocess_concurrency_has_one_winner_and_replays_only(self) -> None:
        workers = 10
        commands = [
            [
                sys.executable,
                "-c",
                _INTERNAL_CLAIM_PROGRAM,
                str(self.ledger),
                DIGEST,
                AUTHORITY_ID,
            ]
            for _ in range(workers)
        ]
        processes = [
            subprocess.Popen(
                command,
                cwd=REPOSITORY_ROOT,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            for command in commands
        ]
        results = []
        for process in processes:
            stdout, stderr = process.communicate(timeout=60)
            results.append((process.returncode, stdout, stderr))

        self.assertEqual(1, sum(code == ledger_tool.EXIT_CLAIMED for code, _, _ in results))
        self.assertEqual(
            workers - 1,
            sum(code == ledger_tool.EXIT_ALREADY_CONSUMED for code, _, _ in results),
        )
        self.assertFalse(any(code == ledger_tool.EXIT_ERROR for code, _, _ in results))
        self.assertEqual(1, len(self.rows()))
        for code, stdout, stderr in results:
            expected = "claimed\n" if code == 0 else "already-consumed\n"
            self.assertEqual(expected, stdout)
            self.assertEqual("", stderr)

    def test_committed_claim_survives_immediate_process_crash(self) -> None:
        child = (
            "import os,sys; "
            "from tools.safety.claim_approval_consumption import "
            "_claim_approval_consumption; "
            "_claim_approval_consumption(sys.argv[1],sys.argv[2],sys.argv[3]); "
            "os._exit(91)"
        )
        result = subprocess.run(
            [sys.executable, "-c", child, str(self.ledger), DIGEST, AUTHORITY_ID],
            cwd=REPOSITORY_ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=45,
        )
        self.assertEqual(91, result.returncode)
        replay = self.run_cli()
        self.assertEqual(ledger_tool.EXIT_ALREADY_CONSUMED, replay.returncode)
        self.assertEqual("already-consumed\n", replay.stdout)
        self.assertEqual(1, len(self.rows()))

    def test_extra_schema_object_is_rejected_and_retained(self) -> None:
        ledger_tool.claim_approval_consumption(self.ledger, DIGEST, AUTHORITY_ID)
        with contextlib.closing(sqlite3.connect(self.database)) as connection:
            connection.execute("CREATE TABLE unexpected (value TEXT)")
        before = self.database.stat().st_size

        with self.assertRaises(ledger_tool.UnsafeLedger):
            ledger_tool.claim_approval_consumption(
                self.ledger, OTHER_DIGEST, OTHER_AUTHORITY_ID
            )

        self.assertTrue(self.database.is_file())
        self.assertGreaterEqual(self.database.stat().st_size, before)

    def test_malformed_existing_claim_row_cannot_be_treated_as_replay(self) -> None:
        ledger_tool.claim_approval_consumption(self.ledger, DIGEST, AUTHORITY_ID)
        with contextlib.closing(sqlite3.connect(self.database)) as connection:
            connection.execute(
                "UPDATE claims SET claimed_at = 'incomplete' WHERE authority_id = ?",
                (AUTHORITY_ID,),
            )
            connection.commit()

        with self.assertRaises(ledger_tool.UnsafeLedger):
            ledger_tool.claim_approval_consumption(
                self.ledger, DIGEST, AUTHORITY_ID
            )

    def test_partial_schema_database_is_rejected_and_retained(self) -> None:
        self.precreate_database()
        with contextlib.closing(sqlite3.connect(self.database)) as connection:
            connection.execute("CREATE TABLE claims (authority_id TEXT)")

        with self.assertRaises(ledger_tool.UnsafeLedger):
            ledger_tool.claim_approval_consumption(
                self.ledger, DIGEST, AUTHORITY_ID
            )

        self.assertTrue(self.database.is_file())

    def test_preexisting_empty_database_is_ambiguous_and_not_initialized(self) -> None:
        self.precreate_database()

        with self.assertRaises(ledger_tool.UnsafeLedger):
            ledger_tool.claim_approval_consumption(
                self.ledger, DIGEST, AUTHORITY_ID
            )

        self.assertEqual(0, self.database.stat().st_size)

    def test_erased_schema_cannot_reinitialize_and_reopen_authority(self) -> None:
        ledger_tool.claim_approval_consumption(self.ledger, DIGEST, AUTHORITY_ID)
        with contextlib.closing(sqlite3.connect(self.database)) as connection:
            connection.execute("DROP TABLE claims")
            connection.execute("DROP TABLE metadata")
            connection.execute("PRAGMA application_id = 0")
            connection.execute("PRAGMA user_version = 0")
            connection.commit()

        with self.assertRaises(ledger_tool.UnsafeLedger):
            ledger_tool.claim_approval_consumption(
                self.ledger, DIGEST, AUTHORITY_ID
            )

        with contextlib.closing(sqlite3.connect(self.database)) as connection:
            self.assertEqual(
                [],
                connection.execute(
                    "SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'"
                ).fetchall(),
            )

    def test_corrupt_database_is_rejected_and_retained(self) -> None:
        content = b"synthetic-not-a-sqlite-database"
        self.precreate_database(content)

        with self.assertRaises(ledger_tool.UnsafeLedger):
            ledger_tool.claim_approval_consumption(
                self.ledger, DIGEST, AUTHORITY_ID
            )

        self.assertTrue(self.database.is_file())
        self.assertTrue(self.database.read_bytes().startswith(content))

    def test_permissive_directory_is_rejected(self) -> None:
        if os.name == "nt":
            result = subprocess.run(
                ["icacls", str(self.ledger), "/inheritance:e"],
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=10,
            )
            if result.returncode != 0:
                self.skipTest("native permissive Windows ACL fixture unavailable")
        else:
            self.ledger.chmod(0o750)

        with self.assertRaises(ledger_tool.UnsafeLedger):
            ledger_tool.claim_approval_consumption(
                self.ledger, DIGEST, AUTHORITY_ID
            )
        self.assertEqual([], list(self.ledger.iterdir()))

    def test_permissive_database_file_is_rejected(self) -> None:
        ledger_tool.claim_approval_consumption(self.ledger, DIGEST, AUTHORITY_ID)
        if os.name == "nt":
            result = subprocess.run(
                ["icacls", str(self.database), "/grant", "*S-1-1-0:R"],
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=10,
            )
            if result.returncode != 0:
                self.skipTest("native permissive Windows file ACL fixture unavailable")
        else:
            self.database.chmod(0o640)

        with self.assertRaises(ledger_tool.UnsafeLedger):
            ledger_tool.claim_approval_consumption(
                self.ledger, DIGEST, AUTHORITY_ID
            )

    def test_ledger_inside_unrelated_git_ancestry_is_rejected(self) -> None:
        repository = self.root / "unrelated-repository"
        ledger = repository / "private-ledger"
        ledger.mkdir(parents=True)
        _secure_directory(ledger)
        result = subprocess.run(
            ["git", "init", "--quiet", str(repository)],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=15,
        )
        if result.returncode != 0:
            self.skipTest("Git fixture setup unavailable")

        with self.assertRaises(ledger_tool.UnsafeLedger):
            ledger_tool.claim_approval_consumption(ledger, DIGEST, AUTHORITY_ID)
        self.assertEqual([], list(ledger.iterdir()))

    def test_ledger_inside_unrelated_bare_git_ancestry_is_rejected(self) -> None:
        repository = self.root / "unrelated-bare-repository"
        result = subprocess.run(
            ["git", "init", "--bare", "--quiet", str(repository)],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=15,
        )
        if result.returncode != 0:
            self.skipTest("bare Git fixture setup unavailable")
        ledger = repository / "private-ledger"
        ledger.mkdir()
        _secure_directory(ledger)

        with self.assertRaises(ledger_tool.UnsafeLedger):
            ledger_tool.claim_approval_consumption(ledger, DIGEST, AUTHORITY_ID)
        self.assertEqual([], list(ledger.iterdir()))

    def test_ledger_inside_attached_worktree_is_rejected(self) -> None:
        inside = self.worktree / "private-ledger"
        inside.mkdir()
        _secure_directory(inside)
        with self.assertRaises(ledger_tool.UnsafeLedger):
            ledger_tool.claim_approval_consumption(inside, DIGEST, AUTHORITY_ID)
        self.assertEqual([], list(inside.iterdir()))

    def test_static_directory_link_or_reparse_alias_is_rejected(self) -> None:
        target = self.root / "external-target"
        alias = self.root / "external-alias"
        target.mkdir()
        _secure_directory(target)
        try:
            alias.symlink_to(target, target_is_directory=True)
        except (NotImplementedError, OSError):
            if os.name != "nt":
                self.skipTest("directory symlinks unavailable")
            result = subprocess.run(
                ["cmd", "/c", "mklink", "/J", str(alias), str(target)],
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=10,
            )
            if result.returncode != 0:
                self.skipTest("directory reparse fixtures unavailable")
        try:
            with self.assertRaises(ledger_tool.UnsafeLedger):
                ledger_tool.claim_approval_consumption(
                    alias, DIGEST, AUTHORITY_ID
                )
            self.assertEqual([], list(target.iterdir()))
        finally:
            try:
                os.rmdir(alias)
            except OSError:
                pass

    def test_directory_identity_drift_after_transaction_fails_closed(self) -> None:
        original = ledger_tool._verify_directory_identity
        calls = 0

        def verify(path: Path, anchor: object) -> None:
            nonlocal calls
            calls += 1
            original(path, anchor)
            if calls == 2:
                raise ledger_tool.UnsafeLedger()

        with mock.patch.object(
            ledger_tool, "_verify_directory_identity", side_effect=verify
        ):
            with self.assertRaises(ledger_tool.UnsafeLedger):
                ledger_tool.claim_approval_consumption(
                    self.ledger, DIGEST, AUTHORITY_ID
                )

        # The committed row remains a hard stop after an ambiguous post-commit
        # identity result; the helper never deletes or reopens it.
        with self.assertRaises(ledger_tool.ApprovalAlreadyConsumed):
            ledger_tool.claim_approval_consumption(
                self.ledger, DIGEST, AUTHORITY_ID
            )

    def test_directory_identity_mismatch_is_rejected_by_native_probe(self) -> None:
        anchor = ledger_tool._open_directory_anchor(self.ledger)
        altered_identity = tuple(
            value + 1 if index == len(anchor.identity) - 1 else value
            for index, value in enumerate(anchor.identity)
        )
        mismatched = ledger_tool._DirectoryAnchor(
            anchor.handle, altered_identity, anchor.windows
        )
        try:
            with self.assertRaises(ledger_tool.UnsafeLedger):
                ledger_tool._verify_directory_identity(self.ledger, mismatched)
        finally:
            ledger_tool._close_directory_anchor(anchor)

    def test_malformed_inputs_and_unsafe_shapes_fail_closed(self) -> None:
        invalid = [
            (DIGEST.upper(), AUTHORITY_ID),
            (DIGEST[:-1], AUTHORITY_ID),
            ("g" * 64, AUTHORITY_ID),
            (DIGEST, AUTHORITY_ID.upper()),
            (DIGEST, "123e4567-e89b-12d3-a456-426614174000"),
            (DIGEST, "123e4567-e89b-42d3-7456-426614174000"),
            (DIGEST, "f" * 63),
        ]
        for digest, authority_id in invalid:
            with self.subTest(digest=digest, authority_id=authority_id):
                with self.assertRaises(ledger_tool.InvalidClaimInput):
                    ledger_tool.claim_approval_consumption(
                        self.ledger, digest, authority_id
                    )
        with self.assertRaises(TypeError):
            ledger_tool.claim_approval_consumption(self.ledger, DIGEST)  # type: ignore[call-arg]
        with self.assertRaises(ledger_tool.UnsafeLedger):
            ledger_tool.claim_approval_consumption(
                Path("relative-ledger"), DIGEST, AUTHORITY_ID
            )
        escaped = self.root / "unused" / os.pardir / "ledger"
        with self.assertRaises(ledger_tool.UnsafeLedger):
            ledger_tool.claim_approval_consumption(
                escaped, DIGEST, AUTHORITY_ID
            )
        with self.assertRaises(ledger_tool.UnsafeLedger):
            ledger_tool.claim_approval_consumption(
                self.root / "missing", DIGEST, AUTHORITY_ID
            )
        regular_file = self.root / "not-a-directory"
        regular_file.write_text("synthetic", encoding="utf-8")
        with self.assertRaises(ledger_tool.UnsafeLedger):
            ledger_tool.claim_approval_consumption(
                regular_file, DIGEST, AUTHORITY_ID
            )
        if os.name == "nt":
            with self.assertRaises(ledger_tool.UnsafeLedger):
                ledger_tool.claim_approval_consumption(
                    Path(r"\\synthetic.invalid\share\ledger"),
                    DIGEST,
                    AUTHORITY_ID,
                )

    def test_unexpected_directory_content_is_rejected_and_retained(self) -> None:
        unexpected = self.ledger / "old.claim.json"
        unexpected.write_text("synthetic", encoding="utf-8")
        if os.name != "nt":
            unexpected.chmod(0o600)
        with self.assertRaises(ledger_tool.UnsafeLedger):
            ledger_tool.claim_approval_consumption(
                self.ledger, DIGEST, AUTHORITY_ID
            )
        self.assertTrue(unexpected.is_file())

    def test_cli_statuses_are_coarse_and_errors_are_sanitized(self) -> None:
        arguments = [
            ledger_tool.CRM_WORKFLOW_REPAIR_VALIDATOR,
            str(self.root / "private packet.json"),
            str(self.root / "private approval.json"),
        ]
        claimed_stdout = io.StringIO()
        claimed_stderr = io.StringIO()
        with mock.patch.object(
            ledger_tool, "validate_and_claim_approval", return_value=mock.sentinel.result
        ), contextlib.redirect_stdout(claimed_stdout), contextlib.redirect_stderr(
            claimed_stderr
        ):
            claimed_exit = ledger_tool.main(arguments)
        self.assertEqual(ledger_tool.EXIT_CLAIMED, claimed_exit)
        self.assertEqual("claimed\n", claimed_stdout.getvalue())
        self.assertEqual("", claimed_stderr.getvalue())

        replay_stdout = io.StringIO()
        replay_stderr = io.StringIO()
        with mock.patch.object(
            ledger_tool,
            "validate_and_claim_approval",
            side_effect=ledger_tool.ApprovalAlreadyConsumed(),
        ), contextlib.redirect_stdout(replay_stdout), contextlib.redirect_stderr(
            replay_stderr
        ):
            replay_exit = ledger_tool.main(arguments)
        self.assertEqual(ledger_tool.EXIT_ALREADY_CONSUMED, replay_exit)
        self.assertEqual("already-consumed\n", replay_stdout.getvalue())
        self.assertEqual("", replay_stderr.getvalue())

        private_ledger = str(self.root / "PRIVATE-TENANT-LEDGER")
        private_packet = str(self.root / "PRIVATE-PACKET")
        private_approval = str(self.root / "PRIVATE-APPROVAL")
        error_stdout = io.StringIO()
        error_stderr = io.StringIO()
        with mock.patch.dict(
            os.environ,
            {ledger_tool.LEDGER_DIRECTORY_ENV: private_ledger},
        ), contextlib.redirect_stdout(error_stdout), contextlib.redirect_stderr(
            error_stderr
        ):
            error_exit = ledger_tool.main(
                [
                    ledger_tool.CRM_WORKFLOW_REPAIR_VALIDATOR,
                    private_packet,
                    private_approval,
                ]
            )
        combined = error_stdout.getvalue() + error_stderr.getvalue()
        self.assertEqual(ledger_tool.EXIT_ERROR, error_exit)
        self.assertEqual("", error_stdout.getvalue())
        self.assertEqual("error\n", error_stderr.getvalue())
        for private_value in (
            private_ledger,
            private_packet,
            private_approval,
            DIGEST,
            AUTHORITY_ID,
        ):
            self.assertNotIn(private_value, combined)

        subprocess_error = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                ledger_tool.CRM_WORKFLOW_REPAIR_VALIDATOR,
                private_packet,
                private_approval,
            ],
            cwd=REPOSITORY_ROOT,
            env={**os.environ, ledger_tool.LEDGER_DIRECTORY_ENV: private_ledger},
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(ledger_tool.EXIT_ERROR, subprocess_error.returncode)
        self.assertEqual("", subprocess_error.stdout)
        self.assertEqual("error\n", subprocess_error.stderr)
        for private_value in (private_ledger, private_packet, private_approval):
            self.assertNotIn(
                private_value, subprocess_error.stdout + subprocess_error.stderr
            )

        with mock.patch.object(
            ledger_tool,
            "validate_and_claim_approval",
            side_effect=KeyboardInterrupt(),
        ):
            interrupted_stdout = io.StringIO()
            interrupted_stderr = io.StringIO()
            with contextlib.redirect_stdout(
                interrupted_stdout
            ), contextlib.redirect_stderr(interrupted_stderr):
                interrupted_exit = ledger_tool.main(arguments)
        self.assertEqual(ledger_tool.EXIT_ERROR, interrupted_exit)
        self.assertEqual("", interrupted_stdout.getvalue())
        self.assertEqual("error\n", interrupted_stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
