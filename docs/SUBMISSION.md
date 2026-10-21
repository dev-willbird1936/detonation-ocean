# Vultr Agent Rush: submission material (Challenge 1, Blast Radius Zero)

Draft text for the lablab.ai form. Build window: 3 to 8 November 2026. The form, the public repository and the video are not done yet; see "Open items".

## Title and short description

**The Detonation Ocean.** Upload a file; a Vultr-hosted controller runs it in disposable gVisor sandboxes, a Vultr Serverless Inference model writes and explains the analysis, and the result appears as a creature in a pixel-art ocean.

## Long description

A visitor uploads one file. The controller on a Vultr Cloud Compute VM identifies it by content, then detonates, emulates or inspects it in a gVisor container with no network, a read-only root, all capabilities dropped and a non-root user. A second container diffs the seeded home directory. A model on Vultr Serverless Inference then writes Python that analyses the evidence; that code runs in a third container, and stderr goes back to the model on failure (three tries at most). A rule engine, not the model, turns the evidence into findings, a depth (Sunlight to Abyss) and a behaviour family. Every container, volume and upload is removed and the removal is confirmed in a receipt shown to the user.

This is challenge pattern A (model writes code, code runs in a container, real output returns, model explains) with containment as the product: the thing running in the sandbox is untrusted by design.

## Architecture

Browser, Caddy (TLS, login), Node controller, Docker with gVisor (`runsc`, `runsc-trace`), Vultr Serverless Inference over HTTPS. Diagram: [`architecture.svg`](architecture.svg). Trust boundaries: [`SPEC.md`](SPEC.md) section 3.

## Containment, mapped to the four required properties

| Property | How it is met |
|---|---|
| Process isolation | gVisor, `--network none`, read-only root, cap-drop ALL, user 10001; the job fails if `docker inspect` shows a missing flag |
| Secret hygiene | Containers get an allowlisted environment only (`secretEnvVars: 0` in every receipt); the inference key stays in the controller's systemd environment |
| Resource limits | 512 MiB memory, 1 CPU, 128 to 512 tasks, tmpfs and home-volume quotas, output and time caps |
| Lifecycle | Receipt lists each container with `removedAt`; unconfirmed removal closes the door (`acceptingJobs:false`) |

## Containment moment for the video

Upload `samples/invoice.py`. It tries to steal credentials, exfiltrate, hijack resources, wipe the system, and fork-bomb. The run ends at depth Trench with five findings, the fork bomb stops at the pids limit, and the receipt shows every container removed. The host and the VM stay unchanged (the host canary check passes).

## Live evidence, 2026-10-21

- Site: https://149-28-93-208.sslip.io (Let's Encrypt), VM `vc2-2c-4gb`, Los Angeles. `/api/health` returned `{"ok":true,"acceptingJobs":true,"queueDepth":0}`.
- `clean-chart.py`: Sunlight; model-written analysis code and explanation present; three containers (`runsc-trace`, `runsc`, `runsc`), all `network: none`, all removed.
- `invoice.py`: Trench with `steal-credentials`, `exfil-attempt`, `resource-hijack`, `system-wipe`, `destroy-files`; teardown confirmed ([`USER-DECISIONS.md`](USER-DECISIONS.md)).
- Model: `deepseek-v4.1-flash`, reasoning effort minimal, 300 calls a day cap.
- Re-check at 15:58 UTC the same day: `clean-chart.py` submitted on the VM gave job `j-3a3d7bb30d7d33ea`, stages `received` to `done` in 18 s, model-written analysis code in `report.analysis.attempts`, then `teardownConfirmed:true`, `uploadDeleted:true`, `hostCanary:unchanged`. A second run at 15:54 behaved the same. The public origin's per-IP hourly limit refused a further probe (HTTP 429), as designed.

- Re-check at about 16:10 UTC: services `detonation-ocean`, `caddy` and `docker` active on the VM; Docker runtimes `runc`, `runsc`, `runsc-trace`; a direct Vultr Serverless Inference call (`deepseek-v4.1-flash`) answered; job `j-311f487d4c6e7a76` (a tiny `statistics.mean` script) reached `done` with one model-written analysis attempt and an explanation, `teardownConfirmed:true`, `uploadDeleted:true`, `hostCanary:unchanged`.

## Judge access

The site sits behind a Caddy login (user `judge`). Put the password in the form's private notes, not in this repository. The login does not cover `/api/jobs/<id>`, which carries its own bearer token. Removing the gate is a one-line change recorded in `USER-DECISIONS.md`; it is kept on because a public upload box could receive real malware from a visitor.

## Open items

1. Public GitHub repository: needs the user's approval of name and visibility, and the unlicensed macOS shell and Win11React artwork replaced or withheld (SPEC section 14 items 7 and 13).
2. Recorded demo video with the containment moment above.
3. Submission form: cover image, slides, tags.
4. Inference key rotation (the user deferred it).
5. Teardown after judging: `deploy/vultr-vm/README.md`, "Teardown after the hackathon".
