"""pdfid and pdf-parser over a PDF (read only). Prints {"pdfid": {name: count}, "header", "parser": {...}, "errors": [...]}."""
import json
import re
import sys

sys.path.insert(0, "/opt/detonation")
from runnerlib import run, tail

TOOLS = "/opt/pdftools"
PDFID_LINE = re.compile(r"^\s+(/?[A-Za-z0-9_ ]+?)\s+(\d+)(?:\(\d+\))?\s*$")


def pdfid(path):
    done = run(["/opt/venv/bin/python", f"{TOOLS}/pdfid.py", path], 15)
    counts = {}
    header = ""
    for line in done["stdout"].splitlines():
        if line.startswith(" PDF Header:"):
            header = line.split(":", 1)[1].strip()[:16]
            continue
        match = PDFID_LINE.match(line)
        if match:
            counts[match.group(1).strip()] = int(match.group(2))
    return counts, header, None if done["code"] == 0 and counts else tail(done["stderr"]) or "pdfid produced no counts"


def parser_stats(path):
    done = run(["/opt/venv/bin/python", f"{TOOLS}/pdf-parser.py", "--stats", path], 15)
    types = {}
    for line in done["stdout"].splitlines():
        match = re.match(r"^\s*(/\w+)\s+(\d+)\s*(?:\(.*\))?$", line)
        if match:
            types[match.group(1)] = int(match.group(2))
    return types, None if done["code"] == 0 else tail(done["stderr"]) or "pdf-parser failed"


def main():
    path = sys.argv[1]
    counts, header, pdfid_error = pdfid(path)
    types, parser_error = parser_stats(path)
    errors = [error for error in (pdfid_error, parser_error) if error]
    print(json.dumps({"pdfid": counts, "header": header, "parser": types, "errors": errors}, separators=(",", ":")))


main()
