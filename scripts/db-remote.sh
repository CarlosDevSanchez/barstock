#!/usr/bin/env bash
# Migrations against the REAL Supabase project named by an env file (default .env.production). A controlled step:
# read docs/05-guias/verificar-checkout.md first (backup, read-only checks before/after, migrate BEFORE deploying code).
#
#   bun run db:remote:link     links the CLI to the project in the env file (asks for the database password)
#   bun run db:remote:status   migrations applied on the remote vs local (read-only)
#   bun run db:remote:dry      what a push would apply, without applying it (read-only)
#   bun run db:remote:push     applies pending migrations, after typing the project ref to confirm
#
# The env file only yields the project ref (from NEXT_PUBLIC_SUPABASE_URL): its API keys cannot run DDL. The database
# password comes from SUPABASE_DB_PASSWORD (the CLI reads it) or the CLI prompts for it. Never write it to a file.
# Another env file: ENV_FILE=.env.staging bun run db:remote:status
set -euo pipefail
cd "$(dirname "$0")/.."

env_file="${ENV_FILE:-.env.production}"
[ -f "$env_file" ] || { echo "Missing $env_file" >&2; exit 1; }

url="$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' "$env_file" | tail -1 | cut -d= -f2- | tr -d '"'"'"' ')"
ref="$(printf '%s' "$url" | sed -nE 's#^https://([a-z0-9]{20})\.supabase\.co/?$#\1#p')"
[ -n "$ref" ] || { echo "No Supabase project ref in NEXT_PUBLIC_SUPABASE_URL of $env_file (expected https://<ref>.supabase.co)" >&2; exit 1; }

linked="$(cat supabase/.temp/project-ref 2>/dev/null || true)"

# Every command but `link` refuses to run against a project other than the one in the env file.
require_linked() {
    if [ "$linked" != "$ref" ]; then
        echo "The CLI is linked to '${linked:-nothing}', but $env_file points at '$ref'. Run: bun run db:remote:link" >&2
        exit 1
    fi
}

case "${1:-}" in
    link)
        supabase link --project-ref "$ref"
        ;;
    status)
        require_linked
        supabase migration list --linked
        ;;
    dry)
        require_linked
        supabase db push --linked --dry-run
        ;;
    push)
        require_linked
        supabase db push --linked --dry-run
        echo
        echo "About to apply the migrations above to the REAL project '$ref' ($env_file)."
        echo "Backup taken and verificar-checkout.md read? Type the project ref to continue:"
        read -r answer
        [ "$answer" = "$ref" ] || { echo "Cancelled."; exit 1; }
        supabase db push --linked
        echo "Done. Next: bun run db:types (local) and the read-only checks in docs/05-guias/verificar-checkout.md."
        ;;
    *)
        echo "Usage: $0 {link|status|dry|push}" >&2
        exit 1
        ;;
esac
