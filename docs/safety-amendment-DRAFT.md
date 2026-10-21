# Draft amendment to `safety.md` (SPEC §14 item 1)

**Status: draft, awaiting explicit user approval.** Until approved, no code runs an upload or a sample. Only an explicitly approved amendment may be merged into `safety.md`; this draft changes no active policy. Approval of the base amendment does not approve the separate Wine exception below, public deployment, spending, or test execution. The current session's no-tests restriction remains in force.

## Replace

- §1, last sentence "Never add malware samples, exploit payloads, vulnerable real products, binaries, or archives." becomes: "Never add malware samples, exploit payloads or vulnerable real products. The only samples are the project-written demo files of SPEC §11 and the harmless test binaries and archives built from source for SPEC §12."
- §2 heading and first sentence stay. Add: "The detonation sandbox (section 7) runs files that visitors upload. It never fetches a file."

## 7. The detonation sandbox

The Detonation Ocean app accepts one file per job from a visitor and runs, emulates or inspects it. This is the only path in the project that executes untrusted code. It is allowed only under every rule below.

### Allowed

- Executing a visitor's upload, or a project-written demo sample, inside a detonate container.
- Running model-written Python inside an analyse container.
- Emulating Windows code with separately licence-checked, approved tools inside the required sandbox. This is not approval to ship every tool named in earlier plans. Wine requires the separate decision below.

### Required, every time

| Rule | Detail |
|---|---|
| Sandbox | gVisor is the default boundary, with `--network none`, read-only root, `--cap-drop ALL`, `no-new-privileges`, non-root user and resource caps (SPEC §6.3). Every container must pass the isolation check before it starts. Only an explicitly approved Wine exception below may use a different runtime |
| No secrets or unrelated host data | Containers get only the SPEC §7.2 environment allowlist and the fixed per-job mounts permitted by §6.3. No real API key, credential or capability token reaches a container. No Docker socket, unrelated host path or additional controller data is mounted |
| Synthetic data only | The sandbox home holds only the synthetic seed profile. Honey credentials are fake and carry a per-job canary token |
| No network | No route out. Connection attempts are recorded as evidence and fail |
| Teardown | Every container, volume and the upload are removed and confirmed absent. An unconfirmed teardown stops new uploads (SPEC §7.4) |
| Model output | Untrusted. Used only as a script for the analyse container and as escaped display text. It never chooses flags, mounts, network or the verdict |
| Where | Local development: Docker Engine with gVisor in WSL2 on the operator's machine. Public: one dedicated Vultr VM holding nothing but this app (after spend approval) |
| Consent | The uploader must confirm they own the file or have permission, and that it will be executed |

### Still forbidden

- Acquiring, downloading or storing real malware for testing. Tests use only the SPEC §11 samples, which refuse to run unless `DETONATION_SANDBOX=1` and `/home/dana/Documents` exist.
- Running any upload outside the sandbox, on the host, on a real Windows or macOS machine, or in the visitor's browser.
- Following links or contacting any host from the sandbox. Live URL scanning.
- Keeping uploads after the job. Serving an upload back to anyone.
- Publishing file names, hashes or job details. The public ocean shows only batched counts.
- Weakening a containment flag to make a sample work. If a tool (for example Wine) cannot run under gVisor, the fallback in SPEC §6.6 needs a separate user decision and is stated in the receipt.

## Decision needed with this approval: Wine (SPEC §14 item 11)

Tested on 2026-10-08 ([`evidence/gvisor-wsl/PIDS-AND-WINE.md`](evidence/gvisor-wsl/PIDS-AND-WINE.md) Part B): Wine 8.0, 10.0 and 11.0 all fail under gVisor (systrap, ptrace and kvm platforms). WineHQ 11.0 runs its built-ins under `runc` with the tightened profile `deploy/detonation/seccomp-wine.json` (294 of Docker's 380 default syscalls) and the other §6.3 flags. Choose one:

- **(a) Wine step under `runc`** with every other §6.3 flag, a tight seccomp profile, no network and the synthetic profile. The receipt says "Ran under Wine without gVisor". Weaker: no gVisor kernel boundary and no gVisor syscall trace for that step. Needed for AT-22–AT-24.
- **(b) Drop the Wine step.** Windows files are emulated or inspected only. AT-22–AT-24 cannot pass.

Until you explicitly choose (a), Wine stays disabled. A flag is an implementation gate, not evidence of approval or containment. Even after a choice, unresolved containment findings and required verification must be closed before release. No flag is enabled, and no tests or runtime probes are authorized by this draft.
