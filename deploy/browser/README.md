# Local OAuth browser-container runner

This optional path runs the bundled fictional OAuth desktop, local synthetic API, and Chromium in one Docker container. It does not provision Vultr resources, use a real identity provider, contact an outside target, collect credentials, or claim host/daemon attestation. The default local exercise remains the Node-process in-memory adapter.

## Build the image

From the repository root, after generating the current UI:

```sh
node build.mjs
docker build -f deploy/browser/Dockerfile -t vultr-oauth-browser:local .
```

The image copies `data/training-scenarios.json` because `server.mjs` loads it at startup through `training-session.mjs`. The build downloads the Microsoft Playwright base image and Playwright npm package. The base image tag is versioned but not digest-pinned. No image build was performed for this integration. Use only the reviewed local image; the runner does not pull images automatically.

## Use the UI

Start the loopback-only app with `node server.mjs`, then open <http://127.0.0.1:4173>. In the OAuth training desktop, select the separate **local Docker browser-container** checkbox before checking the explicit training opt-in. Review the plan, then choose **Simulate Allow** or **Simulate Deny**. Successful runs return and display three Chromium JPEG screenshots and the synthetic receipt. The UI does not claim Docker host or daemon attestation.

Without the browser-container checkbox, the server keeps the default `local-synthetic` in-memory adapter. The selected browser mode is bound into the prepared plan ID. The execute route invokes the browser runner only after both opt-ins, the prepared matching plan, and a simulated choice. It never falls back to the memory adapter if Docker or the image is unavailable; such a request returns a failure without a receipt.

## Host runner contract

`backend/browser-container.mjs` exports:

```js
runBrowserOAuthInContainer({
  optIn: true,
  decision: 'allow', // or 'deny'
  personaId: 'persona-game-001',
  viewport: { width: 1280, height: 900 }, // optional, bounded
});
```

The server supplies the runner's opt-in assertion only after requiring the request's explicit training/container opt-ins and validating its mode-bound plan. These booleans are caller assertions, not independent proof of user intent. The runner accepts only a synthetic persona, decision, and bounded viewport; it accepts no URL, HTML, shell command, mount, target or host-environment passthrough.

The Docker CLI is forced to the platform's standard local socket/named pipe with a minimal environment, rather than inheriting a remote Docker context or host secrets. The runner starts an already-built image using `--pull never`, `--network none`, read-only root, bounded temporary storage/CPU/memory/process count, no added Linux capabilities, no host mounts and no published ports. It attempts named-container removal and checks for absence after success or failure. Any unconfirmed cleanup is a failed run, latches browser-container execution off for that server process, and requires manual Docker inspection/cleanup plus a server restart before using browser mode again.

Success returns the synthetic receipt, scenario/browser events, three base64 JPEG screenshots and `containerTeardown: 'confirmed'`. The host validates receipt outcomes, event/network metadata, screenshot bounds/JPEG markers and SHA-256; it does not fully decode the images. Chromium inside the container decodes each screenshot before returning it. A receipt hash is not a digital signature, third-party attestation or proof that Docker/host isolation is secure.

## Boundary and verification status

The runner uses only the standard local Docker endpoint; rootless/custom sockets are not supported. Docker's daemon has host-level authority. These flags do not attest to the host, daemon, image provenance, kernel isolation or resistance to a compromised daemon. The UI and HTTP server remain bound to loopback; the browser container itself has no network and the runner does not publish a port.

Automated tests inject a Docker mock and a browser-runner stub. They cover mode selection, mode-bound planning, no-fallback failure handling, command construction, Allow/Deny receipt checks, malformed/truncated screenshot rejection, and cleanup handling. They do not start Docker or Chromium. The Docker daemon was unavailable during this integration, so image build, runtime isolation, browser execution, screenshots and actual teardown remain unverified. Do not describe this path as a verified sandbox or Vultr deployment.
