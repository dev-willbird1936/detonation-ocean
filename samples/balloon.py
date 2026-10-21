# Demo sample for Detonation Ocean. Refuses to run outside the sandbox.
import os
import sys

if os.environ.get("DETONATION_SANDBOX") != "1" or not os.path.isdir("/home/dana/Documents"):
    sys.exit(0)

blocks = []
while True:
    blocks.append(bytearray(64 * 1024 * 1024))
