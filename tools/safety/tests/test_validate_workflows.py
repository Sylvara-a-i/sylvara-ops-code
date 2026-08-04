from __future__ import annotations

import importlib.util
import unittest
import unittest.mock as mock
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "validate_workflows.py"
SPEC = importlib.util.spec_from_file_location("validate_workflows", SCRIPT)
assert SPEC and SPEC.loader
validate_workflows = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validate_workflows)


CHECKOUT = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1"
SETUP_NODE = "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020"


def workflow(job: str, trigger: str = "pull_request") -> str:
    return f"""name: Test

on:
  {trigger}:

permissions:
  contents: read

jobs:
{job}
"""


def hardened_job(steps: str | None = None) -> str:
    if steps is None:
        steps = f"""      - uses: {CHECKOUT}
        with:
          persist-credentials: false"""
    return f"""  test:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
{steps}"""


class WorkflowPolicyTests(unittest.TestCase):
    path = Path(".github/workflows/test.yml")

    def test_hardened_read_only_job_passes(self) -> None:
        text = workflow(hardened_job())
        self.assertEqual([], validate_workflows.validate_workflow(self.path, text))

    def test_floating_and_third_party_actions_are_blocked(self) -> None:
        floating = workflow(
            hardened_job(
                """      - uses: actions/checkout@main
        with:
          persist-credentials: false"""
            )
        )
        third_party = floating.replace(
            "actions/checkout@main",
            "vendor/action@0123456789012345678901234567890123456789",
        )
        floating_problems = validate_workflows.validate_workflow(self.path, floating)
        third_party_problems = validate_workflows.validate_workflow(
            self.path, third_party
        )
        self.assertTrue(any("full commit SHA" in item for item in floating_problems))
        self.assertTrue(any("owner is not allowlisted" in item for item in third_party_problems))

    def test_top_level_permissions_are_required_and_write_is_blocked(self) -> None:
        missing = workflow(hardened_job()).replace(
            "permissions:\n  contents: read\n\n", ""
        )
        writable = workflow(hardened_job()).replace("contents: read", "contents: write")
        self.assertTrue(
            any(
                "explicit mapping" in item
                for item in validate_workflows.validate_workflow(self.path, missing)
            )
        )
        self.assertTrue(
            any(
                "write permission is prohibited" in item
                for item in validate_workflows.validate_workflow(self.path, writable)
            )
        )

    def test_job_write_permissions_are_never_allowlisted(self) -> None:
        job = hardened_job().replace(
            "    steps:\n",
            "    permissions:\n      issues: write\n      contents: read\n    steps:\n",
        )
        problems = validate_workflows.validate_workflow(self.path, workflow(job))
        self.assertTrue(any("issues: write" in item for item in problems))

    def test_secrets_context_is_blocked_in_all_expression_forms(self) -> None:
        expressions = (
            "${{ secrets.API_TOKEN }}",
            "${{ secrets['API_TOKEN'] }}",
            "${{ toJSON(secrets) }}",
            "${{ format('{0}', secrets.API_TOKEN) }}",
        )
        for expression in expressions:
            with self.subTest(expression=expression):
                steps = f"""      - name: Attempt secret exfiltration
        run: echo blocked
        env:
          EXFILTRATE: \"{expression}\""""
                problems = validate_workflows.validate_workflow(
                    self.path, workflow(hardened_job(steps))
                )
                self.assertTrue(
                    any("secrets context is prohibited" in item for item in problems)
                )

    def test_literal_secrets_word_is_not_treated_as_context(self) -> None:
        steps = """      - name: Safe literal
        run: echo ${{ 'secrets' }}"""
        problems = validate_workflows.validate_workflow(
            self.path, workflow(hardened_job(steps))
        )
        self.assertEqual([], problems)

    def test_job_containers_and_services_are_blocked(self) -> None:
        additions = (
            "    container: python:3.13\n",
            "    services:\n      database:\n        image: postgres:17\n",
        )
        for addition in additions:
            with self.subTest(addition=addition):
                job = hardened_job().replace("    steps:\n", addition + "    steps:\n")
                problems = validate_workflows.validate_workflow(
                    self.path, workflow(job)
                )
                self.assertTrue(
                    any("usage is not approved" in item for item in problems)
                )

    def test_checkout_must_drop_persisted_credentials(self) -> None:
        steps = f"""      - uses: {CHECKOUT}"""
        problems = validate_workflows.validate_workflow(
            self.path, workflow(hardened_job(steps))
        )
        self.assertTrue(any("persist-credentials" in item for item in problems))

    def test_every_job_requires_a_bounded_timeout(self) -> None:
        missing = workflow(hardened_job().replace("    timeout-minutes: 5\n", ""))
        excessive = workflow(
            hardened_job().replace("timeout-minutes: 5", "timeout-minutes: 31")
        )
        for text in (missing, excessive):
            with self.subTest(text=text):
                problems = validate_workflows.validate_workflow(self.path, text)
                self.assertTrue(any("timeout-minutes" in item for item in problems))

    def test_pull_request_target_and_self_hosted_runners_are_blocked(self) -> None:
        text = workflow(
            hardened_job().replace("ubuntu-24.04", "self-hosted"),
            '"pull_request_target"',
        )
        problems = validate_workflows.validate_workflow(self.path, text)
        self.assertTrue(any("pull_request_target" in item for item in problems))
        self.assertTrue(any("runner must be exactly" in item for item in problems))

    def test_setup_node_requires_the_approved_major_version(self) -> None:
        steps = f"""      - uses: {SETUP_NODE}
        with:
          node-version: '22'"""
        problems = validate_workflows.validate_workflow(
            self.path, workflow(hardened_job(steps))
        )
        self.assertTrue(any("pin Node.js 24" in item for item in problems))

    def test_duplicate_yaml_keys_are_blocked(self) -> None:
        text = workflow(
            hardened_job().replace(
                "    runs-on: ubuntu-24.04\n",
                "    runs-on: ubuntu-24.04\n    runs-on: ubuntu-24.04\n",
            )
        )
        problems = validate_workflows.validate_workflow(self.path, text)
        self.assertTrue(any("duplicate key" in item for item in problems))

    def test_repository_requires_at_least_one_workflow(self) -> None:
        root = mock.MagicMock()
        workflow_directory = mock.MagicMock()
        root.__truediv__.return_value.__truediv__.return_value = workflow_directory
        workflow_directory.glob.return_value = []
        problems = validate_workflows.validate_repository(root)
        self.assertEqual(["No GitHub Actions workflows were found"], problems)


if __name__ == "__main__":
    unittest.main()
