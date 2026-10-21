#!/usr/bin/env python3
"""Wine step of detonation-ocean/wine (docs/SPEC.md 6.6 "Run under Wine"): runs the file with Wine in a pre-built prefix and prints the
evidence the controller maps (backend/detonation/wine.mjs). The controller owns the container wall clock and the flags.

    wine_run.py --kind exe|dll|msi|bat|wsh|hta|builtin --file /in/sample [--ext EXT] [--source PATH --source-size N] [--export NAME]... [--builtin NAME]

The container is read-only with a 64 MB /tmp and a 192 MB /prefix tmpfs: the prefix (Wine's registry, C: drive) is copied there at the
start and is gone when the container stops, so every diff is computed here. The Wine server runs persistent and is started and warmed
up first, so the WINEDEBUG log holds only the program and what it started. Files the program writes to its shell folders land in the
job's home volume through the prefix's symlinks and are diffed by the collector, not here.
"""
import base64
import os
import re
import shutil
import subprocess
import sys
import threading
import time

import wine_evidence as evidence
from runnerlib import finish, parse_args, stage_input

PREFIX_SOURCE = "/opt/wineprefix-src"
PREFIX = "/prefix"
SCRATCH = "/tmp/dt"
SEED_REGISTRY = "/tmp/seed-reg"
FRAMEBUFFER = "/tmp/fb/Xvfb_screen0"
DISPLAY = ":99"
RUN_LIMIT = 12.0  # seconds a program may run; the container's own wall clock is 30 s
SHOT_TIMES = (2.0, 10.0)
FAST_FAIL = 2.0  # SPEC 6.6: a program that exits within 2 s with a Wine error "could not run"
LOG_CAP = 4 * 1024 * 1024
STDOUT_CAP = 4096
MAX_EXPORTS = 3
MAX_SHOT = 1024 * 1024
EXPORT_NAME = re.compile(r"^[A-Za-z0-9_@#?$.-]{1,64}$")
# Wine built-ins the controller's own tests run (never a name from an upload): the harness check.
BUILTINS = {"cmd-echo": ["cmd", "/c", "echo", "hi"], "reg-wine": ["reg", "query", "HKCU\\Software\\Wine"]}
COMMANDS = {
    "exe": lambda path: [path],
    "msi": lambda path: ["msiexec", "/i", path, "/qn"],
    "bat": lambda path: ["cmd", "/c", path],
    "wsh": lambda path: ["wscript", path],
    "hta": lambda path: ["mshta", path],
}


def windows_path(path):
    return "Z:" + path.replace("/", "\\")


def wine_env(debug):
    return {
        "PATH": "/opt/wine-stable/bin:/usr/local/bin:/usr/bin:/bin", "HOME": "/home/dana", "USER": "dana", "LANG": "C.UTF-8", "DETONATION_SANDBOX": "1",
        "JOB_ITEM": os.environ.get("JOB_ITEM", "0"), "WINEPREFIX": PREFIX, "WINEARCH": "wow64", "DISPLAY": DISPLAY, "XDG_RUNTIME_DIR": "/tmp/xdg",
        "WINEDLLOVERRIDES": "mscoree,mshtml=,winemenubuilder.exe=d", "WINEDEBUG": debug,
        # Wine and fontconfig write caches, icons and MIME data under XDG_*: keep them out of the home volume (the file diff).
        "XDG_CACHE_HOME": "/tmp/xdg-cache", "XDG_DATA_HOME": "/tmp/xdg-data", "XDG_CONFIG_HOME": "/tmp/xdg-config",
    }


def quiet(command, timeout):
    """A Wine helper step (server, boot, kill): returns the exit code, 124 on a timeout, 127 when the binary is missing."""
    try:
        return subprocess.run(command, env=wine_env("-all"), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout).returncode
    except subprocess.TimeoutExpired:
        return 124
    except OSError:
        return 127


def stage_sample(args):
    """Only /in/sample or a controller-owned gzip child may be copied; reject aliases, links and special files."""
    if args.file != "/in/sample":
        raise OSError("invalid controller input path")
    os.makedirs(SCRATCH, exist_ok=True)
    target = os.path.join(SCRATCH, f"sample.{args.ext}")
    stage_input(args.source or args.file, target, int(args.source_size) if args.source_size else None)
    return target


def commands_for(args, path):
    if args.kind == "builtin":
        return [BUILTINS[args.builtin]]
    if args.kind == "dll":
        names = [name for name in args.export[:MAX_EXPORTS] if EXPORT_NAME.match(name)] or ["DllMain"]
        return [["rundll32", f"{windows_path(path)},{name}"] for name in names]
    return [COMMANDS[args.kind](path if args.kind == "exe" else windows_path(path))]


def take_shot(label, shots):
    png = evidence.screenshot(FRAMEBUFFER)
    # Three of these travel base64 on stdout, which the controller caps (stages.mjs WINE_STDOUT_BYTES); a picture over the limit is dropped.
    if png and len(png) <= MAX_SHOT:
        shots.append({"name": label, "data": base64.b64encode(png).decode("ascii")})


