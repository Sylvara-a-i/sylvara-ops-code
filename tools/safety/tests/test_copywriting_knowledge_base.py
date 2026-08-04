import json
import re
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
COPYWRITING_ROOT = REPOSITORY_ROOT / "docs" / "copywriting"
MANIFEST_PATH = COPYWRITING_ROOT / "reference" / "source-manifest.json"

EXPECTED_MARKDOWN = {
    "README.md",
    "originality-and-claims-standard.md",
    "playbooks/brief-and-research.md",
    "playbooks/channels.md",
    "playbooks/conversion-architecture.md",
    "playbooks/editing-and-qa.md",
    "playbooks/messaging-and-positioning.md",
    "reference/pattern-library.md",
    "templates/copy-brief.md",
}

EXPECTED_PUBLIC_FILES = EXPECTED_MARKDOWN | {"reference/source-manifest.json"}

PRIVATE_BRIEF_WARNING = (
    "Completed briefs belong in an approved private workspace and must never be "
    "committed to this public repository."
)

RAW_ARCHIVE_SUFFIXES = {
    ".com",
    ".doc",
    ".docx",
    ".jpeg",
    ".jpg",
    ".mp4",
    ".pdf",
    ".png",
    ".webp",
}

PRIVATE_SOURCE_MARKERS = (
    "C:\\Users",
    "C:/Users",
)


class CopywritingKnowledgeBaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        cls.markdown_files = sorted(COPYWRITING_ROOT.rglob("*.md"))
        cls.public_files = sorted(
            path for path in COPYWRITING_ROOT.rglob("*") if path.is_file()
        )

    def test_expected_public_file_set_is_complete(self):
        actual_markdown = {
            path.relative_to(COPYWRITING_ROOT).as_posix()
            for path in self.markdown_files
        }
        actual_files = {
            path.relative_to(COPYWRITING_ROOT).as_posix()
            for path in self.public_files
        }
        self.assertEqual(EXPECTED_MARKDOWN, actual_markdown)
        self.assertEqual(EXPECTED_PUBLIC_FILES, actual_files)

    def test_each_markdown_file_has_exactly_one_h1(self):
        for path in self.markdown_files:
            h1_lines = [
                line for line in path.read_text(encoding="utf-8").splitlines()
                if line.startswith("# ")
            ]
            self.assertEqual(1, len(h1_lines), path)

    def test_local_markdown_links_resolve(self):
        link_pattern = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
        for path in self.markdown_files:
            text = path.read_text(encoding="utf-8")
            for raw_target in link_pattern.findall(text):
                target = raw_target.strip().split("#", 1)[0]
                if not target or target.startswith(("https://", "http://", "mailto:")):
                    continue
                resolved = (path.parent / target).resolve()
                self.assertTrue(
                    resolved.is_relative_to(REPOSITORY_ROOT.resolve()),
                    f"Link escapes repository: {path} -> {raw_target}",
                )
                self.assertTrue(
                    resolved.exists(),
                    f"Broken link: {path} -> {raw_target}",
                )

    def test_manifest_describes_a_sanitized_derivative(self):
        self.assertEqual(1, self.manifest["schema_version"])
        self.assertEqual("2026-08-04", self.manifest["inventory_observed_on"])
        self.assertEqual(
            "sanitized-original-synthesis", self.manifest["classification"]
        )
        self.assertFalse(self.manifest["raw_assets_published"])
        self.assertEqual(
            "mixed-or-unverified", self.manifest["source_rights_status"]
        )
        review_scope = self.manifest["source_collection"]["semantic_review_scope"]
        self.assertEqual("representative-not-comprehensive", review_scope["coverage"])
        readme = (COPYWRITING_ROOT / "README.md").read_text(encoding="utf-8")
        self.assertIn("not a complete semantic index", readme)

    def test_manifest_schema_is_exact_and_fail_closed(self):
        self.assertEqual(
            {
                "schema_version",
                "created_on",
                "inventory_observed_on",
                "classification",
                "raw_assets_published",
                "source_rights_status",
                "source_collection",
                "publication_boundary",
                "public_artifacts",
            },
            set(self.manifest),
        )

        source = self.manifest["source_collection"]
        self.assertEqual(
            {
                "file_count",
                "directory_count",
                "total_bytes",
                "extension_counts",
                "semantic_review_scope",
                "quality_observations",
            },
            set(source),
        )
        self.assertEqual(
            {"method", "representative_files_extracted", "coverage"},
            set(source["semantic_review_scope"]),
        )
        self.assertEqual(
            {
                "empty_files",
                "extension_content_mismatches",
                "encrypted_pdfs",
                "parser_unreadable_pdf_signature_files",
                "exact_duplicate_groups",
                "redundant_files",
                "duplicate_bytes",
                "images_with_gps_exif",
                "docx_with_document_metadata",
                "pdfs_with_author_metadata",
            },
            set(source["quality_observations"]),
        )
        self.assertEqual(
            RAW_ARCHIVE_SUFFIXES,
            set(source["extension_counts"]),
        )

        publication = self.manifest["publication_boundary"]
        self.assertEqual(
            {"source_collection_disposition", "included", "excluded"},
            set(publication),
        )
        expected_artifact_keys = {
            "path",
            "classification",
            "rights_basis",
            "pii_review",
            "raw_source_excerpt",
        }
        for artifact in self.manifest["public_artifacts"]:
            self.assertEqual(expected_artifact_keys, set(artifact))

    def test_manifest_inventory_counts_reconcile(self):
        source = self.manifest["source_collection"]
        self.assertEqual(1249, source["file_count"])
        self.assertEqual(70, source["directory_count"])
        self.assertEqual(2286898602, source["total_bytes"])
        self.assertEqual(source["file_count"], sum(source["extension_counts"].values()))

    def test_every_public_markdown_artifact_has_an_allowlisted_record(self):
        artifacts = self.manifest["public_artifacts"]
        artifact_paths = {artifact["path"] for artifact in artifacts}
        self.assertEqual(EXPECTED_MARKDOWN, artifact_paths)
        self.assertEqual(len(artifact_paths), len(artifacts))

        for artifact in artifacts:
            self.assertEqual("original-synthesis", artifact["classification"])
            self.assertEqual(
                "sylvara-original-synthesis", artifact["rights_basis"]
            )
            self.assertEqual("passed", artifact["pii_review"])
            self.assertFalse(artifact["raw_source_excerpt"])
            target = (COPYWRITING_ROOT / artifact["path"]).resolve()
            self.assertTrue(target.is_relative_to(COPYWRITING_ROOT.resolve()))
            self.assertTrue(target.is_file())

    def test_no_raw_archive_asset_is_published(self):
        for path in self.public_files:
            self.assertNotIn(path.suffix.lower(), RAW_ARCHIVE_SUFFIXES, path)

    def test_public_files_are_small_utf8_text_without_private_source_markers(self):
        for path in self.public_files:
            self.assertLess(path.stat().st_size, 2 * 1024 * 1024, path)
            text = path.read_text(encoding="utf-8")
            for marker in PRIVATE_SOURCE_MARKERS:
                self.assertNotIn(marker, text, path)

    def test_completed_briefs_are_explicitly_private_only(self):
        readme = (COPYWRITING_ROOT / "README.md").read_text(encoding="utf-8")
        template = (COPYWRITING_ROOT / "templates" / "copy-brief.md").read_text(
            encoding="utf-8"
        )
        self.assertIn(PRIVATE_BRIEF_WARNING, readme)
        self.assertIn(PRIVATE_BRIEF_WARNING, template)
        self.assertIn(
            "Customer or employee data included in any repository copy: No (required)",
            template,
        )

    def test_pattern_risk_uses_the_canonical_review_classes(self):
        pattern_library = (
            COPYWRITING_ROOT / "reference" / "pattern-library.md"
        ).read_text(encoding="utf-8")
        card_count = len(re.findall(r"^### PAT-", pattern_library, re.MULTILINE))
        risk_classes = re.findall(
            r"^- \*\*Risk:\*\* (Low|Medium|High)(?:\.|\s)",
            pattern_library,
            re.MULTILINE,
        )
        self.assertGreater(card_count, 0)
        self.assertEqual(card_count, len(risk_classes))

    def test_root_navigation_and_agent_policy_link_the_library(self):
        root_readme = (REPOSITORY_ROOT / "README.md").read_text(encoding="utf-8")
        agent_policy = (REPOSITORY_ROOT / "AGENTS.md").read_text(encoding="utf-8")
        self.assertIn("[`docs/copywriting/`](docs/copywriting/)", root_readme)
        self.assertIn(
            "[`docs/copywriting/README.md`](docs/copywriting/README.md)",
            agent_policy,
        )

    def test_manifest_does_not_expose_source_paths_names_or_fingerprints(self):
        publication = self.manifest["publication_boundary"]
        self.assertEqual(
            "local-private-reference-only",
            publication["source_collection_disposition"],
        )
        serialized = json.dumps(self.manifest, sort_keys=True)
        for forbidden_key in (
            '"source_path"',
            '"source_filename"',
            '"source_hash"',
            '"source_fingerprint"',
        ):
            self.assertNotIn(forbidden_key, serialized)


if __name__ == "__main__":
    unittest.main()
