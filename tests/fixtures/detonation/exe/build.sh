#!/bin/bash
# Builds the inert test programs of tests/fixtures/detonation/exe from the C sources next to this script, in the builder image of
# deploy/detonation/Dockerfile.builder (mingw-w64 and UPX; tools/build-test-binaries.sh builds the image). Run where Docker runs (WSL):
#   wsl -d detonation-ocean -u root -- bash /mnt/c/<repo>/tests/fixtures/detonation/exe/build.sh
# The build container has no network. Nothing here runs a built program. inert.exe (from inert.c) is committed as built earlier and is
# only packed here.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
docker image inspect detonation-ocean/builder-compile >/dev/null

docker run --rm --network none --env HOST_UID="$(id -u)" --env HOST_GID="$(id -g)" --volume "$here:/exe" detonation-ocean/builder-compile bash -euc '
  cd /exe
  cc=(x86_64-w64-mingw32-gcc -O2 -s -static -Wall -Wl,--no-insert-timestamp)
  "${cc[@]}" -mwindows -o probe-effects.exe probe-effects.c
  "${cc[@]}" -mconsole -o probe-wine-check.exe probe-wine-check.c
  x86_64-w64-mingw32-dlltool -d probe-missing-dll.def -l /tmp/libmissing-probe.a
  "${cc[@]}" -mconsole -o probe-missing-dll.exe probe-missing-dll.c /tmp/libmissing-probe.a
  rm -f inert-upx.exe
  upx --best --quiet -o inert-upx.exe inert.exe
  chown "$HOST_UID:$HOST_GID" probe-effects.exe probe-wine-check.exe probe-missing-dll.exe inert-upx.exe
'
ls -l "$here"/*.exe
