import shutil
import subprocess
import unittest
from pathlib import Path


RUNTIME_TEST = Path(__file__).with_name("client_scripts_runtime.test.js")


class ClientScriptRuntimeTests(unittest.TestCase):
    """Run the dependency-free ZDK boundary tests in the repository test flow."""

    def test_client_script_runtime_contract(self) -> None:
        node = shutil.which("node")
        self.assertIsNotNone(node, "Node.js is required for CRM Client Script tests")
        result = subprocess.run(
            [node, "--test", str(RUNTIME_TEST)],
            cwd=RUNTIME_TEST.parents[4],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
