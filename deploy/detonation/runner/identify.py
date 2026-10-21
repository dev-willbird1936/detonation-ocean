"""Identify, then unwrap (SPEC 6.6 "Identify", "Unwrap") a Windows PE (ELF and Mach-O get their headers only).

Reads the headers, imports, sections, resources and entropy with pefile (LIEF for ELF and Mach-O, and as the fallback when pefile cannot
read a PE), names the packer, installer or framework from section names and byte markers, and checks the Authenticode signature with
osslsigncode. When the file is a UPX, Inno Setup, NSIS, self-extracting, PyInstaller or Electron wrapper, it is unwrapped in the same
container (unwrap.py) and its parts are listed for the controller as children. A .NET assembly gets its metadata read with dnfile
(static only; it is not run).

Prints {"identify": {...}, "unwrap": {...} | null, "dotnet": {...} | null}; mapped by backend/detonation/identify.mjs and unwrap.mjs.
The file is parsed, never executed.
"""
import collections
import math
import os
import re

import dnfile
import lief
import pefile

import unwrap
import unpack
from runnerlib import finish, parse_args, run, tail

TEXT = 200
MAX_SECTIONS = 40
MAX_IMPORT_DLLS = 40
MAX_IMPORT_NAMES = 300
ENTROPY_SAMPLE = 4 * 1024 * 1024
SECTION_SAMPLE = 1024 * 1024
MAX_READ = 128 * 1024 * 1024
OSSLSIGNCODE = "osslsigncode"

PACKER_SECTIONS = {
    "upx0": "UPX", "upx1": "UPX", "upx2": "UPX", "upx!": "UPX", ".aspack": "ASPack", ".adata": "ASPack", ".petite": "Petite", ".mpress1": "MPRESS",
    ".mpress2": "MPRESS", ".themida": "Themida", ".vmp0": "VMProtect", ".vmp1": "VMProtect", ".vmp2": "VMProtect", ".enigma1": "Enigma",
    ".enigma2": "Enigma", ".nsp0": "NsPack", ".nsp1": "NsPack", ".packed": "generic packer", ".perplex": "Perplex",
}
MACHINES = {0x14C: "x86", 0x8664: "x64", 0x1C0: "arm", 0xAA64: "arm64", 0x200: "ia64"}
SUBSYSTEMS = {1: "native", 2: "gui", 3: "console", 5: "os2", 7: "posix", 9: "wince", 10: "efi", 14: "xbox"}
DOTNET_DIRECTORY = 14
OVERLAY_ARCHIVES = ((b"7z\xbc\xaf\x27\x1c", "7z"), (b"Rar!\x1a\x07", "RAR"), (b"PK\x03\x04", "ZIP"))
# Byte markers of installers and frameworks; searched in the whole file (<= 128 MB).
INNO_MARKER = b"Inno Setup Setup Data"
NSIS_MARKERS = (b"NullsoftInst", b"Nullsoft Install System")
PYINSTALLER_COOKIE = b"MEI\x0c\x0b\x0a\x0b\x0e"
ELECTRON_MARKERS = (b"ELECTRON_RUN_AS_NODE", b"Electron Framework", b"app.asar")
# Wrappers whose parts are analysed as children, in the order the markers are trusted.
UNWRAPPABLE = {"upx": "upx", "inno": "inno", "nsis": "nsis", "sfx": "sfx", "pyinstaller": "pyinstaller"}
SUSPICIOUS_PINVOKE = re.compile(r"^(VirtualAlloc(Ex)?|VirtualProtect(Ex)?|WriteProcessMemory|ReadProcessMemory|CreateRemoteThread|NtUnmapViewOfSection|SetWindowsHookEx[AW]?|GetAsyncKeyState|URLDownloadToFile[AW]?|WinExec|ShellExecute[AW]?|LoadLibrary[AW]?|GetProcAddress|IsDebuggerPresent|CheckRemoteDebuggerPresent|AdjustTokenPrivileges)$")


