#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! pgrep -f 'uvicorn app:app --app-dir backend' >/dev/null 2>&1; then
  nohup python -m uvicorn app:app --app-dir backend --host 0.0.0.0 --port 8000 >/tmp/ai4law-api.log 2>&1 &
fi
if ! pgrep -f 'next dev -H 0.0.0.0 -p 3000' >/dev/null 2>&1; then
  (cd frontend && nohup npm run dev >/tmp/ai4law-web.log 2>&1 &)
fi
