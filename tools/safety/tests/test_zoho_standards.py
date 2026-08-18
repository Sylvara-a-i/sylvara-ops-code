from __future__ import annotations

import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
ZOHO_DOCS = ROOT / "docs" / "zoho"
README = ZOHO_DOCS / "README.md"
CATALOG = (
    ZOHO_DOCS
    / "mcp"
    / "snapshots"
    / "configured"
    / "2026-08-04"
    / "capability-catalog.md"
)
SUITE_REGISTRY = ZOHO_DOCS / "governance" / "suite-registry.json"
SOURCE_MANIFEST = ZOHO_DOCS / "reference" / "source-manifest.json"
PRODUCT_REFERENCE_DIR = ZOHO_DOCS / "reference" / "products"

GOVERNED_STANDARDS = {
    "standards/crm-schema.md",
    "standards/deluge.md",
    "standards/billing.md",
    "standards/catalyst.md",
    "standards/workflow-and-intake.md",
    "standards/document-lifecycle.md",
    "standards/mail.md",
    "standards/analytics.md",
    "standards/accounting.md",
    "standards/books-automation.md",
}
REQUIRED_README_HEADINGS = {
    "Purpose",
    "Directory Map",
    "Start Here",
    "Standards Index",
    "Product Reference Index",
    "MCP Index",
    "Code-Adjacent Zoho Artifacts",
    "Portability Boundary",
    "Governed Artifact Contract",
    "Evidence Status",
    "Current MCP Snapshot",
    "Live Change Boundary",
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
    "Contracts",
    "Sign",
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
OBSERVED_PRODUCT_IDS = {
    "crm",
    "books",
    "billing",
    "catalyst",
    "creator",
    "workdrive",
    "mail",
}
REFERENCE_ONLY_IDS = {
    "api-console",
    "one",
    "bookings",
    "calendar",
    "checkout",
    "flow",
    "meeting",
    "payments",
    "people",
    "todo",
    "voice",
}
CAPABILITY_LAYERS = (
    "official-product-capability",
    "tool-manual-catalog",
    "preconfigured-template-membership",
    "configured-mcp-selection",
    "advertised-mcp-contract",
    "effective-tenant-capability",
)
PRODUCT_REFERENCE_FILES = {
    "zoho-analytics.md",
    "zoho-api-console.md",
    "zoho-billing.md",
    "zoho-bookings.md",
    "zoho-books.md",
    "zoho-calendar.md",
    "zoho-catalyst.md",
    "zoho-checkout.md",
    "zoho-contracts.md",
    "zoho-creator.md",
    "zoho-crm.md",
    "zoho-flow.md",
    "zoho-forms.md",
    "zoho-mail.md",
    "zoho-meeting.md",
    "zoho-one.md",
    "zoho-payments.md",
    "zoho-people.md",
    "zoho-sign.md",
    "zoho-sites.md",
    "zoho-todo.md",
    "zoho-voice.md",
    "zoho-workdrive.md",
}
FIELD_CONTRACT_MARKERS = {
    "standards/crm-schema.md": ("CRM Field-Type Crosswalk", "`multiselectpicklist`", "`multiuserlookup`"),
    "reference/products/zoho-creator.md": ("Field Metadata And Write Contract", "| 39 | Prediction |"),
    "reference/products/zoho-forms.md": (
        "Live Builder Element Catalog",
        "1-Column",
        "Legal & Consent",
    ),
    "reference/products/zoho-contracts.md": ("Contract-Type Field Metadata", "`dataType` | 11 | Email"),
    "reference/products/zoho-sign.md": ("Document Fields And Text Tags", "Split Text", "fewer than 75 pages"),
    "reference/products/zoho-checkout.md": ("Invoice Custom Fields", "API Field Name"),
    "reference/products/zoho-flow.md": ("Custom Function Type Contract", "`void`"),
}
OLD_PATHS = {
    "docs/zoho/suite-registry.json",
    "docs/zoho/crm-schema-standard.md",
    "docs/zoho/accounting-practices-standard.md",
    "docs/zoho/billing-standard.md",
    "docs/zoho/catalyst-standard.md",
    "docs/zoho/deluge-standard.md",
    "docs/zoho/workflow-and-intake-standard.md",
    "docs/zoho/document-lifecycle-standard.md",
    "docs/zoho/mail-standard.md",
    "docs/zoho/analytics-standard.md",
    "docs/zoho/mcp/capability-catalog.md",
    "docs/zoho/mcp/observed-tool-inventory.json",
    "docs/zoho/mcp/snapshots/configured/2026-08-03/capability-catalog.md",
    "docs/zoho/mcp/snapshots/configured/2026-08-03/observed-tool-inventory.json",
    "src/zoho-books/automation-standard.md",
}
MARKDOWN_LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
TEXT_SUFFIXES = {".md", ".py", ".json", ".yml", ".yaml"}
SKIPPED_PARTS = {".git", ".codex-tmp", "node_modules"}


def headings(text: str, level: int) -> set[str]:
    prefix = "#" * level + " "
    return {
        line.removeprefix(prefix).strip()
        for line in text.splitlines()
        if line.startswith(prefix) and not line.startswith(prefix + "#")
    }


def relative_markdown_targets(text: str) -> set[str]:
    return {
        target.strip("<>").split("#", 1)[0]
        for target in MARKDOWN_LINK_RE.findall(text)
        if target
        and not target.startswith(("http://", "https://", "mailto:", "#"))
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

    def test_all_governed_standards_are_linked_and_have_contract_headings(self) -> None:
        root_links = relative_markdown_targets(self.readme_text)
        self.assertTrue(GOVERNED_STANDARDS.issubset(root_links))

        for relative_path in sorted(GOVERNED_STANDARDS):
            path = ZOHO_DOCS / relative_path
            with self.subTest(path=path):
                text = path.read_text(encoding="utf-8")
                self.assertEqual(1, len(headings(text, 1)))
                self.assertTrue(
                    REQUIRED_STANDARD_HEADINGS.issubset(headings(text, 2))
                )

    def test_every_relative_link_under_zoho_docs_resolves(self) -> None:
        for path in sorted(ZOHO_DOCS.rglob("*.md")):
            for target in sorted(relative_markdown_targets(path.read_text(encoding="utf-8"))):
                with self.subTest(path=path, target=target):
                    self.assertTrue((path.parent / target).resolve().exists())

    def test_ownership_map_includes_every_governed_zoho_product(self) -> None:
        ownership_section = self.readme_text.split(
            "## System Ownership", 1
        )[1].split("\n## ", 1)[0] if "## System Ownership" in self.readme_text else (
            (ZOHO_DOCS / "governance" / "system-ownership.md")
            .read_text(encoding="utf-8")
            .split("## Ownership Map", 1)[1]
            .split("\n## ", 1)[0]
        )
        products = {
            cells[0].removeprefix("Zoho ")
            for line in ownership_section.splitlines()
            if line.startswith("|")
            and len(cells := [cell.strip() for cell in line.strip("|").split("|")]) == 3
            and cells[0] not in {"Product", "Zoho product", "---"}
        }
        self.assertTrue(REQUIRED_PRODUCTS.issubset(products))

    def test_machine_readable_suite_registry_is_complete_and_resolvable(self) -> None:
        registry = json.loads(SUITE_REGISTRY.read_text(encoding="utf-8"))
        self.assertEqual(3, registry["schema_version"])
        self.assertEqual("2026-08-18", registry["as_of"])
        self.assertEqual("docs/zoho", registry["path_base"])
        self.assertEqual("partially-verified", registry["live_state"])
        self.assertEqual(list(CAPABILITY_LAYERS), registry["capability_layers"])

        products = registry["products"]
        self.assertEqual(len(products), len({row["id"] for row in products}))
        self.assertEqual(REQUIRED_REGISTRY_IDS, {row["id"] for row in products})
        for row in products:
            with self.subTest(product=row["id"]):
                if row["id"] == "crm":
                    self.assertEqual(
                        "organization-metadata-field-layout-picklist-pipeline-validation-workflow-blueprint-configuration-readback-verified-2026-08-14-runtime-forms-and-module-conversion-map-write-unknown-native-conversion-manual",
                        row["effective_tenant_capability"],
                    )
                    expected_observation = "crm-roles-and-free-test-automation-refreshed-2026-08-14"
                    self.assertEqual(
                        {
                            "../../src/zoho-crm/reference/modules.csv",
                            "../../src/zoho-crm/reference/crm-field-dictionary.csv",
                            "../../src/zoho-crm/reference/lead-conversion-mapping.csv",
                        },
                        set(row["historical_repository_artifacts"]),
                    )
                    self.assertTrue(
                        set(row["repository_artifacts"]).isdisjoint(
                            row["historical_repository_artifacts"]
                        )
                    )
                elif row["id"] == "books":
                    self.assertEqual(
                        "organization-identity-chart-read-and-scoped-chart-create-update-activate-inactivate-verified-2026-08-05",
                        row["effective_tenant_capability"],
                    )
                    expected_observation = "books-roles-refreshed-2026-08-05"
                elif row["id"] == "analytics":
                    self.assertEqual("unknown", row["effective_tenant_capability"])
                    expected_observation = (
                        "official-managed-mcp-tool-catalog-reviewed-2026-08-18-"
                        "configured-selection-and-effective-access-unknown"
                    )
                else:
                    self.assertEqual("unknown", row["effective_tenant_capability"])
                    expected_observation = (
                        "configured-selections-observed-2026-08-04"
                        if row["id"] in OBSERVED_PRODUCT_IDS
                        else "not-observed-2026-08-04"
                    )
                self.assertEqual(
                    expected_observation,
                    row["mcp_observation"],
                )
                for target in (
                    *row["standards"],
                    *row["repository_artifacts"],
                    *row.get("historical_repository_artifacts", []),
                ):
                    self.assertTrue((ZOHO_DOCS / target).resolve().is_file())

        references = registry["reference_only_products"]
        self.assertEqual(REFERENCE_ONLY_IDS, {row["id"] for row in references})
        for row in references:
            with self.subTest(reference=row["id"]):
                self.assertEqual("unknown", row["adoption_status"])
                self.assertTrue((ZOHO_DOCS / row["reference"]).is_file())
                if row["id"] == "payments":
                    self.assertEqual(
                        "configured-selections-observed-2026-08-04",
                        row["mcp_observation"],
                    )

    def test_product_reference_collection_is_complete_and_fail_closed(self) -> None:
        product_dir = PRODUCT_REFERENCE_DIR
        self.assertEqual(PRODUCT_REFERENCE_FILES, {path.name for path in product_dir.glob("*.md")})
        references = [*product_dir.glob("*.md"), ZOHO_DOCS / "reference" / "deluge" / "master-knowledge-base.md"]
        for path in references:
            with self.subTest(path=path):
                text = path.read_text(encoding="utf-8").lower()
                expected_date = "2026-08-14" if path.name == "zoho-forms.md" else "2026-07-20"
                self.assertIn(expected_date, text)
                self.assertIn("reference", text)
                self.assertIn("unknown", text)
                self.assertIn("official", text)

    def test_source_manifest_lists_every_reference_and_resolves(self) -> None:
        manifest = json.loads(SOURCE_MANIFEST.read_text(encoding="utf-8"))
        self.assertEqual(2, manifest["schema_version"])
        self.assertEqual("2026-08-14", manifest["last_reviewed_on"])
        self.assertEqual("2026-08-05", manifest["research_cutoffs"]["field_type_refresh"])
        self.assertEqual("2026-08-14", manifest["research_cutoffs"]["forms_builder_inventory"])
        self.assertIn("configured_session_tool_selections", manifest["source_classes"])
        self.assertIn("live_forms_builder_inventory", manifest["source_classes"])
        self.assertNotIn("configured_session_advertised_names", manifest["source_classes"])
        self.assertEqual(
            "2026-08-04",
            manifest["research_cutoffs"]["configured_session_tool_selections"],
        )
        self.assertNotIn(
            "configured_session_advertised_names",
            manifest["research_cutoffs"],
        )
        self.assertEqual(24, len(manifest["product_references"]))
        self.assertEqual(24, len(set(manifest["product_references"])))
        for target in manifest["product_references"]:
            with self.subTest(target=target):
                self.assertTrue((SOURCE_MANIFEST.parent / target).is_file())

    def test_refreshed_product_field_contracts_remain_complete(self) -> None:
        for relative_path, markers in FIELD_CONTRACT_MARKERS.items():
            text = (ZOHO_DOCS / relative_path).read_text(encoding="utf-8")
            with self.subTest(relative_path=relative_path):
                expected_date = "2026-08-14" if relative_path.endswith("zoho-forms.md") else "2026-08-05"
                self.assertIn(expected_date, text)
                for marker in markers:
                    self.assertIn(marker, text)

    def test_retired_zoho_paths_do_not_remain_in_repository_text_locations(self) -> None:
        for old_path in OLD_PATHS:
            with self.subTest(old_path=old_path):
                self.assertFalse((ROOT / old_path).exists())

        for path in ROOT.rglob("*"):
            if (
                not path.is_file()
                or path.resolve() == Path(__file__).resolve()
                or path.suffix not in TEXT_SUFFIXES
                or any(part in SKIPPED_PARTS for part in path.parts)
            ):
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            for old_path in OLD_PATHS:
                with self.subTest(path=path, old_path=old_path):
                    self.assertNotIn(old_path, text)


if __name__ == "__main__":
    unittest.main()
