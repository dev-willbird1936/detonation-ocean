# Vultr VM deployment kit

Installs Detonation Ocean on one Vultr Cloud Compute VM (Ubuntu 24.04): Docker Engine and gVisor `runsc`, Node 22, the app under
systemd as user `detonation`, and Caddy for TLS in front of it. Design: `docs/SPEC.md` sections 3, 7, 10 and 15.4 to 15.5.

| File | Purpose |
|---|---|
| `setup.sh` | Idempotent installer, run as root on the VM |
| `detonation-ocean.service` | systemd unit (`User=detonation`, `EnvironmentFile=/etc/detonation-ocean/env`, `Restart=on-failure`) |
| `Caddyfile` | Template for `/etc/caddy/Caddyfile`: HTTPS, HSTS, reverse proxy to `127.0.0.1:4173` |
| `env.example` | Every variable of SPEC section 10 with comments; secrets empty |
| `daemon.json` | Docker runtimes `runsc` and `runsc-trace` (shared with the local WSL set-up) |
| `firewall.md` | Vultr firewall group rules |

## Cost and approval

**Steps 1 to 4 create billable or public resources.** A Vultr instance bills until it is destroyed, even while stopped.
Serverless Inference is billed per use. An agent or script must not do these steps on its own: the user approves the plan, the
region and the spend first, and the operator does them by hand in the Vultr console. Nothing in this kit calls the Vultr API, and
`setup.sh` creates no cloud resource.

## Steps

### 1. Create the firewall group (console, free)

Vultr console, **Products > Network > Firewall > Add Firewall Group**. Add the rules in [firewall.md](firewall.md): TCP 80 and 443
from anywhere, TCP 22 from your IP only.

### 2. Create the VM (console, **billable**)

**Deploy > Cloud Compute**, Ubuntu 24.04 LTS x64, at least 2 vCPU and 4 GB RAM (SPEC 10: confirm plan and price before approving),
the region closest to the judges, **no** backups or extra services. Add your SSH public key, attach the firewall group from step 1,
and tick IPv6 only if you add the matching rules. Note the public IPv4 address.

### 3. Point DNS at it (DNS provider)

Create an `A` record (and `AAAA` if the VM has IPv6) for the public host name, for example `detonation.example.org`, with the VM's
address. Check with `dig +short detonation.example.org`. Caddy requests its certificate when the name resolves to the VM, so the
HTTPS check at the end of `setup.sh` may only pass once DNS has propagated.

### 4. Get the code onto the VM

`git clone` the repository on the VM, or copy a clean checkout of the commit you want to deploy. Anything with `server.mjs` and
`deploy/` at its top level works as the checkout. Checkouts are LF (`.gitattributes` sets `eol=lf`); `setup.sh` refuses CRLF files.

### 5. Run the installer (on the VM, as root)

```
ssh root@<vm-ip>
bash /root/detonation-ocean-src/deploy/vultr-vm/setup.sh \
  --checkout /root/detonation-ocean-src \
  --host detonation.example.org \
  --operator-ip <your public IP>
```

`--operator-ip` is the only address the host firewall lets reach SSH. It must be the address you are connected from, or the next
SSH login fails (the console in the Vultr dashboard still works). Environment variables `PUBLIC_HOST` and `OPERATOR_IP` work in
place of the flags.

It takes several minutes the first time (Docker, gVisor, three image builds). It:

1. runs `deploy/local-wsl/setup.sh`: pinned Docker Engine and `runsc` from their official apt repos, `daemon.json` installed;
2. installs pinned Node 22 (NodeSource) and Caddy (official apt repo); override with `NODE_VERSION` and `CADDY_VERSION`;
3. creates user `detonation` (group `docker`), `/var/lib/detonation-ocean` (0700) and the host canary `host-canary` (32 random bytes, 0600);
4. copies the checkout to `/opt/detonation-ocean` (root-owned; the service cannot modify its own code) and builds the sandbox images;
5. creates `/etc/detonation-ocean/env` from `env.example` (0600, root) if it does not exist: **no secrets, placeholders only**;
6. installs the systemd unit, the Caddyfile and a journald drop-in with 7-day retention;
7. enables `ufw`: 80 and 443 open, 22 from `--operator-ip` only, everything else denied;
8. starts the services and calls `/api/health` on the controller and through Caddy.

