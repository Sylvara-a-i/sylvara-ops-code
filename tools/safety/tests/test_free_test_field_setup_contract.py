import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
RELEASE = ROOT / "docs" / "product" / "free-revenue-leak-test-release-contract.json"
REQUEST = ROOT / "src" / "zoho-catalyst" / "revenue-leak-test-request-form"
SETUP = ROOT / "src" / "zoho-catalyst" / "revenue-leak-test-setup-form"
GATEWAY = (
    ROOT
    / "src"
    / "zoho-catalyst"
    / "revenue-desk-call-runtime"
    / "functions"
    / "revenue_desk_call_gateway"
)
CRM = ROOT / "src" / "zoho-crm" / "free-revenue-leak-test"
FORMS = ROOT / "src" / "zoho-forms" / "free-revenue-leak-test" / "forms-manifest.json"


def js_string_array(source, constant_name):
    match = re.search(
        rf"const {re.escape(constant_name)} = (?:Object\.freeze\(|new Set\()\[(.*?)\]\);",
        source,
        re.S,
    )
    if match is None:
        raise AssertionError(f"JavaScript array {constant_name} was not found")
    return re.findall(r'"([^"]+)"', match.group(1))


def protocol_from_source():
    source = (
        REQUEST
        / "functions"
        / "revenue_leak_test_request_form"
        / "lib"
        / "field-setup-protocol.js"
    ).read_text(encoding="utf-8")
    return json.loads(source.split("module.exports = ", 1)[1].rsplit(";", 1)[0])


class FreeTestFieldSetupContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.release = json.loads(RELEASE.read_text(encoding="utf-8"))
        cls.field_setup = cls.release["field_setup_candidate"]
        cls.v2 = cls.release["retell_v2_candidate"]
        cls.schema = json.loads(
            (REQUEST / "config" / "field-setup-datastore-schema.proposed.json").read_text(
                encoding="utf-8"
            )
        )
        cls.setup_manifest = json.loads(
            (SETUP / "config" / "field-setup-operations.proposed.json").read_text(
                encoding="utf-8"
            )
        )

    def test_release_keeps_field_setup_and_live_install_blocked(self):
        self.assertEqual("NOT_READY", self.field_setup["status"])
        self.assertEqual("NOT_AUTHORIZED", self.field_setup["live_install_status"])
        self.assertFalse(self.field_setup["web_client_deployment_or_publication_authorized"])
        self.assertFalse(self.field_setup["browser_activation_allowed"])
        self.assertEqual(0, self.field_setup["new_catalyst_function_count"])

    def test_only_two_existing_forms_are_preserved(self):
        self.assertEqual(
            ["REVENUE_LEAK_TEST_REQUEST_FORM", "REVENUE_LEAK_TEST_SETUP_FORM"],
            self.field_setup["forms_preserved"],
        )
        self.assertFalse(self.field_setup["form3_allowed"])
        forms_text = FORMS.read_text(encoding="utf-8").lower()
        self.assertNotIn("form 3", forms_text)
        self.assertNotIn("form3", forms_text)

    def test_one_narrow_shared_table_is_provisionable_and_executable_exact(self):
        schema = self.schema
        self.assertEqual(1, schema["existing_store_reuse_decision"]["new_table_count"])
        self.assertEqual(
            "RevenueLeakTestFieldSetupJourneys", schema["table"]["api_name"]
        )
        self.assertEqual("none", schema["table"]["client_access"])
        self.assertFalse(schema["table"]["delete_permission"])
        self.assertEqual("physical_union_columns", schema["table"]["provisioning_source"])

        protocol = protocol_from_source()["persistence"]
        journey_columns = schema["table"]["columns"]
        source_map = schema["source_property_map"]
        self.assertEqual(
            [column["api_name"] for column in journey_columns], list(source_map)
        )
        self.assertEqual(protocol["rowFields"], list(source_map.values()))

        shared = schema["shared_table_record_contract"]
        families = shared["record_families"]
        self.assertEqual(shared["strict_record_types"], list(families))
        journey = families["journey"]
        self.assertEqual(
            ["recordType", "rowKey", *protocol["rowFields"]],
            journey["required_fields"],
        )
        self.assertEqual(
            set(protocol["rowFields"]) - set(protocol["mandatoryFields"]),
            set(journey["nullable_fields"]),
        )
        self.assertFalse(journey["additional_canonical_properties_allowed"])

        union_columns = schema["table"]["physical_union_columns"]
        self.assertEqual(
            len(union_columns), len({column["api_name"] for column in union_columns})
        )
        source_fields = {
            field
            for column in union_columns
            for field in column["source_fields"]
        }
        self.assertEqual("RECORD_TYPE", union_columns[0]["api_name"])
        self.assertEqual("ROW_KEY", union_columns[1]["api_name"])
        self.assertTrue(all(not column["nullable"] for column in union_columns[:2]))
        self.assertTrue(all(column["nullable"] for column in union_columns[2:]))
        for record_type, family in families.items():
            self.assertTrue(
                set(family["required_fields"]).issubset(source_fields), record_type
            )
            self.assertTrue(
                set(family.get("nullable_fields", [])).issubset(
                    family["required_fields"]
                ),
                record_type,
            )

        physical_by_name = {
            column["api_name"]: column for column in union_columns
        }
        self.assertFalse(physical_by_name["BINDING_FINGERPRINT"]["unique"])
        self.assertFalse(physical_by_name["CONTROL_FENCE_FINGERPRINT"]["unique"])
        latest_control = physical_by_name["LATEST_CONTROL_OPERATION_FINGERPRINT"]
        self.assertTrue(latest_control["nullable"])
        self.assertFalse(latest_control["unique"])
        self.assertEqual(64, latest_control["max_length"])
        # The gateway permits a 32-character namespace, one separator, and a
        # 64-character digest. Both persisted receipt fields must preserve that
        # exact maximum rather than accepting source-valid values that truncate.
        self.assertEqual(
            physical_by_name["VERIFICATION_CLAIM_KEY"]["max_length"], 97
        )
        self.assertEqual(
            physical_by_name["ACTUAL_CALL_FINGERPRINT"]["max_length"], 97
        )
        current_control = families["current_control"]
        self.assertIn(
            "latestControlOperationFingerprint", current_control["required_fields"]
        )
        self.assertIn(
            "latestControlOperationFingerprint", current_control["nullable_fields"]
        )
        self.assertIn(
            "latestControlOperationFingerprint", current_control["cas_fields"]
        )
        self.assertIn("numberFingerprint", current_control["cas_fields"])
        self.assertIn("numberState", current_control["cas_fields"])
        self.assertIn("approvedQaCallerFingerprint", current_control["cas_fields"])
        self.assertIn("updatedAt", current_control["cas_fields"])
        self.assertEqual(
            78, physical_by_name["CONTROL_FENCE_FINGERPRINT"]["max_length"]
        )
        fence_representation = shared["control_fence_representation_contract"]
        self.assertEqual(
            "raw lowercase sha256 digest of exactly 64 characters",
            fence_representation["current_control.controlFenceFingerprint"],
        )
        self.assertIn("'control_fence_' + current_control.controlFenceFingerprint",
                      fence_representation["atomic_equality"])
        claim_contract = shared["atomic_contracts"]["claim_number"]
        for field in ["bindingFingerprint", "numberFingerprint", "numberState",
                      "controlFenceFingerprint", "updatedAt"]:
            self.assertIn(field, claim_contract)
        validation = shared["record_validation"]
        self.assertIn("exactly", validation["required_key_rule"])
        self.assertIn("must be null", validation["forbidden_field_rule"])
        indexes = schema["table"]["index_contracts"]
        self.assertIn(
            {"fields": ["RECORD_TYPE", "ROW_KEY"], "unique": True}, indexes
        )
        self.assertIn(
            {"fields": ["RECORD_TYPE", "CONTROL_FENCE_FINGERPRINT"], "unique": False},
            indexes,
        )
        self.assertIn(
            {"fields": ["RECORD_TYPE", "BINDING_FINGERPRINT"], "unique": False},
            indexes,
        )
        prohibited = " ".join(schema["data_policy"]["prohibited"]).lower()
        self.assertIn("raw nonce", prohibited)
        self.assertIn("secret", prohibited)

    def test_launch_contract_is_fragment_only_digest_only_and_sixty_seconds(self):
        launch = self.field_setup["launch_protocol"]
        self.assertEqual(1, launch["schema_version"])
        self.assertEqual("free_revenue_leak_test_field_setup_v1", launch["protocol_id"])
        self.assertEqual(256, launch["nonce_entropy_bits"])
        self.assertEqual("keyed digest only", launch["nonce_storage"])
        self.assertEqual(60, launch["maximum_ttl_seconds"])
        self.assertEqual("fragment nonce only", launch["url_content"])
        self.assertEqual(
            [
                "Secure",
                "HttpOnly",
                "SameSite=Strict",
                "bounded idle expiry",
                "bounded absolute expiry",
            ],
            launch["session_cookie"],
        )
        self.assertEqual("Leads", launch["new_journey_module"])
        self.assertEqual(["Leads", "Deals"], launch["resume_modules"])
        self.assertIn("record digest", launch["resume_binding"])
        self.assertEqual(
            [
                "x-sylvara-field-setup-protocol-id",
                "x-sylvara-field-setup-protocol-version",
            ],
            launch["runtime_protocol_headers_required"],
        )
        self.assertTrue(launch["successful_responses_echo_protocol_identity"])
        self.assertEqual(
            ["forms.zohopublic.com"],
            launch["form_navigation"]["approved_public_hosts"],
        )

    def test_source_wiring_is_explicit_injection_only_and_default_denied(self):
        request = self.field_setup["source_wiring"]["request_form"]
        self.assertEqual(0, request["default_route_claim_count"])
        self.assertEqual("synthetic_zero_network_preview", request["default_client_mode"])
        self.assertEqual(6, request["injected_route_count"])
        self.assertEqual("NOT_READY_INJECTED_ONLY", request["catalyst_header_mapping"])
        self.assertEqual("NOT_READY_INJECTED_ONLY", request["catalyst_identity_mapping"])
        self.assertEqual("NOT_READY_INJECTED_ONLY", request["catalyst_store_mapping"])
        self.assertFalse(request["deployment_authorized"])

        setup = self.field_setup["source_wiring"]["setup_form"]
        self.assertEqual(0, setup["default_operation_route_claim_count"])
        self.assertEqual(6, setup["existing_form2_route_count_preserved"])
        self.assertEqual(5, setup["injected_operation_route_count"])
        self.assertFalse(setup["provider_client_injected"])
        self.assertFalse(setup["number_purchase_adapter_injected"])
        self.assertFalse(setup["activation_adapter_injected"])
        self.assertFalse(setup["live_route_mutation_adapter_injected"])
        self.assertFalse(setup["verification_consumption_adapter_injected"])
        self.assertFalse(setup["deployment_authorized"])

    def test_field_setup_routes_are_proposed_disabled_and_do_not_activate(self):
        manifest = json.loads(
            (REQUEST / "config" / "field-setup-routes.proposed.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(
            "source-only-disabled-explicit-injection-required", manifest["status"]
        )
        self.assertEqual(6, len(manifest["routes"]))
        self.assertTrue(all(route["enabled"] is False for route in manifest["routes"]))
        dispatcher_source = (
            REQUEST
            / "functions"
            / "revenue_leak_test_request_form"
            / "lib"
            / "field-setup-dispatcher.js"
        ).read_text(encoding="utf-8")
        executable_routes = js_string_array(dispatcher_source, "ROUTE_KEYS")
        self.assertEqual(
            [
                "launchPath",
                "exchangePath",
                "statusPath",
                "decisionPath",
                "conversionPreviewPath",
                "conversionConfirmPath",
            ],
            executable_routes,
        )
        self.assertEqual(
            [
                "FIELD_SETUP_LAUNCH",
                "FIELD_SETUP_EXCHANGE",
                "FIELD_SETUP_STATUS",
                "FIELD_SETUP_OPERATOR_DECISION",
                "FIELD_SETUP_CONVERSION_PREVIEW",
                "FIELD_SETUP_CONVERSION_CONFIRM",
            ],
            [route["id"] for route in manifest["routes"]],
        )
        self.assertEqual(
            [
                "launch",
                "exchange",
                "status",
                "operator_decision",
                "conversion_preview",
                "conversion_confirm",
            ],
            self.field_setup["source_wiring"]["request_form"]["injected_routes"],
        )
        preview_route = next(
            route
            for route in manifest["routes"]
            if route["id"] == "FIELD_SETUP_CONVERSION_PREVIEW"
        )
        self.assertTrue(
            any("atomically replaces" in behavior for behavior in preview_route["behavior"])
        )
        conversion_source = (
            REQUEST
            / "functions"
            / "revenue_leak_test_request_form"
            / "lib"
            / "field-setup-conversion.js"
        ).read_text(encoding="utf-8")
        for expected in [
            'expectedConversionStatus: "preview_ready"',
            'expectedPreviewFingerprint: journey.conversionPreviewFingerprint',
            'expectedState: CONFIRMATION_STATE',
            'nextState: CONFIRMATION_STATE',
        ]:
            self.assertIn(expected, conversion_source)
        self.assertIn(
            "expected preview fingerprint",
            self.schema["conversion_persistence_contract"]["preview_refresh"],
        )
        self.assertIn(
            "atomically replaces only the exact current preview receipt",
            self.field_setup["source_wiring"]["request_form"][
                "conversion_preview_refresh"
            ],
        )
        composition = manifest["source_composition"]
        self.assertEqual("claims no field-setup routes", composition["default_dispatcher"])
        self.assertFalse(composition["deployment_authorized"])
        self.assertIn("CAS-backed", composition["injected_dispatcher"])
        rendered = json.dumps(manifest).lower()
        self.assertIn("browser_cannot_authorize", rendered)
        self.assertIn("activation", rendered)

    def test_client_has_exact_22_states_and_required_responsive_contract(self):
        client = REQUEST / "client" / "field-setup"
        state_source = (client / "state-model.js").read_text(encoding="utf-8")
        protocol_source = (
            REQUEST
            / "functions"
            / "revenue_leak_test_request_form"
            / "lib"
            / "field-setup-protocol.js"
        ).read_text(encoding="utf-8")
        protocol = json.loads(
            protocol_source.split("module.exports = ", 1)[1].rsplit(";", 1)[0]
        )
        self.assertEqual(22, len(protocol["states"]))
        self.assertEqual(22, len({state["id"] for state in protocol["states"]}))
        self.assertEqual(
            protocol,
            json.loads(
                (client / "protocol.generated.js")
                .read_text(encoding="utf-8")
                .split("  const protocol =\n", 1)[1]
                .split(";\n\n  function deepFreeze", 1)[0]
            ),
        )
        self.assertIn("width: 768, height: 1024", state_source)
        self.assertIn("width: 1024, height: 1366", state_source)
        styles = (client / "styles.css").read_text(encoding="utf-8")
        self.assertRegex(styles, r"button\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*(?:44|4[5-9]|[5-9][0-9])px;", re.S)
        self.assertIn(":focus-visible", styles)

    def test_client_removes_fragment_and_keeps_authenticated_wiring_injected(self):
        client = REQUEST / "client" / "field-setup"
        fragment = (client / "launch-fragment.js").read_text(encoding="utf-8")
        self.assertIn("historyLike.replaceState", fragment)
        rendered = "\n".join(
            path.read_text(encoding="utf-8")
            for path in client.glob("*")
            if path.is_file()
        ).lower()
        self.assertNotIn("<iframe", rendered)
        adapter = (client / "api-adapter.js").read_text(encoding="utf-8").lower()
        self.assertNotIn("fetch(", adapter)
        self.assertNotIn("xmlhttprequest", adapter)
        self.assertIn("synthetic", adapter)
        self.assertIn("createauthenticatedapi", adapter)
        self.assertIn("credentials: \"same-origin\"", adapter)
        self.assertIn("redirect: \"error\"", adapter)
        html = (client / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("FieldSetupRuntimeConfig", html)
        self.assertIn("connect-src 'self'", html)

    def test_client_and_setup_route_shapes_match_the_executable_sources(self):
        client_source = (
            REQUEST / "client" / "field-setup" / "api-adapter.js"
        ).read_text(encoding="utf-8")
        client_paths = js_string_array(client_source, "ROUTE_KEYS")
        web_client = self.field_setup["source_wiring"]["web_client"]
        self.assertEqual(10, web_client["injected_distinct_path_count"])
        self.assertEqual(client_paths, web_client["injected_distinct_paths"])
        self.assertEqual(len(client_paths), len(set(client_paths)))

        setup_source = (
            SETUP
            / "functions"
            / "revenue_leak_test_setup_form"
            / "lib"
            / "field-setup-operations-dispatcher.js"
        ).read_text(encoding="utf-8")
        setup_paths = js_string_array(setup_source, "ROUTE_KEYS")
        self.assertEqual(
            [
                "numberStatusPath",
                "numberClaimPath",
                "forwardingInstructionsPath",
                "routeVerificationWindowPath",
                "setupControlPath",
            ],
            setup_paths,
        )
        routes = self.setup_manifest["source_routes"]
        self.assertEqual(5, len(routes))
        self.assertTrue(all(route["enabled"] is False for route in routes))
        self.assertEqual(
            [
                "FIELD_SETUP_NUMBER_STATUS",
                "FIELD_SETUP_NUMBER_CLAIM",
                "FIELD_SETUP_FORWARDING_INSTRUCTIONS",
                "FIELD_SETUP_ROUTE_VERIFICATION_WINDOW",
                "FIELD_SETUP_CONTROL",
            ],
            [route["id"] for route in routes],
        )
        self.assertEqual(
            ["GET", "POST", "POST", "POST", "POST"],
            [route["method"] for route in routes],
        )
        self.assertEqual(
            ["journeyRevision", "view"], routes[2]["body"]
        )
        self.assertEqual(["enable", "rollback"], routes[2]["allowed_views"])
        self.assertIn(
            'readPostBody(request, ["journeyRevision", "view"])', setup_source
        )
        forwarding = web_client["forwarding_instruction_request"]
        self.assertEqual("POST", forwarding["method"])
        self.assertEqual(routes[2]["body"], forwarding["body"])
        self.assertEqual(routes[2]["allowed_views"], forwarding["allowed_views"])

        context_keys = js_string_array(setup_source, "CONTEXT_KEYS")
        control_record_keys = js_string_array(setup_source, "CONTROL_RECORD_KEYS")
        reservation_receipt_keys = js_string_array(
            setup_source, "RESERVATION_RECEIPT_KEYS"
        )
        self.assertEqual(
            context_keys,
            self.setup_manifest["source_route_authentication"]["authoritative_context"],
        )
        self.assertEqual(
            control_record_keys,
            self.setup_manifest["browser_setup_control"]["control_record_fields"],
        )
        self.assertEqual(
            reservation_receipt_keys,
            self.setup_manifest["number_inventory"]["receipt_fields"],
        )
        claim_function = re.search(
            r"function numberClaimOperationFingerprint\(context\) \{(.*?)\n\}",
            setup_source,
            re.S,
        )
        self.assertIsNotNone(claim_function)
        claim_parts_block = re.search(
            r"const parts = \[(.*?)\n  \];", claim_function.group(1), re.S
        )
        self.assertIsNotNone(claim_parts_block)
        self.assertEqual(
            [
                ("route", '"FIELD_SETUP_NUMBER_CLAIM"'),
                ("client", "context.clientFingerprint"),
                ("environment", "context.environmentFingerprint"),
                ("journey", "context.journeyFingerprint"),
                ("deployment", "context.deploymentFingerprint"),
                ("configuration", "context.configurationFingerprint"),
            ],
            re.findall(
                r'\["([^"]+)",\s*("[^"]+"|context\.[A-Za-z0-9_]+)\]',
                claim_parts_block.group(1),
            ),
        )
        self.assertEqual(
            [
                "client_fingerprint",
                "environment_fingerprint",
                "journey_fingerprint",
                "deployment_fingerprint",
                "configuration_fingerprint",
            ],
            self.setup_manifest["number_inventory"]["binding"],
        )
        self.assertEqual(
            [
                "session fingerprint",
                "journey revision",
                "number fingerprint",
                "control scope",
                "control fence",
            ],
            self.setup_manifest["number_inventory"]["operation_fingerprint_excludes"],
        )
        self.assertIn("previousControlFenceFingerprint", reservation_receipt_keys)
        self.assertIn("controlFenceFingerprint", reservation_receipt_keys)
        families = self.schema["shared_table_record_contract"]["record_families"]
        self.assertEqual(
            [
                "recordType",
                "rowKey",
                *context_keys,
                "controlScopeFingerprint",
                "bindingFingerprint",
                "controlFenceFingerprint",
                "updatedAt",
            ],
            families["current_control"]["required_fields"],
        )
        self.assertEqual(
            ["recordType", "rowKey", *control_record_keys],
            families["control_operation"]["required_fields"],
        )
        self.assertEqual(
            ["recordType", "rowKey", *reservation_receipt_keys],
            families["reservation_receipt"]["required_fields"],
        )
        self.assertEqual(
            [
                "confirm_forwarding_enabled",
                "confirm_rollback_ready",
                "stop",
                "resume",
            ],
            self.setup_manifest["browser_setup_control"]["allowed_actions"],
        )
        self.assertEqual(
            "issue_forwarding_instructions",
            self.setup_manifest["browser_setup_control"]["server_internal_action"],
        )
        self.assertEqual(
            "latestControlOperationFingerprint",
            self.setup_manifest["browser_setup_control"][
                "latest_control_operation_pointer_field"
            ],
        )
        self.assertEqual(
            "readControlOperationByOperationFingerprint",
            self.setup_manifest["browser_setup_control"][
                "control_receipt_readback_adapter"
            ],
        )

    def test_state_coordinator_and_window_contracts_match_executable_shapes(self):
        composition_source = (
            SETUP
            / "functions"
            / "revenue_leak_test_setup_form"
            / "lib"
            / "field-setup-operations-composition.js"
        ).read_text(encoding="utf-8")
        coordinator_block = re.search(
            r"const exactStateCoordinator = Object\.freeze\(\{(.*?)\n  \}\);",
            composition_source,
            re.S,
        )
        self.assertIsNotNone(coordinator_block)
        coordinator_methods = re.findall(
            r"^    ([A-Za-z0-9_]+): bindMethod\(",
            coordinator_block.group(1),
            re.M,
        )
        manifest_coordinator = self.setup_manifest["source_composition"][
            "state_coordinator"
        ]
        self.assertEqual(7, len(coordinator_methods))
        self.assertEqual(coordinator_methods, manifest_coordinator["required_methods"])
        self.assertEqual(coordinator_methods, self.schema["state_coordinator_interface"])
        self.assertEqual(
            coordinator_methods,
            self.field_setup["source_wiring"]["setup_form"][
                "authoritative_state_coordinator_methods"
            ],
        )
        self.assertEqual(
            ["consumeOpenWindowAtCurrentControlFence"],
            self.schema["gateway_shared_interface"],
        )
        self.assertEqual(
            self.schema["gateway_shared_interface"][0],
            manifest_coordinator["gateway_shared_method"],
        )

        operations_source = (
            SETUP
            / "functions"
            / "revenue_leak_test_setup_form"
            / "lib"
            / "field-setup-operations.js"
        ).read_text(encoding="utf-8")
        verification = self.setup_manifest["route_verification"]
        self.assertEqual(
            js_string_array(operations_source, "ROUTE_VERIFICATION_WINDOW_FIELDS"),
            verification["window_fields"],
        )
        self.assertEqual(
            js_string_array(operations_source, "ROUTE_WINDOW_ISSUE_COMMAND_FIELDS"),
            verification["issue_command_fields"],
        )
        issue_request = re.search(
            r"const issueRequest = deepFreeze\(\{(.*?)\n  \}\);",
            operations_source,
            re.S,
        )
        self.assertIsNotNone(issue_request)
        self.assertEqual(
            re.findall(r"^    ([a-z_]+):", issue_request.group(1), re.M),
            verification["issue_store_request_fields"],
        )
        self.assertEqual(
            "readLatestWindowByOperationScopeFingerprint",
            verification["latest_readback_operation"],
        )
        self.assertEqual(
            ["operation_scope_fingerprint"],
            verification["latest_readback_request_fields"],
        )
        self.assertEqual(
            ["attempt_epoch", "window"],
            verification["latest_readback_result_fields"],
        )
        self.assertIn("never browser supplied", verification["attempt_epoch_authority"])
        window_family = self.schema["shared_table_record_contract"][
            "record_families"
        ]["verification_window"]
        self.assertEqual(verification["window_fields"], window_family["window_projection_fields"])
        self.assertEqual(
            verification["receipt_fields"], window_family["receipt_projection_fields"]
        )
        self.assertEqual(
            [
                "recordType",
                "rowKey",
                "operation_scope_fingerprint",
                "attempt_epoch",
                "request_binding_key",
                "control_scope_fingerprint",
                "expected_control_fence_fingerprint",
                *verification["window_fields"],
                "verification_claim_key",
                "actual_call_fingerprint",
                "consumed_at",
            ],
            window_family["required_fields"],
        )

    def test_client_is_not_a_deploy_target(self):
        catalyst = json.loads((REQUEST / "catalyst.json").read_text(encoding="utf-8"))
        self.assertNotIn("client", catalyst)
        gate = catalyst["x-sylvara-source-only-client"]
        self.assertFalse(gate["deploymentAllowed"])
        self.assertFalse(gate["published"])

    def test_synthetic_ipad_screenshots_have_exact_required_dimensions(self):
        root = (
            ROOT
            / "docs"
            / "runbooks"
            / "assets"
            / "free-revenue-leak-test-field-setup"
        )
        for name, expected in [
            ("field-setup-768x1024.jpg", (768, 1024)),
            ("field-setup-1024x1366.jpg", (1024, 1366)),
        ]:
            payload = (root / name).read_bytes()
            self.assertEqual(b"\xff\xd8", payload[:2])
            self.assertEqual(expected, self._jpeg_dimensions(payload))

    @staticmethod
    def _jpeg_dimensions(payload):
        position = 2
        start_of_frame = {
            0xC0,
            0xC1,
            0xC2,
            0xC3,
            0xC5,
            0xC6,
            0xC7,
            0xC9,
            0xCA,
            0xCB,
            0xCD,
            0xCE,
            0xCF,
        }
        while position + 8 < len(payload):
            if payload[position] != 0xFF:
                position += 1
                continue
            while position < len(payload) and payload[position] == 0xFF:
                position += 1
            marker = payload[position]
            position += 1
            if marker in {0xD8, 0xD9}:
                continue
            if marker == 0xDA:
                break
            segment_length = int.from_bytes(payload[position : position + 2], "big")
            if segment_length < 2 or position + segment_length > len(payload):
                break
            if marker in start_of_frame:
                height = int.from_bytes(payload[position + 3 : position + 5], "big")
                width = int.from_bytes(payload[position + 5 : position + 7], "big")
                return width, height
            position += segment_length
        raise AssertionError("JPEG start-of-frame dimensions were not found")

    def test_crm_parallel_buttons_are_disabled_and_separate(self):
        manifest = json.loads(
            (CRM / "buttons" / "button-manifest.json").read_text(encoding="utf-8")
        )
        self.assertFalse(manifest["installation_authorized"])
        self.assertFalse(manifest["execution_authorized"])
        self.assertEqual(4, len(manifest["buttons"]))
        self.assertEqual(2, sum(button["label"] == "Open Free-Test Setup" for button in manifest["buttons"]))
        self.assertEqual(
            ["Approve & Start Free Test", "Stop / Roll Back Test"],
            [button["label"] for button in manifest["buttons"][2:]],
        )
        self.assertTrue(all(button["browser_exposed"] is False for button in manifest["buttons"][2:]))

    def test_crm_sources_have_no_committed_endpoint_or_credential(self):
        source = "\n".join(
            path.read_text(encoding="utf-8")
            for path in sorted((CRM / "functions").glob("*.deluge"))
        )
        self.assertEqual(4, source.count("<PRIVATE_FIELD_SETUP_CONNECTION_LINK_NAME>"))
        self.assertNotRegex(source, r"https://[^\"']+/(?:server|baas|api)/")
        self.assertNotRegex(source, r"(?i)(?:zcfkey|bearer|client_secret)\s*[:=]\s*['\"][^<][^'\"]+")
        self.assertNotRegex(source, r"\b[0-9]{15,30}\b")

    def test_route_verification_never_starts_intake_counts_or_notifies(self):
        self.assertFalse(self.field_setup["route_verification_normal_intake_allowed"])
        self.assertEqual(0, self.field_setup["route_verification_handled_call_increment"])
        self.assertFalse(self.field_setup["route_verification_notification_allowed"])
        proposed = json.loads(
            (SETUP / "config" / "field-setup-operations.proposed.json").read_text(
                encoding="utf-8"
            )
        )
        verification = proposed["route_verification"]
        gateway = json.loads(
            (
                GATEWAY
                / "contracts"
                / "call-gap-capture-handoff-v2.proposed.json"
            ).read_text(encoding="utf-8")
        )["route_verification"]
        self.assertEqual(verification["window_fields"], gateway["window_fields"])
        self.assertEqual(
            verification["authoritative_call_fields"],
            gateway["authoritative_call_binding_fields"],
        )
        self.assertEqual(verification["receipt_fields"], gateway["receipt_fields"])
        for key in [
            "current_control_fence_representation",
            "window_call_receipt_fence_representation",
            "atomic_fence_equality",
            "required_current_control_fence_fingerprint_representation",
        ]:
            self.assertEqual(verification[key], gateway[key])
        self.assertEqual(
            self.field_setup["route_verification_control_fence_representation"][
                "atomic_equality"
            ],
            gateway["atomic_fence_equality"],
        )
        gateway_source = (
            GATEWAY / "lib" / "call-gap-capture-handoff-v2-candidate.js"
        ).read_text(encoding="utf-8")
        self.assertIn("/^control_fence_[a-f0-9]{64}$/", gateway_source)
        self.assertIn("rawControlFenceFingerprint(", gateway_source)
        setup_source = (
            SETUP
            / "functions"
            / "revenue_leak_test_setup_form"
            / "lib"
            / "field-setup-operations.js"
        ).read_text(encoding="utf-8")
        binding_match = re.search(
            r"function setupControlBindingFingerprint\(.*?\n\}", setup_source, re.S
        )
        self.assertIsNotNone(binding_match)
        self.assertIn('["number_state", command.numberState ?? "none"]',
                      binding_match.group(0))
        self.assertIn(
            '["approved_qa_caller", command.approvedQaCallerFingerprint ?? "none"]',
            binding_match.group(0),
        )
        disposition = verification["verified_qa_runtime_disposition"]
        self.assertFalse(disposition["collect_agent_intake"])
        self.assertFalse(disposition["start_agent"])
        self.assertFalse(disposition["increment_handled_call_count"])
        self.assertFalse(disposition["send_notification"])

    def test_v2_is_draft_disabled_no_traffic_and_v1_is_preserved(self):
        self.assertEqual("NOT_READY", self.v2["status"])
        self.assertEqual("call_gap_capture_handoff_v2", self.v2["profile"])
        self.assertTrue(self.v2["draft"])
        self.assertFalse(self.v2["enabled"])
        self.assertEqual([], self.v2["traffic_environments"])
        self.assertEqual("call_gap_monitor_v1", self.v2["v1_profile_preserved"])
        self.assertTrue(self.v2["provider_event_parser_implemented"])
        self.assertFalse(self.v2["provider_neutral_state_machine_only"])
        self.assertEqual(17, self.v2["analysis_field_count"])
        self.assertFalse(self.v2["routine_transfer_allowed"])
        self.assertFalse(self.v2["retell_email_allowed"])
        self.assertFalse(self.v2["provider_import_or_publication_authorized"])
        candidate = self.v2["private_connected_candidate"]
        self.assertEqual(15, candidate["node_count"])
        self.assertEqual(15, candidate["reachable_node_count"])
        self.assertFalse(candidate["ordinary_directed_cycle_present"])
        self.assertEqual(1, candidate["reachable_warm_transfer_node_count"])
        self.assertTrue(candidate["transfer_requires_policy_gate"])
        self.assertTrue(candidate["transfer_requires_explicit_caller_acceptance"])
        self.assertEqual("Transfer failed", candidate["transfer_failure_edge_text"])
        self.assertEqual(6, candidate["webhook_event_count"])
        self.assertEqual(0, candidate["network_interaction_count"])
        self.assertEqual(0, candidate["provider_interaction_count"])
        self.assertTrue(candidate["ignored_private_artifact"])
        self.assertFalse(candidate["published"])
        self.assertFalse(candidate["bound_to_traffic"])
        self.assertFalse(candidate["publicly_importable"])

    def test_runbook_and_adr_record_required_separations_and_rollback(self):
        runbook = (
            ROOT / "docs" / "runbooks" / "free-revenue-leak-test-field-setup.md"
        ).read_text(encoding="utf-8")
        adr = (
            ROOT
            / "docs"
            / "adr"
            / "0008-bounded-free-test-human-handoff-and-operator-led-field-setup.md"
        ).read_text(encoding="utf-8")
        combined = f"{runbook}\n{adr}".lower()
        for required in [
            "no form 3",
            "not a customer portal",
            "call_gap_monitor_v1",
            "call_gap_capture_handoff_v2",
            "routine actionable calls",
            "human handoff",
            "infrastructure fallback",
            "customer rollback",
            "route verification",
            "not_authorized",
        ]:
            self.assertIn(required, combined)


if __name__ == "__main__":
    unittest.main()
