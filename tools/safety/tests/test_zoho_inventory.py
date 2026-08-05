from __future__ import annotations

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
    "advertised_tool_name",
    "operation_label",
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
TOOL_NAME_RE = re.compile(
    r"^(?:"
    r"Zoho(?:Billing|Books|Creator|CRM|Mail|Payments|Workdrive)_[A-Za-z0-9_]+"
    r"|CatalystbyZoho_[A-Za-z0-9_]+"
    r")$"
)


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
        self.assertEqual(1, self.catalog["schema_version"])
        self.assertEqual("2026-08-04", self.catalog["observed_on"])
        self.assertEqual("sylvara-only", self.catalog["scope"])
        self.assertEqual(294, self.catalog["total_tools"])
        self.assertEqual(221, self.catalog["read_tools"])
        self.assertEqual(73, self.catalog["write_or_action_tools"])
        self.assertEqual(257, self.catalog["unique_unqualified_tool_names"])

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

    def test_every_role_and_tool_is_complete_unique_and_role_qualified(self) -> None:
        self.assertEqual(
            list(EXPECTED_COUNTS),
            [role["role"] for role in self.catalog["roles"]],
        )
        rows: list[tuple[str, dict[str, object]]] = []

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
                self.assertRegex(row["advertised_tool_name"], TOOL_NAME_RE)
                self.assertNotIn(".", row["advertised_tool_name"])
                self.assertTrue(row["operation_label"].strip())
                self.assertIn(row["effect"], {"read", "write/action"})
                self.assertEqual(
                    "advertised-not-call-verified",
                    row["contract_status"],
                )
                rows.append((role["role"], row))

        self.assertEqual(294, len(rows))
        self.assertEqual(
            294,
            len(
                {
                    (role, row["advertised_tool_name"])
                    for role, row in rows
                }
            ),
        )
        self.assertEqual(
            257,
            len({row["advertised_tool_name"] for _, row in rows}),
        )
        self.assertEqual(
            self.catalog["read_tools"],
            sum(row["effect"] == "read" for _, row in rows),
        )
        self.assertEqual(
            self.catalog["write_or_action_tools"],
            sum(row["effect"] == "write/action" for _, row in rows),
        )

    def test_audit_roles_are_read_only(self) -> None:
        for role in self.catalog["roles"]:
            if role["role"].endswith("-audit"):
                with self.subTest(role=role["role"]):
                    self.assertEqual("read-only", role["access_class"])
                    self.assertEqual(0, role["write_or_action_count"])

    def test_public_snapshot_excludes_private_runtime_configuration(self) -> None:
        lowered = self.raw.lower()
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


if __name__ == "__main__":
    unittest.main()
