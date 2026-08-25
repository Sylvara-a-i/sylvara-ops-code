import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = ROOT / "docs" / "product" / "free-revenue-leak-test-release-contract.json"
INVENTORY_PATH = ROOT / "src" / "zoho-catalyst" / "development-function-inventory.json"
TABLE_DISPOSITION_PATH = ROOT / "src" / "zoho-catalyst" / "development-table-disposition.json"
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
ANALYTICS_DASHBOARD_CONTRACT_PATH = (
    ROOT
    / "src"
    / "zoho-catalyst"
    / "revenue-desk-analytics"
    / "config"
    / "dashboard-contract.json"
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
            ("revenue_desk_call_worker", "Job", "job", "node18",
             "revenue_desk_call_worker", "18.x"),
        ),
    ),
    (
        "crm-billing-orchestrator",
        (("crm_billing_orchestrator", "Advanced I/O", "advancedio", "node24",
          "crm_billing_orchestrator", "24.x"),),
    ),
    (
        "revenue-desk-analytics",
        (("analytics_sync", "Job", "job", "node18", "analytics_sync", "18.x"),),
    ),
)


class FreeRevenueLeakReleaseContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
        cls.inventory = json.loads(INVENTORY_PATH.read_text(encoding="utf-8"))
        cls.table_disposition = json.loads(TABLE_DISPOSITION_PATH.read_text(encoding="utf-8"))
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
        cls.analytics_dashboard_contract = json.loads(
            ANALYTICS_DASHBOARD_CONTRACT_PATH.read_text(encoding="utf-8")
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

        boundary = contract["commercial_boundary"]
        self.assertEqual(boundary["duration_calendar_days"], 7)
        self.assertEqual(boundary["connected_call_limit"], 25)
        self.assertFalse(boundary["billing_required_to_start"])
        self.assertFalse(boundary["automatic_paid_conversion"])

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
        self.assertIn("planning-only", plan["status"])
        self.assertFalse(plan["authorization"]["manifest_authorizes_migration"])
        self.assertFalse(plan["authorization"]["manifest_authorizes_deletion"])
        self.assertTrue(plan["authorization"]["scoped_destructive_approval_required"])
        self.assertTrue(plan["authorization"]["independent_readback_required"])

        observed = plan["observed_tables"]
        self.assertEqual(len(observed), 29)
        self.assertEqual(len({entry["api_name"] for entry in observed}), 29)
        self.assertEqual(sum(entry["observed_rows"] for entry in observed), 466)
        self.assertEqual(sum(entry["observed_rows"] > 0 for entry in observed), 16)
        self.assertEqual(sum(entry["observed_rows"] == 0 for entry in observed), 13)
        self.assertEqual(plan["observed_state"], {
            "table_count": 29,
            "row_count": 466,
            "nonzero_table_count": 16,
            "zero_row_table_count": 13,
        })
        self.assertEqual(plan["row_accounting"], {
            "retained_in_place": 317,
            "private_quarantine_required": 149,
            "discarded_without_evidence": 0,
        })
        self.assertEqual(
            plan["row_accounting"]["retained_in_place"]
            + plan["row_accounting"]["private_quarantine_required"],
            plan["observed_state"]["row_count"],
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

        self.assertEqual(len(by_action["retain_additive"]), 2)
        self.assertEqual(len(by_action["retain_bind_canonical"]), 5)
        self.assertEqual(len(by_action["quarantine_then_delete"]), 14)
        self.assertEqual(len(by_action["delete_after_dependency_absence"]), 8)
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
        self.assertEqual(len(created), 6)
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
        schema_create_targets = {
            entry["api_name"] for entry in call_schema["tables"]
            if entry["api_name"] in created
        } | {
            entry["expected_api_name"] for entry in request_schema["tables"]
            if entry["expected_api_name"] in created
        }
        self.assertEqual(schema_create_targets, created)

        analytics = {entry["api_name"]: entry for entry in observed}
        for name in ("AnalyticsSyncCheckpoints", "AnalyticsSyncOutbox"):
            self.assertEqual(analytics[name]["action"], "retain_additive")
            self.assertEqual(analytics[name]["gate_profile"], "retain_additive_nonempty")
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
        self.assertTrue(cleanup["delete_superseded_call_tables_before_first_production_deployment"])
        self.assertTrue(cleanup["delete_duplicate_and_probe_form_tables_before_first_production_deployment"])
        self.assertTrue(cleanup["rotate_retained_development_credentials"])
        self.assertTrue(cleanup["revoke_deleted_function_credentials"])
        self.assertTrue(cleanup["production_credentials_independent"])
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

        self.assertEqual(self.inventory["schema_version"], 6)
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
        self.assertEqual(handoff["identity_domain"], "sylvara.crm-report-summary.v1")
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
