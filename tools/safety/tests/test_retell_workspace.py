from __future__ import annotations

import copy
import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
RETELL_ROOT = REPOSITORY_ROOT / "src" / "retell"
VALIDATOR_PATH = RETELL_ROOT / "tools" / "validate_workspace.py"

EXPECTED_AGENTS = {
    "7-day-free-test": ("agent_7_day_free_test", "7-Day Free Test"),
    "revenue-desk-master-template": (
        "agent_revenue_desk_master_template",
        "Revenue Desk — Master Template",
    ),
}


def _load_validator():
    spec = importlib.util.spec_from_file_location(
        "retell_workspace_validator", VALIDATOR_PATH
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load the Retell workspace validator")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _snapshot_ids() -> list[str]:
    return sorted(
        path.name for path in (RETELL_ROOT / "snapshots").iterdir() if path.is_dir()
    )


class RetellWorkspaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.validator = _load_validator()

    def test_current_workspace_passes_offline_validation(self):
        self.assertEqual([], self.validator.validate_workspace())

    def test_exact_agent_names_have_separate_configuration_trees(self):
        agent_root = RETELL_ROOT / "agents"
        self.assertEqual(
            set(EXPECTED_AGENTS),
            {path.name for path in agent_root.iterdir() if path.is_dir()},
        )
        for slug, (local_key, display_name) in EXPECTED_AGENTS.items():
            manifest = json.loads(
                (agent_root / slug / "manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual(local_key, manifest["local_key"])
            self.assertEqual(display_name, manifest["display_name"])
            self.assertIs(manifest["separate_configuration_boundary"], True)

            other_names = {
                other_name
                for other_slug, (_, other_name) in EXPECTED_AGENTS.items()
                if other_slug != slug
            }
            content = "\n".join(
                path.read_text(encoding="utf-8")
                for path in (agent_root / slug).rglob("*.json")
            )
            for other_name in other_names:
                self.assertNotIn(other_name, content)

    def test_snapshots_publish_contract_status_not_runtime_inventory(self):
        self.assertGreater(len(_snapshot_ids()), 0)
        prohibited_keys = {
            "connection_alias",
            "source_default_present",
            "structural_counts",
            "section_presence",
            "node_type_counts",
            "transition_reference_count",
            "default_dynamic_variable_count",
        }
        for snapshot_id in _snapshot_ids():
            for slug in EXPECTED_AGENTS:
                draft = (
                    RETELL_ROOT
                    / "agents"
                    / slug
                    / "snapshots"
                    / snapshot_id
                    / "draft"
                )
                variables = json.loads(
                    (draft / "dynamic-variable-contract.json").read_text(
                        encoding="utf-8"
                    )
                )
                self.assertEqual([], variables["definitions"])
                self.assertEqual(0, variables["public_definition_count"])
                self.assertIs(variables["runtime_mapping_in_git"], False)

                functions = json.loads(
                    (draft / "function-definitions.json").read_text(encoding="utf-8")
                )
                self.assertEqual([], functions["definitions"])
                self.assertEqual(0, functions["public_definition_count"])
                self.assertIs(functions["runtime_inventory_in_git"], False)

                tests = json.loads(
                    (draft / "test-definitions.json").read_text(encoding="utf-8")
                )
                self.assertEqual(0, tests["retell_test_runs_performed"])
                self.assertTrue(tests["definitions"])
                for definition in tests["definitions"]:
                    self.assertIs(definition["external_call"], False)

                all_documents = [
                    json.loads(path.read_text(encoding="utf-8"))
                    for path in (RETELL_ROOT / "agents" / slug).rglob("*.json")
                ]
                serialized = json.dumps(all_documents, sort_keys=True)
                for key in prohibited_keys:
                    self.assertNotIn(f'"{key}"', serialized)

    def test_validator_rejects_prohibited_public_shapes(self):
        unsafe_examples = (
            {"agent_id": "synthetic"},
            {"connection_alias": "provider-development"},
            {"source_default_present": True},
            {"global_prompt": "synthetic instruction"},
            {"condition": "synthetic branch"},
            {"safe_key": "https://example.invalid/private"},
            {"safe_key": "+12025550147"},
            {"safe_key": "+1 202-555-0147"},
            {"safe_key": "2026-08-20T14:51:29Z"},
            {"safe_key": "SyntheticIdentifier1234567890"},
        )
        for example in unsafe_examples:
            with self.subTest(example=tuple(example)):
                self.assertTrue(self.validator.find_public_data_problems(example))

    def test_exact_file_inventory_rejects_extra_text(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / "retell"
            shutil.copytree(RETELL_ROOT, copied)
            (copied / "raw-export.txt").write_text(
                "synthetic forbidden extra file", encoding="utf-8"
            )
            problems = self.validator.validate_workspace(copied)
            self.assertTrue(
                any("Unexpected public files" in problem for problem in problems)
            )

    def test_core_configuration_schema_rejects_removal_and_extra_field(self):
        snapshot_id = _snapshot_ids()[0]
        slug, (local_key, display_name) = next(iter(EXPECTED_AGENTS.items()))
        path = (
            RETELL_ROOT
            / "agents"
            / slug
            / "snapshots"
            / snapshot_id
            / "draft"
            / "agent-configuration-summary.json"
        )
        document = json.loads(path.read_text(encoding="utf-8"))

        missing = copy.deepcopy(document)
        missing.pop("configuration_summary")
        self.assertTrue(
            self.validator.validate_configuration_document(
                missing, snapshot_id, local_key, display_name
            )
        )

        extra = copy.deepcopy(document)
        extra["unexpected_runtime_field"] = "synthetic"
        self.assertTrue(
            self.validator.validate_configuration_document(
                extra, snapshot_id, local_key, display_name
            )
        )

    def test_published_lifecycle_supports_resolution_or_complete_artifacts(self):
        self.assertEqual(
            [],
            self.validator.published_layout_problems({"resolution.json"}),
        )
        self.assertEqual(
            [],
            self.validator.published_layout_problems(
                set(self.validator.DRAFT_ARTIFACTS)
            ),
        )
        self.assertTrue(
            self.validator.published_layout_problems(
                {"resolution.json", "agent-configuration-summary.json"}
            )
        )

    def test_readme_records_no_write_and_private_snapshot_boundaries(self):
        readme = (RETELL_ROOT / "README.md").read_text(encoding="utf-8")
        required_markers = (
            "7-Day Free Test",
            "Revenue Desk — Master Template",
            "Modify a draft only",
            "Complete raw responses",
            "published configuration did not resolve",
            "No Retell API call is required",
            "runtime-derived variable names",
        )
        for marker in required_markers:
            self.assertIn(marker, readme)


if __name__ == "__main__":
    unittest.main()
