from __future__ import annotations

import csv
import hashlib
import re
import unittest
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SNAPSHOT = (
    ROOT
    / "src"
    / "zoho-crm"
    / "reference"
    / "snapshots"
    / "2026-08-14"
)
README = SNAPSHOT / "README.md"
MODULES = SNAPSHOT / "modules.csv"
FIELDS = SNAPSHOT / "crm-field-dictionary.csv"
PICKLISTS = SNAPSHOT / "crm-picklist-options.csv"
LAYOUTS = SNAPSHOT / "crm-layout-field-order.csv"
MAPPINGS = SNAPSHOT / "lead-conversion-mapping.csv"
FORM_MAP = SNAPSHOT / "free-test-form-field-map.csv"
AUTOMATION = (
    ROOT
    / "docs"
    / "zoho"
    / "mcp"
    / "snapshots"
    / "effective"
    / "2026-08-14"
    / "free-test-crm-automation.md"
)

ARTIFACTS = [MODULES, FIELDS, PICKLISTS, LAYOUTS, MAPPINGS, FORM_MAP]


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        return list(reader.fieldnames or []), list(reader)


class ZohoCrmSchemaSnapshot20260814Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        _, cls.modules = read_csv(MODULES)
        _, cls.fields = read_csv(FIELDS)
        _, cls.picklists = read_csv(PICKLISTS)
        _, cls.layouts = read_csv(LAYOUTS)
        _, cls.mappings = read_csv(MAPPINGS)
        _, cls.form_map = read_csv(FORM_MAP)
        cls.fields_by_key = {
            (row["module_api_name"], row["field_api_name"]): row
            for row in cls.fields
        }

    def test_artifact_hashes_match_readme(self) -> None:
        readme = README.read_text(encoding="utf-8")
        for path in ARTIFACTS:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            with self.subTest(path=path):
                self.assertIn(f"`{path.name}` | `{digest}`", readme)

    def test_module_and_field_counts_reconcile(self) -> None:
        expected = {
            "Leads": (138, 131, 7, 80, 13),
            "Contacts": (91, 73, 18, 31, 10),
            "Accounts": (95, 77, 18, 53, 11),
            "Deals": (142, 111, 31, 81, 14),
        }
        self.assertEqual(4, len(self.modules))
        observed = {
            row["module_api_name"]: (
                int(row["total_fields"]),
                int(row["used_fields"]),
                int(row["unused_fields"]),
                int(row["used_custom_fields"]),
                int(row["standard_layout_sections"]),
            )
            for row in self.modules
        }
        self.assertEqual(expected, observed)
        self.assertEqual(466, len(self.fields))

        field_counts = Counter(row["module_api_name"] for row in self.fields)
        used_counts = Counter(
            row["module_api_name"]
            for row in self.fields
            if row["usage_status"] == "used"
        )
        for module, (total, used, unused, _, _) in expected.items():
            self.assertEqual(total, field_counts[module])
            self.assertEqual(used, used_counts[module])
            self.assertEqual(unused, total - used)

    def test_field_dictionary_is_unique_and_sanitized(self) -> None:
        keys = [
            (row["module_api_name"], row["field_api_name"])
            for row in self.fields
        ]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertEqual(
            {"Leads", "Contacts", "Accounts", "Deals"},
            {row["module_api_name"] for row in self.fields},
        )
        for row in self.fields:
            self.assertEqual("2", row["schema_version"])
            self.assertEqual("2026-08-14", row["snapshot_date"])
            self.assertEqual(
                "verified_live_read_only",
                row["metadata_verification_status"],
            )
            self.assertNotIn("6513921", "|".join(row.values()))

        unique_enabled = {
            (row["module_api_name"], row["field_api_name"])
            for row in self.fields
            if row["usage_status"] == "used"
            and row["unique_status"] != "not_unique"
        }
        self.assertEqual(
            {
                ("Leads", "Email"),
                ("Leads", "Intake_Submission_ID"),
                ("Contacts", "Email"),
                ("Accounts", "Customer_ID"),
            },
            unique_enabled,
        )
        self.assertEqual(
            {"not_encrypted"},
            {row["encryption_status"] for row in self.fields},
        )

        for row in self.fields:
            expected_write_status = (
                "writable"
                if (
                    row["api_create_status"] == "true"
                    or row["api_update_status"] == "true"
                )
                and row["read_only_status"] != "true"
                else "read_only"
            )
            with self.subTest(
                module=row["module_api_name"],
                field=row["field_api_name"],
            ):
                self.assertEqual(expected_write_status, row["write_status"])

        expected_special = {
            ("Leads", "Owner"): "writable",
            ("Contacts", "Owner"): "writable",
            ("Accounts", "Owner"): "writable",
            ("Deals", "Owner"): "writable",
            ("Deals", "Stage_Modified_Time"): "writable",
            ("Deals", "Expected_Revenue"): "read_only",
            ("Accounts", "Created_Time"): "read_only",
            ("Deals", "Modified_Time"): "read_only",
        }
        for key, status in expected_special.items():
            with self.subTest(key=key):
                self.assertEqual(status, self.fields_by_key[key]["write_status"])

    def test_every_enabled_field_is_on_default_layout(self) -> None:
        default_keys = {
            (row["module_api_name"], row["field_api_name"])
            for row in self.layouts
            if row["section_mode"] == "default_create"
        }
        enabled_keys = {
            (row["module_api_name"], row["field_api_name"])
            for row in self.fields
            if row["usage_status"] == "used"
        }
        self.assertEqual(enabled_keys, default_keys)
        self.assertEqual(
            {"required", "optional"},
            {row["required_status"] for row in self.layouts},
        )
        self.assertEqual(438, len(self.layouts))
        self.assertEqual(
            {"default_create": 392, "quick_create": 23, "business_card": 23},
            Counter(row["section_mode"] for row in self.layouts),
        )
        for row in self.layouts:
            self.assertIn(
                (row["module_api_name"], row["field_api_name"]),
                self.fields_by_key,
            )
            self.assertIn(row["read_only_status"], {"true", "false"})
            self.assertIn(row["field_read_only_status"], {"true", "false"})
            self.assertIn(row["api_write_status"], {"writable", "read_only"})

        auxiliary = {
            (module, mode): [
                row["field_api_name"]
                for row in self.layouts
                if row["module_api_name"] == module
                and row["section_mode"] == mode
            ]
            for module in {"Leads", "Contacts", "Accounts", "Deals"}
            for mode in {"quick_create", "business_card"}
        }
        self.assertEqual(
            ["Company", "First_Name", "Last_Name", "Mobile", "Email", "Lead_Status", "Lead_Source"],
            auxiliary[("Leads", "quick_create")],
        )
        self.assertEqual(
            ["Full_Name", "Company", "Owner", "Email", "Phone", "Mobile", "Lead_Status"],
            auxiliary[("Leads", "business_card")],
        )
        self.assertEqual(
            ["First_Name", "Last_Name", "Account_Name", "Email", "Phone", "Contact_Type"],
            auxiliary[("Contacts", "quick_create")],
        )
        self.assertEqual(
            ["Full_Name", "Account_Name", "Mobile", "Phone", "Email"],
            auxiliary[("Contacts", "business_card")],
        )

        rendered_label_drift = {
            (row["module_api_name"], row["field_api_name"], row["field_label"], row["layout_display_label"])
            for row in self.layouts
            if row["section_mode"] == "default_create"
            and row["field_label"] != row["layout_display_label"]
        }
        self.assertEqual(
            {
                ("Leads", "Record_Image", "Lead Image", "Record Image"),
                ("Leads", "Last_Visited_Time", "Most Recent Visit", "Last Visited Time"),
                ("Leads", "First_Visited_URL", "First Page Visited", "First Visited URL"),
                ("Leads", "First_Visited_Time", "First Visit", "First Visited Time"),
                ("Contacts", "Record_Image", "Contact Image", "Record Image"),
                ("Contacts", "Last_Visited_Time", "Most Recent Visit", "Last Visited Time"),
                ("Contacts", "First_Visited_URL", "First Page Visited", "First Visited URL"),
                ("Contacts", "First_Visited_Time", "First Visit", "First Visited Time"),
                ("Accounts", "Record_Image", "Account Image", "Record Image"),
                ("Deals", "Deal_Name", "Deal Name", "Potential Name"),
                ("Deals", "Owner", "Deal Owner", "Potential Owner"),
            },
            rendered_label_drift,
        )

        expected_section_api_names = {
            "Leads": {
                1: "Record_Image__s",
                2: "Lead_Summary",
                3: "Source_And_Qualification",
                4: "Address_Information__s",
                5: "Lead_Information__s",
                6: "Qualification",
                7: "Account_Classification",
                8: "Social_Media",
                9: "Notes",
                10: "Visit_Summary__s",
                11: "Free_Test_Request",
                12: "Free_Test_Attribution_Consent",
                13: "System",
            },
            "Contacts": {
                1: "Record_Image__s",
                2: "Contact_Information__s",
                3: "Roles_And_Portal_Access",
                4: "Communication_Details",
                5: "Engagement_Details",
                6: "Description_Information__s",
                7: "Notes",
                8: "Visit_Summary__s",
                9: "Authority_Verification",
                10: "System_Information",
            },
        }
        observed_sections = {
            module: {
                int(row["section_sequence"]): row["section_api_name"]
                for row in self.layouts
                if row["module_api_name"] == module
                and row["section_mode"] == "default_create"
            }
            for module in {"Leads", "Contacts"}
        }
        self.assertEqual(expected_section_api_names, observed_sections)

        for row in self.layouts:
            if row["module_api_name"] in {"Leads", "Contacts"} and row["section_mode"] != "default_create":
                self.assertEqual("1000", row["section_sequence"])

    def test_picklists_are_complete_and_preserve_display_actual_contract(self) -> None:
        choice_fields = {
            (row["module_api_name"], row["field_api_name"])
            for row in self.fields
            if row["data_type"] in {"picklist", "multiselectpicklist"}
        }
        option_fields = {
            (row["module_api_name"], row["field_api_name"])
            for row in self.picklists
        }
        omitted = {
            (row["module_api_name"], row["field_api_name"])
            for row in self.fields
            if row["picklist_options_status"].startswith("omitted_")
        }
        self.assertEqual(choice_fields - omitted, option_fields)
        self.assertEqual(
            "omitted_private_user_reference_values",
            self.fields_by_key[("Deals", "Party_A")]["picklist_options_status"],
        )
        self.assertEqual(
            {
                ("Leads", "Address_Country_Region"),
                ("Leads", "Address_State_Province"),
                ("Leads", "After_Hours_Call_Band"),
                ("Leads", "Average_Job_Value_Band"),
                ("Leads", "Field_Team_Size_Band"),
                ("Leads", "Monthly_Inbound_Call_Band"),
                ("Leads", "Time_Zone"),
                ("Leads", "Timeline_Fit"),
                ("Contacts", "Address_Country_Region"),
                ("Contacts", "Address_State_Province"),
                ("Contacts", "Time_Zone"),
                ("Accounts", "Field_Team_Size_Band"),
                ("Accounts", "Address_Country_Region"),
                ("Accounts", "Address_State_Province"),
                ("Accounts", "Shipping_Address_Country_Region"),
                ("Accounts", "Shipping_Address_State_Province"),
                ("Deals", "Address_Country_Region"),
                ("Deals", "Address_State_Province"),
                ("Deals", "After_Hours_Call_Band"),
                ("Deals", "Average_Job_Value_Band"),
                ("Deals", "Monthly_Inbound_Call_Band"),
                ("Deals", "Party_A"),
                ("Deals", "Timeline_Fit"),
            },
            omitted,
        )
        self.assertEqual(113, len(choice_fields))
        self.assertEqual(90, len(option_fields))
        self.assertEqual(719, len(self.picklists))

        keys = [
            (
                row["module_api_name"],
                row["field_api_name"],
                row["option_scope"],
                row["display_value"],
                row["actual_value"],
                row["reference_value"],
                row["usage_status"],
            )
            for row in self.picklists
        ]
        self.assertEqual(len(keys), len(set(keys)))

        pipeline = [
            (row["display_value"], row["actual_value"])
            for row in self.picklists
            if row["module_api_name"] == "Deals"
            and row["field_api_name"] == "Stage"
            and row["option_scope"] == "pipeline_revenue_desk_sales"
        ]
        self.assertEqual(
            [
                ("Setup and Authorization", "New Lead"),
                ("Test Authorized", "Demo Scheduled"),
                ("Setup and QA", "Demo Completed"),
                ("Test Live", "Value Proposition"),
                ("Results Review", "Checkout Sent"),
                ("Subscription Proposed", "Trial Started"),
                ("Closed Won", "Paid Subscription Active"),
                ("Closed Lost", "Closed Lost"),
            ],
            pipeline,
        )

        self.assertTrue(omitted.isdisjoint(option_fields))

    def test_current_conversion_matrix_is_complete(self) -> None:
        self.assertEqual(414, len(self.mappings))
        keys = [
            (row["source_field_api_name"], row["target_module_api_name"])
            for row in self.mappings
        ]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertEqual(
            {3},
            set(Counter(row["source_field_api_name"] for row in self.mappings).values()),
        )
        self.assertEqual(
            {"mapped": 76, "unmapped": 338},
            Counter(row["current_mapping_status"] for row in self.mappings),
        )

        mapped = {
            (
                row["source_field_api_name"],
                row["target_module_api_name"],
                row["target_field_api_name"],
            )
            for row in self.mappings
            if row["current_mapping_status"] == "mapped"
        }
        self.assertTrue(
            {
                ("Main_Business_Phone", "Accounts", "Phone"),
                ("Company_Email", "Accounts", "Company_Email"),
                ("Field_Team_Size_Band", "Accounts", "Field_Team_Size_Band"),
                ("Requested_Test_Route", "Deals", "Requested_Test_Route"),
                ("Free_Test_Contact_Consent", "Contacts", "Free_Test_Contact_Consent"),
            }.issubset(mapped)
        )
        self.assertTrue(
            {
                ("Designation", "Accounts", "Title"),
                ("Phone", "Accounts", "Phone"),
                ("Mobile", "Accounts", "Mobile"),
                ("Service_Interest", "Accounts", "Active_Services"),
            }.isdisjoint(mapped)
        )

    def test_free_test_map_resolves_and_preserves_forms_boundary(self) -> None:
        self.assertEqual(113, len(self.form_map))
        self.assertEqual(
            {"Form 1": 27, "Form 2": 51, "Free Test Delivery": 35},
            Counter(row["form_or_process"] for row in self.form_map),
        )
        self.assertFalse(
            any(
                row["coverage_status"] == "missing_dedicated_crm_field"
                for row in self.form_map
            )
        )

        form1_visible = [
            row["form_label"]
            for row in self.form_map
            if row["form_or_process"] == "Form 1"
            and row["section"] == "Visible Fields"
        ]
        self.assertEqual(
            [
                "Full Name",
                "Plumbing Company",
                "Your Role",
                "Other Role or Exact Title",
                "Business Email",
                "Mobile Number",
                "Main Business Number",
                "Current After-Hours Handling",
                "Preferred Test Route",
                "Phone Provider or System",
                "Primary Service Area",
                "Approximate Field Team Size",
                "Additional Context",
                "Contact Authorization",
            ],
            form1_visible,
        )
        self.assertTrue(
            {
                "Middle Name",
                "Company Logo",
                "Plan Interest",
                "Assisted By",
                "Contact Phone",
                "Lead Source",
            }.isdisjoint(
                {row["form_label"] for row in self.form_map if row["form_or_process"] == "Form 1"}
            )
        )
        full_name = next(
            row for row in self.form_map
            if row["form_or_process"] == "Form 1" and row["form_label"] == "Full Name"
        )
        self.assertEqual("Leads.First_Name|Leads.Last_Name", full_name["component_mapping"])
        self.assertEqual("current_enabled_composite_crm_fields", full_name["coverage_status"])

        form2_setup = [
            row["destination_field_api_name"]
            for row in self.form_map
            if row["form_or_process"] == "Form 2"
            and row["section"] == "Approved Test Setup"
        ]
        self.assertEqual("Target_Start_Date", form2_setup[1])
        self.assertEqual(15, len(form2_setup))
        secure_context = [
            row for row in self.form_map
            if row["form_or_process"] == "Form 2"
            and row["section"] == "Secure Record Context"
        ]
        self.assertEqual(3, len(secure_context))
        self.assertTrue(
            all(
                row["write_or_derive_behavior"] == "resolve_server_side_never_put_in_url"
                for row in secure_context
            )
        )
        call_limit = next(
            row for row in self.form_map
            if row["destination_field_api_name"] == "Test_Call_Limit"
        )
        self.assertEqual("configured_private_limit", call_limit["write_or_derive_behavior"])

        for row in self.form_map:
            if row["form_or_process"] == "Free Test Delivery":
                self.assertEqual("not_applicable_crm_control", row["form_order_status"])
            else:
                self.assertEqual(
                    "approved_contract_order_forms_readback_tbd",
                    row["form_order_status"],
                )
            if row["coverage_status"] in {
                "current_enabled_composite_crm_fields",
                "secure_record_context_not_crm_field",
            }:
                continue
            target = self.fields_by_key[
                (
                    row["destination_module_api_name"],
                    row["destination_field_api_name"],
                )
            ]
            self.assertEqual(target["data_type"], row["destination_field_type"])

    def test_effective_automation_contract_is_complete_and_fail_closed(self) -> None:
        text = AUTOMATION.read_text(encoding="utf-8")
        for marker in (
            "End-to-end runtime acceptance: **Blocked**",
            "All 98 expanded CRM destinations",
            "Lead Source is workflow-owned",
            "Leads Free Test Intake Review",
            "Deals Free Test Form 2 Submitted",
            "Deals Free Test Initialize Controls",
            "Deals Free Test Initialize Limits",
            "Control field: `Stage`",
            "All four workflows report no prior execution",
            "Blueprint reports zero enrolled records",
            "`Type = Initial Sale`",
            "`No_Answer_Delay`",
            "`Approved_Fallback_Number`",
            "`Alert_Recipient_Email`",
            "Stage and operational status can drift",
            "Stopping a live test is under-controlled",
            "Closed Won is under-controlled",
            "Forms/controller path is unverified",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, text)

        transition_names = {
            "Confirm Authorization",
            "Begin Setup and QA",
            "Approve Go Live",
            "Complete Free Test",
            "Propose Subscription",
            "Activate Subscription",
            "Close During Authorization",
            "Close After Authorization",
            "Close During QA",
            "Close Live Test",
            "Close After Results Review",
            "Decline Subscription",
        }
        transition_rows = {
            cells[0]
            for line in text.splitlines()
            if line.startswith("|")
            and len(cells := [cell.strip() for cell in line.strip("|").split("|")]) == 5
            and cells[0] in transition_names
            and cells[-1] == "None"
        }
        self.assertEqual(transition_names, transition_rows)

    def test_public_files_contain_no_private_identifiers_or_payloads(self) -> None:
        forbidden = (
            re.compile(r"\b6513921\d+\b"),
            re.compile(r"\b[0-9a-fA-F]{32,}\b"),
            re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
            re.compile(r"https?://", re.IGNORECASE),
            re.compile(
                r"\b(?:oauth|bearer|access[_ -]?token|refresh[_ -]?token)\b",
                re.IGNORECASE,
            ),
        )
        for path in ARTIFACTS:
            text = path.read_text(encoding="utf-8")
            for pattern in forbidden:
                with self.subTest(path=path, pattern=pattern.pattern):
                    self.assertIsNone(pattern.search(text))

        readme = README.read_text(encoding="utf-8")
        for pattern in (forbidden[0], forbidden[2], forbidden[3], forbidden[4]):
            with self.subTest(path=README, pattern=pattern.pattern):
                self.assertIsNone(pattern.search(readme))


if __name__ == "__main__":
    unittest.main()
