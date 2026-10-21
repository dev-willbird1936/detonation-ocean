# Demo sample for Detonation Ocean. Refuses to run outside the sandbox.
import os
import shutil
import sys
import tempfile

if os.environ.get("DETONATION_SANDBOX") != "1" or not os.path.isdir("/home/dana/Documents"):
    sys.exit(0)

folder = tempfile.mkdtemp(prefix="self-temp-", dir="/tmp")
paths = [os.path.join(folder, f"part-{index}.txt") for index in range(3)]
for path in paths:
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("temporary working data\n")
for path in paths:
    os.remove(path)
shutil.rmtree(folder)
