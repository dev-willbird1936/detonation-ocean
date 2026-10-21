"""Unwrap (SPEC 6.6 "Unwrap"): executables and archives that are really containers.

Each method writes its parts the way unpack.py does (~/Downloads/.unpacked/<item>/<n>.dat, gzipped, with name, size and first bytes) and
returns the same shape: {"method", "format", "entries", "stopped", "listed", "detail"?, "inspectOnly"?}. The caps are SPEC 5.3: at most
`max_entries` files, `max_bytes` unpacked bytes, a ratio of at most 100:1 per entry. The controller turns every entry into a child item.

    upx          upx -d
    inno         innoextract (the files of the installer; [Run] entries are not exposed by innoextract)
    7z           7zz: NSIS installers, self-extracting 7z/RAR/ZIP archives, MSI packages
    pyinstaller  pyinstxtractor: the entry-point scripts first, then the other .pyc/.py files; inspect only
    asar         @electron/asar extract: package.json and the JavaScript; inspect only

identify.py calls these for a PE it has typed; run.sh `unwrap --method M` calls them for a file that is not a PE (an .asar, an .msi).
"""
import os
import re
import shutil
import sys

import unpack
from runnerlib import finish, open_regular, parse_args, run, tail

SCRATCH = "/tmp/dt"
UPX = "/usr/local/bin/upx"
INNOEXTRACT = "/usr/local/bin/innoextract"
SEVENZIP = "/usr/local/bin/7zz"
PYINSTXTRACTOR = "/opt/pyinstxtractor/pyinstxtractor.py"
ASAR = "/opt/asar/node_modules/@electron/asar/bin/asar.mjs"
PYTHON = "/opt/venv/bin/python"
MAX_RATIO = unpack.MAX_RATIO
CHILD_BYTES = 8 * 1024 * 1024  # one entry of an installer that is bigger than this is not read into the listing
SCRIPT_SUFFIXES = (".pyc", ".py")
JS_SUFFIXES = (".js", ".mjs", ".cjs")
INNO_VERSION = re.compile(r"setup data version ([0-9][0-9.]*)")
ENTRY_POINT = re.compile(r"Possible entry point: (\S+)")


def result(method, **fields):
    return {"method": method, "format": method, "entries": [], "stopped": None, "listed": 0, **fields}


def fresh(name):
    path = os.path.join(SCRATCH, name)
    shutil.rmtree(path, ignore_errors=True)
    os.makedirs(path)
    return path


def read_limited(path, limit):
    """The bytes of a regular file inside its work directory, or None when it is a link, special or over `limit`."""
    if os.path.islink(path) or not os.path.isfile(path) or os.path.getsize(path) > limit:
        return None
    with open_regular(path) as handle:
        data = handle.read(limit + 1)
    return data if len(data) <= limit else None


def store_files(method, root, names, dest, max_entries, max_bytes, ratio_base=None, **fields):
    """Stores the files `names` (relative to `root`) as children under the caps. `ratio_base` is the size the 100:1 ratio is measured against."""
    out = result(method, listed=len(names), **fields)
    total = 0
    for name in names:
        source = os.path.join(root, name)
        real = os.path.realpath(source)
        if not real.startswith(os.path.realpath(root) + os.sep) or os.path.islink(source) or not os.path.isfile(source):
            continue
        size = os.path.getsize(source)
        if len(out["entries"]) >= max_entries:
            out["stopped"] = "entries"
        elif total + size > max_bytes:
            out["stopped"] = "bytes"
        elif ratio_base and size > MAX_RATIO * ratio_base:
            out["stopped"] = "ratio"
        elif size > CHILD_BYTES * 8:
            out["stopped"] = "bytes"
        if out["stopped"]:
            break
        data = read_limited(source, min(CHILD_BYTES * 8, max_bytes - total))
        if data is None or len(data) != size:
            out["stopped"] = "error"
            break
        total += size
        out["entries"].append(unpack.store(dest, len(out["entries"]), name, data))
    return out


def walk(root):
    return sorted(os.path.relpath(os.path.join(base, name), root).replace(os.sep, "/") for base, _, names in os.walk(root, followlinks=False) for name in names)


def unwrap_upx(path, dest, max_entries, max_bytes):
    out_path = os.path.join(fresh("upx"), "unpacked.bin")
    done = run([UPX, "-d", "-q", "-o", out_path, path], 20)
    if done["code"] != 0 or not os.path.isfile(out_path):
        return result("upx", stopped="error", detail=tail(done["stderr"] or done["stdout"]) or "upx could not unpack the file")
    packed = max(os.path.getsize(path), 1)
    return store_files("upx", os.path.dirname(out_path), ["unpacked.bin"], dest, max_entries, max_bytes, ratio_base=packed)


