import json
import re
import unittest
from pathlib import Path


PACKAGE = Path(__file__).resolve().parents[1]
AUTOMATION_PATH = PACKAGE / "config" / "automation-contract.json"
CALLER_MANIFEST_PATH = PACKAGE / "config" / "caller-manifest.json"


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

    def test_caller_manifest_is_development_only_and_not_deployment_authority(self) -> None:
        manifest = self.callers
        self.assertEqual(manifest["status"], "reviewed_repository_templates_not_deployed")
        self.assertEqual(manifest["environment"], "Development only")
        self.assertFalse(manifest["render_policy"]["commit_rendered_source"])
        self.assertFalse(manifest["render_policy"]["log_rendered_source"])
        self.assertEqual(
            set(manifest["render_policy"]["placeholder_constraints"]),
            {"issue_url", "public_destination", "connection_link_name", "form_field_alias"},
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
        form2 = manifest["callers"][1]
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

    def test_deluge_templates_match_the_exact_request_and_response_contracts(self) -> None:
        expected = {
            "FORM1_ASSISTED_ISSUE_CALLER": {
                "puts": ['request_body.put("leadId",input.lead_id.toString());'],
                "status": "201",
                "response_keys": ["ok", "formUrl", "expiresAt"],
                "destination_guard": "{{FORM1_PUBLIC_URL}}",
                "token_variable": "assisted_token",
            },
            "FORM2_SETUP_ISSUE_CALLER": {
                "puts": [
                    'request_body.put("dealId",input.deal_id.toString());',
                    'request_body.put("issueRequestId",input.issue_request_id.toString());',
                ],
                "status": "200",
                "response_keys": ["ok", "accessUrl", "expiresAt"],
                "destination_guard": "{{FORM2_ACCESS_PUBLIC_URL}}",
                "token_variable": "setup_token",
            },
        }
        for caller in self.callers["callers"]:
            with self.subTest(caller=caller["logical_name"]):
                source_path = (CALLER_MANIFEST_PATH.parent / caller["source"]).resolve()
                self.assertTrue(source_path.is_relative_to(PACKAGE))
                source = source_path.read_text(encoding="utf-8")
                contract = expected[caller["logical_name"]]
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
                self.assertIn(contract["destination_guard"], source)
                self.assertIn(
                    f'issue_response.get("responseCode").toString() == "{contract["status"]}"',
                    source,
                )
                for put in contract["puts"]:
                    self.assertIn(put, source)
                self.assertEqual(source.count("request_body.put("), len(contract["puts"]))
                for response_key in contract["response_keys"]:
                    self.assertIn(f'response_body.containKey("{response_key}")', source)
                self.assertIn(
                    f'response_body.size() == {len(contract["response_keys"])}', source
                )
                self.assertIn("length() ==", source)
                self.assertIn("+ 43", source)
                token_assignment = f'{contract["token_variable"]} = '
                token_guard = (
                    f'{contract["token_variable"]}.matches('
                    '"^[A-Za-z0-9_-]{43}$")'
                )
                self.assertIn(token_assignment, source)
                self.assertIn(token_guard, source)
                self.assertIn(".right(43);", source)
                self.assertLess(source.index(token_assignment), source.index(token_guard))
                self.assertLess(source.index(token_guard), source.index("can_open = true;"))
                self.assertLess(source.index("can_open = true;"), source.index("openUrl("))

    def test_destination_token_grammar_rejects_delimiters_and_bad_alphabet(self) -> None:
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
            'info "form1_issue_failed";',
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
