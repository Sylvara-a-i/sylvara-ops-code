import csv
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = (
    ROOT
    / "src"
    / "zoho-crm"
    / "free-revenue-leak-test"
    / "config"
    / "automation-contract.json"
)
CRM_LAYOUT_PATH = (
    ROOT
    / "src"
    / "zoho-crm"
    / "reference"
    / "snapshots"
    / "2026-08-14"
    / "crm-layout-field-order.csv"
)
LIVE_TOPOLOGY_PREFLIGHT_PATH = (
    ROOT
    / "src"
    / "zoho-crm"
    / "free-revenue-leak-test"
    / "evidence"
    / "live-topology-layout-preflight-2026-08-28.json"
)


class FreeRevenueLeakCrmContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
        cls.live_topology = json.loads(
            LIVE_TOPOLOGY_PREFLIGHT_PATH.read_text(encoding="utf-8")
        )

    def test_crm_contract_is_synthetic_only_and_contains_no_active_sign_or_sms_path(self):
        contract = self.contract
        self.assertEqual(contract["schema_version"], 3)
        self.assertEqual(
            contract["status"],
            "source_candidate_requires_development_installation_and_readback",
        )
        self.assertEqual(contract["identifier_migration"]["from_schema_version"], 2)
        self.assertEqual(
            contract["identifier_migration"]["controller_aliases"]["form2_controller"],
            "revenue_leak_test_setup_form",
        )
        self.assertEqual(
            contract["environment_boundary"]["permitted_records"],
            "ZZZ SYNTHETIC only",
        )
        self.assertFalse(
            contract["environment_boundary"]["real_customer_or_prospect_mutation"]
        )
        rendered = json.dumps(contract).lower()
        self.assertTrue('"zoho sign action"' in rendered or '"zoho sign"' in rendered)
        self.assertIn('"sms"', rendered)
        self.assertNotIn("send sms", rendered)
        self.assertNotIn("create sign", rendered)

    def test_crm_contract_records_each_declared_desired_field_once(self):
        fields = self.contract["deal_fields_existing"]
        names = [field["api_name"] for field in fields]
        self.assertEqual(len(names), 17)
        self.assertEqual(len(names), len(set(names)))
        self.assertIn("Approved_Deployment_Record_ID", names)
        self.assertIn("Approved_Configuration_Version", names)
        self.assertIn("Subscription_Acceptance_Version", names)
        self.assertIn("Test_Data_Confidence_Notes", names)
        self.assertIn("Test_Calls_Reaching_Route", names)
        self.assertIn("Test_Qualified_Opportunities", names)
        self.assertIn("Test_Existing_Customer_Calls", names)
        self.assertNotIn("Test_New_Service_Inquiries", names)
        self.assertIn("not standalone", self.contract["deal_fields_existing_semantics"])
        self.assertIn("do not extend", self.contract["deal_fields_existing_semantics"])
        self.assertEqual(self.contract["deal_fields_to_add"], [])
        evidence = self.contract["deal_field_metadata_evidence"]
        self.assertEqual(
            evidence["method"],
            "connector-first read-only live Deals field-metadata, picklist, and active-layout audit",
        )
        self.assertTrue(evidence["field_by_field_public_evidence_available"])
        self.assertEqual(
            evidence["evidence_path"],
            "src/zoho-crm/free-revenue-leak-test/evidence/"
            "live-topology-layout-preflight-2026-08-28.json",
        )
        self.assertIn(
            "closes the historical metadata and layout gap only",
            evidence["authority_limit"],
        )
        self.assertFalse(evidence["private_identifiers_committed"])
        self.assertFalse(evidence["write_performed"])

    def test_entry_offer_values_preserve_crm_display_and_reference_semantics(self):
        values = self.contract["entry_offer_values"]
        self.assertEqual(values, {
            "crm_display_value": "7-Day Revenue Leak Test",
            "crm_actual_reference_value": "Free 7-Day Missed-Call",
            "forms_choice_value": "Free 7-Day Missed-Call",
            "customer_label": "Free Revenue Leak Test",
        })
        self.assertEqual(
            self.contract["legacy_internal_offer_value"],
            values["crm_display_value"],
        )
        workflows_with_offer_criterion = [
            rule["logical_name"]
            for rule in self.contract["workflow_set"]
            if "Entry_Offer equals entry_offer_values.crm_display_value"
            in rule.get("criteria", [])
        ]
        self.assertEqual(
            workflows_with_offer_criterion,
            [
                "FORM1_INTAKE_REVIEW",
                "DEAL_INITIALIZATION",
                "SETUP_ACCESS_ISSUE_IDENTITY",
            ],
        )
        self.assertEqual(
            self.contract["blueprint"]["criteria"],
            "Entry_Offer equals entry_offer_values.crm_display_value",
        )

    def test_crm_contract_has_one_form2_rule_and_one_blueprint(self):
        form2_rules = [
            rule
            for rule in self.contract["workflow_set"]
            if rule["logical_name"] == "FORM2_SUBMISSION"
        ]
        self.assertEqual(len(form2_rules), 1)
        self.assertEqual(
            form2_rules[0]["single_active_rule"],
            "Deals Revenue Leak Test Setup Form Proof Candidate",
        )
        self.assertEqual(
            form2_rules[0]["observed_development_rule"],
            "Deals Form 2 Controller Proof Candidate",
        )
        self.assertEqual(
            form2_rules[0]["desired_development_rule"],
            form2_rules[0]["single_active_rule"],
        )
        self.assertTrue(form2_rules[0]["rename_requires_independent_readback"])
        self.assertEqual(
            form2_rules[0]["criterion_authority"], "reviewed_desired"
        )
        self.assertEqual(
            form2_rules[0]["criterion_ast_rule_key"], "form2Candidate"
        )
        self.assertTrue(form2_rules[0]["desired_criterion_ast_committed"])
        self.assertTrue(
            form2_rules[0]["workflow_repair_candidate_mutation_authorized"]
        )
        self.assertTrue(
            form2_rules[0]["workflow_repair_activation_authorized"]
        )
        self.assertEqual(
            form2_rules[0]["exact_action_contract"]["field_updates"],
            [{"api_name": "Setup_Access_Status", "value": "Submitted"}],
        )
        self.assertEqual(
            form2_rules[0]["exact_action_contract"][
                "deleted_field_update_roles"
            ],
            ["authorizationSigned", "testStatusSetupPending"],
        )
        self.assertEqual(
            form2_rules[0]["exact_action_contract"]["scheduled_actions"], []
        )
        self.assertFalse(form2_rules[0]["repeat"])
        self.assertEqual(
            self.contract["blueprint"]["name"],
            "Revenue Desk Free Test v6 - Control Candidate",
        )

    def test_approval_activation_and_paid_conversion_are_separate_fail_closed_gates(self):
        transitions = self.contract["blueprint"]["required_transition_invariants"]
        approval = transitions["Record Internal Approval"]
        activation = transitions["Activate Test Route"]
        paid = transitions["Activate Subscription"]
        self.assertIn("Approved Deployment Record ID equals Deployment Record ID", approval)
        self.assertIn("Approved Configuration Version equals Configuration Version", approval)
        self.assertIn("Test Status equals Scheduled", approval)
        self.assertIn("Actual Start At and Expires At remain empty", approval)
        self.assertIn("authoritative external-route activation readback present", activation)
        self.assertIn(
            "Catalyst independently validates the activation receipt chained to approval",
            activation,
        )
        self.assertIn("Test Status equals Live", activation)
        self.assertIn("Subscription Acceptance Status equals Accepted", paid)
        self.assertIn("Billing Automation Status equals Paid Verified", paid)
        self.assertIn("no Billing subscription exists", transitions["Propose Subscription"])

    def test_blueprint_topology_cannot_auto_activate_bill_message_or_close_won(self):
        blueprint = self.contract["blueprint"]
        boundary = blueprint["deployment_boundary"]
        self.assertEqual(
            boundary["status"],
            "source_candidate_requires_development_installation_and_readback",
        )
        self.assertTrue(boundary["live_write_authorized"])
        self.assertTrue(boundary["writer_or_provider_payload_contract_in_repository"])
        self.assertFalse(boundary["provider_save_readback_proven"])
        self.assertFalse(boundary["runtime_acceptance_proven"])
        self.assertTrue(boundary["external_evidence_validator_in_repository"])
        validator = boundary["external_evidence_validator"]
        self.assertFalse(validator["runtime_side_effects"])
        self.assertFalse(validator["live_blueprint_caller_wired"])
        self.assertFalse(validator["durable_consumption_cas_writer_in_repository"])
        self.assertFalse(validator["runtime_replay_enforcement_proven"])
        self.assertTrue(
            validator["approval_activation_current_poststate_version_bound"]
        )
        self.assertTrue(
            validator["activation_route_and_prestate_observation_exactly_equal"]
        )
        self.assertTrue(
            validator["terminal_current_deployment_configuration_readback_required"]
        )
        self.assertTrue(
            validator["contract_specific_private_identifier_grammars_enforced"]
        )
        self.assertTrue(
            validator["route_inactive_nullable_bindings_use_tagged_encoding"]
        )
        self.assertTrue(boundary["metadata_and_layout_gate_satisfied"])
        self.assertEqual(
            boundary["live_pipeline_binding_matches_contract"], "not_proven"
        )
        metadata_gate = blueprint["transition_field_metadata_gate"]
        self.assertFalse(metadata_gate["self_authored_release_lists_are_metadata_authority"])
        self.assertTrue(metadata_gate["fresh_readback_required_before_deployment"])
        self.assertTrue(metadata_gate["snapshot_derived_active_layout_gap_satisfied"])
        self.assertEqual(metadata_gate["unverified_api_names"], [])

        topology = blueprint["transition_topology"]
        self.assertEqual(len(topology), 14)
        self.assertEqual(len({item["name"] for item in topology}), 14)
        self.assertEqual(
            [item["name"] for item in topology if item["execution"] == "controller_only"],
            ["Contain Failed Activation"],
        )
        self.assertTrue(
            all(
                item["execution"] == "manual_only"
                for item in topology
                if item["name"] != "Contain Failed Activation"
            )
        )
        self.assertTrue(
            all(
                item["from_state"] in blueprint["states"]
                and item["to_state"] in blueprint["states"]
                for item in topology
            )
        )
        by_name = {item["name"]: item for item in topology}
        topology_field_surface = set()
        for transition in topology:
            topology_field_surface.update(
                value
                for criterion in transition["criteria"]
                for key in ("api_name", "left_api_name", "right_api_name")
                if (value := criterion.get(key)) is not None
            )
            topology_field_surface.update(transition["required_preexisting_fields"])
            topology_field_surface.update(transition["operator_input_fields"])
            for field_group in (
                "conditional_preexisting_fields",
                "conditional_operator_input_fields",
            ):
                topology_field_surface.update(
                    field["api_name"] for field in transition[field_group]
                )
        with CRM_LAYOUT_PATH.open(encoding="utf-8", newline="") as stream:
            active_layout_api_names = {
                row["field_api_name"]
                for row in csv.DictReader(stream)
                if row["module_api_name"] == "Deals"
                and row["layout_status"] == "active"
                and row["metadata_verification_status"] == "verified_live_read_only"
            }
        snapshot_layout_gap = topology_field_surface - active_layout_api_names
        self.assertEqual(
            snapshot_layout_gap,
            set(metadata_gate["snapshot_derived_active_layout_unavailable_api_names"]),
        )
        self.assertEqual(len(snapshot_layout_gap), 25)
        self.assertEqual(
            snapshot_layout_gap,
            set(
                self.live_topology["metadata_and_layout_readback"][
                    "resolved_api_names"
                ]
            ),
        )
        self.assertTrue({
            "Billing_Subscription_ID",
            "Subscription_Status",
            "Subscription_Start_Date",
        }.issubset(snapshot_layout_gap))
        layout_derivation = metadata_gate["active_layout_gap_derivation"]
        self.assertFalse(layout_derivation["self_authored_release_field_union_allowed"])
        self.assertTrue(layout_derivation["fresh_readback_required_for_every_gap"])
        proof = blueprint["form2_controller_proof_evidence"]
        self.assertFalse(proof["standalone_crm_boolean_exists"])
        self.assertFalse(proof["is_signature"])
        self.assertFalse(proof["is_go_live_approval"])
        confirm_fields = {
            criterion["api_name"]
            for criterion in by_name["Confirm Authorization"]["criteria"]
        }
        self.assertEqual(confirm_fields, {
            "Setup_Access_Status",
            "Setup_Form_Submission_ID",
            "Setup_Form_Submitted_At",
            "Authorized_Representative_Confirmed",
            "Test_Scope_Accepted",
            "Authority_Confirmed_At",
            "Test_Scope_Accepted_At",
            "Go_Live_Approval_Status",
        })
        self.assertIn(
            {
                "api_name": "Go_Live_Approval_Status",
                "operator": "not_equals",
                "value": "Approved",
            },
            by_name["Confirm Authorization"]["criteria"],
        )
        self.assertEqual(
            (
                by_name["Record Internal Approval"]["from_state"],
                by_name["Record Internal Approval"]["to_state"],
            ),
            ("Setup and QA", "Setup and QA"),
        )
        self.assertEqual(
            (
                by_name["Activate Test Route"]["from_state"],
                by_name["Activate Test Route"]["to_state"],
            ),
            ("Setup and QA", "Test Live"),
        )
        self.assertEqual(
            by_name["Record Internal Approval"]["external_evidence_requirements"],
            [{
                "contract_id": "internal-approval-receipt-v1",
                "required": True,
                "fresh": True,
                "must_complete_before_transition": True,
            }],
        )
        self.assertEqual(
            by_name["Activate Test Route"]["external_evidence_requirements"],
            [{
                "contract_id": "route-activation-readback-v1",
                "required": True,
                "fresh": True,
                "must_complete_before_transition": True,
            }],
        )
        approval_contract = blueprint["external_evidence_contracts"][
            "internal-approval-receipt-v1"
        ]
        activation_contract = blueprint["external_evidence_contracts"][
            "route-activation-readback-v1"
        ]
        self.assertEqual(
            approval_contract["maximum_prestate_age_at_decision_seconds"], 900
        )
        for evidence in (approval_contract, activation_contract):
            self.assertEqual(
                evidence["validator_status"], "implemented_repository_only"
            )
            self.assertFalse(evidence["mutation_allowed"])
            self.assertEqual(evidence["max_age_at_transition_seconds"], 300)
            self.assertIn("Raw Deal", evidence["private_identifier_policy"])
            self.assertTrue(evidence["one_time_consumption"]["required"])
            self.assertFalse(
                evidence["one_time_consumption"][
                    "durable_compare_and_set_writer_in_repository"
                ]
            )
            self.assertFalse(
                evidence["one_time_consumption"][
                    "runtime_replay_enforcement_in_repository"
                ]
            )
            self.assertEqual(
                evidence["one_time_consumption"]["replay_behavior"], "reject"
            )
            crypto = evidence["cryptographic_boundary"]
            self.assertEqual(crypto["intent_signature_algorithm"], "HMAC-SHA-256")
            self.assertEqual(crypto["evidence_receipt_algorithm"], "HMAC-SHA-256")
            self.assertFalse(crypto["intent_signature_is_legal_signature"])
            claim_paths = {claim["path"] for claim in evidence["required_claims"]}
            self.assertEqual(
                set(crypto["canonical_binding_fields"]),
                claim_paths - {"evidence_receipt"},
            )
            self.assertTrue({
                "deal_id",
                "deployment_record_id",
                "configuration_version",
                "route_fingerprint",
                "approval_event_key",
                "activation_event_key",
                "source_revision",
            }.isdisjoint(claim_paths))
        activation_claims = activation_contract["required_claims"]
        self.assertIn(
            "current_deployment_version_digest",
            approval_contract["cryptographic_boundary"]["canonical_binding_fields"],
        )
        self.assertIn(
            "activation_current_deployment_version_digest",
            activation_contract["cryptographic_boundary"]["canonical_binding_fields"],
        )
        self.assertIn({
            "path": "activation_prestate_observed_at",
            "operator": "equals",
            "source": "evidence.route_observed_at",
        }, activation_claims)
        self.assertIn({
            "path": "route_registry_state",
            "operator": "equals",
            "value": "active",
        }, activation_claims)
        self.assertIn({
            "path": "provider_route_state",
            "operator": "equals",
            "value": "active",
        }, activation_claims)
        self.assertIn({
            "path": "approval_chain_valid",
            "operator": "equals",
            "value": True,
        }, activation_claims)
        self.assertEqual(
            [item["name"] for item in topology if item["to_state"] == "Closed Won"],
            ["Activate Subscription"],
        )
        self.assertIn(
            {"api_name": "Subscription_Status", "operator": "equals", "value": "Active"},
            by_name["Activate Subscription"]["criteria"],
        )
        self.assertEqual(
            by_name["Activate Subscription"]["operator_input_fields"], []
        )
        paid_requirement = by_name["Activate Subscription"][
            "external_evidence_requirements"
        ]
        self.assertEqual(
            paid_requirement[0]["contract_id"],
            "billing-closed-won-reconciliation-v1",
        )
        paid_contract = blueprint["external_evidence_contracts"][
            "billing-closed-won-reconciliation-v1"
        ]
        self.assertEqual(paid_contract["request_action"], "reconcile")
        self.assertTrue(paid_contract["non_creating"])
        self.assertEqual(paid_contract["created_resource_count"], 0)
        self.assertEqual(
            paid_contract["validator_status"], "implemented_repository_only"
        )
        self.assertFalse(paid_contract["mutation_allowed"])
        self.assertEqual(
            paid_contract["maximum_provider_readback_age_at_evidence_seconds"], 300
        )
        self.assertEqual(paid_contract["required_currency"], "USD")
        self.assertEqual(paid_contract["required_usage_addon_unit"], "minute")
        self.assertEqual(
            paid_contract["immutable_subscription_status_map"],
            {"future": "Scheduled", "live": "Active"},
        )
        self.assertEqual(
            paid_contract["closed_won_required_provider_subscription_status"],
            "live",
        )
        self.assertEqual(
            paid_contract["closed_won_required_crm_subscription_status"],
            "Active",
        )
        organization_binding = paid_contract["billing_organization_binding"]
        self.assertEqual(
            organization_binding["billing_readback_field"],
            "billing_organization_id",
        )
        self.assertEqual(
            organization_binding["context_catalog_field"],
            "billing_organization_id",
        )
        self.assertTrue(organization_binding["exact_match_required"])
        self.assertTrue(
            organization_binding["included_in_keyed_reconciliation_binding"]
        )
        self.assertFalse(organization_binding["raw_value_publication_allowed"])
        self.assertIn(
            "billing_organization_id",
            paid_contract["exact_billing_readback_fields"],
        )
        self.assertIn("currency", paid_contract["exact_billing_readback_fields"])
        self.assertIn("usage_addon_unit", paid_contract["exact_billing_readback_fields"])
        self.assertIn(
            "provider_subscription_status",
            paid_contract["exact_billing_readback_fields"],
        )
        self.assertEqual(
            paid_contract["private_identifier_constraints"]["Deployment_Record_ID"],
            "^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$",
        )
        keyed_receipt = paid_contract["keyed_reconciliation_binding"]
        self.assertEqual(keyed_receipt["algorithm"], "HMAC-SHA-256")
        self.assertIn("request_action", keyed_receipt["canonical_binding_fields"])
        self.assertIn("created_resource_count", keyed_receipt["canonical_binding_fields"])

        terminal_contract = blueprint["external_evidence_contracts"][
            "terminal-report-summary-readback-v2"
        ]
        terminal_binding = terminal_contract[
            "current_deployment_configuration_binding"
        ]
        self.assertTrue(terminal_binding["exact_match_required"])
        self.assertTrue(
            {"Deployment_Record_ID", "Configuration_Version"}.issubset(
                terminal_contract["crm_exact_readback_fields"]
            )
        )

        loss_transitions = [item for item in topology if item["to_state"] == "Closed Lost"]
        self.assertEqual(len(loss_transitions), 6)
        for transition in loss_transitions:
            with self.subTest(route_inactive=transition["name"]):
                self.assertIn(
                    "Rollback_Completed_At",
                    transition["required_preexisting_fields"],
                )
                self.assertIn(
                    {"api_name": "Rollback_Completed_At", "operator": "is_not_empty"},
                    transition["criteria"],
                )
                self.assertEqual(
                    transition["external_evidence_requirements"][0]["contract_id"],
                    "route-inactive-readback-v1",
                )
        route_contract = blueprint["external_evidence_contracts"][
            "route-inactive-readback-v1"
        ]
        self.assertEqual(route_contract["max_age_at_transition_seconds"], 300)
        self.assertEqual(route_contract["keyed_binding"]["algorithm"], "HMAC-SHA-256")
        self.assertTrue(route_contract["one_time_consumption"]["required"])
        self.assertFalse(
            route_contract["one_time_consumption"][
                "durable_compare_and_set_writer_in_repository"
            ]
        )
        self.assertFalse(
            route_contract["one_time_consumption"][
                "runtime_replay_enforcement_in_repository"
            ]
        )
        self.assertEqual(
            route_contract["one_time_consumption"]["replay_behavior"], "reject"
        )
        claims = route_contract["required_claims"]
        self.assertIn({
            "path": "route_registry_state",
            "operator": "equals",
            "value": "inactive",
        }, claims)
        self.assertIn({
            "path": "provider_route_state",
            "operator": "equals",
            "value": "inactive",
        }, claims)
        claims_by_path = {}
        for claim in claims:
            claims_by_path.setdefault(claim["path"], []).append(claim)
        self.assertEqual(
            claims_by_path["deal_binding_digest"][0]["operator"],
            "equals_domain_separated_keyed_hmac_of_current_crm_deal_id",
        )
        self.assertEqual(
            claims_by_path["route_fingerprint_digest"][0]["operator"],
            "equals_domain_separated_keyed_hmac_of_authoritative_route_fingerprint",
        )
        observed_rules = {
            claim["operator"]: claim for claim in claims_by_path["observed_at"]
        }
        self.assertEqual(
            observed_rules["greater_than_or_equal_to_max"]["sources"],
            ["evidence.last_route_mutation_at", "crm.Rollback_Completed_At"],
        )
        self.assertEqual(
            observed_rules["age_at_transition_at_most_seconds"]["value"], 300
        )
        self.assertEqual(
            claims_by_path["evidence_receipt"][0]["operator"],
            "equals_keyed_hmac_of_canonical_binding",
        )

        allowed_action_fields = {
            action["api_name"]
            for item in topology
            for action in item["allowed_after_actions"]
        }
        allowed_action_types = {
            action["type"]
            for item in topology
            for action in item["allowed_after_actions"]
        }
        self.assertEqual(allowed_action_fields, {"Test_Status", "Test_Start_At"})
        self.assertEqual(allowed_action_types, {"field_update"})
        self.assertEqual(
            by_name["Close Live Test"]["allowed_after_actions"],
            [
                {
                    "type": "field_update",
                    "api_name": "Test_Status",
                    "value": "Rolled Back",
                }
            ],
        )
        for name in ("Close After Results Review", "Decline Subscription"):
            with self.subTest(completed_loss_path=name):
                self.assertIn(
                    {"api_name": "Test_Status", "operator": "equals", "value": "Completed"},
                    by_name[name]["criteria"],
                )
                self.assertEqual(by_name[name]["allowed_after_actions"], [])
                self.assertEqual(
                    by_name[name]["operator_input_fields"], ["Reason_For_Loss__s"]
                )

        prohibited = " ".join(blueprint["automatic_actions_prohibited"]).lower()
        for marker in (
            "automatic go-live",
            "billing customer",
            "automatic paid acceptance",
            "premature closed won",
            "zoho sign",
            "sms",
        ):
            with self.subTest(prohibited=marker):
                self.assertIn(marker, prohibited)

    def test_fresh_metadata_evidence_is_exact_sanitized_and_non_authorizing(self):
        evidence = self.live_topology
        self.assertEqual(
            evidence["repository_head_at_observation"],
            "0af87a26e2103ddaf4178bf03ebfa67b972cea24",
        )
        self.assertEqual(
            evidence["automation_contract_revision"],
            "2026-08-28-blueprint-topology-v4",
        )
        self.assertNotEqual(
            evidence["automation_contract_revision"],
            self.contract["contract_revision"],
        )
        self.assertTrue(
            self.contract["blueprint"]["transition_field_metadata_gate"]
            ["fresh_readback_required_before_deployment"]
        )
        metadata = evidence["metadata_and_layout_readback"]
        matching = metadata["fields_matching_predeclared_types"]
        newly_explicit = metadata["newly_explicit_type_contracts"]
        matching_names = {item["api_name"] for item in matching}
        new_names = {item["api_name"] for item in newly_explicit}
        resolved = set(metadata["resolved_api_names"])
        self.assertEqual((len(matching), len(newly_explicit), len(resolved)), (21, 4, 25))
        self.assertTrue(matching_names.isdisjoint(new_names))
        self.assertEqual(matching_names | new_names, resolved)
        self.assertEqual(
            {
                item["api_name"]: (item["data_type"], item["json_type"])
                for item in newly_explicit
            },
            {
                "Billing_Automation_Error": ("textarea", "string"),
                "Billing_Automation_Status": ("picklist", "string"),
                "Billing_Last_Sync_At": ("datetime", "string"),
                "Call_Totals_Reconciled": ("boolean", "boolean"),
            },
        )
        self.assertEqual(
            metadata["required_picklist_api_values"]["Subscription_Acceptance_Status"],
            ["Pending", "Accepted"],
        )
        self.assertEqual(
            metadata["required_picklist_api_values"]["Subscription_Status"],
            ["Active"],
        )
        for flag in (
            "all_resolved_exactly_once",
            "all_visible",
            "all_read_only_false",
            "all_api_create_enabled",
            "all_api_update_enabled",
            "all_active_layout_associated",
            "all_transition_field_available",
            "all_required_picklist_api_values_present",
            "metadata_and_layout_gate_currently_satisfied",
            "fresh_readback_still_required_immediately_before_deployment",
        ):
            with self.subTest(flag=flag):
                self.assertTrue(metadata[flag])
        blueprint = evidence["blueprint_readback"]
        self.assertFalse(blueprint["topology_matches_contract"])
        self.assertEqual(
            blueprint["pipeline_binding_matches_revenue_desk_sales"], "not_proven"
        )
        self.assertEqual(
            blueprint["missing_expected_transitions"],
            ["Record Internal Approval", "Activate Test Route"],
        )
        self.assertEqual(blueprint["unexpected_transitions"], ["Approve Go Live"])
        workflow = evidence["workflow_readback"]
        self.assertFalse(workflow["execution_markers_are_runtime_acceptance"])
        self.assertFalse(workflow["desired_create_only_trigger_parity_proven"])
        self.assertTrue(workflow["form1_uncontracted_scheduled_follow_up_task_present"])
        self.assertFalse(workflow["single_active_form2_rule_parity_proven"])
        self.assertFalse(evidence["future_live_change_authorized_by_this_record"])
        self.assertTrue(
            all(value is False for value in evidence["disclosure_controls"].values())
        )
        rendered = json.dumps(evidence, sort_keys=True).lower()
        for forbidden in (
            "http://",
            "https://",
            "@sylvara",
            '"organization_id":',
            '"layout_id":',
            '"blueprint_id":',
            '"workflow_id":',
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, rendered)

    def test_synthetic_acceptance_requires_idempotent_record_and_task_counts(self):
        expected = self.contract["synthetic_acceptance"]["expected_records"]
        self.assertEqual(
            expected,
            {
                "lead": 1,
                "account": 1,
                "contact": 1,
                "deal": 1,
                "review_task": 1,
                "form2_task": 1,
            },
        )


if __name__ == "__main__":
    unittest.main()
