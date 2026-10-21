# Safety rules

The timeline and the 60-scenario list describe real historical incidents. The 30 creature scenes are scripted, fictional and local to the browser tab. The only scenario that executes anything beyond that is the explicitly opted-in synthetic OAuth-consent exercise, which uses a fake identity provider and synthetic mailbox. None of them execute malware, exploit code, or a real vulnerable product.

## 1. Toy logic only

An “intentionally vulnerable toy” must be code written for this project, not a real product left unpatched. Keep every simulated consequence confined to synthetic state.

| Never do this | Do this instead |
|---|---|
| Install an old, exploitable Log4j release | Write a harmless toy lookup that records a canary event |
| Deploy a real MOVEit instance unpatched | Use an original managed-file-transfer toy with synthetic records |
| Run an old OpenSSL build and exercise Heartbleed | Return fixed synthetic bytes from an original heartbeat toy |
| Execute historical payloads or working exploit code | Reconstruct the user-facing moment and describe the backend effect |

No code in this project may be copied into a real intrusion path. Never add malware samples, exploit payloads, vulnerable real products, binaries, or archives.

## 2. Never acquire or execute malware

Do not download or clone malware, samples, exploit code, or real historical CVE implementations. Historical source URLs in the timeline are references for human readers; the browser loads no source page automatically. Never build a working credential harvester or payload from those references.

## 3. Keep network effects private

- The server binds to `127.0.0.1`. The browser talks only to same-origin API routes after explicit opt-in. The page loads no remote scripts, fonts, images, or inference APIs.
- In default `local-synthetic` mode, the adapter has no network client. It issues an opaque synthetic token in Node-process memory and uses it only to read the bundled fake mailbox. This is not an OS sandbox, container, VM or microVM.
- The optional local browser-container path requires a separate browser-container opt-in as well as the training opt-in and simulated choice. It uses only the standard local Docker endpoint, starts an already-present image with Docker `--network none`, and accepts no arbitrary target, URL, HTML, mount or host environment. Docker's daemon has host-level authority; requested container flags do not attest to the host, daemon, image provenance or kernel isolation. If Docker or the image is unavailable, the run fails and does not fall back to the in-memory adapter. The path has not been runtime-verified here.
- The optional Vultr adapter is **not live-verified**. It cannot create a resource unless the server is explicitly configured with `VULTR_SANDBOX_MODE=vultr`, the exact approval phrase, and a Vultr API key. The browser then requires a separate cost acknowledgement and simulated choice. Do not set these variables without separate user approval.
- A gated Vultr run uses a VPC-only instance, verifies private addressing and the VPC attachment, and requires a guest nftables attestation. Vultr Firewall is ingress-only; the guest policy denies egress except the private controller. During cloud-init only, the bootstrap policy permits the link-local metadata endpoint `169.254.169.254:80`; cloud-init removes that rule before the guest agent listens.
- Historical source links navigate externally only when a reader clicks them. No scenario contacts historical targets.
- Use `.invalid` addresses and synthetic identifiers. Never use real credentials, accounts, identity providers, mailboxes, domains, or targets.

## 4. Never target a real host

The local walkthrough contacts only loopback. The mock-tested cloud path contacts the Vultr control-plane API only after its explicit gate and targets the guest only by its verified private VPC IPv4 address. Do not configure a public target, NAT gateway, public listener, scanner, propagation path, callback, or DDoS traffic.

## 5. Teardown is mandatory

The default local deterministic adapter creates a per-run in-memory sandbox object. It clears its synthetic token map in `finally` after success or forced scenario failure. This is not an OS process, container, VM, or microVM boundary. The optional browser runner also attempts container removal and checks for absence; an unconfirmed cleanup is a failed run and must not be described as successful isolation.

The optional adapter is designed to create one **ephemeral Vultr Cloud Compute environment**, cap plan price and lifetime, and attempt guest cleanup plus provider deletion after success, failure, timeout, or partial startup. A receipt reports deletion as confirmed only after the provider no longer returns the instance. An ambiguous create or failed delete remains unconfirmed and requires manual account review. No cloud environment has been created or verified in this project. Do not call it a Vultr microVM unless a distinct microVM layer is deployed.

## 6. No credential collection

The OAuth walkthrough has no username or password fields. It asks for an explicit training opt-in, an optional separate browser-container opt-in, and a simulated allow/deny choice; gated Vultr mode additionally requires a cost acknowledgement. Never request, log, store, or forward real credentials. Any future credential-shaped form must discard all entered text and record only that a synthetic submission occurred.

## Safe local checks

```sh
node build.mjs
node tools/validate-attacks.mjs
node --test tests/*.test.mjs
node server.mjs
```

With `VULTR_SANDBOX_MODE` unset, the server defaults to the in-memory local synthetic adapter and creates no cloud resources. Selecting the browser-container checkbox explicitly requests the Docker/Chromium path; failure never reports an in-memory run as container-isolated. The timeline works by opening `index.html`; the OAuth exercise requires the loopback server. Stop the local process after testing.

## If unsure

Stop before adding the feature. Do not fetch a sample to investigate. Keep the UI clearly identified as training, require explicit opt-in before planning, and obtain separate approval before any cloud cost, external service call, publication, real-world traffic, or real-account interaction.