def start_xvfb():
    os.makedirs("/tmp/fb", exist_ok=True)
    os.makedirs("/tmp/xdg", mode=0o700, exist_ok=True)
    server = subprocess.Popen(["Xvfb", DISPLAY, "-screen", "0", "1280x800x24", "-nolisten", "tcp", "-fbdir", "/tmp/fb"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline and not os.path.exists(FRAMEBUFFER):
        time.sleep(0.05)
    return server


def run_command(command, digest, shots, first, deadline):
    """Runs one Wine command with the trace on. Returns {exitCode, seconds, timedOut, stdout}; screenshots are taken at 2 s and 10 s into the first command."""
    process = subprocess.Popen(
        ["wine", *command], env=wine_env("+pid,+loaddll,+process,+relay"), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        start_new_session=True,
    )
    captured = bytearray()

    def read_stdout():
        for chunk in iter(lambda: process.stdout.read(1024), b""):
            if len(captured) < STDOUT_CAP:
                captured.extend(chunk[:STDOUT_CAP - len(captured)])

    def read_stderr():
        for raw in process.stderr:
            digest.feed(raw.decode("utf-8", "replace").rstrip("\r\n"))

    threads = [threading.Thread(target=read_stdout, daemon=True), threading.Thread(target=read_stderr, daemon=True)]
    for thread in threads:
        thread.start()
    started = time.monotonic()
    pending = list(SHOT_TIMES) if first else []
    timed_out = False
    while process.poll() is None:
        elapsed = time.monotonic() - started
        if pending and elapsed >= pending[0]:
            take_shot(f"{int(pending.pop(0))}s", shots)
        elif elapsed >= min(RUN_LIMIT, deadline - started):
            timed_out = True
            break
        else:
            time.sleep(0.05)
    seconds = round(time.monotonic() - started, 2)
    if first:
        take_shot("exit", shots)
    code = process.poll()
    if timed_out:
        quiet(["wineserver", "-k"], 6)
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
    for thread in threads:
        thread.join(timeout=2)
    return {"exitCode": code if code is not None else -9, "seconds": seconds, "timedOut": timed_out, "stdout": captured.decode("utf-8", "replace")}


def kill_everything():
    """The program's processes are children of the Wine server, not of this script: end every other process in the container."""
    for _ in range(3):
        for name in os.listdir("/proc"):
            if name.isdigit() and int(name) != os.getpid():
                try:
                    os.kill(int(name), 9)
                except OSError:
                    pass
        time.sleep(0.1)
        try:
            while os.waitpid(-1, os.WNOHANG)[0]:
                pass
        except ChildProcessError:
            break


def main():
    args = parse_args(("ext", "source", "source-size", "builtin", "export"))
    args.export = [part for part in args.export.split(",") if part]
    args.ext = args.ext or ("exe" if args.kind == "builtin" else args.kind)
    if args.kind != "builtin" and args.kind not in COMMANDS and args.kind != "dll":
        finish(args, started=False, exit_code=64)
    if args.kind == "builtin" and args.builtin not in BUILTINS:
        finish(args, started=False, exit_code=64)
    if args.file != "/in/sample" or not re.fullmatch(r"[a-z0-9]{1,8}", args.ext):
        finish(args, started=False, exit_code=64)

    began = time.monotonic()
    timings = {}
    try:
        path = stage_sample(args) if args.kind != "builtin" else ""
    except (OSError, ValueError):
        finish(args, started=False, exit_code=65)
    xvfb = start_xvfb()
    shutil.copytree(PREFIX_SOURCE, PREFIX, symlinks=True, dirs_exist_ok=True)
    timings["prefix"] = round(time.monotonic() - began, 2)
    # Two starts of the same prefix: the first is flushed to disk and copied as the registry to compare against, so what Wine rewrites at
    # every start (computer name, device enumeration) is in both. The second stays up, warm and persistent: the traced program then
    # starts no boot of its own and the WINEDEBUG log holds only the program.
    quiet(["wineserver", "-p"], 10)
    quiet(["wine", "wineboot", "--init"], 30)
    quiet(["wineserver", "-k"], 4)
    quiet(["wineserver", "-w"], 4)
    os.makedirs(SEED_REGISTRY, exist_ok=True)
    for name in evidence.HIVES:
        if os.path.exists(os.path.join(PREFIX, name)):
            shutil.copyfile(os.path.join(PREFIX, name), os.path.join(SEED_REGISTRY, name))
    quiet(["wineserver", "-p"], 10)
    booted = quiet(["wine", "wineboot", "--init"], 30)
    timings["boot"] = round(time.monotonic() - began, 2)
    before = evidence.tree_snapshot(os.path.join(PREFIX, "drive_c"))

    digest = evidence.LogDigest(LOG_CAP)
    shots = []
    runs = []
    deadline = time.monotonic() + RUN_LIMIT + 3
    for index, command in enumerate(commands_for(args, path)):
        if time.monotonic() >= deadline:
            break
        runs.append(run_command(command, digest, shots, index == 0, deadline))
    quiet(["wineserver", "-k"], 4)
    quiet(["wineserver", "-w"], 4)
    kill_everything()
    xvfb.poll()

    summary = digest.digest()
    last = runs[-1] if runs else {"exitCode": None, "seconds": 0.0, "timedOut": False, "stdout": ""}
    seconds = round(sum(run["seconds"] for run in runs), 2)
    wine = {
        **summary,
        "exitCode": last["exitCode"], "seconds": seconds, "timedOut": any(run["timedOut"] for run in runs), "stdout": "".join(run["stdout"] for run in runs)[:STDOUT_CAP],
        "limitSeconds": RUN_LIMIT, "booted": booted == 0, "commands": len(runs), "timings": timings,
        "registry": evidence.registry_diff(SEED_REGISTRY, PREFIX),
        "files": evidence.tree_diff(before, evidence.tree_snapshot(os.path.join(PREFIX, "drive_c")), os.path.join(PREFIX, "drive_c")),
        "screenshots": shots,
    }
    finish(args, wine=wine)


main()
