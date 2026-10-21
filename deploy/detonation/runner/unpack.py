"""Unpacks a zip (7zz) or an email (python email) inside the container under the SPEC 5.3 caps, then lists the children.

Caps: at most --max-entries files, --max-bytes unpacked bytes, ratio <= 100:1 per entry. The first entry that breaks a cap stops
unpacking ("stopped" names the cap); the entries before it are kept. Each kept file becomes ~/Downloads/.unpacked/<item>/<n>.dat,
gzipped: neutral names keep archive entry names out of paths, and gzip keeps the file from looking like an executable or an
archive to the file diff (a PE, an ELF, a shebang script or a .zip added to the home volume reads as a second stage or a staged
archive). Each is listed with its original name, size and first bytes so the controller can type it. The depth cap (3) is the
controller's: it knows how deep each archive is.

identify.py and unwrap.py import this module for `store`, `destination` and `unpack_zip` (installers and self-extracting archives are read
with 7zz exactly like a zip).
"""
import base64
import email
import email.policy
import gzip
from itertools import islice
import os
import re
import shutil

from runnerlib import finish, open_regular, parse_args, run

MAX_RATIO = 100
MAX_ENTRIES = 50
MAX_LINKS = 50
MAX_BYTES = 50 * 1024 * 1024
HEAD_BYTES = 32 * 1024
NAME_CHARS = 200
PASSWORD = "infected"
SEVENZIP = "/usr/local/bin/7zz"
UNPACKED = "/home/dana/Downloads/.unpacked"


def destination():
    path = f"{UNPACKED}/{int(os.environ.get('JOB_ITEM', '0'))}"
    shutil.rmtree(path, ignore_errors=True)
    os.makedirs(path)
    return path


def store(dest, index, name, data):
    """Writes `data` as <index>.dat (gzip) and returns its listing: original name, size, first bytes."""
    path = os.path.join(dest, f"{index}.dat")
    with gzip.open(path, "wb", compresslevel=1) as handle:
        handle.write(data)
    return {"index": index, "name": name[:NAME_CHARS], "size": len(data), "path": path, "head": base64.b64encode(data[:HEAD_BYTES]).decode("ascii")}


def seven_zip_listing(path):
    """`7zz l -slt` blocks as dicts, or None when 7zz cannot read the archive."""
    done = run([SEVENZIP, "l", "-slt", "-ba", "-scsUTF-8", f"-p{PASSWORD}", path], 20)
    if done["code"] not in (0, 1):
        return None
    blocks = [dict(line.split(" = ", 1) for line in block.splitlines() if " = " in line) for block in done["stdout"].split("\n\n")]
    return [block for block in blocks if block.get("Path")]


def clamp_budgets(max_entries, max_bytes):
    return max(0, min(MAX_ENTRIES, max_entries)), max(0, min(MAX_BYTES, max_bytes))


def unpack_zip(path, dest, max_entries, max_bytes):
    max_entries, max_bytes = clamp_budgets(max_entries, max_bytes)
    if max_entries == 0 or max_bytes == 0:
        return {"format": "zip", "entries": [], "stopped": "entries" if max_entries == 0 else "bytes", "listed": 0}
    entries = seven_zip_listing(path)
    if entries is None:
        return {"format": "zip", "entries": [], "stopped": "error", "listed": 0}
    archive_size = max(os.path.getsize(path), 1)
    accepted, total, stopped = [], 0, None
    for entry in entries:
        mode = entry.get("Attributes", "").split(" ")[-1]
        if entry.get("Folder") == "+" or mode.startswith(("l", "d")):
            continue
        name = entry["Path"]
        parts = name.replace("\\", "/").split("/")
        if any(char in name for char in "\r\n\0") or name.startswith(("/", "\\")) or re.match(r"^[A-Za-z]:", name) or ".." in parts or name in {item[0] for item in accepted}:
            stopped = "error"
            break
        try:
            size, packed = int(entry.get("Size") or 0), int(entry.get("Packed Size") or 0)
        except ValueError:
            stopped = "error"
            break
        if size < 0 or packed < 0:
            stopped = "error"
            break
        if len(accepted) >= max_entries:
            stopped = "entries"
        elif total + size > max_bytes:
            stopped = "bytes"
        elif size > MAX_RATIO * (packed if packed else archive_size):
            stopped = "ratio"
        if stopped:
            break
        accepted.append((entry["Path"], size, entry.get("Encrypted") == "+"))
        total += size
    children = []
    if accepted:
        raw = os.path.join(dest, "raw")
        names = os.path.join(dest, "names.txt")
        with open(names, "w", encoding="utf-8") as handle:
            handle.write("\n".join(name for name, _, _ in accepted))
        extracted = run([SEVENZIP, "x", "-y", "-bd", "-aoa", "-spd", "-scsUTF-8", f"-p{PASSWORD}", f"-o{raw}", path, f"-i@{names}"], 25)
        if extracted["code"] != 0 or extracted["timedOut"]:
            stopped = stopped or "error"
        os.remove(names)
        stored_bytes = 0
        for name, size, encrypted in accepted:
            source = os.path.normpath(os.path.join(raw, name))
            if not os.path.realpath(source).startswith(raw + os.sep) or os.path.islink(source) or not os.path.isfile(source):
                stopped = stopped or ("encrypted" if encrypted else "error")
                break
            with open_regular(source) as handle:
                actual = os.fstat(handle.fileno()).st_size
                if actual != size:
                    stopped = stopped or "error"
                    break
                if stored_bytes + actual > max_bytes or len(children) >= max_entries:
                    stopped = stopped or "bytes"
                    break
                data = handle.read(min(size, max_bytes - stored_bytes) + 1)
            os.remove(source)
            if len(data) != size:
                stopped = stopped or "error"
                break
            if stored_bytes + len(data) > max_bytes:
                stopped = stopped or "bytes"
                break
            stored_bytes += len(data)
            children.append(store(dest, len(children), name, data))
        shutil.rmtree(raw, ignore_errors=True)
    return {"format": "zip", "entries": children, "stopped": stopped, "listed": len(entries)}


