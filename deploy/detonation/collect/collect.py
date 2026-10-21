"""Detonation file-diff collector (docs/SPEC.md 6.4, docs/detonation/EVIDENCE.md `diff`). Standard library only.

Compares the home volume (mounted read-only) with the seed manifest and writes diff.json:

    {"version": 1, "items": [...], "counts": {...}, "truncated": false, "truncation": []}

Each item is an EVIDENCE.md diff item without `id` and `at`, which the controller assigns:
    {"source": "diff", "kind": "added|changed|deleted|renamed", "detail": "...", "path": "/home/dana/...",
     "to"?, "seeded", "entropyBefore", "entropyAfter", "sizeBefore", "sizeAfter", "executable"?, "copyOfSample"?,
     "ransomNoteCandidate"?}

Manifest: [{"path": "Documents/notes.txt", "size": 260, "sha256": "...", "entropy"?: 4.2}]. Paths are relative to
the home directory or absolute under /home/dana. `entropy` is optional; entropyBefore is null without it.
Symlinks and special files are never opened or followed.

Usage: collect.py [--home /home/dana] [--manifest /in/seed-manifest.json] [--out /out/diff.json] [--sample-sha256 HEX]
"""
import argparse
import hashlib
import json
import math
import os
import re
import stat
import sys
from collections import Counter

HOME_ROOT = "/home/dana"
MAX_ADDED_FILES = 5000
MAX_OUTPUT_BYTES = 64 * 1024
MAX_READ_BYTES = 64 * 1024 * 1024
CHUNK = 1024 * 1024
RUNNER_COPY = {f"Downloads/sample.{ext}" for ext in ("py", "sh", "js")}
RANSOM_NAME = re.compile(r"ransom|decrypt|(recover|restore)[-_ ]*(your[-_ ]*)?files|read[-_ ]?me[-_ ]?to", re.I)
RANSOM_TEXT = re.compile(rb"ransom|decrypt|bitcoin|your files (have been|are)", re.I)
RANSOM_TEXT_EXTENSIONS = {".txt", ".html", ".htm", ".hta", ".md", ".rtf"}
EXECUTABLE_MAGIC = (b"\x7fELF", b"MZ", b"#!", b"\xca\xfe\xba\xbe", b"\xcf\xfa\xed\xfe")


def entropy_of(counts, total):
    if total == 0:
        return 0.0
    return round(-sum(n / total * math.log2(n / total) for n in counts.values()), 4) + 0.0  # + 0.0 turns -0.0 into 0.0


def read_regular(path):
    """(size, sha256, entropy, head) of a regular file; reads at most MAX_READ_BYTES. None if it cannot be read."""
    digest, counts, total, head = hashlib.sha256(), Counter(), 0, b""
    try:
        with open(path, "rb") as handle:
            while total < MAX_READ_BYTES:
                chunk = handle.read(min(CHUNK, MAX_READ_BYTES - total))
                if not chunk:
                    break
                if total == 0:
                    head = chunk[:4096]
                digest.update(chunk)
                counts.update(chunk)
                total += len(chunk)
    except OSError:
        return None
    return total, digest.hexdigest(), entropy_of(counts, total), head


def relative_path(raw):
    """Manifest path to a clean path relative to the home directory, or None if it escapes it. Backslashes are separators
    here only: a manifest is written by the controller, whereas a name on disk is taken literally (see walk_relative)."""
    if not isinstance(raw, str):
        return None
    text = raw.replace("\\", "/")
    if text.startswith(HOME_ROOT + "/"):
        text = text[len(HOME_ROOT) + 1:]
    elif text.startswith("/"):
        return None
    clean = os.path.normpath(text).replace(os.sep, "/")
    return None if clean in (".", "") or clean == ".." or clean.startswith("../") else clean


