from __future__ import annotations

import csv
import hashlib
import re
import subprocess
import unittest
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
CRM_ROOT = ROOT / "src" / "zoho-crm"
REFERENCE = CRM_ROOT / "reference"
MODULES_CSV = REFERENCE / "modules.csv"
FIELDS_CSV = REFERENCE / "crm-field-dictionary.csv"
MAPPINGS_CSV = REFERENCE / "lead-conversion-mapping.csv"

MODULE_HEADERS = [
    "schema_version",
    "snapshot_date",
    "module_label",
    "module_api_name",
    "total_fields",
    "used_fields",
    "unused_fields",
    "conversion_role",
    "metadata_verification_status",
]
FIELD_HEADERS = [
    "schema_version",
    "snapshot_date",
    "module_label",
    "module_api_name",
    "field_label",
    "field_api_name",
    "data_type",
    "origin_status",
    "usage_status",
    "write_status",
    "system_required_status",
    "standard_layout_required_status",
    "virtual_status",
    "help_text_status",
    "metadata_verification_status",
]
MAPPING_HEADERS = [
    "schema_version",
    "snapshot_date",
    "source_module_label",
    "source_module_api_name",
    "source_field_label",
    "source_field_api_name",
    "source_data_type",
    "source_usage_status",
    "target_module_label",
    "target_module_api_name",
    "target_field_label",
    "target_field_api_name",
    "target_data_type",
    "target_field_status",
    "current_mapping_status",
    "type_compatibility_status",
    "choice_compatibility_status",
    "mapping_review_status",
    "review_reason_code",
    "metadata_verification_status",
]


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        return list(reader.fieldnames or []), list(reader)


class ZohoCrmSchemaPackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.module_headers, cls.modules = read_csv(MODULES_CSV)
        cls.field_headers, cls.fields = read_csv(FIELDS_CSV)
        cls.mapping_headers, cls.mappings = read_csv(MAPPINGS_CSV)
        cls.fields_by_key = {
            (row["module_api_name"], row["field_api_name"]): row
            for row in cls.fields
        }

    def test_csv_contracts_and_snapshot_are_exact(self) -> None:
        self.assertEqual(MODULE_HEADERS, self.module_headers)
        self.assertEqual(FIELD_HEADERS, self.field_headers)
        self.assertEqual(MAPPING_HEADERS, self.mapping_headers)
        for rows in (self.modules, self.fields, self.mappings):
            self.assertTrue(rows)
            self.assertEqual({"1"}, {row["schema_version"] for row in rows})
            self.assertEqual({"2026-08-05"}, {row["snapshot_date"] for row in rows})
            self.assertEqual(
                {"verified"},
                {row["metadata_verification_status"] for row in rows},
            )

    def test_public_artifact_fingerprints_match_documentation(self) -> None:
        expected = {
            MODULES_CSV: "5b21ffef4d7a0434e612d039400a446b8fdbc9eff2ccdd6925c58332b6fcbb3d",
            FIELDS_CSV: "228e92a52009ab1556a70f51c218829807d73eed35ab89452125f808ab94176a",
            MAPPINGS_CSV: "05b2f1c8d143105f76bfda2aa19f4cf6f0126a8e799f8e951ff118890ea22c09",
        }
        reference = (REFERENCE / "README.md").read_text(encoding="utf-8")
        for path, digest in expected.items():
            with self.subTest(path=path):
                self.assertEqual(digest, hashlib.sha256(path.read_bytes()).hexdigest())
                self.assertIn(digest, reference)

    def test_module_catalog_reconciles_to_field_dictionary(self) -> None:
        expected = {
            "Leads": (120, 112, 8, "source_prospect"),
            "Contacts": (83, 65, 18, "person_record"),
            "Accounts": (80, 58, 22, "company_record"),
            "Deals": (91, 69, 22, "commercial_opportunity"),
        }
        self.assertEqual(4, len(self.modules))
        self.assertEqual(expected, {
            row["module_api_name"]: (
                int(row["total_fields"]),
                int(row["used_fields"]),
                int(row["unused_fields"]),
                row["conversion_role"],
            )
            for row in self.modules
        })

        fields_by_module = Counter(row["module_api_name"] for row in self.fields)
        used_by_module = Counter(
            row["module_api_name"]
            for row in self.fields
            if row["usage_status"] == "used"
        )
        for module_name, (total, used, unused, _) in expected.items():
            self.assertEqual(total, fields_by_module[module_name])
            self.assertEqual(used, used_by_module[module_name])
            self.assertEqual(unused, total - used)

    def test_field_dictionary_is_unique_and_uses_controlled_values(self) -> None:
        self.assertEqual(374, len(self.fields))
        keys = [
            (row["module_api_name"], row["field_api_name"])
            for row in self.fields
        ]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertEqual(
            {"Leads", "Contacts", "Accounts", "Deals"},
            {row["module_api_name"] for row in self.fields},
        )
        allowed = {
            "origin_status": {"system", "custom"},
            "usage_status": {"used", "unused"},
            "write_status": {"writable", "read_only"},
            "system_required_status": {"required", "optional"},
            "standard_layout_required_status": {
                "required",
                "optional",
                "not_present",
            },
            "virtual_status": {"concrete", "virtual"},
            "help_text_status": {"present", "missing", "not_supported"},
        }
        for column, values in allowed.items():
            with self.subTest(column=column):
                self.assertLessEqual(
                    {row[column] for row in self.fields},
                    values,
                )
        for row in self.fields:
            self.assertTrue(row["module_label"])
            self.assertTrue(row["module_api_name"])
            self.assertTrue(row["field_label"])
            self.assertTrue(row["field_api_name"])
            self.assertTrue(row["data_type"])

        self.assertEqual(
            {"present": 171, "not_supported": 124, "missing": 79},
            Counter(row["help_text_status"] for row in self.fields),
        )
        self.assertFalse([
            row
            for row in self.fields
            if row["usage_status"] == "used"
            and row["write_status"] == "writable"
            and row["help_text_status"] == "missing"
        ])

    def test_mapping_matrix_is_complete_and_unique(self) -> None:
        self.assertEqual(360, len(self.mappings))
        keys = [
            (row["source_field_api_name"], row["target_module_api_name"])
            for row in self.mappings
        ]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertEqual(
            {"Contacts", "Accounts", "Deals"},
            {row["target_module_api_name"] for row in self.mappings},
        )

        lead_fields = {
            row["field_api_name"]
            for row in self.fields
            if row["module_api_name"] == "Leads"
        }
        self.assertEqual(120, len(lead_fields))
        self.assertEqual(lead_fields, {row["source_field_api_name"] for row in self.mappings})
        self.assertEqual(
            {3},
            set(Counter(row["source_field_api_name"] for row in self.mappings).values()),
        )
        for row in self.mappings:
            source = self.fields_by_key[("Leads", row["source_field_api_name"])]
            self.assertEqual(source["field_label"], row["source_field_label"])
            self.assertEqual(source["data_type"], row["source_data_type"])
            self.assertEqual(source["usage_status"], row["source_usage_status"])

    def test_mapping_targets_resolve_or_are_explicitly_missing(self) -> None:
        for row in self.mappings:
            with self.subTest(
                source=row["source_field_api_name"],
                target_module=row["target_module_api_name"],
            ):
                if row["target_field_status"] == "missing":
                    self.assertEqual("", row["target_field_label"])
                    self.assertEqual("", row["target_field_api_name"])
                    self.assertEqual("", row["target_data_type"])
                    continue
                if row["target_field_status"] == "not_applicable":
                    self.assertEqual("", row["target_field_api_name"])
                    continue

                target = self.fields_by_key[
                    (row["target_module_api_name"], row["target_field_api_name"])
                ]
                self.assertEqual(target["field_label"], row["target_field_label"])
                self.assertEqual(target["data_type"], row["target_data_type"])
                expected_status = (
                    "existing_used"
                    if target["usage_status"] == "used"
                    else "existing_unused"
                )
                self.assertEqual(expected_status, row["target_field_status"])

    def test_mapping_review_states_are_internally_consistent(self) -> None:
        expected_counts = {
            "safe_keep": 50,
            "remove": 4,
            "safe_add": 18,
            "target_creation_required": 11,
            "intentional_unmapped": 277,
        }
        self.assertEqual(
            expected_counts,
            Counter(row["mapping_review_status"] for row in self.mappings),
        )
        self.assertEqual(
            {"mapped": 54, "unmapped": 306},
            Counter(row["current_mapping_status"] for row in self.mappings),
        )

        for row in self.mappings:
            status = row["mapping_review_status"]
            if status == "safe_keep":
                self.assertEqual("mapped", row["current_mapping_status"])
                self.assertTrue(row["target_field_status"].startswith("existing_"))
                self.assertEqual("exact", row["type_compatibility_status"])
            elif status == "remove":
                self.assertEqual("mapped", row["current_mapping_status"])
            elif status == "safe_add":
                self.assertEqual("unmapped", row["current_mapping_status"])
                self.assertTrue(row["target_field_status"].startswith("existing_"))
                self.assertEqual("exact", row["type_compatibility_status"])
            elif status == "target_creation_required":
                self.assertEqual("unmapped", row["current_mapping_status"])
                self.assertEqual("missing", row["target_field_status"])
                self.assertEqual("target_missing", row["review_reason_code"])
            else:
                self.assertEqual("intentional_unmapped", status)
                self.assertEqual("unmapped", row["current_mapping_status"])

    def test_risk_review_sets_do_not_drift(self) -> None:
        unsafe = {
            (
                row["source_field_api_name"],
                row["target_module_api_name"],
                row["target_field_api_name"],
            )
            for row in self.mappings
            if row["mapping_review_status"] == "remove"
        }
        self.assertEqual(
            {
                ("Designation", "Accounts", "Title"),
                ("Phone", "Accounts", "Phone"),
                ("Mobile", "Accounts", "Mobile"),
                ("Service_Interest", "Accounts", "Active_Services"),
            },
            unsafe,
        )
        missing = {
            (row["source_field_api_name"], row["target_module_api_name"])
            for row in self.mappings
            if row["mapping_review_status"] == "target_creation_required"
        }
        self.assertEqual(
            {
                ("Text_Opt_Out", "Contacts"),
                ("Decision_Maker_Role", "Contacts"),
                ("Decision_Authority", "Contacts"),
                ("Contact_Location_Relationship", "Contacts"),
                ("Contact_Verification_Status", "Contacts"),
                ("Contact_Source_URL", "Contacts"),
                ("Contact_Verified_At", "Contacts"),
                ("Pain_Signals", "Deals"),
                ("After_Hours_Audit_At", "Deals"),
                ("After_Hours_Audit_Outcome", "Deals"),
                ("After_Hours_Audit_Notes", "Deals"),
            },
            missing,
        )

    def test_csvs_contain_no_values_or_opaque_identifiers(self) -> None:
        forbidden = (
            re.compile(r"\b\d{15,}\b"),
            re.compile(r"\b[0-9a-fA-F]{32,}\b"),
            re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
            re.compile(r"https?://", re.IGNORECASE),
            re.compile(r"\b(?:oauth|bearer|access[_ -]?token|refresh[_ -]?token)\b", re.IGNORECASE),
        )
        for path in (MODULES_CSV, FIELDS_CSV, MAPPINGS_CSV):
            text = path.read_text(encoding="utf-8")
            for pattern in forbidden:
                with self.subTest(path=path, pattern=pattern.pattern):
                    self.assertIsNone(pattern.search(text))

    def test_csv_artifacts_are_tracked_and_not_ignored(self) -> None:
        for path in (MODULES_CSV, FIELDS_CSV, MAPPINGS_CSV):
            relative_path = path.relative_to(ROOT).as_posix()
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
            self.assertEqual(1, ignored.returncode, ignored.stderr)

    def test_conversion_contract_documents_required_gates(self) -> None:
        reference = (REFERENCE / "README.md").read_text(encoding="utf-8")
        conversion = reference.split(
            "## Native Conversion Prerequisites", 1
        )[1].split("\n## ", 1)[0]
        for api_name in (
            "First_Name",
            "Last_Name",
            "Account_Name",
            "Contact_Type",
            "Account_Type",
            "Onboarding_Status",
            "Contact_Name",
            "Deal_Name",
            "Pipeline",
            "Stage",
            "Closing_Date",
        ):
            with self.subTest(api_name=api_name):
                self.assertIn(f"`{api_name}`", conversion)
        self.assertIn("open design gate", (CRM_ROOT / "README.md").read_text(encoding="utf-8"))
        self.assertIn("complete field proposal", reference)
        self.assertIn("conversion-time associated-business-site snapshots", reference)
        self.assertIn("private prestate", reference)

    def test_local_document_links_resolve(self) -> None:
        link_pattern = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
        for readme in (CRM_ROOT / "README.md", REFERENCE / "README.md"):
            for target in link_pattern.findall(readme.read_text(encoding="utf-8")):
                if "://" in target or target.startswith("#"):
                    continue
                with self.subTest(readme=readme, target=target):
                    self.assertTrue((readme.parent / target).resolve().exists())


if __name__ == "__main__":
    unittest.main()
