# Vultr hackathon execution proof

## Status

> **Superseded 2026-10-21.** The Detonation Ocean pipeline is live on Vultr with Serverless Inference; see [`SUBMISSION.md`](SUBMISSION.md) and [`USER-DECISIONS.md`](USER-DECISIONS.md). The text below describes the earlier OAuth-proof route (Pattern B) and is kept as history.

**Offline implementation and tests only. Not deployed or live-verified.** No Vultr resources, public URL, inference request, or Retrodiffusion request were made. The Docker image was not built or run for this proof.

The [official Vultr Agent Rush page](https://lablab.ai/ai-hackathons/vultr-hackathon) requires a public web application, a Vultr VM controller, agent inference through Vultr Serverless Inference, execution in a separate sandbox on Vultr, lifecycle cleanup, and a visible containment moment. The current code prepares only an initial bounded browser-run proof. It does **not** meet submission requirements by itself.

## Current code path

When all server-side gates are open, the browser can `POST /api/hackathon/proof` with exactly:

```json
{
  "attackId": "oauth-2023",
  "personaId": "persona-game-001",
  "decision": "allow",
  "planId": "<server-prepared SHA-256>",
  "optIn": true,
  "browserContainerOptIn": true,
  "inferenceAcknowledged": true
}
```

Use `"decision":"deny"` for the no-access branch. The controller accepts the configured HTTPS origin (or loopback for local tests), serializes the run, and requires separate training, container and per-run inference acknowledgements. It caps proof runs at ten per process lifetime, then calls `runHackathonPatternB`. That helper runs the user-selected synthetic OAuth Allow or Deny walkthrough in the existing bounded Docker browser image. The runner accepts no arbitrary URL, command, mount, host environment, target, or credential. The controller validates the synthetic receipt and three screenshots, waits for confirmed container removal, then may send those screenshots to the fixed Vultr Serverless Inference vision check. The inference response must match the exact verdict for the selected outcome. After size and hash validation, synthetic screenshots return to the opted-in browser for inspection; API credentials never do.

In **Vultr hackathon mode**, the controller-side training and OAuth execution endpoints are disabled. Scenario effects must not silently fall back to `TrainingSessionStore` or the in-process OAuth adapter. A missing inference gate, invalid proof, failed model check, or unconfirmed cleanup cannot produce HTTP success. Unconfirmed cleanup disables later proof runs until the service is restarted after operator reconciliation.

The Docker worker receives only the fixed synthetic input; it does not receive the controller's inference key. The model is currently a screenshot verifier, **not an agent planner**. The current ocean animates a creature biting/swallowing a stationary camera view and hands off to the creature-profile matrix (`/ocean-profiles.html`); it does not access the real webcam. A linked profile matrix displays all 30 verified family/depth animation variants. Selecting a cell opens a visual-only camera-bite cinematic, then the depth-themed desktop. The camera is a drawn prop; browser policy blocks webcam, microphone and geolocation access. Inside the desktop's fictional app windows, users can opt into and run a bounded local synthetic effect with fixed family-specific state and tier-specific action IDs. This is still process memory, not an isolated worker. In hackathon-controller mode, those local profile-session routes are disabled rather than used as a fallback; only Deception/Abyss links to the existing isolated OAuth proof route. The worker does not yet run the other 29 profiles. Do not describe the current route as a complete or eligible hackathon submission.

## Gates and deployment boundary

The route is hidden unless `VULTR_HACKATHON_MODE=true`. Execution additionally requires `VULTR_HACKATHON_PROOF_ENABLED=true`, the exact approval phrase declared by `backend/vultr-inference.mjs`, a valid `VULTR_INFERENCE_API_KEY`, and a valid `VULTR_INFERENCE_MODEL`. The per-request `inferenceAcknowledged` flag is separate from the operator's server-side approval gate. `APP_PUBLIC_ORIGIN` must be the exact HTTPS origin used by the browser. The server still binds to loopback; a trusted HTTPS reverse proxy must preserve the configured `Host` and `Origin` headers and be the only network path to Node.

Supply the API key through a deployment secret store or protected process environment. Do not commit it, place it in a browser bundle, include it in a worker image, or forward it to Docker. Do not set these gates or make a billable provider call without separate approval.

A local Docker run is host-Docker evidence, **not Vultr evidence**. For the first compliant deployment, prefer one separately approved, fixed Vultr VM that hosts the controller and launches a disposable, network-disabled worker container on that same VM. This avoids per-run Cloud Compute provisioning; keep `VULTR_SANDBOX_MODE` unset unless using the distinct per-run path documented in [`vultr-deployment.md`](vultr-deployment.md). A process-level environment variable cannot prove the machine is on Vultr. Only after the controller and container are actually verified on the Vultr VM, Serverless Inference returns a live result, and cleanup is observed can the corresponding live receipts be recorded. `submissionValid` therefore remains `false`; the response explicitly leaves public deployment and submission readiness unproven.

## Remaining proof requirements

1. Build and pin a reviewed worker image; verify it runs with the expected resource, filesystem, network and lifecycle limits on the Vultr VM.
2. Wire the bounded agent-planning/execution/verification loop. `backend/vultr-agent-planner.mjs` (offline, mock-tested, not yet called by any route) asks Vultr Serverless Inference to echo one fixed action ID per profile depth and rejects anything else; it still needs routing to a worker and a live run. Keep model output limited to validated scenario and action IDs; never let it send shell commands, arbitrary URLs, or credentials to the worker.
3. Deploy the controller behind HTTPS on a Vultr VM, configure the public origin and least-privilege egress, and keep inference credentials outside worker containers.
4. Complete the existing Deception/Abyss journey through the isolated OAuth worker before expanding profile coverage. `/api/hackathon/proof` runs only the synthetic OAuth chamber in a disposable Docker container, then uses Vultr Serverless Inference for screenshot verification after confirmed worker cleanup. It is not yet a model-planned ocean-profile agent loop or a live-verified Vultr deployment. Profile-session routes fail closed in both Vultr modes; the other 29 combinations remain visual previews until their worker support is actually built and tested. Local development embeds the downloaded Win11React and StarKnightt previews in script-only sandboxed iframes. A versioned `MessageChannel` bridge mirrors the synthetic profile/session and the training app/Files open state between both shells; it does not sync or control their native OS widgets. These previews remain private local evaluation only because some included assets have unresolved redistribution rights. Hackathon/controller mode disables them and uses the project desktop. Keep the camera-bite cinematic visual-only; actual camera capture remains out of scope.
5. Obtain separate authorization before any live cloud cost, external inference request, public deployment, upload, or publication. Record a real containment demo only after observing the deployed sandbox absorb the bounded synthetic task and confirming cleanup.
6. Complete the required public repository, public demo URL, recorded video and hackathon submission materials. This checkout is not a Git repository, so no public-repository state is established here.