def walk_relative(directory, name, root):
    """Path of a file found by the walk, relative to the home, with every name kept literally: a backslash, or a directory
    named dot-dot-backslash-x, is part of the name. None only when a component is exactly dot-dot, which the walk cannot produce."""
    rel = os.path.relpath(os.path.join(directory, name), root).replace(os.sep, "/")
    return None if ".." in rel.split("/") else rel


class Home:
    def __init__(self, root):
        self.root = os.path.realpath(root)
        self.parents = {}

    def full(self, rel):
        return os.path.join(self.root, *rel.split("/"))

    def inside(self, rel):
        """True when the parent directories of rel resolve inside the home (no symlinked directory escape)."""
        directory = os.path.dirname(self.full(rel))
        if directory not in self.parents:
            real = os.path.realpath(directory)
            self.parents[directory] = real == self.root or real.startswith(self.root + os.sep)
        return self.parents[directory]

    def lstat(self, rel):
        """lstat of rel, or None when it is gone or its parent directory escapes the home. Other errors (an unreadable
        directory) propagate, so they are never mistaken for a deletion."""
        if not self.inside(rel):
            return None
        try:
            return os.lstat(self.full(rel))
        except (FileNotFoundError, NotADirectoryError):
            return None


def looks_executable(mode, head):
    return bool(mode & 0o111) or head.startswith(EXECUTABLE_MAGIC)


def load_manifest(path):
    with open(path, "r", encoding="utf-8") as handle:
        entries = json.load(handle)
    manifest = {}
    for entry in entries if isinstance(entries, list) else []:
        rel = relative_path(entry.get("path")) if isinstance(entry, dict) else None
        if rel is not None:
            manifest[rel] = entry
    return manifest


def item(kind, rel, detail, **fields):
    return {"source": "diff", "kind": kind, "detail": detail, "path": f"{HOME_ROOT}/{rel}", **fields}


def stem_matches(old, new):
    """Same directory and either the same stem with a new extension, or the old name with an extension appended."""
    old_dir, old_name = os.path.split(old)
    new_dir, new_name = os.path.split(new)
    if old_dir != new_dir or old_name == new_name:
        return False
    return new_name.startswith(old_name + ".") or os.path.splitext(old_name)[0] == os.path.splitext(new_name)[0]


def add_reason(truncation, reason):
    if reason not in truncation:
        truncation.append(reason)


def scan(home, manifest):
    """Returns (changed, deleted, added, truncation reasons). Seeded files are stat-ed directly, so a flood of
    new files cannot hide a deletion; only the walk for added files is capped."""
    changed, deleted, added, truncation = [], [], [], []
    for rel in sorted(manifest):
        entry = manifest[rel]
        try:
            st = home.lstat(rel)
        except OSError:
            add_reason(truncation, "unreadable-dir")
            continue
        before = entry.get("entropy") if isinstance(entry.get("entropy"), (int, float)) else None
        size_before = entry.get("size") if isinstance(entry.get("size"), int) else None
        if st is None:
            deleted.append((rel, size_before, before, entry.get("sha256")))
            continue
        read = read_regular(home.full(rel)) if stat.S_ISREG(st.st_mode) else None
        if read is None:
            changed.append(item("changed", rel, f"seeded path {rel} is no longer a readable regular file", seeded=True,
                                entropyBefore=before, entropyAfter=None, sizeBefore=size_before, sizeAfter=st.st_size))
        elif read[0] != size_before or read[1] != entry.get("sha256"):
            changed.append(item("changed", rel, f"seeded file {rel} changed", seeded=True, entropyBefore=before,
                                entropyAfter=read[2], sizeBefore=size_before, sizeAfter=read[0]))
    for directory, directories, names in os.walk(home.root, followlinks=False, onerror=lambda _: add_reason(truncation, "unreadable-dir")):
        directories.sort()
        for name in sorted(names + [d for d in directories if os.path.islink(os.path.join(directory, d))]):
            rel = walk_relative(directory, name, home.root)
            if rel is None or rel in manifest:
                continue
            if len(added) >= MAX_ADDED_FILES:
                add_reason(truncation, "files")
                return changed, deleted, added, truncation
            added.append(rel)
    return changed, deleted, added, truncation


