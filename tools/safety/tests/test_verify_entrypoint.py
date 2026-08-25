from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "tools" / "verify.ps1"
WRAPPER = ROOT / "tools" / "verify.cmd"
TOOLS_README = ROOT / "tools" / "README.md"
ROOT_README = ROOT / "README.md"
WORKFLOW = ROOT / ".github" / "workflows" / "repo-checks.yml"
DEPENDABOT = ROOT / ".github" / "dependabot.yml"


class VerifyEntrypointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.script = SCRIPT.read_text(encoding="utf-8")
        cls.workflow = WORKFLOW.read_text(encoding="utf-8")
        cls.dependabot = DEPENDABOT.read_text(encoding="utf-8")

    def test_canonical_entrypoint_and_parameter_contract_exist(self) -> None:
        self.assertTrue(SCRIPT.is_file())
        self.assertTrue(WRAPPER.is_file())
        self.assertIn('[ValidateSet("Quick", "All")]', self.script)
        self.assertIn('[string]$Mode = "Quick"', self.script)
        self.assertIn("[switch]$Bootstrap", self.script)
        self.assertIn("[string]$PythonPath", self.script)

    def test_runtime_baselines_and_codex_python_fallback_are_explicit(self) -> None:
        self.assertIn('$Info.implementation -eq "CPython"', self.script)
        self.assertIn("$Info.minor -eq 12", self.script)
        self.assertIn("$Info.bits -eq 64", self.script)
        self.assertIn('$ExpectedNodeVersion = "24.19.0"', self.script)
        self.assertIn('$reportedVersion -ne $ExpectedNodeVersion', self.script)
        self.assertIn(
            ".cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe",
            self.script,
        )
        self.assertIn('Get-Command -Name "npm.cmd" -CommandType Application', self.script)
        self.assertIn('"node_modules", "npm", "bin", "npm-cli.js"', self.script)
        self.assertIn("$script:VerifiedNodeExecutable $script:NpmCliPath @Arguments", self.script)

    def test_quick_is_offline_and_all_or_bootstrap_enables_installs(self) -> None:
        self.assertIn('$useRegistry = $Bootstrap -or $Mode -eq "All"', self.script)
        self.assertIn('if ($useRegistry) {', self.script)
        self.assertIn('"--require-hashes"', self.script)
        self.assertIn('"ci", "--ignore-scripts", "--no-audit", "--no-fund"', self.script)
        self.assertEqual(
            7,
            self.script.count('"ci", "--ignore-scripts", "--no-audit", "--no-fund"'),
        )
        self.assertIn('"--install-links"', self.script)
        self.assertIn('if ($Mode -eq "All") {', self.script)
        self.assertIn('"audit", "--omit=dev", "--audit-level=moderate"', self.script)
        self.assertEqual(
            7,
            self.script.count('"audit", "--omit=dev", "--audit-level=moderate"'),
        )
        self.assertIn('$env:npm_config_offline = "true"', self.script)
        self.assertIn('$env:npm_config_update_notifier = "false"', self.script)
        for unsafe_downloader in ("Invoke-WebRequest", "curl.exe", "Start-BitsTransfer"):
            self.assertNotIn(unsafe_downloader, self.script)

    def test_every_required_check_is_owned_by_the_entrypoint(self) -> None:
        for required_fragment in (
            "tools/safety/pre-commit-safety-check.py",
            "tools/safety/validate_workflows.py",
            '"-m", "unittest", "discover"',
            '"run", "ci", "--prefix", $GatewayRoot',
            '"run", "ci", "--prefix", $CrmBillingOrchestratorRoot',
            '"run", "ci", "--prefix", $RequestFormRoot',
            '"run", "ci", "--prefix", $SetupFormRoot',
            '"run", "ci", "--prefix", $RevenueDeskCallGatewayRoot',
            '"run", "ci", "--prefix", $RevenueDeskCallWorkerRoot',
            '"run", "ci", "--prefix", $RevenueDeskAnalyticsRoot',
        ):
            with self.subTest(fragment=required_fragment):
                self.assertIn(required_fragment, self.script)
        self.assertIn("$script:FailureExitCode = $exitCode", self.script)
        self.assertNotIn("Invoke-Expression", self.script)

    def test_paths_are_composed_portably_and_bootstrap_rolls_over_local_venv(self) -> None:
        for nonportable in (
            '"src\\zoho-catalyst',
            '"tools\\safety',
            '".codex-tmp\\safety-venv',
            '"node_modules\\zcatalyst-sdk-node',
        ):
            with self.subTest(path=nonportable):
                self.assertNotIn(nonportable, self.script)
        self.assertIn("function Join-PathSegments", self.script)
        self.assertIn('$CrmBillingOrchestratorRoot = Join-PathSegments $RepoRoot @(', self.script)
        self.assertIn('$RequestFormRoot = Join-PathSegments $RepoRoot @(', self.script)
        self.assertIn('$SetupFormRoot = Join-PathSegments $RepoRoot @(', self.script)
        self.assertIn('$RevenueDeskCallGatewayRoot = Join-PathSegments $RepoRoot @(', self.script)
        self.assertIn('$RevenueDeskCallWorkerRoot = Join-PathSegments $RepoRoot @(', self.script)
        self.assertIn('$RevenueDeskAnalyticsRoot = Join-PathSegments $RepoRoot @(', self.script)
        self.assertIn('"node_modules", "revenue_desk_call_gateway", "package.json"', self.script)
        self.assertIn('"node_modules", "zcatalyst-sdk-node", "package.json"', self.script)
        self.assertNotIn("retell-free-test", self.script)
        self.assertNotIn("RetellFreeTest", self.script)
        self.assertIn("function Ensure-LocalPythonEnvironment", self.script)
        self.assertIn("Get-ManagedVenvPythonCandidates", self.script)
        self.assertIn("safety-venv-cpython-3.12-x64-", self.script)
        self.assertIn("Test-ReparsePoint", self.script)
        self.assertIn("SYLVARA_VERIFY_VENV_V1", self.script)
        self.assertNotIn("Remove-Item", self.script)
        self.assertIn(
            "Refusing to create a managed verification environment through a reparse-point",
            self.script,
        )

    def test_revenue_desk_topology_is_fail_closed_and_exact(self) -> None:
        self.assertIn("function Assert-RevenueDeskTopology", self.script)
        self.assertIn("canonical_project_count -ne 1", self.script)
        self.assertIn("final_active_function_count -ne 6", self.script)
        for exact_fragment in (
            "revenue_leak_test_request_form|Advanced I/O",
            "revenue_leak_test_setup_form|Advanced I/O",
            "revenue_desk_call_gateway|Advanced I/O",
            "revenue_desk_call_worker|Job",
            "crm_billing_orchestrator|Advanced I/O",
            "analytics_sync|Job",
            "RevenueDeskCallJobs|revenue_desk_call_worker",
            "RevenueDeskAnalyticsJobs|analytics_sync",
        ):
            with self.subTest(fragment=exact_fragment):
                self.assertIn(exact_fragment, self.script)
        self.assertIn("Assert-RevenueDeskTopology", self.script)

    def test_ci_and_dependabot_use_only_the_new_revenue_desk_packages(self) -> None:
        canonical_paths = (
            "src/zoho-catalyst/revenue-desk-call-runtime/functions/revenue_desk_call_gateway",
            "src/zoho-catalyst/revenue-desk-call-runtime/functions/revenue_desk_call_worker",
            "src/zoho-catalyst/revenue-desk-analytics/functions/analytics_sync",
        )
        for path in canonical_paths:
            with self.subTest(path=path):
                self.assertEqual(3, self.workflow.count(path))
                self.assertEqual(1, self.dependabot.count(f"/{path}"))
        for obsolete in (
            "src/zoho-catalyst/retell-free-test/functions/retell_free_test",
            "src/zoho-catalyst/retell-free-test/functions/retell_free_test_retry",
        ):
            with self.subTest(obsolete=obsolete):
                self.assertNotIn(obsolete, self.workflow)
                self.assertNotIn(obsolete, self.dependabot)

    def test_documentation_uses_the_canonical_command(self) -> None:
        root_readme = ROOT_README.read_text(encoding="utf-8")
        tools_readme = TOOLS_README.read_text(encoding="utf-8")
        self.assertIn(".\\tools\\verify.cmd", root_readme)
        self.assertIn(".\\tools\\verify.cmd", tools_readme)
        self.assertIn("-Bootstrap", tools_readme)
        self.assertIn("-Mode All", tools_readme)
        self.assertIn("Quick without `-Bootstrap` does not install", tools_readme)
        root_agents = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
        self.assertIn("pwsh -NoProfile -File ./tools/verify.ps1", root_agents)

    def test_windows_wrapper_uses_process_scoped_policy_bypass(self) -> None:
        wrapper = WRAPPER.read_text(encoding="utf-8").lower()
        self.assertIn("-executionpolicy bypass", wrapper)
        self.assertIn('"%~dp0verify.ps1" %*', wrapper)
        self.assertIn("exit /b %errorlevel%", wrapper)
        self.assertNotIn("set-executionpolicy", wrapper)

    def test_powershell_parser_accepts_the_entrypoint(self) -> None:
        shell = shutil.which("pwsh") or shutil.which("powershell")
        if shell is None:
            self.skipTest("PowerShell is not available on this test host")
        escaped_path = str(SCRIPT).replace("'", "''")
        command = (
            f"$path='{escaped_path}'; $tokens=$null; $errors=$null; "
            "[System.Management.Automation.Language.Parser]::ParseFile("
            "$path,[ref]$tokens,[ref]$errors) | Out-Null; "
            "if($errors.Count){$errors | ForEach-Object {$_.Message}; exit 1}"
        )
        result = subprocess.run(
            [shell, "-NoProfile", "-NonInteractive", "-Command", command],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=30,
        )
        self.assertEqual(0, result.returncode, result.stdout)


if __name__ == "__main__":
    unittest.main()
