import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = ROOT / "docs" / "product" / "free-revenue-leak-test-release-contract.json"
INVENTORY_PATH = ROOT / "src" / "zoho-catalyst" / "development-function-inventory.json"
TABLE_DISPOSITION_PATH = ROOT / "src" / "zoho-catalyst" / "development-table-disposition.json"
PACKET_A_EXECUTION_PATH = (
    ROOT
    / "src"
    / "zoho-catalyst"
    / "evidence"
    / "free-revenue-leak-test-development-packet-a-execution-2026-08-26.json"
)
PACKET_A_RESOLUTION_PATH = (
    ROOT
    / "src"
    / "zoho-catalyst"
    / "evidence"
    / "free-revenue-leak-test-development-packet-a-resolution-2026-08-26.json"
)
SIX_FUNCTION_DEPLOYMENT_PATH = (
    ROOT
    / "src"
    / "zoho-catalyst"
    / "evidence"
    / "free-revenue-leak-test-development-six-function-deployment-2026-08-27.json"
)
ROUTE_CONTINUATION_PATH = (
    ROOT
    / "src"
    / "zoho-catalyst"
    / "evidence"
    / "free-revenue-leak-test-development-route-continuation-2026-08-27.json"
)
WORKER_BINDING_CONTAINMENT_PATH = (
    ROOT
    / "src"
    / "zoho-catalyst"
    / "evidence"
    / "free-revenue-leak-test-development-worker-binding-containment-2026-08-27.json"
)
WORKER_UI_ROLLBACK_PATH = (
    ROOT
    / "src"
    / "zoho-catalyst"
    / "evidence"
    / "free-revenue-leak-test-development-worker-ui-rollback-2026-08-28.json"
)
DARK_PRODUCTION_PRESTATE_PATH = (
    ROOT
    / "src"
    / "zoho-catalyst"
    / "evidence"
    / "free-revenue-leak-test-dark-production-prestate-2026-08-28.json"
)
CRM_LIVE_PREFLIGHT_PATH = (
    ROOT
    / "src"
    / "zoho-crm"
    / "free-revenue-leak-test"
    / "evidence"
    / "live-metadata-preflight-2026-08-28.json"
)
BILLING_TEST_CATALOG_PREFLIGHT_PATH = (
    ROOT
    / "src"
    / "zoho-catalyst"
    / "crm-billing-orchestrator"
    / "config"
    / "billing-test-catalog-preflight-2026-08-28.json"
)
PRIVATE_ROUTE_CONTRACT_PATH = (
    ROOT
    / "src"
    / "zoho-catalyst"
    / "revenue-desk-release"
    / "private-route-packet-contract.json"
)
ROUTE_CONTRACT_SOURCE_REVISION = "aab7c18c27f4ff5e1468da51eae433ede9b852f6"
ROUTE_CONTRACT_SHA256_AT_SOURCE_REVISION = (
    "bdb06e56ab1658aecc885b9cd78b3acc51fbdb1fea137a75a548a75b7d63690f"
)
ROUTE_CONTRACT_GIT_BLOB_SHA1_AT_SOURCE_REVISION = (
    "14d688c23f542ef1374e19a8bfbdcfdd8db999f3"
)
ANALYTICS_OUTBOX_FENCE_ADR_PATH = (
    ROOT / "docs" / "adr" / "0008-single-key-analytics-outbox-fence.md"
)
DEPLOYMENT_LOG_PATH = ROOT / "docs" / "runbooks" / "deployment-log.md"
RECONCILIATION_RUNBOOK_PATH = (
    ROOT
    / "docs"
    / "runbooks"
    / "free-revenue-leak-test-e2e-reconciliation-2026-08-24.md"
)
SHARED_MONITOR_RUNBOOK_PATH = (
    ROOT / "docs" / "runbooks" / "shared-seven-day-monitor-number-routing.md"
)
ZOHO_README_PATH = ROOT / "docs" / "zoho" / "README.md"
CALL_RUNTIME_README_PATH = (
    ROOT / "src" / "zoho-catalyst" / "revenue-desk-call-runtime" / "README.md"
)
REQUEST_FORM_README_PATH = (
    ROOT / "src" / "zoho-catalyst" / "revenue-leak-test-request-form" / "README.md"
)
SETUP_FORM_README_PATH = (
    ROOT / "src" / "zoho-catalyst" / "revenue-leak-test-setup-form" / "README.md"
)
ROUTE_CONTINUATION_PUBLIC_MIRROR_PATHS = (
    SHARED_MONITOR_RUNBOOK_PATH,
    ZOHO_README_PATH,
    CALL_RUNTIME_README_PATH,
    REQUEST_FORM_README_PATH,
    SETUP_FORM_README_PATH,
)
FORMS_MANIFEST_PATH = ROOT / "src" / "zoho-forms" / "free-revenue-leak-test" / "forms-manifest.json"
FORM2_ROUTES_PATH = ROOT / "src" / "zoho-catalyst" / "revenue-leak-test-setup-form" / "config" / "routes.json"
CALL_PROFILES_PATH = (
    ROOT
    / "src"
    / "zoho-catalyst"
    / "revenue-desk-call-runtime"
    / "functions"
    / "revenue_desk_call_gateway"
    / "contracts"
    / "capability-profiles.json"
)
CALL_RUNTIME_ROOT = ROOT / "src" / "zoho-catalyst" / "revenue-desk-call-runtime"
CALL_RUNTIME_SCHEMA_PATH = CALL_RUNTIME_ROOT / "config" / "datastore-schema.json"
CALL_RUNTIME_READINESS_PATH = CALL_RUNTIME_ROOT / "config" / "runtime-readiness.json"
CALL_APPROVAL_RUNBOOK_PATH = CALL_RUNTIME_ROOT / "route-approval-control-plane-runbook.md"
CALL_GATEWAY_SOURCE = CALL_RUNTIME_ROOT / "functions" / "revenue_desk_call_gateway"
ANALYTICS_CONTRACT_PATH = (
    ROOT
    / "src"
    / "zoho-catalyst"
    / "revenue-desk-analytics"
    / "config"
    / "analytics-sync.json"
)
ANALYTICS_MODEL_CONTRACT_PATH = (
    ROOT
    / "src"
    / "zoho-catalyst"
    / "revenue-desk-analytics"
    / "config"
    / "analytics-model-contract.json"
)
ANALYTICS_DASHBOARD_CONTRACT_PATH = (
    ROOT
    / "src"
    / "zoho-catalyst"
    / "revenue-desk-analytics"
    / "config"
    / "dashboard-contract.json"
)
ANALYTICS_LIVE_SOURCE_PARITY_PATH = (
    ROOT
    / "src"
    / "zoho-catalyst"
    / "revenue-desk-analytics"
    / "config"
    / "live-source-parity.json"
)
KEY_ROTATION_CONTRACT_PATH = (
    ROOT / "docs" / "product" / "free-revenue-leak-test-key-rotation-contract.json"
)
CLIENT_PORTAL_AUDIT_PATH = (
    ROOT
    / "src"
    / "zoho-catalyst"
    / "billing-webhook-gateway"
    / "evidence"
    / "sanitized-live-audit-2026-08-25.json"
)
FUNCTION_PACKAGE_SPECS = (
    (
        "revenue-leak-test-request-form",
        (("revenue_leak_test_request_form", "Advanced I/O", "advancedio", "node24",
          "revenue_leak_test_request_form", "24.x"),),
    ),
    (
        "revenue-leak-test-setup-form",
        (("revenue_leak_test_setup_form", "Advanced I/O", "advancedio", "node24",
          "revenue_leak_test_setup_form", "24.x"),),
    ),
    (
        "revenue-desk-call-runtime",
        (
            ("revenue_desk_call_gateway", "Advanced I/O", "advancedio", "node24",
             "revenue_desk_call_gateway", ">=18 <25"),
            ("revenue_desk_call_worker", "Job", "job", "node24",
             "revenue_desk_call_worker", "24.x"),
        ),
    ),
    (
        "crm-billing-orchestrator",
        (("crm_billing_orchestrator", "Advanced I/O", "advancedio", "node24",
          "crm_billing_orchestrator", "24.x"),),
    ),
    (
        "revenue-desk-analytics",
        (("analytics_sync", "Job", "job", "node24", "analytics_sync", "24.x"),),
    ),
)


class FreeRevenueLeakReleaseContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
        cls.inventory = json.loads(INVENTORY_PATH.read_text(encoding="utf-8"))
        cls.table_disposition = json.loads(TABLE_DISPOSITION_PATH.read_text(encoding="utf-8"))
        cls.packet_a_execution = json.loads(
            PACKET_A_EXECUTION_PATH.read_text(encoding="utf-8")
        )
        cls.packet_a_resolution = json.loads(
            PACKET_A_RESOLUTION_PATH.read_text(encoding="utf-8")
        )
        cls.six_function_deployment = json.loads(
            SIX_FUNCTION_DEPLOYMENT_PATH.read_text(encoding="utf-8")
        )
        cls.route_continuation = json.loads(
            ROUTE_CONTINUATION_PATH.read_text(encoding="utf-8")
        )
        cls.worker_binding_containment = json.loads(
            WORKER_BINDING_CONTAINMENT_PATH.read_text(encoding="utf-8")
        )
        cls.worker_ui_rollback = json.loads(
            WORKER_UI_ROLLBACK_PATH.read_text(encoding="utf-8")
        )
        cls.dark_production_prestate = json.loads(
            DARK_PRODUCTION_PRESTATE_PATH.read_text(encoding="utf-8")
        )
        cls.crm_live_preflight = json.loads(
            CRM_LIVE_PREFLIGHT_PATH.read_text(encoding="utf-8")
        )
        cls.billing_test_catalog_preflight = json.loads(
            BILLING_TEST_CATALOG_PREFLIGHT_PATH.read_text(encoding="utf-8")
        )
        cls.private_route_contract = json.loads(
            PRIVATE_ROUTE_CONTRACT_PATH.read_text(encoding="utf-8")
        )
        cls.analytics_outbox_fence_adr = ANALYTICS_OUTBOX_FENCE_ADR_PATH.read_text(
            encoding="utf-8"
        )
        cls.deployment_log = DEPLOYMENT_LOG_PATH.read_text(encoding="utf-8")
        cls.reconciliation_runbook = RECONCILIATION_RUNBOOK_PATH.read_text(
            encoding="utf-8"
        )
        cls.route_continuation_public_mirrors = {
            path: path.read_text(encoding="utf-8")
            for path in ROUTE_CONTINUATION_PUBLIC_MIRROR_PATHS
        }
        cls.forms_manifest = json.loads(FORMS_MANIFEST_PATH.read_text(encoding="utf-8"))
        cls.form2_routes = json.loads(FORM2_ROUTES_PATH.read_text(encoding="utf-8"))
        cls.call_profiles = json.loads(CALL_PROFILES_PATH.read_text(encoding="utf-8"))
        cls.call_runtime_schema = json.loads(
            CALL_RUNTIME_SCHEMA_PATH.read_text(encoding="utf-8")
        )
        cls.call_runtime_readiness = json.loads(
            CALL_RUNTIME_READINESS_PATH.read_text(encoding="utf-8")
        )
        cls.analytics_contract = json.loads(ANALYTICS_CONTRACT_PATH.read_text(encoding="utf-8"))
        cls.analytics_model_contract = json.loads(
            ANALYTICS_MODEL_CONTRACT_PATH.read_text(encoding="utf-8")
        )
        cls.analytics_dashboard_contract = json.loads(
            ANALYTICS_DASHBOARD_CONTRACT_PATH.read_text(encoding="utf-8")
        )
        cls.analytics_live_source_parity = json.loads(
            ANALYTICS_LIVE_SOURCE_PARITY_PATH.read_text(encoding="utf-8")
        )
        cls.key_rotation_contract = json.loads(
            KEY_ROTATION_CONTRACT_PATH.read_text(encoding="utf-8")
        )
        cls.client_portal_audit = json.loads(
            CLIENT_PORTAL_AUDIT_PATH.read_text(encoding="utf-8")
        )

    def test_commercial_boundary_and_approved_form_names_are_exact(self):
        contract = self.contract
        self.assertEqual(contract["schema_version"], 4)
        self.assertEqual(contract["contract_id"], "sylvara-free-revenue-leak-test-e2e-v4")
        self.assertEqual(contract["status"], "superseding-architecture-contract-not-yet-deployed")
        self.assertEqual(contract["environments"], ["development", "dark_production"])

        migration = contract["identifier_migration"]
        self.assertEqual(migration["from_schema_version"], 3)
        self.assertEqual(
            migration["function_aliases"],
            {
                "form1_assisted_controller": "revenue_leak_test_request_form",
                "form2_controller": "revenue_leak_test_setup_form",
            },
        )
        self.assertFalse(migration["legacy_aliases_are_deployment_targets"])

        self.assertEqual(contract["customer_facing_name"], "Free Revenue Leak Test")
        self.assertEqual(contract["form1"]["customer_facing_name"], "Free Revenue Leak Test Request")
        self.assertEqual(
            contract["form2"]["customer_facing_name"],
            "Free Revenue Leak Test Setup and Authorization",
        )
        forms = {entry["logical_name"]: entry for entry in self.forms_manifest["forms"]}
        self.assertEqual(forms["REVENUE_LEAK_TEST_REQUEST_FORM"]["title"], "Free Revenue Leak Test Request")
        self.assertEqual(
            forms["REVENUE_LEAK_TEST_SETUP_FORM"]["title"],
            "Free Revenue Leak Test Setup and Authorization",
        )

        form1 = contract["form1"]
        form1_manifest = forms["REVENUE_LEAK_TEST_REQUEST_FORM"]
        self.assertEqual(form1["fixed_values"], {
            "entry_offer_form_value": "Free 7-Day Missed-Call",
            "entry_offer_crm_display_value": "7-Day Revenue Leak Test",
            "entry_offer_customer_label": "Free Revenue Leak Test",
            "intake_form_version": "revenue-leak-test-request-v1",
            "contact_consent_version": "form1-contact-consent-v1",
        })
        self.assertEqual(
            form1_manifest["crm_integration"]["entry_offer"],
            form1["fixed_values"]["entry_offer_form_value"],
        )
        self.assertEqual(
            form1_manifest["crm_integration"]["entry_offer_crm_display_value"],
            form1["fixed_values"]["entry_offer_crm_display_value"],
        )
        self.assertEqual(
            form1_manifest["crm_integration"]["entry_offer_customer_label"],
            form1["fixed_values"]["entry_offer_customer_label"],
        )
        self.assertEqual(
            form1_manifest["fixed_metadata"]["intake_form_version"],
            form1["fixed_values"]["intake_form_version"],
        )
        self.assertLessEqual(len(form1["fixed_values"]["intake_form_version"]), 30)
        self.assertEqual(
            form1_manifest["fixed_metadata"]["contact_consent_version"],
            form1["fixed_values"]["contact_consent_version"],
        )
        self.assertEqual(form1_manifest["contact_consent"]["copy"], form1["contact_consent_copy"])
        self.assertFalse(form1_manifest["contact_consent"]["sms"])
        self.assertEqual(form1_manifest["native_notifications"], form1["native_notifications"])
        self.assertFalse(form1["native_otp"])
        self.assertEqual(form1_manifest["confirmation_copy"], form1["confirmation_copy"])

        boundary = contract["commercial_boundary"]
        self.assertEqual(boundary["duration_calendar_days"], 7)
        self.assertEqual(boundary["connected_call_limit"], 25)
        self.assertFalse(boundary["billing_required_to_start"])
        self.assertFalse(boundary["automatic_paid_conversion"])

    def test_forms_contract_matrix_is_exact_and_separates_live_observation(self):
        forms = {
            entry["logical_name"]: entry for entry in self.forms_manifest["forms"]
        }
        form1 = forms["REVENUE_LEAK_TEST_REQUEST_FORM"]
        form2 = forms["REVENUE_LEAK_TEST_SETUP_FORM"]

        evidence = self.forms_manifest["evidence_boundary"]
        self.assertEqual("2026-08-26", evidence["live_readback_date"])
        self.assertTrue(evidence["sanitized"])
        self.assertFalse(
            evidence["live_ids_urls_aliases_and_private_destinations_in_git"]
        )

        dedup = form1["deduplication_contract"]
        self.assertEqual("Intake_Submission_ID", dedup["primary"])
        self.assertEqual("Email", dedup["fallback"])
        self.assertEqual(
            ["Intake_Submission_ID", "Email"], dedup["live_order_observed"]
        )
        self.assertTrue(dedup["fallback_never_replaces_generated_primary_identity"])
        self.assertFalse(dedup["blank_overwrite"])
        self.assertTrue(dedup["workflow_trigger"])
        self.assertEqual(form1["crm_integration"]["deduplication_order"],
                         dedup["live_order_observed"])
        self.assertEqual(
            self.contract["form1"]["public_path"]["deduplication_key"],
            dedup["primary"],
        )
        self.assertEqual(
            self.contract["form1"]["public_path"]["deduplication_fallback"],
            dedup["fallback"],
        )

        form1_fields = form1["field_contract"]
        self.assertEqual(
            [
                "Entry_Offer",
                "Submission_Channel",
                "Free_Test_Contact_Consent_At",
                "Free_Test_Contact_Consent_Version",
                "Free_Test_Request_Submitted_At",
                "Intake_Form_Version",
                "Intake_Submission_ID",
                "Lead_Status",
            ],
            form1_fields["unconditional_hidden_audit_fields"],
        )
        self.assertEqual(
            ["Source_Page"],
            form1_fields["assisted_path_hidden_audit_fields"],
        )
        self.assertEqual(
            [
                "Lead_Source",
                "Source_Page",
                "UTM_Source",
                "UTM_Medium",
                "UTM_Campaign",
                "UTM_Content",
                "UTM_Term",
            ],
            form1_fields["optional_attribution_fields"],
        )
        self.assertFalse(form1_fields["respondent_editable"])
        self.assertEqual(
            [],
            form1_fields[
                "source_required_without_verified_live_field_or_crm_destination"
            ],
        )
        self.assertEqual(
            [
                "field aliases",
                "mandatory flags",
                "personal flags",
                "encryption flags",
                "read-only flags",
            ],
            form1_fields["unresolved_live_properties"],
        )
        self.assertIsNone(form1["assisted_prefill"]["live_alias"])
        self.assertFalse(
            form1["assisted_prefill"][
                "live_dynamic_prefill_webhook_field_configured"
            ]
        )
        release_form1_fields = self.contract["form1"]["hidden_audit_field_contract"]
        self.assertEqual(
            form1_fields["unconditional_hidden_audit_fields"],
            release_form1_fields["unconditional"],
        )
        self.assertEqual(
            form1_fields["assisted_path_hidden_audit_fields"],
            release_form1_fields["assisted_path"],
        )
        self.assertEqual(
            form1_fields["optional_attribution_fields"],
            release_form1_fields["optional_attribution"],
        )
        self.assertEqual(
            ["assisted prefill token field"],
            release_form1_fields["unresolved_source_required"],
        )

        prerequisites = form1["live_configuration_prerequisites"]
        self.assertEqual(
            prerequisites,
            self.contract["form1"]["live_configuration_prerequisites"],
        )
        identity = prerequisites["public_intake_submission_identity"]
        self.assertEqual("unresolved", identity["status"])
        self.assertEqual("Intake_Submission_ID", identity["field"])
        self.assertIsNone(identity["live_generation_owner"])
        self.assertIsNone(identity["live_generation_mechanism"])
        self.assertTrue(identity["live_change_blocked"])
        self.assertIn(
            "generated by an approved non-respondent source before native CRM upsert",
            identity["required_invariants"],
        )
        privacy = prerequisites["privacy_dictionary"]
        self.assertEqual("unresolved", privacy["status"])
        self.assertTrue(privacy["live_change_blocked"])
        self.assertIn(
            "Intake_Submission_ID", privacy["minimum_named_field_scope"]
        )
        self.assertIn(
            "assisted prefill token field", privacy["minimum_named_field_scope"]
        )
        self.assertIn(
            "personal classification", privacy["per_field_decisions_required"]
        )
        self.assertIn(
            "encryption setting", privacy["per_field_decisions_required"]
        )
        self.assertIn(
            "respondent editability", privacy["per_field_decisions_required"]
        )
        self.assertIn("Do not infer", privacy["rule"])

        matrix = form2["field_contract"]
        unconditional = [
            "firstName",
            "lastName",
            "decisionMakerRole",
            "decisionAuthority",
            "businessEmail",
            "directMobileNumber",
            "companyName",
            "legalBusinessName",
            "mainBusinessNumber",
            "phoneSystemProvider",
            "primaryServiceArea",
            "normalBusinessHours",
            "servicesHandled",
            "approvedTestRoute",
            "forwardingAdministratorName",
            "forwardingAdministratorMobile",
            "approvedFallbackDestination",
            "rollbackContactName",
            "rollbackContactMobile",
            "urgentCallHandling",
            "existingCustomerCallHandling",
            "alertRecipientName",
            "alertRecipientEmail",
            "authorizedRepresentativeConfirmed",
            "testScopeAccepted",
        ]
        conditional = [
            {
                "field": "otherServiceDetails",
                "required_when": "servicesHandled contains Other",
                "otherwise": "must_be_null",
            },
            {
                "field": "noAnswerDelay",
                "required_when": (
                    "approvedTestRoute is No Answer / Overflow Only or "
                    "After Hours + Overflow"
                ),
                "otherwise": "must_be_null",
            },
            {
                "field": "approvedFallbackNumber",
                "required_when": (
                    "approvedFallbackDestination is Existing Office Line, "
                    "On-Call Mobile, or Other"
                ),
                "otherwise": "must_be_null",
            },
        ]
        optional = [
            "jobTitle",
            "fieldTeamSizeBand",
            "currentCallHandling",
            "requestedTestRoute",
            "requestedStartDate",
        ]
        self.assertEqual(unconditional, matrix["unconditional_required_client_fields"])
        self.assertEqual(unconditional, form2["required_fields"])
        self.assertEqual(conditional, matrix["conditional_client_fields"])
        self.assertEqual(optional, matrix["optional_client_fields"])
        requested_start_date_semantics = matrix["requested_start_date_semantics"]
        self.assertEqual(
            requested_start_date_semantics,
            self.contract["form2"]["field_contract"][
                "requested_start_date_semantics"
            ],
        )
        self.assertIn("null or blank", requested_start_date_semantics)
        self.assertIn("YYYY-MM-DD", requested_start_date_semantics)
        self.assertEqual(33, matrix["runtime_client_field_count"])
        partitions = [
            set(unconditional),
            {entry["field"] for entry in conditional},
            set(optional),
        ]
        self.assertTrue(all(
            partitions[index].isdisjoint(partitions[other])
            for index in range(len(partitions))
            for other in range(index + 1, len(partitions))
        ))
        self.assertEqual(
            set(form2["submission_webhook"]["client_keys"]),
            set().union(*partitions),
        )
        self.assertEqual(
            36,
            len(form2["submission_webhook"]["server_keys"])
            + len(form2["submission_webhook"]["client_keys"]),
        )
        self.assertEqual(
            36, form2["submission_webhook"]["required_parameter_count"]
        )
        self.assertEqual([], form2["submission_webhook"]["live_required_parameters_missing"])
        self.assertEqual(
            ["testPhoneNumber", "alertRecipientMobile"],
            form2["submission_webhook"]["live_prohibited_extra_parameters"],
        )
        self.assertTrue(
            set(matrix["prohibited_client_fields"]).isdisjoint(
                form2["submission_webhook"]["client_keys"]
            )
        )
        self.assertEqual(
            [
                "businessEmail",
                "directMobileNumber",
                "currentCallHandling",
                "requestedTestRoute",
                "approvedTestRoute",
            ],
            matrix["source_read_only_after_prefill"],
        )
        self.assertEqual("unresolved", matrix["live_read_only_flags"])

        controller_policy = {
            entry["key"]: entry for entry in form2["controller_field_policy"]
        }
        self.assertEqual({"setupToken", "prefillId"}, set(controller_policy))
        for key in ("setupToken", "prefillId"):
            source = controller_policy[key]["source_policy"]
            self.assertTrue(source["mandatory"])
            self.assertTrue(source["personal"])
            self.assertTrue(source["encrypted"])
            self.assertFalse(source["respondent_editable"])
            self.assertIsNone(controller_policy[key]["live_alias"])
            self.assertEqual(
                "unresolved", controller_policy[key]["live_readback"]["read_only"]
            )
        self.assertFalse(controller_policy["setupToken"]["live_readback"]["mandatory"])
        self.assertFalse(controller_policy["setupToken"]["live_readback"]["personal"])
        self.assertFalse(controller_policy["setupToken"]["live_readback"]["encrypted"])
        self.assertFalse(
            controller_policy["setupToken"]["live_readback"]
            ["dynamic_prefill_webhook_field_configured"]
        )
        self.assertFalse(controller_policy["prefillId"]["live_readback"]["mandatory"])
        self.assertTrue(controller_policy["prefillId"]["live_readback"]["personal"])
        self.assertTrue(controller_policy["prefillId"]["live_readback"]["encrypted"])

        respondent_policy = {
            entry["key"]: entry for entry in form2["respondent_field_policy"]
        }
        for key in ("authorizedRepresentativeConfirmed", "testScopeAccepted"):
            self.assertEqual(
                respondent_policy[key]["source_policy"],
                respondent_policy[key]["live_readback"]
                | {"respondent_editable": True, "default": False},
            )
        self.assertTrue(respondent_policy["alertRecipientEmail"]["source_policy"]["mandatory"])
        self.assertFalse(respondent_policy["alertRecipientEmail"]["live_readback"]["mandatory"])

        native = form2["native_action_policy"]
        for key in (
            "native_email_notifications_allowed",
            "native_sms_notifications_allowed",
            "native_approvals_allowed",
            "zoho_sign_allowed",
            "live_native_email_notification_configured",
            "live_sms_gateway_configured",
            "live_native_approval_configured",
            "live_zoho_sign_connection_or_action_observed",
        ):
            self.assertFalse(native[key], key)
        self.assertTrue(native["live_sms_instruction_or_mobile_field_present"])

        release_form2 = self.contract["form2"]
        self.assertEqual(
            release_form2["field_contract"]["unconditional_required_client_fields"],
            unconditional,
        )
        self.assertEqual(
            release_form2["field_contract"]["conditional_client_fields"],
            conditional,
        )
        self.assertEqual(
            release_form2["field_contract"]["optional_client_fields"], optional
        )
        self.assertEqual(
            release_form2["field_contract"]["prohibited_client_fields"],
            matrix["prohibited_client_fields"],
        )
        self.assertEqual(
            release_form2["controller_field_policy"],
            {
                "setupToken": controller_policy["setupToken"]["source_policy"],
                "prefillId": controller_policy["prefillId"]["source_policy"],
                "submissionId": form2["server_generated_submission_field"]
                ["source_policy"],
            },
        )
        self.assertEqual(
            release_form2["native_action_policy"],
            {
                key: native[key]
                for key in (
                    "proof_email_owner",
                    "native_email_notifications_allowed",
                    "native_sms_notifications_allowed",
                    "native_approvals_allowed",
                    "zoho_sign_allowed",
                )
            },
        )

    def test_exact_six_function_and_two_pool_topology(self):
        expected_functions = [
            ("revenue_leak_test_request_form", "Advanced I/O"),
            ("revenue_leak_test_setup_form", "Advanced I/O"),
            ("revenue_desk_call_gateway", "Advanced I/O"),
            ("revenue_desk_call_worker", "Job"),
            ("crm_billing_orchestrator", "Advanced I/O"),
            ("analytics_sync", "Job"),
        ]
        self.assertEqual(
            [(entry["name"], entry["type"]) for entry in self.contract["function_boundaries"]],
            expected_functions,
        )
        self.assertTrue(all(
            entry["decision"] == "canonical_active"
            for entry in self.contract["function_boundaries"]
        ))

        topology = self.inventory["topology_decision"]
        self.assertEqual(topology["canonical_project_count"], 1)
        self.assertEqual(topology["final_active_function_count"], 6)
        self.assertEqual(
            topology["final_active_functions"],
            [name for name, _ in expected_functions],
        )
        self.assertEqual(
            [(entry["api_name"], entry["type"]) for entry in self.inventory["functions"]],
            expected_functions,
        )
        self.assertFalse(topology["separate_free_and_paid_call_stacks_allowed"])

        registries = self.contract["environment_variable_registries"]
        self.assertEqual(
            [entry["function"] for entry in registries],
            [name for name, _ in expected_functions],
        )
        shared_registry = "../../src/zoho-catalyst/revenue-desk-call-runtime/config/variables.json"
        self.assertEqual(registries[2]["path"], shared_registry)
        self.assertEqual(registries[3]["path"], shared_registry)

        expected_pools = [
            ("RevenueDeskCallJobs", "revenue_desk_call_worker"),
            ("RevenueDeskAnalyticsJobs", "analytics_sync"),
        ]
        self.assertEqual(
            [(entry["name"], entry["target"]) for entry in self.contract["function_job_pools"]],
            expected_pools,
        )
        self.assertEqual(
            [(entry["name"], entry["target"]) for entry in self.inventory["function_job_pools"]],
            expected_pools,
        )
        self.assertEqual(
            self.contract["function_job_pools"][0]["modes"],
            ["process_event", "retry_scan", "rebuild_report", "reconcile_deployment"],
        )
        analytics_pool = self.contract["function_job_pools"][1]
        self.assertEqual(analytics_pool["job_params"], {})
        self.assertFalse(analytics_pool["caller_controlled_job_params_allowed"])
        self.assertNotIn("modes", analytics_pool)
        self.assertEqual(
            analytics_pool["runtime_modes"],
            {
                "development": ["disabled", "readiness", "active"],
                "production": ["disabled", "readiness"],
            },
        )
        inventory_analytics_pool = self.inventory["function_job_pools"][1]
        self.assertEqual(inventory_analytics_pool["job_params"], {})
        self.assertFalse(inventory_analytics_pool["caller_controlled_job_params_allowed"])
        self.assertNotIn("allowed_modes", inventory_analytics_pool)
        for pool in self.inventory["function_job_pools"]:
            readback = pool["development_readback"]
            self.assertTrue(readback["exists"])
            self.assertEqual(readback["type"], "Function")
            self.assertEqual(readback["memory_mb"], 512)
            self.assertFalse(readback["function_binding_attribute_applicable"])
            self.assertFalse(readback["job_target_binding_proven"])
            self.assertTrue(readback["cron_inventory_readback_complete"])
            self.assertEqual(readback["cron_reference_count"], 0)

        source_analytics_pool = self.analytics_contract["job_pool"]
        self.assertEqual(source_analytics_pool["name"], "RevenueDeskAnalyticsJobs")
        self.assertEqual(source_analytics_pool["job_params"], {})
        self.assertFalse(source_analytics_pool["platform_retries_enabled"])
        self.assertEqual(
            self.analytics_contract["runtime_modes"],
            {
                "development": ["disabled", "readiness", "active"],
                "production": ["disabled", "readiness"],
            },
        )
        dark_analytics = self.analytics_contract["production_dark_contract"]
        self.assertFalse(dark_analytics["sdk_initialization"])
        self.assertEqual(dark_analytics["datastore_reads"], 0)
        self.assertEqual(dark_analytics["datastore_writes"], 0)
        self.assertEqual(dark_analytics["analytics_reads"], 0)
        self.assertEqual(dark_analytics["analytics_writes"], 0)

    def test_executable_packages_match_the_six_function_contract(self):
        inventory = {entry["api_name"]: entry for entry in self.inventory["functions"]}
        registries = {
            entry["function"]: entry["path"]
            for entry in self.contract["environment_variable_registries"]
        }
        observed_names = []
        for package_directory, functions in FUNCTION_PACKAGE_SPECS:
            package_root = ROOT / "src" / "zoho-catalyst" / package_directory
            manifest = json.loads((package_root / "catalyst.json").read_text(encoding="utf-8"))
            expected_targets = [spec[0] for spec in functions]
            self.assertEqual(manifest["functions"]["source"], "functions")
            self.assertEqual(manifest["functions"]["targets"], expected_targets)
            self.assertEqual(manifest["functions"]["ignore"], ["test/**", ".env*"])

            registry_path = (package_root / "config" / "variables.json").resolve()
            for (name, public_type, catalyst_type, stack, package_name,
                 node_engine) in functions:
                with self.subTest(function=name):
                    observed_names.append(name)
                    source = package_root / "functions" / name
                    self.assertTrue(source.is_dir())
                    self.assertEqual(
                        inventory[name]["source_path"],
                        source.relative_to(ROOT).as_posix(),
                    )
                    self.assertEqual(inventory[name]["type"], public_type)
                    declared_registry = (CONTRACT_PATH.parent / registries[name]).resolve()
                    self.assertEqual(declared_registry, registry_path)

                    catalyst = json.loads(
                        (source / "catalyst-config.json").read_text(encoding="utf-8")
                    )
                    self.assertEqual(catalyst["deployment"], {
                        "name": name,
                        "stack": stack,
                        "type": catalyst_type,
                    })
                    self.assertEqual(catalyst["execution"]["main"], "index.js")

                    package = json.loads((source / "package.json").read_text(encoding="utf-8"))
                    lock = json.loads((source / "package-lock.json").read_text(encoding="utf-8"))
                    self.assertEqual(package["name"], package_name)
                    self.assertEqual(package["name"], name)
                    self.assertEqual(package["engines"]["node"], node_engine)
                    self.assertEqual(lock["name"], name)
                    self.assertEqual(lock["packages"][""]["name"], package_name)
                    self.assertEqual(lock["packages"][""]["name"], name)
                    self.assertEqual(lock["packages"][""]["engines"]["node"], node_engine)
                    if name == "revenue_desk_call_worker":
                        dependency = "file:../revenue_desk_call_gateway"
                        self.assertNotIn("zcatalyst-sdk-node", package.get("dependencies", {}))
                        self.assertEqual(
                            package["dependencies"]["revenue_desk_call_gateway"], dependency
                        )
                        self.assertEqual(
                            lock["packages"][""]["dependencies"][
                                "revenue_desk_call_gateway"
                            ],
                            dependency,
                        )
                    else:
                        self.assertEqual(package["dependencies"]["zcatalyst-sdk-node"], "3.4.0")
                        self.assertEqual(
                            lock["packages"][""]["dependencies"]["zcatalyst-sdk-node"],
                            "3.4.0",
                        )
                        self.assertEqual(
                            lock["packages"]["node_modules/zcatalyst-sdk-node"]["version"],
                            "3.4.0",
                        )

        self.assertEqual(observed_names, self.inventory["topology_decision"]
                         ["final_active_functions"])

    def test_shared_runtime_profiles_fail_closed(self):
        runtime = self.contract["shared_call_runtime"]
        self.assertEqual(runtime["gateway"], "revenue_desk_call_gateway")
        self.assertEqual(runtime["worker"], "revenue_desk_call_worker")
        self.assertEqual(runtime["engagement_types"], ["free_test", "paid_service"])
        self.assertEqual(runtime["unknown_profile_behavior"], "reject")
        self.assertEqual(runtime["unpublished_profile_behavior"], "reject")
        self.assertEqual(runtime["disabled_profile_behavior"], "reject")

        profiles = runtime["capability_profiles"]
        free_profile = profiles[0]
        self.assertEqual(free_profile["name"], "call_gap_monitor_v1")
        self.assertEqual(free_profile["engagement_type"], "free_test")
        self.assertEqual(free_profile["status"], "active")
        self.assertEqual(free_profile["publication_status"], "published")
        self.assertIn("SMS", free_profile["prohibited_capabilities"])

        paid_profiles = profiles[1:]
        self.assertEqual(
            [(entry["name"], entry["plan_tier"]) for entry in paid_profiles],
            [("launch_v1", "Launch"), ("growth_v1", "Growth"), ("scale_v1", "Scale")],
        )
        self.assertTrue(all(entry["engagement_type"] == "paid_service" for entry in paid_profiles))
        self.assertTrue(all(entry["status"] == "disabled" for entry in paid_profiles))
        self.assertTrue(all(entry["publication_status"] == "draft" for entry in paid_profiles))
        self.assertTrue(all(not entry["runtime_activation_allowed"] for entry in paid_profiles))
        self.assertTrue(all(not entry["conversation_behavior_implemented"] for entry in paid_profiles))

        inventory_free = self.inventory["shared_runtime"]["free_profile"]
        self.assertEqual(inventory_free["name"], "call_gap_monitor_v1")
        self.assertEqual(inventory_free["status"], "active")
        self.assertEqual(inventory_free["publication_status"], "published")
        inventory_paid = self.inventory["shared_runtime"]["paid_profiles"]
        self.assertEqual(
            [(entry["name"], entry["plan_tier"]) for entry in inventory_paid],
            [("launch_v1", "Launch"), ("growth_v1", "Growth"), ("scale_v1", "Scale")],
        )
        self.assertTrue(all(entry["status"] == "disabled" for entry in inventory_paid))
        self.assertTrue(all(entry["publication_status"] == "draft" for entry in inventory_paid))

        source_profiles = self.call_profiles["profiles"]
        self.assertEqual(
            [(entry["id"], entry["engagement_type"]) for entry in source_profiles],
            [
                ("call_gap_monitor_v1", "free_test"),
                ("launch_v1", "paid_service"),
                ("growth_v1", "paid_service"),
                ("scale_v1", "paid_service"),
            ],
        )
        self.assertTrue(source_profiles[0]["enabled"])
        self.assertEqual(source_profiles[0]["status"], "active")
        self.assertTrue(all(not entry["enabled"] for entry in source_profiles[1:]))
        self.assertTrue(all(entry["status"] == "draft" for entry in source_profiles[1:]))

        required_fields = self.contract["catalyst_data_contracts"]["required_deployment_configuration_fields"]
        self.assertEqual(required_fields, [
            "ENGAGEMENT_TYPE",
            "CAPABILITY_PROFILE",
            "PLAN_TIER",
            "CONFIGURATION_VERSION",
            "DEPLOYMENT_STATUS",
            "GO_LIVE_APPROVAL_STATUS",
            "LIMIT_POLICY",
            "BILLING_MODE",
            "NUMBER_OWNERSHIP",
            "ENVIRONMENT",
            "SOURCE_REVISION",
        ])

    def test_route_approval_and_activation_control_is_evidence_bound_and_out_of_band(self):
        states = {entry["state"]: entry for entry in self.contract["state_machine"]}
        approval = states["INTERNAL_GO_LIVE_APPROVED"]
        activation = states["TEST_LIVE"]
        self.assertIn("Test Status=Scheduled", approval["effects"])
        self.assertIn("actual start and expiry remain null", approval["effects"])
        self.assertIn(
            "fresh authoritative external-route activation readback",
            activation["required_evidence"],
        )
        self.assertIn(
            "Expires At equals Actual Start At plus exactly 604800000 ms",
            activation["effects"],
        )

        runtime = self.contract["shared_call_runtime"]
        self.assertEqual(runtime["gateway_route_count"], 3)
        self.assertEqual(runtime["gateway_routes"], [
            "POST /retell/inbound",
            "POST /retell/events",
            "GET /internal/readiness",
        ])
        self.assertFalse(runtime["approval_control"]["adds_function_route_or_worker_mode"])
        self.assertTrue(runtime["approval_control"]["approval_and_activation_are_distinct"])
        self.assertEqual(runtime["approval_control"]["capacity_reservation_subsystem"], "absent")

        inventory_control = self.inventory["route_approval_control_plane"]
        self.assertEqual(inventory_control["function_count_increment"], 0)
        self.assertFalse(inventory_control["capacity_reservation_subsystem_present"])
        self.assertEqual(inventory_control["gateway_routes"], runtime["gateway_routes"])
        self.assertEqual(
            inventory_control["worker_modes"],
            ["process_event", "retry_scan", "rebuild_report", "reconcile_deployment"],
        )

        schema_tables = {
            table["api_name"]: table for table in self.call_runtime_schema["tables"]
        }
        deployment_columns = {
            column["api_name"]: column
            for column in schema_tables["RevenueDeskDeployments"]["columns"]
        }
        receipt_columns = {
            column["api_name"]: column
            for column in schema_tables["RevenueDeskEventReceipts"]["columns"]
        }
        authorization_columns = self.contract["catalyst_data_contracts"][
            "authorization_columns"
        ]
        for name in authorization_columns["deployment_nullable"]:
            self.assertIn(name, deployment_columns)
            self.assertFalse(deployment_columns[name]["mandatory"])
        for name in authorization_columns["receipt_nullable"]:
            self.assertIn(name, receipt_columns)
            self.assertFalse(receipt_columns[name]["mandatory"])

        readiness = self.call_runtime_readiness["approval_control"]
        self.assertFalse(readiness["adds_gateway_route_function_or_worker_mode"])
        self.assertTrue(readiness["runtime_requires_exact_approval_and_activation_receipts"])
        self.assertFalse(readiness["capacity_reservation_subsystem_present"])
        self.assertFalse(self.call_runtime_readiness["legacy_deletion_gate"]["safe"])
        self.assertTrue(
            self.call_runtime_readiness["legacy_deletion_gate"]["source_export_required"]
        )
        self.assertTrue(
            self.call_runtime_readiness["legacy_deletion_gate"]["live_binding_proof_required"]
        )

        runbook = CALL_APPROVAL_RUNBOOK_PATH.read_text(encoding="utf-8")
        for phrase in (
            "Exact prestate",
            "Conditional update timeout",
            "authoritative route readback",
            "604800000 ms",
            "source export",
            "live-binding proof",
            "stopped but recoverable",
        ):
            self.assertIn(phrase, runbook)

        boundary_source = (CALL_GATEWAY_SOURCE / "lib" / "runtime-boundary.js").read_text(
            encoding="utf-8"
        )
        job_source = (CALL_GATEWAY_SOURCE / "lib" / "job-handler.js").read_text(
            encoding="utf-8"
        )
        approval_source = (CALL_GATEWAY_SOURCE / "lib" / "approval-control.js").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("/internal/approval", boundary_source)
        self.assertNotIn("approve_route", job_source)
        self.assertNotIn("activate_route", job_source)
        self.assertNotIn("decideCapacityReservation", approval_source)
        self.assertNotIn("active_reservation_count", approval_source)

        legacy = {
            entry["name"]: entry
            for entry in self.contract["legacy_function_migration"]["functions"]
        }["retell_route_approval_control"]
        for phrase in ("source/dependency/test export", "live route", "independently prove absence"):
            self.assertIn(phrase, legacy["required_action"])

    def test_canonical_tables_and_migration_boundary_are_exact(self):
        data = self.contract["catalyst_data_contracts"]
        self.assertEqual(data["canonical_call_tables"], [
            "RevenueDeskDeployments",
            "RevenueDeskConfigurationVersions",
            "RevenueDeskEventReceipts",
            "RevenueDeskCalls",
            "RevenueDeskNotifications",
        ])
        self.assertEqual(data["configuration_version_authority"], "RevenueDeskConfigurationVersions")
        self.assertEqual(data["required_form1_tables"], ["RevenueLeakTestRequestFormSessions"])
        self.assertEqual(data["required_form2_v3_tables"], [
            "Form2SessionsV3Runtime",
            "Form2PrefillsV3",
            "Form2SubmissionsV3",
            "Form2VerificationProofsV3",
        ])
        self.assertEqual(data["supporting_tables"], [
            "CRMBillingOperations",
            "AnalyticsSyncCheckpoints",
            "AnalyticsSyncOutbox",
        ])
        self.assertFalse(data["app_user_access"])
        self.assertEqual(self.inventory["canonical_tables"]["call_runtime"], data["canonical_call_tables"])
        self.assertEqual(self.inventory["canonical_tables"]["form1"], data["required_form1_tables"])
        self.assertEqual(self.inventory["canonical_tables"]["form2"], data["required_form2_v3_tables"])
        self.assertEqual(self.inventory["canonical_tables"]["supporting"], data["supporting_tables"])
        resource_readback = self.inventory["development_resource_readback_2026_08_26"]
        inventory_authorization = self.inventory["authorization"]
        self.assertFalse(inventory_authorization["manifest_is_live_state_evidence"])
        self.assertFalse(
            inventory_authorization["manifest_is_development_change_authority"]
        )
        self.assertFalse(
            inventory_authorization["retell_agent_development_or_testing_authorized"]
        )
        self.assertFalse(inventory_authorization["packet_a_resolution_approval_reusable"])
        self.assertTrue(inventory_authorization["development_change_approval_scope_finite"])
        self.assertTrue(
            inventory_authorization
            ["development_change_approval_exhausted_after_verified_poststate"]
        )
        self.assertFalse(
            inventory_authorization["development_change_approval_reusable"]
        )
        self.assertTrue(
            inventory_authorization
            ["live_changes_require_scoped_approval_and_independent_readback"]
        )
        self.assertTrue(
            resource_readback["configuration_version_required_application_columns_exact"]
        )
        self.assertEqual(resource_readback["analytics_checkpoints_row_count"], 10)
        self.assertEqual(resource_readback["analytics_checkpoints_legacy_row_count"], 10)
        self.assertEqual(
            resource_readback["analytics_checkpoints_additive_v2_row_count"], 0
        )
        self.assertTrue(
            resource_readback["analytics_checkpoints_required_application_columns_exact"]
        )
        self.assertEqual(resource_readback["analytics_outbox_row_count"], 307)
        self.assertEqual(resource_readback["analytics_outbox_legacy_row_count"], 307)
        self.assertEqual(resource_readback["analytics_outbox_additive_v2_row_count"], 0)
        self.assertEqual(
            resource_readback["analytics_outbox_nonnull_outbox_key_row_count"], 0
        )
        self.assertTrue(resource_readback["analytics_outbox_single_key_contract_exact"])
        self.assertTrue(resource_readback["analytics_legacy_rows_excluded_from_v2_lane"])
        self.assertEqual(
            resource_readback["packet_a_execution_evidence"],
            "evidence/free-revenue-leak-test-development-packet-a-execution-2026-08-26.json",
        )
        self.assertEqual(
            resource_readback["packet_a_resolution_evidence"],
            "evidence/free-revenue-leak-test-development-packet-a-resolution-2026-08-26.json",
        )
        self.assertEqual(
            resource_readback["canonical_job_pools"],
            [
                {
                    "name": "RevenueDeskCallJobs",
                    "type": "Function",
                    "memory_mb": 512,
                    "function_binding_attribute_applicable": False,
                    "job_target_binding_proven": False,
                    "complete_cron_reference_inventory_proven_at_packet_a": False,
                },
                {
                    "name": "RevenueDeskAnalyticsJobs",
                    "type": "Function",
                    "memory_mb": 512,
                    "function_binding_attribute_applicable": False,
                    "job_target_binding_proven": False,
                    "complete_cron_reference_inventory_proven_at_packet_a": False,
                },
            ],
        )
        interpretation = resource_readback["interpretation"]
        self.assertIn(
            "Two bounded disposable proof tables and their synthetic rows were "
            "created and deleted",
            interpretation,
        )
        self.assertIn("the table count returned from 36 to 35", interpretation)
        self.assertIn(
            "No retained or canonical business record, function, route, Retell "
            "agent, or Production state changed",
            interpretation,
        )

        catalyst_root = ROOT / "src" / "zoho-catalyst"
        request_schema = json.loads((
            catalyst_root / "revenue-leak-test-request-form" / "config"
            / "datastore-schema.json"
        ).read_text(encoding="utf-8"))
        setup_schema = json.loads((
            catalyst_root / "revenue-leak-test-setup-form" / "config"
            / "datastore-schema.json"
        ).read_text(encoding="utf-8"))
        crm_schema = json.loads((
            catalyst_root / "crm-billing-orchestrator" / "config"
            / "datastore-schema.json"
        ).read_text(encoding="utf-8"))
        call_schema = json.loads((
            catalyst_root / "revenue-desk-call-runtime" / "config"
            / "datastore-schema.json"
        ).read_text(encoding="utf-8"))
        analytics_schema = json.loads((
            catalyst_root / "revenue-desk-analytics" / "config"
            / "datastore-schema.json"
        ).read_text(encoding="utf-8"))

        self.assertEqual(
            [entry["expected_api_name"] for entry in request_schema["tables"]],
            data["required_form1_tables"],
        )
        self.assertEqual(
            [entry["expected_api_name"] for entry in setup_schema["tables"]],
            data["required_form2_v3_tables"],
        )
        self.assertEqual(crm_schema["table"], "CRMBillingOperations")
        self.assertEqual(
            [entry["api_name"] for entry in call_schema["tables"]],
            [*data["canonical_call_tables"], "AnalyticsSyncOutbox"],
        )
        self.assertEqual(
            [entry["api_name"] for entry in analytics_schema["tables"]],
            ["AnalyticsSyncCheckpoints", "AnalyticsSyncOutbox"],
        )

        call_outbox = next(
            entry for entry in call_schema["tables"]
            if entry["api_name"] == "AnalyticsSyncOutbox"
        )
        analytics_outbox = next(
            entry for entry in analytics_schema["tables"]
            if entry["api_name"] == "AnalyticsSyncOutbox"
        )
        parity_fields = (
            "api_name", "type", "max_length", "mandatory", "unique",
            "private", "audit_consent", "required_for_v2_rows",
        )
        normalize = lambda column: {
            field: column.get(field) for field in parity_fields
        }
        self.assertEqual(
            {
                column["api_name"]: normalize(column)
                for column in call_outbox["columns"]
            },
            {
                column["api_name"]: normalize(column)
                for column in analytics_outbox["columns"]
            },
        )

    def test_all_development_tables_have_lossless_fail_closed_dispositions(self):
        plan = self.table_disposition
        self.assertEqual(plan["schema_version"], 1)
        self.assertEqual(plan["environment"], "Development")
        self.assertEqual(
            plan["status"],
            "current-sanitized-disposition-live-bindings-private-archive-and-scoped-deletion-approval-required",
        )
        self.assertFalse(plan["authorization"]["manifest_authorizes_migration"])
        self.assertFalse(plan["authorization"]["manifest_authorizes_deletion"])
        self.assertFalse(
            plan["authorization"]["manifest_is_development_change_authority"]
        )
        self.assertTrue(plan["authorization"]["scoped_destructive_approval_required"])
        self.assertTrue(plan["authorization"]["independent_readback_required"])

        observed = plan["observed_tables"]
        self.assertEqual(len(observed), 35)
        self.assertEqual(len({entry["api_name"] for entry in observed}), 35)
        self.assertEqual(sum(entry["observed_rows"] for entry in observed), 466)
        self.assertEqual(sum(entry["observed_rows"] > 0 for entry in observed), 16)
        self.assertEqual(sum(entry["observed_rows"] == 0 for entry in observed), 19)
        for entry in observed:
            self.assertEqual(entry["row_count_observed_at"], "2026-08-27")
            self.assertEqual(
                entry["row_count_method"], "complete-cursor-pagination"
            )
        self.assertEqual(plan["observed_at"], "2026-08-24")
        self.assertEqual(plan["exact_row_count_snapshot"], {
            "table_count": 29,
            "row_count": 466,
            "nonzero_table_count": 16,
            "zero_row_table_count": 13,
        })
        current_presence = plan["current_table_presence"]
        self.assertEqual(current_presence["observed_at"], "2026-08-27")
        self.assertEqual(current_presence["method"], (
            "complete-cursor-pagination-for-all-tables-with-per-table-row-count-and-"
            "zero-nonzero-classification"
        ))
        self.assertEqual(current_presence["default_readback_page_size"], 200)
        self.assertEqual(current_presence["readback_page_count"], 36)
        self.assertTrue(current_presence["pagination_complete_for_all_tables"])
        self.assertTrue(current_presence["per_table_row_count_complete"])
        self.assertTrue(
            current_presence["per_table_zero_nonzero_classification_complete"]
        )
        self.assertEqual(current_presence["classified_table_count"], 35)
        self.assertEqual(current_presence["table_count"], 35)
        self.assertEqual(current_presence["aggregate_row_count"], 466)
        self.assertEqual(current_presence["nonzero_table_count"], 16)
        self.assertEqual(current_presence["zero_row_table_count"], 19)
        self.assertTrue(current_presence["exact_aggregate_row_count_refreshed"])
        self.assertEqual(
            current_presence["aggregate_row_count"],
            sum(entry["observed_rows"] for entry in observed),
        )
        self.assertTrue(
            current_presence["configuration_version_required_application_columns_exact"]
        )
        self.assertEqual(current_presence["analytics_outbox_row_count"], 307)
        self.assertEqual(
            current_presence["analytics_outbox_count_method"],
            "full-pagination-and-row-schema-version-classification",
        )
        self.assertTrue(current_presence["analytics_outbox_pagination_complete"])
        self.assertEqual(current_presence["analytics_outbox_legacy_row_count"], 307)
        self.assertEqual(current_presence["analytics_outbox_v2_row_count"], 0)
        self.assertEqual(current_presence["analytics_outbox_nonnull_outbox_key_count"], 0)
        self.assertTrue(current_presence["analytics_outbox_single_key_contract_exact"])
        self.assertEqual(current_presence["analytics_checkpoints_row_count"], 10)
        self.assertEqual(
            current_presence["analytics_checkpoints_count_method"],
            "full-pagination-and-row-schema-version-classification",
        )
        self.assertTrue(current_presence["analytics_checkpoints_pagination_complete"])
        self.assertEqual(current_presence["analytics_checkpoints_v2_row_count"], 0)
        self.assertTrue(
            current_presence["analytics_checkpoints_required_application_columns_exact"]
        )
        self.assertEqual(
            current_presence["packet_a_execution_evidence"],
            "evidence/free-revenue-leak-test-development-packet-a-execution-2026-08-26.json",
        )
        self.assertEqual(
            current_presence["packet_a_resolution_evidence"],
            "evidence/free-revenue-leak-test-development-packet-a-resolution-2026-08-26.json",
        )
        self.assertEqual(plan["row_accounting"], {
            "retained_in_place": 317,
            "private_quarantine_required": 149,
            "discarded_without_evidence": 0,
        })
        self.assertEqual(
            plan["row_accounting"]["retained_in_place"]
            + plan["row_accounting"]["private_quarantine_required"],
            plan["exact_row_count_snapshot"]["row_count"],
        )

        by_action = {}
        for entry in observed:
            by_action.setdefault(entry["action"], []).append(entry)
            for field in (
                "owner", "purpose", "generation", "expected_readers", "expected_writers",
                "ownership_evidence", "semantic_successors", "gate_profile", "rollback",
            ):
                self.assertIn(field, entry, f"{entry['api_name']} is missing {field}")
            self.assertFalse(entry["active_bindings_verified"])
            self.assertFalse(entry["active_promotion_allowed"])
            self.assertIn(entry["gate_profile"], plan["gate_profiles"])
            self.assertTrue(plan["gate_profiles"][entry["gate_profile"]])

        self.assertEqual(len(by_action.get("retain_additive", [])), 0)
        self.assertEqual(len(by_action["retain_bind_canonical"]), 13)
        self.assertEqual(len(by_action["quarantine_then_delete"]), 14)
        self.assertEqual(len(by_action["delete_after_dependency_absence"]), 8)
        self.assertEqual(plan["disposition_counts"], {
            "retain_additive": 0,
            "retain_bind_canonical": 13,
            "quarantine_then_delete": 14,
            "delete_after_dependency_absence": 8,
            "create_additive_canonical": 0,
            "final_canonical_tables": 13,
        })
        self.assertTrue(all(
            entry["observed_rows"] > 0
            for entry in by_action["quarantine_then_delete"]
        ))
        self.assertTrue(all(
            entry["observed_rows"] == 0
            for entry in by_action["delete_after_dependency_absence"]
        ))
        self.assertFalse(any(
            entry["observed_rows"] > 0 and entry["action"] == "delete_after_dependency_absence"
            for entry in observed
        ))

        expected_nonzero = self.inventory[
            "development_data_store_readback_2026_08_24"
        ]["nonzero_table_counts"]
        self.assertEqual(
            {entry["api_name"]: entry["observed_rows"] for entry in observed if entry["observed_rows"]},
            expected_nonzero,
        )

        contracts = self.contract["catalyst_data_contracts"]
        expected_final = {
            *contracts["canonical_call_tables"],
            *contracts["required_form1_tables"],
            *contracts["required_form2_v3_tables"],
            *contracts["supporting_tables"],
        }
        retained = {
            entry["api_name"]
            for entry in observed
            if entry["action"] in {"retain_additive", "retain_bind_canonical"}
        }
        created = {entry["api_name"] for entry in plan["canonical_tables_to_create"]}
        self.assertEqual(len(created), 0)
        self.assertEqual(retained | created, expected_final)
        self.assertEqual(set(plan["final_canonical_tables"]), expected_final)
        self.assertEqual(len(plan["final_canonical_tables"]), 13)

        call_schema = json.loads((
            ROOT / "src" / "zoho-catalyst" / "revenue-desk-call-runtime"
            / "config" / "datastore-schema.json"
        ).read_text(encoding="utf-8"))
        request_schema = json.loads((
            ROOT / "src" / "zoho-catalyst" / "revenue-leak-test-request-form"
            / "config" / "datastore-schema.json"
        ).read_text(encoding="utf-8"))
        schema_retained_targets = {
            entry["api_name"] for entry in call_schema["tables"]
            if entry["api_name"] in contracts["canonical_call_tables"]
        } | {
            entry["expected_api_name"] for entry in request_schema["tables"]
        }
        expected_newly_observed = {
            *contracts["canonical_call_tables"],
            *contracts["required_form1_tables"],
        }
        self.assertEqual(schema_retained_targets, expected_newly_observed)
        self.assertTrue(schema_retained_targets <= retained)
        self.assertEqual(
            set(current_presence["new_canonical_tables_confirmed_empty"]),
            expected_newly_observed,
        )

        analytics = {entry["api_name"]: entry for entry in observed}
        for name in ("AnalyticsSyncCheckpoints", "AnalyticsSyncOutbox"):
            self.assertEqual(analytics[name]["action"], "retain_bind_canonical")
            self.assertEqual(
                analytics[name]["gate_profile"],
                "retain_bind_nonempty_legacy_excluded",
            )
            self.assertEqual(analytics[name]["row_schema_version_2_rows"], 0)
            self.assertTrue(analytics[name]["legacy_rows_excluded_from_canonical_v2_lane"])
        self.assertEqual(analytics["AnalyticsSyncCheckpoints"]["legacy_rows"], 10)
        self.assertTrue(
            analytics["AnalyticsSyncCheckpoints"]
            ["required_application_columns_exact"]
        )
        self.assertEqual(analytics["AnalyticsSyncOutbox"]["legacy_rows"], 307)
        self.assertEqual(analytics["AnalyticsSyncOutbox"]["nonnull_outbox_key_rows"], 0)
        self.assertTrue(analytics["AnalyticsSyncOutbox"]["single_key_contract_exact"])
        self.assertEqual(
            analytics["RevenueDeskConfigurationVersions"]["action"],
            "retain_bind_canonical",
        )
        self.assertEqual(
            analytics["RevenueDeskConfigurationVersions"]["gate_profile"],
            "retain_bind_empty",
        )
        self.assertEqual(
            analytics["RevenueDeskConfigurationVersions"]["generation"],
            "canonical-call-runtime",
        )
        self.assertTrue(
            analytics["RevenueDeskConfigurationVersions"]
            ["required_application_columns_exact"]
        )
        for name in (
            "RevenueDeskDeployments",
            "RevenueDeskEventReceipts",
            "RevenueDeskCalls",
            "RevenueDeskNotifications",
            "RevenueLeakTestRequestFormSessions",
        ):
            self.assertEqual(analytics[name]["action"], "retain_bind_canonical")
            self.assertEqual(analytics[name]["gate_profile"], "retain_bind_empty")
        expected_runtime_io = {
            "RevenueDeskDeployments": (
                ["revenue_desk_call_gateway", "revenue_desk_call_worker"],
                ["revenue_desk_call_worker"],
            ),
            "RevenueDeskConfigurationVersions": (
                ["revenue_desk_call_gateway", "revenue_desk_call_worker"],
                [],
            ),
            "RevenueDeskEventReceipts": (
                ["revenue_desk_call_gateway", "revenue_desk_call_worker"],
                ["revenue_desk_call_gateway", "revenue_desk_call_worker"],
            ),
            "RevenueDeskCalls": (
                ["revenue_desk_call_gateway", "revenue_desk_call_worker"],
                ["revenue_desk_call_worker"],
            ),
            "RevenueDeskNotifications": (
                ["revenue_desk_call_gateway", "revenue_desk_call_worker"],
                ["revenue_desk_call_worker"],
            ),
            "RevenueLeakTestRequestFormSessions": (
                ["revenue_leak_test_request_form"],
                ["revenue_leak_test_request_form"],
            ),
        }
        for name, (readers, writers) in expected_runtime_io.items():
            self.assertEqual(analytics[name]["observed_rows"], 0)
            self.assertEqual(analytics[name]["row_count_observed_at"], "2026-08-27")
            self.assertEqual(
                analytics[name]["row_count_method"], "complete-cursor-pagination"
            )
            self.assertEqual(analytics[name]["expected_readers"], readers)
            self.assertEqual(analytics[name]["expected_writers"], writers)
        probes = {
            "Form2SessionsV3",
            "ZZZ_Quarantined_Form2SessionsV3_ColumnProbe",
            "ZZZ_Quarantined_Form2SessionsV3_TypeProbe",
        }
        self.assertTrue(all(
            analytics[name]["generation"] == "quarantined-probe"
            and not analytics[name]["expected_readers"]
            and not analytics[name]["expected_writers"]
            for name in probes
        ))

        serialized = json.dumps(plan, sort_keys=True).lower()
        for forbidden in (
            "client_secret", "refresh_token", "access_token", "invoke_url",
            "project_id", "organization_id", "http://", "https://",
        ):
            self.assertNotIn(forbidden, serialized)
        self.assertTrue(all(value is False for value in plan["privacy_boundary"].values()))

    def test_development_packet_a_partial_execution_is_contained_and_sanitized(self):
        evidence = self.packet_a_execution
        self.assertEqual(evidence["schema_version"], 1)
        self.assertEqual(evidence["environment"], "Development")
        self.assertEqual(evidence["outcome"], "contained_partial_success")
        self.assertTrue(evidence["authorization"]["stop_on_any_mismatch"])
        self.assertTrue(evidence["authorization"]["original_approval_exhausted_after_stop"])
        self.assertTrue(
            evidence["authorization"]["retry_or_remaining_write_requires_fresh_approval"]
        )

        expected_columns = {
            "PLAN_TIER": 64,
            "DEPLOYMENT_STATUS": 32,
            "GO_LIVE_APPROVAL_STATUS": 32,
            "LIMIT_POLICY": 100,
            "BILLING_MODE": 64,
            "NUMBER_OWNERSHIP": 64,
            "ENVIRONMENT": 16,
        }
        columns = evidence["configuration_version_columns"]
        self.assertEqual(
            {column["api_name"]: column["max_length"] for column in columns},
            expected_columns,
        )
        for column in columns:
            self.assertEqual(column["type"], "varchar")
            self.assertTrue(column["mandatory"])
            self.assertFalse(column["unique"])
            self.assertFalse(column["search_indexed"])
            self.assertFalse(column["audit_consent"])
            self.assertEqual(column["result"], "created_and_independently_read_back")

        outbox = evidence["analytics_outbox_column"]
        self.assertEqual(outbox["api_name"], "PROVIDER_VERSION_KEY")
        self.assertEqual(outbox["approved_contract"], {
            "type": "varchar",
            "max_length": 64,
            "mandatory": False,
            "unique": True,
            "search_indexed": False,
            "audit_consent": True,
        })
        self.assertEqual(outbox["ui_attempt_count"], 1)
        self.assertEqual(outbox["ui_result"], "ambiguous_no_create")
        self.assertEqual(outbox["independent_connector_readback"], "column_absent")
        self.assertFalse(outbox["retry_attempted"])
        self.assertFalse(outbox["raw_provider_error_included"])

        pools = evidence["job_pools"]
        self.assertEqual(
            [pool["name"] for pool in pools["approved_targets"]],
            ["RevenueDeskCallJobs", "RevenueDeskAnalyticsJobs"],
        )
        self.assertEqual(pools["create_calls_invoked"], 0)
        self.assertEqual(pools["result"], "not_invoked_after_stop_on_mismatch")
        self.assertEqual(pools["independent_readback"], "both_targets_absent")

        poststate = evidence["poststate"]
        self.assertEqual(poststate["configuration_version_table_rows"], 0)
        self.assertEqual(poststate["configuration_version_total_columns"], 23)
        self.assertTrue(poststate["configuration_version_required_application_columns_exact"])
        self.assertEqual(poststate["analytics_outbox_rows"], 307)
        self.assertEqual(poststate["analytics_outbox_total_columns"], 71)
        self.assertFalse(poststate["provider_version_key_present"])
        self.assertTrue(poststate["analytics_outbox_full_pagination_complete"])
        self.assertTrue(poststate["analytics_outbox_row_count_unchanged"])
        self.assertFalse(poststate["analytics_outbox_row_mutation_attempted"])
        self.assertFalse(poststate["requested_job_pools_present"])
        self.assertTrue(poststate["app_user_permissions_empty_on_both_tables"])

        containment = evidence["containment"]
        self.assertTrue(containment["successful_additive_columns_left_unused"])
        for field in (
            "successful_additive_columns_deleted_or_rebuilt",
            "function_or_job_binding_created",
            "function_source_uploaded",
            "route_or_gateway_changed",
            "environment_variable_changed",
            "crm_billing_or_analytics_record_changed",
            "production_changed",
            "activation_allowed",
        ):
            self.assertFalse(containment[field])
        self.assertTrue(all(
            value is False for value in evidence["disclosure_controls"].values()
        ))

        serialized = json.dumps(evidence, sort_keys=True).lower()
        for forbidden in (
            "client_secret", "refresh_token", "access_token", "invoke_url",
            "project_id", "organization_id", "http://", "https://",
        ):
            self.assertNotIn(forbidden, serialized)

    def test_single_key_analytics_outbox_decision_is_coherent_and_retell_excluded(self):
        adr = self.analytics_outbox_fence_adr
        self.assertIn("Status: Accepted for the Development candidate", adr)
        self.assertIn("Retell agent scope: Excluded", adr)
        self.assertIn("analytics-provider-version-v1", adr)
        self.assertIn("normalized SOURCE_MODIFIED_AT", adr)
        self.assertIn("exactly 307 retained legacy outbox rows", adr)
        self.assertIn("zero `ROW_SCHEMA_VERSION=2` rows", adr)
        self.assertIn("Production deployment", adr)

        active_files = (
            ROOT / "src" / "zoho-catalyst" / "revenue-desk-analytics"
            / "config" / "datastore-schema.json",
            ROOT / "src" / "zoho-catalyst" / "revenue-desk-analytics"
            / "config" / "analytics-sync.json",
            ROOT / "src" / "zoho-catalyst" / "revenue-desk-analytics"
            / "functions" / "analytics_sync" / "lib" / "facts.js",
            ROOT / "src" / "zoho-catalyst" / "revenue-desk-analytics"
            / "functions" / "analytics_sync" / "lib" / "catalyst-store.js",
            ROOT / "src" / "zoho-catalyst" / "revenue-desk-call-runtime"
            / "config" / "datastore-schema.json",
            ROOT / "src" / "zoho-catalyst" / "revenue-desk-call-runtime"
            / "functions" / "revenue_desk_call_gateway" / "lib" / "analytics-outbox.js",
            ROOT / "src" / "zoho-catalyst" / "crm-billing-orchestrator"
            / "config" / "datastore-schema.json",
            ROOT / "src" / "zoho-catalyst" / "crm-billing-orchestrator"
            / "functions" / "crm_billing_orchestrator" / "lib" / "analytics-outbox.js",
        )
        retired_column = "_".join(("PROVIDER", "VERSION", "KEY"))
        for path in active_files:
            self.assertNotIn(retired_column, path.read_text(encoding="utf-8"), path)

    def test_development_packet_a_resolution_is_exact_contained_and_sanitized(self):
        evidence = self.packet_a_resolution
        self.assertEqual(evidence["schema_version"], 1)
        self.assertEqual(evidence["environment"], "Development")
        self.assertEqual(
            evidence["outcome"],
            "completed_with_single_key_analytics_outbox_fence",
        )
        self.assertEqual(
            evidence["historical_execution_evidence"],
            "free-revenue-leak-test-development-packet-a-execution-2026-08-26.json",
        )
        self.assertEqual(
            evidence["architecture_decision"],
            "../../../docs/adr/0008-single-key-analytics-outbox-fence.md",
        )

        authorization = evidence["authorization"]
        self.assertEqual(authorization["approved_scope"], [
            "perform the exact retained-outbox full-contract and split-sequence attempts without changing any retained row",
            "create, exercise, independently read back, and delete two bounded disposable Development proof tables",
            "adopt the single-key Analytics outbox architecture in the repository candidate",
            "create and independently read back exactly two generic Function Job pools at 512 MB without submitting a Job",
        ])
        self.assertNotIn("surrounding_development_journey_authorized", authorization)
        self.assertTrue(authorization["packet_a_resolution_scope_authorized"])
        self.assertTrue(authorization["approval_scope_finite"])
        self.assertTrue(authorization["approval_exhausted_after_verified_poststate"])
        self.assertFalse(authorization["approval_reusable"])
        self.assertFalse(authorization["future_live_action_authorized_by_this_record"])
        self.assertTrue(
            authorization["future_live_action_requires_fresh_scoped_approval"]
        )
        self.assertFalse(
            authorization["retell_agent_development_or_testing_authorized"]
        )
        self.assertFalse(authorization["production_or_customer_activity_authorized"])
        self.assertTrue(authorization["one_change_then_independent_readback_required"])
        self.assertTrue(authorization["stop_on_mismatch_required"])

        prestate = evidence["verified_prestate"]
        self.assertEqual(prestate["configuration_version_table_rows"], 0)
        self.assertEqual(prestate["configuration_version_total_columns"], 23)
        self.assertTrue(
            prestate["configuration_version_required_application_columns_exact"]
        )
        self.assertEqual(prestate["analytics_outbox_rows"], 307)
        self.assertEqual(prestate["analytics_outbox_v2_rows"], 0)
        self.assertEqual(prestate["analytics_outbox_nonnull_outbox_key_rows"], 0)
        self.assertEqual(prestate["analytics_outbox_outbox_key_contract"], {
            "type": "varchar",
            "max_length": 64,
            "mandatory": False,
            "unique": True,
            "audit_consent": True,
        })
        self.assertEqual(prestate["analytics_checkpoints_rows"], 10)
        self.assertEqual(prestate["analytics_checkpoints_v2_rows"], 0)
        self.assertTrue(
            prestate["analytics_checkpoints_required_application_columns_exact"]
        )
        self.assertTrue(prestate["analytics_checkpoints_checkpoint_key_unique"])
        self.assertTrue(
            prestate["app_user_permissions_empty_on_both_analytics_tables"]
        )
        self.assertTrue(prestate["canonical_job_pools_absent"])

        attempts = evidence["retained_outbox_target_attempts"]
        self.assertEqual(attempts["full_nullable_unique_column_attempt"], "no_create")
        self.assertEqual(
            attempts["provider_supported_split_sequence_attempt"], "no_create"
        )
        self.assertFalse(attempts["column_created"])
        self.assertTrue(attempts["row_count_unchanged"])
        self.assertFalse(attempts["row_mutation_attempted"])
        self.assertFalse(attempts["further_target_mutation_attempted"])

        capability = evidence["disposable_nonempty_table_capability_proof"]
        self.assertEqual(capability["initial_rows"], 2)
        self.assertTrue(capability["nullable_unique_column_created_and_read_back"])
        self.assertTrue(capability["multiple_preexisting_nulls_preserved"])
        self.assertFalse(capability["target_retained_table_used"])
        self.assertTrue(all(capability["cleanup"].values()))

        contract = evidence["selected_outbox_contract"]
        self.assertEqual(contract["physical_unique_key"], "OUTBOX_KEY")
        self.assertEqual(contract["key_domain"], "analytics-provider-version-v1")
        self.assertEqual(contract["key_inputs"], [
            "RECORD_TYPE",
            "ENVIRONMENT",
            "CLIENT_KEY",
            "DEPLOYMENT_KEY",
            "RECORD_KEY",
            "normalized_SOURCE_MODIFIED_AT",
        ])
        self.assertFalse(contract["provider_version_key_column_required"])
        self.assertFalse(contract["legacy_row_rewrite_required"])

        concurrency = evidence["provider_concurrency_proof"]
        self.assertTrue(concurrency["disposable_table_only"])
        self.assertEqual(concurrency["null_key_rows_inserted_and_preserved"], 2)
        self.assertEqual(
            concurrency["simultaneous_same_key_different_payload_attempts"], 2
        )
        self.assertEqual(concurrency["successful_simultaneous_attempts"], 1)
        self.assertEqual(concurrency["failed_simultaneous_attempts"], 1)
        self.assertEqual(concurrency["keyed_rows_after_simultaneous_attempts"], 1)
        self.assertTrue(concurrency["exact_replay_rejected_by_provider"])
        self.assertTrue(concurrency["row_and_payload_unchanged_after_replay"])
        self.assertEqual(concurrency["cleanup"]["table_count_before_probe"], 35)
        self.assertEqual(concurrency["cleanup"]["table_count_during_probe"], 36)
        self.assertEqual(concurrency["cleanup"]["table_count_after_cleanup"], 35)
        self.assertTrue(concurrency["cleanup"]["table_deleted"])
        self.assertTrue(concurrency["cleanup"]["exact_name_absent_after_delete"])

        pools = evidence["job_pools"]
        self.assertEqual(pools["initial_total_pool_count"], 2)
        self.assertEqual(pools["final_total_pool_count"], 4)
        self.assertEqual(
            [pool["name"] for pool in pools["created_targets"]],
            ["RevenueDeskCallJobs", "RevenueDeskAnalyticsJobs"],
        )
        for pool in pools["created_targets"]:
            self.assertEqual(pool["type"], "Function")
            self.assertEqual(pool["memory_mb"], 512)
            self.assertTrue(pool["independent_readback_exact"])
            self.assertFalse(pool["function_binding_attribute_applicable"])
            self.assertFalse(pool["job_target_binding_proven"])
            self.assertFalse(pool["complete_cron_reference_inventory_proven"])
            self.assertEqual(pool["jobs_submitted"], 0)
        self.assertFalse(pools["pool_metadata_binds_a_function_target"])
        self.assertFalse(
            pools["complete_scheduler_or_caller_inventory_proven_by_packet_a"]
        )

        poststate = evidence["verified_poststate"]
        self.assertEqual(poststate["table_count"], 35)
        self.assertEqual(poststate["analytics_outbox_rows"], 307)
        self.assertEqual(poststate["analytics_outbox_v2_rows"], 0)
        self.assertEqual(poststate["analytics_outbox_nonnull_outbox_key_rows"], 0)
        self.assertEqual(poststate["analytics_checkpoints_rows"], 10)
        self.assertEqual(poststate["analytics_checkpoints_v2_rows"], 0)
        self.assertEqual(poststate["function_count"], 8)
        self.assertEqual(poststate["canonical_target_functions_already_present"], [
            "crm_billing_orchestrator",
            "analytics_sync",
        ])
        for field in (
            "new_function_created",
            "function_source_uploaded",
            "route_or_gateway_changed",
            "environment_variable_changed",
            "retained_or_canonical_business_record_changed",
            "production_changed",
            "retell_agent_or_flow_changed_or_tested",
            "activation_allowed",
        ):
            self.assertFalse(poststate[field])
        self.assertFalse(poststate["job_target_or_cron_binding_created_by_packet"])
        self.assertFalse(
            poststate["complete_scheduler_or_caller_inventory_proven"]
        )

        self.assertTrue(all(
            value is False for value in evidence["disclosure_controls"].values()
        ))
        serialized = json.dumps(evidence, sort_keys=True).lower()
        for forbidden in (
            "client_secret", "refresh_token", "access_token", "invoke_url",
            "project_id", "organization_id", "http://", "https://",
        ):
            self.assertNotIn(forbidden, serialized)

    def test_six_function_development_deployment_is_exact_uninvoked_and_sanitized(self):
        evidence = self.six_function_deployment
        revision = "aab7c18c27f4ff5e1468da51eae433ede9b852f6"
        self.assertEqual(evidence["schema_version"], 1)
        self.assertEqual(
            evidence["record_type"],
            "sanitized_free_revenue_leak_test_development_six_function_deployment",
        )
        self.assertEqual(evidence["execution_date_utc"], "2026-08-27")
        self.assertEqual(evidence["environment"], "Development")
        self.assertEqual(evidence["source_revision"], revision)
        self.assertEqual(
            evidence["outcome"],
            "canonical_revision_and_sanitized_configuration_readback_exact_"
            "one_route_created_ingress_disabled_runtime_acceptance_pending",
        )

        authorization = evidence["authorization"]
        self.assertTrue(authorization["approval_scope_finite"])
        self.assertTrue(authorization["approval_exhausted_after_verified_poststate"])
        self.assertFalse(authorization["approval_reusable"])
        self.assertTrue(authorization["route_packet_approval_exhausted_after_partial_stop"])
        self.assertFalse(authorization["route_packet_approval_reusable"])
        self.assertFalse(authorization["future_live_action_authorized_by_this_record"])
        self.assertTrue(
            authorization["future_live_action_requires_fresh_scoped_approval"]
        )
        self.assertFalse(
            authorization["retell_agent_development_or_testing_authorized"]
        )
        self.assertFalse(authorization["production_or_customer_activity_authorized"])

        execution_surfaces = evidence["execution_surfaces"]
        self.assertEqual(
            execution_surfaces["connector_first_discovery_and_independent_readback"],
            "Sylvara Catalyst connector",
        )
        self.assertFalse(
            execution_surfaces["connector_source_or_archive_download_available"]
        )
        self.assertEqual(
            execution_surfaces["archive_pullback"],
            "authenticated first-party Catalyst UI Download fallback",
        )
        self.assertFalse(execution_surfaces["direct_rest_or_shell_automation_used"])

        deployment = evidence["deployment_readback"]
        expected_functions = [
            ("revenue_leak_test_request_form", "Advanced I/O", 30),
            ("revenue_leak_test_setup_form", "Advanced I/O", 34),
            ("revenue_desk_call_gateway", "Advanced I/O", 31),
            ("revenue_desk_call_worker", "Job", 0),
            ("crm_billing_orchestrator", "Advanced I/O", 30),
            ("analytics_sync", "Job", 7),
        ]
        self.assertEqual(deployment["canonical_function_count"], 6)
        self.assertEqual(
            [
                (item["api_name"], item["type"], item["environment_variable_count"])
                for item in deployment["functions"]
            ],
            expected_functions,
        )
        self.assertTrue(all(
            item["runtime"] == "node24"
            and item["memory_mb"] == 256
            and item["source_revision_stamp_exact"]
            for item in deployment["functions"]
        ))
        self.assertTrue(deployment["all_source_revision_stamps_exact"])
        self.assertEqual(deployment["deployed_archive_pullback_count"], 6)
        self.assertEqual(deployment["uploaded_archive_byte_parity_count"], 6)
        self.assertTrue(deployment["uploaded_archive_byte_parity_exact"])
        self.assertTrue(
            deployment["private_release_manifest_artifact_verification_passed"]
        )
        self.assertTrue(deployment["complete_function_inventory_read_back"])
        self.assertEqual(deployment["observed_function_count"], 12)
        self.assertEqual(deployment["canonical_function_count_in_inventory"], 6)
        self.assertEqual(deployment["legacy_function_count_in_inventory"], 6)
        self.assertEqual(deployment["other_function_count_in_inventory"], 0)
        self.assertTrue(deployment["all_canonical_functions_present_exactly_once"])
        self.assertTrue(
            deployment[
                "provider_is_deployed_flag_false_for_all_canonical_functions"
            ]
        )
        self.assertIn(
            "without treating it as a source-installation failure",
            deployment["provider_is_deployed_flag_interpretation"],
        )
        self.assertFalse(deployment["final_main_parity_proven"])
        self.assertIn(
            "does not prove final-main parity",
            deployment["parity_limitation"],
        )

        safe_config = evidence["safe_configuration_readback"]
        expected_config_counts = {
            name: count for name, _function_type, count in expected_functions
        }
        self.assertEqual(
            {
                name: details["live_environment_variable_count"]
                for name, details in safe_config.items()
            },
            expected_config_counts,
        )
        for name in (
            "revenue_leak_test_request_form",
            "revenue_leak_test_setup_form",
            "revenue_desk_call_gateway",
            "crm_billing_orchestrator",
            "analytics_sync",
        ):
            self.assertTrue(safe_config[name]["approved_private_runtime_binding_exact"])
            self.assertTrue(safe_config[name]["source_revision_binding_exact"])
            self.assertFalse(safe_config[name]["private_values_included"])
        self.assertEqual(
            safe_config["revenue_leak_test_setup_form"]
            ["proof_mode_configuration_readback"],
            "stub",
        )
        self.assertFalse(
            safe_config["revenue_leak_test_setup_form"]["provider_send_invoked"]
        )
        self.assertEqual(
            safe_config["revenue_desk_call_gateway"]
            ["runtime_mode_configuration_readback"],
            "dry_run",
        )
        worker = safe_config["revenue_desk_call_worker"]
        self.assertFalse(worker["required_runtime_binding_present"])
        self.assertTrue(worker["static_configuration_contract_fails_closed"])
        self.assertFalse(worker["runtime_fail_closed_invocation_proven"])
        self.assertFalse(
            safe_config["crm_billing_orchestrator"]
            ["paid_subscription_preparation_enabled"]
        )
        self.assertFalse(
            safe_config["crm_billing_orchestrator"]
            ["development_compatibility_probe_enabled"]
        )
        self.assertTrue(
            safe_config["crm_billing_orchestrator"]
            ["artifact_bound_runtime_proof_rotated_and_read_back_exact"]
        )
        self.assertEqual(
            safe_config["analytics_sync"]["runtime_mode_configuration_readback"],
            "disabled",
        )
        self.assertFalse(
            safe_config["analytics_sync"]["disabled_no_op_runtime_proven"]
        )

        ingress = evidence["ingress_containment"]
        self.assertFalse(ingress["api_gateway_initially_enabled"])
        self.assertTrue(
            ingress[
                "api_gateway_temporarily_enabled_for_inventory_and_approved_route_execution"
            ]
        )
        self.assertEqual(
            ingress["temporary_enablement_scope"],
            "route_inventory_and_exact_approved_route_packet_execution",
        )
        self.assertTrue(ingress["initial_route_inventory_readback_complete"])
        self.assertEqual(ingress["initial_observed_route_count"], 0)
        self.assertEqual(ingress["route_create_attempt_count"], 1)
        self.assertEqual(ingress["created_routes"], [{
            "id": "RETELL_INBOUND",
            "approved_method_target_authentication_and_throttles_exact": True,
            "independent_readback_exact": True,
        }])
        self.assertTrue(ingress["post_write_route_inventory_readback_complete"])
        self.assertEqual(ingress["post_write_observed_route_count"], 1)
        self.assertFalse(ingress["second_route_save_attempted"])
        self.assertEqual(
            ingress["partial_stop_reason"],
            "provider_modal_flow_changed_before_the_second_save",
        )
        self.assertFalse(ingress["operator_route_update_or_delete_performed"])
        self.assertFalse(ingress["operator_route_invocation_performed"])
        self.assertFalse(ingress["negative_route_invocation_inventory_proven"])
        self.assertTrue(ingress["api_gateway_disabled_rollback_performed"])
        self.assertFalse(ingress["api_gateway_finally_enabled"])
        self.assertTrue(
            ingress["api_gateway_final_disabled_state_independently_read_back"]
        )
        self.assertEqual(
            [rule["function"] for rule in ingress["advanced_io_security_rules"]],
            [
                "revenue_leak_test_request_form",
                "revenue_leak_test_setup_form",
                "revenue_desk_call_gateway",
                "crm_billing_orchestrator",
            ],
        )
        self.assertTrue(all(
            rule["method"] == "POST"
            and rule["authentication"] == "required"
            and rule["independent_readback_exact"]
            for rule in ingress["advanced_io_security_rules"]
        ))
        self.assertTrue(ingress["direct_function_url_rule_posture_read_back"])
        self.assertTrue(ingress["route_count_readback_available"])
        self.assertFalse(ingress["twelve_route_api_gateway_parity_proven"])
        self.assertFalse(ingress["negative_direct_caller_inventory_proven"])
        self.assertFalse(ingress["callable_surface_inertness_proven"])
        self.assertTrue(
            ingress["no_invocation_performed_does_not_prove_noncallability"]
        )
        self.assertIn("Exactly RETELL_INBOUND", ingress["route_limitation"])
        self.assertIn("Eleven required routes", ingress["route_limitation"])

        jobs = evidence["job_infrastructure"]
        self.assertEqual(jobs["pools"], [
            {
                "name": "RevenueDeskCallJobs",
                "type": "Function",
                "memory_mb": 512,
                "independent_readback_exact": True,
            },
            {
                "name": "RevenueDeskAnalyticsJobs",
                "type": "Function",
                "memory_mb": 512,
                "independent_readback_exact": True,
            },
        ])
        self.assertTrue(jobs["job_pool_inventory_readback_complete"])
        self.assertEqual(jobs["observed_job_pool_count"], 4)
        self.assertEqual(jobs["canonical_job_pool_count"], 2)
        self.assertEqual(jobs["noncanonical_job_pool_count"], 2)
        self.assertTrue(jobs["cron_inventory_readback_complete"])
        self.assertEqual(jobs["observed_cron_count"], 1)
        self.assertEqual(jobs["active_cron_count"], 0)
        self.assertEqual(jobs["inactive_cron_count"], 1)
        self.assertEqual(jobs["inactive_legacy_target_cron_count"], 1)
        self.assertEqual(jobs["canonical_pool_cron_reference_count"], 0)
        self.assertEqual(jobs["noncanonical_pool_cron_reference_count"], 1)
        self.assertFalse(jobs["job_target_or_cron_binding_proven"])
        self.assertFalse(jobs["scheduler_and_legacy_caller_bindings_reconciled"])
        self.assertEqual(jobs["retry_cron"], {
            "name": "RevenueDeskRetry1m",
            "present": False,
        })

        runtime = evidence["runtime_acceptance"]
        self.assertEqual(runtime["operator_function_invocations"], 0)
        self.assertEqual(runtime["operator_job_invocations"], 0)
        self.assertEqual(runtime["operator_route_invocations"], 0)
        self.assertFalse(runtime["negative_runtime_invocation_inventory_proven"])
        self.assertFalse(runtime["consumer_first_deployment_order_proven"])
        self.assertFalse(runtime["compatibility_probe_invoked"])
        self.assertEqual(
            runtime["compatibility_probe_noninvocation_reason"],
            "no_verified_private_advanced_io_invocation_channel",
        )
        self.assertFalse(runtime["live_report_v1_compatibility_proven"])
        self.assertFalse(runtime["live_report_v2_compatibility_proven"])
        self.assertFalse(runtime["synthetic_development_e2e_proven"])
        self.assertFalse(runtime["inertness_proven"])

        provider_logs = evidence["provider_log_readback"]
        self.assertEqual(provider_logs["official_contract_verified_on"], "2026-08-27")
        self.assertFalse(provider_logs["readback_applies_to_current_source_revision"])
        self.assertFalse(
            provider_logs["all_six_definition_updates_within_post_update_window"]
        )
        self.assertFalse(provider_logs["negative_post_update_log_inventory_proven"])
        self.assertFalse(provider_logs["negative_direct_caller_inventory_proven"])
        self.assertFalse(provider_logs["callable_surface_inertness_proven"])
        self.assertIn("prior bounded log snapshot", provider_logs["limitation"])

        retell = evidence["retell_boundary"]
        self.assertEqual(retell, {
            "agent_changed": False,
            "agent_tested": False,
            "agent_simulated": False,
            "call_performed": False,
            "read_only_configuration_reconciliation_performed": True,
            "published_phone_bound_version_resolved_privately": True,
            "provider_neutral_dynamic_variable_contract_parity": True,
            "provider_neutral_post_call_analysis_contract_parity": True,
            "provider_neutral_webhook_event_contract_parity": True,
            "webhook_timeout_contract_parity": True,
            "canonical_catalyst_gateway_bound": False,
            "legacy_catalyst_boundary_bound": True,
            "required_no_retained_content_posture_proven": False,
            "carrier_one_way_media_gate_proven": False,
            "dtmf_assent_before_speech_recognition_proven": False,
            "static_notice_before_ai_proven": False,
            "private_agent_prompt_identifier_phone_url_or_runtime_value_included": False,
        })
        self.assertEqual(evidence["production_boundary"], {
            "production_change_performed": False,
            "production_deployment_performed": False,
            "customer_traffic_enablement_performed": False,
            "negative_production_state_inventory_proven": False,
            "negative_customer_traffic_inventory_proven": False,
        })
        self.assertEqual(evidence["rollback_readiness"], {
            "preexisting_definition_count": 2,
            "updated_existing_definition_count": 2,
            "new_definition_count": 4,
            "crm_predecessor_revision_metadata_captured_privately": True,
            "analytics_predecessor_source_captured_privately": True,
            "exact_predecessor_deployed_archives_preserved": False,
            "exact_predecessor_restore_rehearsed": False,
            "source_rollback_for_both_updated_definitions_proven": False,
            "containment_posture_is_executable_source_rollback": False,
            "limitation": (
                "CRM and Analytics predecessor metadata or source evidence exists "
                "privately, but exact predecessor deployed archives were not preserved "
                "and no predecessor restore was rehearsed. Keeping ingress and triggers "
                "dark is containment, not executable source rollback."
            ),
        })
        self.assertEqual(evidence["disclosure_controls"], {
            "platform_identifier_values_included": False,
            "private_runtime_locator_values_included": False,
            "credential_or_secret_values_included": False,
            "operator_identity_included": False,
            "environment_variable_values_included_beyond_safe_gates": False,
            "retell_identifier_values_included": False,
            "retell_prompt_flow_topology_phone_or_runtime_values_included": False,
            "customer_or_caller_data_included": False,
            "raw_provider_payloads_errors_or_logs_included": False,
        })

        inventory_readback = self.inventory[
            "development_six_function_deployment_readback_2026_08_27"
        ]
        self.assertEqual(self.inventory["schema_version"], 8)
        self.assertEqual(
            self.inventory["status"],
            "canonical_six_function_revision_and_sanitized_configuration_"
            "readback_exact_twelve_routes_gateway_disabled_worker_"
            "unconfigured_runtime_acceptance_pending",
        )
        self.assertEqual(
            inventory_readback["outcome"],
            "canonical_revision_and_sanitized_configuration_readback_exact_"
            "one_route_created_ingress_disabled_runtime_acceptance_pending",
        )
        self.assertEqual(inventory_readback["source_revision"], revision)
        self.assertEqual(inventory_readback["canonical_function_count"], 6)
        self.assertEqual(inventory_readback["runtime"], "node24")
        self.assertEqual(inventory_readback["memory_mb_per_function"], 256)
        self.assertEqual(
            inventory_readback["environment_variable_counts"],
            {name: count for name, _function_type, count in expected_functions},
        )
        self.assertTrue(inventory_readback["source_revision_stamp_exact_for_all"])
        self.assertEqual(inventory_readback["deployed_archive_pullback_count"], 6)
        self.assertEqual(
            inventory_readback["uploaded_archive_byte_parity_count"], 6
        )
        self.assertTrue(inventory_readback["uploaded_archive_byte_parity_exact"])
        self.assertTrue(
            inventory_readback
            ["private_release_manifest_artifact_verification_passed"]
        )
        for field in (
            "complete_function_inventory_read_back",
            "observed_function_count",
            "canonical_function_count_in_inventory",
            "legacy_function_count_in_inventory",
            "other_function_count_in_inventory",
            "all_canonical_functions_present_exactly_once",
            "provider_is_deployed_flag_false_for_all_canonical_functions",
            "provider_is_deployed_flag_interpretation",
        ):
            self.assertEqual(inventory_readback[field], deployment[field])
        self.assertFalse(inventory_readback["final_main_parity_proven"])
        self.assertFalse(
            inventory_readback["crm_paid_subscription_preparation_enabled"]
        )
        self.assertFalse(
            inventory_readback["crm_development_compatibility_probe_enabled"]
        )
        self.assertEqual(
            inventory_readback["crm_public_registry_variable_name_count"], 42
        )
        self.assertTrue(
            inventory_readback["crm_approved_private_runtime_binding_exact"]
        )
        self.assertTrue(inventory_readback["crm_source_revision_binding_exact"])
        self.assertFalse(
            inventory_readback["crm_legacy_extra_live_variable_names_present"]
        )
        self.assertTrue(
            inventory_readback
            ["crm_artifact_bound_runtime_proof_rotated_and_read_back_exact"]
        )
        self.assertEqual(
            inventory_readback["analytics_public_registry_variable_name_count"], 26
        )
        self.assertTrue(
            inventory_readback["analytics_approved_private_runtime_binding_exact"]
        )
        self.assertTrue(
            inventory_readback["analytics_source_revision_binding_exact"]
        )
        self.assertFalse(
            inventory_readback["analytics_legacy_extra_live_variable_names_present"]
        )
        self.assertEqual(
            inventory_readback["analytics_runtime_mode_configuration_readback"],
            "disabled",
        )
        self.assertFalse(
            inventory_readback["analytics_disabled_no_op_runtime_proven"]
        )
        self.assertTrue(
            inventory_readback["request_form_approved_private_runtime_binding_exact"]
        )
        self.assertTrue(
            inventory_readback["setup_form_approved_private_runtime_binding_exact"]
        )
        self.assertEqual(
            inventory_readback["setup_form_proof_mode_configuration_readback"],
            "stub",
        )
        self.assertTrue(
            inventory_readback["gateway_approved_private_runtime_binding_exact"]
        )
        self.assertEqual(
            inventory_readback["gateway_runtime_mode_configuration_readback"],
            "dry_run",
        )
        self.assertFalse(inventory_readback["worker_required_runtime_binding_present"])
        self.assertTrue(
            inventory_readback["worker_static_configuration_contract_fails_closed"]
        )
        self.assertFalse(
            inventory_readback["worker_runtime_fail_closed_invocation_proven"]
        )
        self.assertEqual(inventory_readback["advanced_io_security_rule_count"], 4)
        self.assertEqual(
            inventory_readback["advanced_io_security_rule_method"], "POST"
        )
        self.assertEqual(
            inventory_readback["advanced_io_security_rule_authentication"],
            "required",
        )
        self.assertTrue(
            inventory_readback["direct_function_url_rule_posture_read_back"]
        )
        self.assertTrue(inventory_readback["route_count_readback_available"])
        self.assertTrue(
            inventory_readback["initial_route_inventory_readback_complete"]
        )
        self.assertEqual(inventory_readback["initial_observed_route_count"], 0)
        self.assertEqual(inventory_readback["route_create_attempt_count"], 1)
        self.assertEqual(inventory_readback["created_route_ids"], ["RETELL_INBOUND"])
        self.assertTrue(inventory_readback["created_route_approved_contract_exact"])
        self.assertTrue(
            inventory_readback["post_write_route_inventory_readback_complete"]
        )
        self.assertEqual(inventory_readback["post_write_observed_route_count"], 1)
        self.assertFalse(inventory_readback["second_route_save_attempted"])
        self.assertEqual(
            inventory_readback["partial_route_stop_reason"],
            "provider_modal_flow_changed_before_the_second_save",
        )
        self.assertTrue(
            inventory_readback[
                "api_gateway_temporarily_enabled_for_inventory_and_approved_route_execution"
            ]
        )
        self.assertFalse(
            inventory_readback["operator_api_gateway_route_update_or_delete_performed"]
        )
        self.assertFalse(inventory_readback["operator_api_gateway_route_invocation_performed"])
        self.assertFalse(
            inventory_readback[
                "negative_api_gateway_route_invocation_inventory_proven"
            ]
        )
        self.assertTrue(inventory_readback["api_gateway_disabled_rollback_performed"])
        self.assertTrue(
            inventory_readback
            ["api_gateway_final_disabled_state_independently_read_back"]
        )
        self.assertFalse(
            inventory_readback["negative_direct_caller_inventory_proven"]
        )
        self.assertFalse(inventory_readback["callable_surface_inertness_proven"])
        self.assertTrue(
            inventory_readback["no_invocation_performed_does_not_prove_noncallability"]
        )
        self.assertFalse(inventory_readback["api_gateway_enabled"])
        self.assertFalse(
            inventory_readback["twelve_route_api_gateway_parity_proven"]
        )
        self.assertEqual(inventory_readback["canonical_job_pools"], [
            {
                "name": "RevenueDeskCallJobs",
                "type": "Function",
                "memory_mb": 512,
            },
            {
                "name": "RevenueDeskAnalyticsJobs",
                "type": "Function",
                "memory_mb": 512,
            },
        ])
        self.assertTrue(inventory_readback["job_pool_inventory_readback_complete"])
        self.assertEqual(inventory_readback["observed_job_pool_count"], 4)
        self.assertEqual(inventory_readback["canonical_job_pool_count"], 2)
        self.assertEqual(inventory_readback["noncanonical_job_pool_count"], 2)
        self.assertTrue(inventory_readback["cron_inventory_readback_complete"])
        self.assertEqual(inventory_readback["observed_cron_count"], 1)
        self.assertEqual(inventory_readback["active_cron_count"], 0)
        self.assertEqual(inventory_readback["inactive_cron_count"], 1)
        self.assertEqual(
            inventory_readback["inactive_legacy_target_cron_count"], 1
        )
        self.assertEqual(
            inventory_readback["canonical_pool_cron_reference_count"], 0
        )
        self.assertEqual(
            inventory_readback["noncanonical_pool_cron_reference_count"], 1
        )
        self.assertFalse(inventory_readback["job_target_or_cron_binding_proven"])
        self.assertFalse(
            inventory_readback["scheduler_and_legacy_caller_bindings_reconciled"]
        )
        self.assertFalse(inventory_readback["revenue_desk_retry_1m_cron_present"])
        self.assertFalse(
            inventory_readback["operator_function_or_job_invocation_performed"]
        )
        self.assertFalse(
            inventory_readback["negative_runtime_invocation_inventory_proven"]
        )
        self.assertFalse(
            inventory_readback["provider_log_readback_applies_to_current_source_revision"]
        )
        for field in (
            "negative_post_update_log_inventory_proven",
            "all_six_definition_updates_within_post_update_window",
            "post_update_access_record_count",
            "post_update_application_record_count",
            "retention_window_access_record_count",
            "retention_window_application_record_count",
            "retention_access_records_all_predate_post_update_window",
            "retention_access_records_only_on_updated_preexisting_definitions",
        ):
            self.assertEqual(inventory_readback[field], provider_logs[field])
        self.assertEqual(
            inventory_readback["post_update_log_window_minutes"],
            provider_logs["post_update_window_minutes"],
        )
        self.assertFalse(
            inventory_readback["consumer_first_deployment_order_proven"]
        )
        self.assertFalse(inventory_readback["inertness_proven"])
        self.assertFalse(inventory_readback["compatibility_probe_invoked"])
        self.assertFalse(
            inventory_readback["retell_agent_changed_tested_simulated_or_called"]
        )
        retell_inventory_to_evidence_fields = {
            "retell_read_only_configuration_reconciliation_performed": (
                "read_only_configuration_reconciliation_performed"
            ),
            "retell_published_phone_bound_version_resolved_privately": (
                "published_phone_bound_version_resolved_privately"
            ),
            "retell_provider_neutral_dynamic_variable_contract_parity": (
                "provider_neutral_dynamic_variable_contract_parity"
            ),
            "retell_provider_neutral_post_call_analysis_contract_parity": (
                "provider_neutral_post_call_analysis_contract_parity"
            ),
            "retell_provider_neutral_webhook_event_contract_parity": (
                "provider_neutral_webhook_event_contract_parity"
            ),
            "retell_webhook_timeout_contract_parity": (
                "webhook_timeout_contract_parity"
            ),
            "retell_canonical_catalyst_gateway_bound": (
                "canonical_catalyst_gateway_bound"
            ),
            "retell_legacy_catalyst_boundary_bound": (
                "legacy_catalyst_boundary_bound"
            ),
            "retell_no_retained_content_posture_proven": (
                "required_no_retained_content_posture_proven"
            ),
            "retell_carrier_one_way_media_gate_proven": (
                "carrier_one_way_media_gate_proven"
            ),
            "retell_dtmf_assent_before_speech_recognition_proven": (
                "dtmf_assent_before_speech_recognition_proven"
            ),
            "retell_static_notice_before_ai_proven": (
                "static_notice_before_ai_proven"
            ),
            "retell_private_agent_prompt_identifier_phone_url_or_runtime_value_included": (
                "private_agent_prompt_identifier_phone_url_or_runtime_value_included"
            ),
        }
        for inventory_field, evidence_field in (
            retell_inventory_to_evidence_fields.items()
        ):
            self.assertEqual(
                inventory_readback[inventory_field],
                retell[evidence_field],
            )
        self.assertFalse(
            inventory_readback["operator_production_or_customer_activity_performed"]
        )
        self.assertEqual(inventory_readback["preexisting_definition_count"], 2)
        self.assertEqual(inventory_readback["updated_existing_definition_count"], 2)
        self.assertEqual(inventory_readback["new_definition_count"], 4)
        self.assertFalse(
            inventory_readback["exact_predecessor_deployed_archives_preserved"]
        )
        self.assertFalse(inventory_readback["exact_predecessor_restore_rehearsed"])
        self.assertFalse(
            inventory_readback
            ["source_rollback_for_both_updated_definitions_proven"]
        )
        self.assertFalse(
            inventory_readback["containment_posture_is_executable_source_rollback"]
        )
        self.assertEqual(
            inventory_readback["evidence"],
            "evidence/free-revenue-leak-test-development-six-function-deployment-2026-08-27.json",
        )

        deployment_log_entry = self.deployment_log.split(
            "## 2026-08-27 — Revenue Desk Canonical Development Definitions Deployed Without Invocation",
            maxsplit=1,
        )[1].split(
            "## 2026-08-26 — Revenue Desk Development Packet A Superseding Resolution",
            maxsplit=1,
        )[0]
        for phrase in (
            revision,
            "Environment-variable counts were 30/34/31/0/30/7",
            "API Gateway initially contained zero routes",
            "Exactly `RETELL_INBOUND` was created",
            "No second save was attempted after the modal-flow change",
            "Gateway was immediately restored to disabled with independent readback",
            "rotated artifact-bound runtime proof read back exactly",
            "The worker remained unconfigured and therefore fail-closed by static contract",
            "the operator performed no function, Job, compatibility probe, Retell call, Retell simulation",
            "all six Catalyst-pulled archives matched their exact uploaded archives byte for byte",
            "The earlier bounded provider-log snapshot does not cover the later aab7c18 convergence",
            "canonical_revision_and_sanitized_configuration_readback_exact_one_route_created_ingress_disabled_runtime_acceptance_pending",
        ):
            self.assertIn(phrase, deployment_log_entry)
        self.assertIn(
            "The six canonical function definitions are converged in Catalyst Development",
            self.reconciliation_runbook,
        )
        self.assertIn(
            "Route configuration actions occurred, but the operator performed no route, function, Job, or Cron invocation and no Retell-provider, customer, or Production action as part of this execution",
            self.reconciliation_runbook,
        )
        self.assertIn(
            "30/34/31/0/30/7 environment variables in canonical function order",
            self.reconciliation_runbook,
        )
        self.assertIn(
            "All twelve canonical Development API Gateway routes were preserved or created and read back",
            self.reconciliation_runbook,
        )

        public_release_slice = {
            "evidence": evidence,
            "inventory_readback": inventory_readback,
        }
        serialized = json.dumps(public_release_slice, sort_keys=True).lower()
        for forbidden in (
            "client_secret", "refresh_token", "access_token", "invoke_url",
            "project_id", "organization_id", "environment_id", "function_id",
            "agent_id", "version_id", "number_id", "zaid", "private_host",
            "private_path", "archive_sha256", "download_path", "upload_path",
            "http://", "https://",
        ):
            self.assertNotIn(forbidden, serialized)

        public_keys = set()
        pending_values = [public_release_slice]
        while pending_values:
            value = pending_values.pop()
            if isinstance(value, dict):
                public_keys.update(value)
                pending_values.extend(value.values())
            elif isinstance(value, list):
                pending_values.extend(value)

        for raw_retell_key in (
            "agent",
            "agent_name",
            "agent_version",
            "llm_id",
            "llm_name",
            "voice_id",
            "voice_name",
            "call_id",
            "phone_number",
            "phone_number_id",
            "from_number",
            "to_number",
            "webhook",
            "webhook_url",
            "webhook_endpoint",
            "webhook_headers",
            "webhook_payload",
            "prompt",
            "general_prompt",
            "system_prompt",
            "begin_message",
            "first_message",
            "flow",
            "flow_id",
            "nodes",
            "edges",
            "transitions",
            "tools",
        ):
            self.assertNotIn(raw_retell_key, public_keys)

        self.assertNotRegex(
            serialized,
            r"\b(?:agent|llm|voice|call|flow|phone_number)_[a-z0-9]{16,}\b",
        )
        self.assertNotRegex(serialized, r"\+[1-9]\d{7,14}\b")
        self.assertNotRegex(
            serialized,
            r"\b\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b",
        )
        self.assertNotRegex(serialized, r"/(?:retell|webhooks?)(?:/|\?|\")")

    def test_route_continuation_proves_exact_routes_and_preserves_dark_runtime(self):
        evidence = self.route_continuation
        self.assertEqual(evidence["schema_version"], 1)
        self.assertEqual(
            evidence["record_type"],
            "sanitized_free_revenue_leak_test_development_route_continuation",
        )
        self.assertEqual(evidence["execution_date_utc"], "2026-08-27")
        self.assertEqual(evidence["environment"], "Development")
        self.assertEqual(
            evidence["source_revision"],
            ROUTE_CONTRACT_SOURCE_REVISION,
        )
        self.assertEqual(
            evidence["outcome"],
            "twelve_route_contract_exact_gateway_disabled_runtime_acceptance_pending",
        )

        route_contract = self.private_route_contract
        route_contract_bytes = PRIVATE_ROUTE_CONTRACT_PATH.read_bytes()
        route_contract_hash = hashlib.sha256(route_contract_bytes).hexdigest()
        route_contract_git_blob_sha1 = hashlib.sha1(
            b"blob "
            + str(len(route_contract_bytes)).encode("ascii")
            + b"\0"
            + route_contract_bytes
        ).hexdigest()
        public_contract = evidence["public_route_contract"]
        self.assertEqual(route_contract_hash, ROUTE_CONTRACT_SHA256_AT_SOURCE_REVISION)
        self.assertEqual(
            route_contract_git_blob_sha1,
            ROUTE_CONTRACT_GIT_BLOB_SHA1_AT_SOURCE_REVISION,
        )
        self.assertEqual(route_contract["schema_version"], 1)
        self.assertEqual(route_contract["environment"], "Development")
        self.assertEqual(route_contract["physical_route_count"], 12)
        self.assertEqual(
            public_contract["path"],
            "../revenue-desk-release/private-route-packet-contract.json",
        )
        self.assertEqual(public_contract["schema_version"], route_contract["schema_version"])
        self.assertEqual(
            public_contract["bound_source_revision"], evidence["source_revision"]
        )
        self.assertEqual(public_contract["sha256"], route_contract_hash)
        self.assertEqual(
            public_contract["git_blob_sha1_at_bound_source_revision"],
            ROUTE_CONTRACT_GIT_BLOB_SHA1_AT_SOURCE_REVISION,
        )

        authorization = evidence["authorization"]
        self.assertTrue(authorization["approval_scope_finite"])
        self.assertTrue(authorization["approval_exhausted_after_verified_poststate"])
        self.assertFalse(authorization["approval_reusable"])
        self.assertFalse(authorization["future_live_action_authorized_by_this_record"])
        self.assertTrue(authorization["future_live_action_requires_fresh_scoped_approval"])
        self.assertFalse(authorization["worker_configuration_write_authorized"])
        self.assertFalse(authorization["retell_agent_development_or_testing_authorized"])
        self.assertFalse(authorization["production_or_customer_activity_authorized"])
        self.assertFalse(authorization["private_approval_packet_digests_included"])

        expected_routes = [item["id"] for item in route_contract["routes"]]
        expected_api_key_routes = [
            item["id"]
            for item in route_contract["routes"]
            if item["authentication"] == ["APIKey"]
        ]
        remediation = evidence["pre_continuation_retell_events_remediation"]
        self.assertEqual(remediation["initial_route_count"], 1)
        self.assertEqual(remediation["initial_route"], expected_routes[0])
        for field in (
            "initial_gateway_disabled",
            "initial_route_inventory_readback_complete",
            "initial_route_exact",
            "creation_packet_separately_approved_single_use",
            "creation_packet_consumed_exhausted_and_nonreusable",
            "retell_events_route_created",
            "duplicate_separator_target_defect_detected_by_exact_readback",
            "gateway_restored_disabled_after_defect",
            "fresh_remediation_packet_separately_approved_single_use",
            "fresh_remediation_packet_consumed_exhausted_and_nonreusable",
            "remediation_changed_only_the_approved_duplicate_separator_defect",
            "independent_two_route_full_tuple_readback_exact",
            "gateway_final_disabled_state_independently_read_back",
        ):
            self.assertTrue(remediation[field])
        for field in (
            "route_deleted_or_recreated_during_remediation",
            "operator_route_function_job_or_cron_invocation_performed",
            "retell_agent_test_simulation_call_or_publish_performed",
            "customer_or_production_action_performed",
        ):
            self.assertFalse(remediation[field])

        route = evidence["route_continuation"]
        self.assertTrue(route["gateway_prestate_disabled"])
        self.assertTrue(route["prestate_route_inventory_readback_complete"])
        self.assertEqual(route["prestate_route_count"], 2)
        self.assertEqual(route["prestate_routes"], expected_routes[:2])
        self.assertTrue(route["prestate_routes_exact"])
        self.assertFalse(
            route[
                "existing_route_update_delete_or_recreation_performed_in_ten_route_continuation"
            ]
        )
        self.assertTrue(route["gateway_temporarily_enabled"])
        self.assertEqual(route["continuation_create_attempt_count"], 10)
        self.assertEqual(route["created_routes"], expected_routes[2:])
        self.assertEqual(route["final_route_count"], 12)
        self.assertEqual(route["final_routes"], expected_routes)
        for field in (
            "each_route_saved_serially_after_exact_form_validation",
            "each_route_independently_read_back_after_save",
            "independent_ui_authentication_readback_exact_for_each_route",
            "final_route_inventory_readback_complete",
            "final_route_names_unique",
            "final_source_endpoints_unique",
            "methods_targets_source_endpoints_authentication_and_throttles_exact",
            "numeric_target_bindings_exact",
            "twelve_route_api_gateway_parity_proven",
            "gateway_disabled_rollback_performed",
            "gateway_final_disabled_state_independently_read_back",
            "disabled_connector_probe_failed_closed_without_route_payload",
        ):
            self.assertTrue(route[field])
        self.assertEqual(
            route["api_key_route_names"],
            expected_api_key_routes,
        )
        self.assertFalse(route["operator_route_invocation_performed"])
        self.assertFalse(route["api_gateway_finally_enabled"])
        self.assertFalse(
            route[
                "route_identifiers_source_endpoints_target_identifiers_or_private_hosts_included"
            ]
        )

        key_handling = evidence["development_api_gateway_key_handling"]
        for field in (
            "retrieved_only_after_twelve_route_parity",
            "retrieved_privately_from_authenticated_first_party_ui",
            "format_validated_privately",
            "stored_only_in_private_runtime_artifact_outside_repository",
            "cleared_from_browser_runtime_memory",
        ):
            self.assertTrue(key_handling[field])
        self.assertFalse(key_handling["value_path_or_digest_included"])
        self.assertFalse(key_handling["key_is_runtime_authorization_by_itself"])
        self.assertFalse(key_handling["worker_binding_or_invocation_authorized_by_retrieval"])

        containment = evidence["bounded_containment_readback"]
        self.assertEqual(containment["observed_function_count"], 12)
        self.assertEqual(containment["canonical_function_count"], 6)
        self.assertEqual(containment["legacy_function_count"], 6)
        for field in (
            "complete_function_inventory_read_back",
            "all_canonical_functions_present_exactly_once",
            "canonical_source_runtime_memory_and_safe_gate_readback_exact",
            "worker_environment_variable_ui_readback_complete",
            "job_pool_inventory_readback_complete",
            "canonical_job_pools_exact_function_type_and_512_mb",
            "cron_inventory_readback_complete",
            "required_connections_read_back_complete",
            "required_connections_connected_with_exact_approved_scopes",
            "first_party_all_time_jobs_visible_result_readback_complete",
        ):
            self.assertTrue(containment[field])
        self.assertEqual(containment["worker_environment_variable_count"], 0)
        self.assertFalse(containment["worker_required_runtime_binding_present"])
        self.assertTrue(containment["worker_static_configuration_contract_fails_closed"])
        self.assertFalse(containment["worker_runtime_fail_closed_invocation_proven"])
        self.assertEqual(containment["observed_job_pool_count"], 4)
        self.assertEqual(containment["canonical_job_pool_count"], 2)
        self.assertEqual(containment["noncanonical_job_pool_count"], 2)
        self.assertFalse(containment["job_pool_function_target_binding_attribute_available"])
        self.assertFalse(containment["job_target_binding_proven"])
        self.assertEqual(containment["observed_cron_count"], 1)
        self.assertEqual(containment["canonical_function_or_pool_cron_reference_count"], 0)
        self.assertFalse(containment["canonical_cron_active"])
        self.assertEqual(containment["bounded_log_window_hours"], 24)
        self.assertEqual(
            containment["bounded_log_window_definition"], "prior_24_hours_at_readback"
        )
        self.assertTrue(
            containment["bounded_log_query_executed_after_final_disabled_gateway_readback"]
        )
        self.assertFalse(
            containment["bounded_log_exact_start_and_end_timestamps_publicly_available"]
        )
        self.assertFalse(
            containment["bounded_log_exact_start_and_end_reconstruction_proven"]
        )
        self.assertEqual(containment["canonical_function_access_log_record_count"], 0)
        self.assertEqual(containment["canonical_function_application_log_record_count"], 0)
        self.assertTrue(containment["bounded_log_queries_read_back_complete"])
        self.assertEqual(containment["required_connection_count"], 9)
        self.assertEqual(containment["first_party_all_time_jobs_view_filter"], "all_statuses")
        self.assertEqual(containment["first_party_all_time_jobs_visible_row_count"], 15)
        self.assertFalse(
            containment["first_party_all_time_jobs_pagination_controls_present"]
        )
        self.assertEqual(
            containment["canonical_job_pool_reference_count_in_all_time_jobs_ui"], 0
        )
        for field in (
            "provider_complete_all_history_invocation_inventory_proven",
            "provider_complete_job_inventory_proven",
            "provider_complete_direct_caller_inventory_proven",
            "provider_complete_webhook_inventory_proven",
            "connector_list_jobs_operation_available",
            "connector_direct_caller_or_webhook_inventory_operation_available",
            "callable_surface_inertness_proven",
        ):
            self.assertFalse(containment[field])

        runtime = evidence["runtime_acceptance"]
        self.assertEqual(runtime["operator_function_invocations"], 0)
        self.assertEqual(runtime["operator_job_invocations"], 0)
        self.assertEqual(runtime["operator_route_invocations"], 0)
        self.assertEqual(runtime["operator_cron_submissions"], 0)
        self.assertFalse(runtime["synthetic_development_e2e_proven"])
        self.assertFalse(runtime["worker_binding_proven"])
        self.assertFalse(runtime["inertness_proven"])
        self.assertTrue(runtime["route_parity_does_not_prove_runtime_acceptance"])
        retell = evidence["retell_boundary"]
        self.assertTrue(retell["separate_retell_task_required"])
        self.assertTrue(all(
            retell[field] is False
            for field in (
                "agent_changed",
                "agent_tested",
                "agent_simulated",
                "call_performed",
                "agent_or_phone_route_published",
                "canonical_catalyst_gateway_bound_to_retell",
                "live_ingress_authorized",
            )
        ))
        self.assertTrue(all(
            value is False for value in evidence["production_boundary"].values()
        ))
        self.assertTrue(all(
            value is False for value in evidence["disclosure_controls"].values()
        ))

        inventory = self.inventory["development_route_continuation_readback_2026_08_27"]
        self.assertEqual(inventory["outcome"], evidence["outcome"])
        self.assertEqual(inventory["source_revision"], evidence["source_revision"])
        self.assertEqual(
            inventory["public_route_contract"],
            "revenue-desk-release/private-route-packet-contract.json",
        )
        self.assertEqual(
            inventory["public_route_contract_schema_version"], route_contract["schema_version"]
        )
        self.assertEqual(inventory["public_route_contract_sha256"], route_contract_hash)
        self.assertEqual(
            inventory["public_route_contract_git_blob_sha1_at_source_revision"],
            ROUTE_CONTRACT_GIT_BLOB_SHA1_AT_SOURCE_REVISION,
        )
        self.assertEqual(inventory["pre_continuation_initial_route_count"], 1)
        for field in (
            "retell_events_creation_packet_separately_approved_consumed_and_exhausted",
            "retell_events_duplicate_separator_defect_contained",
            "retell_events_fresh_remediation_packet_separately_approved_consumed_and_exhausted",
            "retell_events_remediation_changed_only_approved_defect",
            "pre_continuation_two_route_full_tuple_readback_exact",
        ):
            self.assertTrue(inventory[field])
        self.assertFalse(
            inventory["retell_events_route_deleted_or_recreated_during_remediation"]
        )
        self.assertEqual(inventory["prestate_route_count"], 2)
        self.assertEqual(inventory["continuation_created_route_count"], 10)
        self.assertFalse(
            inventory[
                "existing_route_update_delete_or_recreation_performed_in_ten_route_continuation"
            ]
        )
        self.assertEqual(inventory["final_route_count"], 12)
        self.assertTrue(inventory["twelve_route_api_gateway_parity_proven"])
        self.assertTrue(inventory["api_gateway_key_retrieved_and_format_validated_privately"])
        self.assertFalse(inventory["api_gateway_key_value_path_or_digest_included"])
        self.assertFalse(inventory["worker_required_runtime_binding_present"])
        self.assertEqual(inventory["worker_environment_variable_count"], 0)
        self.assertTrue(inventory["worker_environment_variable_ui_readback_complete"])
        self.assertEqual(
            inventory["canonical_function_access_log_record_count_in_bounded_prior_24h"],
            0,
        )
        self.assertEqual(
            inventory[
                "canonical_function_application_log_record_count_in_bounded_prior_24h"
            ],
            0,
        )
        self.assertFalse(inventory["job_pool_function_target_binding_attribute_available"])
        self.assertFalse(inventory["job_target_binding_proven"])
        self.assertEqual(
            inventory["canonical_job_pool_count"],
            containment["canonical_job_pool_count"],
        )
        self.assertEqual(inventory["canonical_job_pool_count"], 2)
        self.assertEqual(
            inventory["canonical_job_pools_exact_function_type_and_512_mb"],
            containment["canonical_job_pools_exact_function_type_and_512_mb"],
        )
        self.assertTrue(inventory["canonical_job_pools_exact_function_type_and_512_mb"])
        self.assertEqual(inventory["canonical_function_or_pool_cron_reference_count"], 0)
        self.assertEqual(
            inventory["bounded_log_window_definition"],
            containment["bounded_log_window_definition"],
        )
        self.assertEqual(
            inventory["bounded_log_query_executed_after_final_disabled_gateway_readback"],
            containment[
                "bounded_log_query_executed_after_final_disabled_gateway_readback"
            ],
        )
        self.assertTrue(
            inventory["bounded_log_query_executed_after_final_disabled_gateway_readback"]
        )
        for field in (
            "bounded_log_exact_start_and_end_timestamps_publicly_available",
            "bounded_log_exact_start_and_end_reconstruction_proven",
        ):
            self.assertEqual(inventory[field], containment[field])
            self.assertFalse(inventory[field])
        self.assertEqual(inventory["required_connection_count"], 9)
        self.assertTrue(inventory["required_connections_read_back_complete"])
        self.assertTrue(
            inventory["required_connections_connected_with_exact_approved_scopes"]
        )
        self.assertTrue(
            inventory["first_party_all_time_jobs_visible_result_readback_complete"]
        )
        self.assertEqual(inventory["first_party_all_time_jobs_visible_row_count"], 15)
        self.assertFalse(
            inventory["first_party_all_time_jobs_pagination_controls_present"]
        )
        self.assertEqual(
            inventory["canonical_job_pool_reference_count_in_all_time_jobs_ui"], 0
        )
        for field in (
            "provider_complete_all_history_invocation_inventory_proven",
            "provider_complete_job_inventory_proven",
            "provider_complete_direct_caller_inventory_proven",
            "provider_complete_webhook_inventory_proven",
        ):
            self.assertEqual(inventory[field], containment[field])
            self.assertFalse(inventory[field])
        self.assertFalse(inventory["callable_surface_inertness_proven"])
        self.assertFalse(inventory["future_live_action_authorized_by_this_record"])
        self.assertTrue(inventory["fresh_single_use_worker_binding_approval_required"])
        self.assertEqual(
            inventory["evidence"],
            "evidence/free-revenue-leak-test-development-route-continuation-2026-08-27.json",
        )

        continuation_entry = self.deployment_log.split(
            "## 2026-08-27 — Revenue Desk Development Gateway Continuation Completed And Contained",
            maxsplit=1,
        )[1].split(
            "## 2026-08-27 — RETELL_EVENTS Development Route Created, Contained, And Remediated",
            maxsplit=1,
        )[0]
        for phrase in (
            evidence["source_revision"],
            "exactly twelve unique canonical Development routes matched their approved full route tuples",
            "The first-party All Time Jobs view showed fifteen rows across all statuses, no pagination controls, and zero canonical-pool references",
            "All nine required Connections were connected with their exact approved scopes",
            "The worker UI independently showed exactly zero variables",
            "the operator performed no route, function, Job, or Cron invocation",
        ):
            self.assertIn(phrase, continuation_entry)

        remediation_entry = self.deployment_log.split(
            "## 2026-08-27 — RETELL_EVENTS Development Route Created, Contained, And Remediated",
            maxsplit=1,
        )[1].split(
            "## 2026-08-27 — Revenue Desk Canonical Development Definitions Deployed Without Invocation",
            maxsplit=1,
        )[0]
        for phrase in (
            "exactly the previously approved RETELL_INBOUND route existed",
            "duplicate-separator target defect",
            "separately approved, single-use, consumed, and exhausted",
            "correcting only the approved duplicate separator",
            "without deleting or recreating either route",
            "the operator performed no route, function, Job, or Cron invocation and no Retell-provider, customer, or Production workflow action as part of this execution",
        ):
            self.assertIn(phrase, remediation_entry)

        public_mirrors = self.route_continuation_public_mirrors
        for path, text in public_mirrors.items():
            with self.subTest(public_mirror=path.name):
                lowered = text.lower()
                self.assertNotIn("six canonical function job pools", lowered)
                self.assertNotIn("six canonical 512 mb pool definitions", lowered)
                self.assertNotIn("complete all time jobs ui inventory", lowered)
                self.assertNotIn(
                    "provider-complete all-history job inventory remains proven", lowered
                )

        exact_public_mirror_clauses = {
            SHARED_MONITOR_RUNBOOK_PATH: (
                "both canonical function pools are exact at 512 mb",
                "provider-complete all-history job inventory remains unproven",
                "provider-relative prior-24-hour access and application logs queried after final disabled-gateway readback",
                "exact utc bounds were not retained",
                "the operator did not invoke it",
            ),
            ZOHO_README_PATH: (
                "both canonical function job pools matched exact at 512 mb",
                "provider-complete all-history job inventory remains unproven",
                "a relative prior-24-hour access and application log query ran after the final disabled-gateway readback",
                "exact utc bounds were not retained",
                "during this execution, the operator invoked no route, function, job, or cron",
            ),
            CALL_RUNTIME_README_PATH: (
                "both canonical function job pools matched exact at 512 mb",
                "provider-complete all-history job inventory remains unproven",
                "a relative prior-24-hour access and application log query ran after the final disabled-gateway readback",
                "exact utc bounds were not retained",
                "during this execution, the operator invoked no route, function, job, or cron",
            ),
            REQUEST_FORM_README_PATH: (
                "both canonical function job pools match exact at 512 mb",
                "provider-complete all-history job inventory and direct caller and webhook bindings remain unproven",
                "during this execution, the operator invoked no route, function, job, or cron",
            ),
            SETUP_FORM_README_PATH: (
                "both canonical function job pools match exact at 512 mb",
                "provider-complete all-history job inventory and direct caller and webhook bindings remain unproven",
                "during this execution, the operator invoked no route, function, job, or cron",
            ),
        }
        for path, required_clauses in exact_public_mirror_clauses.items():
            lowered = public_mirrors[path].lower()
            for clause in required_clauses:
                with self.subTest(public_mirror=path.name, required_clause=clause):
                    self.assertIn(clause, lowered)

        for path in (REQUEST_FORM_README_PATH, SETUP_FORM_README_PATH):
            self.assertNotIn("prior-24-hour", public_mirrors[path].lower())

        for path in (ZOHO_README_PATH, CALL_RUNTIME_README_PATH):
            text = public_mirrors[path]
            self.assertIn("RETELL_EVENTS", text)
            self.assertIn("duplicate", text)
            self.assertIn("separator", text)
            self.assertIn("consumed", text)

        serialized = json.dumps(evidence, sort_keys=True).lower()
        for forbidden in (
            "client_secret", "refresh_token", "access_token", "invoke_url",
            "project_id", "organization_id", "environment_id", "function_id",
            "agent_id", "version_id", "number_id", "zaid", "archive_sha256",
            "download_path", "upload_path", "http://", "https://",
        ):
            self.assertNotIn(forbidden, serialized)

    def test_development_worker_binding_attempt_is_consumed_non_persistent_and_contained(self):
        evidence = self.worker_binding_containment
        self.assertEqual(evidence["schema_version"], 1)
        self.assertEqual(
            evidence["record_type"],
            "sanitized_free_revenue_leak_test_development_worker_binding_containment",
        )
        self.assertEqual(evidence["environment"], "Development")
        self.assertEqual(evidence["source_revision"], ROUTE_CONTRACT_SOURCE_REVISION)
        self.assertEqual(
            evidence["outcome"],
            "single_use_worker_binding_attempt_consumed_non_persisted_and_contained",
        )

        authorization = evidence["authorization"]
        for field in (
            "approval_scope_finite",
            "approval_consumed_by_single_attempt",
            "approval_exhausted",
        ):
            self.assertTrue(authorization[field])
        for field in (
            "approval_reusable",
            "retry_authorized_by_consumed_approval",
            "future_live_action_authorized_by_this_record",
            "retell_agent_development_or_testing_authorized",
            "production_or_customer_activity_authorized",
            "private_packet_or_variable_map_digests_included",
        ):
            self.assertFalse(authorization[field])

        attempt = evidence["attempt"]
        self.assertEqual(attempt["requested_environment_variable_count"], 28)
        self.assertFalse(attempt["requested_environment_variable_names_or_values_included"])
        self.assertFalse(attempt["operator_visible_orchestration_result_complete"])
        self.assertEqual(
            attempt["operator_visible_orchestration_result_status"],
            "truncated_before_a_deterministic_write_or_in_packet_rollback_result_was_available",
        )
        self.assertFalse(
            attempt["private_in_packet_execution_status_record_available_for_reconciliation"]
        )
        self.assertFalse(attempt["provider_write_or_in_packet_rollback_sequence_proven"])
        self.assertFalse(attempt["write_persistence_proven"])
        self.assertFalse(attempt["retry_performed"])
        self.assertFalse(attempt["additional_rollback_write_performed_during_reconciliation"])

        readback = evidence["independent_post_attempt_readback"]
        self.assertTrue(readback["function_readback_complete"])
        self.assertEqual(readback["function_name"], "revenue_desk_call_worker")
        self.assertEqual(readback["function_type"], "job")
        self.assertEqual(readback["runtime"], "node24")
        self.assertEqual(readback["memory_mb"], 256)
        self.assertEqual(readback["environment_variable_count"], 0)
        self.assertFalse(readback["approved_environment_map_persisted"])
        self.assertFalse(readback["partial_environment_map_present"])
        self.assertTrue(readback["exact_empty_prestate_preserved_or_restored"])
        self.assertFalse(readback["worker_required_runtime_binding_present"])
        self.assertTrue(readback["worker_static_configuration_contract_fails_closed"])
        self.assertFalse(readback["worker_runtime_fail_closed_invocation_proven"])
        self.assertFalse(
            readback[
                "provider_complete_post_attempt_job_or_direct_caller_invocation_absence_proven"
            ]
        )
        self.assertFalse(readback["transient_active_binding_or_invocation_excluded"])

        containment = evidence["containment"]
        self.assertTrue(containment["current_empty_map_requires_no_additional_rollback_write"])
        for field in (
            "operator_route_invocations",
            "operator_function_invocations",
            "operator_job_invocations",
            "operator_cron_submissions",
        ):
            self.assertEqual(containment[field], 0)
        self.assertFalse(containment["retell_agent_changed_tested_simulated_called_or_published"])
        self.assertFalse(containment["customer_or_production_action_performed"])
        self.assertFalse(containment["gateway_mutation_performed"])
        self.assertTrue(containment["gateway_state_reverified_after_worker_attempt"])
        self.assertEqual(
            containment["post_attempt_gateway_readback_captured_at_utc"],
            "2026-08-28T00:02:44.582Z",
        )
        self.assertTrue(containment["gateway_disabled_readback_after_worker_attempt"])
        self.assertTrue(containment["gateway_readback_failed_closed_without_route_payload"])
        self.assertFalse(containment["runtime_acceptance_proven"])

        inventory = self.inventory[
            "development_worker_binding_attempt_containment_2026_08_27"
        ]
        self.assertEqual(inventory["outcome"], evidence["outcome"])
        self.assertEqual(inventory["source_revision"], evidence["source_revision"])
        self.assertEqual(inventory["requested_environment_variable_count"], 28)
        self.assertFalse(inventory["operator_visible_orchestration_result_complete"])
        self.assertFalse(
            inventory[
                "private_in_packet_execution_status_record_available_for_reconciliation"
            ]
        )
        self.assertFalse(inventory["provider_write_or_in_packet_rollback_sequence_proven"])
        self.assertTrue(inventory["independent_worker_readback_complete"])
        self.assertEqual(inventory["worker_function_type"], "job")
        self.assertEqual(inventory["worker_runtime"], "node24")
        self.assertEqual(inventory["worker_memory_mb"], 256)
        self.assertEqual(inventory["worker_environment_variable_count"], 0)
        self.assertFalse(inventory["approved_environment_map_persisted"])
        self.assertFalse(inventory["partial_environment_map_present"])
        self.assertTrue(inventory["exact_empty_prestate_preserved_or_restored"])
        self.assertFalse(
            inventory[
                "provider_complete_post_attempt_job_or_direct_caller_invocation_absence_proven"
            ]
        )
        self.assertFalse(inventory["transient_active_binding_or_invocation_excluded"])
        self.assertFalse(inventory["retry_performed"])
        self.assertTrue(inventory["single_use_approval_consumed_and_exhausted"])
        self.assertFalse(inventory["consumed_approval_reusable"])
        self.assertTrue(inventory["fresh_exact_single_use_packet_required_before_any_retry"])
        self.assertFalse(inventory["operator_route_function_job_or_cron_invocation_performed"])
        self.assertFalse(inventory["retell_agent_changed_tested_simulated_called_or_published"])
        self.assertFalse(inventory["operator_production_or_customer_activity_performed"])
        self.assertTrue(inventory["gateway_state_reverified_after_worker_attempt"])
        self.assertEqual(
            inventory["post_attempt_gateway_readback_captured_at_utc"],
            containment["post_attempt_gateway_readback_captured_at_utc"],
        )
        self.assertTrue(inventory["gateway_disabled_readback_after_worker_attempt"])
        self.assertTrue(inventory["gateway_readback_failed_closed_without_route_payload"])
        self.assertFalse(inventory["future_live_action_authorized_by_this_record"])
        self.assertEqual(
            inventory["evidence"],
            "evidence/free-revenue-leak-test-development-worker-binding-containment-2026-08-27.json",
        )

        deployment_entry = self.deployment_log.split(
            "## 2026-08-27 — Revenue Desk Development Worker Binding Attempt Consumed And Contained",
            maxsplit=1,
        )[1].split(
            "## 2026-08-27 — Revenue Desk Development Gateway Continuation Completed And Contained",
            maxsplit=1,
        )[0]
        for phrase in (
            "consumed by the one attempt, exhausted, and not reusable",
            "the expected private in-packet execution-status record was unavailable for reconciliation",
            "remained a Node 24 Job function at 256 MB with exactly zero environment variables",
            "The approved map did not persist, no partial map was present",
            "performed no route, function, Job, or Cron invocation",
            "a transient active binding or invocation cannot be excluded",
            "captured at `2026-08-28T00:02:44.582Z`",
            "confirmed API Gateway disabled and fail-closed without returning a route payload",
            "do not retry under the consumed approval",
        ):
            self.assertIn(phrase, deployment_entry)

        for phrase in (
            "An exact single-use connector attempt to install the approved 28-variable worker map was consumed but did not persist",
            "no retry occurred",
            "a transient active binding or invocation during the earlier ambiguous connector attempt cannot be excluded",
            "fresh post-attempt connector readback captured at `2026-08-28T00:02:44.582Z` confirmed API Gateway disabled",
        ):
            self.assertIn(phrase, self.reconciliation_runbook)

        serialized = json.dumps(evidence, sort_keys=True).lower()
        for forbidden in (
            "client_secret", "refresh_token", "access_token", "invoke_url",
            "project_id", "organization_id", "environment_id", "function_id",
            "agent_id", "version_id", "number_id", "zaid", "archive_sha256",
            "download_path", "upload_path", "http://", "https://",
        ):
            self.assertNotIn(forbidden, serialized)

    def test_worker_ui_packet_is_consumed_exactly_rolled_back_and_non_reusable(self):
        evidence = self.worker_ui_rollback
        self.assertEqual(evidence["schema_version"], 1)
        self.assertEqual(
            evidence["record_type"],
            "sanitized_free_revenue_leak_test_development_worker_ui_rollback",
        )
        self.assertEqual(evidence["environment"], "Development")
        self.assertEqual(
            evidence["outcome"], "single_variable_created_then_exactly_rolled_back"
        )

        authorization = evidence["authorization"]
        self.assertTrue(authorization["approval_consumed_by_first_successful_save"])
        self.assertTrue(authorization["approval_exhausted"])
        self.assertFalse(authorization["approval_reusable"])
        self.assertFalse(authorization["retry_authorized_by_consumed_approval"])
        self.assertFalse(authorization["future_live_action_authorized_by_this_record"])
        self.assertFalse(authorization["retell_agent_development_or_testing_authorized"])
        self.assertFalse(authorization["production_or_customer_activity_authorized"])

        prestate = evidence["verified_prestate"]
        self.assertEqual(prestate["function_name"], "revenue_desk_call_worker")
        self.assertEqual(prestate["runtime"], "node24")
        self.assertEqual(prestate["memory_mb"], 256)
        self.assertEqual(prestate["environment_variable_count"], 0)
        self.assertTrue(prestate["gateway_disabled"])
        self.assertEqual(prestate["canonical_cron_reference_count"], 0)

        attempt = evidence["attempt"]
        self.assertEqual(attempt["requested_environment_variable_count"], 28)
        self.assertTrue(attempt["first_variable_save_succeeded"])
        self.assertTrue(attempt["approval_consumed_after_first_save"])
        self.assertTrue(attempt["next_create_control_unavailable"])
        self.assertTrue(attempt["automation_stopped_immediately"])
        self.assertFalse(attempt["retry_performed"])
        self.assertFalse(attempt["additional_variable_save_attempted"])
        self.assertEqual(attempt["successfully_created_variable_count"], 1)
        self.assertFalse(attempt["global_configuration_save_performed"])

        rollback = evidence["rollback"]
        self.assertEqual(rollback["variables_removed"], 1)
        self.assertTrue(rollback["only_packet_created_variable_removed"])
        self.assertTrue(rollback["removal_confirmed_in_ui"])
        self.assertTrue(rollback["normal_create_control_restored_in_ui"])
        self.assertFalse(rollback["additional_configuration_changed"])

        readback = evidence["independent_post_rollback_readback"]
        self.assertTrue(readback["function_readback_complete"])
        self.assertEqual(readback["environment_variable_count"], 0)
        self.assertFalse(readback["partial_environment_map_present"])
        self.assertTrue(readback["exact_empty_prestate_restored"])
        self.assertEqual(readback["memory_mb"], 256)
        self.assertTrue(readback["gateway_disabled"])
        self.assertTrue(readback["gateway_readback_failed_closed_without_route_payload"])
        self.assertEqual(readback["canonical_cron_reference_count"], 0)

        inventory = self.inventory["development_worker_ui_rollback_2026_08_28"]
        self.assertEqual(inventory["outcome"], evidence["outcome"])
        self.assertEqual(inventory["successfully_created_variable_count"], 1)
        self.assertEqual(inventory["rollback_variables_removed"], 1)
        self.assertEqual(inventory["worker_environment_variable_count"], 0)
        self.assertTrue(inventory["exact_empty_prestate_restored"])
        self.assertTrue(inventory["gateway_disabled_after_rollback"])
        self.assertEqual(inventory["canonical_cron_reference_count"], 0)
        self.assertTrue(inventory["single_use_approval_consumed_and_exhausted"])
        self.assertFalse(inventory["consumed_approval_reusable"])
        self.assertFalse(inventory["future_live_action_authorized_by_this_record"])
        self.assertTrue(inventory["pr_head_artifact_readback_required_before_final_worker_binding"])

        deployment_entry = self.deployment_log.split(
            "## 2026-08-28 — Revenue Desk Development Worker UI Packet Consumed And Exactly Rolled Back",
            maxsplit=1,
        )[1].split(
            "## 2026-08-27 — Revenue Desk Development Worker Binding Attempt Consumed And Contained",
            maxsplit=1,
        )[0]
        for phrase in (
            "consumed by the first successful variable save, exhausted, and not reusable",
            "The next Create control was unavailable",
            "removed only that one variable",
            "proved exactly zero worker variables",
            "zero canonical Cron references",
            "Finish the immutable PR-head release first",
        ):
            self.assertIn(phrase, deployment_entry)

        for phrase in (
            "A later separately approved first-party UI packet saved one Development variable",
            "removed only that one variable through its preauthorized rollback",
            "Both worker approvals are consumed, exhausted, non-reusable",
            "The next worker binding must occur only after exact PR-head Development artifact readback",
        ):
            self.assertIn(phrase, self.reconciliation_runbook)

        serialized = json.dumps(evidence, sort_keys=True).lower()
        for forbidden in (
            "client_secret", "refresh_token", "access_token", "invoke_url",
            "project_id", "organization_id", "environment_id", "function_id",
            "agent_id", "version_id", "number_id", "zaid", "http://", "https://",
        ):
            self.assertNotIn(forbidden, serialized)

    def test_dark_production_preflight_proves_not_initialized_without_claiming_empty_inventory(self):
        evidence = self.dark_production_prestate
        self.assertEqual(evidence["schema_version"], 1)
        self.assertEqual(
            evidence["record_type"],
            "sanitized_free_revenue_leak_test_dark_production_prestate",
        )
        self.assertEqual(evidence["target_environment"], "Production")
        self.assertEqual(evidence["source_revision"], ROUTE_CONTRACT_SOURCE_REVISION)

        connector = evidence["connector_first_readback"]
        self.assertTrue(connector["development_project_metadata_readback_succeeded"])
        self.assertEqual(connector["observed_environment_count"], 1)
        self.assertEqual(connector["observed_environment_names"], ["Development"])
        self.assertEqual(connector["observed_development_environment_status"], "Active")
        for field in (
            "production_project_readback_succeeded",
            "production_function_inventory_readback_succeeded",
            "production_table_inventory_readback_succeeded",
            "production_job_pool_inventory_readback_succeeded",
            "production_cron_inventory_readback_succeeded",
            "production_route_inventory_readback_succeeded",
            "production_zero_resource_state_proven",
        ):
            self.assertFalse(connector[field])
        self.assertEqual(connector["shared_failure_class"], "invalid_environment_name")

        browser = evidence["governed_browser_fallback"]
        self.assertTrue(browser["authenticated_project_console_readback_succeeded"])
        self.assertTrue(browser["deploy_to_production_control_visible"])
        self.assertFalse(browser["deploy_to_production_control_clicked"])
        self.assertFalse(browser["production_initialization_or_deployment_performed"])
        self.assertFalse(browser["production_configuration_or_traffic_mutated"])

        conclusion = evidence["conclusion"]
        self.assertFalse(conclusion["production_environment_initialized"])
        self.assertFalse(conclusion["dark_production_deployment_exists"])
        self.assertFalse(conclusion["dark_production_deployment_absence_proven_by_inventory"])
        self.assertFalse(conclusion["future_production_write_authorized_by_this_record"])

        containment = evidence["containment"]
        self.assertTrue(containment["connector_calls_were_read_only"])
        self.assertTrue(containment["browser_actions_were_navigation_and_readback_only"])
        for field in (
            "gateway_or_route_mutation_performed",
            "function_table_job_pool_or_cron_mutation_performed",
            "route_function_job_or_cron_invocation_performed",
            "retell_agent_development_test_simulation_call_publish_or_provider_route_change_performed",
            "customer_or_production_traffic_action_performed",
        ):
            self.assertFalse(containment[field])

        inventory = self.inventory["dark_production_prestate_2026_08_28"]
        self.assertEqual(
            inventory["outcome"],
            "dark_production_prestate_not_initialized_read_only_contained",
        )
        self.assertFalse(inventory["production_inventory_readback_succeeded"])
        self.assertFalse(inventory["production_zero_resource_state_proven"])
        self.assertFalse(inventory["production_environment_initialized"])
        self.assertTrue(inventory["governed_browser_fallback_required"])
        self.assertTrue(inventory["deploy_to_production_control_visible"])
        self.assertFalse(inventory["deploy_to_production_control_clicked"])
        self.assertFalse(inventory["future_production_write_authorized_by_this_record"])

        self.assertNotIn(
            "Revenue Desk Dark-Production Preflight Contained Before Initialization",
            self.deployment_log,
        )

        self.assertIn("- **Revision date:** 2026-08-28", self.reconciliation_runbook)
        self.assertIn(
            "Production is not initialized, no zero-resource Production inventory is claimed",
            self.reconciliation_runbook,
        )

        serialized = json.dumps(evidence, sort_keys=True).lower()
        for forbidden in (
            "project_id", "organization_id", "environment_id", "function_id",
            "table_id", "jobpool_id", "route_id", "agent_id", "number_id",
            "client_secret", "refresh_token", "access_token", "zcfkey",
            "http://", "https://",
        ):
            self.assertNotIn(forbidden, serialized)

    def test_non_retell_provider_preflights_are_sanitized_and_blocking(self):
        crm = self.crm_live_preflight
        self.assertEqual(crm["observed_at"], "2026-08-28")
        self.assertEqual(crm["matching_metadata"]["required_deal_field_count"], 17)
        self.assertEqual(crm["matching_metadata"]["revenue_desk_sales_stage_count"], 8)
        self.assertTrue(crm["matching_metadata"]["revenue_desk_sales_stage_order_exact"])
        self.assertEqual(
            crm["blocking_gaps"]["journey_workflow_rules_with_non_null_execution_markers"],
            4,
        )
        self.assertEqual(crm["blocking_gaps"]["blueprint_candidate_status"], "Draft")
        self.assertEqual(crm["blocking_gaps"]["active_blueprint_count"], 0)
        self.assertFalse(
            crm["blocking_gaps"]["blueprint_pipeline_binding_matches_revenue_desk_sales"]
        )
        self.assertFalse(
            crm["blocking_gaps"]["record_internal_approval_transition_present"]
        )
        self.assertFalse(crm["blocking_gaps"]["activate_test_route_transition_present"])
        self.assertEqual(crm["blocking_gaps"]["associated_automation_function_count"], 7)
        self.assertFalse(crm["blocking_gaps"]["webhook_inventory_complete"])
        self.assertFalse(crm["blocking_gaps"]["connection_inventory_complete"])
        self.assertFalse(crm["blocking_gaps"]["runtime_acceptance_proven"])
        for field in (
            "records_or_record_photos_read",
            "customer_prospect_or_employee_pii_read",
            "browser_fallback_used",
            "writes_or_runtime_invocations_performed",
            "retell_action_performed",
            "customer_communication_or_production_traffic_action_performed",
        ):
            self.assertFalse(crm["evidence_boundary"][field])
        self.assertFalse(crm["future_live_change_authorized_by_this_record"])

        billing = self.billing_test_catalog_preflight
        boundary = billing["evidence_boundary"]
        self.assertEqual(billing["observed_at"], "2026-08-28")
        self.assertEqual(boundary["accessible_test_organization_count"], 1)
        self.assertTrue(boundary["isolated_active_test_organization"])
        self.assertEqual(boundary["currency"], "USD")
        catalog = billing["complete_paginated_catalog_readback"]
        self.assertEqual(catalog["page_count"], 1)
        self.assertFalse(catalog["has_more"])
        self.assertEqual((catalog["product_count"], catalog["plan_count"], catalog["addon_count"]), (1, 1, 0))
        self.assertEqual(
            catalog["existing_product_or_plan_matches_private_target_contract"],
            "unproven",
        )
        target = billing["required_target_contract"]
        self.assertEqual(
            target["monthly_plan_keys"],
            ["Launch::Monthly", "Growth::Monthly", "Scale::Monthly"],
        )
        self.assertEqual(target["monthly_plan_count"], 3)
        self.assertEqual(target["current_minimum_missing_plan_slots"], 2)
        self.assertFalse(target["connected_minute_usage_addon_present"])
        for field in (
            "enable_paid_subscription_preparation",
            "catalog_creation_authorized",
            "subscription_creation_authorized",
            "payment_charge_invoice_or_auto_collect_authorized",
        ):
            self.assertFalse(billing["containment"][field])
        self.assertFalse(
            boundary["customer_subscription_invoice_payment_event_or_report_records_read"]
        )
        self.assertFalse(boundary["writes_or_runtime_invocations_performed"])
        self.assertFalse(billing["future_live_change_authorized_by_this_record"])

        forms = self.forms_manifest["connector_preflight_2026_08_28"]
        for field in (
            "sylvara_forms_audit_connector_available",
            "sylvara_forms_changes_connector_available",
            "zoho_creator_form_metadata_is_a_forms_connector",
            "creator_connector_substituted",
            "browser_fallback_used",
            "current_live_state_refreshed",
            "writes_or_runtime_submissions_performed",
            "retell_customer_or_production_action_performed",
            "future_live_change_authorized_by_this_record",
        ):
            self.assertFalse(forms[field])
        self.assertTrue(forms["known_form1_blockers_remain"])
        self.assertTrue(forms["known_form2_blockers_remain"])

        analytics = self.analytics_live_source_parity["connector_preflight_2026_08_28"]
        self.assertEqual(analytics["accessible_analytics_organization_count"], 1)
        self.assertEqual(analytics["accessible_workspace_count"], 2)
        self.assertEqual(analytics["development_workspace_view_count"], 30)
        self.assertEqual(analytics["development_workspace_folder_count"], 6)
        self.assertEqual(analytics["legacy_source_table_matches"], 3)
        for field in (
            "canonical_target_table_matches",
            "canonical_query_view_matches",
            "canonical_report_title_matches",
            "canonical_dashboard_title_matches",
        ):
            self.assertEqual(analytics[field], 0)
        function = analytics["analytics_function"]
        self.assertEqual(function["runtime"], "node24")
        self.assertEqual(function["memory_mb"], 256)
        self.assertEqual(function["environment_variable_count"], 7)
        self.assertEqual(function["source_revision"], ROUTE_CONTRACT_SOURCE_REVISION)
        self.assertEqual(function["analytics_sync_mode"], "disabled")
        self.assertFalse(function["provider_bindings_present"])
        self.assertFalse(analytics["analytics_rows_or_exports_read"])
        self.assertFalse(
            analytics["writes_imports_runtime_invocations_or_dashboard_actions_performed"]
        )
        self.assertFalse(analytics["retell_customer_or_production_action_performed"])
        self.assertFalse(analytics["future_live_change_authorized_by_this_record"])

        for phrase in (
            "no installed Sylvara Forms Audit or Changes connector",
            "one product, one active monthly plan, and zero add-ons",
            "matched all 17 required Deal fields and the exact eight-stage pipeline",
            "found 30 views and six folders",
            "zero matches for the five canonical target tables",
        ):
            self.assertIn(phrase, self.reconciliation_runbook)

        combined = json.dumps(
            {
                "crm": crm,
                "billing": billing,
                "forms": forms,
                "analytics": analytics,
            },
            sort_keys=True,
        ).lower()
        for forbidden_key in (
            "project_id", "organization_id", "environment_id", "function_id",
            "workspace_id", "product_id", "plan_id", "addon_id", "record_id",
            "client_secret", "refresh_token", "access_token", "zcfkey",
        ):
            self.assertNotIn(f'"{forbidden_key}"', combined)
        for forbidden_value in ("http://", "https://"):
            self.assertNotIn(forbidden_value, combined)

    def test_packet_a_public_runbooks_match_sanitized_execution_and_revision(self):
        superseding_entry = self.deployment_log.split(
            "## 2026-08-26 — Revenue Desk Development Packet A Superseding Resolution",
            maxsplit=1,
        )[1].split(
            "## 2026-08-26 — Revenue Desk Development Packet A Partial Execution And Containment",
            maxsplit=1,
        )[0]

        self.assertIn("the table count returned from 36 to 35", superseding_entry)
        self.assertIn(
            "temporary disposable tables and synthetic proof rows were created and deleted",
            superseding_entry,
        )
        self.assertIn(
            "no retained or canonical business record, function, route, Retell agent, "
            "or Production state was changed",
            superseding_entry,
        )
        self.assertNotIn("the table count remained 35", superseding_entry)
        self.assertNotIn("no record state was created or changed", superseding_entry)
        self.assertIn(
            "- **Revision date:** 2026-08-28",
            self.reconciliation_runbook,
        )
        self.assertNotIn(
            "- **Revision date:** 2026-08-26",
            self.reconciliation_runbook,
        )

    def test_dark_production_and_staged_cleanup_are_fail_closed(self):
        production = self.contract["production_scope"]
        self.assertTrue(production["deployment_required"])
        self.assertEqual(production["mode"], "dark")
        self.assertEqual(production["source"], "final main")
        self.assertTrue(production["independent_credentials_required"])
        self.assertTrue(production["synthetic_isolated_e2e_required"])
        for field in (
            "retell_number_or_webhook_binding",
            "recurring_triggers_enabled",
            "real_records_allowed",
            "real_calls_allowed",
            "traffic_activation_allowed",
        ):
            self.assertFalse(production[field])

        inventory_production = self.inventory["environment_targets"]["Production"]
        self.assertEqual(inventory_production["mode"], "dark")
        self.assertTrue(inventory_production["final_main_only"])
        for field in (
            "retell_binding_allowed",
            "recurring_trigger_allowed",
            "real_records_allowed",
            "real_calls_allowed",
            "traffic_activation_allowed",
        ):
            self.assertFalse(inventory_production[field])

        cleanup = self.contract["staged_cleanup"]
        self.assertFalse(cleanup["current_table_migration_or_deletion_authorized"])
        self.assertFalse(cleanup["zero_rows_establish_obsolescence"])
        self.assertIn(
            "exact pull-request-head Development source/runtime parity",
            cleanup["legacy_runtime_and_table_deletion_allowed_only_after"],
        )
        self.assertNotIn(
            "dark-Production smoke test",
            cleanup["legacy_runtime_and_table_deletion_allowed_only_after"],
        )
        self.assertIn(
            "dark-Production smoke test",
            cleanup["standalone_form_project_deletion_allowed_only_after"],
        )
        self.assertIn(
            "final-main Development deployment and parity",
            cleanup["standalone_form_project_deletion_allowed_only_after"],
        )
        self.assertTrue(
            cleanup["dark_production_may_precede_retell_bound_development_cleanup"]
        )
        self.assertFalse(
            cleanup["delete_superseded_call_tables_before_first_production_deployment"]
        )
        self.assertTrue(
            cleanup["delete_retell_bound_legacy_assets_before_retell_testing_or_traffic"]
        )
        quarantine = " ".join(
            cleanup["retell_bound_legacy_assets_may_remain_only_for_dark_production_if"]
        )
        for term in (
            "Development",
            "route",
            "credential",
            "independent credentials",
            "recoverable",
        ):
            self.assertIn(term, quarantine)
        self.assertTrue(cleanup["delete_duplicate_and_probe_form_tables_before_first_production_deployment"])
        self.assertTrue(cleanup["rotate_retained_development_credentials"])
        self.assertTrue(cleanup["revoke_deleted_function_credentials"])
        self.assertTrue(cleanup["production_credentials_independent"])
        self.assertTrue(
            production["retell_bound_development_assets_may_remain_quarantined"]
        )
        self.assertTrue(
            production["retell_bound_cleanup_required_before_retell_testing_or_traffic"]
        )
        self.assertEqual(
            cleanup["client_portal_gateway_action"],
            "required_hardening_pending",
        )
        self.assertFalse(cleanup["client_portal_gateway_hardening_complete"])
        self.assertFalse(
            cleanup["client_portal_gateway_development_deployment_authorized"]
        )
        self.assertFalse(cleanup["client_portal_gateway_credential_rotation_authorized"])
        self.assertFalse(
            cleanup["client_portal_gateway_production_activation_authorized"]
        )
        self.assertFalse(cleanup["client_portal_duplicate_removal_authorized"])
        table_gates = " ".join(cleanup["table_migration_or_deletion_gates"])
        for term in ("classified", "mapped", "counts", "digests", "exact key set", "rollback", "absent"):
            self.assertIn(term, table_gates)

        self.assertEqual(self.inventory["schema_version"], 8)
        snapshot = self.inventory["development_data_store_readback_2026_08_24"]
        self.assertEqual(snapshot["readback_page_size"], 300)
        self.assertTrue(snapshot["pagination_completed_for_counts"])
        self.assertEqual(snapshot["observed_table_count"], 29)
        self.assertEqual(snapshot["observed_nonzero_table_count"], 16)
        self.assertEqual(snapshot["observed_zero_row_table_count"], 13)
        self.assertEqual(snapshot["nonzero_table_counts"], {
            "AnalyticsSyncCheckpoints": 10,
            "AnalyticsSyncOutbox": 307,
            "Calls": 13,
            "ClientDailyMetrics": 10,
            "ClientDeployments": 2,
            "ConfigurationVersions": 2,
            "Form1AssistedSessions": 8,
            "Free_Test_Setup_Prefills": 13,
            "Free_Test_Setup_Sessions": 4,
            "FreeTestCalls": 30,
            "FreeTestDeployments": 3,
            "FreeTestNotifications": 6,
            "FreeTestRetellEventReceipts": 39,
            "InboundResolverEvents": 13,
            "OutcomeLinks": 5,
            "ReportRuns": 1,
        })
        self.assertFalse(snapshot["table_migration_or_deletion_authorized"])
        self.assertFalse(self.inventory["staged_cleanup"]["current_table_migration_or_deletion_allowed"])
        required_gates = " ".join(snapshot["required_gate_evidence"])
        for term in ("classify every", "map every", "row counts", "digests", "read back", "rollback"):
            self.assertIn(term, required_gates)

        portal = self.inventory["client_portal_gateway"]
        self.assertEqual(portal["classification"], "required_hardening_pending")
        self.assertEqual(portal["observed_revision_count"], 3)
        self.assertFalse(portal["observed_revisions_identical"])
        self.assertTrue(portal["billing_webhook_active"])
        self.assertTrue(portal["development_route_target_match_proven"])
        self.assertEqual(portal["one_year_visible_delivery_history_rows"], 0)
        self.assertTrue(portal["raw_oauth_refresh_material_observed_privately"])
        self.assertFalse(portal["catalyst_connection_usage_observed"])
        self.assertFalse(portal["creator_custom_api_inventory_proven"])
        self.assertFalse(portal["all_external_dependencies_proven"])
        self.assertEqual(portal["required_current_action"], "required_hardening_pending")
        self.assertFalse(portal["hardening_complete"])
        self.assertEqual(
            portal["hardening_required_before_reclassification"],
            cleanup["client_portal_gateway_required_before_reclassification"],
        )
        self.assertFalse(portal["development_deployment_authorized"])
        self.assertFalse(portal["credential_rotation_authorized"])
        self.assertFalse(portal["duplicate_removal_authorized"])

        audit = self.client_portal_audit
        self.assertEqual(audit["classification"], "required_hardening_pending")
        self.assertEqual(audit["private_full_source_scan"]["reviewed_live_revision_count"], 3)
        self.assertEqual(
            audit["billing_webhook"]["target_binding_assessment"],
            "exactly_matches_development_route_path",
        )
        self.assertFalse(
            audit["decision"]["development_deployment_authorized"]
        )
        self.assertFalse(audit["decision"]["credential_rotation_authorized"])
        self.assertFalse(audit["decision"]["duplicate_removal_authorized"])
        self.assertFalse(audit["decision"]["production_activation_authorized"])
        self.assertEqual(
            audit["decision"]["required_before_reclassification"],
            cleanup["client_portal_gateway_required_before_reclassification"],
        )

        legacy = {entry["name"] for entry in self.contract["legacy_function_migration"]["functions"]}
        self.assertEqual(legacy, {
            "retell_events",
            "retell_inbound_resolver",
            "retell_route_approval_control",
            "process_retell_events",
            "retell_free_test",
            "retell_free_test_retry",
            "analytics_sync",
        })
        self.assertNotIn("Production", self.contract["out_of_scope"])
        self.assertIn("paid capability activation", self.contract["out_of_scope"])

    def test_retell_and_form_routes_match_the_canonical_boundaries(self):
        self.assertEqual(self.contract["retell_integration"]["shared_agent_count"], 1)
        self.assertFalse(self.contract["retell_integration"]["agent_id_alone_establishes_tenant"])
        self.assertEqual(
            set(self.contract["canonical_coverage_modes"].values()),
            {"AfterHoursOnly", "NoAnswerOverflowOnly", "AfterHoursAndOverflow"},
        )

        retell_routes = [
            entry for entry in self.contract["route_manifest"]
            if entry["id"].startswith("RETELL_")
        ]
        self.assertEqual([entry["id"] for entry in retell_routes], [
            "RETELL_INBOUND",
            "RETELL_EVENTS",
            "RETELL_READINESS",
        ])
        self.assertTrue(all(
            entry["function"] == "revenue_desk_call_gateway"
            for entry in retell_routes
        ))
        self.assertFalse(any(
            entry["function"] in {"revenue_desk_call_worker", "analytics_sync"}
            for entry in self.contract["route_manifest"]
        ))

        expected_form2_routes = [
            ("FORM2_ISSUE", "POST", "ISSUE_PATH"),
            ("FORM2_ACCESS", "GET", "FORM2_ACCESS_PATH"),
            ("FORM2_OTP_REQUEST", "POST", "FORM2_OTP_REQUEST_PATH"),
            ("FORM2_OTP_VERIFY", "POST", "FORM2_OTP_VERIFY_PATH"),
            ("FORM2_PREFILL", "POST", "PREFILL_PATH"),
            ("FORM2_SUBMISSION", "POST", "SUBMISSION_PATH"),
        ]
        self.assertEqual(
            self.contract["form2"]["routes"],
            [route[0] for route in expected_form2_routes],
        )
        self.assertEqual(
            [(route["id"], route["method"], route["path_reference"]) for route in self.form2_routes["routes"]],
            expected_form2_routes,
        )
        central_form2_routes = [
            (route["id"], route["method"], route["path_reference"])
            for route in self.contract["route_manifest"]
            if route["id"].startswith("FORM2_")
        ]
        self.assertEqual(central_form2_routes, expected_form2_routes)
        self.assertTrue(all(
            route["function"] == "revenue_leak_test_setup_form"
            for route in self.contract["route_manifest"]
            if route["id"].startswith("FORM2_")
        ))

    def test_billing_mapping_and_acceptance_gate_remain_exact(self):
        billing = self.contract["billing_test"]
        self.assertEqual(
            billing["commercial_terms_source"],
            "private Catalyst Development PAID_COMMERCIAL_TERMS_JSON",
        )
        self.assertEqual(billing["required_plan_frequency_keys"], [
            "Launch::Monthly",
            "Growth::Monthly",
            "Scale::Monthly",
        ])
        self.assertEqual(billing["commercial_terms_fields"], [
            "currency",
            "interval",
            "intervalUnit",
            "commonUsageRateMinor",
            "plans.<exact-key>.recurringMinor",
            "plans.<exact-key>.setupMinor",
        ])
        self.assertNotIn("plans", billing)
        self.assertEqual(billing["positive_acceptance_plan"], "Growth Monthly")
        self.assertFalse(billing["real_charge"])
        configured = {
            entry["name"]: entry
            for entry in self.contract["required_new_environment_variables"]
        }
        self.assertTrue(configured["PAID_COMMERCIAL_TERMS_JSON"]["secret"])
        self.assertEqual(
            configured["WORKFLOW_HMAC_SECRET"]["consumer"],
            "revenue_leak_test_setup_form",
        )
        self.assertTrue(configured["WORKFLOW_HMAC_SECRET"]["secret"])

    def test_terminal_report_handoff_is_automatic_revision_safe_and_human_reviewed(self):
        handoff = self.contract["terminal_report_handoff"]
        self.assertEqual(handoff["durable_operation_action"], "sync_report_summary")
        self.assertEqual(handoff["schema_version"], 2)
        self.assertEqual(handoff["identity_domain"], "sylvara.crm-report-summary.v2")
        self.assertIn("v1", handoff["legacy_read_compatibility"])
        self.assertIn("non-null", handoff["legacy_read_compatibility"])
        self.assertIn("crm_billing_orchestrator", handoff["deployment_order"])
        self.assertIn("keep call ingress dark", handoff["deployment_order"])
        self.assertEqual(handoff["automatic_dispatch_owner"],
                         "revenue_desk_call_worker retry_scan in RevenueDeskCallJobs")
        self.assertEqual(handoff["dispatch_limit_per_scan"], 5)
        self.assertEqual(handoff["request_fields"],
                         ["schemaVersion", "action", "dealId", "operationKey"])
        for identity_part in (
            "environment", "deal_id", "deployment_id", "configuration_version",
            "report_schema_version", "canonical_call_set_digest",
            "full_canonical_report_revision_digest", "action",
        ):
            self.assertIn(identity_part, handoff["identity_material"])
        self.assertIn("OPERATION_VERSION", handoff["claim"])
        self.assertIn("never repeats", handoff["ambiguous_replay"])
        self.assertIn("STATUS completed", handoff["completed_gate"])
        self.assertIn("human", handoff["workflow_boundary"])
        self.assertIn("not inferred", handoff["test_new_service_inquiries"])

        report_route = next(
            route for route in self.contract["route_manifest"]
            if route["id"] == "CRM_REPORT_SUMMARY"
        )
        self.assertEqual(report_route["function"], "crm_billing_orchestrator")
        self.assertEqual(report_route["caller"], "revenue_desk_call_worker retry_scan only")
        self.assertIn("ZCFKEY", report_route["authentication"])
        self.assertIn("REPORT_SUMMARY_HEADER_VALUE", report_route["authentication"])

        required_fields = set(self.contract["crm"]["required_deal_fields_existing"])
        self.assertTrue({
            "Test_Calls_Reaching_Route",
            "Test_Qualified_Opportunities",
            "Test_Existing_Customer_Calls",
        }.issubset(required_fields))
        self.assertNotIn("Test_New_Service_Inquiries", required_fields)

        automation = json.loads((
            ROOT / "src/zoho-crm/free-revenue-leak-test/config/automation-contract.json"
        ).read_text(encoding="utf-8"))
        self.assertEqual(automation["terminal_report_handoff"]["sole_caller"],
                         "revenue_desk_call_worker retry_scan mode in the existing RevenueDeskCallJobs Function Job pool")
        complete = automation["blueprint"]["required_transition_invariants"][
            "Complete Free Test"
        ]
        self.assertTrue(any("Test New Service Inquiries is excluded" in item for item in complete))
        self.assertTrue(any("human operator" in item for item in complete))

    def test_analytics_dashboards_and_key_rotation_are_release_gates(self):
        analytics = self.contract["analytics_release"]
        self.assertEqual(
            analytics["model_contract_path"],
            "../../src/zoho-catalyst/revenue-desk-analytics/config/analytics-model-contract.json",
        )
        self.assertEqual(
            analytics["dashboard_contract_path"],
            "../../src/zoho-catalyst/revenue-desk-analytics/config/dashboard-contract.json",
        )
        self.assertEqual(
            analytics["required_record_types"],
            ["deployment", "call", "daily_metric", "final_test_result", "conversion_status"],
        )
        exact_titles = ["Free-Test Operations Dashboard", "Customer Results Dashboard"]
        self.assertEqual(analytics["required_dashboard_titles"], exact_titles)
        self.assertEqual(
            [item["title"] for item in self.analytics_dashboard_contract["dashboards"]],
            exact_titles,
        )
        self.assertEqual(
            [item["key"] for item in self.analytics_dashboard_contract["dashboards"]],
            ["operations", "customer"],
        )
        exact_folder_names = [
            "Revenue Desk - Data Model",
            "Revenue Desk - Operations",
            "Revenue Desk - Customer Results",
        ]
        self.assertEqual(analytics["required_folder_names"], exact_folder_names)
        self.assertEqual(analytics["required_folder_asset_counts"], {
            "data_model": 9,
            "operations": 11,
            "customer_results": 11,
        })
        folder_contract = self.analytics_model_contract["folder_contract"]
        self.assertEqual(folder_contract["api_operations"], {
            "create": "createFolder",
            "place_assets": "moveViewsToFolder",
        })
        self.assertTrue(folder_contract["create_only_if_absent"])
        self.assertTrue(folder_contract["root_level_only"])
        self.assertFalse(folder_contract["make_default_folder"])
        self.assertEqual(
            [folder["folder_name"] for folder in folder_contract["folders"].values()],
            exact_folder_names,
        )
        self.assertTrue(all(
            folder["parent_folder_key"] is None
            for folder in folder_contract["folders"].values()
        ))
        observed_folder_assets = [
            (reference["asset_kind"], reference["asset_key"])
            for folder in folder_contract["folders"].values()
            for reference in folder["asset_references"]
        ]
        expected_folder_assets = (
            [("table", key) for key in self.analytics_model_contract["target_tables"]]
            + [("query_view", key) for key in self.analytics_model_contract["derived_query_views"]]
            + [("report", key) for key in self.analytics_model_contract["reports"]]
            + [("dashboard", key) for key in ("operations", "customer")]
        )
        self.assertEqual(len(observed_folder_assets), 31)
        self.assertEqual(len(set(observed_folder_assets)), 31)
        self.assertEqual(set(observed_folder_assets), set(expected_folder_assets))
        self.assertIn(
            "three canonical root folders and exact 31-view placement independently read back",
            analytics["required_before_ready"],
        )
        engagement = analytics["engagement_semantics"]
        self.assertEqual(engagement, {
            "partition_field": "ENGAGEMENT_TYPE",
            "conversion_status_origin": "free_test",
            "conversion_status_target_field": "TARGET_ENGAGEMENT_TYPE",
            "conversion_status_target": "paid_service",
        })
        dashboard_engagement = self.analytics_dashboard_contract[
            "source_contract"
        ]["engagement_semantics"]["conversion_status"]
        self.assertEqual(
            (dashboard_engagement["origin_field"], dashboard_engagement["origin_value"]),
            (engagement["partition_field"], engagement["conversion_status_origin"]),
        )
        self.assertEqual(
            (dashboard_engagement["target_field"], dashboard_engagement["target_value"]),
            (
                engagement["conversion_status_target_field"],
                engagement["conversion_status_target"],
            ),
        )
        self.assertFalse(analytics["creation_and_sharing_currently_authorized"])
        for field in (
            "public_link_allowed",
            "embed_allowed",
            "scheduled_export_allowed",
            "direct_customer_access_allowed",
        ):
            self.assertFalse(analytics[field])

        references = self.contract["oauth_connection_references"]
        registries = {
            entry["function"]: entry["path"]
            for entry in self.contract["environment_variable_registries"]
        }
        self.assertEqual(set(references), set(registries))
        for function_name, registry_reference in registries.items():
            registry_path = (CONTRACT_PATH.parent / registry_reference).resolve()
            registry = json.loads(registry_path.read_text(encoding="utf-8"))
            component_references = [
                variable["name"] for variable in registry["variables"]
                if variable["name"].endswith("_CONNECTION_LINK_NAME")
            ]
            self.assertEqual(references[function_name], component_references)
        self.assertEqual(references["analytics_sync"], [
            "ANALYTICS_READ_CONNECTION_LINK_NAME",
            "ANALYTICS_WRITE_CONNECTION_LINK_NAME",
        ])
        component_connection_contract = self.analytics_contract[
            "provider_contract"
        ]["connection_references"]
        self.assertEqual(
            references["analytics_sync"],
            [
                component_connection_contract["read"],
                component_connection_contract["write"],
            ],
        )
        self.assertTrue(component_connection_contract["must_be_distinct"])
        self.assertNotEqual(
            references["analytics_sync"][0], references["analytics_sync"][1]
        )

        rotation = self.contract["key_rotation"]
        self.assertEqual(
            rotation["contract_path"],
            "free-revenue-leak-test-key-rotation-contract.json",
        )
        self.assertEqual(
            rotation["runbook_path"],
            "../runbooks/free-revenue-leak-test-key-rotation.md",
        )
        self.assertTrue(rotation["required_before_ready"])
        self.assertEqual(
            rotation["retained_separate_components"],
            ["client_portal_billing_webhook_gateway"],
        )
        self.assertFalse(rotation["expands_exact_six_revenue_desk_functions"])
        self.assertFalse(rotation["exposed_previous_key_after_cutover"])
        self.assertFalse(rotation["production_activation_authorized"])
        self.assertEqual(
            self.key_rotation_contract["functions"],
            [name for name, _function_type in (
                ("revenue_leak_test_request_form", "Advanced I/O"),
                ("revenue_leak_test_setup_form", "Advanced I/O"),
                ("revenue_desk_call_gateway", "Advanced I/O"),
                ("revenue_desk_call_worker", "Job"),
                ("crm_billing_orchestrator", "Advanced I/O"),
                ("analytics_sync", "Job"),
            )],
        )
        self.assertFalse(
            self.key_rotation_contract["rules"]["exposed_previous_key_permitted_after_cutover"]
        )
        self.assertFalse(
            self.key_rotation_contract["rules"]["production_activation_authorized"]
        )
        client_portal_components = self.key_rotation_contract[
            "retained_separate_components"
        ]
        self.assertEqual(
            [entry["id"] for entry in client_portal_components],
            rotation["retained_separate_components"],
        )
        self.assertTrue(all(
            not entry["included_in_exact_six_revenue_desk_functions"]
            for entry in client_portal_components
        ))

    def test_prohibited_live_capabilities_remain_out_of_scope(self):
        excluded = set(self.contract["out_of_scope"])
        for value in (
            "SMS",
            "Retell call",
            "Retell native simulation",
            "booking",
            "dispatch",
            "payment collection",
            "paid capability activation",
            "Launch, Growth, or Scale conversation behavior",
        ):
            self.assertIn(value, excluded)


if __name__ == "__main__":
    unittest.main()
