"""Static scan of a PowerShell script: prints {"hits": [{"id", "count", "preview"}]} (read only; the script is never run here)."""
import json
import re
import sys

MAX_BYTES = 1024 * 1024
PREVIEW = 120

PATTERNS = [
    ("base64-decode", r"FromBase64String"),
    ("encoded-command", r"(?<![\w-])-e(?:nc|ncodedcommand)?\s+[A-Za-z0-9+/=]{16,}"),
    ("hidden-window", r"-w(?:indowstyle)?\s+hidden"),
    ("execution-policy-bypass", r"-ex(?:ecutionpolicy)?\s+bypass"),
    ("invoke-expression", r"\b(?:Invoke-Expression|iex)\b"),
    ("char-join", r"(?:\[char\]\s*\d+\s*[,+]\s*){3,}|-join\s*\(?\s*\[char\[\]\]"),
    ("download-cradle", r"DownloadString|DownloadFile|Net\.WebClient|Invoke-WebRequest|Invoke-RestMethod|\biwr\b|Start-BitsTransfer"),
]


def decode(raw):
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw.decode("utf-16", "replace")
    return raw.decode("utf-8-sig", "replace")


def main():
    with open(sys.argv[1], "rb") as handle:
        raw = handle.read(MAX_BYTES + 1)
    truncated = len(raw) > MAX_BYTES
    text = decode(raw[:MAX_BYTES])
    hits = []
    for name, pattern in PATTERNS:
        found = list(re.finditer(pattern, text, re.IGNORECASE))
        if found:
            start = max(found[0].start() - 10, 0)
            hits.append({"id": name, "count": len(found), "preview": text[start:start + PREVIEW].replace("\n", " ")})
    print(json.dumps({"hits": hits, "truncated": truncated}, separators=(",", ":")))


main()
