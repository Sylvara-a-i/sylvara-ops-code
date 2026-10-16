from __future__ import annotations

import importlib.util
import datetime as dt
import json
import os
from pathlib import Path
import py_compile
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / "claim_approval_consumption.py"
SPEC = importlib.util.spec_from_file_location("approval_bootstrap_test_tool", SCRIPT)
assert SPEC and SPEC.loader
tool = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = tool
SPEC.loader.exec_module(tool)


class ApprovalValidatorBootstrapTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.sources = {"tools/safety/claim_approval_consumption.py": "# synthetic wrapper\n"}
        for relatives in tool._VALIDATOR_SOURCES.values():
            for relative in relatives:
                self.sources[relative] = "{}\n" if relative.endswith(".json") else "# synthetic source\n"
        for relative, source in self.sources.items():
            selected = self.root / relative
            selected.parent.mkdir(parents=True, exist_ok=True)
            selected.write_bytes(source.encode())
        (self.root / ".gitignore").write_text("__pycache__/\n", encoding="utf-8")
        self.git("init", "--quiet")
        self.git("-c", "core.autocrlf=false", "add", ".")
        self.git("-c", "user.name=Synthetic Test", "-c", "user.email=test@example.invalid",
                 "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "synthetic fixture")
        self.addCleanup(mock.patch.stopall)
        mock.patch.object(tool, "REPOSITORY_ROOT", self.root).start()
        mock.patch.object(tool, "_CRM_VALIDATOR_CLI", self.root / tool._VALIDATOR_SOURCES[
            tool.CRM_WORKFLOW_TRIGGER_REPAIR_VALIDATOR][0]).start()

    def git(self, *arguments: str) -> str:
        result = subprocess.run(
            ["git", "-c", f"safe.directory={self.root}", "-C", str(self.root), *arguments],
            env=tool._git_subprocess_environment(), check=True, capture_output=True,
            encoding="utf-8", timeout=15,
        )
        return result.stdout

    def rejected_before_dispatch(self, validator: str) -> None:
        with mock.patch.object(tool, "_configured_ledger_directory") as ledger, \
                mock.patch.object(tool, "_validated_pair") as dispatch:
            with self.assertRaises(tool.ApprovalConsumptionError):
                tool.validate_and_claim_approval(validator, "private-packet.json", "private-approval.json")
            ledger.assert_not_called()
            dispatch.assert_not_called()

    def test_each_complete_committed_closure_is_accepted(self) -> None:
        for validator, relatives in tool._VALIDATOR_SOURCES.items():
            with self.subTest(validator=validator):
                snapshot = tool._assert_execution_boundary_source_clean(validator)
                self.assertEqual(
                    {str(self.root / relative) for relative in (
                        "tools/safety/claim_approval_consumption.py", *relatives)}, set(snapshot.files)
                )
                for filename, content in snapshot.files.items():
                    self.assertEqual(Path(filename).read_bytes(), content.encode("utf-8"))

    def test_modified_entrypoints_helpers_and_contracts_fail_before_dispatch(self) -> None:
        for validator, relatives in tool._VALIDATOR_SOURCES.items():
            for relative in relatives:
                with self.subTest(validator=validator, source=relative):
                    selected = self.root / relative
                    selected.write_bytes(b"# untrusted code must not execute\n")
                    self.rejected_before_dispatch(validator)
                    selected.write_bytes(self.sources[relative].encode())

    def test_staged_untracked_missing_and_hidden_helpers_fail_before_dispatch(self) -> None:
        validator = tool.CRM_WORKFLOW_TRIGGER_REPAIR_VALIDATOR
        relative = tool._VALIDATOR_SOURCES[validator][1]
        selected = self.root / relative
        selected.write_bytes(b"# staged untrusted helper\n")
        self.git("add", "--", relative)
        self.rejected_before_dispatch(validator)
        self.git("reset", "--quiet", "HEAD", "--", relative)
        selected.write_bytes(self.sources[relative].encode())
        for flag in ("assume-unchanged", "skip-worktree"):
            with self.subTest(flag=flag):
                self.git("update-index", f"--{flag}", "--", relative)
                selected.write_bytes(b"# hidden untrusted helper\n")
                self.rejected_before_dispatch(validator)
                self.git("update-index", f"--no-{flag}", "--", relative)
                selected.write_bytes(self.sources[relative].encode())
        selected.unlink()
        self.rejected_before_dispatch(validator)
        selected.write_bytes(self.sources[relative].encode())
        self.git("rm", "--cached", "--quiet", "--", relative)
        self.rejected_before_dispatch(validator)

    def test_byte_identical_hardlink_fails_even_with_clean_git_status(self) -> None:
        validator = tool.ANALYTICS_MUTATION_VALIDATOR
        selected = self.root / tool._VALIDATOR_SOURCES[validator][1]
        other = self.root / "ignored-source"
        other.write_bytes(selected.read_bytes())
        selected.unlink()
        os.link(other, selected)
        self.assertEqual("", self.git("status", "--porcelain", "--", str(selected)))
        self.rejected_before_dispatch(validator)

    def test_byte_identical_symlink_or_reparse_component_is_rejected(self) -> None:
        validator = tool.CRM_WORKFLOW_TRIGGER_REPAIR_VALIDATOR
        selected = self.root / tool._VALIDATOR_SOURCES[validator][1]
        # Native symlinks need extra privilege on Windows; the existing helper's
        # reparse classification is exercised deterministically on every host.
        original = tool._is_link_like
        with mock.patch.object(tool, "_is_link_like", side_effect=lambda path:
                               path == selected.parent or original(path)):
            self.rejected_before_dispatch(validator)

    def test_raw_bytes_must_match_even_if_git_stat_result_is_clean(self) -> None:
        validator = tool.CRM_WORKFLOW_TRIGGER_REPAIR_VALIDATOR
        selected = self.root / tool._VALIDATOR_SOURCES[validator][1]
        selected.write_bytes(b"# code hidden from Git's cached status\n")
        original = tool.subprocess.run
        def cached_status(arguments, **kwargs):
            if "status" in arguments:
                return subprocess.CompletedProcess(arguments, 0, "", "")
            return original(arguments, **kwargs)
        with mock.patch.object(tool.subprocess, "run", side_effect=cached_status):
            self.rejected_before_dispatch(validator)

    def test_revision_change_during_validation_never_claims_approval(self) -> None:
        validator = tool.CRM_WORKFLOW_TRIGGER_REPAIR_VALIDATOR
        before = tool._assert_execution_boundary_source_clean(validator)
        after = tool._AuthenticatedSources("f" * 40, before.files)
        with mock.patch.object(tool, "_assert_execution_boundary_source_clean", side_effect=[before, after]), \
                mock.patch.object(tool, "_configured_ledger_directory"), \
                mock.patch.object(tool, "_validated_pair", return_value=("synthetic-authority", "synthetic-digest")), \
                mock.patch.object(tool, "_claim_approval_consumption") as claim:
            with self.assertRaises(tool.InvalidClaimInput):
                tool.validate_and_claim_approval(validator, "packet", "approval")
            claim.assert_not_called()

    def test_committed_link_mode_is_rejected_before_dispatch(self) -> None:
        validator = tool.CRM_WORKFLOW_TRIGGER_REPAIR_VALIDATOR
        relative = tool._VALIDATOR_SOURCES[validator][1]
        object_id = self.git("rev-parse", f"HEAD:{relative}").strip()
        self.git("update-index", "--cacheinfo", f"120000,{object_id},{relative}")
        self.git("-c", "user.name=Synthetic Test", "-c", "user.email=test@example.invalid",
                 "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "synthetic link mode")
        # Simulate Git's mode-insensitive clean status so the committed tree-mode
        # check, rather than the working-tree status, must reject this fixture.
        original = tool.subprocess.run
        def cached_status(arguments, **kwargs):
            if "status" in arguments:
                return subprocess.CompletedProcess(arguments, 0, "", "")
            return original(arguments, **kwargs)
        with mock.patch.object(tool.subprocess, "run", side_effect=cached_status):
            self.rejected_before_dispatch(validator)

    def test_git_failure_fails_closed_without_dispatch(self) -> None:
        with mock.patch.object(tool.subprocess, "run", side_effect=OSError()):
            self.rejected_before_dispatch(tool.CRM_WORKFLOW_TRIGGER_REPAIR_VALIDATOR)

    def test_source_authentication_does_not_execute_git_fsmonitor_hook(self) -> None:
        hook = self.root / "fsmonitor-hook"
        hook.write_bytes(b"#!/bin/sh\nprintf executed > fsmonitor-executed\n")
        hook.chmod(0o700)
        self.git("config", "core.fsmonitor", "./fsmonitor-hook")
        marker = self.root / "fsmonitor-executed"
        self.git("status", "--porcelain")
        self.assertTrue(marker.exists(), "synthetic hook fixture did not execute")
        marker.unlink()
        tool._assert_execution_boundary_source_clean(tool.CRM_WORKFLOW_TRIGGER_REPAIR_VALIDATOR)
        self.assertFalse(marker.exists())

    def test_python_nested_import_uses_snapshot_despite_forged_bytecode_and_edits(self) -> None:
        validator = tool.CRM_WORKFLOW_TRIGGER_REPAIR_VALIDATOR
        cli, helper = [self.root / relative for relative in tool._VALIDATOR_SOURCES[validator]]
        cli_source = (
            "import importlib.util\nfrom pathlib import Path\nfrom types import SimpleNamespace\n"
            "helper = Path(__file__).parents[1] / 'validators' / 'workflow_repair_packet.py'\n"
            "spec = importlib.util.spec_from_file_location('synthetic_helper', helper)\n"
            "child = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(child)\n"
            f"CLAIM_NAMESPACE = {validator!r}\n"
            "def validate_workflow_repair_packet(packet, approval, current_source_revision):\n"
            "    assert current_source_revision == 'synthetic'\n"
            "    return SimpleNamespace(authority_id=child.value(), consumption_digest='synthetic-digest')\n"
            "def validate_private_workflow_repair_paths(packet, approval):\n"
            "    return validate_workflow_repair_packet(packet, approval)\n"
        )
        snapshot = {str(cli): cli_source, str(helper):
                    "from datetime import datetime\ndef value():\n"
                    "    return str(datetime.strptime('2026-10-16', '%Y-%m-%d').year)\n"}
        for selected in (cli, helper):
            trusted = snapshot[str(selected)].encode()
            malicious = b"raise RuntimeError('untrusted cached bytecode executed')\n"
            selected.write_bytes(malicious + b"#" * (len(trusted) - len(malicious)))
            metadata = selected.stat()
            py_compile.compile(str(selected), doraise=True)
            # Preserve the timestamp and byte length in the poisoned cache header
            # while restoring clean source, reproducing a valid stale-cache hit.
            selected.write_bytes(trusted)
            os.utime(selected, ns=(metadata.st_atime_ns, metadata.st_mtime_ns))
        marker = self.root / "shadow-executed"
        for name in ("calendar.py", "sitecustomize.py"):
            (self.root / name).write_text(f"open({str(marker)!r}, 'w').write('executed')\n", encoding="utf-8")
        with mock.patch.dict(os.environ, {"PYTHONPATH": str(self.root)}):
            pair = tool._validate_crm_workflow_repair(
                "packet", "approval", tool._AuthenticatedSources("synthetic", snapshot)
            )
        self.assertEqual(("2026", "synthetic-digest"), pair)
        self.assertFalse(marker.exists())
        helper.write_text("raise RuntimeError('checkout changed after authentication')\n", encoding="utf-8")
        self.assertEqual(pair, tool._validate_crm_workflow_repair(
            "packet", "approval", tool._AuthenticatedSources("synthetic", snapshot)
        ))

    def test_real_crm_synthetic_packet_validates_in_isolated_child(self) -> None:
        repository = SCRIPT.parents[2]
        relatives = tool._VALIDATOR_SOURCES[tool.CRM_WORKFLOW_TRIGGER_REPAIR_VALIDATOR]
        for relative in relatives:
            (self.root / relative).write_bytes((repository / relative).read_bytes())
        self.git("add", ".")
        self.git("-c", "user.name=Synthetic Test", "-c", "user.email=test@example.invalid",
                 "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "validator fixture")
        authenticated = tool._assert_execution_boundary_source_clean(tool.CRM_WORKFLOW_TRIGGER_REPAIR_VALIDATOR)
        fixture_path = repository / "src/zoho-crm/free-revenue-leak-test/tests/test_workflow_repair_packet.py"
        spec = importlib.util.spec_from_file_location("synthetic_crm_fixture", fixture_path)
        assert spec and spec.loader
        fixture = importlib.util.module_from_spec(spec)
        with mock.patch.object(sys, "path", list(sys.path)):
            spec.loader.exec_module(fixture)
        with mock.patch.object(fixture, "repository_source_revision", return_value=authenticated.revision):
            packet = fixture._packet()
        now = dt.datetime.now(dt.timezone.utc)
        offset = now - dt.datetime.fromtimestamp(fixture.NOW_MS / 1000, dt.timezone.utc)
        def shift(value):
            if isinstance(value, dict):
                return {key: shift(item) for key, item in value.items()}
            if isinstance(value, list):
                return [shift(item) for item in value]
            if isinstance(value, str) and value.startswith("2026-08-28T"):
                return (dt.datetime.fromisoformat(value.replace("Z", "+00:00")) + offset).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            return value
        packet = shift(packet)
        approval = fixture._approval(packet)
        approval = shift(approval)
        with tempfile.TemporaryDirectory() as private:
            packet_path, approval_path = Path(private) / "packet.json", Path(private) / "approval.json"
            packet_path.write_text(json.dumps(packet), encoding="utf-8")
            approval_path.write_text(json.dumps(approval), encoding="utf-8")
            pair = tool._validate_crm_workflow_repair(packet_path, approval_path, authenticated)
        self.assertEqual(packet["operationAuthorizationId"], pair[0])
        self.assertRegex(pair[1], r"^[0-9a-f]{64}$")

    def test_node_uses_verified_helper_and_contract_despite_shadow_and_later_edits(self) -> None:
        node = shutil.which("node")
        if node is None:
            self.skipTest("Node is unavailable")
        cli = self.root / "validator.js"
        helper = self.root / "helper.js"
        contract = self.root / "contract.json"
        sources = {
            str(cli): "const helper = require('./helper'); exports.run = () => helper;",
            str(helper): "module.exports = JSON.parse(require('node:fs').readFileSync("
                         "require('node:path').join(__dirname, 'contract.json'), 'utf8'));",
            str(contract): json.dumps({"operationAuthorizationId": "synthetic-authority", "consumptionDigest": "synthetic-digest"}),
        }
        for selected in (cli, helper, helper.with_suffix("")):
            selected.write_text("throw new Error('unchecked checkout code executed');", encoding="utf-8")
        contract.write_text("{}", encoding="utf-8")
        result = subprocess.run(
            [node, "-e", tool._NODE_BRIDGE, str(cli), "packet", "approval", tool.ANALYTICS_MUTATION_VALIDATOR],
            input=json.dumps({"revision": "synthetic", "files": sources}),
            encoding="utf-8", capture_output=True, timeout=15,
        )
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual("synthetic-authority", json.loads(result.stdout)["authorityId"])

    def test_node_rejects_packet_bound_to_another_source_revision(self) -> None:
        node = shutil.which("node")
        if node is None:
            self.skipTest("Node is unavailable")
        cli = self.root / "validator.js"
        packet = self.root / "packet.json"
        marker = self.root / "validation-continued"
        packet.write_text(json.dumps({"approvedSourceRevision": "b" * 40}), encoding="utf-8")
        sources = {str(cli): "const fs = require('node:fs'); exports.run = ([packet]) => {"
                   "if (process.platform === 'win32') packet = packet.toUpperCase();"
                   "fs.readFileSync(packet, 'utf8');"
                   f"fs.writeFileSync({json.dumps(str(marker))}, 'executed'); }};"}
        result = subprocess.run(
            [node, "-e", tool._NODE_BRIDGE, str(cli), str(packet), "approval", tool.ANALYTICS_MUTATION_VALIDATOR],
            input=json.dumps({"revision": "a" * 40, "files": sources}),
            encoding="utf-8", capture_output=True, timeout=15,
        )
        self.assertNotEqual(0, result.returncode)
        self.assertIn("private approval source revision mismatch", result.stderr)
        self.assertFalse(marker.exists())


if __name__ == "__main__":
    unittest.main()
