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
# Windows (Git Bash): no unix sockets and no C.UTF-8 locale -> TCP on 127.0.0.1, locale C
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) win=1;; *) win=;; esac
if [ -n "$win" ]; then loc=C; host=127.0.0.1; opts="-p $port -c listen_addresses=127.0.0.1"; psql="$bin/psql"; nul=NUL; else loc=C.UTF-8; host="$dir"; opts="-p $port -k $dir -c listen_addresses="; psql=psql; nul=/dev/null; fi
as_pg "$bin/initdb -D $dir/data -A trust -U postgres -E UTF8 --locale=$loc" >/dev/null
as_pg "$bin/pg_ctl -D $dir/data -l $dir/log -o '$opts' -w start" >/dev/null
export PGCLIENTENCODING=UTF8
run() { "$psql" -h "$host" -p "$port" -U postgres -d postgres -v ON_ERROR_STOP=1 -v nul="$nul" -q -At "$@"; }
run -f "$here/stubs.sql"
run -f "$mig/0001_init.sql"
run -f "$here/before_0002.sql"
run -f "$mig/0002_trial_protection.sql"
[ -n "${DEBUG:-}" ] && set -x; out="$(run -f "$here/checks_0002.sql" 2>&1)" || { echo "$out"; echo "CHECK SCRIPT ERROR"; exit 1; }
run -f "$mig/0003_profiles_clans.sql"
out="$out
$(run -f "$here/checks_0003.sql" 2>&1)" || { echo "$out"; echo "CHECK SCRIPT ERROR (0003)"; exit 1; }
run -f "$mig/0004_social_moderation.sql"
out="$out
$(run -f "$here/checks_0004.sql" 2>&1)" || { echo "$out"; echo "CHECK SCRIPT ERROR (0004)"; exit 1; }
run -f "$mig/0005_profile_showcase.sql"
out="$out
$(run -f "$here/checks_0005.sql" 2>&1)" || { echo "$out"; echo "CHECK SCRIPT ERROR (0005)"; exit 1; }
echo "$out" | grep -E '^(PASS|FAIL) ' || true
if echo "$out" | grep -q '^FAIL '; then echo "FAILED"; exit 1; fi
echo "ALL PASS ($(echo "$out" | grep -c '^PASS ') checks)"
