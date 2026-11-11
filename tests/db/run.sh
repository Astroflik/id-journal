#!/usr/bin/env bash
# Applies the migrations to a throwaway local Postgres 16 with Supabase
# stand-ins and runs the checks. Needs Postgres 16 binaries and a "postgres"
# OS user when started as root. Usage: tests/db/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; mig="$here/../../supabase/migrations"
bin="${PGBIN:-/usr/lib/postgresql/16/bin}"; dir="$(mktemp -d /tmp/journal-pg.XXXXXX)"; port=54329
as_pg() { if [ "$(id -u)" = 0 ]; then chown -R postgres "$dir"; su postgres -c "$*"; else bash -c "$*"; fi; }
cleanup() { as_pg "$bin/pg_ctl -D $dir/data -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$dir"; }
trap cleanup EXIT
as_pg "$bin/initdb -D $dir/data -A trust -U postgres" >/dev/null
as_pg "$bin/pg_ctl -D $dir/data -o '-p $port -k $dir -c listen_addresses=' -w start" >/dev/null
run() { psql -h "$dir" -p "$port" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -At "$@"; }
run -f "$here/stubs.sql"
run -f "$mig/0001_init.sql"
run -f "$here/before_0002.sql"
run -f "$mig/0002_trial_protection.sql"
out="$(run -f "$here/checks_0002.sql" 2>&1)" || { echo "$out"; echo "CHECK SCRIPT ERROR"; exit 1; }
echo "$out" | grep -E '^(PASS|FAIL) ' || true
if echo "$out" | grep -q '^FAIL '; then echo "FAILED"; exit 1; fi
echo "ALL PASS ($(echo "$out" | grep -c '^PASS ') checks)"
