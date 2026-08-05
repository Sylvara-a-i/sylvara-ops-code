from __future__ import annotations

import csv
import hashlib
import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
REFERENCE_ROOT = ROOT / "src" / "zoho-books" / "reference"
REGISTER_PATH = REFERENCE_ROOT / "final-chart-of-accounts-tax-preparer-2026-08-05.csv"
SCHEDULE_C_PATH = REFERENCE_ROOT / "schedule-c-tax-rollup-2026-08-05.csv"
HANDOFF_PATH = REFERENCE_ROOT / "tax-preparer-handoff-2026-08-05.md"
DEPLOYMENT_LOG_PATH = ROOT / "docs" / "runbooks" / "deployment-log.md"

EXPECTED_COLUMNS = [
    "Management Reference",
    "Live Zoho Code",
    "Account Name",
    "Zoho Account Type",
    "Status",
    "Parent Account",
    "Account Origin",
    "Live Zoho Description",
    "Governed Brief Description",
    "Posting Control",
    "Federal Tax Preparer Rollup",
    "Kansas Handoff",
    "Management Reporting Group",
]
LIVE_METADATA_COLUMNS = [
    "Live Zoho Code",
    "Account Name",
    "Zoho Account Type",
    "Status",
    "Parent Account",
    "Account Origin",
    "Live Zoho Description",
]
LIVE_METADATA_SHA256 = "4217410201cd1101e09b5e4249cb1e237a99c564fa63cf0cbb3dc2afc38e9fb3"
P_AND_L_TYPES = {"income", "expense", "cost_of_goods_sold", "other_expense"}
SCHEDULE_C_TYPE_BY_LIVE_TYPE = {
    "income": "Income",
    "expense": "Expense",
    "cost_of_goods_sold": "Cost Of Goods Sold",
    "other_expense": "Other Expense",
}
SEEDED_LOCKED_ACCOUNTS = {
    "Furniture and Equipment",
    "Lodging",
    "Salaries and Employee Wages",
}
DIRECT_SERVICE_COSTS = {
    "AI Model and Automation Usage",
    "Direct Hosting and Integration Costs",
    "Direct Customer Software and Licenses",
    "Voice and Telephony Usage",
    "Direct Service Contractors",
    "Contract Human Escalation and Quality Assurance",
    "Contract Implementation Labor",
}


class ZohoTaxPreparerChartTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with REGISTER_PATH.open(encoding="utf-8", newline="") as source:
            reader = csv.DictReader(source)
            cls.columns = reader.fieldnames
            cls.rows = list(reader)
        cls.by_name = {row["Account Name"]: row for row in cls.rows}

        with SCHEDULE_C_PATH.open(encoding="utf-8", newline="") as source:
            cls.schedule_rows = list(csv.DictReader(source))
        cls.schedule_by_name = {row["Account Name"]: row for row in cls.schedule_rows}

    def test_schema_counts_required_fields_and_uniqueness(self) -> None:
        self.assertEqual(EXPECTED_COLUMNS, self.columns)
        self.assertEqual(94, len(self.rows))
        self.assertEqual(83, sum(row["Status"] == "Active" for row in self.rows))
        self.assertEqual(11, sum(row["Status"] == "Inactive" for row in self.rows))
        self.assertEqual(len(self.rows), len(self.by_name))

        references = [row["Management Reference"] for row in self.rows]
        self.assertEqual(len(references), len(set(references)))
        for row in self.rows:
            for column in EXPECTED_COLUMNS:
                if column not in {"Live Zoho Code", "Parent Account"}:
                    self.assertTrue(row[column].strip(), f"Missing {column}: {row}")

    def test_live_codes_and_documentation_references_are_distinct(self) -> None:
        blank_live_codes = [row for row in self.rows if not row["Live Zoho Code"]]
        self.assertEqual(28, len(blank_live_codes))
        for row in self.rows:
            if row["Live Zoho Code"]:
                self.assertEqual(row["Live Zoho Code"], row["Management Reference"])

        actual_seeded = {
            row["Account Name"]
            for row in self.rows
            if row["Account Origin"] == "Zoho seeded locked"
        }
        self.assertEqual(SEEDED_LOCKED_ACCOUNTS, actual_seeded)
        for row in self.rows:
            if row["Account Origin"] == "Sylvara custom":
                self.assertTrue(row["Live Zoho Code"], row["Account Name"])

    def test_live_metadata_snapshot_is_frozen(self) -> None:
        canonical = [
            {column: row[column] for column in LIVE_METADATA_COLUMNS}
            for row in sorted(self.rows, key=lambda item: item["Account Name"])
        ]
        content = json.dumps(
            canonical, ensure_ascii=False, separators=(",", ":")
        ).encode()
        self.assertEqual(LIVE_METADATA_SHA256, hashlib.sha256(content).hexdigest())

        handoff = HANDOFF_PATH.read_text(encoding="utf-8")
        self.assertIn(LIVE_METADATA_SHA256, handoff)

    def test_parent_references_resolve_types_match_and_hierarchy_is_shallow(self) -> None:
        for row in self.rows:
            parent = row["Parent Account"]
            if parent:
                with self.subTest(account=row["Account Name"]):
                    self.assertIn(parent, self.by_name)
                    self.assertEqual(
                        row["Zoho Account Type"], self.by_name[parent]["Zoho Account Type"]
                    )

        for account_name in self.by_name:
            current = account_name
            visited: set[str] = set()
            depth = 0
            while current:
                self.assertNotIn(current, visited, f"Hierarchy cycle at {current}")
                visited.add(current)
                parent = self.by_name[current]["Parent Account"]
                if not parent:
                    break
                depth += 1
                self.assertLessEqual(depth, 2, account_name)
                current = parent

    def test_active_p_and_l_exactly_matches_schedule_c_successor(self) -> None:
        active_p_and_l = {
            row["Account Name"]: row
            for row in self.rows
            if row["Status"] == "Active" and row["Zoho Account Type"] in P_AND_L_TYPES
        }
        self.assertEqual(59, len(active_p_and_l))
        legacy_schedule_names = set(self.schedule_by_name)
        legacy_schedule_names.remove("Cost of Goods Sold")
        legacy_schedule_names.add("Cost Of Goods Sold")
        self.assertEqual(set(active_p_and_l), legacy_schedule_names)

        for name, row in active_p_and_l.items():
            with self.subTest(account=name):
                schedule_name = "Cost of Goods Sold" if name == "Cost Of Goods Sold" else name
                schedule_row = self.schedule_by_name[schedule_name]
                self.assertEqual(
                    row["Management Reference"],
                    schedule_row["Zoho Code or Management Reference"],
                )
                self.assertEqual(
                    SCHEDULE_C_TYPE_BY_LIVE_TYPE[row["Zoho Account Type"]],
                    schedule_row["Account Type"],
                )
                self.assertEqual(row["Parent Account"], schedule_row["Parent Account"])

        active_balance_and_controls = [
            row
            for row in self.rows
            if row["Status"] == "Active" and row["Zoho Account Type"] not in P_AND_L_TYPES
        ]
        self.assertEqual(24, len(active_balance_and_controls))

    def test_service_delivery_costs_are_expenses_not_tax_cogs(self) -> None:
        cogs = self.by_name["Cost Of Goods Sold"]
        self.assertEqual("cost_of_goods_sold", cogs["Zoho Account Type"])
        self.assertEqual("Zoho system locked", cogs["Account Origin"])
        self.assertIn("No-post", cogs["Posting Control"])

        for name in DIRECT_SERVICE_COSTS:
            with self.subTest(account=name):
                row = self.by_name[name]
                self.assertEqual("expense", row["Zoho Account Type"])
                self.assertNotEqual("Cost Of Goods Sold", row["Parent Account"])
                self.assertEqual(
                    "Direct Service Delivery Costs", row["Management Reporting Group"]
                )

        for name in (
            "AI Model and Automation Usage",
            "Direct Hosting and Integration Costs",
            "Direct Customer Software and Licenses",
        ):
            self.assertIn("not COGS", self.by_name[name]["Federal Tax Preparer Rollup"])

        telephony = self.by_name["Voice and Telephony Usage"]
        self.assertIn("PSTN/SIP", telephony["Governed Brief Description"])
        self.assertIn("AI runtime", telephony["Posting Control"])

    def test_tax_preparer_handoff_covers_required_decisions(self) -> None:
        handoff = HANDOFF_PATH.read_text(encoding="utf-8")
        for required_text in (
            "83 active and 11 inactive",
            "Customer Usage Is Expense, Not Tax COGS",
            "2025 Schedule C Crosswalk",
            "Conditional Account Catalog",
            "Live Zoho is configured accrual",
            "Kansas answering-service sales tax",
            "Johnson County property",
            "H&R Block / Tax-Professional Package",
            "principal-business code",
            "561420",
            "candidate, not an adopted conclusion",
            "Domestic Software Development and R&E - Tax Review",
            "Foreign Software Development and R&E - Tax Review",
            "Usage and Overage Revenue",
            "Do not place populated returns",
        ):
            with self.subTest(required_text=required_text):
                self.assertIn(required_text, handoff)

        for line in (
            "Line 1, gross receipts or sales",
            "Line 9, car and truck",
            "Line 10, commissions and fees",
            "Line 13, depreciation and section 179",
            "Line 24b, deductible meals",
            "Line 27b, other expenses",
            "Line 30, business use of home",
        ):
            self.assertIn(line, handoff)

    def test_register_is_not_ignored(self) -> None:
        relative_path = REGISTER_PATH.relative_to(ROOT).as_posix()
        ignored = subprocess.run(
            ["git", "check-ignore", "-q", "--no-index", "--", relative_path],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(0, ignored.returncode, "Final register is ignored")

    def test_live_description_change_has_rollback_and_independent_readback(self) -> None:
        log = DEPLOYMENT_LOG_PATH.read_text(encoding="utf-8")
        register_digest = hashlib.sha256(REGISTER_PATH.read_bytes()).hexdigest()
        for expected in (
            "Zoho Books Tax-Preparer Description Correction",
            register_digest,
            "update five descriptions",
            "all 83 active accounts and all five descriptions matched",
            "exact prior descriptions captured privately",
            "no name, code, type, parent, status, balance, transaction, tax setting",
        ):
            self.assertIn(expected, log)

    def test_public_register_excludes_private_financial_fields(self) -> None:
        prohibited_columns = {
            "Account ID",
            "Balance",
            "Organization ID",
            "Transaction ID",
            "Tax ID",
            "Bank Account Number",
        }
        self.assertFalse(prohibited_columns & set(self.columns or []))
        combined = "\n".join(",".join(row.values()) for row in self.rows).lower()
        for marker in ("organization_id", "account_id", "transaction_id"):
            self.assertNotIn(marker, combined)


if __name__ == "__main__":
    unittest.main()
