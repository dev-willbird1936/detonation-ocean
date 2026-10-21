#!/usr/bin/env bash
# Runs as root on a temporary BUILDER instance (public IP, tagged ocean-sandbox-*). It installs the reviewed guest
# image contents, proves the final firewall policy in a throwaway network namespace, writes the image digest and
# cleans cloud-init so the snapshot re-runs it with per-run user data. Input: /tmp/brz-guest-src.tgz holding
# backend/ and data/personas.json, plus /tmp/brz-guest/{nftables.conf,brz-guest-agent.service,10-brz-early.conf}.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
NODE_VERSION=v22.23.3
NODE_SHA256=df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de

apt-get update -qq
apt-get install -y -qq nftables xz-utils ca-certificates curl iproute2
systemctl disable --now ufw 2>/dev/null || true
apt-get purge -y -qq ufw 2>/dev/null || true

cd /tmp
curl -fsSLO "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz"
echo "${NODE_SHA256}  node-${NODE_VERSION}-linux-x64.tar.xz" | sha256sum -c -
tar -xJf "node-${NODE_VERSION}-linux-x64.tar.xz" -C /usr/local --strip-components=1 --no-same-owner
ln -sf /usr/local/bin/node /usr/bin/node
rm -f "node-${NODE_VERSION}-linux-x64.tar.xz"

mkdir -p /opt/blast-radius /etc/blast-radius /etc/systemd/system/nftables.service.d
tar -xzf /tmp/brz-guest-src.tgz -C /opt/blast-radius
chown -R root:root /opt/blast-radius
install -m 0644 /tmp/brz-guest/nftables.conf /etc/nftables.conf
install -m 0644 /tmp/brz-guest/brz-guest-agent.service /etc/systemd/system/brz-guest-agent.service
install -m 0644 /tmp/brz-guest/10-brz-early.conf /etc/systemd/system/nftables.service.d/10-brz-early.conf
systemctl daemon-reload
systemctl enable nftables.service brz-guest-agent.service
# Not started here: the default-drop policy would cut this builder's SSH session.

echo "--- proving the final policy in a throwaway network namespace"
CONTROLLER=10.77.0.9
ip netns del brztest 2>/dev/null || true
ip netns add brztest
ip netns exec brztest ip link set lo up
ip netns exec brztest nft -f /etc/nftables.conf
for rule in \
  "flush chain inet brz input" \
  "add rule inet brz input iifname lo accept" \
  "add rule inet brz input ct state established,related accept" \
  "add rule inet brz input ip saddr ${CONTROLLER} tcp dport 4174 accept" \
  "flush chain inet brz output" \
  "add rule inet brz output oifname lo accept" \
  "add rule inet brz output ct state established,related accept" \
  "add rule inet brz output ip daddr ${CONTROLLER} tcp dport 4174 accept"; do
  ip netns exec brztest nft $rule
done
ip netns exec brztest nft list ruleset
ip netns exec brztest node --input-type=module -e "
import('/opt/blast-radius/backend/guest-agent.mjs').then(async m => {
  const result = await m.verifyNftablesPolicy({ controllerIPv4: '${CONTROLLER}', controllerPort: 4174 });
  console.log('verifyNftablesPolicy:', JSON.stringify(result));
  process.exit(result.verified ? 0 : 1);
});"

echo "--- proving the real systemd unit starts the agent and attests in the same namespace"
PROOF_DIGEST=$(printf 'proof' | sha256sum | cut -d' ' -f1)
PROOF_TOKEN=$(printf 'x%.0s' {1..40})
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs';
import { EGRESS_POLICY_VERSION, GUEST_AGENT_VERSION } from '/opt/blast-radius/backend/vultr-adapter.mjs';
const manifest = JSON.parse(readFileSync('/opt/blast-radius/data/personas.json', 'utf8'));
writeFileSync('/etc/blast-radius/run.json', JSON.stringify({
  version: 1, runId: 'imageproof', scenarioId: 'oauth-2023', persona: manifest.personas.find(item => item.id === 'persona-game-001'), oauthApp: manifest.oauth_app,
  controllerIPv4: '${CONTROLLER}', controllerPort: 4174, snapshotSha256: '${PROOF_DIGEST}', egressPolicy: EGRESS_POLICY_VERSION,
  guestAgentVersion: GUEST_AGENT_VERSION, controlToken: '${PROOF_TOKEN}',
}));"
echo "${PROOF_DIGEST}" > /etc/blast-radius/image-sha256
mkdir -p /run/systemd/system/brz-guest-agent.service.d
printf '[Service]\nNetworkNamespacePath=/run/netns/brztest\n' > /run/systemd/system/brz-guest-agent.service.d/proof.conf
systemctl daemon-reload
systemctl start brz-guest-agent.service
sleep 3
systemctl --no-pager status brz-guest-agent.service | head -12 || true
ATTESTATION=$(ip netns exec brztest curl -sS --max-time 10 -X POST -H "Authorization: Bearer ${PROOF_TOKEN}" -H 'Content-Type: application/json' -d '{"runId":"imageproof"}' http://127.0.0.1:4174/internal/attestation </dev/null || true)
echo "attestation: ${ATTESTATION}"
systemctl stop brz-guest-agent.service
rm -rf /run/systemd/system/brz-guest-agent.service.d /etc/blast-radius/run.json /etc/blast-radius/image-sha256
systemctl daemon-reload
grep -q '"publicEgress":false' <<< "${ATTESTATION}" || { echo 'IMAGE PROOF FAILED: the unit did not attest'; journalctl -u brz-guest-agent --no-pager | tail -20; exit 1; }
ip netns del brztest
echo "--- the host namespace has no nft tables yet:"
nft list ruleset | wc -l

echo "--- cleaning for snapshot"
systemctl disable ssh.service ssh.socket 2>/dev/null || true
rm -f /root/.ssh/authorized_keys /etc/blast-radius/run.json
cloud-init clean --logs
rm -rf /tmp/brz-guest /tmp/brz-guest-src.tgz /var/lib/apt/lists/* /root/.bash_history
(
  cd /
  find opt/blast-radius usr/local/bin/node etc/nftables.conf etc/systemd/system/brz-guest-agent.service \
    etc/systemd/system/nftables.service.d -type f | sort | xargs sha256sum
) | sha256sum | cut -d' ' -f1 > /etc/blast-radius/image-sha256
echo "IMAGE_SHA256=$(cat /etc/blast-radius/image-sha256)"
