#!/usr/bin/env bash
# Readiness of the local detonation stack in the detonation-ocean distro. Prints one line per check; exit 1 if any fails.
cd "$(dirname "$0")/../.."
fail=0
ok() { echo "ok    $1"; }
bad() { echo "FAIL  $1"; fail=1; }
docker info >/dev/null 2>&1 && ok docker || bad "docker is not running"
docker info --format '{{json .Runtimes}}' 2>/dev/null | grep -q '"runsc-trace"' && ok "runtime runsc-trace" || bad "runtime runsc-trace missing (run deploy/local-wsl/setup.sh)"
[ -d /var/log/runsc ] && ok /var/log/runsc || bad "/var/log/runsc missing"
node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' 2>/dev/null && ok "node $(node --version)" || bad "node 22+ missing"
# Every image in the lock must exist with exactly the locked id.
for pair in $(node -e 'for (const [k, v] of Object.entries(JSON.parse(require("fs").readFileSync("deploy/detonation/images.lock.json", "utf8")))) if (typeof v === "string") console.log(k + "=" + v)'); do
  name=${pair%%=*} want=${pair#*=}
  have=$(docker image inspect --format '{{.Id}}' "$name" 2>/dev/null)
  [ "$have" = "$want" ] && ok "image $name" || bad "image $name: have ${have:-none}, lock wants $want"
done
exit $fail
