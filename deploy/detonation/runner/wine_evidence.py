"""Evidence helpers of the Wine step (docs/SPEC.md 6.6 "Run under Wine"; mapped in backend/detonation/wine.mjs). Standard library only.

Registry diff of the prefix's registry files, file diff of the prefix drive, the WINEDEBUG log digest and the Xvfb screenshots. Everything
here reads data that the analysed program could influence, so every list is capped and every string is cut.
"""
import hashlib
import math
import os
import re
import struct
import zlib

TEXT = 300
MAX_REGISTRY_ITEMS = 100
MAX_FILE_ITEMS = 100
HASHED_FILE_BYTES = 256 * 1024

# --- registry diff ---------------------------------------------------------------------------------------------------------------------

KEY_HEADER = re.compile(r"^\[(.*)\] \d+$")
QUOTED_NAME = re.compile(r'^"((?:[^"\\]|\\.)*)"=(.*)$')
HIVES = {"user.reg": "HKCU", "system.reg": "HKLM", "userdef.reg": "HKU"}
CONTROL_SET = re.compile(r"^System\\ControlSet00\d", re.I)
# Sections Wine rewrites on every start (computer name from the container's host name, device enumeration, volatile environment, fonts
# cache): not the program's doing. Measured with a clean start of the prefix: only these differ besides timestamps.
NOISE = re.compile(
    r"^(System\\ControlSet00\d\\(Control\\(ComputerName|DeviceClasses|Video)|Enum)(\\|$)|Volatile Environment$|"
    r"Software\\Wine\\(Fonts|Network|Drives)(\\|$)|Software\\Microsoft\\Windows NT\\CurrentVersion(\\NetworkCards)?$)", re.I)


def parse_reg(path):
    """{key: {value name: raw data}} of a Wine registry file. Timestamps and `#` attribute lines are dropped."""
    keys = {}
    current = None
    pending = ""
    with open(path, encoding="utf-8", errors="replace") as handle:
        for raw in handle:
            line = pending + raw.rstrip("\n").lstrip() if pending else raw.rstrip("\n")
            pending = ""
            if line.endswith("\\") and not line.startswith("["):
                pending = line[:-1]
                continue
            header = KEY_HEADER.match(line)
            if header:
                current = keys.setdefault(header.group(1).replace("\\\\", "\\"), {})
                continue
            if current is None or not line or line[0] in "#;":
                continue
            if line.startswith("@="):
                current["@"] = line[2:]
                continue
            named = QUOTED_NAME.match(line)
            if named:
                current[named.group(1)] = named.group(2)
    return keys


def display_data(raw):
    """The text of a registry value: a string without its quotes, anything else as written (dword:…, hex:…)."""
    if raw.startswith('"') and raw.endswith('"') and len(raw) >= 2:
        return raw[1:-1].replace("\\\\", "\\")[:TEXT]
    return raw[:TEXT]


def diff_reg(before, after, hive):
    """EVIDENCE.md `registry` items (kind, hive, key, value, data) for what changed between two parsed registry files."""
    items = []

    def add(kind, key, value, data=""):
        if len(items) < MAX_REGISTRY_ITEMS:
            shown = CONTROL_SET.sub("System\\\\CurrentControlSet", key)
            items.append({"kind": kind, "hive": hive, "key": shown[:TEXT], "value": "" if value == "@" else value[:120], "data": display_data(data)})

    for key, values in after.items():
        if NOISE.search(key):
            continue
        old = before.get(key)
        if old is None:
            if not values:
                add("key-added", key, "")
            for name, data in values.items():
                add("key-added", key, name, data)
            continue
        for name, data in values.items():
            if name not in old:
                add("key-added", key, name, data)
            elif old[name] != data:
                add("key-changed", key, name, data)
        for name in old:
            if name not in values:
                add("key-deleted", key, name)
    for key in before:
        if key not in after and not NOISE.search(key):
            add("key-deleted", key, "")
    return items


def registry_diff(seed_dir, prefix):
    items = []
    for name, hive in HIVES.items():
        seed, now = os.path.join(seed_dir, name), os.path.join(prefix, name)
        if os.path.exists(seed) and os.path.exists(now):
            items.extend(diff_reg(parse_reg(seed), parse_reg(now), hive))
    return items[:MAX_REGISTRY_ITEMS]


# --- file diff of the prefix drive ----------------------------------------------------------------------------------------------------

# Directories Wine keeps current itself while it runs; and the shell-folder links, whose targets are the home volume (the collector
# diffs that volume, so a file the program writes to Documents is reported there and not twice).
TREE_NOISE = re.compile(r"^(windows/(temp|logs|inf)(/|$)|windows/system32/(config|spool|drivers/etc)(/|$)|users/dana/(AppData/Local/(fontconfig|Microsoft)|Local Settings|Application Data/Microsoft)(/|$))", re.I)


