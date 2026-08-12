from __future__ import annotations

import csv
import hashlib
import json
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
FREE_TEST_FIELDS_CSV = REFERENCE / "free-test-field-manifest.csv"
FREE_TEST_PICKLISTS_CSV = REFERENCE / "free-test-picklist-values.csv"
CRM_MCP_INVENTORY = (
    ROOT
    / "docs"
    / "zoho"
    / "mcp"
    / "snapshots"
    / "effective"
    / "2026-08-12"
    / "crm-tool-inventory.json"
)

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
        _, cls.free_test_fields = read_csv(FREE_TEST_FIELDS_CSV)
        _, cls.free_test_picklists = read_csv(FREE_TEST_PICKLISTS_CSV)
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
            self.assertEqual(
                {"verified"},
                {row["metadata_verification_status"] for row in rows},
            )
        self.assertEqual(
            {"2026-08-12"},
            {row["snapshot_date"] for row in self.modules},
        )
        self.assertEqual(
            {"2026-08-12"},
            {row["snapshot_date"] for row in self.fields},
        )
        # Conversion mappings intentionally remain a dated historical decision
        # artifact until the mapping review is rerun against the expanded schema.
        self.assertEqual(
            {"2026-08-05"},
            {row["snapshot_date"] for row in self.mappings},
        )

    def test_public_artifact_fingerprints_match_documentation(self) -> None:
        expected = {
            MODULES_CSV: "5c485d4753c47b2895ddd40eafe1e60b91b1f592e1b5a84da8d3a408fe31ae3f",
            FIELDS_CSV: "e9fa8d814b767451ead940d93777a465609fa5ee170bf6aa719272c3392edbf4",
            MAPPINGS_CSV: "05b2f1c8d143105f76bfda2aa19f4cf6f0126a8e799f8e951ff118890ea22c09",
        }
        reference = (REFERENCE / "README.md").read_text(encoding="utf-8")
        for path, digest in expected.items():
            with self.subTest(path=path):
                self.assertEqual(digest, hashlib.sha256(path.read_bytes()).hexdigest())
                self.assertIn(digest, reference)

    def test_module_catalog_reconciles_to_field_dictionary(self) -> None:
        expected = {
            "Leads": (137, 130, 7, "source_prospect"),
            "Contacts": (91, 73, 18, "person_record"),
            "Accounts": (97, 75, 22, "company_record"),
            "Deals": (142, 110, 32, "commercial_opportunity"),
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
        self.assertEqual(467, len(self.fields))
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
            {"present": 255, "not_supported": 132, "missing": 80},
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

        mapping_source_fields = {
            row["source_field_api_name"] for row in self.mappings
        }
        self.assertEqual(120, len(mapping_source_fields))
        self.assertEqual(
            {3},
            set(Counter(row["source_field_api_name"] for row in self.mappings).values()),
        )
        for row in self.mappings:
            self.assertTrue(row["source_field_label"])
            self.assertTrue(row["source_field_api_name"])
            self.assertTrue(row["source_data_type"])
            self.assertIn(row["source_usage_status"], {"used", "unused"})

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

                # This matrix is an immutable 2026-08-05 decision snapshot. Its
                # labels and usage classifications must not be silently rewritten
                # to match the newer field dictionary.
                self.assertTrue(row["target_field_label"])
                self.assertTrue(row["target_field_api_name"])
                self.assertTrue(row["target_data_type"])
                self.assertIn(
                    row["target_field_status"],
                    {"existing_used", "existing_unused"},
                )

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
        for path in (
            MODULES_CSV,
            FIELDS_CSV,
            MAPPINGS_CSV,
            FREE_TEST_FIELDS_CSV,
            FREE_TEST_PICKLISTS_CSV,
        ):
            text = path.read_text(encoding="utf-8")
            # The approved Free-Test help text includes a warning not to store
            # an "access token"; the phrase is policy text, not a credential.
            patterns = forbidden[:-1] if path == FREE_TEST_FIELDS_CSV else forbidden
            for pattern in patterns:
                with self.subTest(path=path, pattern=pattern.pattern):
                    self.assertIsNone(pattern.search(text))

    def test_csv_artifacts_are_tracked_and_not_ignored(self) -> None:
        for path in (
            MODULES_CSV,
            FIELDS_CSV,
            MAPPINGS_CSV,
            FREE_TEST_FIELDS_CSV,
            FREE_TEST_PICKLISTS_CSV,
        ):
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

    def test_free_test_manifest_reconciles_to_current_dictionary(self) -> None:
        self.assertEqual(84, len(self.free_test_fields))
        self.assertEqual(
            {"Leads": 18, "Contacts": 8, "Accounts": 7, "Deals": 51},
            Counter(row["module_api_name"] for row in self.free_test_fields),
        )
        keys = [
            (row["module_api_name"], row["field_api_name"])
            for row in self.free_test_fields
        ]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertEqual({"verified"}, {
            row["metadata_verification_status"] for row in self.free_test_fields
        })
        self.assertEqual({"optional"}, {
            row["required_status"] for row in self.free_test_fields
        })
        self.assertEqual({"present"}, {
            row["help_text_status"] for row in self.free_test_fields
        })
        for row in self.free_test_fields:
            current = self.fields_by_key[
                (row["module_api_name"], row["field_api_name"])
            ]
            self.assertEqual(current["field_label"], row["field_label"])
            self.assertEqual(current["data_type"], row["data_type"])
            self.assertEqual("used", current["usage_status"])
            self.assertTrue(row["help_text"])

        expected_sections = {
            ("Leads", "Free Test Request"): 7,
            ("Leads", "Free Test Attribution & Consent"): 11,
            ("Contacts", "Authority & Verification"): 8,
            ("Accounts", "Front-Office Profile"): 7,
            ("Deals", "Free Test Request"): 6,
            ("Deals", "Free Test Setup"): 24,
            ("Deals", "Free Test Control & Authorization"): 12,
            ("Deals", "Free Test Results"): 9,
        }
        self.assertEqual(
            expected_sections,
            Counter(
                (row["module_api_name"], row["layout_section"])
                for row in self.free_test_fields
            ),
        )

    def test_free_test_picklists_are_complete_and_reconcile(self) -> None:
        self.assertEqual(127, len(self.free_test_picklists))
        fields_by_key = {
            (row["module_api_name"], row["field_api_name"]): row
            for row in self.free_test_fields
        }
        grouped: dict[tuple[str, str], list[dict[str, str]]] = {}
        for row in self.free_test_picklists:
            key = (row["module_api_name"], row["field_api_name"])
            grouped.setdefault(key, []).append(row)
            self.assertIn(key, fields_by_key)
            self.assertEqual(
                fields_by_key[key]["field_label"],
                row["field_label"],
            )
            if row["colour_code"]:
                self.assertRegex(row["colour_code"], r"^#[0-9A-F]{6}$")

        for key, rows in grouped.items():
            self.assertEqual(
                int(fields_by_key[key]["picklist_value_count"]),
                len(rows),
            )
            self.assertEqual(
                list(range(1, len(rows) + 1)),
                [int(row["value_sequence"]) for row in rows],
            )

    def test_effective_crm_mcp_snapshot_is_sanitized_and_reconciled(self) -> None:
        inventory = json.loads(CRM_MCP_INVENTORY.read_text(encoding="utf-8"))
        self.assertEqual("sylvara-only", inventory["scope"])
        roles = {row["role"]: row for row in inventory["roles"]}
        self.assertEqual({"crm-audit", "crm-changes"}, set(roles))
        self.assertEqual(48, roles["crm-audit"]["current_callable_count"])
        self.assertEqual(14, roles["crm-changes"]["current_callable_count"])
        for role in roles.values():
            capabilities = role["capabilities"]
            self.assertEqual(role["current_callable_count"], len(capabilities))
            keys = [row["catalog_operation_key"] for row in capabilities]
            self.assertEqual(len(keys), len(set(keys)))

        text = CRM_MCP_INVENTORY.read_text(encoding="utf-8")
        self.assertNotIn("mcp__", text)
        self.assertNotRegex(text, r"\b\d{15,}\b")
        self.assertNotRegex(text, r"\b[0-9a-fA-F]{32,}\b")

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
