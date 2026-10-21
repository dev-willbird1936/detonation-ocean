# Vultr firewall group for the Detonation Ocean VM

SPEC section 10: inbound 80 and 443 from anywhere, 22 from the operator's IP only. Creating the group is a console step the
operator does by hand (see [README.md](README.md)); nothing in this repository calls the Vultr API.

## Rules

Vultr Firewall filters **inbound** traffic only and drops anything no rule accepts. Add every rule for both IPv4 and IPv6 where the
VM has an IPv6 address.

| Action | Protocol | Port | Source | Why |
|---|---|---|---|---|
| Accept | TCP | 80 | Anywhere (`0.0.0.0/0`, `::/0`) | Let's Encrypt HTTP challenge and the redirect to HTTPS |
| Accept | TCP | 443 | Anywhere (`0.0.0.0/0`, `::/0`) | The site |
| Accept | TCP | 22 | `<operator IP>/32` (IPv6: `/128`) | SSH. Never "Anywhere" |

- **Do not open** 4173 (the controller listens on loopback only), 2019 (Caddy admin, loopback only) or UDP 443 (HTTP/3; browsers fall
  back to HTTPS over TCP).
- **No outbound rules.** Vultr Firewall does not filter traffic that leaves the VM. Sandbox containers have no network at all
  (`--network none`); the host can reach the internet for apt, Docker Hub and Vultr Serverless Inference.
- Attach the group to the VM when you create it, or afterwards on the instance's **Firewall** tab.
- If your IP changes, edit the SSH rule in the Vultr console **and** re-run `setup.sh --operator-ip <new IP>` so the host firewall
  (ufw) allows the new address too. The VM has two layers on purpose: the Vultr group in front, `ufw` on the host.
- If you lock yourself out of SSH, use **View Console** on the instance page (no SSH needed), fix the rule, and carry on.

## Check from outside

From a machine that is **not** the operator IP, after DNS points at the VM:

```
curl -sI https://<host>/ | head -1          # HTTP/2 200
curl -sI http://<host>/  | head -1          # HTTP/1.1 308, redirect to HTTPS
nc -vz -w 3 <vm-ip> 22                      # must time out
nc -vz -w 3 <vm-ip> 4173                    # must time out
```
