# Vultr Cloud Compute path

> **Superseded.** Detonation Ocean now deploys as one long-lived Vultr VM that runs Docker with gVisor, Caddy and the app under systemd (`docs/SPEC.md` section 10). The kit is [`deploy/vultr-vm/`](../deploy/vultr-vm/README.md): `setup.sh`, the systemd unit, the Caddyfile, `env.example` and the firewall rules. Use it for any deployment. Everything below describes the earlier design (a throwaway VPC-only instance created per run by the training-desktop adapter). It is kept as a record of that adapter, whose code and tests remain; do not use it to deploy Detonation Ocean, and do not set its `VULTR_SANDBOX_*` variables on the VM.

**Status: prepared and mock-tested; not deployed.** No Vultr credentials were used and no cloud resources were created. The local adapter remains the default. The proposed runtime is an **ephemeral Vultr Cloud Compute environment**, not a microVM.

## Execution path

1. The browser calls the loopback-only plan endpoint. Planning makes no cloud call and creates no resource.
2. In local mode, the scenario uses `LocalSyntheticAdapter` in memory.
3. Vultr mode is available only when the server is started with the explicit mode and approval phrase below. The browser also requires a separate cost acknowledgement before either simulated choice can execute.
4. The server checks the selected Cloud Compute plan and its regional hourly price, refuses if any instance already carries the project tag, and creates at most one instance from the pinned snapshot. The request asks for VPC-only networking, the existing VPC and firewall group, no IPv6, no backups, and base64 cloud-init user-data.
5. The adapter waits for the bounded ready state and verifies `vpc_only`, absence of public IPv4/IPv6, the expected private VPC address, and the configured VPC attachment. It then calls the guest only at that private IPv4 address.
6. The guest verifies the default-drop nftables rules, pinned snapshot marker and guest-agent version before it issues a synthetic token or reads the synthetic mailbox.
7. The orchestration derives its receipt from structured events. It asks the guest to clear token state, deletes the Vultr instance, and polls until the provider reports it gone. An unconfirmed delete is a failed teardown, not a successful receipt.

The cloud adapter enforces one active instance per server process, refuses a second project-tagged instance, caps the provider-reported plan price at **$0.05/hour**, limits a run to **300 seconds**, disables backups, and bounds API polling. Vultr bills servers with a one-hour minimum, so a short run can still incur at least one hour of the selected plan’s charge. Taxes and charges for pre-existing account resources are outside this cap. Verify the plan price and account before any separately approved run.

## Network boundary

Vultr Firewall filters **incoming** traffic; it does not enforce instance egress. The guest image therefore needs a host nftables policy. [`deploy/vultr/nftables.conf`](../deploy/vultr/nftables.conf) starts with input, output and forwarding set to drop. It permits only the link-local Vultr metadata request needed during cloud-init bootstrap. Cloud-init then flushes the bootstrap rules and adds only loopback, established-flow and the configured controller `/32` on TCP 4174. The guest agent refuses to listen if any other accepting rule remains.

The instance must be VPC-only. The controller must have a private address inside the same VPC and a route to the instance, such as a pre-existing private controller or VPN. Do not add a NAT gateway for this demo. The guest transport accepts RFC1918 IPv4 targets only and uses a fixed port and route allowlist. Vultr firewall group, VPC and controller must already exist; this adapter does not create or modify them.

Cloud-init stores a one-run config in `/etc/blast-radius/run.json` with mode `0600`. It contains only synthetic persona data and a random guest-control token. That token is not a user credential, but it is still sensitive run state and must not be copied into logs, screenshots, receipts or source control. The provider receives the base64 user-data through its API; never put real credentials in it.

## Required guest snapshot

The adapter intentionally requires a reviewed `snapshot_id`; it does not fall back to a general-purpose public OS image or install packages at boot. Prepare the image separately, without running this scenario against a real account or target:

- Install Node.js 18+ and nftables; copy the reviewed project guest-agent files to `/opt/blast-radius`.
- Install [`deploy/vultr/brz-guest-agent.service`](../deploy/vultr/brz-guest-agent.service), enable nftables with [`deploy/vultr/nftables.conf`](../deploy/vultr/nftables.conf), and install [`deploy/vultr/nftables.service.d/10-brz-early.conf`](../deploy/vultr/nftables.service.d/10-brz-early.conf). Load the default-drop policy before network services start. The guest service is gated by the cloud-init run-config file and has only the fixed internal routes. The config does not flush other firewall tables; the guest refuses to start unless the runtime ruleset contains only the expected `inet brz` table and exact allow rules. Never apply it to a workstation or general-purpose host.
- Ensure cloud-init configures the VPC interface and that cloud-init can reach only Vultr’s link-local metadata service (`169.254.169.254:80`) during bootstrap. The run-config script removes that exception before the guest agent starts. If this sequence cannot be verified, do not use the image.
- Store a lowercase SHA-256 marker in `/etc/blast-radius/image-sha256`. The adapter compares this marker with the configured expected value and the guest reports it during attestation. **This is a consistency check, not hardware-backed or provider-side image attestation.** Independently verify the snapshot contents and keep its ID and digest under change control.
- Confirm the configured private controller address and firewall rules before publishing the snapshot ID to the deployment operator.

