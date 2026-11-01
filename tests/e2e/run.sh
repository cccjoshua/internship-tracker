#!/usr/bin/env bash
# Runs the browser end-to-end flow against a throwaway data folder and a stubbed Claude (no network, no cost).
# Needs Node with Playwright:  npm i -D playwright@1 && npx playwright install chromium
set -euo pipefail
cd "$(dirname "$0")/../.."
DATA="$(mktemp -d)"; PORT="${PORT:-8799}"
python3 scripts/make_demo_data.py "$DATA" >/dev/null
python3 tests/e2e/fake_feed.py "$DATA"  # fictional feed entries for the hidden-listings search
IAT_AI_STUB=1 python3 server.py --data "$DATA" --no-fetch --no-browser --port "$PORT" >"$DATA/server.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; rm -rf "$DATA"' EXIT
for _ in $(seq 50); do curl -sf "http://127.0.0.1:$PORT/" >/dev/null && break; sleep 0.1; done
node tests/e2e/flow.e2e.js "http://127.0.0.1:$PORT" "${1:-}"
node tests/e2e/palette.e2e.js "http://127.0.0.1:$PORT"
