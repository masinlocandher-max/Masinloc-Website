#!/usr/bin/env bash
# Replay the POS migrations onto a throwaway local Postgres and attack the
# result as a real authenticated tenant.
#
# WHY THIS EXISTS
#
# Tenant isolation cannot be tested against the hosted project from a read-only
# connection: that role carries rolbypassrls, so RLS never applies to it, and
# the POS gate functions are granted only to `authenticated`. Reasoning about
# the policies is not the same as executing them. This stands up a stock
# Postgres, replays the recovered migrations, seeds two merchants, then runs
# every cross-tenant read, write and RPC as merchant A aimed at merchant B.
#
# It proves two separate things:
#   1. The recovered migrations actually replay in order on an empty database.
#   2. The policies and RPCs deny cross-tenant access when really executed.
#
# Requires the postgresql server binaries (initdb/postgres), not just psql.
# Nothing here touches the hosted project.

set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGDATA_DIR=${PGDATA_DIR:-/tmp/pgdata-masinloc-pos}
# Pick a free port rather than assuming one: a leftover cluster holding the
# socket makes pg_ctl fail with an opaque "could not start server".
pick_port() {
  local p=${PGPORT:-5433}
  while [ "$p" -lt 5500 ]; do
    if [ ! -e "/tmp/.s.PGSQL.$p.lock" ] && ! (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null; then
      echo "$p"; return
    fi
    p=$((p+1))
  done
  echo "no free port in 5433-5499" >&2; exit 2
}
PGPORT=$(pick_port)
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
HERE=$(cd "$(dirname "$0")" && pwd)

if [ ! -x "$PGBIN/initdb" ]; then
  echo "postgres server binaries not found at $PGBIN (set PGBIN)" >&2
  exit 2
fi

# Postgres refuses to run as root, so the cluster is owned by an unprivileged
# user when this is invoked with elevated privileges.
RUNAS=""
if [ "$(id -u)" = "0" ]; then
  RUNAS=$(id -un postgres 2>/dev/null || echo "")
  [ -n "$RUNAS" ] || { echo "running as root and no 'postgres' user to drop to" >&2; exit 2; }
fi

run() { if [ -n "$RUNAS" ]; then su "$RUNAS" -c "$1"; else bash -c "$1"; fi; }

echo "== fresh cluster =="
run "$PGBIN/pg_ctl -D $PGDATA_DIR stop -m immediate" >/dev/null 2>&1 || true
rm -rf "$PGDATA_DIR"; mkdir -p "$PGDATA_DIR"
[ -n "$RUNAS" ] && chown -R "$RUNAS" "$PGDATA_DIR"
run "$PGBIN/initdb -D $PGDATA_DIR -U postgres --auth=trust" >/dev/null
run "$PGBIN/pg_ctl -D $PGDATA_DIR -o '-p $PGPORT -k /tmp -c listen_addresses=' -l $PGDATA_DIR/log start" >/dev/null
for _ in $(seq 1 20); do psql -h /tmp -p "$PGPORT" -U postgres -c 'select 1' >/dev/null 2>&1 && break; sleep 1; done

PSQL="psql -h /tmp -p $PGPORT -U postgres -q -v ON_ERROR_STOP=1"

echo "== supabase substrate =="
$PSQL -f "$HERE/01-supabase-shim.sql" >/dev/null

echo "== replay migrations =="
# security_events predates the POS work but one POS migration alters it.
$PSQL -f "$REPO_ROOT/supabase/migrations/20260823000000_rate_limit_and_security_events.sql" >/dev/null
fails=0
for f in $(ls "$REPO_ROOT"/supabase/migrations/2026082813*.sql \
                "$REPO_ROOT"/supabase/migrations/2026082814*.sql \
                "$REPO_ROOT"/supabase/migrations/202608291*.sql 2>/dev/null | sort); do
  if $PSQL -f "$f" >/dev/null 2>&1; then
    printf '  ok    %s\n' "$(basename "$f")"
  else
    printf '  FAIL  %s\n' "$(basename "$f")"; fails=$((fails+1))
  fi
done
[ "$fails" -eq 0 ] || { echo "$fails migration(s) failed to replay" >&2; exit 1; }

echo "== seed two tenants =="
$PSQL -f "$HERE/02-seed-two-tenants.sql" >/dev/null

echo "== cross-tenant attacks (every line must deny) =="
psql -h /tmp -p "$PGPORT" -U postgres -f "$HERE/03-tenant-isolation-attacks.sql" 2>&1 \
  | grep -vE '^(SAVEPOINT|ROLLBACK|BEGIN|SET|Pager|\s*$)' \
  | sed 's#psql:.*03-tenant-isolation-attacks.sql:[0-9]*: ##'

echo
echo "== done; stopping cluster =="
run "$PGBIN/pg_ctl -D $PGDATA_DIR stop -m fast" >/dev/null 2>&1 || true
