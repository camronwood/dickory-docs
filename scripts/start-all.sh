#!/usr/bin/env bash
# Dickory Docs: Vite on 5177 (see vite.config.ts) + Tauri.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DICKORY_DOCS="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "Starting Dickory Docs (tauri dev) from: $DICKORY_DOCS"
cd "$DICKORY_DOCS"
exec npm run tauri:dev
