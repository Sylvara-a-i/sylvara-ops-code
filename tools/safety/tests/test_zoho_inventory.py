from __future__ import annotations

import hashlib
import json
import re
import unittest
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[3]
INVENTORY = (
    ROOT
    / "docs"
    / "zoho"
    / "mcp"
    / "snapshots"
    / "configured"
    / "2026-08-04"
    / "sylvara-observed-tool-inventory.json"
)
ZOHO_DOCS = ROOT / "docs" / "zoho"
CAPABILITY_CATALOG = INVENTORY.parent / "capability-catalog.md"
MCP_README = ZOHO_DOCS / "mcp" / "README.md"
SERVER_STANDARD = ZOHO_DOCS / "mcp" / "server-standard.md"
CRM_TOOL_MANUAL = (
    ZOHO_DOCS
    / "mcp"
    / "reference"
    / "zoho-crm-tool-manual-catalog-2026-08-14.md"
)
FREE_TEST_CRM_ALLOWLIST = (
    ZOHO_DOCS
    / "mcp"
    / "proposals"
    / "2026-08-14"
    / "sylvara-free-test-crm-mcp-allowlist.md"
)
CRM_TOOL_MANUAL_ACTION_ROWS_SHA256 = (
    "ad327f3e1ab8fee076ad9e2f5481427fa222673ee0a4e4890476251d00c498d1"
)

EXPECTED_COUNTS = {
    "billing-audit": (32, 32, 0),
    "billing-changes": (19, 6, 13),
    "books-audit": (40, 40, 0),
    "books-changes": (15, 9, 6),
    "books-controller": (32, 10, 22),
    "catalyst-audit": (13, 13, 0),
    "catalyst-break-glass": (5, 0, 5),
    "catalyst-release": (7, 0, 7),
    "creator-audit": (17, 17, 0),
    "creator-changes": (11, 5, 6),
    "crm-audit": (35, 35, 0),
    "crm-changes": (9, 5, 4),
    "mail-audit": (12, 12, 0),
    "mail-changes": (4, 2, 2),
    "payments-audit": (10, 10, 0),
    "payments-changes": (7, 3, 4),
    "workdrive-audit": (21, 21, 0),
    "workdrive-changes": (5, 1, 4),
}
EXPECTED_PRODUCTS = {
    "Zoho Billing",
    "Zoho Books",
    "Zoho Catalyst",
    "Zoho Creator",
    "Zoho CRM",
    "Zoho Mail",
    "Zoho Payments",
    "Zoho WorkDrive",
}
CAPABILITY_KEYS = {
    "catalog_id",
    "catalog_operation_key",
    "annotated_tool_name",
    "effect",
    "contract_status",
}
ROLE_KEYS = {
    "role",
    "product",
    "access_class",
    "observed_status",
    "read_count",
    "write_or_action_count",
    "tool_count",
    "capabilities",
}
FORBIDDEN_INVENTORY_KEYS = {
    "server_name",
    "source_namespace",
    "runtime_tool_id",
    "endpoint",
    "url",
    "headers",
    "auth",
    "token",
    "connection_name",
    "organization_id",
    "account_id",
    "project_id",
    "record_id",
    "advertised_tool_name",
    "operation_label",
}
SOURCE_IDENTITY_MARKERS = (
    "gh" + "_zoho",
    "gh" + "-zoho",
    "gh" + " real" + " estate",
    "zohomcp" + ".com",
    "mcp__codex" + "_apps__",
    "gh" + "booksaccountingaudit",
    "gh" + "booksbookkeepingchanges",
    "gh" + "bookscontroller",
    "gh" + "crmconfigurationaudit",
    "gh" + "crmconfigurationchanges",
    "gh" + "workdriveaudit",
    "gh" + "workdrivechanges",
    "gh" + "catalystwebhook",
)
INVENTORY_ONLY_MARKERS = SOURCE_IDENTITY_MARKERS + (
    "syl" + "vara_",
    "http" + "://",
    "https" + "://",
)
OFFICIAL_DOCUMENTATION_HOSTS = {
    "help.zoho.com",
    "docs.catalyst.zoho.com",
    "learn.chatgpt.com",
    "workdrive.zoho.com",
    "www.zoho.com",
}
URL_RE = re.compile(r"https?://[^\s)>]+")
OPERATION_KEY_RE = re.compile(r"^[A-Za-z0-9_-]+$")
SERVICE_PREFIX_RE = re.compile(r"(?:Zoho[A-Za-z0-9]+|CatalystbyZoho)_")


