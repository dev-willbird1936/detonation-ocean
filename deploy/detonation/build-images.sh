#!/bin/bash
# Builds detonation-ocean/{detonate,collect,analyse,wine}, prints each image digest (the image ID, a content hash of the
# image config) and writes images.lock.json {image: digest}. Run where the Docker daemon runs (Linux or WSL).
# After a rebuild run `node tests/fixtures/detonation/inspect/sync-image-ids.mjs` so the recorded inspect fixtures carry the new digests.
# DOCKER_BUILD_NETWORK=host builds with the host's DNS where the bridge's is broken (WSL).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
lock="$here/images.lock.json"
roles=(detonate collect analyse wine)

entries=()
for role in "${roles[@]}"; do
  image="detonation-ocean/$role"
  docker build --quiet ${DOCKER_BUILD_NETWORK:+--network "$DOCKER_BUILD_NETWORK"} --file "$here/Dockerfile.$role" --tag "$image:latest" "$here" >/dev/null
  digest="$(docker image inspect --format '{{.Id}}' "$image:latest")"
  echo "$image $digest"
  entries+=("  \"$image\": \"$digest\"")
done

{
  echo "{"
  for i in "${!entries[@]}"; do
    if [ "$i" -lt $((${#entries[@]} - 1)) ]; then echo "${entries[$i]},"; else echo "${entries[$i]}"; fi
  done
  echo "}"
} > "$lock"
echo "wrote $lock"
