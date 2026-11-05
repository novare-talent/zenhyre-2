#!/usr/bin/env bash
# Starts/stops a throwaway Postgres 16 cluster on port 5433 for tests.
# Postgres refuses to run as root, so when invoked as root the server runs as the `postgres` system user,
# which must be able to traverse every parent directory of the repo (755). A 700 home directory will fail here.
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/.test-pg"
DATA="$DIR/data"
PORT=5433
if [ "$(id -u)" = "0" ]; then AS="runuser -u postgres --"; else AS=""; fi
case "${1:-}" in
  start)
    mkdir -p "$DIR"
    [ -n "$AS" ] && chown postgres "$DIR"
    if [ ! -d "$DATA" ]; then
      $AS "$PGBIN/initdb" -D "$DATA" -U zenhyre --auth=trust >/dev/null
      echo "port = $PORT" >> "$DATA/postgresql.conf"
      echo "unix_socket_directories = '$DIR'" >> "$DATA/postgresql.conf"
    fi
    $AS "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1 || $AS "$PGBIN/pg_ctl" -D "$DATA" -l "$DIR/log" -w start >/dev/null
    "$PGBIN/psql" -h localhost -p $PORT -U zenhyre -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='zenhyre'" | grep -q 1 \
      || "$PGBIN/createdb" -h localhost -p $PORT -U zenhyre zenhyre
    echo "DATABASE_URL=postgres://zenhyre:zenhyre@localhost:$PORT/zenhyre"
    ;;
  stop)
    $AS "$PGBIN/pg_ctl" -D "$DATA" -w stop >/dev/null || true
    ;;
  *) echo "usage: $0 start|stop"; exit 1;;
esac
