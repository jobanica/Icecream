#!/usr/bin/env bash
# Recreate a throwaway database, apply stubs + all migrations (+ optional seed).
# Usage: supabase/tests/reset_local.sh [--seed]
set -euo pipefail
DB=${DB:-softserve_test}
DIR=$(cd "$(dirname "$0")/.." && pwd)
PSQL="psql -v ON_ERROR_STOP=1 -q -X"
dropdb --if-exists "$DB" && createdb "$DB"
$PSQL -d "$DB" -f "$DIR/tests/local_stubs.sql"
for f in "$DIR"/migrations/*.sql; do
  echo "== $(basename "$f")"
  $PSQL -d "$DB" -f "$f"
done
if [[ "${1:-}" == "--seed" ]]; then
  echo "== seed.sql"
  $PSQL -d "$DB" -f "$DIR/seed.sql"
fi
