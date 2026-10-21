"""Unit tests for ps1_static.py's bounded reader without importing or running PowerShell."""
import ast
import contextlib
import io
import json
from pathlib import Path
import re
from types import SimpleNamespace
import unittest

STATIC_SOURCE = Path(__file__).resolve().parents[1] / "deploy" / "detonation" / "runner" / "ps1_static.py"
CONSTANTS = {"MAX_BYTES", "PREVIEW", "PATTERNS"}


def extract_main(data):
    source = STATIC_SOURCE.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(STATIC_SOURCE))
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in {"decode", "main"}]
    assignments = [
        node for node in tree.body
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id in CONSTANTS for target in node.targets)
    ]
    constants = {}
    exec(compile(ast.Module(body=assignments, type_ignores=[]), str(STATIC_SOURCE), "exec"), constants)
    reads = []

    class ReadSpy(io.BytesIO):
        def read(self, size=-1):
            reads.append(size)
            return super().read(size)

    def fake_open(path, mode):
        if path != "fixture.ps1" or mode != "rb":
            raise AssertionError("unexpected file read")
        return ReadSpy(data)

    namespace = {"json": json, "re": re, "sys": SimpleNamespace(argv=["ps1_static.py", "fixture.ps1"]), "open": fake_open}
    namespace.update({name: constants[name] for name in CONSTANTS})
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(STATIC_SOURCE), "exec"), namespace)
    stdout = io.StringIO()
    with contextlib.redirect_stdout(stdout):
        namespace["main"]()
    return json.loads(stdout.getvalue()), reads, namespace["MAX_BYTES"]


class PowerShellStaticTests(unittest.TestCase):
    def test_reads_one_sentinel_byte_and_reports_boundary_truncation(self):
        for length, truncated in ((1024 * 1024 - 1, False), (1024 * 1024, False), (1024 * 1024 + 1, True)):
            with self.subTest(length=length):
                report, reads, max_bytes = extract_main(b" " * length)
                self.assertEqual(max_bytes, 1024 * 1024)
                self.assertEqual(reads, [max_bytes + 1])
                self.assertEqual(report, {"hits": [], "truncated": truncated})

    def test_truncated_file_keeps_prefix_hits_and_does_not_scan_across_the_boundary(self):
        _, _, max_bytes = extract_main(b"")
        prefix_hit = b"FromBase64String"
        suffix_pattern = b"DownloadStrin"
        data = prefix_hit + b" " * (max_bytes - len(prefix_hit) - len(suffix_pattern)) + suffix_pattern + b"g"
        self.assertEqual(len(data), max_bytes + 1)
        report, reads, _ = extract_main(data)
        self.assertTrue(report["truncated"])
        self.assertEqual([hit["id"] for hit in report["hits"]], ["base64-decode"])
        self.assertEqual(reads, [max_bytes + 1])


if __name__ == "__main__":
    unittest.main()
