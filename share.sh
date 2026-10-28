#!/usr/bin/env bash
# Share the coach with a friend: build the page, start the server if it isn't running already, and open a
# Cloudflare quick tunnel to it (no account needed). The tunnel prints a https://...trycloudflare.com link to
# send them. It works while this keeps running; Ctrl+C stops sharing. The link changes every time.
set -euo pipefail
cd "$(dirname "$0")"

npm --prefix frontend run build

if ! curl -sf http://127.0.0.1:8000/api/health >/dev/null; then
  node backend.mjs &
  server=$!
  trap 'kill $server' EXIT
  until curl -sf http://127.0.0.1:8000/api/health >/dev/null; do sleep 1; done
fi

cloudflared=$(command -v cloudflared || echo "$HOME/.local/bin/cloudflared")
if [ ! -x "$cloudflared" ]; then
  echo "cloudflared not found. Install it from" >&2
  echo "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" >&2
  exit 1
fi
"$cloudflared" tunnel --no-autoupdate --url http://127.0.0.1:8000