def annotate_operation_key(operation_key: str) -> str:
    with_spaces = operation_key.replace("_", " ")
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", with_spaces).strip()


def iter_keys(value: object):
    if isinstance(value, dict):
        for key, nested in value.items():
            yield key
            yield from iter_keys(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from iter_keys(nested)


class ZohoInventoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.raw = INVENTORY.read_text(encoding="utf-8")
        cls.catalog = json.loads(cls.raw)

    def test_snapshot_counts_scope_and_roles_are_exact(self) -> None:
        self.assertEqual(2, self.catalog["schema_version"])
        self.assertEqual("2026-08-04", self.catalog["observed_on"])
        self.assertEqual("2026-08-05", self.catalog["last_reconciled_on"])
        self.assertEqual("sylvara-only", self.catalog["scope"])
        self.assertEqual(294, self.catalog["total_tools"])
        self.assertEqual(221, self.catalog["read_tools"])
        self.assertEqual(73, self.catalog["write_or_action_tools"])
        self.assertEqual(
            257,
            self.catalog["unique_service_qualified_operation_keys"],
        )
        self.assertEqual(257, self.catalog["unique_annotated_tool_names"])
        self.assertEqual(
            254,
            self.catalog["unique_casefolded_annotated_tool_names"],
        )

        observed = {
            role["role"]: (
                role["tool_count"],
                role["read_count"],
                role["write_or_action_count"],
            )
            for role in self.catalog["roles"]
        }
        self.assertEqual(EXPECTED_COUNTS, observed)
        self.assertEqual(
            EXPECTED_PRODUCTS,
            {role["product"] for role in self.catalog["roles"]},
        )

    def test_historical_export_reconciliation_records_books_chart_account_gap(self) -> None:
        reconciliation = self.catalog["reconciliation"]
        self.assertEqual(
            "historical-export-no-configured-selection-delta",
            reconciliation["result"],
        )
        gap = reconciliation["historical_export_books_chart_account_gap"]
        self.assertEqual(
            {
                "get_chart_of_account",
                "list_chart_of_accounts",
                "list_chart_of_account_transactions",
            },
            set(gap["audit_operation_keys_selected_in_export"]),
        )
        self.assertEqual(
            {
                "create chart of account",
                "update chart of account",
                "mark chart account active",
                "mark chart account inactive",
            },
            set(gap["controller_capabilities_not_selected_in_export"]),
        )

    def test_schema_migration_is_recorded_without_changing_observation_date(self) -> None:
        self.assertEqual("2026-08-04", self.catalog["observed_on"])
        correction = self.catalog["publication_corrections"][-1]
        self.assertEqual("2026-08-06", correction["corrected_on"])
        self.assertIn("294", correction["scope"])
        self.assertTrue(correction["reason"])
        migration = correction["migration"]
        self.assertEqual(1, migration["from_schema_version"])
        self.assertEqual(2, migration["to_schema_version"])
        self.assertEqual(
            [
                {"from": "advertised_tool_name", "to": "catalog_operation_key"},
                {"from": "operation_label", "to": "annotated_tool_name"},
            ],
            migration["field_mappings"],
        )
        self.assertEqual(
            {"rows_compared": 294, "mismatch_count": 0},
            {
                key: migration["semantic_preservation"][key]
                for key in ("rows_compared", "mismatch_count")
            },
        )

    def test_possible_tool_surface_remains_reference_only(self) -> None:
        possible = self.catalog["official_possible_tool_surface"]
        self.assertEqual("2026-07-24", possible["snapshot_on"])
        self.assertEqual(8, possible["services"])
        self.assertEqual(3222, possible["tool_manual_rows"])
        self.assertEqual("reference", possible["evidence_status"])

    def test_human_catalog_role_summary_matches_machine_inventory(self) -> None:
        catalog_text = CAPABILITY_CATALOG.read_text(encoding="utf-8")
        for role, (total, read, action) in EXPECTED_COUNTS.items():
            with self.subTest(role=role):
                self.assertIn(
                    f"| `{role}` | {read} | {action} | {total} |",
                    catalog_text,
                )
        self.assertIn(
            "| **Total** | **221** | **73** | **294** |",
            catalog_text,
        )

    def test_dated_snapshot_refresh_is_append_only(self) -> None:
        index_text = MCP_README.read_text(encoding="utf-8")
        catalog_text = CAPABILITY_CATALOG.read_text(encoding="utf-8")
        for marker in (
            "`<evidence-class>/YYYY-MM-DD`",
            "creates a new dated directory",
            "never silently overwrites an older observation",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, index_text)
        self.assertIn("Create a new dated snapshot", catalog_text)
        self.assertNotIn("Replace this dated snapshot", catalog_text)

    def test_runtime_allowlist_is_distinct_from_configured_selection_key(self) -> None:
        standard_text = SERVER_STANDARD.read_text(encoding="utf-8")
        for marker in (
            "service plus its prefix-free catalog operation key",
            "`enabled_tools` allowlist",
            "exact currently advertised runtime tool name",
            "description and input schema",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, standard_text)

    def test_every_role_and_tool_is_complete_unique_and_role_qualified(self) -> None:
        self.assertEqual(
            list(EXPECTED_COUNTS),
            [role["role"] for role in self.catalog["roles"]],
        )
        rows: list[tuple[str, str, dict[str, object]]] = []

        for role in self.catalog["roles"]:
            self.assertEqual(ROLE_KEYS, set(role))
            capabilities = role["capabilities"]
            self.assertEqual(role["tool_count"], len(capabilities))
            self.assertEqual(
                role["read_count"],
                sum(row["effect"] == "read" for row in capabilities),
            )
            self.assertEqual(
                role["write_or_action_count"],
                sum(row["effect"] == "write/action" for row in capabilities),
            )
            self.assertEqual(
                [
                    f"{role['role']}-{index:03d}"
                    for index in range(1, role["tool_count"] + 1)
                ],
                [row["catalog_id"] for row in capabilities],
            )
            for row in capabilities:
                self.assertEqual(CAPABILITY_KEYS, set(row))
                operation_key = row["catalog_operation_key"]
                annotation = row["annotated_tool_name"]
                self.assertRegex(operation_key, OPERATION_KEY_RE)
                self.assertNotRegex(operation_key, SERVICE_PREFIX_RE)
                self.assertEqual(operation_key.strip(), operation_key)
                self.assertTrue(annotation)
                self.assertEqual(annotation.strip(), annotation)
                self.assertNotIn("_", annotation)
                self.assertNotRegex(annotation, SERVICE_PREFIX_RE)
                self.assertEqual(annotate_operation_key(operation_key), annotation)
                self.assertIn(row["effect"], {"read", "write/action"})
                self.assertEqual(
                    "configured-selection-not-call-verified",
                    row["contract_status"],
                )
                rows.append((role["role"], role["product"], row))

        self.assertEqual(294, len(rows))
        self.assertEqual(
            294,
            len(
                {
                    (role, row["catalog_operation_key"])
                    for role, _, row in rows
                }
            ),
        )
        self.assertEqual(
            257,
            len(
                {
                    (product, row["catalog_operation_key"])
                    for _, product, row in rows
                }
            ),
        )
        self.assertEqual(
            257,
            len({row["annotated_tool_name"] for _, _, row in rows}),
        )
        self.assertEqual(
            254,
            len(
                {
                    row["annotated_tool_name"].casefold()
                    for _, _, row in rows
                }
            ),
        )
        self.assertEqual(
            self.catalog["read_tools"],
            sum(row["effect"] == "read" for _, _, row in rows),
        )
        self.assertEqual(
            self.catalog["write_or_action_tools"],
            sum(row["effect"] == "write/action" for _, _, row in rows),
        )

    def test_audit_roles_are_read_only(self) -> None:
        for role in self.catalog["roles"]:
            if role["role"].endswith("-audit"):
                with self.subTest(role=role["role"]):
                    self.assertEqual("read-only", role["access_class"])
                    self.assertEqual(0, role["write_or_action_count"])

    def test_public_snapshot_excludes_private_runtime_configuration(self) -> None:
        lowered = self.raw.lower()
        self.assertNotRegex(self.raw, SERVICE_PREFIX_RE)
        for marker in INVENTORY_ONLY_MARKERS:
            with self.subTest(marker=marker):
                self.assertNotIn(marker, lowered)
        self.assertTrue(
            FORBIDDEN_INVENTORY_KEYS.isdisjoint(iter_keys(self.catalog))
        )

    def test_zoho_docs_use_sanitized_identity_and_official_urls(self) -> None:
        for path in ZOHO_DOCS.rglob("*"):
            if not path.is_file() or path.suffix not in {".json", ".md"}:
                continue
            text = path.read_text(encoding="utf-8")
            lowered = text.lower()
            for marker in SOURCE_IDENTITY_MARKERS:
                with self.subTest(path=path, marker=marker):
                    self.assertNotIn(marker, lowered)
            for url in URL_RE.findall(text):
                host = (urlparse(url).hostname or "").lower()
                with self.subTest(path=path, url=url):
                    self.assertIn(host, OFFICIAL_DOCUMENTATION_HOSTS)

    def test_crm_tool_manual_and_free_test_allowlist_are_complete(self) -> None:
        catalog = CRM_TOOL_MANUAL.read_text(encoding="utf-8")
        rows = re.findall(
            r"^\*\*([A-Za-z0-9_-]+)\*\*\s+(.+)$",
            catalog,
            flags=re.MULTILINE,
        )
        names = {name for name, _ in rows}

        self.assertEqual(1291, len(rows))
        self.assertEqual(1291, len(names))
        self.assertTrue(all(description.strip() for _, description in rows))
        normalized_rows = "\n".join(
            line
            for line in catalog.splitlines()
            if re.match(r"^\*\*[A-Za-z0-9_-]+\*\*\s+.", line)
        ) + "\n"
        self.assertEqual(
            CRM_TOOL_MANUAL_ACTION_ROWS_SHA256,
            hashlib.sha256(normalized_rows.encode("utf-8")).hexdigest(),
        )

        x_aliases = {name for name in names if name.startswith("x")}
        self.assertEqual(80, len(x_aliases))
        self.assertTrue(all(name[1:] in names for name in x_aliases))
        self.assertIn("getUnassignedUsers", names)
        self.assertIn("getUnAssignedUsers", names)
        self.assertIn("Associated Users' Count", catalog)

        required_catalog_actions = {
            "postBlueprint",
            "createBlueprintStates",
            "createBlueprintTransitions",
            "activateBlueprint",
            "postWorkflowRule",
            "createWorkflowTasks",
            "createFieldUpdates",
            "createFunctions",
            "postAutomationFunctions",
            "createCustomButton",
            "getLeadConversionOptions",
            "convertLead",
            "createRecords",
            "updateRecord",
        }
        self.assertTrue(required_catalog_actions.issubset(names))

        allowlist = FREE_TEST_CRM_ALLOWLIST.read_text(encoding="utf-8")
        for action in required_catalog_actions:
            with self.subTest(action=action):
                self.assertIn(f"`{action}`", allowlist)


if __name__ == "__main__":
    unittest.main()