def text(value, size=TEXT):
    return value if isinstance(value, str) and len(value) <= size else str(value)[:size]


def entropy_of(data):
    if not data:
        return 0.0
    total = len(data)
    return round(-sum(count / total * math.log2(count / total) for count in collections.Counter(data).values()), 3) + 0.0


def signature_status(path):
    """Authenticode through osslsigncode: no signature is `unsigned`; one that does not verify against the system roots is `invalid`."""
    done = run([OSSLSIGNCODE, "verify", path], 15)
    output = done["stdout"] + done["stderr"]
    if done["timedOut"] or done["code"] == 127:
        return {"status": "error", "detail": "The signature check did not run."}
    if "No signature found" in output:
        return {"status": "unsigned", "detail": "No Authenticode signature."}
    if "Signature verification: ok" in output:
        if done["code"] == 0:
            return {"status": "valid", "detail": "The Authenticode signature verifies."}
        return {"status": "invalid", "detail": f"The signature checker exited with code {done['code']}."}
    return {"status": "invalid", "detail": text(tail(output) or "The signature does not verify.", 200)}


def pe_facts(path, data):
    """Header, section, import, export and resource facts of a PE from pefile; raises on a file pefile cannot read."""
    pe = pefile.PE(data=data)
    try:
        sections = []
        for section in pe.sections[:MAX_SECTIONS]:
            name = section.Name.rstrip(b"\x00").decode("latin1")
            chunk = section.get_data()[:SECTION_SAMPLE]
            flags = section.Characteristics
            sections.append({
                "name": text(name, 16), "virtualSize": int(section.Misc_VirtualSize), "rawSize": int(section.SizeOfRawData), "entropy": entropy_of(chunk),
                "executable": bool(flags & 0x20000000), "writable": bool(flags & 0x80000000),
            })
        dlls, names = [], []
        for entry in getattr(pe, "DIRECTORY_ENTRY_IMPORT", []):
            dlls.append(entry.dll.decode("latin1").lower())
            names.extend(imp.name.decode("latin1") for imp in entry.imports if imp.name)
        exports = [symbol.name.decode("latin1") for symbol in getattr(getattr(pe, "DIRECTORY_ENTRY_EXPORT", None), "symbols", []) if symbol.name][:20]
        resource_types = []
        for entry in getattr(getattr(pe, "DIRECTORY_ENTRY_RESOURCE", None), "entries", []):
            resource_types.append(pefile.RESOURCE_TYPE.get(entry.id, str(entry.id)))
        optional = pe.OPTIONAL_HEADER
        entry_rva = int(optional.AddressOfEntryPoint)
        entry_section = next((s["name"] for s, raw in zip(sections, pe.sections) if raw.contains_rva(entry_rva)), "")
        overlay_start = pe.get_overlay_data_start_offset()
        directories = optional.DATA_DIRECTORY
        facts = {
            "format": "pe", "parser": "pefile", "arch": MACHINES.get(pe.FILE_HEADER.Machine, hex(pe.FILE_HEADER.Machine)),
            "subsystem": SUBSYSTEMS.get(optional.Subsystem, str(optional.Subsystem)), "isDll": bool(pe.FILE_HEADER.Characteristics & 0x2000),
            "dotnet": len(directories) > DOTNET_DIRECTORY and directories[DOTNET_DIRECTORY].VirtualAddress != 0,
            "entryPoint": entry_rva, "entrySection": entry_section, "imageBase": int(optional.ImageBase), "sizeOfImage": int(optional.SizeOfImage),
            "timestamp": int(pe.FILE_HEADER.TimeDateStamp), "sections": sections,
            "imports": {"count": len(names), "dlls": sorted(set(dlls))[:MAX_IMPORT_DLLS], "names": names[:MAX_IMPORT_NAMES]},
            "exports": exports, "resources": {"types": resource_types[:20], "count": len(resource_types)},
            "overlay": {"offset": overlay_start, "size": len(data) - overlay_start} if overlay_start else None,
        }
        return facts, overlay_start
    finally:
        pe.close()


