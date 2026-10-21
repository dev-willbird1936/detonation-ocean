#!/usr/bin/env bash
# Local detonation stack in the detonation-ocean distro: real gVisor sandbox, no Vultr. Uploads are accepted; the model
# (Vultr Serverless Inference) stays off, so jobs finish without the AI explanation. Started by start-hackathon-demo.bat.
set -euo pipefail
cd "$(dirname "$0")/../.."
bash deploy/local-wsl/check.sh || { echo "The local sandbox is not ready; see FAIL lines above and deploy/local-wsl/README.md."; exit 1; }

# Nothing that could reach Vultr or another cloud.
for key in $(env | grep -oE '^(VULTR_[A-Z_]*|DETONATION_INFERENCE_ENABLED|INFERENCE_[A-Z_]*)=' | tr -d =); do unset "$key"; done
export DETONATION_ENABLED=true
export DETONATION_DATA_DIR=/var/lib/detonation-ocean-local
export ENABLE_TEMPLATE_DESKTOPS=true
export PORT="${PORT:-4173}" SHELLS_PORT="${SHELLS_PORT:-4189}"

# Each launch starts from the seeded fish schools.
mkdir -p "$DETONATION_DATA_DIR"
cp data/demo-ocean-state.json "$DETONATION_DATA_DIR/ocean-state.json"

echo "Local sandbox: uploads ON (gVisor), Vultr inference OFF. Data: $DETONATION_DATA_DIR"
exec node tools/start-desktops.mjs