Vultr VPC 2.0 does not use DHCP for the private interface; cloud-init configures the VPC address. The bootstrap metadata exception is therefore required for this proposed image flow. Runtime egress verification rejects the metadata rule if it remains after cloud-init.

## Live-mode gate

The following values are **examples of variable names only**. Do not populate or enable them until the user separately approves one billable Vultr run and the operator has verified the snapshot, VPC, firewall group, region, plan and cost:

```text
VULTR_SANDBOX_MODE=vultr
VULTR_SANDBOX_APPROVAL=I_APPROVE_ONE_BILLABLE_VULTR_INSTANCE
VULTR_API_KEY=<operator-supplied secret; never commit>
VULTR_REGION=<available region>
VULTR_PLAN_ID=<vc2 plan>
VULTR_MAX_HOURLY_COST_USD=0.05
VULTR_MAX_RUN_SECONDS=300
VULTR_SNAPSHOT_ID=<reviewed snapshot id>
VULTR_SNAPSHOT_SHA256=<reviewed image marker>
VULTR_VPC_ID=<existing VPC id>
VULTR_VPC_CIDR=<private IPv4 CIDR>
VULTR_FIREWALL_GROUP_ID=<existing inbound firewall group>
VULTR_CONTROLLER_IPV4=<private controller address>
VULTR_PERSONA_ID=persona-game-001
```

With no `VULTR_SANDBOX_MODE=vultr`, the server uses only the local adapter—even if an API key happens to exist in the environment. Vultr mode also requires the exact approval phrase and an API key before the server starts. A cloud instance is created only after the user opts into planning, acknowledges the cost in the UI, and selects **Simulate Allow** or **Simulate Deny**. Denial still starts and tears down the temporary instance, so it can still incur the provider minimum charge.

If teardown is not confirmed, stop further runs and inspect Vultr by the unique `brz-run-<runId>` tag. If the create request times out before returning an instance ID and the tag scan cannot confirm cleanup, treat the account state as unknown and inspect it manually. Do not report a clean run until the receipt confirms teardown.

## Mock verification

```sh
node --test tests/vultr-adapter.test.mjs tests/guest-agent.test.mjs
```

These tests inject fake API and private-guest transports. They cover price/resource caps, gate rejection, VPC-only payload, no public targets, egress attestation, synthetic token/mailbox calls, ambiguous-create cleanup, failed deletion, and the guest’s nftables checks. They do not contact Vultr or create resources.

## References

- [Vultr instance resource fields](https://docs.vultr.com/reference/terraform/resources/instance) and [Vultr Go SDK instance create request](https://github.com/vultr/govultr/blob/master/instance.go) document snapshot, firewall, VPC, VPC-only, user-data and block-device fields.
- [Verify a VPC-only instance](https://docs.vultr.com/support/products/compute/how-can-i-verify-if-an-instance-is-vpc-only): `vpc_only=true` means no public IPv4 or IPv6 is assigned.
- [Vultr Firewall outbound behavior](https://docs.vultr.com/support/products/network/does-vultr-firewall-filter-outgoing-traffic-from-my-instance): Vultr Firewall does not filter instance-originated traffic; guest firewall rules are required.
- [Vultr cloud-init user-data](https://docs.vultr.com/how-to-deploy-a-vultr-server-with-cloudinit-userdata): Linux instance initialization and user-data behavior.
- [Vultr Metadata API](https://www.vultr.com/metadata/): the link-local instance metadata service used during cloud-init bootstrap.
- [Vultr VPC 2.0 networking](https://docs.vultr.com/how-to-configure-networking-on-vultr-cloud-servers): cloud-init configures the private interface; VPC 2.0 does not use DHCP.
- [Vultr plan list API](https://www.vultr.com/api/#tag/plans/operation/list-plans): use provider plan data and selected-region availability; fail if hourly price is absent.
- [Vultr server billing](https://docs.vultr.com/support/platform/billing/how-am-i-billed-for-my-servers): one-hour minimum billing applies.
