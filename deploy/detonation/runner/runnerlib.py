"""Shared helpers for the runner tools: argument parsing, bounded subprocesses and the final JSON status line."""
import argparse
import gzip
import json
import os
import re
import stat
import subprocess
import sys
import zlib

TAIL_CHARS = 400
CHILD_BYTES = 64 * 1024 * 1024
UPLOAD_BYTES = 100 * 1024 * 1024
CHILD_PATH = re.compile(r"/home/dana/Downloads/\.unpacked/(0|[1-9][0-9]*)/(0|[1-9][0-9]*)\.dat")
STAGED_PATH = re.compile(r"/(?:tmp/dt|home/dana/Downloads)/sample\.[a-z0-9]{1,8}")


def open_regular(path, flags=os.O_RDONLY):
    """Opens a regular file without following links in any path component; callers own the returned handle."""
    parent = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        parts = path.split("/")
        if not path.startswith("/") or any(part in ("", ".", "..") for part in parts[1:]):
            raise OSError("input path is not canonical")
        for part in parts[1:-1]:
            directory = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            os.close(parent)
            parent = directory
        descriptor = os.open(parts[-1], flags | os.O_NOFOLLOW | os.O_NONBLOCK, 0o644, dir_fd=parent)
        try:
            if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                raise OSError("input is not a regular file")
            return os.fdopen(descriptor, "wb" if flags & os.O_WRONLY else "rb")
        except Exception:
            os.close(descriptor)
            raise
    finally:
        os.close(parent)


def stage_input(source_path, target, expected_size=None):
    """Stages only the fixed upload or an admitted gzip child, checking expanded length before it can be analysed."""
    child = source_path != "/in/sample"
    match = CHILD_PATH.fullmatch(source_path) if child else None
    if child and (not match or int(match[1]) > 50 or int(match[2]) >= 50):
        raise OSError("invalid controller child path")
    if not STAGED_PATH.fullmatch(target) or (child and not target.startswith("/tmp/dt/")):
        raise OSError("invalid staging path")
    cap = CHILD_BYTES if child else UPLOAD_BYTES
    if expected_size is not None and (type(expected_size) is not int or not 0 <= expected_size <= cap):
        raise OSError("invalid admitted input size")
    if child and expected_size is None:
        raise OSError("child input requires its admitted size")
    limit = cap if expected_size is None else expected_size
    try:
        with open_regular(source_path) as handle:
            if not child and os.fstat(handle.fileno()).st_size > limit:
                raise OSError("input exceeds staging allowance")
            source = gzip.GzipFile(fileobj=handle, mode="rb") if child else handle
            try:
                with open_regular(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC) as out:
                    copied = 0
                    while chunk := source.read(min(1024 * 1024, limit - copied + 1)):
                        copied += len(chunk)
                        if copied > limit:
                            raise OSError("expanded input exceeds admitted size or staging allowance")
                        out.write(chunk)
                    if expected_size is not None and copied != expected_size:
                        raise OSError("expanded input differs from admitted size")
                    os.fchmod(out.fileno(), 0o644)
            finally:
                if child:
                    source.close()
    except (EOFError, zlib.error) as error:
        raise OSError("invalid gzip child") from error


def parse_args(extra=()):
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", required=True)
    parser.add_argument("--file", required=True)
    for name in extra:
        parser.add_argument(f"--{name}", default="")
    return parser.parse_args()


def run(command, timeout, **kwargs):
    """Runs `command`; returns {code, stdout, stderr, timedOut}. Never raises for a non-zero exit, a timeout or a missing binary."""
    try:
        done = subprocess.run(command, capture_output=True, timeout=timeout, text=True, errors="replace", **kwargs)
        return {"code": done.returncode, "stdout": done.stdout, "stderr": done.stderr, "timedOut": False}
    except subprocess.TimeoutExpired as error:
        out = error.stdout.decode("utf-8", "replace") if isinstance(error.stdout, bytes) else (error.stdout or "")
        return {"code": 124, "stdout": out, "stderr": "", "timedOut": True}
    except OSError as error:
        return {"code": 127, "stdout": "", "stderr": error.__class__.__name__, "timedOut": False}


def tail(text):
    return (text or "").strip()[-TAIL_CHARS:]


def finish(args, started=True, exit_code=0, **fields):
    """Prints the one status line the controller parses (the last line of stdout) and exits."""
    shown = args.file.removeprefix("/home/dana/").lstrip("/")
    status = {"detonationRunner": 1, "kind": args.kind, "started": started, "file": shown, "exitCode": exit_code, **fields}
    sys.stdout.write("\n" + json.dumps(status, separators=(",", ":")) + "\n")
    sys.stdout.flush()
    sys.exit(exit_code)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--size", type=int)
    options = parser.parse_args()
    try:
        stage_input(options.source, options.target, options.size)
    except OSError:
        sys.exit(65)