Run it again any time (new commit, changed `--operator-ip`). It restarts the controller only when it installed something new, and it
never overwrites `/etc/detonation-ocean/env`.

### 5a. Login gate (on the VM, before the first start)

The Caddyfile imports `/etc/caddy/access.caddy`; Caddy will not start without it. Job reads carry a bearer token in `Authorization`, which `basic_auth` would reject, so exclude them from the gate:

```
@gated not path_regexp ^/api/jobs/[^/]+
basic_auth @gated {
	<user> <hash from: caddy hash-password>
}
```

A host name without a domain: `<ip with dashes>.sslip.io` works with Let's Encrypt (for `149.28.93.208`: `149-28-93-208.sslip.io`).

### 6. Fill in the environment (on the VM)

```
sudoedit /etc/detonation-ocean/env
```

The defaults already accept uploads without the model (`DETONATION_INFERENCE_ENABLED=false`). To switch on explanations, once the
user has approved the inference key, set `VULTR_INFERENCE_API_KEY`, `VULTR_INFERENCE_CODE_MODEL` and
`DETONATION_INFERENCE_ENABLED=true`. `DAILY_INFERENCE_CALL_CAP` limits calls per day. Then:

```
sudo systemctl restart detonation-ocean
```

Never commit a filled env file, paste a key into a chat, or put one in a command line (shell history).

### 7. Check it

```
curl -s https://detonation.example.org/api/health
# {"ok":true,"buildId":"…","acceptingJobs":true,"queueDepth":0}
```

`acceptingJobs:true` means Docker answered and the start-up reaper pass was clean (SPEC 7.4). Check it after every deploy and every
restart. Also:

```
systemctl status detonation-ocean caddy --no-pager
journalctl -u detonation-ocean -n 50 --no-pager     # job ID, stage, timings; never file names or secrets
sudo ufw status verbose
```

Then run the checks at the end of [firewall.md](firewall.md) from another machine.

## Operating

| Task | How |
|---|---|
| Update the app | Repeat steps 4 and 5 with the new commit; the env file stays |
| Logs | `journalctl -u detonation-ocean` (kept 7 days), `journalctl -u caddy` |
| Backup | Daily, to your machine only: `scp root@<vm-ip>:/var/lib/detonation-ocean/ocean-state.json .` |
| Spend | Check Vultr billing daily during the event; `DAILY_INFERENCE_CALL_CAP` bounds inference |
| Health after restart | `curl -s https://<host>/api/health` |

## Kill switch

Stops all uploads; the ocean page stays visible.

```
sudo sed -i 's/^DETONATION_ENABLED=.*/DETONATION_ENABLED=false/' /etc/detonation-ocean/env
sudo systemctl restart detonation-ocean
```

Uploads then answer 503 and `/api/health` loses its `acceptingJobs` and `queueDepth` fields (it answers only `{"ok":true,"buildId":"…"}`).
Set the value back to `true` and restart to resume. For a harder stop: `sudo systemctl stop detonation-ocean caddy`, or delete the 80 and 443 rules in the
Vultr firewall group.

If `acceptingJobs` turns `false` by itself, the controller could not confirm that a job's containers and volumes were removed (or a
host-canary check failed). It stays closed until a restart with a clean reaper pass: inspect with `docker ps -a` and
`journalctl -u detonation-ocean`, then `sudo systemctl restart detonation-ocean`.

## Teardown after the hackathon

SPEC 15.5: destroy the VM, or keep it with uploads disabled; revoke the inference key. Billing stops only when the instance is
destroyed.

1. `scp root@<vm-ip>:/var/lib/detonation-ocean/ocean-state.json .` to keep the ocean.
2. Revoke the Serverless Inference key in the Vultr console.
3. Console: **Destroy** the instance (this deletes the disk and everything on it, including the host canary and any job data).
4. Delete the firewall group, any snapshot or backup you made, and the DNS records for the host name.
5. Check the Vultr billing page shows no running instance.

## Local dry run

The kit was exercised on a throwaway Ubuntu 24.04 WSL2 distro with systemd, a made-up host name, `--tls-internal` (Caddy issues a
local certificate), and `--no-http-redirect` (Windows already owned port 80). Those two flags exist for dry runs only; the VM runs
without them.
