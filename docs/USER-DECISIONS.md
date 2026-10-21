# Decisions only the user can make

## Live deployment (2026-10-21)

Detonation Ocean runs on one Vultr Cloud Compute VM (`vc2-2c-4gb`, `lax`, id `e02bb0cd-d977-4339-b719-7aef383efda0`, `149.28.93.208`) at https://149-28-93-208.sslip.io (Let's Encrypt certificate; free `sslip.io` name, no domain bought). The user approved proceeding on 2026-10-21; items 1 to 6 below were treated as approved for this deployment. Item 2 (Wine on `runc`) stays off. Items 7 to 10 are not done.

- Evidence: `clean-chart.py` gave Sunlight; `invoice.py` gave Trench (`steal-credentials`, `exfil-attempt`, `resource-hijack`, `system-wipe`, `destroy-files`; fork bomb stopped by `pids-limit`). Teardown was confirmed, no containers or volumes remained, and `/api/health` stayed `acceptingJobs:true`. Serverless Inference wrote the analysis code and the explanation (`deepseek-v4.1-flash`, reasoning effort `minimal`, cap 300 calls per day).
- Access gate: Caddy basic auth (`/etc/caddy/access.caddy` on the VM, user `judge`, password in `~/.brain/secrets/detonation-ocean-judge-login.txt`) guards every route except `/api/jobs/<id>…`, which carry their own bearer token. To make the site open to everyone, delete the `import /etc/caddy/access.caddy` line in `/etc/caddy/Caddyfile` and `systemctl reload caddy`.
- Vultr use policy (https://www.vultr.com/legal/use-policy/, read 2026-10-21): it does not mention malware analysis or security sandboxes. It prohibits "phishing", "viruses, Trojan horses, worms" as content, probing systems without permission, and network connections without permission. This project uses only project-written harmless samples, network-disabled containers and no outbound traffic from detonations, so it is allowed under the text as written, but there is no explicit carve-out. A public upload box could receive real malware from a visitor; the login gate and per-job deletion limit that. Item 3 is closed on the user's rule "not stated against means allowed"; Vultr was not contacted.
- SSH: key `~/.ssh/codex_vultr_ed25519` (registered as `detonation-ocean-hackathon`); the VM firewall allows port 22 only from the operator IP `84.64.188.73`. Re-run `setup.sh --operator-ip <ip>` if that changes.
- Spend: one VM plus per-use inference. Teardown steps are in `deploy/vultr-vm/README.md`.
- Not done: key rotation (the user said to defer it), the public GitHub repository, the demo video, and the hackathon submission form.

These approvals block live execution and public deployment. Source implementation exists, but containment remediation and acceptance evidence remain incomplete; M0–M6 are not complete.

**Current session: no tests.** Code edits and read-only review may continue. Approval of an item below does not lift this session's restriction on tests or runtime probes.

| # | Decision | Unblocks | How to act |
|---|---|---|---|
| 1 | Approve the safety amendment ([`safety-amendment-DRAFT.md`](safety-amendment-DRAFT.md)), SPEC §14 item 1 | M0; then the gated sample tests for M1 (AT-2–AT-8), M2 live (AT-12 with real samples), M3 live replay of `invoice.py`, M4 one-sample-per-type, M4b (AT-19–AT-24) | Approve the amendment explicitly. Execution remains off this session; any later run also requires review of the current containment code and separately authorized verification |
| 2 | Wine step on `runc` + `seccomp-wine.json` (option a) or drop Wine (option b), SPEC §14 item 11 | AT-22–AT-24 | Choose a or b. Option a permits the proposed fallback only after containment review; the flag remains off this session |
| 3 | Vultr acceptable use policy for malware analysis, SPEC §14 item 2 | M5 | Confirm with Vultr |
| 4 | Serverless Inference models and prices, SPEC §14 item 4 | M5 (AT-18) | Confirm which code model to use |
| 5 | Spend approval: one Cloud Compute VM (2 vCPU / 4 GB minimum) and inference, SPEC §14 item 5 | M5 | Approve; then follow [`deploy/vultr-vm/README.md`](../deploy/vultr-vm/README.md) |
| 6 | Hackathon rules on work before the build week, SPEC §14 item 6 | M6 | Confirm |
| 7 | Create the public GitHub repository and publish, SPEC §14 item 9 | M6 (AT-32 on a public clone) | Approve the repo name and visibility |
| 8 | macOS shell (unlicensed mirror) and Win11React artwork, SPEC §14 items 7 and 13 | Public deployment | Replace, or approve serving only the project desktop |
| 9 | Project licence (MIT proposed in `LICENSE`) | M6 | Confirm |
| 10 | RetroDiffusion top-up of about $4.25, optional | Native 14-frame animations for the 17 new sprites (procedural stand-ins are in place) | Top up, or keep the stand-ins |

## Engineering work still open

These are not approval requests and must not be hidden by the decision list above:

- The scoped containment source corrections and independent code-only reviews are complete; they do not establish runtime acceptance, and the existing images do not include the current runner changes. The current no-tests restriction remains in force; older results do not verify later code changes.
- Add complete Python artifact-hash locks, including the analyse image's transitive dependencies, and establish verification for the separate browser download. Some APT support packages remain unversioned.
- Complete each released image's licence and corresponding-source inventory. The current recipes copy selected notices only; see [`THIRD-PARTY.md`](../THIRD-PARTY.md).
- Keep milestone acceptance pending until its required evidence exists. A source-only review does not establish runtime containment or public-deployment readiness.

## Housekeeping on this machine

- Drive D: is full and the `Ubuntu-24.04` WSL distro there went read-only. Nothing was deleted on D:. Free space, then `wsl --terminate Ubuntu-24.04`.
- The sandbox was prepared in a dedicated WSL distro `detonation-ocean` on C: (`deploy/local-wsl/setup.sh`). The last recorded free space was about 37 GB; it has not been rechecked in this session.
