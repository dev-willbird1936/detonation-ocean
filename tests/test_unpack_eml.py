"""In-memory tests for unpack.py's EML parsing without importing its runner module."""
import ast
import email
import email.policy
import io
from itertools import islice
from pathlib import Path
import re
from types import SimpleNamespace
import unittest

UNPACK_SOURCE = Path(__file__).resolve().parents[1] / "deploy" / "detonation" / "runner" / "unpack.py"
FUNCTIONS = {"link_pairs", "bounded_attachment", "unpack_eml"}
BOUNDARY = "test-boundary"


def extract_unpack_eml(raw, regex_module=re, max_links=50):
    source = UNPACK_SOURCE.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(UNPACK_SOURCE))
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in FUNCTIONS]
    stored = []

    def fake_open(path, mode):
        if path != "fixture.eml" or mode != "rb":
            raise AssertionError("unexpected file read")
        return io.BytesIO(raw)

    def store(dest, index, name, data):
        child = {"dest": dest, "index": index, "name": name, "data": data}
        stored.append(child)
        return child

    namespace = {
        "email": email,
        "re": regex_module,
        "islice": islice,
        "MAX_LINKS": max_links,
        "open": fake_open,
        "clamp_budgets": lambda entries, byte_count: (entries, byte_count),
        "store": store,
    }
    module = ast.Module(body=functions, type_ignores=[])
    exec(compile(module, str(UNPACK_SOURCE), "exec"), namespace)
    result = namespace["unpack_eml"]("fixture.eml", "unused-destination", 10, 4096)
    return result, stored


def mime_message(parts):
    header = f'MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="{BOUNDARY}"\r\n\r\n'
    body = "".join(f"--{BOUNDARY}\r\n{part}\r\n" for part in parts)
    return (header + body + f"--{BOUNDARY}--\r\n").encode("ascii")