def build_added(home, rel, sample_sha256):
    try:
        st = home.lstat(rel)
    except OSError:
        st = None
    size = st.st_size if st else None
    read = read_regular(home.full(rel)) if st and stat.S_ISREG(st.st_mode) else None
    head = read[3] if read else b""
    fields = {"seeded": False, "entropyBefore": None, "entropyAfter": read[2] if read else None, "sizeBefore": None,
              "sizeAfter": read[0] if read else size}
    if st and looks_executable(st.st_mode, head):
        fields["executable"] = True
    if read and sample_sha256 and read[1] == sample_sha256 and rel not in RUNNER_COPY:
        fields["copyOfSample"] = True
    name = os.path.basename(rel)
    if RANSOM_NAME.search(name) or (read and read[0] <= 65536 and os.path.splitext(name)[1].lower() in RANSOM_TEXT_EXTENSIONS
                                    and RANSOM_TEXT.search(head)):
        fields["ransomNoteCandidate"] = True
    return item("added", rel, f"new file {rel}", **fields), (read[1] if read else None)


def collect(home_dir, manifest_path, sample_sha256=None):
    home, manifest = Home(home_dir), load_manifest(manifest_path)
    changed, deleted, added_rels, truncation = scan(home, manifest)
    added = {}
    for rel in added_rels:
        built = build_added(home, rel, sample_sha256)
        # The runner's own unmodified copy of the sample is not the sample's doing.
        if not (rel in RUNNER_COPY and sample_sha256 and built[1] == sample_sha256):
            added[rel] = built

    renamed, unmatched = [], []
    for rel, size_before, entropy_before, sha_before in deleted:
        match = next((new for new, (_, sha) in added.items() if sha and sha == sha_before), None) or \
                next((new for new in added if stem_matches(rel, new)), None)
        if match is None:
            unmatched.append(item("deleted", rel, f"seeded file {rel} was deleted", seeded=True, entropyBefore=entropy_before,
                                  entropyAfter=None, sizeBefore=size_before, sizeAfter=None))
            continue
        built = added.pop(match)[0]
        renamed.append(item("renamed", rel, f"seeded file {rel} was renamed to {match}", to=built["path"], seeded=True,
                            entropyBefore=entropy_before, entropyAfter=built["entropyAfter"], sizeBefore=size_before,
                            sizeAfter=built["sizeAfter"]))
    added_items = [built for built, _ in added.values()]
    items = renamed + unmatched + changed + added_items
    counts = {"added": len(added_items), "changed": len(changed), "deleted": len(unmatched), "renamed": len(renamed)}
    return items, counts, truncation


def render(items, counts, truncation):
    """Serialise, dropping trailing items until the document is within MAX_OUTPUT_BYTES."""
    kept, reasons = list(items), list(truncation)
    while True:
        text = json.dumps({"version": 1, "items": kept, "counts": counts, "truncated": bool(reasons), "truncation": reasons},
                          separators=(",", ":"))
        if len(text.encode("utf-8")) <= MAX_OUTPUT_BYTES:
            return text
        if "output" not in reasons:
            reasons.append("output")
        kept = kept[:len(kept) * 9 // 10]


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--home", default=HOME_ROOT)
    parser.add_argument("--manifest", default="/in/seed-manifest.json")
    parser.add_argument("--out", default="/out/diff.json")
    parser.add_argument("--sample-sha256", default=None)
    args = parser.parse_args(argv)
    sample = args.sample_sha256.lower() if args.sample_sha256 and re.fullmatch(r"[0-9a-fA-F]{64}", args.sample_sha256) else None
    text = render(*collect(args.home, args.manifest, sample))
    with open(args.out, "w", encoding="utf-8") as handle:
        handle.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
