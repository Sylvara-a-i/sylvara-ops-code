import csv
import json
import re
import unittest
from pathlib import Path


PACKAGE = Path(__file__).resolve().parents[1]
ROOT = PACKAGE.parents[2]
AUTOMATION_PATH = PACKAGE / "config" / "automation-contract.json"
CALLER_MANIFEST_PATH = PACKAGE / "config" / "caller-manifest.json"
CRM_METADATA_PATH = (
    ROOT
    / "src"
    / "zoho-crm"
    / "reference"
    / "snapshots"
    / "2026-08-14"
    / "crm-field-dictionary.csv"
)
CRM_PICKLIST_PATH = CRM_METADATA_PATH.with_name("crm-picklist-options.csv")
CRM_LAYOUT_PATH = CRM_METADATA_PATH.with_name("crm-layout-field-order.csv")
FORM2_PRODUCER_PATH = (
    ROOT
    / "src"
    / "zoho-catalyst"
    / "revenue-leak-test-setup-form"
    / "functions"
    / "revenue_leak_test_setup_form"
    / "lib"
    / "form-contract.js"
)
RELEASE_CONTRACT_PATH = ROOT / "docs" / "product" / "free-revenue-leak-test-release-contract.json"
LIVE_TOPOLOGY_PREFLIGHT_PATH = (
    PACKAGE / "evidence" / "live-topology-layout-preflight-2026-08-28.json"
)


def _verified_deal_metadata() -> dict[str, dict[str, str]]:
    with CRM_METADATA_PATH.open(encoding="utf-8", newline="") as stream:
        return {
            row["field_api_name"]: row
            for row in csv.DictReader(stream)
            if row["module_api_name"] == "Deals"
            and row["metadata_verification_status"] == "verified_live_read_only"
        }


def _verified_deal_api_names() -> set[str]:
    return set(_verified_deal_metadata())


def _verified_deal_picklist_api_values(field_api_name: str) -> set[str]:
    with CRM_PICKLIST_PATH.open(encoding="utf-8", newline="") as stream:
        return {
            row["actual_value"]
            for row in csv.DictReader(stream)
            if row["module_api_name"] == "Deals"
            and row["field_api_name"] == field_api_name
            and row["metadata_verification_status"] == "verified_live_read_only"
            and row["actual_value"] != "-None-"
        }


def _verified_active_deal_layout_api_names() -> set[str]:
    with CRM_LAYOUT_PATH.open(encoding="utf-8", newline="") as stream:
        return {
            row["field_api_name"]
            for row in csv.DictReader(stream)
            if row["module_api_name"] == "Deals"
            and row["layout_status"] == "active"
            and row["metadata_verification_status"] == "verified_live_read_only"
        }


def _form2_producer_deal_update_api_names() -> set[str]:
    source = FORM2_PRODUCER_PATH.read_text(encoding="utf-8")
    match = re.search(r"\n    dealUpdate: \{\n(?P<body>.*?)\n    \},\n  \}\);", source, re.DOTALL)
    if match is None:
        raise AssertionError("Form 2 dealUpdate mapping was not found")
    return set(re.findall(r"^      ([A-Za-z][A-Za-z0-9_]*):", match["body"], re.MULTILINE))


def _initializer(automation: dict) -> dict:
    return next(
        rule
        for rule in automation["workflow_set"]
        if rule["logical_name"] == "DEAL_INITIALIZATION"
    )


def _rules_by_repair_group(initializer: dict) -> dict:
    rules_by_name = {
        rule["rule_name"]: rule for rule in initializer["provider_rules"]
    }
    return {
        group: rules_by_name[rule_name]
        for group, rule_name in initializer["post_create_reconciliation"][
            "group_bindings"
        ].items()
    }


def _classify_synthetic_group(rule: dict, observed: dict) -> str:
    missing_count = 0
    for update in rule["field_updates"]:
        api_name = update["api_name"]
        if api_name not in observed or observed[api_name] is None:
            missing_count += 1
        elif observed[api_name] != update["value"]:
            return "conflict"
    return "repairable_missing" if missing_count else "exact"


def _synthetic_repair_plan(initializer: dict, observed: dict) -> dict:
    """Evaluate the checked-in repair matrix without implementing a CRM writer."""
    repair = initializer["post_create_reconciliation"]
    rules = _rules_by_repair_group(initializer)
    states = {
        group: _classify_synthetic_group(rule, observed)
        for group, rule in rules.items()
    }
    decision = repair["decision_matrix"][states["controls"]][states["limits"]]
    write_group = decision["write_group"]
    return {
        "outcome": decision["outcome"],
        "write_group": write_group,
        "field_updates": (
            [dict(update) for update in rules[write_group]["field_updates"]]
            if write_group is not None
            else []
        ),
        "states": states,
    }


class FreeRevenueLeakTestCrmPackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.automation = json.loads(AUTOMATION_PATH.read_text(encoding="utf-8"))
        cls.callers = json.loads(CALLER_MANIFEST_PATH.read_text(encoding="utf-8"))
        cls.live_topology = json.loads(
            LIVE_TOPOLOGY_PREFLIGHT_PATH.read_text(encoding="utf-8")
        )

    def test_initializer_is_the_exact_provider_safe_five_plus_three_split(self) -> None:
        initializer = _initializer(self.automation)
        self.assertEqual(initializer["provider_action_limit"], 5)
        self.assertEqual(initializer["provider_rule_topology"], "required_5_plus_3_split")
        self.assertNotIn("single_active_rule", initializer)
        evidence = initializer["provider_constraint_evidence"]
        self.assertEqual(evidence["maximum_associated_field_updates_per_condition"], 5)
        self.assertFalse(evidence["private_identifiers_committed"])
        self.assertFalse(evidence["write_performed"])
        self.assertEqual(
            initializer["connected_writer_payload_contract"], "unverified_blocker"
        )

        provider_rules = initializer["provider_rules"]
        self.assertEqual(
            [rule["rule_name"] for rule in provider_rules],
            [
                "Deals Free Test Initialize Controls",
                "Deals Free Test Initialize Limits",
            ],
        )
        self.assertEqual([rule["action_count"] for rule in provider_rules], [5, 3])
        self.assertTrue(all(rule["trigger"] == "create_only" for rule in provider_rules))
        self.assertTrue(
            all(
                rule["action_count"] == len(rule["field_updates"])
                and rule["action_count"] <= initializer["provider_action_limit"]
                for rule in provider_rules
            )
        )

        controls = provider_rules[0]["field_updates"]
        self.assertEqual(
            controls,
            [
                {"api_name": "Setup_Access_Status", "value": "Not Issued"},
                {"api_name": "Free_Test_Authorization_Status", "value": "Not Sent"},
                {"api_name": "Go_Live_Approval_Status", "value": "Not Ready"},
                {"api_name": "Test_Status", "value": "Not Started"},
                {"api_name": "Test_Duration_Days", "value": 7},
            ],
        )
        limits = provider_rules[1]["field_updates"]
        self.assertEqual(
            limits,
            [
                {"api_name": "Test_Call_Limit", "value": 25},
                {"api_name": "Test_Scope_Version", "value": "free-test-scope-v1.0"},
                {"api_name": "Type", "value": "Initial Sale"},
            ],
        )
        api_names = [
            update["api_name"]
            for rule in provider_rules
            for update in rule["field_updates"]
        ]
        self.assertEqual(len(api_names), 8)
        self.assertEqual(len(api_names), len(set(api_names)))
        self.assertTrue(
            any("pre-save validation" in item for item in initializer["split_invariants"])
        )

    def test_initializer_repair_contract_has_one_fail_closed_decision_matrix(self) -> None:
        initializer = _initializer(self.automation)
        repair = initializer["post_create_reconciliation"]
        self.assertEqual(repair["status"], "required_desired_state_not_deployable")
        self.assertFalse(repair["deployable_source_in_repository"])
        self.assertFalse(repair["live_write_authorized"])
        self.assertEqual(
            repair["group_bindings"],
            {
                "controls": "Deals Free Test Initialize Controls",
                "limits": "Deals Free Test Initialize Limits",
            },
        )
        self.assertEqual(
            set(repair["group_classification"]),
            {"exact", "repairable_missing", "conflict"},
        )
        self.assertEqual(
            repair["matrix_axes"], {"rows": "controls", "columns": "limits"}
        )

        expected_matrix = {
            "exact": {
                "exact": {"outcome": "no_write", "write_group": None},
                "repairable_missing": {
                    "outcome": "repair_missing_group",
                    "write_group": "limits",
                },
                "conflict": {"outcome": "block", "write_group": None},
            },
            "repairable_missing": {
                "exact": {
                    "outcome": "repair_missing_group",
                    "write_group": "controls",
                },
                "repairable_missing": {
                    "outcome": "block",
                    "write_group": None,
                },
                "conflict": {"outcome": "block", "write_group": None},
            },
            "conflict": {
                "exact": {"outcome": "block", "write_group": None},
                "repairable_missing": {
                    "outcome": "block",
                    "write_group": None,
                },
                "conflict": {"outcome": "block", "write_group": None},
            },
        }
        self.assertEqual(repair["decision_matrix"], expected_matrix)
        self.assertTrue(
            any("do not retry" in item for item in repair["repair_write_contract"])
        )
        self.assertTrue(
            any("read all eight fields back" in item for item in repair["repair_write_contract"])
        )
        self.assertIn(
            "running against a real customer or prospect", repair["prohibited_effects"]
        )

    def test_each_half_failed_initializer_repairs_exactly_the_missing_group(self) -> None:
        initializer = _initializer(self.automation)
        rules = _rules_by_repair_group(initializer)
        defaults = {
            update["api_name"]: update["value"]
            for rule in rules.values()
            for update in rule["field_updates"]
        }
        controls_fields = {
            update["api_name"] for update in rules["controls"]["field_updates"]
        }
        limits_fields = {
            update["api_name"] for update in rules["limits"]["field_updates"]
        }
        cases = {
            "controls rule failed": (
                {name: defaults[name] for name in limits_fields},
                "controls",
            ),
            # Type must be supplied before Deal creation, so a failed Limits rule can
            # legitimately leave Type exact while its other two defaults are absent.
            "limits rule failed after pre-save Type": (
                {
                    **{name: defaults[name] for name in controls_fields},
                    "Type": "Initial Sale",
                },
                "limits",
            ),
        }
        for label, (observed, expected_group) in cases.items():
            with self.subTest(case=label):
                plan = _synthetic_repair_plan(initializer, observed)
                self.assertEqual(plan["outcome"], "repair_missing_group")
                self.assertEqual(plan["write_group"], expected_group)
                self.assertEqual(
                    plan["field_updates"], rules[expected_group]["field_updates"]
                )
                exact_group = "limits" if expected_group == "controls" else "controls"
                exact_fields = {
                    update["api_name"]
                    for update in rules[exact_group]["field_updates"]
                }
                written_fields = {
                    update["api_name"] for update in plan["field_updates"]
                }
                self.assertTrue(written_fields.isdisjoint(exact_fields))

    def test_initializer_repair_blocks_conflicts_and_ambiguous_partial_state(self) -> None:
        initializer = _initializer(self.automation)
        rules = _rules_by_repair_group(initializer)
        defaults = {
            update["api_name"]: update["value"]
            for rule in rules.values()
            for update in rule["field_updates"]
        }

        exact_plan = _synthetic_repair_plan(initializer, defaults)
        self.assertEqual(exact_plan["outcome"], "no_write")
        self.assertEqual(exact_plan["field_updates"], [])

        for api_name, expected in defaults.items():
            with self.subTest(conflicting_field=api_name):
                observed = dict(defaults)
                observed[api_name] = -1 if isinstance(expected, int) else "conflict"
                plan = _synthetic_repair_plan(initializer, observed)
                self.assertEqual(plan["outcome"], "block")
                self.assertEqual(plan["write_group"], None)
                self.assertEqual(plan["field_updates"], [])

        both_incomplete = {"Type": "Initial Sale"}
        plan = _synthetic_repair_plan(initializer, both_incomplete)
        self.assertEqual(
            plan["states"],
            {"controls": "repairable_missing", "limits": "repairable_missing"},
        )
        self.assertEqual(plan["outcome"], "block")
        self.assertEqual(plan["field_updates"], [])

        blank_is_conflict = dict(defaults)
        blank_is_conflict["Test_Scope_Version"] = ""
        plan = _synthetic_repair_plan(initializer, blank_is_conflict)
        self.assertEqual(plan["states"]["limits"], "conflict")
        self.assertEqual(plan["outcome"], "block")
        self.assertEqual(plan["field_updates"], [])

    def test_blueprint_transition_topology_is_exact_manual_and_fail_closed(self) -> None:
        blueprint = self.automation["blueprint"]
        boundary = blueprint["deployment_boundary"]
        self.assertEqual(boundary["status"], "desired_state_not_deployable")
        self.assertFalse(boundary["live_write_authorized"])
        self.assertFalse(boundary["writer_or_provider_payload_contract_in_repository"])
        self.assertFalse(boundary["provider_save_readback_proven"])
        self.assertFalse(boundary["runtime_acceptance_proven"])
        self.assertTrue(boundary["external_evidence_validator_in_repository"])
        validator = boundary["external_evidence_validator"]
        self.assertEqual(
            validator["path"],
            "src/zoho-crm/free-revenue-leak-test/validators/external_evidence.py",
        )
        self.assertFalse(validator["runtime_side_effects"])
        self.assertFalse(validator["live_blueprint_caller_wired"])
        self.assertFalse(validator["durable_consumption_cas_writer_in_repository"])
        self.assertFalse(validator["runtime_replay_enforcement_proven"])
        self.assertTrue(boundary["metadata_and_layout_gate_satisfied"])
        self.assertEqual(
            boundary["live_pipeline_binding_matches_contract"], "not_proven"
        )
        self.assertEqual(
            boundary["metadata_and_layout_evidence"],
            "src/zoho-crm/free-revenue-leak-test/evidence/"
            "live-topology-layout-preflight-2026-08-28.json",
        )
        self.assertIn("closed allowlist", boundary["after_action_policy"])
        self.assertIn(
            "membership requires authoritative readback, not a nonempty value",
            boundary["preexisting_evidence_policy"],
        )

        topology = blueprint["transition_topology"]
        expected_edges = [
            ("Confirm Authorization", "Setup and Authorization", "Test Authorized"),
            ("Begin Setup and QA", "Test Authorized", "Setup and QA"),
            ("Record Internal Approval", "Setup and QA", "Setup and QA"),
            ("Activate Test Route", "Setup and QA", "Test Live"),
            ("Complete Free Test", "Test Live", "Results Review"),
            ("Propose Subscription", "Results Review", "Subscription Proposed"),
            ("Activate Subscription", "Subscription Proposed", "Closed Won"),
            ("Close During Authorization", "Setup and Authorization", "Closed Lost"),
            ("Close After Authorization", "Test Authorized", "Closed Lost"),
            ("Close During QA", "Setup and QA", "Closed Lost"),
            ("Close Live Test", "Test Live", "Closed Lost"),
            ("Close After Results Review", "Results Review", "Closed Lost"),
            ("Decline Subscription", "Subscription Proposed", "Closed Lost"),
        ]
        self.assertEqual(
            [
                (transition["name"], transition["from_state"], transition["to_state"])
                for transition in topology
            ],
            expected_edges,
        )
        self.assertTrue(
            all(transition["execution"] == "manual_only" for transition in topology)
        )
        self.assertEqual(
            {transition["from_state"] for transition in topology}
            | {transition["to_state"] for transition in topology},
            set(blueprint["states"]),
        )
        self.assertEqual(
            [
                transition["name"]
                for transition in topology
                if transition["to_state"] == "Closed Won"
            ],
            ["Activate Subscription"],
        )

        by_name = {transition["name"]: transition for transition in topology}
        self.assertEqual(len(by_name), len(topology))
        external_contracts = blueprint["external_evidence_contracts"]
        self.assertEqual(
            set(external_contracts),
            {
                "internal-approval-receipt-v1",
                "route-activation-readback-v1",
                "terminal-report-summary-readback-v2",
                "route-inactive-readback-v1",
                "billing-closed-won-reconciliation-v1",
            },
        )
        for transition in topology:
            for requirement in transition["external_evidence_requirements"]:
                with self.subTest(external_contract=transition["name"]):
                    self.assertIn(requirement["contract_id"], external_contracts)
                    self.assertNotEqual(
                        external_contracts[requirement["contract_id"]]["validator_status"],
                        "implemented",
                    )
        for name, invariants in blueprint["required_transition_invariants"].items():
            with self.subTest(invariants=name):
                self.assertEqual(by_name[name]["invariants"], invariants)
        for transition in topology:
            with self.subTest(shape=transition["name"]):
                self.assertEqual(
                    set(transition),
                    {
                        "name",
                        "from_state",
                        "to_state",
                        "execution",
                        "criteria",
                        "invariants",
                        "required_preexisting_fields",
                        "operator_input_fields",
                        "conditional_preexisting_fields",
                        "conditional_operator_input_fields",
                        "external_evidence_requirements",
                        "allowed_after_actions",
                    },
                )
                self.assertTrue(transition["criteria"])
                self.assertTrue(transition["invariants"])
                self.assertTrue(
                    set(transition["required_preexisting_fields"]).isdisjoint(
                        transition["operator_input_fields"]
                    )
                )
                self.assertTrue(
                    {
                        item["api_name"]
                        for item in transition["conditional_preexisting_fields"]
                    }.isdisjoint(
                        item["api_name"]
                        for item in transition["conditional_operator_input_fields"]
                    )
                )

        expected_status_actions = {
            "Confirm Authorization": "Setup Pending",
            "Record Internal Approval": "Scheduled",
            "Activate Test Route": "Live",
            "Close During Authorization": "Failed",
            "Close After Authorization": "Failed",
            "Close During QA": "Failed",
            "Close Live Test": "Rolled Back",
        }
        for transition in topology:
            expected_status = expected_status_actions.get(transition["name"])
            expected_actions = (
                [
                    {
                        "type": "field_update",
                        "api_name": "Test_Status",
                        "value": expected_status,
                    }
                ]
                if expected_status is not None
                else []
            )
            with self.subTest(after_actions=transition["name"]):
                self.assertEqual(transition["allowed_after_actions"], expected_actions)

        expected_operator_inputs = {
            "Confirm Authorization": [],
            "Begin Setup and QA": [
                "Test_Phone_Number",
                "Deployment_Record_ID",
                "Configuration_Version",
            ],
            "Record Internal Approval": [
                "Go_Live_Approval_Status",
                "Go_Live_Approved_At",
                "Approved_Deployment_Record_ID",
                "Approved_Configuration_Version",
            ],
            "Activate Test Route": [],
            "Complete Free Test": [],
            "Propose Subscription": [
                "Results_Review_At",
                "Plan",
                "Billing_Frequency",
                "Monthly_Recurring_Revenue",
                "Setup_Fee",
                "Subscription_Start_Date",
                "Subscription_Acceptance_Status",
                "Subscription_Acceptance_Version",
            ],
            "Activate Subscription": [],
            "Close During Authorization": ["Reason_For_Loss__s"],
            "Close After Authorization": ["Reason_For_Loss__s"],
            "Close During QA": ["Reason_For_Loss__s"],
            "Close Live Test": ["Reason_For_Loss__s"],
            "Close After Results Review": ["Reason_For_Loss__s"],
            "Decline Subscription": ["Reason_For_Loss__s"],
        }
        self.assertEqual(
            {
                name: transition["operator_input_fields"]
                for name, transition in by_name.items()
            },
            expected_operator_inputs,
        )
        self.assertEqual(
            by_name["Begin Setup and QA"]["conditional_preexisting_fields"],
            [
                {
                    "api_name": "No_Answer_Delay",
                    "when": (
                        "Approved_Test_Route includes no-answer or overflow coverage"
                    ),
                },
                {
                    "api_name": "Approved_Fallback_Number",
                    "when": (
                        "Approved_Fallback_Destination requires a telephone destination"
                    ),
                },
            ],
        )
        self.assertTrue(
            all(not item["conditional_operator_input_fields"] for item in topology)
        )

        used_api_names = set()
        topology_field_surface = set()
        for transition in topology:
            criterion_api_names = {
                value
                for criterion in transition["criteria"]
                for key in ("api_name", "left_api_name", "right_api_name")
                if (value := criterion.get(key)) is not None
            }
            topology_field_surface.update(criterion_api_names)
            for criterion in transition["criteria"]:
                used_api_names.update(
                    value
                    for key in ("api_name", "left_api_name", "right_api_name")
                    if (value := criterion.get(key)) is not None
                )
            used_api_names.update(transition["required_preexisting_fields"])
            used_api_names.update(transition["operator_input_fields"])
            topology_field_surface.update(transition["required_preexisting_fields"])
            topology_field_surface.update(transition["operator_input_fields"])
            for field_group in (
                "conditional_preexisting_fields",
                "conditional_operator_input_fields",
            ):
                conditional_api_names = {
                    field["api_name"] for field in transition[field_group]
                }
                used_api_names.update(conditional_api_names)
                topology_field_surface.update(conditional_api_names)
            used_api_names.update(
                action["api_name"] for action in transition["allowed_after_actions"]
            )
        release = json.loads(RELEASE_CONTRACT_PATH.read_text(encoding="utf-8"))
        verified_names = _verified_deal_api_names()
        metadata_gate = blueprint["transition_field_metadata_gate"]
        self.assertFalse(metadata_gate["self_authored_release_lists_are_metadata_authority"])
        self.assertTrue(metadata_gate["fresh_readback_required_before_deployment"])
        self.assertTrue(metadata_gate["snapshot_derived_active_layout_gap_satisfied"])
        # Self-authored release lists are desired-state requirements, not an
        # authoritative substitute for checked-in field/type/layout metadata.
        fresh_metadata = self.live_topology["metadata_and_layout_readback"]
        fresh_names = set(fresh_metadata["resolved_api_names"])
        self.assertTrue(used_api_names.issubset(verified_names | fresh_names))
        self.assertEqual(metadata_gate["unverified_api_names"], [])
        self.assertEqual(metadata_gate["latest_live_readback"]["resolved_field_count"], 25)
        self.assertTrue(
            metadata_gate["latest_live_readback"][
                "resolved_api_names_equal_snapshot_derived_gap"
            ]
        )
        layout_derivation = metadata_gate["active_layout_gap_derivation"]
        self.assertEqual(
            layout_derivation["authoritative_source_only"],
            "src/zoho-crm/reference/snapshots/2026-08-14/crm-layout-field-order.csv",
        )
        self.assertEqual(
            layout_derivation["topology_field_sources"],
            [
                "criteria.api_name",
                "criteria.left_api_name",
                "criteria.right_api_name",
                "required_preexisting_fields",
                "operator_input_fields",
                "conditional_preexisting_fields.api_name",
                "conditional_operator_input_fields.api_name",
            ],
        )
        self.assertFalse(layout_derivation["self_authored_release_field_union_allowed"])
        self.assertTrue(layout_derivation["fresh_readback_required_for_every_gap"])
        snapshot_derived_layout_gap = (
            topology_field_surface - _verified_active_deal_layout_api_names()
        )
        self.assertEqual(
            snapshot_derived_layout_gap,
            set(metadata_gate["snapshot_derived_active_layout_unavailable_api_names"]),
        )
        self.assertEqual(len(snapshot_derived_layout_gap), 25)
        self.assertEqual(snapshot_derived_layout_gap, fresh_names)
        self.assertTrue(
            {
                "Billing_Subscription_ID",
                "Subscription_Status",
                "Subscription_Start_Date",
            }.issubset(snapshot_derived_layout_gap)
        )
        self.assertIn("Monthly_Recurring_Revenue", used_api_names)

        input_constraints = blueprint["operator_input_constraints"]
        expected_input_fields = {
            api_name
            for transition in topology
            for api_name in transition["operator_input_fields"]
        }
        self.assertEqual(set(input_constraints), expected_input_fields)
        verified_metadata = _verified_deal_metadata()
        for api_name, constraint in input_constraints.items():
            with self.subTest(operator_constraint=api_name):
                self.assertTrue(constraint["rules"])
                if api_name in verified_metadata:
                    self.assertEqual(
                        constraint["expected_data_type"],
                        verified_metadata[api_name]["data_type"],
                    )
                else:
                    self.assertEqual(
                        constraint["metadata_gate"],
                        "fresh_authoritative_readback_required",
                    )

        plan_constraint = input_constraints["Plan"]
        self.assertEqual(
            plan_constraint["allowed_api_value_to_canonical_plan"],
            {"Option 1": "Launch", "Option 2": "Growth", "Pro": "Scale"},
        )
        self.assertTrue(
            set(plan_constraint["allowed_api_value_to_canonical_plan"]).issubset(
                _verified_deal_picklist_api_values("Plan")
            )
        )
        approval_constraint = input_constraints["Go_Live_Approval_Status"]
        self.assertEqual(
            approval_constraint["rules"],
            [{"operator": "equals", "value": "Approved"}],
        )
        self.assertIn("Approved", _verified_deal_picklist_api_values("Go_Live_Approval_Status"))
        self.assertEqual(
            input_constraints["Approved_Deployment_Record_ID"]["rules"],
            [{"operator": "equals_field", "right_api_name": "Deployment_Record_ID"}],
        )
        self.assertEqual(
            input_constraints["Approved_Configuration_Version"]["rules"],
            [{"operator": "equals_field", "right_api_name": "Configuration_Version"}],
        )

        start_date_gate = metadata_gate["subscription_start_date"]
        self.assertEqual(start_date_gate["semantic_owner"], "operator-requested commercial start date")
        self.assertFalse(start_date_gate["billing_owned"])
        self.assertTrue(start_date_gate["metadata_and_layout_eligible"])
        self.assertFalse(start_date_gate["operator_input_deployable"])
        self.assertTrue(start_date_gate["fresh_metadata_and_active_layout_readback_required"])
        self.assertNotIn("Subscription_Start_Date", _verified_active_deal_layout_api_names())
        self.assertEqual(
            start_date_gate["historical_snapshot_active_standard_layout_status"],
            "not_present",
        )
        self.assertEqual(
            start_date_gate["latest_live_active_standard_layout_status"], "present"
        )
        self.assertTrue(start_date_gate["latest_live_transition_field_available"])
        self.assertEqual(
            input_constraints["Subscription_Start_Date"]["metadata_gate"],
            "fresh_active_layout_readback_required",
        )

        paid_constraints = {
            api_name: input_constraints[api_name]
            for api_name in (
                "Plan",
                "Billing_Frequency",
                "Monthly_Recurring_Revenue",
                "Setup_Fee",
                "Subscription_Start_Date",
                "Subscription_Acceptance_Status",
                "Subscription_Acceptance_Version",
            )
        }
        self.assertEqual(
            paid_constraints["Billing_Frequency"]["rules"],
            [{"operator": "equals", "value": "Monthly"}],
        )
        self.assertEqual(
            paid_constraints["Subscription_Acceptance_Status"]["rules"],
            [{"operator": "equals", "value": "Pending"}],
        )
        version_rules = paid_constraints["Subscription_Acceptance_Version"]["rules"]
        self.assertEqual(version_rules[0]["pattern"], r"^terms-v1:[a-f0-9]{64}$")
        self.assertEqual(version_rules[1], {
            "operator": "equals_private_commercial_terms",
            "path": "acceptanceVersion",
        })
        self.assertEqual(len(version_rules[2]["canonical_fields"]), 10)

        confirm = by_name["Confirm Authorization"]
        form2_persisted = {
            "Setup_Access_Status",
            "Setup_Form_Submission_ID",
            "Setup_Form_Submitted_At",
            "Authorized_Representative_Confirmed",
            "Test_Scope_Accepted",
            "Authority_Confirmed_At",
            "Test_Scope_Accepted_At",
        }
        self.assertEqual(
            set(confirm["required_preexisting_fields"]),
            form2_persisted | {"Go_Live_Approval_Status"},
        )
        self.assertEqual(
            {criterion["api_name"] for criterion in confirm["criteria"]},
            form2_persisted | {"Go_Live_Approval_Status"},
        )
        self.assertTrue(form2_persisted.issubset(_form2_producer_deal_update_api_names()))
        self.assertIn(
            {
                "api_name": "Go_Live_Approval_Status",
                "operator": "not_equals",
                "value": "Approved",
            },
            confirm["criteria"],
        )
        self.assertEqual(confirm["operator_input_fields"], [])
        proof = blueprint["form2_controller_proof_evidence"]
        self.assertEqual(proof["owner"], "revenue_leak_test_setup_form")
        self.assertIn("consumed one-time proof", proof["acceptance_evidence"])
        self.assertIn("exact controller receipt", proof["acceptance_evidence"])
        self.assertIn("exact CRM readback", proof["acceptance_evidence"])
        self.assertFalse(proof["standalone_crm_boolean_exists"])
        self.assertFalse(proof["is_signature"])
        self.assertFalse(proof["is_go_live_approval"])
        form2_rule = next(
            rule
            for rule in self.automation["workflow_set"]
            if rule["logical_name"] == "FORM2_SUBMISSION"
        )
        self.assertEqual(
            form2_rule["effects"],
            [
                "set Setup Access Status to Submitted",
                "create one internal setup-and-QA task",
            ],
        )
        self.assertIn(
            "treating controller proof as a signature",
            form2_rule["prohibited_effects"],
        )

        for transition in topology:
            criterion_fields = {
                value
                for criterion in transition["criteria"]
                for key in ("api_name", "left_api_name", "right_api_name")
                if (value := criterion.get(key)) is not None
            }
            with self.subTest(preexisting_criteria=transition["name"]):
                self.assertTrue(
                    criterion_fields.issubset(transition["required_preexisting_fields"])
                )

        activation = by_name["Activate Test Route"]
        self.assertIn("Test_Start_At", activation["required_preexisting_fields"])
        self.assertIn(
            {"api_name": "Test_Start_At", "operator": "is_not_empty"},
            activation["criteria"],
        )
        approval = by_name["Record Internal Approval"]
        self.assertEqual(
            approval["external_evidence_requirements"],
            [{
                "contract_id": "internal-approval-receipt-v1",
                "required": True,
                "fresh": True,
                "must_complete_before_transition": True,
            }],
        )
        self.assertEqual(
            activation["external_evidence_requirements"],
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
        self.assertEqual(
            approval_contract["validator_status"], "implemented_repository_only"
        )
        self.assertFalse(approval_contract["mutation_allowed"])
        self.assertEqual(approval_contract["max_age_at_transition_seconds"], 300)
        self.assertEqual(
            approval_contract["maximum_prestate_age_at_decision_seconds"], 900
        )
        self.assertEqual(approval_contract["maximum_intent_age_at_decision_seconds"], 300)
        self.assertIn("Raw Deal", approval_contract["private_identifier_policy"])
        approval_crypto = approval_contract["cryptographic_boundary"]
        self.assertEqual(approval_crypto["intent_signature_algorithm"], "HMAC-SHA-256")
        self.assertEqual(
            approval_crypto["intent_signature_domain"],
            "revenue-desk-approval-intent-v1",
        )
        self.assertEqual(approval_crypto["evidence_receipt_algorithm"], "HMAC-SHA-256")
        self.assertFalse(approval_crypto["intent_signature_is_legal_signature"])
        approval_intent_schema = approval_crypto["intent_schema"]
        self.assertEqual(approval_intent_schema["schema_version"], 1)
        self.assertEqual(
            approval_intent_schema["canonical_fields"],
            [
                "schema_version",
                "event_id",
                "action",
                "deal_id",
                "deployment_id",
                "configuration_version_id",
                "route_fingerprint",
                "evidence_revision",
                "evidence_observed_at",
                "requested_at",
                "operator_id_hash",
                "expected_deployment_version",
            ],
        )
        self.assertEqual(
            approval_intent_schema["deal_id_pattern"], "^[1-9][0-9]{7,29}$"
        )
        self.assertIn(
            "current private CRM context deal_id",
            approval_intent_schema["deal_id_binding"],
        )
        self.assertEqual(
            approval_crypto["receipt_domain"],
            "sylvara.crm.internal-approval-receipt.v1",
        )
        approval_one_time = approval_contract["one_time_consumption"]
        self.assertTrue(approval_one_time["required"])
        self.assertTrue(approval_one_time["exact_consumption_readback_required"])
        self.assertFalse(approval_one_time["durable_compare_and_set_writer_in_repository"])
        self.assertFalse(approval_one_time["runtime_replay_enforcement_in_repository"])
        self.assertEqual(approval_one_time["replay_behavior"], "reject")
        approval_claims = {}
        for claim in approval_contract["required_claims"]:
            approval_claims.setdefault(claim["path"], []).append(claim)
        self.assertEqual(
            approval_claims["deployment_binding_digest"][0]["api_name"],
            "Deployment_Record_ID",
        )
        self.assertEqual(
            approval_claims["configuration_binding_digest"][0]["api_name"],
            "Configuration_Version",
        )
        self.assertEqual(
            approval_claims["approval_intent_signature_valid"][0]["value"], True
        )
        self.assertEqual(approval_claims["approval_decision"][0]["value"], "Approved")
        self.assertEqual(approval_claims["runtime_test_status"][0]["value"], "Scheduled")
        self.assertEqual(approval_claims["activation_event_absent"][0]["value"], True)
        self.assertIsNone(approval_claims["actual_start_at"][0]["value"])
        self.assertIsNone(approval_claims["expires_at"][0]["value"])
        self.assertEqual(
            approval_claims["approval_decided_at"][1]["api_name"],
            "Go_Live_Approved_At",
        )
        self.assertEqual(
            approval_claims["current_deployment_version_digest"][0]["operator"],
            "equals_domain_separated_keyed_hmac_of_authoritative_current_poststate_version_equal_to_signed_expected_plus_one",
        )
        self.assertEqual(
            approval_claims["evidence_receipt"][0]["operator"],
            "equals_keyed_hmac_of_canonical_binding",
        )
        self.assertTrue(
            set(approval_crypto["canonical_binding_fields"])
            == set(approval_claims) - {"evidence_receipt"}
        )

        activation_contract = blueprint["external_evidence_contracts"][
            "route-activation-readback-v1"
        ]
        self.assertEqual(
            activation_contract["validator_status"], "implemented_repository_only"
        )
        self.assertFalse(activation_contract["mutation_allowed"])
        self.assertEqual(activation_contract["max_age_at_transition_seconds"], 300)
        self.assertEqual(
            activation_contract["maximum_route_readback_age_at_activation_seconds"],
            900,
        )
        self.assertEqual(
            activation_contract["maximum_prestate_age_at_activation_seconds"], 900
        )
        self.assertEqual(
            activation_contract["maximum_intent_age_at_decision_seconds"], 300
        )
        self.assertIn("Raw Deal", activation_contract["private_identifier_policy"])
        activation_crypto = activation_contract["cryptographic_boundary"]
        self.assertEqual(activation_crypto["intent_signature_algorithm"], "HMAC-SHA-256")
        self.assertEqual(
            activation_crypto["intent_signature_domain"],
            "revenue-desk-activation-intent-v1",
        )
        self.assertEqual(
            activation_crypto["intent_signature_secret_input"],
            "operator_verification_secret",
        )
        self.assertEqual(activation_crypto["evidence_receipt_algorithm"], "HMAC-SHA-256")
        self.assertEqual(
            activation_crypto["evidence_receipt_secret_input"], "evidence_secret"
        )
        self.assertEqual(
            activation_crypto["runtime_secret_inputs"],
            [
                "evidence_secret",
                "approval_evidence_secret",
                "operator_verification_secret",
            ],
        )
        self.assertEqual(activation_crypto["runtime_secret_minimum_bytes"], 32)
        self.assertTrue(
            activation_crypto["runtime_secrets_pairwise_distinct_required"]
        )
        self.assertFalse(activation_crypto["intent_signature_is_legal_signature"])
        activation_intent_schema = activation_crypto["intent_schema"]
        self.assertEqual(activation_intent_schema["schema_version"], 1)
        self.assertEqual(
            activation_intent_schema["canonical_fields"],
            [
                "schema_version",
                "event_id",
                "action",
                "deal_id",
                "deployment_id",
                "configuration_version_id",
                "approval_event_key",
                "route_fingerprint",
                "route_readback_fingerprint",
                "route_observed_at",
                "evidence_revision",
                "evidence_observed_at",
                "requested_at",
                "operator_id_hash",
                "expected_deployment_version",
            ],
        )
        self.assertEqual(
            activation_intent_schema["deal_id_pattern"], "^[1-9][0-9]{7,29}$"
        )
        self.assertIn(
            "current private CRM context deal_id",
            activation_intent_schema["deal_id_binding"],
        )
        self.assertEqual(
            activation_crypto["receipt_domain"],
            "sylvara.crm.route-activation-readback.v1",
        )
        activation_one_time = activation_contract["one_time_consumption"]
        self.assertTrue(activation_one_time["required"])
        self.assertTrue(activation_one_time["exact_consumption_readback_required"])
        self.assertFalse(activation_one_time["durable_compare_and_set_writer_in_repository"])
        self.assertFalse(activation_one_time["runtime_replay_enforcement_in_repository"])
        self.assertEqual(activation_one_time["replay_behavior"], "reject")
        referenced_approval = activation_contract[
            "referenced_internal_approval_consumption"
        ]
        self.assertEqual(
            referenced_approval["contract_id"], "internal-approval-receipt-v1"
        )
        self.assertEqual(
            referenced_approval["scope_digest_secret_input"],
            "approval_evidence_secret",
        )
        self.assertEqual(referenced_approval["required_status"], "consumed")
        self.assertEqual(
            referenced_approval["required_unique_scope_fields"],
            approval_one_time["durable_unique_scope"],
        )
        self.assertEqual(
            referenced_approval["same_deal_binding"]["domain"],
            "sylvara.crm.internal-approval-receipt.v1.deal",
        )
        self.assertEqual(
            referenced_approval["same_approval_event_binding"]["domain"],
            "sylvara.crm.internal-approval-receipt.v1.approval-event",
        )
        self.assertTrue(
            referenced_approval["exact_consumption_readback_required"]
        )
        activation_claims = {}
        for claim in activation_contract["required_claims"]:
            activation_claims.setdefault(claim["path"], []).append(claim)
        self.assertEqual(
            activation_claims["deployment_binding_digest"][0]["api_name"],
            "Deployment_Record_ID",
        )
        self.assertEqual(
            activation_claims["configuration_binding_digest"][0]["api_name"],
            "Configuration_Version",
        )
        self.assertEqual(activation_claims["approval_chain_valid"][0]["value"], True)
        self.assertEqual(
            activation_claims["activation_intent_signature_valid"][0]["value"], True
        )
        self.assertIn(
            {"path": "route_registry_state", "operator": "equals", "value": "active"},
            activation_contract["required_claims"],
        )
        self.assertIn(
            {"path": "provider_route_state", "operator": "equals", "value": "active"},
            activation_contract["required_claims"],
        )
        self.assertIn(
            {
                "path": "expires_at",
                "operator": "equals_timestamp_plus_milliseconds",
                "source": "evidence.actual_start_at",
                "value": 604800000,
            },
            activation_contract["required_claims"],
        )
        self.assertEqual(
            activation_claims["actual_start_at"][1]["api_name"], "Test_Start_At"
        )
        self.assertEqual(
            activation_claims["activation_current_deployment_version_digest"][0][
                "operator"
            ],
            "equals_domain_separated_keyed_hmac_of_authoritative_current_poststate_version_equal_to_signed_expected_plus_one",
        )
        self.assertIn(
            {
                "path": "activation_prestate_observed_at",
                "operator": "equals",
                "source": "evidence.route_observed_at",
            },
            activation_contract["required_claims"],
        )
        self.assertEqual(
            activation_claims["evidence_receipt"][0]["operator"],
            "equals_keyed_hmac_of_canonical_binding",
        )
        self.assertTrue(
            set(activation_crypto["canonical_binding_fields"])
            == set(activation_claims) - {"evidence_receipt"}
        )
        raw_private_paths = {
            "deal_id",
            "deployment_record_id",
            "configuration_version",
            "route_fingerprint",
            "approval_event_key",
            "activation_event_key",
            "source_revision",
            "operator_id",
            "receipt_nonce",
        }
        self.assertTrue(raw_private_paths.isdisjoint(approval_claims))
        self.assertTrue(raw_private_paths.isdisjoint(activation_claims))

        complete = by_name["Complete Free Test"]
        self.assertEqual(complete["operator_input_fields"], [])
        terminal_contract = blueprint["external_evidence_contracts"][
            "terminal-report-summary-readback-v2"
        ]
        self.assertEqual(
            terminal_contract["validator_status"], "implemented_repository_only"
        )
        self.assertEqual(
            set(complete["required_preexisting_fields"]),
            set(terminal_contract["crm_exact_readback_fields"]),
        )
        self.assertTrue(
            {"Deployment_Record_ID", "Configuration_Version"}.issubset(
                terminal_contract["crm_exact_readback_fields"]
            )
        )
        canonical_summary = terminal_contract["canonical_summary_identity_input"]
        self.assertTrue(canonical_summary["semantic_cross_check_required"])
        self.assertFalse(canonical_summary["python_reserialization_allowed_for_identity"])
        current_binding = terminal_contract[
            "current_deployment_configuration_binding"
        ]
        self.assertTrue(current_binding["exact_match_required"])
        self.assertEqual(
            current_binding["deployment_pattern"],
            "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$",
        )
        self.assertEqual(
            current_binding["configuration_pattern"],
            "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$",
        )
        self.assertEqual(
            complete["external_evidence_requirements"],
            [{
                "contract_id": "terminal-report-summary-readback-v2",
                "required": True,
                "fresh": True,
            }],
        )
        nullable_report_fields = set(
            terminal_contract["nullable_fields_require_present_exact_readback"]
        )
        nonempty_criteria_fields = {
            criterion["api_name"]
            for criterion in complete["criteria"]
            if criterion["operator"] == "is_not_empty"
        }
        self.assertTrue(nullable_report_fields.isdisjoint(nonempty_criteria_fields))

        closed_lost = [
            transition for transition in topology
            if transition["to_state"] == "Closed Lost"
        ]
        self.assertEqual(len(closed_lost), 6)
        for transition in closed_lost:
            with self.subTest(containment=transition["name"]):
                self.assertIn(
                    "Rollback_Completed_At", transition["required_preexisting_fields"]
                )
                self.assertIn(
                    {"api_name": "Rollback_Completed_At", "operator": "is_not_empty"},
                    transition["criteria"],
                )
                self.assertEqual(
                    transition["external_evidence_requirements"],
                    [{
                        "contract_id": "route-inactive-readback-v1",
                        "required": True,
                        "fresh": True,
                    }],
                )
        route_contract = blueprint["external_evidence_contracts"][
            "route-inactive-readback-v1"
        ]
        self.assertEqual(
            route_contract["validator_status"], "implemented_repository_only"
        )
        self.assertFalse(route_contract["mutation_allowed"])
        self.assertEqual(route_contract["max_age_at_transition_seconds"], 300)
        self.assertEqual(
            route_contract["context_deal_id_pattern"], "^[1-9][0-9]{7,29}$"
        )
        self.assertIn("raw Deal", route_contract["private_identifier_policy"])
        keyed_binding = route_contract["keyed_binding"]
        self.assertEqual(keyed_binding["algorithm"], "HMAC-SHA-256")
        self.assertEqual(
            keyed_binding["receipt_domain"],
            "sylvara.crm.route-inactive-readback.v1",
        )
        self.assertEqual(keyed_binding["receipt_path"], "evidence_receipt")
        self.assertEqual(
            keyed_binding["nullable_binding_encoding"],
            {
                "null": ["null"],
                "non_null": ["value", "<exact private field value>"],
            },
        )
        self.assertEqual(
            set(keyed_binding["canonical_binding_fields"]),
            {
                "schema_version",
                "evidence_type",
                "environment",
                "deal_binding_digest",
                "deployment_binding_digest",
                "configuration_binding_digest",
                "route_fingerprint_digest",
                "rollback_completed_at",
                "last_route_mutation_at",
                "observed_at",
                "route_registry_state",
                "provider_route_state",
                "evidence_nonce_digest",
            },
        )
        one_time = route_contract["one_time_consumption"]
        self.assertTrue(one_time["required"])
        self.assertTrue(one_time["exact_consumption_readback_required"])
        self.assertFalse(one_time["durable_compare_and_set_writer_in_repository"])
        self.assertFalse(one_time["runtime_replay_enforcement_in_repository"])
        self.assertEqual(one_time["replay_behavior"], "reject")
        claims = route_contract["required_claims"]
        claims_by_path = {}
        for claim in claims:
            claims_by_path.setdefault(claim["path"], []).append(claim)
        self.assertIn(
            {
                "path": "route_registry_state",
                "operator": "equals",
                "value": "inactive",
            },
            claims,
        )
        self.assertIn(
            {
                "path": "provider_route_state",
                "operator": "equals",
                "value": "inactive",
            },
            claims,
        )
        self.assertEqual(
            claims_by_path["deal_binding_digest"][0]["operator"],
            "equals_domain_separated_keyed_hmac_of_current_crm_deal_id",
        )
        self.assertEqual(
            claims_by_path["deployment_binding_digest"][0]["api_name"],
            "Deployment_Record_ID",
        )
        self.assertEqual(
            claims_by_path["configuration_binding_digest"][0]["api_name"],
            "Configuration_Version",
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
        claim_paths = set(claims_by_path)
        self.assertTrue(
            {
                "deal_id",
                "deployment_record_id",
                "configuration_version",
                "route_fingerprint",
                "receipt_nonce",
            }.isdisjoint(claim_paths)
        )

        activate_paid = by_name["Activate Subscription"]
        self.assertEqual(activate_paid["operator_input_fields"], [])
        self.assertIn(
            {"api_name": "Subscription_Status", "operator": "equals", "value": "Active"},
            activate_paid["criteria"],
        )
        self.assertTrue(
            set(release["crm"]["billing_owned_fields"]).issubset(
                activate_paid["required_preexisting_fields"]
            )
        )
        billing_criteria = {
            criterion["api_name"]: (
                criterion["operator"],
                criterion.get("value"),
            )
            for criterion in activate_paid["criteria"]
            if criterion["api_name"] in release["crm"]["billing_owned_fields"]
        }
        self.assertEqual(
            billing_criteria,
            {
                "Billing_Automation_Status": ("equals", "Paid Verified"),
                "Billing_Automation_Error": ("is_empty", None),
                "Billing_Last_Sync_At": ("is_not_empty", None),
                "Billing_Customer_ID": ("is_not_empty", None),
                "Billing_Subscription_ID": ("is_not_empty", None),
                "Subscription_Status": ("equals", "Active"),
            },
        )
        self.assertNotIn("Subscription_Start_Date", release["crm"]["billing_owned_fields"])
        self.assertIn(
            {"api_name": "Subscription_Start_Date", "operator": "is_not_empty"},
            activate_paid["criteria"],
        )
        paid_evidence = blueprint["external_evidence_contracts"][
            "billing-closed-won-reconciliation-v1"
        ]
        self.assertEqual(
            paid_evidence["validator_status"], "implemented_repository_only"
        )
        self.assertFalse(paid_evidence["mutation_allowed"])
        self.assertEqual(paid_evidence["request_action"], "reconcile")
        self.assertTrue(paid_evidence["non_creating"])
        self.assertEqual(paid_evidence["created_resource_count"], 0)
        self.assertEqual(
            paid_evidence["maximum_provider_readback_age_at_evidence_seconds"],
            300,
        )
        self.assertEqual(paid_evidence["required_currency"], "USD")
        self.assertEqual(paid_evidence["required_usage_addon_unit"], "minute")
        self.assertEqual(
            paid_evidence["immutable_subscription_status_map"],
            {"future": "Scheduled", "live": "Active"},
        )
        self.assertEqual(
            paid_evidence["closed_won_required_provider_subscription_status"],
            "live",
        )
        self.assertEqual(
            paid_evidence["closed_won_required_crm_subscription_status"],
            "Active",
        )
        self.assertEqual(
            paid_evidence["billing_organization_binding"],
            {
                "billing_readback_field": "billing_organization_id",
                "context_catalog_field": "billing_organization_id",
                "exact_match_required": True,
                "included_in_keyed_reconciliation_binding": True,
                "raw_value_publication_allowed": False,
            },
        )
        self.assertEqual(
            paid_evidence["exact_billing_readback_fields"],
            [
                "customer_id",
                "customer_crm_reference",
                "subscription_id",
                "subscription_reference",
                "plan_code",
                "billing_organization_id",
                "currency",
                "recurring_minor",
                "setup_minor",
                "usage_addon_product_id",
                "usage_addon_code",
                "usage_addon_unit",
                "usage_rate_minor",
                "subscription_start_date",
                "provider_subscription_status",
                "crm_subscription_status",
                "observed_at",
            ],
        )
        self.assertEqual(
            paid_evidence["private_identifier_constraints"],
            {
                "Account_Name": "^[1-9][0-9]{7,29}$",
                "Deployment_Record_ID": "^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$",
                "Approved_Deployment_Record_ID": "^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$",
                "Configuration_Version": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$",
                "Approved_Configuration_Version": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$",
            },
        )
        self.assertEqual(
            paid_evidence["durable_operation"]["last_outcome"],
            "paid_subscription_readback_confirmed",
        )
        billing_receipt = paid_evidence["keyed_reconciliation_binding"]
        self.assertEqual(billing_receipt["algorithm"], "HMAC-SHA-256")
        self.assertEqual(
            billing_receipt["receipt_domain"],
            "sylvara.crm.billing-closed-won-reconciliation.v1",
        )
        self.assertEqual(billing_receipt["receipt_path"], "reconciliation_receipt")
        self.assertIn("request_action", billing_receipt["canonical_binding_fields"])
        self.assertIn("created_resource_count", billing_receipt["canonical_binding_fields"])
        self.assertEqual(
            {item["api_name"] for item in paid_evidence["fingerprint_fresh_crm_bindings"]},
            {
                "Account_Name",
                "Results_Review_At",
                "Plan",
                "Billing_Frequency",
                "Monthly_Recurring_Revenue",
                "Setup_Fee",
                "Subscription_Start_Date",
                "Subscription_Acceptance_Version",
                "Deployment_Record_ID",
                "Configuration_Version",
            },
        )
        self.assertTrue(
            {"Account_Name", "Results_Review_At"}.issubset(
                paid_evidence["exact_crm_readback_fields"]
            )
        )
        self.assertTrue(
            set(paid_evidence["exact_crm_readback_fields"]).issubset(
                activate_paid["required_preexisting_fields"]
            )
        )
        self.assertEqual(
            activate_paid["external_evidence_requirements"],
            [{
                "contract_id": "billing-closed-won-reconciliation-v1",
                "required": True,
                "fresh": True,
                "must_complete_before_transition": True,
            }],
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
            with self.subTest(prohibition=marker):
                self.assertIn(marker, prohibited)

        initializer = _initializer(self.automation)
        repair = initializer["post_create_reconciliation"]
        self.assertEqual(repair["status"], "required_desired_state_not_deployable")
        self.assertFalse(repair["deployable_source_in_repository"])
        self.assertFalse(repair["live_write_authorized"])

    def test_live_topology_preflight_closes_only_the_metadata_layout_gate(self) -> None:
        evidence = self.live_topology
        self.assertEqual(evidence["schema_version"], 1)
        self.assertEqual(evidence["observed_at"], "2026-08-28")
        self.assertEqual(
            evidence["repository_head_at_observation"],
            "0af87a26e2103ddaf4178bf03ebfa67b972cea24",
        )
        self.assertEqual(
            evidence["automation_contract_revision"],
            self.automation["contract_revision"],
        )
        self.assertEqual(self.automation["status"], "desired_state_not_deployable")
        self.assertEqual(
            evidence["status"],
            "metadata_and_layout_preflight_satisfied_blueprint_workflow_and_runtime_blocking",
        )

        metadata = evidence["metadata_and_layout_readback"]
        historical_gap = set(
            self.automation["blueprint"]["transition_field_metadata_gate"][
                "snapshot_derived_active_layout_unavailable_api_names"
            ]
        )
        resolved = set(metadata["resolved_api_names"])
        matching = {
            item["api_name"] for item in metadata["fields_matching_predeclared_types"]
        }
        newly_explicit = {
            item["api_name"] for item in metadata["newly_explicit_type_contracts"]
        }
        self.assertEqual((len(historical_gap), len(resolved)), (25, 25))
        self.assertEqual(resolved, historical_gap)
        self.assertEqual((len(matching), len(newly_explicit)), (21, 4))
        self.assertTrue(matching.isdisjoint(newly_explicit))
        self.assertEqual(matching | newly_explicit, resolved)
        self.assertEqual(
            {
                item["api_name"]: (item["data_type"], item["json_type"])
                for item in metadata["newly_explicit_type_contracts"]
            },
            {
                "Billing_Automation_Error": ("textarea", "string"),
                "Billing_Automation_Status": ("picklist", "string"),
                "Billing_Last_Sync_At": ("datetime", "string"),
                "Call_Totals_Reconciled": ("boolean", "boolean"),
            },
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
            with self.subTest(metadata_flag=flag):
                self.assertTrue(metadata[flag])
        self.assertEqual(
            metadata["required_picklist_api_values"],
            {
                "Billing_Automation_Status": ["Paid Verified"],
                "Billing_Frequency": ["Monthly"],
                "Recommended_Paid_Coverage": [
                    "After Hours Only",
                    "No Answer / Overflow Only",
                    "After Hours + Overflow",
                ],
                "Subscription_Acceptance_Status": ["Pending", "Accepted"],
                "Subscription_Status": ["Active"],
            },
        )

        blueprint = evidence["blueprint_readback"]
        self.assertEqual(blueprint["status"], "Inactive")
        self.assertEqual(
            blueprint["pipeline_binding_matches_revenue_desk_sales"], "not_proven"
        )
        self.assertEqual(
            (blueprint["observed_state_count"], blueprint["observed_transition_count"]),
            (8, 12),
        )
        self.assertFalse(blueprint["topology_matches_contract"])
        self.assertEqual(
            blueprint["missing_expected_transitions"],
            ["Record Internal Approval", "Activate Test Route"],
        )
        self.assertEqual(blueprint["unexpected_transitions"], ["Approve Go Live"])
        self.assertFalse(blueprint["provider_save_or_activation_readback_proven"])
        self.assertFalse(blueprint["runtime_acceptance_proven"])

        workflow = evidence["workflow_readback"]
        workflow_by_name = {
            item["name"]: item for item in workflow["journey_rules"]
        }
        self.assertEqual(
            workflow_by_name["Leads Free Test Intake Review"]["scheduled_actions"],
            {"tasks": 1},
        )
        self.assertFalse(
            workflow_by_name["Deals Form 2 Controller Proof Candidate"]["active"]
        )
        self.assertTrue(workflow_by_name["Deals Free Test Form 2 Submitted"]["active"])
        self.assertFalse(workflow["execution_markers_are_runtime_acceptance"])
        self.assertFalse(workflow["desired_create_only_trigger_parity_proven"])
        self.assertTrue(workflow["form1_uncontracted_scheduled_follow_up_task_present"])
        self.assertFalse(workflow["single_active_form2_rule_parity_proven"])
        self.assertEqual(
            evidence["release_classification"],
            {
                "crm_metadata_and_active_layout_preflight": "currently_satisfied",
                "crm_workflow_parity": "not_proven",
                "crm_blueprint_topology": "not_converged",
                "crm_blueprint_deployability": "blocked",
                "crm_synthetic_runtime_acceptance": "not_proven",
                "retell_agent_testing_readiness": "not_ready",
            },
        )
        self.assertFalse(evidence["future_live_change_authorized_by_this_record"])
        for flag in (
            "records_or_record_photos_read",
            "customer_prospect_or_employee_pii_read",
            "writes_or_runtime_invocations_performed",
            "retell_action_performed",
            "customer_communication_billing_or_production_traffic_action_performed",
        ):
            with self.subTest(boundary_flag=flag):
                self.assertFalse(evidence["evidence_boundary"][flag])
        self.assertTrue(
            all(value is False for value in evidence["disclosure_controls"].values())
        )
        serialized = json.dumps(evidence, sort_keys=True).lower()
        self.assertNotIn("http://", serialized)
        self.assertNotIn("https://", serialized)
        self.assertNotIn("@sylvara", serialized)
        self.assertIsNone(
            re.search(
                r'"(?:organization|layout|blueprint|workflow|field|record)_id"\s*:',
                serialized,
            )
        )

    def test_caller_manifest_is_development_only_and_not_deployment_authority(self) -> None:
        manifest = self.callers
        self.assertEqual(manifest["status"], "reviewed_repository_templates_not_deployed")
        self.assertEqual(manifest["environment"], "Development only")
        self.assertFalse(manifest["render_policy"]["commit_rendered_source"])
        self.assertFalse(manifest["render_policy"]["log_rendered_source"])
        self.assertEqual(
            set(manifest["render_policy"]["placeholder_constraints"]),
            {"issue_url", "public_destination", "connection_link_name"},
        )
        self.assertFalse(manifest["live_write_authorized"])
        self.assertEqual(
            [caller["logical_name"] for caller in manifest["callers"]],
            ["FORM1_ASSISTED_ISSUE_CALLER", "FORM2_SETUP_ISSUE_CALLER"],
        )
        self.assertTrue(
            all(
                caller["connection"]["credential_in_source_or_arguments"] is False
                and caller["connection"]["cross_form_reuse_allowed"] is False
                and caller["request"]["automatic_retry"] is False
                for caller in manifest["callers"]
            )
        )
        form1, form2 = manifest["callers"]
        self.assertEqual(
            form1["request"],
            {
                "enabled": False,
                "method": None,
                "content_type": None,
                "body_keys": [],
                "automatic_retry": False,
                "controller_state": "disabled_before_remote_request",
            },
        )
        self.assertIsNone(form1["connection"]["placeholder"])
        self.assertEqual(form1["private_placeholders"], [])
        self.assertEqual(
            form1["success_response"],
            {"enabled": False, "destination": None, "open_target": None},
        )
        self.assertEqual(
            form1["deployment_status"],
            "disabled_until_non_browser_non_form_entry_token_transport_is_proven",
        )
        self.assertEqual(form2["request"]["method"], "POST")
        self.assertEqual(form2["request"]["content_type"], "application/json")
        self.assertEqual(form2["request"]["body_keys"], ["dealId", "issueRequestId"])
        self.assertEqual(
            form2["private_placeholders"],
            [
                "{{FORM2_ISSUE_URL}}",
                "{{FORM2_ISSUE_CONNECTION_LINK_NAME}}",
                "{{FORM2_ACCESS_PUBLIC_URL}}",
            ],
        )
        uuid_input = next(
            item for item in form2["function_arguments"] if item["name"] == "issue_request_id"
        )
        self.assertEqual(uuid_input["provider_binding_status"], "unverified_blocker")
        rendered = json.dumps(manifest)
        self.assertNotRegex(rendered, r"https?://")
        self.assertNotRegex(rendered, r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+")
        self.assertNotRegex(rendered, r"\b[1-9][0-9]{9,29}\b")
        self.assertNotRegex(
            rendered,
            r"\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b",
        )

    def test_form1_deluge_template_is_disabled_before_any_remote_capability(self) -> None:
        caller = self.callers["callers"][0]
        self.assertEqual(caller["logical_name"], "FORM1_ASSISTED_ISSUE_CALLER")
        source_path = (CALLER_MANIFEST_PATH.parent / caller["source"]).resolve()
        self.assertTrue(source_path.is_relative_to(PACKAGE))
        source = source_path.read_text(encoding="utf-8")

        self.assertEqual(source.lower().count("invokeurl"), 0)
        self.assertEqual(source.count("openUrl("), 0)
        self.assertEqual(re.findall(r"\{\{[A-Z0-9_]+\}\}", source), [])
        self.assertNotRegex(source, r"https?://")
        for forbidden in (
            "request_body",
            "request_headers",
            "issue_response",
            "destination_url",
            "form_url",
            "assisted_token",
            "FORM1_ISSUE_URL",
            "FORM1_PUBLIC_URL",
            "FORM1_TOKEN_FIELD_ALIAS",
            "^[A-Za-z0-9_-]{43}$",
            ".right(43)",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)
        self.assertNotIn("try", source.lower())
        self.assertNotIn("catch", source.lower())
        self.assertNotIn("ZCFKEY", source)
        self.assertNotIn("HEADER_SECRET", source)
        self.assertNotRegex(source, r"\b[1-9][0-9]{9,29}\b")
        self.assertNotRegex(source, r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+")

    def test_form2_deluge_template_matches_the_exact_caller_contract(self) -> None:
        caller = self.callers["callers"][1]
        self.assertEqual(caller["logical_name"], "FORM2_SETUP_ISSUE_CALLER")
        source_path = (CALLER_MANIFEST_PATH.parent / caller["source"]).resolve()
        self.assertTrue(source_path.is_relative_to(PACKAGE))
        source = source_path.read_text(encoding="utf-8")
        self.assertEqual(
            caller["success_response"]["token_grammar"],
            "^[A-Za-z0-9_-]{43}$",
        )

        self.assertEqual(source.lower().count("invokeurl"), 1)
        self.assertEqual(source.count("openUrl("), 1)
        self.assertIn("detailed : true", source)
        self.assertIn("response-format : STRING", source)
        self.assertIn('request_headers.put("Content-Type","application/json");', source)
        self.assertNotIn("for each", source.lower())
        self.assertNotIn("while", source.lower())
        self.assertNotIn("ZCFKEY", source)
        self.assertNotIn("HEADER_SECRET", source)
        self.assertNotRegex(source, r"https?://")
        self.assertNotRegex(source, r"\b[1-9][0-9]{9,29}\b")
        self.assertNotRegex(
            source,
            r"\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b",
        )
        self.assertNotRegex(source, r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+")

        placeholders = sorted(set(re.findall(r"\{\{[A-Z0-9_]+\}\}", source)))
        self.assertEqual(placeholders, sorted(caller["private_placeholders"]))
        self.assertIn(caller["connection"]["placeholder"], source)
        self.assertIn("{{FORM2_ACCESS_PUBLIC_URL}}", source)
        self.assertIn(
            'issue_response.get("responseCode").toString() == "200"',
            source,
        )
        puts = [
            'request_body.put("dealId",input.deal_id.toString());',
            'request_body.put("issueRequestId",input.issue_request_id.toString());',
        ]
        for put in puts:
            self.assertIn(put, source)
        self.assertEqual(source.count("request_body.put("), len(puts))
        for response_key in ("ok", "accessUrl", "expiresAt"):
            self.assertIn(f'response_body.containKey("{response_key}")', source)
        self.assertIn("response_body.size() == 3", source)
        self.assertIn("length() ==", source)
        self.assertIn("+ 43", source)
        token_assignment = "setup_token = "
        token_guard = 'setup_token.matches("^[A-Za-z0-9_-]{43}$")'
        self.assertIn(token_assignment, source)
        self.assertIn(token_guard, source)
        self.assertIn(".right(43);", source)
        self.assertLess(source.index(token_assignment), source.index(token_guard))
        self.assertLess(source.index(token_guard), source.index("can_open = true;"))
        self.assertLess(source.index("can_open = true;"), source.index("openUrl("))

    def test_form2_destination_token_grammar_rejects_bad_values(self) -> None:
        token_pattern = re.compile(r"^[A-Za-z0-9_-]{43}$")
        self.assertIsNotNone(token_pattern.fullmatch("A" * 43))
        for invalid in (
            "A" * 42 + "#",
            "A" * 42 + "+",
            "A" * 42 + "/",
            "A" * 42 + "=",
            "A" * 42 + " ",
            "A" * 44,
            "A" * 42,
        ):
            with self.subTest(invalid=invalid[-1:]):
                self.assertIsNone(token_pattern.fullmatch(invalid))

    def test_deluge_logging_is_coarse_and_never_emits_runtime_values(self) -> None:
        allowed = {
            'info "form1_assisted_issue_disabled";',
            'info "form1_issue_rejected";',
            'info "form2_issue_failed";',
            'info "form2_issue_rejected";',
        }
        observed = set()
        for caller in self.callers["callers"]:
            source_path = (CALLER_MANIFEST_PATH.parent / caller["source"]).resolve()
            for line in source_path.read_text(encoding="utf-8").splitlines():
                if line.strip().startswith("info "):
                    observed.add(line.strip())
        self.assertEqual(observed, allowed)


if __name__ == "__main__":
    unittest.main()
