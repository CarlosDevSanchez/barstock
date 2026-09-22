#!/usr/bin/env bash
# Stops the app container and the local Supabase stack. `--reset` also deletes the database volume (fresh start next time).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env.docker ]; then docker compose --env-file .env.docker down; else docker rm -f barstock_app >/dev/null 2>&1 || true; fi
if [ "${1:-}" = "--reset" ]; then supabase stop --no-backup; else supabase stop; fi
echo "Stopped."