def lief_facts(path):
    """Header facts from LIEF: the whole story for ELF and Mach-O, and the fallback when pefile cannot read a PE."""
    binary = lief.parse(path)
    if binary is None:
        return None
    if isinstance(binary, lief.PE.Binary):
        kind = "pe"
    elif isinstance(binary, lief.ELF.Binary):
        kind = "elf"
    else:
        kind = "macho"
    sections = [{"name": text(section.name, 16), "virtualSize": int(getattr(section, "virtual_size", section.size)), "rawSize": int(section.size),
                 "entropy": round(float(section.entropy), 3), "executable": False, "writable": False} for section in list(binary.sections)[:MAX_SECTIONS]]
    libraries = [text(name) for name in getattr(binary, "libraries", [])][:MAX_IMPORT_DLLS]
    functions = [text(getattr(function, "name", function)) for function in list(getattr(binary, "imported_functions", []))[:MAX_IMPORT_NAMES]]
    signatures = len(getattr(binary, "signatures", []) or [])
    return {
        "format": kind, "parser": "lief", "arch": "", "subsystem": "", "isDll": False, "dotnet": False, "entryPoint": int(getattr(binary, "entrypoint", 0) or 0),
        "entrySection": "", "sections": sections, "imports": {"count": len(functions), "dlls": libraries, "names": functions},
        "exports": [], "resources": {"types": [], "count": 0}, "overlay": None, "signatures": signatures,
    }


def packers_of(sections, data):
    found = {PACKER_SECTIONS[section["name"].lower()] for section in sections if section["name"].lower() in PACKER_SECTIONS}
    if b"UPX!" in data[:4096] or b"UPX!" in data[-4096:]:
        found.add("UPX")
    high = [section["name"] for section in sections if section["executable"] and section["entropy"] >= 7.2]
    return sorted(found), high


def wrapper_of(facts, data, packers):
    """`{kind, evidence}` of the first marker that fits, or kind None. Order: UPX, Inno Setup, NSIS, PyInstaller, Electron, self-extracting archive, .NET."""
    if "UPX" in packers:
        return {"kind": "upx", "evidence": "UPX section names or the UPX! marker"}
    if INNO_MARKER in data:
        return {"kind": "inno", "evidence": "Inno Setup setup data marker"}
    if any(marker in data for marker in NSIS_MARKERS):
        return {"kind": "nsis", "evidence": "Nullsoft installer header"}
    if PYINSTALLER_COOKIE in data[-(4 * 1024 * 1024):]:
        return {"kind": "pyinstaller", "evidence": "PyInstaller archive cookie"}
    if sum(marker in data for marker in ELECTRON_MARKERS) >= 2:
        return {"kind": "electron", "evidence": "Electron runtime strings"}
    overlay = facts.get("overlay")
    if overlay and overlay["size"] > 0:
        # Offset 0 would be the PE itself; look in the first megabyte of the data appended after the last section.
        head = data[overlay["offset"]:overlay["offset"] + 1024 * 1024]
        for marker, label in OVERLAY_ARCHIVES:
            if marker in head:
                return {"kind": "sfx", "evidence": f"{label} archive appended to the program"}
    if facts.get("dotnet"):
        return {"kind": "dotnet", "evidence": "CLR header in the PE"}
    return {"kind": None, "evidence": ""}


