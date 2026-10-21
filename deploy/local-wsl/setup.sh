#!/usr/bin/env bash
# Idempotent: native Docker Engine + gVisor runsc inside the WSL2 distro Ubuntu-24.04.
# Run as root inside the distro:  bash deploy/local-wsl/setup.sh
# Does not touch Docker Desktop. See docs/evidence/gvisor-wsl/REPORT.md.
set -euo pipefail

DOCKER_VERSION="${DOCKER_VERSION:-5:29.8.2-1~ubuntu.24.04~noble}"
RUNSC_VERSION="${RUNSC_VERSION:-20261012.0}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
daemon_json="$here/../vultr-vm/daemon.json"

[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
[ -r /etc/os-release ] && . /etc/os-release
[ "${VERSION_CODENAME:-}" = noble ] || { echo "expected Ubuntu 24.04 (noble)" >&2; exit 1; }
[ -r "$daemon_json" ] || { echo "missing $daemon_json" >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive

# Wait for another apt/dpkg process instead of failing on the lock.
apt=(apt-get -o DPkg::Lock::Timeout=600)

"${apt[@]}" update -qq
"${apt[@]}" install -y -qq ca-certificates curl gnupg >/dev/null
install -m 0755 -d /etc/apt/keyrings

# Docker Engine apt repo
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" \
  > /etc/apt/sources.list.d/docker.list

# gVisor official apt repo
curl -fsSL https://gvisor.dev/archive.key | gpg --dearmor --yes -o /etc/apt/keyrings/gvisor-archive-keyring.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" \
  > /etc/apt/sources.list.d/gvisor.list

"${apt[@]}" update -qq

# Pinned versions (override with DOCKER_VERSION / RUNSC_VERSION); install is a no-op when already satisfied.
"${apt[@]}" install -y -qq --allow-downgrades \
  "docker-ce=$DOCKER_VERSION" "docker-ce-cli=$DOCKER_VERSION" \
  containerd.io docker-buildx-plugin docker-compose-plugin \
  "runsc=$RUNSC_VERSION"
apt-mark hold docker-ce docker-ce-cli runsc >/dev/null

# Runtimes `runsc` and `runsc-trace`; same file as the Vultr VM.
install -d -m 0755 /etc/docker /var/log/runsc
if ! cmp -s "$daemon_json" /etc/docker/daemon.json 2>/dev/null; then
  install -m 0644 "$daemon_json" /etc/docker/daemon.json
  changed=1
fi

systemctl enable docker >/dev/null 2>&1
if [ "${changed:-0}" = 1 ] || ! systemctl is-active --quiet docker; then
  systemctl restart docker
fi

# Scripts must call the native engine, not the Docker Desktop shim under /mnt/c.
[ "$(command -v /usr/bin/docker)" = /usr/bin/docker ] || { echo "/usr/bin/docker missing" >&2; exit 1; }
for _ in $(seq 1 30); do /usr/bin/docker info >/dev/null 2>&1 && break; sleep 1; done

echo "docker: $(/usr/bin/docker --version)"
echo "runsc:  $(/usr/bin/runsc --version | head -1)"
/usr/bin/docker info --format 'runtimes: {{range $k, $_ := .Runtimes}}{{$k}} {{end}}'
