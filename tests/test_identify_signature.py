"""Unit tests for identify.py's Authenticode status mapper without importing the runner."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest

IDENTIFY_SOURCE = Path(__file__).resolve().parents[1] / "deploy" / "detonation" / "runner" / "identify.py"


def extract_signature_status(done):
    source = IDENTIFY_SOURCE.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(IDENTIFY_SOURCE))
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "signature_status")
    calls = []

    def run(command, timeout):
        calls.append((command, timeout))
        return done

    namespace = {
        "run": run,
        "OSSLSIGNCODE": "osslsigncode",
        "tail": lambda value: (value or "").strip()[-1000:],
        "text": lambda value, size=200: str(value or "")[:size],
    }
    module = ast.Module(body=[function], type_ignores=[])
    exec(compile(module, str(IDENTIFY_SOURCE), "exec"), namespace)
    result = namespace["signature_status"]("/in/sample.exe")
    return result, calls


class SignatureStatusTests(unittest.TestCase):
    def test_timeout_precedes_success_and_unsigned_markers(self):
        for marker in ("Signature verification: ok", "No signature found"):
            with self.subTest(marker=marker):
                result, _ = extract_signature_status({"code": 0, "stdout": marker, "stderr": "", "timedOut": True})
                self.assertEqual(result, {"status": "error", "detail": "The signature check did not run."})

    def test_missing_tool_precedes_both_output_markers(self):
        for marker in ("Signature verification: ok", "No signature found"):
            with self.subTest(marker=marker):
                result, calls = extract_signature_status({
                    "code": 127, "stdout": marker, "stderr": "", "timedOut": False,
                })
                self.assertEqual(result, {"status": "error", "detail": "The signature check did not run."})
                self.assertEqual(calls, [(["osslsigncode", "verify", "/in/sample.exe"], 15)])

    def test_nonzero_exit_cannot_be_validated_by_success_marker(self):
        result, _ = extract_signature_status({
            "code": 1, "stdout": "Signature verification: ok", "stderr": "", "timedOut": False,
        })
        self.assertEqual(result, {"status": "invalid", "detail": "The signature checker exited with code 1."})

    def test_zero_exit_with_success_marker_is_valid(self):
        result, _ = extract_signature_status({
            "code": 0, "stdout": "Signature verification: ok", "stderr": "", "timedOut": False,
        })
        self.assertEqual(result, {"status": "valid", "detail": "The Authenticode signature verifies."})

    def test_completed_unsigned_output_remains_unsigned(self):
        result, _ = extract_signature_status({
            "code": 1, "stdout": "No signature found", "stderr": "", "timedOut": False,
        })
        self.assertEqual(result, {"status": "unsigned", "detail": "No Authenticode signature."})


if __name__ == "__main__":
    unittest.main()
