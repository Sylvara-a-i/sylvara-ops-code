from __future__ import annotations

import json
import re
import unittest
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
CATALOG = (
    ROOT
    / "docs"
    / "zoho"
    / "mcp"
    / "reference"
    / "tool-manual-tool-catalog-2026-08-05.json"
)
SERVICE_CATALOG = CATALOG.with_name(
    "tool-manual-service-catalog-2026-08-05.md"
)

SERVICE_KEYS = {
    "section",
    "service",
    "tool_row_count",
    "unique_operation_key_count",
    "tools",
}
TOOL_KEYS = {
    "source_row",
    "operation_key",
    "annotated_tool_name",
}
FORBIDDEN_KEYS = {
    "purpose",
    "description",
    "parameters",
    "input_schema",
    "response_schema",
    "endpoint",
    "scopes",
    "example",
    "account_id",
    "organization_id",
    "server_name",
    "runtime_tool_id",
}
SERVICE_PREFIX_RE = re.compile(r"(?:Zoho[A-Za-z0-9]+|CatalystbyZoho)_")
OPERATION_KEY_RE = re.compile(r"^[A-Za-z0-9_-]+$")
EXPECTED_DUPLICATE_KEYS = {
    "Cancel_Build",
    "Create_CORS_Domain",
    "Create_Env_Variables",
    "Create_Pipeline",
    "Delete_CORS_Domain",
    "Delete_Pipeline",
    "Enable_Authentication",
    "Get_Browser_Grid",
    "Get_Deployment",
    "Get_Slate_App",
    "Lead_Enrichment",
    "List_All_Browser_Grids",
    "List_All_CORS_Domains",
    "List_All_Deployments",
    "List_All_Env_Variables",
    "List_All_Slate_Apps",
    "Redeploy_a_deployment",
    "Rollback_Build",
    "Similar_Companies",
    "Stop_BrowserGrid",
    "Tech_Stack_Finder",
    "Update_CORS_Domain",
    "Update_Pipeline",
}


def annotate_operation_key(service: str, operation_key: str) -> str:
    service_prefix = re.sub(r"[^A-Za-z0-9]", "", service) + "_"
    unqualified_key = operation_key.removeprefix(service_prefix)
    with_spaces = unqualified_key.replace("_", " ")
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", with_spaces).strip()


def iter_keys(value: object):
    if isinstance(value, dict):
        for key, nested in value.items():
            yield key
            yield from iter_keys(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from iter_keys(nested)


class ZohoToolCatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.raw = CATALOG.read_text(encoding="utf-8")
        cls.catalog = json.loads(cls.raw)

    def test_catalog_scope_counts_and_provenance_are_exact(self) -> None:
        self.assertEqual(1, self.catalog["schema_version"])
        self.assertEqual("2026-08-05", self.catalog["observed_on"])
        self.assertEqual("reference", self.catalog["classification"])
        self.assertEqual("tool-manual-catalog", self.catalog["evidence_layer"])
        self.assertEqual(
            "public-service-qualified-tool-names-only",
            self.catalog["scope"],
        )
        self.assertEqual(61, self.catalog["service_count"])
        self.assertEqual(10817, self.catalog["tool_row_count"])
        self.assertEqual(
            10794,
            self.catalog["unique_service_qualified_operation_keys"],
        )
        self.assertEqual(
            [
                {
                    "section": "zoho",
                    "service_count": 52,
                    "tool_row_count": 9851,
                },
                {
                    "section": "beyond-zoho",
                    "service_count": 9,
                    "tool_row_count": 966,
                },
            ],
            self.catalog["sections"],
        )
        self.assertEqual(
            self.catalog["tool_row_count"],
            self.catalog["source"]["displayed_home_tool_count"],
        )
        self.assertEqual(
            self.catalog["tool_row_count"],
            self.catalog["source"]["rendered_tool_row_count"],
        )

    def test_every_rendered_row_has_an_exact_prefix_free_annotation(self) -> None:
        self.assertEqual(
            self.catalog["service_count"],
            len(self.catalog["services"]),
        )
        total_rows = 0
        total_unique = 0

        for service in self.catalog["services"]:
            self.assertEqual(SERVICE_KEYS, set(service))
            rows = service["tools"]
            self.assertEqual(service["tool_row_count"], len(rows))
            self.assertEqual(
                list(range(1, len(rows) + 1)),
                [row["source_row"] for row in rows],
            )

            operation_keys: list[str] = []
            for row in rows:
                self.assertEqual(TOOL_KEYS, set(row))
                operation_key = row["operation_key"]
                annotation = row["annotated_tool_name"]
                self.assertRegex(operation_key, OPERATION_KEY_RE)
                self.assertEqual(operation_key.strip(), operation_key)
                self.assertTrue(annotation)
                self.assertEqual(annotation.strip(), annotation)
                self.assertNotIn("_", annotation)
                self.assertNotRegex(annotation, SERVICE_PREFIX_RE)
                self.assertEqual(
                    annotate_operation_key(service["service"], operation_key),
                    annotation,
                )
                self.assertFalse(
                    annotation.casefold().startswith(
                        service["service"].casefold() + " "
                    )
                )
                operation_keys.append(operation_key)

            unique_count = len(set(operation_keys))
            self.assertEqual(
                service["unique_operation_key_count"],
                unique_count,
            )
            total_rows += len(rows)
            total_unique += unique_count

        self.assertEqual(self.catalog["tool_row_count"], total_rows)
        self.assertEqual(
            self.catalog["unique_service_qualified_operation_keys"],
            total_unique,
        )

    def test_only_documented_catalyst_rows_are_duplicated(self) -> None:
        duplicate_services: dict[str, dict[str, int]] = {}
        for service in self.catalog["services"]:
            counts = Counter(row["operation_key"] for row in service["tools"])
            duplicates = {key: count for key, count in counts.items() if count > 1}
            if duplicates:
                duplicate_services[service["service"]] = duplicates

        self.assertEqual({"Catalyst by Zoho"}, set(duplicate_services))
        catalyst_duplicates = duplicate_services["Catalyst by Zoho"]
        self.assertEqual(EXPECTED_DUPLICATE_KEYS, set(catalyst_duplicates))
        self.assertEqual({2}, set(catalyst_duplicates.values()))

    def test_expected_books_annotation_is_documented_without_prefix(self) -> None:
        books = next(
            service
            for service in self.catalog["services"]
            if service["service"] == "Zoho Books"
        )
        vendor_credits = next(
            row
            for row in books["tools"]
            if row["operation_key"] == "list_vendor_credits"
        )
        self.assertEqual("list vendor credits", vendor_credits["annotated_tool_name"])

    def test_catalog_is_names_only_and_stays_below_scanner_limit(self) -> None:
        self.assertLess(CATALOG.stat().st_size, 2 * 1024 * 1024)
        self.assertTrue(FORBIDDEN_KEYS.isdisjoint(iter_keys(self.catalog)))

    def test_human_service_catalog_matches_machine_totals(self) -> None:
        text = SERVICE_CATALOG.read_text(encoding="utf-8")
        self.assertIn(
            "**61 services / 10,817 rendered rows / "
            "10,794 unique service-qualified operation keys**",
            text,
        )
        for service in self.catalog["services"]:
            with self.subTest(service=service["service"]):
                self.assertIn(
                    f"| {service['service']} | "
                    f"{service['tool_row_count']:,} | "
                    f"{service['unique_operation_key_count']:,} |",
                    text,
                )


if __name__ == "__main__":
    unittest.main()
