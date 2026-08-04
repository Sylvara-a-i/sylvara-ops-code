from __future__ import annotations

import importlib.util
import subprocess
import tempfile
import unittest
import unittest.mock as mock
from pathlib import Path
from types import SimpleNamespace


SCRIPT = Path(__file__).resolve().parents[1] / "pre-commit-safety-check.py"
SPEC = importlib.util.spec_from_file_location("safety_check", SCRIPT)
assert SPEC and SPEC.loader
safety_check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(safety_check)


class InMemoryFile:
    """Small Path-like fixture that avoids filesystem assumptions in CI."""

    def __init__(self, content: bytes) -> None:
        self._content = content

    def stat(self) -> SimpleNamespace:
        return SimpleNamespace(st_size=len(self._content))

    def read_bytes(self) -> bytes:
        return self._content

    def is_symlink(self) -> bool:
        return False

    def is_file(self) -> bool:
        return True


class SafetyCheckTests(unittest.TestCase):
    @staticmethod
    def _git(root: Path, *args: str) -> None:
        subprocess.run(
            ["git", *args],
            cwd=root,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def test_env_example_is_allowed_but_its_contents_are_scanned(self) -> None:
        self.assertEqual([], safety_check.scan_filename(".env.example"))
        secret = "super" + "-secret-production-value"
        assignment = "ZOHO_CLIENT_" + f"SECRET={secret}\n"
        problems = safety_check.scan_text(
            ".env.example", assignment
        )
        self.assertTrue(any("secret assignment" in problem for problem in problems))

    def test_env_example_placeholders_are_allowed(self) -> None:
        text = (
            "OPENAI_API_" + "KEY=replace_me\n"
            "ZOHO_REFRESH_" + "TOKEN=${ZOHO_REFRESH_TOKEN}\n"
            "RETELL_API_" + "KEY=<set-in-platform-secret-store>\n"
        )
        problems = safety_check.scan_text(".env.example", text)
        self.assertEqual([], problems)

    def test_non_example_environment_and_credential_files_are_blocked(self) -> None:
        self.assertTrue(safety_check.scan_filename(".env"))
        self.assertTrue(safety_check.scan_filename("config/.env.production"))
        self.assertTrue(safety_check.scan_filename("config/credentials.json"))
        self.assertEqual(
            [], safety_check.scan_filename("config/credentials.example.json")
        )

    def test_private_key_material_and_key_filenames_are_blocked(self) -> None:
        marker = "-----BEGIN " + "PRIVATE KEY-----"
        self.assertTrue(safety_check.scan_text("safe.txt", marker))
        self.assertTrue(safety_check.scan_filename("keys/service.pem"))

    def test_common_provider_token_forms_are_blocked(self) -> None:
        cases = {
            "github": "ghp_" + "A" * 36,
            "openai": "sk-proj-" + "A" * 32,
            "aws": "AKIA" + "A" * 16,
            "slack": "xoxb-" + "A" * 24,
            "stripe": "sk_live_" + "A" * 24,
            "stripe_webhook": "whsec_" + "A" * 24,
            "zoho": "1000." + "A" * 24 + "." + "B" * 24,
            "retell": "key_" + "A" * 28,
            "make": "https://hooks.make.com/" + "A" * 24,
        }
        for provider, value in cases.items():
            with self.subTest(provider=provider):
                self.assertTrue(safety_check.scan_text("config.txt", value))

    def test_named_provider_assignments_are_blocked_without_distinctive_prefixes(self) -> None:
        value = "production" + "-credential-value"
        for name in (
            "AWS_SECRET_ACCESS_KEY",
            "MAKE_API_TOKEN",
            "RETELL_API_KEY",
            "ZOHO_REFRESH_TOKEN",
        ):
            with self.subTest(name=name):
                problems = safety_check.scan_text("config.txt", f"{name}={value}")
                self.assertTrue(any("secret assignment" in item for item in problems))

    def test_credential_bearing_urls_are_blocked(self) -> None:
        url = "https://" + "operator:password" + "@" + "service.example/path"
        problems = safety_check.scan_text("config.txt", url)
        self.assertTrue(any("credential-bearing URL" in item for item in problems))

    def test_real_looking_pii_is_blocked(self) -> None:
        email = "person" + "@private-domain.com"
        phone = "312" + "-867-5309"
        ssn = "123" + "-45-6789"
        bank = "routing_number=" + "021000021"
        text = "\n".join((email, phone, ssn, bank))
        problems = safety_check.scan_text("notes.txt", text)
        self.assertTrue(any("email" in item for item in problems))
        self.assertTrue(any("phone" in item for item in problems))
        self.assertTrue(any("SSN" in item for item in problems))
        self.assertTrue(any("bank" in item for item in problems))

    def test_reserved_samples_do_not_trigger_pii_rules(self) -> None:
        text = (
            "operator@example.com\n"
            "202-555-0142\n"
            "000-00-0000\n"
            "bank_account_number=000000000\n"
        )
        self.assertEqual([], safety_check.scan_text("example.txt", text))

    def test_standalone_long_numeric_identifiers_are_blocked(self) -> None:
        identifier = "873302" + "1827649201559"
        problems = safety_check.scan_text("reference.csv", f"record_id,{identifier}\n")
        self.assertTrue(any("long numeric identifier" in item for item in problems))

    def test_synthetic_or_embedded_long_numbers_are_allowed(self) -> None:
        repeated = "0" * 19
        embedded = "hash" + "873302" + "1827649201559" + "value"
        text = f"placeholder={repeated}\nchecksum={embedded}\n"
        self.assertEqual([], safety_check.scan_text("example.txt", text))

    def test_chart_of_accounts_requires_exact_public_schema(self) -> None:
        valid = (
            "Account Name,Account Code,Description,Account Type,Account Status,"
            "Currency,Parent Account\n"
            "Services,4590,Consulting revenue,Income,Active,USD,\n"
        )
        self.assertEqual([], safety_check.scan_chart_of_accounts_csv(valid))

        source_schema = (
            "Account ID,Account Name,Account Code,Description,Account Type,"
            "Account Status,Currency,Parent Account\n"
            "1234,Services,4590,Consulting revenue,Income,Active,USD,\n"
        )
        problems = safety_check.scan_chart_of_accounts_csv(source_schema)
        self.assertTrue(any("source-only" in item for item in problems))
        self.assertTrue(any("exactly these seven columns" in item for item in problems))

    def test_chart_of_accounts_rejects_bad_width_and_short_bank_suffix(self) -> None:
        text = (
            "Account Name,Account Code,Description,Account Type,Account Status,"
            "Currency,Parent Account\n"
            "Operating Checking ending in 1234,1000,,Bank,Active,USD\n"
            "Services,4590,Consulting revenue,Income,Active,USD,\n"
        )
        problems = safety_check.scan_chart_of_accounts_csv(text)
        self.assertTrue(any("expected 7" in item for item in problems))

        suffix_text = text.replace("USD\nServices", "USD,\nServices")
        suffix_problems = safety_check.scan_decoded_text(
            safety_check.CHART_OF_ACCOUNTS_PATH, suffix_text
        )
        self.assertTrue(any("bank suffix" in item for item in suffix_problems))

    def test_binary_documents_archives_and_images_are_blocked(self) -> None:
        path = InMemoryFile(b"synthetic")
        for suffix in (".xlsx", ".xls", ".docx", ".pdf", ".zip", ".png"):
            with self.subTest(suffix=suffix):
                problems, text = safety_check.scan_file_policy(
                    f"artifact{suffix}", path
                )
                self.assertTrue(problems)
                self.assertIsNone(text)

    def test_unknown_binary_and_non_utf8_content_are_blocked(self) -> None:
        self.assertTrue(
            safety_check.scan_file_policy(
                "payload.dat", InMemoryFile(b"safe-prefix\x00hidden")
            )[0]
        )
        self.assertTrue(
            any(
                "UTF-8" in item
                for item in safety_check.scan_file_policy(
                    "payload.unknown", InMemoryFile(b"\xff\xfe")
                )[0]
            )
        )

    def test_oversized_text_is_blocked(self) -> None:
        with mock.patch.object(safety_check, "MAX_TEXT_BYTES", 8):
            problems, text = safety_check.scan_file_policy(
                "large.txt", InMemoryFile(b"a" * 9)
            )
        self.assertTrue(any("exceeds" in item for item in problems))
        self.assertIsNone(text)

    def test_tracked_file_enumeration_fails_closed(self) -> None:
        result = SimpleNamespace(returncode=1, stdout=b"")
        with mock.patch.object(safety_check.subprocess, "run", return_value=result):
            entries, problems = safety_check.load_tracked_entries(Path("."))
        self.assertEqual({}, entries)
        self.assertTrue(any("fails closed" in problem for problem in problems))

    def test_candidate_file_enumeration_fails_closed(self) -> None:
        result = SimpleNamespace(returncode=1, stdout=b"")
        with mock.patch.object(safety_check.subprocess, "run", return_value=result):
            paths, problems = safety_check.load_candidate_paths(Path("."))
        self.assertEqual(set(), paths)
        self.assertTrue(any("fails closed" in problem for problem in problems))

    def test_non_utf8_tracked_path_fails_closed(self) -> None:
        output = b"100644 " + (b"a" * 40) + b" 0\tbad-\xff.txt\0"
        result = SimpleNamespace(returncode=0, stdout=output)
        with mock.patch.object(safety_check.subprocess, "run", return_value=result):
            entries, problems = safety_check.load_tracked_entries(Path("."))
        self.assertEqual({}, entries)
        self.assertTrue(any("non-UTF-8" in problem for problem in problems))

    def test_git_symlinks_and_vendor_cache_paths_are_blocked(self) -> None:
        root = mock.MagicMock()
        root.joinpath.return_value = InMemoryFile(b"safe\n")
        entries = {
            "linked.txt": safety_check.TrackedEntry("120000", "a" * 40),
            "node_modules/package/index.js": safety_check.TrackedEntry(
                "100644", "b" * 40
            ),
        }
        with mock.patch.object(
            safety_check, "load_tracked_entries", return_value=(entries, [])
        ), mock.patch.object(
            safety_check,
            "load_candidate_paths",
            return_value=(set(entries), []),
        ), mock.patch.object(
            safety_check,
            "load_index_blob",
            return_value=(b"safe\n", []),
        ):
            problems = safety_check.scan_repository(root)
        self.assertTrue(any("Symbolic links" in item for item in problems))
        self.assertTrue(any("vendor/cache" in item for item in problems))

    def test_repository_scan_reads_secret_from_staged_blob(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            self._git(root, "init", "--quiet")
            candidate = root / ".env.example"
            secret = "production" + "-secret-value"
            assignment = "OPENAI_API_" + f"KEY={secret}\n"
            candidate.write_text(assignment, encoding="utf-8")
            self._git(root, "add", ".env.example")
            safe_assignment = "OPENAI_API_" + "KEY=replace_me\n"
            candidate.write_text(safe_assignment, encoding="utf-8")

            problems = safety_check.scan_repository(root)

        self.assertTrue(
            any(
                "secret assignment" in item and "staged index" in item
                for item in problems
            )
        )

    def test_repository_scan_also_reads_differing_worktree(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            self._git(root, "init", "--quiet")
            candidate = root / ".env.example"
            safe_assignment = "OPENAI_API_" + "KEY=replace_me\n"
            candidate.write_text(safe_assignment, encoding="utf-8")
            self._git(root, "add", ".env.example")
            secret = "production" + "-secret-value"
            assignment = "OPENAI_API_" + f"KEY={secret}\n"
            candidate.write_text(assignment, encoding="utf-8")

            problems = safety_check.scan_repository(root)

        self.assertTrue(
            any(
                "secret assignment" in item and "working tree" in item
                for item in problems
            )
        )

    def test_index_blob_read_failure_fails_closed(self) -> None:
        entry = safety_check.TrackedEntry("100644", "a" * 40)
        result = SimpleNamespace(returncode=1, stdout=b"")
        with mock.patch.object(safety_check.subprocess, "run", return_value=result):
            content, problems = safety_check.load_index_blob(
                Path("."), "safe.txt", entry
            )
        self.assertIsNone(content)
        self.assertTrue(any("fails closed" in item for item in problems))


if __name__ == "__main__":
    unittest.main()
