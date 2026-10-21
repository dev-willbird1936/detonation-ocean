#!/bin/bash
# Builds the harmless test binaries in samples/bin from the C sources and the Inno Setup script in samples/src (docs/SPEC.md 11, 12;
# AT-19 to AT-24). Run where the Docker daemon runs (Linux or WSL), for example:
#   wsl -d Ubuntu-24.04 -- bash -lc 'cd /mnt/c/SyncedProjects/Websites/Vultr-Phishing-Sandbox && tools/build-test-binaries.sh'
# The images are built from deploy/detonation/Dockerfile.builder (network on, for apt and the checksummed Inno Setup download).
# The build containers then run with --network none. Nothing here runs a built binary: the containers compile, pack and
# compile an installer script, and that is all.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dockerfile="$root/deploy/detonation/Dockerfile.builder"
src="$root/samples/src"
out="$root/samples/bin"
mkdir -p "$out"

docker build --quiet --target compile --tag detonation-ocean/builder-compile:latest - < "$dockerfile" >/dev/null
docker build --quiet --target installer --tag detonation-ocean/builder-installer:latest - < "$dockerfile" >/dev/null

# Step 1: compile the four programs, then pack a copy of runkey.exe. --no-insert-timestamp keeps the output reproducible.
docker run --rm --network none --env HOST_UID="$(id -u)" --env HOST_GID="$(id -g)" \
  --volume "$src:/src:ro" --volume "$out:/out" detonation-ocean/builder-compile bash -euc '
  cd /out
  cc=(x86_64-w64-mingw32-gcc -O2 -s -static -Wall -Wl,--no-insert-timestamp)
  "${cc[@]}" -mwindows -o runkey.exe /src/runkey.c
  "${cc[@]}" -mconsole -o wine-check.exe /src/wine-check.c
  "${cc[@]}" -mconsole -o needs-unimplemented.exe /src/needs-unimplemented.c
  rm -f runkey-upx.exe
  upx --best --quiet -o runkey-upx.exe runkey.exe
  chown "$HOST_UID:$HOST_GID" runkey.exe runkey-upx.exe wine-check.exe needs-unimplemented.exe
'

# Step 2: compile the Inno Setup script under Wine. It wraps the unpacked runkey.exe.
docker run --rm --network none --env HOST_UID="$(id -u)" --env HOST_GID="$(id -g)" \
  --volume "$src:/src:ro" --volume "$out:/out" detonation-ocean/builder-installer bash -euc '
  work="$(mktemp -d)"
  cp /src/setup-demo.iss /out/runkey.exe "$work"/
  Xvfb :99 -screen 0 1024x768x16 & xvfb=$!
  sleep 2
  (cd "$work" && wine "C:\\InnoSetup\\ISCC.exe" setup-demo.iss)
  wineserver --wait
  kill "$xvfb"
  cp "$work/setup-demo.exe" /out/setup-demo.exe
  chown "$HOST_UID:$HOST_GID" /out/setup-demo.exe
'

echo "built into $out:"
ls -l "$out"
