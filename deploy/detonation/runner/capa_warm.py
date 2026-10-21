"""Image build step: warms the capa rule cache (/opt/capa-cache) so a run does not parse the rules again. Not run in a container of a job.

capa loads the rules and writes the cache before it analyses the file, so a minimal PE (a header and one `ret` section) is enough.
"""
import os
import struct
import subprocess

SECTION = b"\xc3" + b"\x00" * 511
DOS = b"MZ" + b"\x00" * 58 + struct.pack("<I", 0x40)
COFF = b"PE\x00\x00" + struct.pack("<HHIIIHH", 0x14C, 1, 0, 0, 0, 0xE0, 0x102)
OPTIONAL = struct.pack(
    "<HBBIIIIIIIIIHHHHHHIIIIHHIIIIII", 0x10B, 1, 0, 512, 0, 0, 0x1000, 0x1000, 0x1000, 0x400000, 0x1000, 0x200, 4, 0, 0, 0, 4, 0, 0, 0x2000, 0x200,
    0, 3, 0, 0x100000, 0x1000, 0x100000, 0x1000, 0, 16) + b"\x00" * 128
TABLE = b".text\x00\x00\x00" + struct.pack("<IIIIIIHHI", 1, 0x1000, 512, 0x200, 0, 0, 0, 0, 0x60000020)

image = (DOS + b"\x00" * (0x40 - len(DOS)) + COFF + OPTIONAL + TABLE).ljust(0x200, b"\x00") + SECTION
with open("/tmp/warm.exe", "wb") as handle:
    handle.write(image)
environment = dict(os.environ, XDG_CACHE_HOME="/opt/capa-cache")
subprocess.run(
    ["/opt/static-venv/bin/capa", "-r", "/opt/capa/rules", "-s", "/opt/capa/sigs", "-j", "-q", "/tmp/warm.exe"],
    env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
)
