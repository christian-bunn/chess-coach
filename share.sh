#!/usr/bin/env bash
# Share the coach with a friend: build the page, start the server if it isn't running already, and put it on the
# internet. With Tailscale (README, "A link they can bookmark") the link is the same one every time, so your
# friends can keep it; without it, a Cloudflare quick tunnel gives a fresh random link, no account needed.
# Either way the link only works while the server is running; Ctrl+C stops sharing.
set -euo pipefail
cd "$(dirname "$0")"

npm --prefix frontend run build

# Ask for the page itself, not just the API. The backend mounts the built page only if frontend/dist was
# there when it started (main.py), so a server left over from ./dev.sh before the first build answers
# /api/health but 404s the page, and the tunnel would hand your friend a "Not Found".
started=false
if ! curl -sf http://127.0.0.1:8000/ >/dev/null; then
  if curl -sf http://127.0.0.1:8000/api/health >/dev/null; then
    echo "Port 8000 is taken by a server that isn't serving the page: it started before the page was" >&2
    echo "built. Stop it (Ctrl+C where you started it) and run this again." >&2
    exit 1
  fi
  node backend.mjs &
  server=$!
  started=true
  trap 'kill $server' EXIT
  until curl -sf http://127.0.0.1:8000/ >/dev/null; do sleep 1; done
fi

# tailscale: on PATH, or where the Windows and macOS installers put it.
tailscale=
for candidate in "$(command -v tailscale || true)" "/c/Program Files/Tailscale/tailscale.exe" \
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    tailscale=$candidate
    break
  fi
done

# Signed in to a tailnet: serve the coach on this machine's own name, the same one every time. Setting the
# funnel is idempotent and it stays on across reboots, so this only has to get it right once. The first run
# prints a link to turn Funnel on for the tailnet and waits there until you have, which is why tailscale's
# own output is left on screen; the error below is for when it gives up instead.
if [ -n "$tailscale" ] && "$tailscale" status >/dev/null 2>&1; then
  if ! "$tailscale" funnel --bg 8000; then
    echo >&2
    echo "Tailscale wouldn't put the coach on the internet (above). Funnel has to be turned on for your" >&2
    echo "tailnet first: https://tailscale.com/kb/1223/funnel" >&2
    exit 1
  fi
  # || true: a grep that matches nothing would take the script down with it (pipefail), and the funnel is on
  # either way, so an unreadable status is worth printing rather than dying over.
  link=$("$tailscale" funnel status | grep -o 'https://[^ ]*\.ts\.net' | head -1 || true)
  echo
  if [ -n "$link" ]; then
    echo "Your friends can bookmark: $link"
  else
    echo "Tailscale is serving the coach. Your link is in here somewhere:"
    "$tailscale" funnel status
  fi
  echo
  if [ "$started" = false ]; then
    echo "The server was already running, so there's nothing to keep open here."
    exit 0
  fi
  echo "It works while this keeps running. Ctrl+C stops sharing."
  wait "$server"
  exit
fi

cloudflared=$(command -v cloudflared || echo "$HOME/.local/bin/cloudflared")
if [ ! -x "$cloudflared" ]; then
  echo "cloudflared not found. Install it from" >&2
  echo "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" >&2
  exit 1
fi
"$cloudflared" tunnel --no-autoupdate --url http://127.0.0.1:8000
