"""Analysis harness (docs/SPEC.md section 8): runs the model-written /in/script.py with cwd /out.

The controller owns the 30 s cap and the container flags. The script's exit code is the container's exit code,
and its stderr passes through so the controller can send the last 4 KB back to the model. /out is a tmpfs that is
unreadable once the container stops, so the harness sends the files the script wrote back on stdout: the last line
is {"artifacts": {"<name>": "<base64>"}}. The script's own stdout goes to stderr. Allowlisted names only, 8 MB in total.
"""
import base64
import contextlib
import json
import os
import re
import runpy
import sys
import traceback

SCRIPT = "/in/script.py"
OUT = "/out"
MAX_BYTES = 8 * 1024 * 1024
ARTIFACT_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(?:png|svg|json|txt|csv)$")


def collect_artifacts():
    artifacts = {}
    total = 0
    for name in sorted(os.listdir(OUT)):
        path = os.path.join(OUT, name)
        if not ARTIFACT_NAME.match(name) or os.path.islink(path) or not os.path.isfile(path):
            continue
        size = os.path.getsize(path)
        if total + size > MAX_BYTES:
            continue
        with open(path, "rb") as handle:
            artifacts[name] = base64.b64encode(handle.read()).decode("ascii")
        total += size
    return artifacts


os.chdir(OUT)
sys.argv = [SCRIPT]
status = 0
try:
    with contextlib.redirect_stdout(sys.stderr):
        runpy.run_path(SCRIPT, run_name="__main__")
except SystemExit as stop:
    if stop.code is None or stop.code == 0:
        status = 0
    elif isinstance(stop.code, int):
        status = stop.code
    else:
        print(stop.code, file=sys.stderr)
        status = 1
except BaseException:
    traceback.print_exc()
    status = 1

sys.stderr.flush()
sys.stdout.write("\n" + json.dumps({"artifacts": collect_artifacts()}) + "\n")
sys.stdout.flush()
sys.exit(status)
