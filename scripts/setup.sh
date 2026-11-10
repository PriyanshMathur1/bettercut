#!/usr/bin/env bash
# One-time setup: Python environment, editor build, sound effects.
# Needs Python 3.10+, Node 22+ and ffmpeg on your PATH.
set -euo pipefail
cd "$(dirname "$0")/.."

for tool in python3 node npm ffmpeg; do
  command -v "$tool" >/dev/null || { echo "Missing: $tool. Install it and run this again."; exit 1; }
done

python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt

(cd composer && npm ci --no-audit --no-fund && npm run editor:build)

.venv/bin/python -m bettercut sfx

echo
echo "Ready. Start the editor with:  .venv/bin/python -m bettercut ui"
