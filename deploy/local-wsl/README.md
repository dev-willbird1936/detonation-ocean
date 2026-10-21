# Local run: Docker + gVisor in WSL

The detonation controller must run where `/usr/bin/docker` and `/var/log/runsc` are both reachable, because it reads the
`runsc-trace` debug log of each detonate container and deletes it after parsing. On Windows that means inside a WSL2 distro.
Docker Desktop is not used.

## Distro

Use the dedicated distro `detonation-ocean` (Ubuntu 24.04, systemd on, run as root). The older `Ubuntu-24.04` distro is not used.

```
wsl -d detonation-ocean -u root -- bash -lc '<command>'
```

One-time set-up, inside the distro:

1. `bash deploy/local-wsl/setup.sh` installs Docker Engine 29.8.2 and gVisor `runsc` 20261012.0 and registers the `runsc` and
   `runsc-trace` runtimes from `deploy/vultr-vm/daemon.json` (evidence: `docs/evidence/gvisor-wsl/REPORT.md`).
2. Node 22 or newer (the project needs Node ≥ 22; Ubuntu's apt Node is 18):
   `curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs`
3. `bash deploy/detonation/build-images.sh` builds `detonation-ocean/{detonate,collect,analyse}` and rewrites
   `deploy/detonation/images.lock.json`. Containers run with `--pull never`, so build before the first job.

Under Git Bash set `MSYS_NO_PATHCONV=1` before `wsl`, and refer to the project as
`/mnt/c/SyncedProjects/Websites/Vultr-Phishing-Sandbox`.

## Local demo with uploads

`start-hackathon-demo.bat` (project root) runs `start-local.sh` in this distro. It checks readiness with `check.sh`
(Docker, `runsc-trace`, Node 22+, and every image matching `images.lock.json`), clears all Vultr and inference settings,
resets the ocean from `data/demo-ocean-state.json` into `/var/lib/detonation-ocean-local`, and serves
http://127.0.0.1:4173/ with uploads on. With the model off, the report says "Model unavailable" and the verdict comes from
the rule engine alone. `node tools/record-upload.mjs <file> <out.mp4>` records one upload through it.

## Tests

| Where | Command | Covers |
|---|---|---|
| Windows | `node --test tests/detonation-*.test.mjs` | Everything that needs no Docker; `detonation-live.test.mjs` skips |
| `detonation-ocean` | `cd /mnt/c/SyncedProjects/Websites/Vultr-Phishing-Sandbox && node --test tests/detonation-live.test.mjs` | AT-1, AT-9, AT-10, AT-16 and an unsupported upload through the real stages, with harmless commands only |

The live file skips itself unless `docker info` works, the `runsc-trace` runtime is registered, `/var/log/runsc` exists and the
three images are built.

The second block of `tests/detonation-live.test.mjs` (AT-2 to AT-8) executes the files in `samples/` inside the sandbox. It stays
skipped unless `DETONATION_LIVE_SAMPLES=1` is set; do not set it before the safety amendment is approved.

## How the real stages work

- **detonate**: `docker create/start` of `detonation-ocean/detonate` under `runsc-trace`. The runner takes the job kind
  (`py`, `sh`, `node`) as its argument. Any other type runs with kind `inspect`, which the runner rejects (exit 64) without
  touching the sample.
- **parseTrace**: reads `/var/log/runsc/<container id>/*.boot.txt` (at most 20 MB), keeps the sandboxed sample's syscalls from
  the interpreter start onward (rule in `backend/detonation/trace.mjs`), then deletes the log directory.
- **collect**: the collector prints `diff.json` to stdout (`--out /dev/stdout`) because `/out` is a tmpfs: its files are gone
  once the container stops and `docker cp` cannot read them.
- **runScript** (analysis loop): writes `evidence.json`, `diff.json`, `static.json` and `script.py` into the job directory and runs
  the `analyse` container. Artifacts such as `timeline.png` are not returned yet, for the same tmpfs reason; the harness would
  have to write them to stdout.
- Process limit: under gVisor `--pids-limit` shows as `ENOMEM` on process creation or a sandbox panic, not as `EAGAIN`
  (REPORT section 7). The parser counts failed clone-family calls as `clone-eagain` and flags the panic as `pids-limit`.
