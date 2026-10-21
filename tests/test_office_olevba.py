"""Unit tests for office.py's olevba mapper without importing its module-level runner."""
import ast
import json
from pathlib import Path
from types import SimpleNamespace
import unittest

OFFICE_SOURCE = Path(__file__).resolve().parents[1] / "deploy" / "detonation" / "runner" / "office.py"


def extract_olevba(done):
    source = OFFICE_SOURCE.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(OFFICE_SOURCE))
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "olevba")
    calls = []

    def run(command, timeout):
        calls.append((command, timeout))
        return done

    namespace = {
        "json": json,
        "sys": SimpleNamespace(executable="/test/python"),
        "run": run,
        "tail": lambda value: (value or "").strip()[-1000:],
        "MAX_ANALYSIS": 60,
    }
    module = ast.Module(body=[function], type_ignores=[])
    exec(compile(module, str(OFFICE_SOURCE), "exec"), namespace)
    result = namespace["olevba"]("/in/sample.docx")
    return result, calls


class OlevbaTests(unittest.TestCase):
    def test_empty_output_with_nonzero_exit_is_failed(self):
        result, calls = extract_olevba({"code": 2, "stdout": "", "stderr": "", "timedOut": False})
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "olevba exited with code 2")
        self.assertEqual(calls, [(["/test/python", "-m", "oletools.olevba", "--json", "--no-deobfuscate", "/in/sample.docx"], 20)])

    def test_empty_output_on_timeout_is_failed_even_with_zero_exit_code(self):
        for done in (
            {"code": 124, "stdout": "", "stderr": "", "timedOut": True},
            {"code": 0, "stdout": "", "stderr": "", "timedOut": True},
        ):
            with self.subTest(done=done):
                result, _ = extract_olevba(done)
                self.assertFalse(result["ok"])
                self.assertEqual(result["error"], "olevba timed out")

    def test_zero_exit_without_valid_json_is_failed(self):
        for stdout in ("scanner returned no report", "["):
            with self.subTest(stdout=stdout):
                result, _ = extract_olevba({"code": 0, "stdout": stdout, "stderr": "", "timedOut": False})
                self.assertFalse(result["ok"])
                self.assertEqual(result["error"], "olevba output was not JSON")

    def test_failed_or_timed_out_run_preserves_valid_partial_analysis(self):
        stdout = json.dumps([{
            "type": "OLE",
            "macros": [{"name": "Module1"}],
            "analysis": [{"type": "AutoExec", "keyword": "AutoOpen", "description": "runs on open"}],
        }])
        for done in (
            {"code": 1, "stdout": stdout, "stderr": "", "timedOut": False},
            {"code": 124, "stdout": stdout, "stderr": "", "timedOut": True},
        ):
            with self.subTest(done=done):
                result, _ = extract_olevba(done)
                self.assertFalse(result["ok"])
                self.assertEqual(result["macroCount"], 1)
                self.assertEqual(result["analysis"], [{"type": "AutoExec", "keyword": "AutoOpen", "description": "runs on open"}])

    def test_successful_zero_macro_json_is_success(self):
        result, _ = extract_olevba({"code": 0, "stdout": "[]", "stderr": "", "timedOut": False})
        self.assertEqual(result, {"ok": True, "type": None, "macroCount": 0, "analysis": []})


    def test_successful_non_empty_json_is_mapped(self):
        analysis = {"type": "AutoExec", "keyword": "AutoOpen", "description": "runs on open"}
        result, _ = extract_olevba({
            "code": 0,
            "stdout": json.dumps([{"type": "metadata", "format": "olevba"}, {"type": "OLE", "macros": [{"name": "Module1"}], "analysis": [analysis]}]),
            "stderr": "",
            "timedOut": False,
        })
        self.assertEqual(result, {"ok": True, "type": "OLE", "macroCount": 1, "analysis": [analysis]})

    def test_missing_and_null_fields_remain_empty(self):
        cases = (
            ([{"type": "OLE", "macros": None, "analysis": None}], {"ok": True, "type": "OLE", "macroCount": 0, "analysis": []}),
            ([{"type": "OLE", "macros": [{"name": "Module1"}]}], {"ok": True, "type": "OLE", "macroCount": 1, "analysis": []}),
            ([{"type": "OLE", "analysis": None}], {"ok": True, "type": "OLE", "macroCount": 0, "analysis": []}),
        )
        for records, expected in cases:
            with self.subTest(records=records):
                result, _ = extract_olevba({"code": 0, "stdout": json.dumps(records), "stderr": "", "timedOut": False})
                self.assertEqual(result, expected)

    def test_malformed_nested_shapes_fail_without_raising(self):
        reports = (
            [{"type": "OLE", "macros": 1}],
            [{"type": "OLE", "macros": "abc"}],
            [{"type": "OLE", "analysis": "not-a-list"}],
            [{"type": "OLE", "analysis": [None]}],
        )
        for records in reports:
            with self.subTest(records=records):
                result, _ = extract_olevba({"code": 0, "stdout": json.dumps(records), "stderr": "", "timedOut": False})
                self.assertFalse(result["ok"])
                self.assertEqual(result["error"], "olevba returned an invalid report")

    def test_malformed_later_record_preserves_prior_valid_analysis(self):
        analysis = {"type": "AutoExec", "keyword": "AutoOpen", "description": "runs on open"}
        records = [
            {"type": "OLE", "macros": [{"name": "Module1"}], "analysis": [analysis]},
            {"type": "OLE", "analysis": [None]},
            {"type": "OLE", "macros": [{"name": "Module2"}]},
        ]
        result, _ = extract_olevba({"code": 0, "stdout": json.dumps(records), "stderr": "", "timedOut": False})
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "olevba returned an invalid report")
        self.assertEqual(result["macroCount"], 1)
        self.assertEqual(result["analysis"], [analysis])


if __name__ == "__main__":
    unittest.main()
