from __future__ import annotations

import json
import re
import unittest
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[3]
ACCOUNTING_ROOT = ROOT / "docs" / "accounting"
MANIFEST_PATH = ACCOUNTING_ROOT / "reference" / "source-manifest.json"

EXPECTED_MARKDOWN = {
    "README.md",
    "authority-and-research.md",
    "federal-tax-reference.md",
    "operating-controls.md",
    "us-gaap-reference.md",
}
EXPECTED_PUBLIC_FILES = EXPECTED_MARKDOWN | {"reference/source-manifest.json"}

EXPECTED_MANIFEST_KEYS = {
    "schema_version",
    "created_on",
    "verified_on",
    "classification",
    "raw_source_copied",
    "live_accounting_state",
    "authority_scope",
    "origin_review",
    "official_sources",
    "source_coverage_rules",
    "public_artifacts",
}
EXPECTED_SOURCE_KEYS = {
    "id",
    "title",
    "publisher",
    "authority_class",
    "url",
    "verified_on",
}
EXPECTED_ARTIFACT_KEYS = {
    "path",
    "classification",
    "rights_basis",
    "pii_review",
    "raw_source_excerpt",
}
ALLOWED_OFFICIAL_DOMAINS = {
    "accountingfoundation.org",
    "asc.fasb.org",
    "fasb.org",
    "storage.fasb.org",
    "uscode.house.gov",
    "www.ecfr.gov",
    "www.fasb.org",
    "www.irs.gov",
}
PROHIBITED_OPERATIVE_MARKERS = {
    "kansas",
    "landlord",
    "mortgage",
    "residential rental",
    "schedule e",
    "security deposit",
    "tenant",
}
OPERATIVE_FILES = EXPECTED_MARKDOWN - {"README.md"}
MARKDOWN_LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")


def relative_markdown_targets(text: str) -> set[str]:
    return {
        target.strip("<>").split("#", 1)[0]
        for target in MARKDOWN_LINK_RE.findall(text)
        if target
        and not target.startswith(("http://", "https://", "mailto:", "#"))
    }


class AccountingKnowledgeBaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        cls.markdown_files = sorted(ACCOUNTING_ROOT.rglob("*.md"))
        cls.public_files = sorted(
            path for path in ACCOUNTING_ROOT.rglob("*") if path.is_file()
        )

    def test_expected_public_file_set_is_exact(self) -> None:
        actual_markdown = {
            path.relative_to(ACCOUNTING_ROOT).as_posix()
            for path in self.markdown_files
        }
        actual_files = {
            path.relative_to(ACCOUNTING_ROOT).as_posix()
            for path in self.public_files
        }
        self.assertEqual(EXPECTED_MARKDOWN, actual_markdown)
        self.assertEqual(EXPECTED_PUBLIC_FILES, actual_files)

    def test_each_markdown_file_has_one_h1_and_resolving_local_links(self) -> None:
        for path in self.markdown_files:
            text = path.read_text(encoding="utf-8")
            h1_lines = [line for line in text.splitlines() if line.startswith("# ")]
            self.assertEqual(1, len(h1_lines), path)
            for target in relative_markdown_targets(text):
                resolved = (path.parent / target).resolve()
                self.assertTrue(
                    resolved.is_relative_to(ROOT.resolve()),
                    f"Link escapes repository: {path} -> {target}",
                )
                self.assertTrue(resolved.exists(), f"Broken link: {path} -> {target}")

    def test_manifest_is_fail_closed_original_synthesis(self) -> None:
        self.assertEqual(EXPECTED_MANIFEST_KEYS, set(self.manifest))
        self.assertEqual(1, self.manifest["schema_version"])
        self.assertEqual("2026-08-04", self.manifest["created_on"])
        self.assertEqual("2026-08-04", self.manifest["verified_on"])
        self.assertEqual(
            "portable-original-synthesis", self.manifest["classification"]
        )
        self.assertFalse(self.manifest["raw_source_copied"])
        self.assertEqual("unknown", self.manifest["live_accounting_state"])

    def test_origin_review_is_exact_and_excludes_cross_business_material(self) -> None:
        origin = self.manifest["origin_review"]
        self.assertEqual(
            {
                "source_repository",
                "source_commit",
                "source_branch",
                "review_purpose",
                "portable_source_paths",
                "excluded_source_families",
            },
            set(origin),
        )
        self.assertEqual("GH-Real-Estate/gh-real-estate-ops-code", origin["source_repository"])
        self.assertRegex(origin["source_commit"], r"^[0-9a-f]{40}$")
        self.assertEqual("main", origin["source_branch"])
        self.assertGreater(len(origin["portable_source_paths"]), 0)
        exclusions = "\n".join(
            self.manifest["authority_scope"]["excluded"]
            + origin["excluded_source_families"]
        ).lower()
        for marker in (
            "chart-of-accounts",
            "kansas",
            "rental",
            "tenant",
            "threshold",
            "transaction",
        ):
            self.assertIn(marker, exclusions)

    def test_official_source_registry_is_dated_unique_and_allowlisted(self) -> None:
        sources = self.manifest["official_sources"]
        self.assertGreaterEqual(len(sources), 30)
        self.assertEqual(len(sources), len({row["id"] for row in sources}))
        self.assertEqual(len(sources), len({row["url"] for row in sources}))
        for row in sources:
            with self.subTest(source=row["id"]):
                self.assertEqual(EXPECTED_SOURCE_KEYS, set(row))
                self.assertEqual("2026-08-04", row["verified_on"])
                parsed = urlparse(row["url"])
                self.assertEqual("https", parsed.scheme)
                self.assertIn(parsed.netloc, ALLOWED_OFFICIAL_DOMAINS)

    def test_source_coverage_rules_are_narrow_and_resolve_to_registered_sources(self) -> None:
        rules = self.manifest["source_coverage_rules"]
        self.assertEqual(1, len(rules))
        rule = rules[0]
        self.assertEqual(
            {
                "id",
                "manifest_source_id",
                "url_prefix",
                "path_pattern",
                "scope",
            },
            set(rule),
        )
        self.assertEqual("fasb-asc-topic-locators", rule["id"])
        self.assertEqual("https://asc.fasb.org/", rule["url_prefix"])
        self.assertEqual(r"^/[0-9]{3}/$", rule["path_pattern"])
        source_ids = {row["id"] for row in self.manifest["official_sources"]}
        self.assertIn(rule["manifest_source_id"], source_ids)

    def test_all_accounting_external_links_are_registered_or_narrowly_covered(self) -> None:
        registered_urls = {row["url"] for row in self.manifest["official_sources"]}
        coverage_rules = self.manifest["source_coverage_rules"]
        for path in self.markdown_files:
            for target in MARKDOWN_LINK_RE.findall(path.read_text(encoding="utf-8")):
                if not target.startswith(("http://", "https://")):
                    continue
                parsed = urlparse(target)
                with self.subTest(path=path, target=target):
                    self.assertEqual("https", parsed.scheme)
                    self.assertIn(parsed.netloc, ALLOWED_OFFICIAL_DOMAINS)
                    if target in registered_urls:
                        continue
                    covered = any(
                        target.startswith(rule["url_prefix"])
                        and re.fullmatch(rule["path_pattern"], parsed.path)
                        and not parsed.query
                        and not parsed.fragment
                        for rule in coverage_rules
                    )
                    self.assertTrue(
                        covered,
                        f"External source is neither registered nor covered: {target}",
                    )

    def test_every_markdown_artifact_is_allowlisted_as_original(self) -> None:
        artifacts = self.manifest["public_artifacts"]
        artifact_paths = {artifact["path"] for artifact in artifacts}
        self.assertEqual(EXPECTED_MARKDOWN, artifact_paths)
        self.assertEqual(len(artifact_paths), len(artifacts))
        for artifact in artifacts:
            self.assertEqual(EXPECTED_ARTIFACT_KEYS, set(artifact))
            self.assertEqual("original-synthesis", artifact["classification"])
            self.assertEqual("sylvara-original-synthesis", artifact["rights_basis"])
            self.assertEqual("passed", artifact["pii_review"])
            self.assertFalse(artifact["raw_source_excerpt"])
            self.assertTrue((ACCOUNTING_ROOT / artifact["path"]).is_file())

    def test_operating_content_does_not_import_real_estate_rules(self) -> None:
        for relative_path in OPERATIVE_FILES:
            text = (ACCOUNTING_ROOT / relative_path).read_text(encoding="utf-8").lower()
            for marker in PROHIBITED_OPERATIVE_MARKERS:
                with self.subTest(path=relative_path, marker=marker):
                    self.assertNotIn(marker, text)

    def test_no_permanent_currency_thresholds_or_raw_source_claims(self) -> None:
        combined = "\n".join(
            path.read_text(encoding="utf-8") for path in self.markdown_files
        )
        self.assertIsNone(re.search(r"\$\s*\d", combined))
        lowered = combined.lower()
        self.assertIn("does not reproduce codification text", lowered)
        self.assertIn("no sourcebook or policy text was copied", lowered)

    def test_public_files_are_small_utf8_text_without_private_paths(self) -> None:
        for path in self.public_files:
            self.assertLess(path.stat().st_size, 2 * 1024 * 1024, path)
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("C:\\Users", text, path)
            self.assertNotIn("C:/Users", text, path)
            self.assertIn(path.suffix, {".md", ".json"})

    def test_repository_navigation_and_accounting_boundaries_are_linked(self) -> None:
        root_readme = (ROOT / "README.md").read_text(encoding="utf-8")
        agent_policy = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
        zoho_standard = (
            ROOT / "docs" / "zoho" / "standards" / "accounting.md"
        ).read_text(encoding="utf-8")
        zoho_index = (ROOT / "docs" / "zoho" / "README.md").read_text(
            encoding="utf-8"
        )
        archive_index = (ROOT / "archive" / "README.md").read_text(encoding="utf-8")

        self.assertIn("[`docs/accounting/`](docs/accounting/)", root_readme)
        self.assertIn(
            "[`docs/accounting/README.md`](docs/accounting/README.md)",
            agent_policy,
        )
        self.assertIn("../../accounting/README.md", zoho_standard)
        self.assertIn("Historical, non-executable Billing gateway", zoho_index)
        self.assertIn("../src/zoho-catalyst/billing-webhook-gateway/README.md", archive_index)
        self.assertIn("../docs/zoho/README.md", archive_index)


if __name__ == "__main__":
    unittest.main()
