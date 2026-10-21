"""Unit tests for static.py's capa subprocess mapper without importing the runner module."""
import ast
import json
from pathlib import Path
from types import SimpleNamespace
import unittest

STATIC_SOURCE = Path(__file__).resolve().parents[1] / "deploy" / "detonation" / "runner" / "static.py"


def extract_capa_scan(done):
    source = STATIC_SOURCE.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(STATIC_SOURCE))
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "capa_scan")
    calls = []
    ticks = iter((10.0, 10.5))

    def run(command, timeout, **kwargs):
        calls.append((command, timeout, kwargs))
        return done

    namespace = {
        "json": json,
        "time": SimpleNamespace(monotonic=lambda: next(ticks)),
        "run": run,
        "text": lambda value, size=160: str(value or "")[:size],
        "CAPA": "/opt/static-venv/bin/capa",
        "RULES": "/opt/capa/rules",
        "SIGNATURES": "/opt/capa/sigs",
        "CAPA_CACHE": "/opt/capa-cache",
        "CAPA_SECONDS": 22,
        "MAX_CAPA": 60,
    }
    module = ast.Module(body=[function], type_ignores=[])
    exec(compile(module, str(STATIC_SOURCE), "exec"), namespace)
    result = namespace["capa_scan"]("/in/sample.exe")
    return result, calls


class CapaScanTests(unittest.TestCase):
    def test_nonzero_exit_with_parseable_empty_or_rule_bearing_json_is_failure(self):
        reports = [
            {"rules": {}},
            {"rules": {"Packer": {"meta": {"namespace": "anti-analysis/packer", "attack": []}, "matches": [{}]}}},
        ]
        for report in reports:
            with self.subTest(report=report):
                result, calls = extract_capa_scan({"code": 1, "stdout": json.dumps(report), "stderr": "", "timedOut": False})
                self.assertEqual(result, {"ok": False, "error": "capa exited with code 1", "seconds": 0.5, "rules": []})
                self.assertEqual(calls[0][0][0], "/opt/static-venv/bin/capa")
                self.assertEqual(calls[0][1], 22)

    def test_zero_exit_empty_rules_report_is_successful(self):
        result, _ = extract_capa_scan({"code": 0, "stdout": '{"rules":{}}', "stderr": "", "timedOut": False})
        self.assertEqual(result, {"ok": True, "rules": [], "ruleCount": 0, "seconds": 0.5})

    def test_zero_exit_with_valid_json_remains_successful(self):
        report = {"rules": {"Packer": {"meta": {"namespace": "anti-analysis/packer", "attack": [{"id": "T1027"}]}, "matches": [{}, {}]}}}
        result, _ = extract_capa_scan({"code": 0, "stdout": json.dumps(report), "stderr": "", "timedOut": False})
        self.assertEqual(result, {
            "ok": True, "rules": [{"name": "Packer", "namespace": "anti-analysis/packer", "attack": ["T1027"], "count": 2}],
            "ruleCount": 1, "seconds": 0.5,
        })

    def test_syntactically_valid_but_schema_invalid_reports_fail_closed(self):
        reports = [
            [],
            {},
            {"rules": None},
            {"rules": []},
            {"rules": {"bad": []}},
            {"rules": {"bad": {"meta": [], "matches": []}}},
            {"rules": {"bad": {"meta": None, "matches": []}}},
            {"rules": {"bad": {"meta": {}, "matches": None}}},
            {"rules": {"bad": {"meta": {"attack": None}, "matches": []}}},
            {"rules": {"bad": {"meta": {}, "matches": "not-a-list"}}},
            {"rules": {"bad": {"meta": {"attack": "not-a-list"}, "matches": []}}},
        ]
        for report in reports:
            with self.subTest(report=report):
                result, _ = extract_capa_scan({"code": 0, "stdout": json.dumps(report), "stderr": "", "timedOut": False})
                self.assertEqual(result, {"ok": False, "error": "capa returned an invalid report", "seconds": 0.5, "rules": []})

    def test_timeout_and_malformed_json_keep_existing_failure_behavior(self):
        timed_out, _ = extract_capa_scan({"code": 124, "stdout": '{"rules":{}}', "stderr": "", "timedOut": True})
        self.assertEqual(timed_out, {"ok": False, "error": "capa did not finish in time", "seconds": 0.5, "rules": []})
        for stdout in ("no report", '{"rules":'):
            malformed, _ = extract_capa_scan({"code": 0, "stdout": stdout, "stderr": "", "timedOut": False})
            self.assertEqual(malformed, {"ok": False, "error": "capa printed no report", "seconds": 0.5, "rules": []})


if __name__ == "__main__":
    unittest.main()