def tree_snapshot(root):
    """{relative path: (kind, size, digest)} of every file and symlink under `root`; symlinks are recorded, never followed."""
    snapshot = {}
    for directory, directories, names in os.walk(root, followlinks=False):
        for name in names + [d for d in directories if os.path.islink(os.path.join(directory, d))]:
            full = os.path.join(directory, name)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            if TREE_NOISE.search(rel):
                continue
            try:
                if os.path.islink(full):
                    snapshot[rel] = ("link", 0, os.readlink(full))
                    continue
                size = os.path.getsize(full)
                digest = ""
                if size <= HASHED_FILE_BYTES:
                    with open(full, "rb") as handle:
                        digest = hashlib.sha1(handle.read()).hexdigest()
                else:
                    digest = str(os.stat(full).st_mtime_ns)
                snapshot[rel] = ("file", size, digest)
            except OSError:
                continue
    return snapshot


def entropy_of(data):
    if not data:
        return 0.0
    counts = [0] * 256
    for byte in data:
        counts[byte] += 1
    return round(-sum(n / len(data) * math.log2(n / len(data)) for n in counts if n), 4) + 0.0


def windows_path(rel):
    return "C:\\" + rel.replace("/", "\\")


def tree_diff(before, after, root):
    """`added`/`changed`/`deleted` items for the prefix drive (`path` is the Windows path). An added file records size, entropy and
    whether it starts like a program (second-stage rule)."""
    items = []
    for rel in sorted(after):
        kind = "added" if rel not in before else "changed" if before[rel] != after[rel] else None
        if kind is None or len(items) >= MAX_FILE_ITEMS:
            continue
        item = {"kind": kind, "path": windows_path(rel)[:400], "sizeAfter": after[rel][1], "entropyAfter": None, "executable": False}
        if after[rel][0] == "file":
            try:
                with open(os.path.join(root, rel), "rb") as handle:
                    head = handle.read(4096)
                item["entropyAfter"] = entropy_of(head)
                item["executable"] = head[:2] == b"MZ" or head[:4] == b"\x7fELF"
            except OSError:
                pass
        items.append(item)
    for rel in sorted(before):
        if rel not in after and len(items) < MAX_FILE_ITEMS:
            items.append({"kind": "deleted", "path": windows_path(rel)[:400], "sizeAfter": None, "entropyAfter": None, "executable": False})
    return items


# --- WINEDEBUG log digest -------------------------------------------------------------------------------------------------------------

LOG_LINE = re.compile(r"^([0-9a-f]{4}):([0-9a-f]{4}):(.*)$")
LOADED = re.compile(r'trace:loaddll:\w+ Loaded L"((?:[^"\\]|\\.)*)" at ([0-9A-Fa-f]+): (\w+)')
CREATED = re.compile(r'trace:process:NtCreateUserProcess L"(?:[^"\\]|\\.)*" image L"((?:[^"\\]|\\.)*)" cmdline L"((?:[^"\\]|\\.)*)"')
RELAY_CALL = re.compile(r"^Call (\w+)\.(\w+)\((.*)\) ret=([0-9A-Fa-f]+)$")
QUOTED_ARG = re.compile(r'(?:L)?"((?:[^"\\]|\\.)*)"')
HIVE_HANDLES = {"80000000": "HKCR", "80000001": "HKCU", "80000002": "HKLM", "80000003": "HKU"}
GET_PROC = ("getprocaddress", "ldrgetprocedureaddress")
REGISTRY_OPEN = ("regopenkeyexa", "regopenkeyexw", "regopenkeya", "regopenkeyw")
# The Wine marker lookups this step reports; the registry key is the one the rule engine names.
WINE_KEY = re.compile(r"^Software\\Wine(\\|$)", re.I)
WINE_EXPORT = re.compile(r"^wine_[a-z_]+$")
SYSTEM_DLL_DIR = re.compile(r"^C:\\windows\\(system32|syswow64)\\", re.I)
SKIP_NOISE = ("load_list", "PE DLL", "TLS callback", "Starting thread")
WINE_ERROR = re.compile(r"(wine: (Unhandled|failed to start|could not|cannot find)|err:module:(import_dll|LdrInitializeThunk|load_so_dll)|to unimplemented function)")


def unescape(text):
    return re.sub(r"\\(.)", lambda match: {"n": "\n", "t": "\t"}.get(match.group(1), match.group(1)), text)


def split_command(command):
    """Windows command line to argv: double quotes group, no other escapes (enough for a `CreateProcess` command line)."""
    return [first or second for first, second in re.findall(r'"([^"]*)"|(\S+)', command)][:32]


