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

echo "== replay migrations (every file, in version order) =="
# No hand-picked subset: a from-scratch rebuild has to survive the whole
# directory in the order Supabase would apply it, or the repo is not
# reproducible.
fails=0
for f in $(ls "$REPO_ROOT"/supabase/migrations/*.sql | sort); do
  if err=$($PSQL -f "$f" 2>&1 >/dev/null); then
    printf '  ok    %s\n' "$(basename "$f")"
  else
    printf '  FAIL  %s\n' "$(basename "$f")"
    printf '%s\n' "$err" | sed 's/^/          /'
    fails=$((fails+1))
  fi
done
[ "$fails" -eq 0 ] || { echo "$fails migration(s) failed to replay" >&2; exit 1; }

echo "== every foreign key resolves =="
# A dangling FK cannot exist in Postgres, but a *missing* one can: if a table
# were stubbed away the constraint would simply be absent. Assert the ones the
# POS depends on are really there.
$PSQL -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare missing text;
begin
  select string_agg(t || '.' || c, ', ') into missing
  from (values
    ('pos_merchants','business_submission_id'),
    ('marketplace_listings','business_submission_id'),
    ('marketplace_listings','pos_merchant_id'),
    ('pos_outlets','merchant_id'),
    ('pos_products','merchant_id'),
    ('pos_orders','merchant_id'),
    ('pos_order_items','order_id'),
    ('pos_payments','order_id'),
    ('pos_chat_messages','order_id'),
    ('pos_memberships','merchant_id')
  ) as want(t,c)
  where not exists (
    select 1
    from pg_constraint k
    join pg_class rel on rel.oid = k.conrelid
    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
    where k.contype = 'f' and rel.relname = want.t and a.attname = want.c
  );
  if missing is not null then
    raise exception 'missing foreign keys: %', missing;
  end if;
  raise notice 'all expected foreign keys present';
end $$;
SQL

echo "== recovered schema matches production =="
$PSQL -f "$HERE/04-recovered-schema-fidelity.sql"

echo "== seed two tenants =="
$PSQL -f "$HERE/02-seed-two-tenants.sql" >/dev/null

echo "== cross-tenant attacks (every line must deny) =="
psql -h /tmp -p "$PGPORT" -U postgres -f "$HERE/03-tenant-isolation-attacks.sql" 2>&1 \
  | grep -vE '^(SAVEPOINT|ROLLBACK|BEGIN|SET|Pager|\s*$)' \
  | sed 's#psql:.*03-tenant-isolation-attacks.sql:[0-9]*: ##'

echo
if [ "${KEEP:-0}" = "1" ]; then
  echo "== done; cluster left running on port $PGPORT (KEEP=1) =="
  echo "   psql -h /tmp -p $PGPORT -U postgres"
else
  echo "== done; stopping cluster =="
  run "$PGBIN/pg_ctl -D $PGDATA_DIR stop -m fast" >/dev/null 2>&1 || true
fi
