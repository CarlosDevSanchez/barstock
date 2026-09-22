#!/usr/bin/env bash
# Stops the app container (whichever mode: `local:up` or `local:dev`), the MinIO/R2 stand-in and the local Supabase
# stack. `--reset` also deletes the database volume, the dev node_modules/.next cache volumes and the R2 (MinIO)
# object storage volume (fresh start next time).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env.docker ]; then
    down_args=(-f docker-compose.yml -f docker-compose.local.yml -f docker-compose.dev.yml -f docker-compose.r2.yml --env-file .env.docker down --remove-orphans)
    [ "${1:-}" = "--reset" ] && down_args+=(--volumes)
    docker compose "${down_args[@]}"
else
    docker rm -f barstock_app barstock_app_dev barstock_r2 barstock_r2_init >/dev/null 2>&1 || true
fi
if [ "${1:-}" = "--reset" ]; then supabase stop --no-backup; else supabase stop; fi
echo "Stopped."
