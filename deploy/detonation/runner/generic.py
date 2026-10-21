"""Generic last resort for any file (SPEC 6.6 "Generic"): strings, entropy, embedded-file carving with binwalk, headers for ELF and Mach-O,
and YARA. Nothing here runs the file. The controller adds the model-written parser loop for a format nobody knows (analysis-loop.mjs).

Prints {"generic": {...}}; mapped by backend/detonation/static.mjs `mapGeneric`. The first 4 KB are returned (base64) as the parser loop's hex dump.
"""
import base64
import collections
import json
import math
import os
import re

import identify
import static
from runnerlib import finish, parse_args, run

BINWALK = "/usr/local/bin/binwalk"
SCAN_BYTES = 8 * 1024 * 1024
BLOCK = 64 * 1024
MIN_STRING = 6
MAX_STRINGS = 40
TEXT = 160
ASCII_RE = re.compile(rb"[\x20-\x7e]{%d,}" % MIN_STRING)
UTF16_RE = re.compile(rb"(?:[\x20-\x7e]\x00){%d,}" % MIN_STRING)
URL = re.compile(r"https?://[^\s\"'<>]{4,120}", re.I)
ADDRESS = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
RUN_KEY = re.compile(r"CurrentVersion\\Run", re.I)
COMMAND = re.compile(r"\b(powershell|cmd\.exe|wscript|cscript|mshta|rundll32|regsvr32|schtasks|certutil|bitsadmin)\b", re.I)
EMBEDDED_EXECUTABLE = re.compile(r"\b(PE32|PE32\+|ELF|Mach-O|MS-DOS executable|Windows executable|executable)\b", re.I)
EMBEDDED_ARCHIVE = re.compile(r"\b(Zip archive|7-zip|RAR archive|gzip|bzip2|xz compressed|LZMA|cabinet|Microsoft Cabinet|ISO 9660|tar archive)\b", re.I)


def block_entropy(data):
    if not data:
        return 0.0
    total = len(data)
    return -sum(count / total * math.log2(count / total) for count in collections.Counter(data).values())


def strings_of(data):
    """ASCII and UTF-16LE strings: counts, a few interesting ones (URLs, addresses, Run keys, shell tools) and the first plain ones."""
    ascii_found = [match.group().decode("ascii") for match in ASCII_RE.finditer(data)]
    wide = [match.group().decode("utf-16le") for match in UTF16_RE.finditer(data)]
    every = ascii_found + wide
    interesting = []
    for line in every:
        if URL.search(line) or ADDRESS.search(line) or RUN_KEY.search(line) or COMMAND.search(line):
            interesting.append(line[:TEXT])
        if len(interesting) >= MAX_STRINGS:
            break
    return {
        "ascii": len(ascii_found), "utf16": len(wide), "interesting": interesting,
        "urls": sorted({match.group()[:120] for line in every[:5000] for match in URL.finditer(line)})[:10],
        "sample": [line[:TEXT] for line in ascii_found[:10]],
    }


def entropy_profile(data):
    """Whole-file entropy, and the highest and mean entropy of 64 KB blocks (a flat, high profile is compressed or encrypted data)."""
    blocks = [block_entropy(data[start:start + BLOCK]) for start in range(0, min(len(data), SCAN_BYTES), BLOCK)] or [0.0]
    return {"overall": round(block_entropy(data[:SCAN_BYTES]), 3), "max": round(max(blocks), 3), "mean": round(sum(blocks) / len(blocks), 3), "blocks": len(blocks)}


def carve(path):
    """What binwalk (v3) finds inside the file: `[{offset, description}]`, read from its JSON log. Only scans; extraction would write files."""
    log = "/tmp/dt/binwalk.json"
    done = run([BINWALK, "--quiet", "--log", log, path], 20)
    found = []
    try:
        with open(log, encoding="utf-8") as handle:
            for analysis in json.load(handle):
                for entry in (analysis.get("Analysis") or {}).get("file_map") or []:
                    found.append({"offset": int(entry.get("offset", 0)), "description": str(entry.get("description", ""))[:TEXT]})
    except (OSError, ValueError, AttributeError):
        pass
    return {"ok": done["code"] == 0, "found": found[:30], "executables": sum(1 for item in found if item["offset"] > 0 and EMBEDDED_EXECUTABLE.search(item["description"])),
            "archives": sum(1 for item in found if item["offset"] > 0 and EMBEDDED_ARCHIVE.search(item["description"]))}


def main():
    args = parse_args(("ext",))
    with open(args.file, "rb") as handle:
        data = handle.read(SCAN_BYTES)
    headers = None
    try:
        headers = identify.lief_facts(args.file) if data[:4] in (b"\x7fELF", b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xca\xfe\xba\xbe") else None
    except Exception:
        headers = None
    report = {
        "size": os.path.getsize(args.file), "head": base64.b64encode(data[:4096]).decode("ascii"), "entropy": entropy_profile(data), "strings": strings_of(data),
        "binwalk": carve(args.file), "headers": headers, "yara": static.yara_scan(args.file, (headers or {}).get("format", "")),
    }
    finish(args, generic=report)


if __name__ == "__main__":
    main()
