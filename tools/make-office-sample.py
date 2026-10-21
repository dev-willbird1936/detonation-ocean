"""Builds samples/budget.docm: a Word document whose VBA macro is samples/src/DemoMacro.bas.

Python standard library only (zipfile, struct). No VBA-project writer exists in the standard library, so this file writes the two
Microsoft formats a macro project needs itself:
  * MS-CFB  (OLE compound file) for word/vbaProject.bin
  * MS-OVBA (the VBA project streams: PROJECT, PROJECTwm, VBA/dir, VBA/_VBA_PROJECT and one stream per module)
The module source is stored with literal-only MS-OVBA compression and no performance cache, so the VBA engine compiles it from
source on first use. Output is byte-for-byte reproducible. See samples/README.md for what was and was not verified.
"""
import struct
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "samples" / "src" / "DemoMacro.bas"
OUTPUT = ROOT / "samples" / "budget.docm"
HEADER = "Demo sample for Detonation Ocean. Refuses to run outside the sandbox."

PROJECT_ID = "{8D6B4F5A-3C1E-4A27-9B52-6E0D7A1C4F93}"
FREESECT, ENDOFCHAIN, FATSECT, NOSTREAM = 0xFFFFFFFF, 0xFFFFFFFE, 0xFFFFFFFD, 0xFFFFFFFF

THIS_DOCUMENT = "\r\n".join([
    'Attribute VB_Name = "ThisDocument"',
    'Attribute VB_Base = "1Normal.ThisDocument"',
    "Attribute VB_GlobalNameSpace = False",
    "Attribute VB_Creatable = False",
    "Attribute VB_PredeclaredId = True",
    "Attribute VB_Exposed = True",
    "Attribute VB_TemplateDerived = True",
    "Attribute VB_Customizable = True",
    "",
])

REFERENCES = [
    ("stdole", r"*\G{00020430-0000-0000-C000-000000000046}#2.0#0#C:\Windows\System32\stdole2.tlb#OLE Automation"),
    ("Word", r"*\G{00020905-0000-0000-C000-000000000046}#8.7#0#C:\Program Files\Microsoft Office\root\Office16\MSWORD.OLB#Microsoft Word 16.0 Object Library"),
    ("Office", r"*\G{2DF8D04C-5BFA-101B-BDE5-00AA0044DE52}#2.0#0#C:\Program Files\Common Files\Microsoft Shared\OFFICE16\MSO.DLL#Microsoft Office 16.0 Object Library"),
]


def ovba_compress(data):
    """MS-OVBA 2.4.1 container with literal-only tokens; one chunk, so the source must stay small."""
    assert len(data) <= 3600, "module source too large for one literal-only chunk"
    body = bytearray()
    for start in range(0, len(data), 8):
        group = data[start:start + 8]
        body.append(0x00)
        body += group
    header = (len(body) + 2 - 3) | 0x3000 | 0x8000
    return b"\x01" + struct.pack("<H", header) + bytes(body)


def ovba_encrypt(seed, project_key, data):
    """MS-OVBA 2.4.3.2 data encryption, returned as the uppercase hex text stored in the PROJECT stream."""
    assert seed & 0x06 == 0, "seeds with ignored bytes are not used"
    out = [seed, seed ^ 2, seed ^ project_key]
    unencrypted1, encrypted1, encrypted2 = project_key, out[2], out[1]
    for byte in struct.pack("<I", len(data)) + data:
        encrypted = byte ^ ((encrypted2 + unencrypted1) & 0xFF)
        encrypted2, encrypted1, unencrypted1 = encrypted1, encrypted, byte
        out.append(encrypted)
    return bytes(out).hex().upper()


def record(record_id, payload=b""):
    return struct.pack("<HI", record_id, len(payload)) + payload


