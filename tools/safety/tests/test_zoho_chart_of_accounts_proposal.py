from __future__ import annotations

import csv
import hashlib
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
REFERENCE_ROOT = ROOT / "src" / "zoho-books" / "reference"
PROPOSAL_PATH = REFERENCE_ROOT / "proposed-chart-of-accounts.csv"
AUDIT_PATH = REFERENCE_ROOT / "chart-of-accounts-audit-2026-08-05.md"
PHASE_ONE_PATH = REFERENCE_ROOT / "chart-of-accounts-phase-1-change-plan-2026-08-05.md"
POSTING_GUIDE_PATH = (
    REFERENCE_ROOT / "chart-of-accounts-post-deployment-posting-guide-2026-08-05.md"
)
DEPLOYMENT_LOG_PATH = ROOT / "docs" / "runbooks" / "deployment-log.md"

EXPECTED_COLUMNS = [
    "Target Code",
    "Account Name",
    "Account Type",
    "Parent Account",
    "Brief Description",
    "Deployment Status",
    "Source or Migration",
    "Review Gate",
]
PROTECTED_CONTROLS = {
    "Accounts Payable",
    "Accounts Receivable",
    "Opening Balance Adjustments",
    "Opening Balance Offset",
    "Retained Earnings",
    "Sales",
    "Tax Payable",
    "Undeposited Funds",
    "Unearned Revenue",
}
PROTECTED_SEEDED_EXCEPTIONS = {
    "Furniture and Equipment",
    "Lodging",
}
EXPECTED_INACTIVATED_ACCOUNTS = {
    "Purchase Adjustments",
    "Employee Gym Memberships",
    "Print Advertising",
    "Signage",
    "Cable / TV",
    "Electricity",
    "Gas",
    "Trash And Recycling",
    "Wastewater",
    "Water Supply",
    "Legacy Gifts / Donations - Review",
}
LOCAL_LINK_RE = re.compile(r"\[[^\]]+\]\((?!https?://|mailto:|#)([^)]+)\)")


class ZohoChartOfAccountsProposalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with PROPOSAL_PATH.open(encoding="utf-8", newline="") as source:
            reader = csv.DictReader(source)
            cls.columns = reader.fieldnames
            cls.rows = list(reader)

    def test_schema_and_required_fields_are_complete(self) -> None:
        self.assertEqual(EXPECTED_COLUMNS, self.columns)
        self.assertGreater(len(self.rows), 0)
        self.assertLessEqual(len(self.rows), 150)
        required = [column for column in EXPECTED_COLUMNS if column != "Parent Account"]
        for index, row in enumerate(self.rows, start=2):
            with self.subTest(csv_line=index):
                self.assertEqual(set(EXPECTED_COLUMNS), set(row))
                for column in required:
                    self.assertTrue(row[column].strip(), f"Missing {column} on line {index}")
                self.assertRegex(row["Target Code"], r"^[1-9][0-9]{3}$")

    def test_names_codes_parents_and_types_are_consistent(self) -> None:
        names = [row["Account Name"] for row in self.rows]
        codes = [row["Target Code"] for row in self.rows]
        self.assertEqual(len(names), len(set(names)))
        self.assertEqual(len(codes), len(set(codes)))
        by_name = {row["Account Name"]: row for row in self.rows}
        for row in self.rows:
            parent_name = row["Parent Account"]
            if not parent_name:
                continue
            with self.subTest(account=row["Account Name"]):
                self.assertIn(parent_name, by_name)
                self.assertEqual(row["Account Type"], by_name[parent_name]["Account Type"])

    def test_protected_controls_are_retained(self) -> None:
        names = {row["Account Name"] for row in self.rows}
        self.assertTrue(PROTECTED_CONTROLS.issubset(names))
        by_name = {row["Account Name"]: row for row in self.rows}
        for name in PROTECTED_CONTROLS:
            self.assertIn("system account", by_name[name]["Deployment Status"].lower())

    def test_confirmed_entity_scope_drives_equity_controls(self) -> None:
        audit = AUDIT_PATH.read_text(encoding="utf-8")
        self.assertIn("single-member LLC", audit)
        self.assertIn("Overland Park", audit)
        self.assertIn("Johnson County", audit)
        self.assertIn("reconciliation is deferred", audit)

        by_name = {row["Account Name"]: row for row in self.rows}
        for account_name in ("Owner's Equity", "Drawings"):
            with self.subTest(account=account_name):
                row_text = " ".join(by_name[account_name].values())
                self.assertIn("disregarded single-member LLC", row_text)
                self.assertRegex(row_text, r"Form 2553|Form 8832")

        self.assertEqual("Owner's Equity", by_name["Owner Contributions"]["Parent Account"])
        self.assertEqual(
            "Other Current Liability",
            by_name["Due to Owner - Substantiated Business Costs"]["Account Type"],
        )
        employee_reimbursements = " ".join(by_name["Employee Reimbursements"].values())
        self.assertIn("Do not use for the disregarded owner", employee_reimbursements)

    def test_tax_review_accounts_do_not_overstate_deductibility(self) -> None:
        by_name = {row["Account Name"]: row for row in self.rows}
        self.assertIn("Business Vehicle and Mileage - Tax Review", by_name)
        self.assertIn("Government Fines Penalties and Settlements - Tax Review", by_name)
        charitable = " ".join(by_name["Charitable Contributions - Tax Review"].values())
        self.assertIn("not a Schedule C expense", charitable)
        sales_use_tax = " ".join(by_name["Sales and Use Tax Expense - Tax Review"].values())
        self.assertIn("underlying purchase", sales_use_tax)

    def test_audit_links_resolve_and_proposal_is_not_an_import_authorization(self) -> None:
        audit = AUDIT_PATH.read_text(encoding="utf-8")
        for target in LOCAL_LINK_RE.findall(audit):
            resolved = (AUDIT_PATH.parent / target.strip("<>").split("#", 1)[0]).resolve()
            self.assertTrue(resolved.is_relative_to(ROOT.resolve()))
            self.assertTrue(resolved.exists(), f"Broken local link: {target}")
        lowered = audit.lower()
        self.assertRegex(lowered, r"not[^\n]+an import file")
        self.assertIn("does not authorize a zoho change", lowered)

    def test_phase_one_plan_freezes_exact_bounded_scope(self) -> None:
        plan = PHASE_ONE_PATH.read_text(encoding="utf-8")
        digest = hashlib.sha256(PROPOSAL_PATH.read_bytes()).hexdigest()
        self.assertIn(digest, plan)
        self.assertIn("Exact Create Scope — 18 Accounts", plan)
        self.assertIn("Exact Existing-Account Update Scope — 29 Accounts", plan)
        self.assertIn("Description-Only Cleanup — 7 Accounts", plan)
        self.assertIn("Created all 18 approved accounts", plan)
        self.assertIn("34 verified existing-account updates", plan)
        self.assertIn("Final sanitized state: 79 active accounts and 11 inactive accounts", plan)
        self.assertIn("No account was deleted", plan)
        self.assertIn("independently verified", plan)
        self.assertIn("Never retry a create blindly", plan)

    def test_execution_exceptions_and_cleanup_set_are_exact(self) -> None:
        plan = PHASE_ONE_PATH.read_text(encoding="utf-8")
        for name in PROTECTED_SEEDED_EXCEPTIONS:
            with self.subTest(seed_exception=name):
                self.assertIn(f"`{name}`", plan)
        self.assertIn("is_user_created=false", plan)
        self.assertIn("remained unchanged", plan)

        cleanup = plan.split("## Post-Phase-1 Cleanup — 11 Accounts", 1)[1].split(
            "Rollback remains", 1
        )[0]
        actual = {
            line.strip().strip("|").strip()
            for line in cleanup.splitlines()
            if line.startswith("| ")
            and "Inactivated custom account" not in line
            and not set(line.replace("|", "").strip()) <= {"-"}
        }
        self.assertEqual(EXPECTED_INACTIVATED_ACCOUNTS, actual)
        self.assertEqual(34, 29 + 7 - len(PROTECTED_SEEDED_EXCEPTIONS))
        self.assertEqual(79, 72 + 18 - len(EXPECTED_INACTIVATED_ACCOUNTS))
        self.assertEqual(11, len(EXPECTED_INACTIVATED_ACCOUNTS))
        self.assertEqual(90, 79 + 11)

    def test_post_deployment_guide_preserves_tax_and_owner_controls(self) -> None:
        guide = POSTING_GUIDE_PATH.read_text(encoding="utf-8")
        required_controls = {
            "2130 Due to Owner - Substantiated Business Costs",
            "3010 Owner Contributions",
            "3020 Drawings",
            "never use it for the disregarded owner",
            "Tax Payable`; never revenue",
            "6700 Taxes and Licenses` is a no-post Schedule C parent",
            "do not reduce the book posting to the expected tax deduction",
            "tax-only differences stay in private tax workpapers",
        }
        for control in required_controls:
            with self.subTest(control=control):
                self.assertIn(control, guide)

    def test_deployment_log_preserves_containment_and_final_readback(self) -> None:
        log = DEPLOYMENT_LOG_PATH.read_text(encoding="utf-8")
        self.assertIn("14 known-created accounts were marked inactive", log)
        self.assertIn("Outcome: contained", log)
        self.assertIn("complete 18 creates and 34 existing-account updates", log)
        self.assertIn(
            "inactivate 11 custom accounts that passed the documented scoped eligibility checks",
            log,
        )
        self.assertIn("final chart contained 79 active and 11 inactive accounts", log)
        self.assertIn("final complete active/inactive chart matched", log)


if __name__ == "__main__":
    unittest.main()
