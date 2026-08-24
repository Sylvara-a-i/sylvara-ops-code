from __future__ import annotations

import importlib.util
import json
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

    def test_every_registry_secret_name_is_scanned_in_env_json_and_yaml(self) -> None:
        value = "live-material-AlphaBeta987654321"
        self.assertIn("CATALYST_TOKEN", safety_check.SECRET_ASSIGNMENT_NAMES)
        for name in sorted(safety_check.SECRET_ASSIGNMENT_NAMES):
            assignments = {
                "env": f"{name}={value}\n",
                "json": json.dumps({name: value}) + "\n",
                "yaml": f"{name}: '{value}'\n",
            }
            for form, assignment in assignments.items():
                with self.subTest(name=name, form=form):
                    problems = safety_check.scan_text(
                        f"secret-assignment.{form}", assignment
                    )
                    self.assertTrue(
                        any("secret assignment" in problem for problem in problems)
                    )

    def test_registry_secret_assignments_are_scanned_across_line_breaks(self) -> None:
        name = "OPAQUE_RUNTIME_MATERIAL"
        value = "live-material-AlphaBeta987654321"
        names = frozenset({name})
        assignments = {
            "json": f'{{\n  "{name}":\n    "{value}"\n}}\n',
            "javascript": f'const {name} =\n  "{value}";\n',
            "javascript-template": f"const {name} =\n  `{value}`;\n",
            "python-triple-double": f'{name} =\n  """{value}"""\n',
            "python-triple-single": f"{name} =\n  '''{value}'''\n",
            "yaml": f"{name}:\n  '{value}'\n",
        }
        for form, assignment in assignments.items():
            with self.subTest(form=form):
                problems = safety_check.scan_text(
                    f"secret-assignment.{form}", assignment, names
                )
                self.assertTrue(
                    any("secret assignment" in problem for problem in problems)
                )

        self.assertEqual(
            [],
            safety_check.scan_text(
                "config.example.js",
                f"const {name} =\n  process.env.{name};\n",
                names,
            ),
        )

    def test_registry_secret_placeholders_and_references_remain_allowed(self) -> None:
        for name in sorted(safety_check.SECRET_ASSIGNMENT_NAMES):
            assignments = (
                f"{name}=replace_me\n",
                json.dumps({name: "<set-in-platform-secret-store>"}) + "\n",
                f"{name}: ${{{name}}}\n",
                f"const {name} = process.env.{name};\n",
            )
            for assignment in assignments:
                with self.subTest(name=name, assignment=assignment):
                    self.assertEqual(
                        [], safety_check.scan_text("config.example.js", assignment)
                    )

        shell_reference = "${" + "CATALYST_" + "TOKEN}"
        self.assertEqual(
            [],
            safety_check.scan_text(
                "test/startup-probe.js", f'printf "%s" "{shell_reference}"\n'
            ),
        )

    def test_secret_reference_fallbacks_and_tagged_templates_are_rejected(self) -> None:
        names = frozenset({"OPAQUE_RUNTIME_MATERIAL"})
        name = next(iter(names))
        cases = (
            f"{name}=${{{name}:-opaque-live-material}}\n",
            f'{name} = process.env.{name} || "opaque-live-material";\n',
            f"{name} = String.raw`opaque-live-material`;\n",
            f"{name} = process.env.{name}\n  ?? `opaque-live-material`;\n",
            f"{name} = process.env.{name}\n\n  || `opaque-live-material`;\n",
            f"{name} = process.env.{name} // fallback\n  || `opaque-live-material`;\n",
            f"{name} = process.env.{name}\n  // fallback\n  || `opaque-live-material`;\n",
            f"{name} = String\n  (`opaque-live-material`);\n",
        )
        for assignment in cases:
            with self.subTest(assignment=assignment):
                problems = safety_check.scan_text(
                    "config.example.js", assignment, names
                )
                self.assertTrue(
                    any("secret assignment" in item for item in problems)
                )

    def test_typed_computed_commented_and_prefixed_assignments_are_rejected(self) -> None:
        names = frozenset({"RETELL_API_KEY"})
        name = next(iter(names))
        cases = {
            "typescript": f'const {name}: string = "opaque-live-material";\n',
            "python-annotation": f'{name}: str = "opaque-live-material"\n',
            "python-prefixed": f'{name} = f"opaque-live-material"\n',
            "computed": f'config["{name}"] = "opaque-live-material";\n',
            "computed-backtick": f'config[`{name}`] = "opaque-live-material";\n',
            "computed-property": f'{{ ["{name}"]: "opaque-live-material" }};\n',
            "commented": f'{name} /* reviewed? */ = "opaque-live-material";\n',
            "line-commented": f'{name} // reviewed?\n = "opaque-live-material";\n',
            "multi-line-commented": (
                f'{name} // first\n // second\n = "opaque-live-material";\n'
            ),
            "mixed-commented": (
                f'{name} /* first */ // second\n = "opaque-live-material";\n'
            ),
        }
        for shape, assignment in cases.items():
            with self.subTest(shape=shape):
                problems = safety_check.scan_text(
                    f"config.example.{shape}", assignment, names
                )
                self.assertTrue(
                    any("secret assignment" in item for item in problems)
                )

    def test_registry_loader_drives_non_suffix_secret_names_and_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            for index, relative_path in enumerate(
                safety_check.SECRET_REGISTRY_PATHS, start=1
            ):
                path = root.joinpath(*relative_path.parts)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(
                    json.dumps(
                        {
                            "variables": [
                                {
                                    "name": f"FUTURE_OPAQUE_MATERIAL_{index}",
                                    "classification": "secret",
                                },
                                {
                                    "name": f"FUTURE_STABLE_MATERIAL_{index}",
                                    "classification": "stable-secret",
                                },
                                {
                                    "name": f"PUBLIC_VALUE_{index}",
                                    "classification": "safe-enum",
                                },
                            ]
                        }
                    ),
                    encoding="utf-8",
                )

            names = safety_check.load_registry_secret_names(root)
            self.assertIn("CATALYST_TOKEN", names)
            self.assertIn("FUTURE_OPAQUE_MATERIAL_1", names)
            self.assertIn("FUTURE_STABLE_MATERIAL_2", names)
            self.assertNotIn("PUBLIC_VALUE_1", names)
            problems = safety_check.scan_text(
                "future.env.example",
                "FUTURE_OPAQUE_MATERIAL_1=live-material-987654321\n",
                names,
            )
            self.assertTrue(any("secret assignment" in item for item in problems))

            first_registry = root.joinpath(*safety_check.SECRET_REGISTRY_PATHS[0].parts)
            first_registry.write_text("{}", encoding="utf-8")
            with self.assertRaises(safety_check.SecretRegistryError):
                safety_check.load_registry_secret_names(root)

    def test_registry_loader_normalizes_the_reviewed_legacy_class_schema(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            for index, relative_path in enumerate(
                safety_check.SECRET_REGISTRY_PATHS, start=1
            ):
                path = root.joinpath(*relative_path.parts)
                path.parent.mkdir(parents=True, exist_ok=True)
                variables = [
                    {
                        "name": f"MODERN_SECRET_{index}",
                        "classification": "secret",
                    }
                ]
                if index == 2:
                    variables = [
                        {"name": "LEGACY_HEADER_VALUE", "class": "secret"},
                        {"name": "LEGACY_IDEMPOTENCY_MATERIAL", "class": "immutable-identity-secret"},
                        {"name": "LEGACY_ENVIRONMENT", "class": "environment-binding"},
                    ]
                path.write_text(
                    json.dumps({"variables": variables}),
                    encoding="utf-8",
                )

            names = safety_check.load_registry_secret_names(root)
            self.assertIn("LEGACY_HEADER_VALUE", names)
            self.assertIn("LEGACY_IDEMPOTENCY_MATERIAL", names)
            self.assertNotIn("LEGACY_ENVIRONMENT", names)

    def test_registry_loader_normalizes_the_reviewed_boolean_secret_schema(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            for index, relative_path in enumerate(
                safety_check.SECRET_REGISTRY_PATHS, start=1
            ):
                path = root.joinpath(*relative_path.parts)
                path.parent.mkdir(parents=True, exist_ok=True)
                variables = [
                    {
                        "name": f"MODERN_SECRET_{index}",
                        "classification": "secret",
                    }
                ]
                if index == len(safety_check.SECRET_REGISTRY_PATHS):
                    variables = [
                        {"name": "BOOLEAN_SECRET_MATERIAL", "secret": True},
                        {"name": "BOOLEAN_PUBLIC_SETTING", "secret": False},
                    ]
                path.write_text(
                    json.dumps({"variables": variables}),
                    encoding="utf-8",
                )

            names = safety_check.load_registry_secret_names(root)
            self.assertIn("BOOLEAN_SECRET_MATERIAL", names)
            self.assertNotIn("BOOLEAN_PUBLIC_SETTING", names)

    def test_registry_loader_rejects_unknown_classifications(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            for index, relative_path in enumerate(
                safety_check.SECRET_REGISTRY_PATHS, start=1
            ):
                path = root.joinpath(*relative_path.parts)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(
                    json.dumps(
                        {
                            "variables": [
                                {
                                    "name": f"OPAQUE_MATERIAL_{index}",
                                    "classification": (
                                        "unreviewed-secret-kind"
                                        if index == 1
                                        else "secret"
                                    ),
                                }
                            ]
                        }
                    ),
                    encoding="utf-8",
                )

            with self.assertRaises(safety_check.SecretRegistryError):
                safety_check.load_registry_secret_names(root)

    def test_generic_uppercase_secret_suffixes_are_scanned(self) -> None:
        value = "live-material-AlphaBeta987654321"
        names = (
            "FUTURE_SERVICE_SECRET",
            "FUTURE_SERVICE_TOKEN",
            "FUTURE_SERVICE_PEPPER",
            "FUTURE_SERVICE_PASSWORD",
            "FUTURE_SERVICE_CREDENTIAL",
            "FUTURE_SERVICE_API_KEY",
            "FUTURE_SERVICE_PRIVATE_KEY",
            "FUTURE_SERVICE_SIGNING_KEY",
            "FUTURE_SERVICE_HEADER_VALUE",
            "FUTURE_SERVICE_HASH_KEY",
            "FUTURE_SERVICE_HMAC_KEY",
            "FUTURE_SERVICE_WEBHOOK_KEY",
        )
        for name in names:
            with self.subTest(name=name):
                problems = safety_check.scan_text(
                    "future.env.example", f"{name}={value}\n"
                )
                self.assertTrue(any("secret assignment" in item for item in problems))

        self.assertEqual(
            [],
            safety_check.scan_text(
                "notes.txt", f"future_service_secret={value}\n"
            ),
        )

    def test_camel_case_hash_and_hmac_material_names_are_scanned(self) -> None:
        for name in ("routeHashKey", "webhookHmacSecret", "providerWebhookKey"):
            with self.subTest(name=name):
                problems = safety_check.scan_text(
                    "config.example.js", f'const {name} = "opaque-live-material";\n'
                )
                self.assertTrue(
                    any("secret assignment" in item for item in problems)
                )

    def test_only_public_synthetic_test_secret_literals_are_exempt(self) -> None:
        assignment = (
            "TOKEN_" + "PEPPER=" + "SyntheticFixtureValue123456789" + "\n"
        )
        self.assertEqual([], safety_check.scan_text("test/helpers.js", assignment))
        self.assertTrue(safety_check.scan_text("config/.env.example", assignment))

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

    def test_repository_scan_uses_secret_names_from_staged_registry(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            self._git(root, "init", "--quiet")
            staged_name = "FUTURE_STAGED_ONLY_MATERIAL"
            for index, relative_path in enumerate(
                safety_check.SECRET_REGISTRY_PATHS, start=1
            ):
                path = root.joinpath(*relative_path.parts)
                path.parent.mkdir(parents=True, exist_ok=True)
                name = f"BASE_REGISTRY_MATERIAL_{index}"
                path.write_text(
                    json.dumps(
                        {
                            "variables": [
                                {"name": name, "classification": "secret"}
                            ]
                        }
                    ),
                    encoding="utf-8",
                )

            self._git(root, "add", ".")
            self._git(
                root,
                "-c",
                "user.name=Synthetic Test",
                "-c",
                "user.email=operator@example.invalid",
                "commit",
                "--quiet",
                "-m",
                "synthetic baseline",
            )

            staged_registry = root.joinpath(*safety_check.SECRET_REGISTRY_PATHS[0].parts)
            staged_registry.write_text(
                json.dumps(
                    {
                        "variables": [
                            {
                                "name": "BASE_REGISTRY_MATERIAL_1",
                                "classification": "secret",
                            },
                            {"name": staged_name, "classification": "secret"},
                        ]
                    }
                ),
                encoding="utf-8",
            )

            candidate = root / "config.example.json"
            candidate.write_text(
                f'{{\n  "{staged_name}":\n    "live-material-AlphaBeta987654321"\n}}\n',
                encoding="utf-8",
            )
            self._git(root, "add", ".")

            working_registry = staged_registry
            working_registry.write_text(
                json.dumps(
                    {
                        "variables": [
                            {
                                "name": "BASE_REGISTRY_MATERIAL_1",
                                "classification": "secret",
                            },
                            {
                                "name": "FUTURE_WORKTREE_ONLY_MATERIAL",
                                "classification": "secret",
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )

            problems = safety_check.scan_repository(root)

        self.assertTrue(
            any(
                "secret assignment" in item and "staged index" in item
                for item in problems
            )
        )

    def test_repository_scan_blocks_registry_secret_downgrade_and_literal(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            self._git(root, "init", "--quiet")
            protected_name = "HISTORICAL_OPAQUE_MATERIAL"
            for index, relative_path in enumerate(
                safety_check.SECRET_REGISTRY_PATHS, start=1
            ):
                path = root.joinpath(*relative_path.parts)
                path.parent.mkdir(parents=True, exist_ok=True)
                name = protected_name if index == 1 else "SECOND_BASE_MATERIAL"
                path.write_text(
                    json.dumps(
                        {
                            "variables": [
                                {"name": name, "classification": "secret"}
                            ]
                        }
                    ),
                    encoding="utf-8",
                )
            self._git(root, "add", ".")
            self._git(
                root,
                "-c",
                "user.name=Synthetic Test",
                "-c",
                "user.email=operator@example.invalid",
                "commit",
                "--quiet",
                "-m",
                "synthetic baseline",
            )

            first_registry = root.joinpath(*safety_check.SECRET_REGISTRY_PATHS[0].parts)
            first_registry.write_text(
                json.dumps(
                    {
                        "variables": [
                            {"name": protected_name, "classification": "safe-enum"}
                        ]
                    }
                ),
                encoding="utf-8",
            )
            candidate = root / "config.example.js"
            candidate.write_text(
                f"const {protected_name} = `live-material-AlphaBeta987654321`;\n",
                encoding="utf-8",
            )
            self._git(root, "add", ".")

            problems = safety_check.scan_repository(root)

        self.assertTrue(any("may not be removed or downgraded" in item for item in problems))
        self.assertTrue(any("secret assignment" in item for item in problems))

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

    def test_index_blobs_are_read_with_two_git_batch_calls(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            self._git(root, "init", "--quiet")
            expected: dict[str, bytes] = {}
            for number in range(3):
                rel = f"file-{number}.txt"
                content = f"synthetic-{number}\n".encode("utf-8")
                root.joinpath(rel).write_bytes(content)
                expected[rel] = content
            self._git(root, "add", ".")
            entries, entry_problems = safety_check.load_tracked_entries(root)
            self.assertEqual([], entry_problems)

            original_run = subprocess.run
            with mock.patch.object(
                safety_check.subprocess, "run", wraps=original_run
            ) as run:
                contents, problems = safety_check.load_index_blobs(root, entries)

        self.assertEqual([], problems)
        self.assertEqual(expected, contents)
        cat_file_calls = [
            call
            for call in run.call_args_list
            if call.args and call.args[0][:2] == ["git", "cat-file"]
        ]
        self.assertEqual(2, len(cat_file_calls))

    def test_index_blob_limits_split_content_without_omitting_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            self._git(root, "init", "--quiet")
            expected: dict[str, bytes] = {}
            for number in range(3):
                rel = f"batch-{number}.txt"
                content = f"synthetic-batch-{number}\n".encode("utf-8")
                root.joinpath(rel).write_bytes(content)
                expected[rel] = content
            self._git(root, "add", ".")
            entries, entry_problems = safety_check.load_tracked_entries(root)
            self.assertEqual([], entry_problems)

            original_run = subprocess.run
            with mock.patch.object(
                safety_check, "BATCH_OBJECT_LIMIT", 1
            ), mock.patch.object(
                safety_check, "BATCH_CONTENT_LIMIT", 1
            ), mock.patch.object(
                safety_check.subprocess, "run", wraps=original_run
            ) as run:
                contents, problems = safety_check.load_index_blobs(root, entries)

        self.assertEqual([], problems)
        self.assertEqual(expected, contents)
        self.assertTrue(
            all(
                not safety_check.scan_decoded_text(path, content.decode("utf-8"))
                for path, content in contents.items()
            )
        )
        cat_file_calls = [
            call
            for call in run.call_args_list
            if call.args and call.args[0][:2] == ["git", "cat-file"]
        ]
        self.assertEqual(6, len(cat_file_calls))

    def test_truncated_batch_blob_output_fails_closed(self) -> None:
        object_id = "a" * 40
        entry = safety_check.TrackedEntry("100644", object_id)
        metadata = SimpleNamespace(
            returncode=0, stdout=f"{object_id} blob 5\n".encode("ascii")
        )
        truncated_content = SimpleNamespace(
            returncode=0, stdout=f"{object_id} blob 5\nsafe".encode("ascii")
        )
        with mock.patch.object(
            safety_check.subprocess,
            "run",
            side_effect=[metadata, truncated_content],
        ):
            contents, problems = safety_check.load_index_blobs(
                Path("."), {"safe.txt": entry}
            )
        self.assertEqual({}, contents)
        self.assertTrue(any("fails closed" in item for item in problems))

    def test_oversized_index_blob_is_not_loaded(self) -> None:
        object_id = "a" * 40
        entry = safety_check.TrackedEntry("100644", object_id)
        metadata = SimpleNamespace(
            returncode=0, stdout=f"{object_id} blob 3\n".encode("ascii")
        )
        with mock.patch.object(safety_check, "MAX_TEXT_BYTES", 2), mock.patch.object(
            safety_check.subprocess, "run", return_value=metadata
        ) as run:
            contents, problems = safety_check.load_index_blobs(
                Path("."), {"large.txt": entry}
            )
        self.assertEqual({}, contents)
        self.assertEqual(1, run.call_count)
        self.assertTrue(any("exceeds" in item for item in problems))


if __name__ == "__main__":
    unittest.main()