def dir_stream(modules):
    """MS-OVBA 2.3.4.2 dir stream, decompressed. modules: [(name, is_document)]."""
    out = b"".join([
        record(0x0001, struct.pack("<I", 1)),
        record(0x0002, struct.pack("<I", 0x0409)),
        record(0x0014, struct.pack("<I", 0x0409)),
        record(0x0003, struct.pack("<H", 1252)),
        record(0x0004, b"VBAProject"),
        record(0x0005), record(0x0040),
        record(0x0006), record(0x003D),
        record(0x0007, struct.pack("<I", 0)),
        record(0x0008, struct.pack("<I", 0)),
        struct.pack("<HIIH", 0x0009, 4, 1, 0),
        record(0x000C), record(0x003C),
    ])
    for name, libid in REFERENCES:
        out += record(0x0016, name.encode("cp1252")) + record(0x003E, name.encode("utf-16-le"))
        libid_bytes = libid.encode("cp1252")
        out += record(0x000D, struct.pack("<I", len(libid_bytes)) + libid_bytes + struct.pack("<IH", 0, 0))
    out += record(0x000F, struct.pack("<H", len(modules))) + record(0x0013, struct.pack("<H", 0xFFFF))
    for name, is_document in modules:
        out += b"".join([
            record(0x0019, name.encode("cp1252")),
            record(0x0047, name.encode("utf-16-le")),
            record(0x001A, name.encode("cp1252")), record(0x0032, name.encode("utf-16-le")),
            record(0x001C), record(0x0048),
            record(0x0031, struct.pack("<I", 0)),
            record(0x001E, struct.pack("<I", 0)),
            record(0x002C, struct.pack("<H", 0xFFFF)),
            record(0x0022 if is_document else 0x0021),
            record(0x002B),
        ])
    return out + record(0x0010)


def project_stream(modules):
    key = sum(PROJECT_ID.encode("ascii")) & 0xFF
    lines = [
        f'ID="{PROJECT_ID}"',
        *(f"Document={name}/&H00000000" if is_document else f"Module={name}" for name, is_document in modules),
        'Name="VBAProject"',
        'HelpContextID="0"',
        'VersionCompatible32="393222000"',
        f'CMG="{ovba_encrypt(0x71, key, bytes(4))}"',
        f'DPB="{ovba_encrypt(0x91, key, bytes(1))}"',
        f'GC="{ovba_encrypt(0xA1, key, bytes([0xFF]))}"',
        "",
        "[Host Extender Info]",
        "&H00000001={3832D640-CF90-11CF-8E43-00A0C911005A};VBE;&H00000000",
        "",
        "[Workspace]",
        *(f"{name}=0, 0, 0, 0, C" for name, _ in modules),
        "",
    ]
    return "\r\n".join(lines).encode("cp1252")


def project_wm_stream(modules):
    out = b"".join(name.encode("cp1252") + b"\x00" + name.encode("utf-16-le") + b"\x00\x00" for name, _ in modules)
    return out + b"\x00\x00"


class Entry:
    def __init__(self, name, kind, data=b""):
        self.name, self.kind, self.data, self.children = name, kind, data, []
        self.left = self.right = self.child = NOSTREAM
        self.color = 1
        self.start, self.id = ENDOFCHAIN, 0


def link_siblings(entries):
    """Builds a balanced binary tree of siblings in CFB order (shorter name first, then upper-case compare). Returns the root id."""
    ordered = sorted(entries, key=lambda entry: (len(entry.name), entry.name.upper()))
    depths = {}

    def build(items, depth):
        if not items:
            return NOSTREAM
        mid = len(items) // 2
        node = items[mid]
        depths[node.id] = depth
        node.left = build(items[:mid], depth + 1)
        node.right = build(items[mid + 1:], depth + 1)
        return node.id

    root = build(ordered, 0)
    deepest = max(depths.values())
    if len(ordered) != 2 ** (deepest + 1) - 1:
        for entry in ordered:
            entry.color = 0 if depths[entry.id] == deepest else 1
    return root


