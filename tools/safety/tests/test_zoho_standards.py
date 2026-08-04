from __future__ import annotations

import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
ZOHO_DOCS = ROOT / "docs" / "zoho"
README = ZOHO_DOCS / "README.md"
CATALOG = ZOHO_DOCS / "mcp" / "capability-catalog.md"
SUITE_REGISTRY = ZOHO_DOCS / "suite-registry.json"

GOVERNED_STANDARDS = {
    "crm-schema-standard.md",
    "deluge-standard.md",
    "billing-standard.md",
    "catalyst-standard.md",
    "workflow-and-intake-standard.md",
    "document-lifecycle-standard.md",
    "mail-standard.md",
    "analytics-standard.md",
    "accounting-practices-standard.md",
    "../../src/zoho-books/automation-standard.md",
}
REQUIRED_README_HEADINGS = {
    "Purpose",
    "Portability Boundary",
    "Standards Index",
    "System Ownership",
    "Governed Artifact Contract",
    "Evidence Rules",
    "Current Snapshot",
}
REQUIRED_STANDARD_HEADINGS = {
    "Status",
    "Ownership",
    "Repository Boundary",
    "Failure And Readback",
    "Validation",
    "Manual Setup",
}
REQUIRED_PRODUCTS = {
    "CRM",
    "Books",
    "Billing",
    "Creator",
    "WorkDrive",
    "Catalyst",
    "Forms",
    "Contracts / Sign",
    "Sites",
    "Mail",
    "Analytics",
}
REQUIRED_REGISTRY_IDS = {
    "crm",
    "books",
    "billing",
    "catalyst",
    "creator",
    "forms",
    "workdrive",
    "contracts",
    "sign",
    "sites",
    "mail",
    "analytics",
}
MARKDOWN_LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")


def headings(text: str, level: int) -> set[str]:
    prefix = "#" * level + " "
    return {
        line.removeprefix(prefix).strip()
        for line in text.splitlines()
        if line.startswith(prefix) and not line.startswith(prefix + "#")
    }


class ZohoStandardsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.readme_text = README.read_text(encoding="utf-8")

    def test_readme_has_required_navigation_and_governance_headings(self) -> None:
        self.assertTrue(
            REQUIRED_README_HEADINGS.issubset(headings(self.readme_text, 2))
        )
        catalog_headings = headings(CATALOG.read_text(encoding="utf-8"), 2)
        self.assertIn("Capability Evidence Layers", catalog_headings)

    def test_all_governed_standards_are_linked_and_links_resolve(self) -> None:
        relative_links = {
            target.split("#", 1)[0]
            for target in MARKDOWN_LINK_RE.findall(self.readme_text)
            if not target.startswith(("http://", "https://", "#"))
        }
        self.assertTrue(GOVERNED_STANDARDS.issubset(relative_links))

        for target in relative_links:
            with self.subTest(target=target):
                self.assertTrue((README.parent / target).resolve().is_file())

    def test_governed_standard_documents_have_required_headings(self) -> None:
        for filename in sorted(GOVERNED_STANDARDS):
            path = ZOHO_DOCS / filename
            with self.subTest(path=path):
                text = path.read_text(encoding="utf-8")
                self.assertEqual(1, len(headings(text, 1)))
                self.assertTrue(
                    REQUIRED_STANDARD_HEADINGS.issubset(headings(text, 2))
                )

    def test_ownership_map_includes_every_governed_zoho_product(self) -> None:
        ownership_section = self.readme_text.split(
            "## System Ownership", 1
        )[1].split("\n## ", 1)[0]
        products = {
            cells[0]
            for line in ownership_section.splitlines()
            if line.startswith("|")
            and len(
                cells := [
                    cell.strip() for cell in line.strip("|").split("|")
                ]
            )
            == 3
            and cells[0] not in {"Zoho product", "---"}
        }
        self.assertTrue(REQUIRED_PRODUCTS.issubset(products))

    def test_machine_readable_suite_registry_is_complete_and_resolvable(self) -> None:
        registry = json.loads(SUITE_REGISTRY.read_text(encoding="utf-8"))
        self.assertEqual(1, registry["schema_version"])
        self.assertEqual("unknown", registry["live_state"])
        products = registry["products"]
        self.assertEqual(len(products), len({row["id"] for row in products}))
        self.assertEqual(REQUIRED_REGISTRY_IDS, {row["id"] for row in products})
        for row in products:
            with self.subTest(product=row["id"]):
                self.assertEqual("unknown", row["effective_tenant_capability"])
                self.assertIsInstance(row["repository_artifacts"], list)
                for target in (*row["standards"], *row["repository_artifacts"]):
                    self.assertTrue((ZOHO_DOCS / target).resolve().is_file())


if __name__ == "__main__":
    unittest.main()