class UnpackEmailTests(unittest.TestCase):
    def test_unknown_charset_stops_after_preserving_prior_links_and_attachment(self):
        raw = mime_message([
            "Content-Type: text/plain; charset=utf-8\r\n\r\nhttps://before.example.invalid/",
            'Content-Type: application/octet-stream; name="before.bin"\r\nContent-Disposition: attachment; filename="before.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\nU0FGRQ==',
            "Content-Type: text/plain; charset=x-no-such-charset-123\r\n\r\nhttps://bad.example.invalid/",
            'Content-Type: application/octet-stream; name="after.bin"\r\nContent-Disposition: attachment; filename="after.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\nTEFURVI=',
        ])
        result, stored = extract_unpack_eml(raw)
        self.assertEqual(result["stopped"], "error")
        self.assertEqual([child["name"] for child in result["entries"]], ["before.bin"])
        self.assertEqual([child["data"] for child in stored], [b"SAFE"])
        self.assertEqual(result["links"], [{"href": "https://before.example.invalid/", "text": "https://before.example.invalid/"}])

    def test_valid_utf8_links_and_attachments_remain_unchanged(self):
        raw = mime_message([
            "Content-Type: text/plain; charset=utf-8\r\n\r\nVisit https://valid.example.invalid/path",
            'Content-Type: application/octet-stream; name="note.txt"\r\nContent-Disposition: attachment; filename="note.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\nbm90ZXM=',
        ])
        result, stored = extract_unpack_eml(raw)
        self.assertIsNone(result["stopped"])
        self.assertEqual(result["links"], [{"href": "https://valid.example.invalid/path", "text": "https://valid.example.invalid/path"}])
        self.assertEqual([child["name"] for child in result["entries"]], ["note.txt"])
        self.assertEqual([child["data"] for child in stored], [b"notes"])


    def test_single_text_part_collects_only_the_first_50_links(self):
        urls = [f"https://example.invalid/{index}" for index in range(51)]
        raw = mime_message([f"Content-Type: text/plain; charset=utf-8\r\n\r\n{' '.join(urls)}"])
        result, _ = extract_unpack_eml(raw)
        expected = [{"href": url, "text": url} for url in urls[:50]]
        self.assertEqual(result["links"], expected)
        self.assertIsNone(result["stopped"])

    def test_global_link_cap_preserves_order_across_parts_and_keeps_later_attachment(self):
        first = [f"https://first.example.invalid/{index}" for index in range(30)]
        second = [f"https://second.example.invalid/{index}" for index in range(30)]
        raw = mime_message([
            f"Content-Type: text/plain; charset=utf-8\r\n\r\n{' '.join(first)}",
            f"Content-Type: text/plain; charset=utf-8\r\n\r\n{' '.join(second)}",
            'Content-Type: application/octet-stream; name="note.txt"\r\nContent-Disposition: attachment; filename="note.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\nbm90ZXM=',
        ])
        result, stored = extract_unpack_eml(raw)
        expected = [{"href": url, "text": url} for url in first + second[:20]]
        self.assertEqual(result["links"], expected)
        self.assertEqual([child["name"] for child in result["entries"]], ["note.txt"])
        self.assertEqual([child["data"] for child in stored], [b"notes"])
        self.assertIsNone(result["stopped"])

    def test_unknown_charset_after_link_cap_still_stops_and_preserves_prior_data(self):
        urls = [f"https://example.invalid/{index}" for index in range(50)]
        raw = mime_message([
            f"Content-Type: text/plain; charset=utf-8\r\n\r\n{' '.join(urls)}",
            'Content-Type: application/octet-stream; name="before.bin"\r\nContent-Disposition: attachment; filename="before.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\nU0FGRQ==',
            "Content-Type: text/plain; charset=x-no-such-charset-456\r\n\r\nhttps://bad.example.invalid/",
            'Content-Type: application/octet-stream; name="after.bin"\r\nContent-Disposition: attachment; filename="after.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\nTEFURVI=',
        ])
        result, stored = extract_unpack_eml(raw)
        self.assertEqual(result["stopped"], "error")
        self.assertEqual(result["links"], [{"href": url, "text": url} for url in urls])
        self.assertEqual([child["name"] for child in result["entries"]], ["before.bin"])
        self.assertEqual([child["data"] for child in stored], [b"SAFE"])

    def test_html_links_keep_visible_text_order_and_remaining_limit(self):
        raw = mime_message([
            'Content-Type: text/html; charset=utf-8\r\n\r\n<a href="https://first.example.invalid/">First</a><a href=\'https://second.example.invalid/\'>Second <b>link</b></a><a href="https://third.example.invalid/">Third</a>',
            'Content-Type: application/octet-stream; name="note.txt"\r\nContent-Disposition: attachment; filename="note.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\nbm90ZXM=',
        ])
        result, stored = extract_unpack_eml(raw, max_links=2)
        self.assertEqual(result["links"], [
            {"href": "https://first.example.invalid/", "text": "First"},
            {"href": "https://second.example.invalid/", "text": "Second link"},
        ])
        self.assertEqual([child["name"] for child in result["entries"]], ["note.txt"])
        self.assertEqual([child["data"] for child in stored], [b"notes"])

    def test_link_iterator_does_not_advance_past_the_remaining_allowance(self):
        seen = []

        def finditer(pattern, body):
            for url in ("https://one.example.invalid/", "https://two.example.invalid/"):
                seen.append(url)
                yield SimpleNamespace(group=lambda _index, value=url: value)
            raise AssertionError("link iterator advanced beyond the allowance")

        raw = mime_message(["Content-Type: text/plain; charset=utf-8\r\n\r\nplaceholder"])
        result, _ = extract_unpack_eml(raw, SimpleNamespace(finditer=finditer), max_links=2)
        self.assertEqual(result["links"], [{"href": url, "text": url} for url in seen])
        self.assertEqual(len(seen), 2)


if __name__ == "__main__":
    unittest.main()
