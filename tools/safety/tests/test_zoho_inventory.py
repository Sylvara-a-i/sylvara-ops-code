from __future__ import annotations

import json
import re
import unittest
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[3]
INVENTORY = ROOT / "docs" / "zoho" / "mcp" / "observed-tool-inventory.json"
ZOHO_DOCS = ROOT / "docs" / "zoho"

EXPECTED_COUNTS = {
    "books-audit": (168, 168, 0),
    "books-bookkeeping": (63, 7, 56),
    "books-controller": (65, 1, 64),
    "catalyst-audit": (15, 15, 0),
    "catalyst-break-glass": (5, 0, 5),
    "catalyst-release": (7, 0, 7),
    "crm-audit": (19, 19, 0),
    "crm-changes": (27, 8, 19),
    "workdrive-audit": (21, 21, 0),
    "workdrive-changes": (13, 6, 7),
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


class ZohoInventoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.raw = INVENTORY.read_text(encoding="utf-8")
        cls.catalog = json.loads(cls.raw)

    def test_snapshot_counts_and_roles_are_exact(self) -> None:
        self.assertEqual(1, self.catalog["schema_version"])
        self.assertEqual("2026-08-03", self.catalog["observed_on"])
        self.assertEqual(403, self.catalog["total_tools"])
        self.assertEqual(245, self.catalog["read_tools"])
        self.assertEqual(158, self.catalog["write_or_action_tools"])

        observed = {
            role["role"]: (
                role["tool_count"],
                role["read_count"],
                role["write_or_action_count"],
            )
            for role in self.catalog["roles"]
        }
        self.assertEqual(EXPECTED_COUNTS, observed)

    def test_every_tool_is_unique_and_explicitly_untyped(self) -> None:
        for role in self.catalog["roles"]:
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
            expected_ids = [
                f"{role['role']}-{index:03d}"
                for index in range(1, role["tool_count"] + 1)
            ]
            self.assertEqual(
                expected_ids,
                [row["catalog_id"] for row in capabilities],
            )

        rows = [
            (role["role"], row)
            for role in self.catalog["roles"]
            for row in role["capabilities"]
        ]
        self.assertEqual(403, len(rows))
        self.assertEqual(
            self.catalog["read_tools"],
            sum(row["effect"] == "read" for _, row in rows),
        )
        self.assertEqual(
            self.catalog["write_or_action_tools"],
            sum(row["effect"] == "write/action" for _, row in rows),
        )
        self.assertEqual(403, len({row["catalog_id"] for _, row in rows}))
        self.assertEqual(
            403,
            len({(role, row["observed_tool_id"]) for role, row in rows}),
        )
        self.assertTrue(
            all(row["response_typed"] is False for _, row in rows)
        )
        self.assertTrue(
            all(
                row["effect"] in {"read", "write/action"}
                for _, row in rows
            )
        )
        self.assertTrue(all(row["summary"].strip() for _, row in rows))

    def test_public_snapshot_excludes_source_identity_and_endpoints(self) -> None:
        lowered = self.raw.lower()
        for marker in INVENTORY_ONLY_MARKERS:
            with self.subTest(marker=marker):
                self.assertNotIn(marker, lowered)
        self.assertNotIn('"server_name"', self.raw)
        self.assertNotIn('"organization_id"', self.raw)

    def test_zoho_docs_use_only_sanitized_identity_and_official_urls(self) -> None:
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
