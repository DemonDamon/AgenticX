#!/usr/bin/env bash
# Shared DB contract suite for PostgreSQL / MySQL CI matrix.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

DIALECT="${DATABASE_DIALECT:-}"
URL="${DATABASE_URL:-}"

if [[ -z "$DIALECT" || -z "$URL" ]]; then
  echo "DATABASE_DIALECT and DATABASE_URL are required" >&2
  exit 1
fi

echo "[ci] dialect=$DIALECT"
echo "[ci] seeding fixture..."
pnpm exec tsx scripts/ci/seed-db-compat-fixture.ts

echo "[ci] running iam-core + portability unit gates..."
pnpm --filter @agenticx/iam-core test
pnpm db:portability:test

echo "[ci] ok"
