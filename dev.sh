#!/usr/bin/env bash
# Run the backend (http://127.0.0.1:8000) and the frontend dev server (http://localhost:5173) together.
set -euo pipefail
cd "$(dirname "$0")"

node backend.mjs &
backend_pid=$!
trap 'kill $backend_pid 2>/dev/null' EXIT

npm --prefix frontend run dev
