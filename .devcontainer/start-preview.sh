#!/usr/bin/env bash
set -euo pipefail

if pgrep -f 'uvicorn app:app --app-dir backend' >/dev/null 2>&1; then
  exit 0
fi

nohup python -m uvicorn app:app --app-dir backend --host 0.0.0.0 --port 8000 \
  >/tmp/ai4law-simulator.log 2>&1 &
