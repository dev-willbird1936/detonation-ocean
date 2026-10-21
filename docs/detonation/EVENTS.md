# Job event stream contract

`GET /api/jobs/<id>/events` (SPEC §4.2) sends server-sent events. Every event has an increasing integer `id` (for `Last-Event-ID` replay), an `event:` name, and a JSON `data:` object. The job page, the replay and the tests use only these events.

| `event` | `data` | When |
|---|---|---|
| `stage` | `{stage, at, attempt?}` — `stage` is a SPEC §5.1 state (`received`, `typed`, `queued`, `detonating`, `collecting`, `analysing`, `explaining`, `verdict`, `tearing_down`, `done`, `failed`) | Each state change. `attempt` is set for `analysing` |
| `typed` | `{detectedType, claimedExtension, path, species, label, mismatch, sizeTier, replayId?}` — `label` is "Executed on Linux", "Ran under Wine", "Emulated" or "Inspected". `replayId` (40 characters of `a-z2-7`, random per job) names the desktop replay: the job page opens `/desktop.html?job=<replayId>`. It is present only when the server has a desktop event hub | After type detection |
| `evidence` | One normalised evidence item ([`EVIDENCE.md`](EVIDENCE.md)) | As collected, in order |
| `signal` | `{id, evidenceIds}` | When the rule engine first raises a Twilight signal |
| `finding` | `{id, depth, family, creature, evidenceIds}` | When the rule engine first raises a finding; the UI plays the bite or eat when it arrives |
| `analysis-attempt` | `{n, code, exitCode, stderr}` | Each analysis-loop attempt (SPEC §8) |
| `parser-attempt` | `{n, code, exitCode, stderr, item?}` | Each generic-parser attempt (SPEC §6.6). `item` names a child item; it is absent for the upload |
| `coverage` | `{item, parent, steps: [{step, status, detail}]}` | Coverage list update (SPEC §6.6). One event per item: `item` is 0 for the upload, `parent` is the archive or email item it came from (null for the upload). `step` is `identify`, `unwrap`, `run`, `wine`, `emulate`, `static`, `generic` or `parser` ([EVIDENCE.md](EVIDENCE.md#coverage-events)) |
| `verdict` | The report `verdict` object (SPEC §5.4) | Once, from the rule engine |
| `explanation` | `{text, modelAvailable}` | Once |
| `receipt` | The receipt (SPEC §7.5) | After teardown. A receipt with a Wine container carries `notes: ["Ran under Wine without gVisor: …"]`. Each Wine entry records runtime `runc`, `pidsLimit` 128 and `appArmor` (`docker-default` or `unavailable`, meaning no AppArmor protection). Other receipt roles record `pidsLimit` 512; the `nproc` cap is 128 for both paths |
| `report` | The full report (SPEC §5.4), including `coverage: [{item, parent, steps}]` | Last event of a `done` job; coverage is usable without earlier events |
| `error` | `{message}` — never a path, stack trace or container output | On `failed` |

Rules:

- Events are stored per job in memory for the job's lifetime and replayed from `Last-Event-ID`.
- `detail` strings and model text are untrusted; clients render them as text, never HTML.
- Coverage stays private to the job. The report retains every emitted item's coverage in first-arrival order, including the upload (`item: 0`, `parent: null`). A repeated update replaces the same item without changing its position. Clients keep an itemless legacy list when a legacy report omits coverage, but a present report coverage field is authoritative. Malformed records or steps never imply a check ran.
- The receipt UI says "Sandbox destroyed · Host canary unchanged" only for confirmed teardown and an unchanged canary. This observation concerns only the canary file, not proof that the whole host was untouched. Missing or changed canary results and unconfirmed teardown remain explicit. Receipt notes and each Wine container's recorded runtime and AppArmor state are displayed as text; absent or unrecognised AppArmor is unknown, not protection.
- No event contains the file name or a hash.
- The replay is published to the desktop event hub under `replayId`, never under the job id. `replayId` appears only in this token-checked stream (replayed from `Last-Event-ID` like any event), not in the report, the logs or any unauthenticated route, so the job id alone cannot open the replay.
