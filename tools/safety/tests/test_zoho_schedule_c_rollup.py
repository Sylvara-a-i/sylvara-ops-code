from __future__ import annotations

import csv
import hashlib
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
REFERENCE_ROOT = ROOT / "src" / "zoho-books" / "reference"
REGISTER_PATH = REFERENCE_ROOT / "schedule-c-tax-rollup-2026-08-05.csv"
PLAN_PATH = REFERENCE_ROOT / "chart-of-accounts-schedule-c-change-plan-2026-08-05.md"
DEPLOYMENT_LOG_PATH = ROOT / "docs" / "runbooks" / "deployment-log.md"
POSTING_GUIDE_PATH = (
    REFERENCE_ROOT / "chart-of-accounts-post-deployment-posting-guide-2026-08-05.md"
)

EXPECTED_COLUMNS = [
    "Zoho Code or Management Reference",
    "Account Name",
    "Account Type",
    "Parent Account",
    "Brief Description",
    "Federal Tax Rollup",
    "Live Treatment",
    "Control",
]

EDITABLE_TAX_PARENTS = {
    "Advertising",
    "Contract Labor",
    "Deductible Meals",
    "Insurance (Other Than Health)",
    "Legal and Professional Services",
    "Office Expense",
    "Taxes and Licenses",
    "Travel",
    "Utilities",
}


class ZohoScheduleCRollupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with REGISTER_PATH.open(encoding="utf-8", newline="") as source:
            reader = csv.DictReader(source)
            cls.columns = reader.fieldnames
            cls.rows = list(reader)
        cls.by_name = {row["Account Name"]: row for row in cls.rows}

    def test_schema_required_fields_and_uniqueness(self) -> None:
        self.assertEqual(EXPECTED_COLUMNS, self.columns)
        self.assertEqual(59, len(self.rows))
        self.assertEqual(len(self.rows), len(self.by_name))
        codes = [row["Zoho Code or Management Reference"] for row in self.rows]
        self.assertEqual(len(codes), len(set(codes)))
        for row in self.rows:
            for column in EXPECTED_COLUMNS:
                if column != "Parent Account":
                    self.assertTrue(row[column].strip(), f"Missing {column}: {row}")

    def test_all_parent_references_resolve_and_types_match(self) -> None:
        for row in self.rows:
            parent = row["Parent Account"]
            if not parent:
                continue
            with self.subTest(account=row["Account Name"]):
                self.assertIn(parent, self.by_name)
                self.assertEqual(row["Account Type"], self.by_name[parent]["Account Type"])

    def test_hierarchy_is_acyclic_and_no_deeper_than_two_levels(self) -> None:
        for account_name in self.by_name:
            with self.subTest(account=account_name):
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
                    self.assertLessEqual(depth, 2, f"Hierarchy too deep at {account_name}")
                    current = parent

    def test_editable_tax_parents_are_roots(self) -> None:
        for name in EDITABLE_TAX_PARENTS:
            with self.subTest(parent=name):
                self.assertIn(name, self.by_name)
                self.assertEqual("", self.by_name[name]["Parent Account"])
                self.assertIn("Schedule C line", self.by_name[name]["Federal Tax Rollup"])

    def test_balance_sheet_accounts_are_not_in_tax_rollup_register(self) -> None:
        prohibited_types = {
            "Bank",
            "Cash",
            "Accounts Receivable",
            "Accounts Payable",
            "Equity",
            "Other Current Asset",
            "Other Current Liability",
        }
        self.assertFalse(prohibited_types & {row["Account Type"] for row in self.rows})

    def test_cost_of_goods_sold_is_restricted(self) -> None:
        cogs = self.by_name["Cost of Goods Sold"]
        self.assertIn("no-post", cogs["Live Treatment"])
        for name in (
            "Voice and Telephony Usage",
            "AI Model and Automation Usage",
            "Direct Hosting and Integration Costs",
            "Direct Customer Software and Licenses",
            "Direct Service Contractors",
            "Contract Human Escalation and Quality Assurance",
            "Contract Implementation Labor",
        ):
            self.assertNotEqual("Cost of Goods Sold", self.by_name[name]["Parent Account"])

    def test_plan_freezes_register_and_exact_scope(self) -> None:
        plan = PLAN_PATH.read_text(encoding="utf-8")
        digest = hashlib.sha256(REGISTER_PATH.read_bytes()).hexdigest()
        self.assertIn(digest, plan)
        self.assertIn("Exact Create Scope - 4 Accounts", plan)
        self.assertIn("Exact Existing-Account Update Scope - 18 Accounts", plan)
        self.assertIn("83 active and 11 inactive", plan)
        self.assertIn("No system account is renamed", plan)
        self.assertIn("Delete is not authorized", plan)
        self.assertIn("draft marked not for filing", plan)
        self.assertIn("## Execution Result", plan)
        self.assertIn("68 prior accounts retained", plan)

    def test_successor_register_is_tracked_and_not_ignored(self) -> None:
        relative_path = REGISTER_PATH.relative_to(ROOT).as_posix()
        tracked = subprocess.run(
            ["git", "ls-files", "--error-unmatch", "--", relative_path],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(0, tracked.returncode, tracked.stderr)

        ignored = subprocess.run(
            ["git", "check-ignore", "-q", "--no-index", "--", relative_path],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(0, ignored.returncode, "Successor register is ignored")

    def test_posting_guide_uses_deployed_schedule_c_codes_and_names(self) -> None:
        guide = POSTING_GUIDE_PATH.read_text(encoding="utf-8")
        referenced_accounts = {
            "6300": "Contract Labor",
            "6450": "Utilities",
            "6451": "Internet",
            "6452": "Phone",
            "6453": "Voice and Telephony Usage",
            "6500": "Travel",
            "6510": "Business Lodging",
            "6540": "Deductible Meals",
            "6550": "Business Meals - Tax Review",
            "6700": "Taxes and Licenses",
            "6710": "Licenses Registrations and Filing Fees",
            "6930": "Business Gifts - Section 274 Review",
        }
        for code, name in referenced_accounts.items():
            with self.subTest(account=name):
                self.assertIn(name, self.by_name)
                self.assertEqual(code, self.by_name[name]["Zoho Code or Management Reference"])
                self.assertIn(f"`{code} {name}`", guide)

        for stale_reference in (
            "Taxes Licenses and Compliance",
            "`6430 Internet`",
            "`6440 Phone`",
            "Business Meals - Tax Review` under `6500 Travel",
        ):
            with self.subTest(stale_reference=stale_reference):
                self.assertNotIn(stale_reference, guide)
        self.assertIn("Record the full actual qualifying business-meal cost", guide)

    def test_deployment_log_records_final_independent_readback(self) -> None:
        log = DEPLOYMENT_LOG_PATH.read_text(encoding="utf-8")
        self.assertIn("Zoho Books Schedule C Hierarchy Amendment", log)
        self.assertIn("create four accounts and update 18 existing", log)
        self.assertIn("final chart contained 83 active and 11 inactive", log)
        self.assertIn("Internet code field", log)


if __name__ == "__main__":
    unittest.main()
