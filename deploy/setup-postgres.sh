#!/usr/bin/env bash
#
# Create labelhub DB + apply 2-GB-RAM tuning.
# Run on the SERVER as root, AFTER install-server.sh.
#
# Prints the generated DB password to STDOUT — save it into
# /etc/labelhub.env yourself; this script doesn't write secrets.

set -euo pipefail

PG_DATA="/var/lib/pgsql/16/data"
CONF_DIR="$PG_DATA/conf.d"
TUNING_CONF="$CONF_DIR/labelhub.conf"

if [[ ! -d "$PG_DATA" ]]; then
  echo "ERROR: $PG_DATA missing — run install-server.sh first." >&2
  exit 1
fi

echo "==> 1/3 tuning config (idempotent)"
install -d -m 0750 -o postgres -g postgres "$CONF_DIR"
cat > "$TUNING_CONF" <<'CONF'
# LabelHub — 2GB-RAM server tuning. Sized for 1.8GB physical + 2GB swap.
# Keep <= 1GB resident so Node + nginx fit.

listen_addresses = 'localhost'
port = 5432

# Memory
shared_buffers = 384MB
effective_cache_size = 1GB
work_mem = 4MB
maintenance_work_mem = 64MB
wal_buffers = 16MB

# Connections
max_connections = 50

# Planner (SSD)
random_page_cost = 1.1
effective_io_concurrency = 200

# WAL — small-server defaults
checkpoint_completion_target = 0.9
wal_compression = on

# Logging
log_min_duration_statement = 1000
log_destination = 'stderr'
logging_collector = on
log_directory = '/var/labelhub/logs/postgres'
log_filename = 'postgres-%Y-%m-%d.log'
log_rotation_age = 1d
log_rotation_size = 0
log_line_prefix = '%t [%p]: db=%d,user=%u '
log_checkpoints = on
log_connections = off
log_disconnections = off
log_lock_waits = on
log_statement = 'ddl'

# Autovacuum (gentler than defaults to ease memory pressure)
autovacuum_max_workers = 2
autovacuum_vacuum_cost_limit = 1000
CONF
chown postgres:postgres "$TUNING_CONF"
chmod 0640 "$TUNING_CONF"

if ! grep -q "include_dir = 'conf.d'" "$PG_DATA/postgresql.conf"; then
  echo "include_dir = 'conf.d'" >> "$PG_DATA/postgresql.conf"
fi

install -d -m 0700 -o postgres -g postgres /var/labelhub/logs/postgres

echo "==> 2/3 restart postgres"
systemctl restart postgresql-16
systemctl status postgresql-16 --no-pager | head -8

echo "==> 3/3 create role + database"
# Generate a 32-char hex password
DB_PWD="$(openssl rand -hex 32)"
sudo -iu postgres psql <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'labelhub') THEN
    CREATE ROLE labelhub LOGIN PASSWORD '${DB_PWD}';
  ELSE
    ALTER ROLE labelhub WITH PASSWORD '${DB_PWD}';
  END IF;
END
\$\$;
SELECT 'database labelhub exists' AS msg WHERE EXISTS (SELECT 1 FROM pg_database WHERE datname='labelhub');
SQL

# Create DB only if missing (CREATE DATABASE can't be in a DO block).
if ! sudo -iu postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='labelhub'" | grep -q 1; then
  sudo -iu postgres createdb -O labelhub labelhub
fi

sudo -iu postgres psql -d labelhub <<SQL
GRANT ALL PRIVILEGES ON DATABASE labelhub TO labelhub;
GRANT ALL ON SCHEMA public TO labelhub;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO labelhub;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO labelhub;
SQL

echo
echo "============================================"
echo " ✓ DB ready. DATABASE_URL for /etc/labelhub.env:"
echo
echo "DATABASE_URL=postgresql://labelhub:${DB_PWD}@localhost:5432/labelhub"
echo "============================================"
echo
echo "Next: ./deploy/setup-nginx.sh"