class LogDigest:
    """Reads the WINEDEBUG (+pid,+loaddll,+process,+relay) stream line by line; keeps at most `cap` bytes and the facts mapped to evidence."""

    def __init__(self, cap):
        self.cap = cap
        self.bytes = 0
        self.dropped = 0
        self.modules = {}  # pid -> [(base, native?)]
        self.dlls = []
        self.processes = []
        self.calls = []
        self.errors = []

    def feed(self, line):
        if any(marker in line for marker in SKIP_NOISE):
            return
        if self.bytes + len(line) > self.cap:
            self.dropped += 1
            return
        self.bytes += len(line) + 1
        split = LOG_LINE.match(line)
        if not split:
            if WINE_ERROR.search(line) and len(self.errors) < 10:
                self.errors.append(line[:TEXT])
            return
        pid, _, rest = split.groups()
        if WINE_ERROR.search(rest) and len(self.errors) < 10:
            self.errors.append(rest[:TEXT])
        loaded = LOADED.search(rest)
        if loaded:
            path, base, kind = unescape(loaded.group(1)), int(loaded.group(2), 16), loaded.group(3)
            self.modules.setdefault(pid, []).append((base, kind == "native"))
            if len(self.dlls) < 60:
                self.dlls.append({"path": path[:400], "native": kind == "native", "builtin": kind == "builtin"})
            return
        created = CREATED.search(rest)
        if created and len(self.processes) < 40:
            self.processes.append({"path": unescape(created.group(1))[:400], "argv": [part[:TEXT] for part in split_command(unescape(created.group(2)))]})
            return
        call = RELAY_CALL.match(rest)
        if call and len(self.calls) < 200:
            module, name, arguments, ret = call.groups()
            if self.from_native(pid, int(ret, 16)):
                self.calls.append(self.describe_call(module, name, arguments))

    def from_native(self, pid, ret):
        """True when the return address lies inside a module that Wine loaded as native (the program's own code), not a Wine builtin."""
        natives = sorted(base for base, native in self.modules.get(pid, []) if native)
        return any(base <= ret < base + 0x4000000 for base in natives)

    @staticmethod
    def describe_call(module, name, arguments):
        parts = [part.strip() for part in arguments.split(",", 2)]
        text = QUOTED_ARG.search(arguments)
        argument = unescape(text.group(1))[:TEXT] if text else ""
        handle = parts[0].lower().lstrip("0")[-8:] if parts and parts[0] else ""
        return {"module": module.lower(), "api": name, "arg": argument, "hive": HIVE_HANDLES.get(handle, "")}

    def digest(self):
        reads, markers = [], []
        for call in self.calls:
            api = call["api"].lower()
            if api in REGISTRY_OPEN and WINE_KEY.match(call["arg"]):
                reads.append({"hive": call["hive"] or "HKCU", "key": call["arg"]})
            elif api in GET_PROC and WINE_EXPORT.match(call["arg"]):
                markers.append(call["arg"])
        natives = [d for d in self.dlls if d["native"]]
        hijacks = [{"dll": os.path.basename(d["path"].replace("\\", "/")), "path": d["path"]} for d in natives
                   if d["path"].lower().endswith(".dll") and not SYSTEM_DLL_DIR.match(d["path"])]
        return {
            "processes": self.processes, "dlls": natives[:30], "dllCount": len(self.dlls), "registryReads": reads[:20], "wineExports": markers[:20],
            "dllCandidates": hijacks[:20], "errors": self.errors, "logBytes": self.bytes, "logDropped": self.dropped,
        }


# --- screenshots ----------------------------------------------------------------------------------------------------------------------

def png_chunk(kind, data):
    body = kind + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def xwd_to_png(xwd):
    """PNG bytes of an XWD framebuffer (what `Xvfb -fbdir` keeps up to date), or None when it is not a 24/32-bit TrueColor screen."""
    if len(xwd) < 100:
        return None
    fields = struct.unpack(">25I", xwd[:100])
    header, version, _, depth, width, height = fields[0], fields[1], fields[2], fields[3], fields[4], fields[5]
    byte_order, bits_per_pixel, bytes_per_line = fields[7], fields[11], fields[12]
    red, green, blue, ncolors = fields[14], fields[15], fields[16], fields[19]
    if version != 7 or bits_per_pixel != 32 or depth not in (24, 32) or (red, green, blue) != (0xFF0000, 0xFF00, 0xFF):
        return None
    start = header + ncolors * 12
    rows = xwd[start:start + bytes_per_line * height]
    if len(rows) < bytes_per_line * height or not (0 < width <= 4096 and 0 < height <= 4096):
        return None
    scan = bytearray()
    for y in range(height):
        row = rows[y * bytes_per_line:y * bytes_per_line + width * 4]
        rgb = bytearray(width * 3)
        # little-endian BGRX when byte_order is 0, XRGB when it is 1
        order = (2, 1, 0) if byte_order == 0 else (1, 2, 3)
        rgb[0::3], rgb[1::3], rgb[2::3] = row[order[0]::4], row[order[1]::4], row[order[2]::4]
        scan += b"\x00" + rgb
    return b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + png_chunk(b"IDAT", zlib.compress(bytes(scan), 6)) + png_chunk(b"IEND", b"")


def screenshot(framebuffer):
    try:
        with open(framebuffer, "rb") as handle:
            return xwd_to_png(handle.read())
    except OSError:
        return None