def link_pairs(part, limit=MAX_LINKS):
    """Return bounded (href, text) pairs; decode first so unknown charsets still stop traversal."""
    body = part.get_content()
    limit = max(0, limit)
    if part.get_content_type() == "text/html":
        matches = re.finditer(r"<a\s[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", body, re.I | re.S)
        return ((match.group(1), re.sub(r"<[^>]+>", "", match.group(2)).strip()) for match in islice(matches, limit))
    matches = re.finditer(r"https?://[^\s<>\"']+", body)
    return ((match.group(0), match.group(0)) for match in islice(matches, limit))


def bounded_attachment(part, remaining):
    # BytesParser keeps the undecoded transfer text here. get_payload(False) can decode its charset before the budget check.
    raw = part._payload
    if not isinstance(raw, str) or any(ord(char) > 127 and not 0xDC80 <= ord(char) <= 0xDCFF for char in raw):
        return None, "error"
    encoding = str(part.get("Content-Transfer-Encoding", "")).lower().strip()
    if encoding == "base64":
        count, tail = 0, ""
        for char in raw:
            if not char.isspace():
                count += 1
                tail = (tail + char)[-2:]
        bound = max(0, (count - tail.count("=")) * 3 // 4)
    elif encoding == "quoted-printable":
        bound, cursor = 0, 0
        while cursor < len(raw):
            if raw[cursor] == "=" and raw[cursor + 1:cursor + 3] == "\r\n":
                cursor += 3
                continue
            if raw[cursor] == "=" and raw[cursor + 1:cursor + 2] == "\n":
                cursor += 2
                continue
            cursor += 3 if raw[cursor] == "=" and re.fullmatch(r"[0-9a-fA-F]{2}", raw[cursor + 1:cursor + 3]) else 1
            bound += 1
            if bound > remaining:
                return None, "bytes"
    else:
        bound = len(raw)
    if bound > remaining:
        return None, "bytes"
    try:
        data = part.get_payload(decode=True) or b""
    except (ValueError, TypeError):
        return None, "error"
    if part.defects or not isinstance(data, bytes):
        return None, "error"
    return (data, None) if len(data) <= remaining else (None, "bytes")


def unpack_eml(path, dest, max_entries, max_bytes):
    max_entries, max_bytes = clamp_budgets(max_entries, max_bytes)
    if max_entries == 0 or max_bytes == 0:
        return {"format": "eml", "entries": [], "stopped": "entries" if max_entries == 0 else "bytes", "listed": 0}
    with open(path, "rb") as handle:
        message = email.message_from_binary_file(handle, policy=email.policy.default)
    children, links, total, stopped, seen = [], [], 0, None, 0
    for part in message.walk():
        if part.is_multipart():
            continue
        kind = part.get_content_type()
        if part.get_content_disposition() != "attachment" and kind in ("text/plain", "text/html") and not part.get_filename():
            try:
                links.extend(link_pairs(part, MAX_LINKS - len(links)))
            except LookupError:
                stopped = "error"
                break
            continue
        seen += 1
        if len(children) >= max_entries:
            stopped = "entries"
            break
        if total >= max_bytes:
            stopped = "bytes"
            break
        data, stopped = bounded_attachment(part, max_bytes - total)
        if stopped:
            break
        total += len(data)
        children.append(store(dest, len(children), part.get_filename() or f"part-{seen}", data))
    return {"format": "eml", "entries": children, "stopped": stopped, "listed": seen, "links": [{"href": href[:300], "text": text[:300]} for href, text in links[:50]]}


def main():
    args = parse_args(("ext", "max-entries", "max-bytes"))
    dest = destination()
    max_entries, max_bytes = clamp_budgets(int(args.max_entries or MAX_ENTRIES), int(args.max_bytes or MAX_BYTES))
    try:
        unpack = (unpack_eml if args.kind == "eml" else unpack_zip)(args.file, dest, max_entries, max_bytes)
    except (OSError, ValueError, TypeError):
        unpack = {"format": args.kind, "entries": [], "stopped": "error", "listed": 0}
    finish(args, unpack=unpack)


if __name__ == "__main__":
    main()
