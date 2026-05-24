#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PI_AGENT_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"

mkdir -p "$PI_AGENT_DIR/extensions" "$PI_AGENT_DIR/themes"
rsync -a --delete --exclude 'node_modules/' "$ROOT/extensions/" "$PI_AGENT_DIR/extensions/"
rsync -a --delete "$ROOT/themes/" "$PI_AGENT_DIR/themes/"

echo "Installed pi extensions and themes into $PI_AGENT_DIR"
echo "Restart pi or run /reload to reload extensions."