def cfb(root):
    """MS-CFB version 3 compound file with every stream in the mini stream (all streams here are under 4096 bytes)."""
    flat = [root]
    stack = [root]
    while stack:
        parent = stack.pop(0)
        flat += parent.children
        stack += [child for child in parent.children if child.kind == "storage"]
    for index, entry in enumerate(flat):
        entry.id = index
    for entry in flat:
        if entry.children:
            entry.child = link_siblings(entry.children)

    mini_stream = bytearray()
    mini_fat = []
    for entry in flat:
        if entry.kind != "stream":
            continue
        assert 0 < len(entry.data) < 4096
        entry.start = len(mini_stream) // 64
        count = -(-len(entry.data) // 64)
        mini_stream += entry.data.ljust(count * 64, b"\x00")
        mini_fat += list(range(entry.start + 1, entry.start + count)) + [ENDOFCHAIN]
    root.data = bytes(mini_stream)

    def sectors(size):
        return -(-size // 512)

    n_mini_data = sectors(len(mini_stream))
    n_mini_fat = sectors(len(mini_fat) * 4)
    n_dir = sectors(len(flat) * 128)
    n_fat = 1
    while n_fat * 128 < n_mini_data + n_mini_fat + n_dir + n_fat:
        n_fat += 1
    mini_start, mini_fat_start = 0, n_mini_data
    dir_start, fat_start = mini_fat_start + n_mini_fat, mini_fat_start + n_mini_fat + n_dir
    root.start = mini_start

    fat = []
    for first, count in ((mini_start, n_mini_data), (mini_fat_start, n_mini_fat), (dir_start, n_dir)):
        fat += list(range(first + 1, first + count)) + [ENDOFCHAIN]
    fat += [FATSECT] * n_fat
    fat += [FREESECT] * (n_fat * 128 - len(fat))

    mini_fat += [FREESECT] * (n_mini_fat * 128 - len(mini_fat))

    directory = b""
    for entry in flat:
        name = (entry.name + "\x00").encode("utf-16-le")
        kind = {"root": 5, "storage": 1, "stream": 2}[entry.kind]
        size = len(entry.data) if entry.kind != "storage" else 0
        start = entry.start if entry.kind != "storage" else 0
        directory += struct.pack("<64sHBBIII16sIQQIQ", name.ljust(64, b"\x00"), len(name), kind, entry.color, entry.left, entry.right,
                                 entry.child, bytes(16), 0, 0, 0, start, size)
    directory = directory.ljust(n_dir * 512, b"\x00")
    # Unused directory slots need NOSTREAM siblings.
    unused = b"\x00" * 66 + struct.pack("<BBIII", 0, 0, NOSTREAM, NOSTREAM, NOSTREAM) + b"\x00" * 48
    directory = directory[:len(flat) * 128] + unused * (n_dir * 4 - len(flat))

    difat = [fat_start + index for index in range(n_fat)] + [FREESECT] * (109 - n_fat)
    header = struct.pack("<8s16sHHHHH6sIIIIIIIII", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", bytes(16), 0x003E, 3, 0xFFFE, 9, 6, bytes(6), 0,
                         n_fat, dir_start, 0, 4096, mini_fat_start, n_mini_fat, ENDOFCHAIN, 0)
    header += struct.pack("<109I", *difat)
    assert len(header) == 512
    body = bytes(mini_stream).ljust(n_mini_data * 512, b"\x00")
    body += struct.pack(f"<{len(mini_fat)}I", *mini_fat) + directory + struct.pack(f"<{len(fat)}I", *fat)
    return header + body


def vba_project_bin(macro_source):
    modules = [("ThisDocument", True), ("DemoMacro", False)]
    sources = {"ThisDocument": THIS_DOCUMENT, "DemoMacro": macro_source}
    vba = Entry("VBA", "storage")
    vba.children = [
        Entry("_VBA_PROJECT", "stream", bytes.fromhex("CC61FFFF000000")),
        Entry("dir", "stream", ovba_compress(dir_stream(modules))),
        *(Entry(name, "stream", ovba_compress(sources[name].encode("cp1252"))) for name, _ in modules),
    ]
    root = Entry("Root Entry", "root")
    root.children = [Entry("PROJECT", "stream", project_stream(modules)), Entry("PROJECTwm", "stream", project_wm_stream(modules)), vba]
    return cfb(root)


CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>'
    '<Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/>'
    "</Types>"
)
ROOT_RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    "</Relationships>"
)
DOCUMENT_RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>'
    "</Relationships>"
)
DOCUMENT = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    f"<w:p><w:r><w:t>{HEADER}</w:t></w:r></w:p>"
    "<w:p><w:r><w:t>Budget summary: rent 1200, food 400, travel 150.</w:t></w:r></w:p>"
    "</w:body></w:document>"
)


def build():
    macro = SOURCE.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\n", "\r\n")
    parts = [
        ("[Content_Types].xml", CONTENT_TYPES.encode("utf-8")),
        ("_rels/.rels", ROOT_RELS.encode("utf-8")),
        ("word/document.xml", DOCUMENT.encode("utf-8")),
        ("word/_rels/document.xml.rels", DOCUMENT_RELS.encode("utf-8")),
        ("word/vbaProject.bin", vba_project_bin(macro)),
    ]
    with zipfile.ZipFile(OUTPUT, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in parts:
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    print(f"wrote {OUTPUT.relative_to(ROOT).as_posix()} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    sys.exit(build())
