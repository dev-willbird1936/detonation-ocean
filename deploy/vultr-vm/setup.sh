#!/usr/bin/env bash
# Idempotent set-up of a fresh Ubuntu 24.04 VM as the Detonation Ocean host (docs/SPEC.md section 10).
# Run as root on the VM, once from a git checkout of this repository:
#
#   sudo bash deploy/vultr-vm/setup.sh --checkout "$PWD" --host detonation.example.org --operator-ip 203.0.113.7
#
# Safe to re-run: it converges to the same state and restarts the service only when something it installed changed.
# It creates no cloud resource and writes no secret: /etc/detonation-ocean/env is copied from env.example with empty secrets.
#
#   --checkout PATH     git checkout to install from (required)
#   --host NAME         public DNS name Caddy serves; also PUBLIC_HOST in the environment (required)
#   --operator-ip ADDR  the only address allowed to reach SSH (22); also OPERATOR_IP (required unless --skip-ufw)
#   --tls-internal      Caddy issues a local certificate instead of asking Let's Encrypt (dry runs only)
#   --no-http-redirect  Caddy does not bind port 80 (dry runs on a host where something else owns it; the VM must keep it)
#   --skip-ufw          leave the host firewall alone (dry runs where the kernel has no netfilter; never on the VM)
set -euo pipefail

# Pinned versions. Docker and runsc are pinned in deploy/local-wsl/setup.sh, which this script runs.
NODE_VERSION="${NODE_VERSION:-22.23.3-1nodesource1}"
CADDY_VERSION="${CADDY_VERSION:-2.11.4}"

APP_DIR=/opt/detonation-ocean
DATA_DIR=/var/lib/detonation-ocean
ENV_DIR=/etc/detonation-ocean
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export DEBIAN_FRONTEND=noninteractive

die() { echo "setup.sh: $*" >&2; exit 1; }
step() { echo; echo "==> $*"; }

checkout=""
host="${PUBLIC_HOST:-}"
operator_ip="${OPERATOR_IP:-}"
tls_internal=0
no_http_redirect=0
skip_ufw=0
while [ $# -gt 0 ]; do
  case "$1" in
    --checkout) checkout="${2:-}"; shift 2 ;;
    --host) host="${2:-}"; shift 2 ;;
    --operator-ip) operator_ip="${2:-}"; shift 2 ;;
    --tls-internal) tls_internal=1; shift ;;
    --no-http-redirect) no_http_redirect=1; shift ;;
    --skip-ufw) skip_ufw=1; shift ;;
    -h | --help) sed -n '2,17p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "run as root"
[ -r /etc/os-release ] && . /etc/os-release
[ "${VERSION_CODENAME:-}" = noble ] || die "expected Ubuntu 24.04 (noble)"
[ "$(dpkg --print-architecture)" = amd64 ] || die "expected amd64"
[ -n "$checkout" ] || die "--checkout PATH is required"
resolved_checkout="$(cd "$checkout" && pwd)" || die "cannot read checkout $checkout"
checkout="$resolved_checkout"
for file in server.mjs deploy/local-wsl/setup.sh deploy/vultr-vm/daemon.json deploy/vultr-vm/Caddyfile \
            deploy/vultr-vm/detonation-ocean.service deploy/vultr-vm/env.example deploy/detonation/build-images.sh; do
  [ -r "$checkout/$file" ] || die "$checkout is not a Detonation Ocean checkout (missing $file)"
done
for file in deploy/local-wsl/setup.sh deploy/detonation/build-images.sh; do
  [ -z "$(tr -cd '\r' < "$checkout/$file" | head -c 1)" ] || die "$file has CRLF line endings; make the checkout on Linux (git clone) or with: git -c core.autocrlf=false archive"