def unwrap_inno(path, dest, max_entries, max_bytes):
    work = fresh("inno")
    done = run([INNOEXTRACT, "-e", "-d", work, path], 25)
    version = INNO_VERSION.search(done["stdout"] + done["stderr"])
    names = walk(work)
    if done["code"] != 0 and not names:
        return result("inno", stopped="error", detail=tail(done["stderr"] + done["stdout"]) or "innoextract could not read the installer",
                      innoVersion=version.group(1) if version else None)
    out = store_files("inno", work, names, dest, max_entries, max_bytes, ratio_base=max(os.path.getsize(path), 1),
                      innoVersion=version.group(1) if version else None)
    if done["code"] != 0 or done["timedOut"]:
        out["stopped"] = out["stopped"] or "error"
    return out


def unwrap_seven_zip(path, dest, max_entries, max_bytes, label="7z"):
    out = unpack.unpack_zip(path, dest, max_entries, max_bytes)
    return {**out, "method": "7z", "format": label}


def unwrap_pyinstaller(path, dest, max_entries, max_bytes):
    work = fresh("pyi")
    sample = os.path.join(work, "sample.bin")
    shutil.copyfile(path, sample)
    done = run([PYTHON, PYINSTXTRACTOR, sample], 25, cwd=work)
    extracted = os.path.join(work, "sample.bin_extracted")
    if not os.path.isdir(extracted):
        return result("pyinstaller", stopped="error", inspectOnly=True, detail=tail(done["stdout"] + done["stderr"]) or "pyinstxtractor found no archive")
    entry_points = [name for name in ENTRY_POINT.findall(done["stdout"]) if os.path.isfile(os.path.join(extracted, name))]
    names = [name for name in walk(extracted) if name.endswith(SCRIPT_SUFFIXES)]
    top = [name for name in names if "/" not in name and name not in entry_points]
    rest = [name for name in names if "/" in name]
    out = store_files("pyinstaller", extracted, [*entry_points, *top, *rest], dest, max_entries, max_bytes,
                      ratio_base=max(os.path.getsize(path), 1), inspectOnly=True, entryPoints=entry_points[:10])
    if done["code"] != 0 or done["timedOut"]:
        out["stopped"] = out["stopped"] or "error"
    return out


def unwrap_asar(path, dest, max_entries, max_bytes):
    work = fresh("asar")
    done = run(["node", ASAR, "extract", path, work], 25)
    if done["code"] != 0:
        return result("asar", stopped="error", inspectOnly=True, detail=tail(done["stderr"]) or "asar could not extract the archive")
    names = walk(work)
    manifests = [name for name in names if name.endswith("package.json") and name.count("/") <= 1]
    scripts = [name for name in names if name.endswith(JS_SUFFIXES) and "node_modules/" not in name]
    return store_files("asar", work, [*manifests, *scripts], dest, max_entries, max_bytes, ratio_base=max(os.path.getsize(path), 1), inspectOnly=True)


METHODS = {"upx": unwrap_upx, "inno": unwrap_inno, "pyinstaller": unwrap_pyinstaller, "asar": unwrap_asar}


def unwrap(method, path, dest, max_entries, max_bytes, label=None):
    """The unpack-shaped result of `method` on `path`; a tool that raises is an error result, never an exception."""
    try:
        max_entries, max_bytes = unpack.clamp_budgets(max_entries, max_bytes)
        if max_entries == 0 or max_bytes == 0:
            return result(method, stopped="entries" if max_entries == 0 else "bytes", inspectOnly=method in ("pyinstaller", "asar"))
        if method in ("7z", "nsis", "sfx", "msi"):
            return unwrap_seven_zip(path, dest, max_entries, max_bytes, label or method)
        return METHODS[method](path, dest, max_entries, max_bytes)
    except Exception as error:  # a hostile file must not stop the runner from printing its result
        return result(method, stopped="error", detail=f"{error.__class__.__name__}")


def main():
    args = parse_args(("ext", "method", "max-entries", "max-bytes"))
    if args.method not in ("asar", "msi", "7z"):
        finish(args, started=False, exit_code=64)
    dest = unpack.destination()
    max_entries, max_bytes = unpack.clamp_budgets(int(args.max_entries or 50), int(args.max_bytes or 52428800))
    out = unwrap(args.method, args.file, dest, max_entries, max_bytes, label=args.method)
    finish(args, unpack=out)


if __name__ == "__main__":
    main()