def dotnet_facts(path):
    """Metadata of a .NET assembly with dnfile: names, references, P/Invoke imports and resources. Never loads or runs it."""
    dn = dnfile.dnPE(path)
    tables = dn.net.mdtables

    def rows(table):
        node = getattr(tables, table, None)
        return list(node.rows) if node is not None else []

    def name_of(value):
        return text(str(value) if value is not None else "", 120)

    types = rows("TypeDef")
    methods = rows("MethodDef")
    names = [name_of(row.TypeName) for row in types[:500]] + [name_of(row.Name) for row in methods[:500]]
    printable = [name for name in names if name]
    odd = sum(1 for name in printable if not name.isascii() or len(name) <= 2 or not re.search(r"[A-Za-z]{3}", name))
    pinvoke = []
    for row in rows("ImplMap")[:200]:
        function = name_of(getattr(row, "ImportName", ""))
        module = name_of(getattr(getattr(getattr(row, "ImportScope", None), "row", None), "Name", ""))
        pinvoke.append({"dll": module, "function": function})
    assembly = rows("Assembly")
    return {
        "assembly": name_of(assembly[0].Name) if assembly else "", "version": f"{assembly[0].MajorVersion}.{assembly[0].MinorVersion}" if assembly else "",
        "runtime": name_of(getattr(dn.net.metadata.struct, "Version", "")), "typeCount": len(types), "methodCount": len(methods),
        "references": [name_of(row.Name) for row in rows("AssemblyRef")[:30]], "pinvoke": pinvoke[:40],
        "suspiciousPinvoke": sorted({item["function"] for item in pinvoke if SUSPICIOUS_PINVOKE.match(item["function"])})[:20],
        "resources": [name_of(row.Name) for row in rows("ManifestResource")[:20]],
        "oddNameRatio": round(odd / len(printable), 3) if printable else 0.0, "namesChecked": len(printable),
    }


def main():
    args = parse_args(("ext", "max-entries", "max-bytes"))
    max_entries, max_bytes = unpack.clamp_budgets(int(args.max_entries or 50), int(args.max_bytes or 52428800))
    size = os.path.getsize(args.file)
    with open(args.file, "rb") as handle:
        data = handle.read(MAX_READ)
    identify = {"size": size, "entropy": entropy_of(data[:ENTROPY_SAMPLE]), "parsers": [], "errors": []}
    facts, overlay_start = None, 0
    try:
        facts, overlay_start = pe_facts(args.file, data)
        identify["parsers"].append("pefile")
    except Exception as error:  # pefile raises many types on hostile headers
        identify["errors"].append(f"pefile: {error.__class__.__name__}")
    try:
        other = lief_facts(args.file)
        if other:
            identify["parsers"].append("lief")
            identify["lief"] = {"format": other["format"], "signatures": other.get("signatures", 0)}
            if facts is None:
                facts = other
    except Exception as error:
        identify["errors"].append(f"lief: {error.__class__.__name__}")
    if facts is None:
        finish(args, identify={**identify, "format": "unknown"}, unwrap=None, dotnet=None)
    identify.update(facts)
    packers, high = packers_of(facts["sections"], data)
    identify["packers"], identify["highEntropyCode"] = packers, high
    identify["wrapper"] = wrapper_of(facts, data, packers)
    identify["signature"] = signature_status(args.file) if facts["format"] == "pe" else {"status": "not-checked", "detail": "Authenticode applies to PE files."}

    kind = identify["wrapper"]["kind"]
    unwrapped = None
    if kind in UNWRAPPABLE:
        if max_entries == 0 or max_bytes == 0:
            unwrapped = unwrap.result(UNWRAPPABLE[kind], format=kind, stopped="entries" if max_entries == 0 else "bytes")
        else:
            unwrapped = unwrap.unwrap(UNWRAPPABLE[kind], args.file, unpack.destination(), max_entries, max_bytes, label=kind)
    dotnet = None
    if facts.get("dotnet"):
        try:
            dotnet = dotnet_facts(args.file)
        except Exception as error:
            dotnet = {"error": error.__class__.__name__}
    finish(args, identify=identify, unwrap=unwrapped, dotnet=dotnet)


if __name__ == "__main__":
    main()