done
vm="$checkout/deploy/vultr-vm"
[[ "$host" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || die "--host must be a lower-case DNS name such as detonation.example.org"
if [ "$skip_ufw" = 0 ]; then
  [[ "$operator_ip" =~ ^[0-9a-fA-F:.]+(/[0-9]{1,3})?$ ]] || die "--operator-ip must be an IPv4 or IPv6 address or CIDR (it is the only SSH source)"
fi

# `changed` becomes 1 when anything the service runs on was installed or updated; only then is it restarted.
changed=0
apt=(apt-get -o DPkg::Lock::Timeout=600)

install_if_different() { # install_if_different SRC DEST MODE: copy when content or mode differs; sets changed=1
  local src="$1" dest="$2" mode="$3"
  if ! cmp -s "$src" "$dest" 2>/dev/null || [ "$(stat -c %a "$dest")" != "$(printf '%o' "$((8#$mode))")" ]; then
    install -m "$mode" -o root -g root "$src" "$dest"
    return 0
  fi
  return 1
}

step "Docker Engine and gVisor runsc (deploy/local-wsl/setup.sh, pinned versions, daemon.json)"
"${apt[@]}" update -qq
"${apt[@]}" install -y -qq ca-certificates curl gnupg rsync ufw openssl >/dev/null
bash "$checkout/deploy/local-wsl/setup.sh"

step "Node.js $NODE_VERSION (NodeSource)"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
  > /etc/apt/sources.list.d/nodesource.list

step "Caddy $CADDY_VERSION (official apt repo)"
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
chmod 0644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list

"${apt[@]}" update -qq
"${apt[@]}" install -y -qq --allow-downgrades "nodejs=$NODE_VERSION" "caddy=$CADDY_VERSION" >/dev/null
apt-mark hold nodejs caddy >/dev/null
[ "$(node --version | cut -d. -f1)" = v22 ] || die "node is $(node --version), expected v22"

step "User detonation, data directory, host canary"
getent group detonation >/dev/null || groupadd --system detonation
id detonation >/dev/null 2>&1 || useradd --system --gid detonation --home-dir "$DATA_DIR" --no-create-home --shell /usr/sbin/nologin detonation
usermod -aG docker detonation
install -d -o detonation -g detonation -m 0700 "$DATA_DIR"
canary="$DATA_DIR/host-canary"
[ -e "$canary" ] || (umask 077 && head -c 32 /dev/urandom > "$canary")
chown detonation:detonation "$canary"
chmod 0600 "$canary"
install -d -m 0755 /var/log/runsc

step "Application in $APP_DIR (root-owned, read-only to the service)"
install -d -m 0755 -o root -g root "$APP_DIR"
# images.lock.json is rewritten by build-images.sh, so it is neither copied over nor deleted. -O keeps that from showing up
# as a changed directory time on every run.
synced="$(rsync -aO --delete --itemize-changes --chown=root:root --chmod=Dgo-w,Fgo-w \
  --exclude=/.git --exclude=/.planning --exclude=/.cache --exclude=/.pi --exclude=/.codex --exclude=/.playwright-mcp \
  --exclude=/.ruff_cache --exclude=node_modules --exclude=__pycache__ --exclude=/deploy/detonation/images.lock.json \
  "$checkout"/ "$APP_DIR"/)"
if [ -n "$synced" ]; then changed=1; echo "updated $(printf '%s\n' "$synced" | wc -l) entries"; else echo "already current"; fi

# A rebuild gives each image a new ID even when every layer is cached, so build only when an image is missing or its inputs changed.
step "Sandbox images (detonation-ocean/{detonate,collect,analyse})"
images_present=1
for role in detonate collect analyse; do docker image inspect "detonation-ocean/$role:latest" >/dev/null 2>&1 || images_present=0; done
if [ "$images_present" = 0 ] || [[ "$synced" == *" deploy/detonation/"* ]]; then
  (cd "$APP_DIR" && bash deploy/detonation/build-images.sh)
else
  echo "images present and deploy/detonation unchanged: not rebuilt"
fi

step "Environment file $ENV_DIR/env (placeholders only)"
install -d -m 0700 -o root -g root "$ENV_DIR"
if [ ! -e "$ENV_DIR/env" ]; then
  install -m 0600 -o root -g root "$vm/env.example" "$ENV_DIR/env"
  sed -i "s|^APP_PUBLIC_ORIGIN=.*|APP_PUBLIC_ORIGIN=https://$host|" "$ENV_DIR/env"
  changed=1
  echo "created $ENV_DIR/env: fill in the secrets you need, then restart detonation-ocean"
else
  chown root:root "$ENV_DIR/env"
  chmod 0600 "$ENV_DIR/env"
  grep -qxF "APP_PUBLIC_ORIGIN=https://$host" "$ENV_DIR/env" || echo "WARNING: APP_PUBLIC_ORIGIN in $ENV_DIR/env is not https://$host" >&2
  echo "kept existing $ENV_DIR/env"
fi

step "systemd unit, journald retention, Caddyfile"
if install_if_different "$vm/detonation-ocean.service" /etc/systemd/system/detonation-ocean.service 0644; then changed=1; systemctl daemon-reload; fi
install -d -m 0755 /etc/systemd/journald.conf.d
journald_conf="$(mktemp)"
printf '[Journal]\nStorage=persistent\nMaxRetentionSec=7day\n' > "$journald_conf"
if install_if_different "$journald_conf" /etc/systemd/journald.conf.d/detonation-ocean.conf 0644; then systemctl restart systemd-journald; fi
tls_directive=""
[ "$tls_internal" = 0 ] || tls_directive="tls internal"
global_option=""
[ "$no_http_redirect" = 0 ] || global_option="auto_https disable_redirects"
caddyfile="$(mktemp)"
sed -e "s|__PUBLIC_HOST__|$host|" -e "s|__TLS__|$tls_directive|" -e "s|__GLOBAL_OPTION__|$global_option|" "$vm/Caddyfile" > "$caddyfile"
caddy validate --adapter caddyfile --config "$caddyfile" >/dev/null 2>&1 || { caddy validate --adapter caddyfile --config "$caddyfile"; die "rendered Caddyfile is invalid"; }
caddy_changed=0
install_if_different "$caddyfile" /etc/caddy/Caddyfile 0644 && caddy_changed=1
rm -f "$journald_conf" "$caddyfile"

step "Host firewall (ufw): 80 and 443 from anywhere, 22 from ${operator_ip:-nowhere} only"
if [ "$skip_ufw" = 1 ]; then
  echo "SKIPPED (--skip-ufw): the host firewall is NOT configured"
else
  ufw --force reset >/dev/null
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow from "$operator_ip" to any port 22 proto tcp >/dev/null
  ufw --force enable >/dev/null
  ufw status verbose
fi

step "Start services"
systemctl enable docker caddy detonation-ocean >/dev/null 2>&1
if [ "$caddy_changed" = 1 ] || ! systemctl is-active --quiet caddy; then systemctl restart caddy; fi
if [ "$changed" = 1 ] || ! systemctl is-active --quiet detonation-ocean; then systemctl restart detonation-ocean; fi

step "Health check"
health=""
for _ in $(seq 1 60); do
  health="$(curl -fsS --max-time 3 http://127.0.0.1:4173/api/health 2>/dev/null || true)"
  [[ "$health" == *'"acceptingJobs":true'* ]] && break
  sleep 1
done
echo "controller (127.0.0.1:4173): ${health:-no answer}"
if [[ "$health" != *'"acceptingJobs":true'* ]]; then
  echo "journalctl -u detonation-ocean -n 30:" >&2
  journalctl -u detonation-ocean -n 30 --no-pager >&2 || true
  die "/api/health did not report acceptingJobs:true (DETONATION_ENABLED must be true in $ENV_DIR/env)"
fi

via_caddy=""
for _ in $(seq 1 30); do
  via_caddy="$(curl -fsSk --max-time 5 --resolve "$host:443:127.0.0.1" "https://$host/api/health" 2>/dev/null || true)"
  [[ "$via_caddy" == *'"acceptingJobs":true'* ]] && break
  sleep 1
done
echo "through Caddy (https://$host): ${via_caddy:-no answer}"
if [[ "$via_caddy" != *'"acceptingJobs":true'* ]]; then
  if [ "$tls_internal" = 1 ]; then die "Caddy did not proxy /api/health"; fi
  echo "WARNING: no answer through Caddy yet. Let's Encrypt needs DNS for $host to point at this VM and ports 80/443 open; check: journalctl -u caddy -n 30" >&2
fi

echo
echo "docker: $(docker --version)"
echo "runsc:  $(runsc --version | head -1)"
echo "node:   $(node --version)"
echo "caddy:  $(caddy version | cut -d' ' -f1)"
echo "setup complete"
