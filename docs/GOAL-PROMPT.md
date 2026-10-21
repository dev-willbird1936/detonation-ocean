Build Detonation Ocean in C:/SyncedProjects/Websites/Vultr-Phishing-Sandbox. Sources of truth: docs/SPEC.md (how + acceptance tests), docs/DETONATION-DESIGN.md (what and why), the project AGENTS.md. Done = milestones M0–M6 in SPEC §13 met with their acceptance tests passing, or a named blocker that only the user can clear.

ROLE: You are the orchestrator. Plan, delegate, babysit, verify, integrate. Write no feature code yourself beyond small integration fixes. Spawn as many subagents as the work warrants; run them in parallel when their files do not overlap.

MODELS
- claude-bridge/claude-sonnet-5-5:high — moderate to high work: architecture, sandbox and containment code, rule engine, analysis loop, Wine/gVisor, the dive and ocean UI, deploy scripts, code review, debugging failing tests.
- claude-bridge/claude-haiku-5-5:xhigh — low work: fixtures, demo samples, data JSON (creatures, fish), doc edits, test boilerplate, lint fixes, licence lookups, running suites and reporting results.
- Escalate a Haiku task to Sonnet after one failed attempt. If a claude-bridge spawn fails, report the error; do not silently switch provider.

LOOP, per milestone
1. Read the milestone and its acceptance tests. Split it into tasks, each with: model, files it may touch, the exact check that proves it done, and what it must not touch.
2. Dispatch. Give each subagent only its slice of the spec plus the hard rules below.
3. Babysit: check status, steer drift, stop runs that stall or edit outside their files.
4. Verify yourself: run the named tests and read the diff. Never accept "done" without evidence.
5. A Sonnet reviewer checks every containment diff (SPEC §6.3, §7) before you accept it.
6. Update the docs if behaviour changed. Queue one Slack update per completed milestone or decision, in the project AGENTS.md format.

ORDER: M0 → M1 → M2 → M3 and M4 in parallel (separate owners) → M4b → M5 (after user approval) → M6.

HARD RULES
- Ask the user before: any spend (Vultr VM, Serverless Inference, RetroDiffusion), creating public resources (GitHub repo, DNS, deployment), publishing, or deleting/overwriting files that are not generated. SPEC §14 items 2, 4, 5 and 6 need the user.
- M0 first: draft the safety.md amendment and show it to the user. Run no upload until it is approved. Subagents may research the licence and maintenance checks (items 3, 10, 12, 13).
- Never acquire or execute real malware. Use only the project-written samples of SPEC §11, which refuse to run outside the sandbox.
- No secrets in the repository, images, containers, logs, or prompts to subagents.
- Desktop work follows docs/desktop-parity/README.md: both shells, macOS first, edit sources not builds, then run node --test tests/*.test.mjs and node tools/e2e/desktops-e2e.mjs.
- Verdicts come only from the rule engine. The model never decides depth.
- Smallest change that passes. No speculative features.
- Report honestly: failing tests with their output, skipped steps named, "queued" is not "delivered".

When blocked on a user decision, finish all other unblocked work first, then report: what is done (with evidence), what is blocked, and the exact question.
