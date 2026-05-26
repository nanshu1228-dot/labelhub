# Self-Host Deployment — aipert.top

Production deployment of LabelHub on a 2-core / 1.8 GB VPS running
Alibaba Cloud Linux 3 (RHEL 8-compatible, `dnf` package manager).

Target URL: `https://aipert.top`
Target IP: `39.106.43.209`

## Architecture

```
┌──────────────────────────────────────────────────────┐
│ aipert.top (HTTPS)                                   │
│ ├─ nginx (TLS termination, gzip, static)             │
│ │   ├─ /              → 127.0.0.1:3001 (Next.js)     │
│ │   ├─ /storage/*     → /var/labelhub/storage/*      │
│ │   └─ /healthz       → 200 ok                       │
│ └─ /etc/letsencrypt/  (certbot auto-renew)           │
│                                                       │
│ ┌─ Process supervisor (systemd) ──────────────────┐  │
│ │ labelhub.service                                │  │
│ │   node .next/standalone/server.js               │  │
│ │   PORT=3001                                     │  │
│ │   NODE_OPTIONS="--max-old-space-size=768"       │  │
│ └─────────────────────────────────────────────────┘  │
│                                                       │
│ ┌─ PostgreSQL 16 (localhost:5432) ────────────────┐  │
│ │ shared_buffers=384MB                            │  │
│ │ effective_cache_size=1GB                        │  │
│ │ work_mem=4MB                                    │  │
│ │ db: labelhub  user: labelhub  pwd: env-injected │  │
│ └─────────────────────────────────────────────────┘  │
│                                                       │
│ /var/labelhub/                                       │
│   code/         → standalone build (rsync target)    │
│   storage/      → uploads + export artifacts         │
│   backup/       → daily pg_dump (7 daily + 4 weekly) │
│   logs/         → app + nginx logs (rotated)         │
└──────────────────────────────────────────────────────┘
```

## Service inventory

| Service | Port | Memory budget | Purpose |
|---|---|---|---|
| Node (Next standalone) | 3001 (localhost) | 768 MB | App server (1 worker — 2 cores can't handle cluster) |
| PostgreSQL 16 | 5432 (localhost) | 1.0 GB | Primary database |
| nginx | 80, 443 | 64 MB | TLS + reverse proxy + static |
| systemd + OS + swap headroom | — | 256 MB | — |
| **Total** | | **~2.0 GB** | (2 GB RAM + 2 GB swap) |

1Panel stays at 8090 — we don't disturb it; you can keep it for ad-hoc inspection.

## Phase 1 — Server prep (one-time, run as root)

```bash
# Update + base tools
dnf -y update && \
dnf -y install nginx postgresql-server postgresql-contrib postgresql \
  certbot python3-certbot-nginx fail2ban firewalld jq tmux htop \
  gcc gcc-c++ make rsync logrotate

# Confirm Node 22 LTS (server already has 20.20.2; upgrade)
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
dnf -y install nodejs
node --version  # should print v22.x

# Create project directory tree
install -d -m 0755 /var/labelhub
install -d -m 0755 /var/labelhub/code
install -d -m 0755 /var/labelhub/storage
install -d -m 0755 /var/labelhub/storage/labelhub-media
install -d -m 0755 /var/labelhub/storage/labelhub-exports
install -d -m 0755 /var/labelhub/backup
install -d -m 0755 /var/labelhub/logs

# Dedicated runtime user (no shell, no home)
useradd --system --no-create-home --shell /sbin/nologin labelhub || true
chown -R labelhub:labelhub /var/labelhub/storage /var/labelhub/logs
chown -R root:root /var/labelhub/code  # rsync target owned by root, readable
```

## Phase 2 — PostgreSQL 16

Alma/Anolis 8 default repo ships PG 13. Install PG 16 from official PGDG repo:

```bash
dnf -y install https://download.postgresql.org/pub/repos/yum/reporpms/EL-8-x86_64/pgdg-redhat-repo-latest.noarch.rpm
dnf -qy module disable postgresql || true  # disable old module stream
dnf -y install postgresql16 postgresql16-server postgresql16-contrib

# Initialize cluster + start
/usr/pgsql-16/bin/postgresql-16-setup initdb
systemctl enable --now postgresql-16

# Apply 2-GB-RAM tuning
cat > /var/lib/pgsql/16/data/conf.d/labelhub.conf <<'CONF'
listen_addresses = 'localhost'
port = 5432
shared_buffers = 384MB
effective_cache_size = 1GB
work_mem = 4MB
maintenance_work_mem = 64MB
wal_buffers = 16MB
max_connections = 50
random_page_cost = 1.1   # SSD
log_min_duration_statement = 1000   # log slow queries > 1s
log_destination = 'stderr'
logging_collector = on
log_directory = '/var/labelhub/logs/postgres'
log_filename = 'postgres-%Y-%m-%d.log'
log_rotation_age = 1d
log_rotation_size = 0
CONF
# Hook the file into postgresql.conf
echo "include_dir = 'conf.d'" >> /var/lib/pgsql/16/data/postgresql.conf
install -d -m 0700 -o postgres -g postgres /var/labelhub/logs/postgres

# Create DB + user
sudo -iu postgres psql <<SQL
CREATE USER labelhub WITH PASSWORD 'CHANGEME_RANDOM_HEX_32';
CREATE DATABASE labelhub OWNER labelhub;
GRANT ALL PRIVILEGES ON DATABASE labelhub TO labelhub;
\c labelhub
GRANT ALL ON SCHEMA public TO labelhub;
SQL

systemctl restart postgresql-16
```

Generate a real password:

```bash
openssl rand -hex 32  # paste over CHANGEME_RANDOM_HEX_32
```

## Phase 3 — nginx + Let's Encrypt

Wait until DNS resolves to the server (next phase) before requesting cert.

```bash
# Drop-in site config
cat > /etc/nginx/conf.d/aipert.conf <<'NGINX'
upstream labelhub_upstream {
    server 127.0.0.1:3001 fail_timeout=0;
}

server {
    listen 80;
    server_name aipert.top www.aipert.top;
    return 301 https://aipert.top$request_uri;
}

server {
    listen 443 ssl http2;
    server_name www.aipert.top;
    # certbot fills the cert lines on first run
    return 301 https://aipert.top$request_uri;
}

server {
    listen 443 ssl http2;
    server_name aipert.top;
    client_max_body_size 100M;   # uploads + import files

    # certbot will append:
    #   ssl_certificate /etc/letsencrypt/live/aipert.top/fullchain.pem;
    #   ssl_certificate_key /etc/letsencrypt/live/aipert.top/privkey.pem;

    # Static — exports + uploaded media + favicon
    location /storage/ {
        alias /var/labelhub/storage/;
        access_log off;
        expires 1h;
        add_header Cache-Control "public, max-age=3600";
    }

    location /_next/static/ {
        proxy_pass http://labelhub_upstream;
        proxy_cache_valid 1y;
        expires 1y;
        access_log off;
    }

    location /healthz {
        proxy_pass http://labelhub_upstream/api/health;
        access_log off;
    }

    location / {
        proxy_pass http://labelhub_upstream;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_read_timeout 90;
        proxy_buffering off;   # SSE / streaming routes need this
        gzip on;
        gzip_types text/plain text/css application/json application/javascript text/javascript;
    }
}
NGINX

# Validate + start
nginx -t
systemctl enable --now nginx
```

Once DNS is live:

```bash
certbot --nginx -d aipert.top -d www.aipert.top \
  --non-interactive --agree-tos -m you@example.com --redirect
systemctl reload nginx
# auto-renew is enabled by certbot's systemd timer
systemctl status certbot-renew.timer
```

## Phase 4 — Firewall + fail2ban

```bash
systemctl enable --now firewalld
firewall-cmd --permanent --add-service=ssh
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
# 1Panel keeps :8090; allow it from your home IP only (replace 1.2.3.4):
# firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="1.2.3.4/32" port port="8090" protocol="tcp" accept'
firewall-cmd --reload

# fail2ban — basic SSH protection (3 strikes → ban 1h)
cat > /etc/fail2ban/jail.d/labelhub-sshd.local <<'F2B'
[sshd]
enabled = true
port = 22
maxretry = 3
findtime = 600
bantime = 3600
F2B
systemctl enable --now fail2ban
```

## Phase 5 — Code deployment (from your laptop)

Build standalone locally (the VPS can't `npm run build` — 1.8 GB RAM
plus Postgres + Node would OOM). Use `deploy/build-and-ship.sh`:

```bash
# On your Windows Git Bash:
cd /d/Challenge/labelhub
./deploy/build-and-ship.sh
# This script: build → tar → rsync → ssh "systemctl restart labelhub"
```

Per-deploy time: ~3 minutes (build 90s + 30 MB upload + restart).

## Phase 6 — Database migration from Supabase

```bash
# On your laptop (Supabase URI from console):
export SUPABASE_PG_URI="postgresql://postgres.xxx:password@aws-0-us-west-1.pooler.supabase.com:5432/postgres?sslmode=require"

# Dump → restore via SSH tunnel:
pg_dump "$SUPABASE_PG_URI" \
  --no-owner --no-privileges --schema=public \
  --exclude-table=storage.* --exclude-table=auth.* \
  | ssh -i $SSH_KEY -p 22 root@39.106.43.209 \
    "sudo -iu postgres psql labelhub"
```

(Auth + storage schemas are Supabase-managed; we don't migrate them
because we either keep Supabase remote or switch to NextAuth + local.)

## Phase 7 — env vars on server

```bash
# Server-side /etc/labelhub.env (mode 0600, owner root)
cat > /etc/labelhub.env <<'ENV'
NODE_ENV=production
PORT=3001
HOSTNAME=127.0.0.1

# Database
DATABASE_URL=postgresql://labelhub:HEX_PWD@localhost:5432/labelhub

# Auth (Supabase remote — keep until NextAuth migration)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...  # only set if local features still need it; otherwise drop

# Storage — LOCAL driver (D22)
STORAGE_DRIVER=local
LOCAL_STORAGE_DIR=/var/labelhub/storage
LOCAL_STORAGE_BASE_URL=https://aipert.top/storage

# AI providers
AI_DEFAULT_PROVIDER=doubao
DOUBAO_API_KEY=ark-...
DOUBAO_MODEL_FAST=ep-20260514105718-jthdm
DOUBAO_MODEL_DEFAULT=ep-20260514105718-jthdm
DOUBAO_MODEL_PREMIUM=ep-20260514105718-jthdm

# Anthropic — kept but UNUSED (provider not set as default)
ANTHROPIC_API_KEY=sk-ant-... # leave commented to disable entirely

# DeepSeek + Qwen — optional fallbacks
# DEEPSEEK_API_KEY=
# QWEN_API_KEY=

# App
NEXT_PUBLIC_APP_URL=https://aipert.top
AI_DAILY_LIMIT_PER_USER=200
ENV
chmod 600 /etc/labelhub.env
```

## Phase 8 — systemd unit

```bash
cat > /etc/systemd/system/labelhub.service <<'UNIT'
[Unit]
Description=LabelHub Next.js server
After=network.target postgresql-16.service
Wants=postgresql-16.service

[Service]
Type=simple
User=labelhub
Group=labelhub
WorkingDirectory=/var/labelhub/code
EnvironmentFile=/etc/labelhub.env
Environment=NODE_OPTIONS=--max-old-space-size=768
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
StandardOutput=append:/var/labelhub/logs/labelhub.log
StandardError=append:/var/labelhub/logs/labelhub.err

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now labelhub
journalctl -u labelhub -f  # tail logs
```

## Phase 9 — Daily backup

```bash
cat > /etc/cron.d/labelhub-backup <<'CRON'
SHELL=/bin/bash
0 3 * * * postgres pg_dump labelhub | gzip > /var/labelhub/backup/labelhub-$(date +\%F).sql.gz
# Keep daily 7 days, weekly 4 weeks
5 3 * * * root find /var/labelhub/backup -type f -name "labelhub-*.sql.gz" -mtime +7 ! -name "*-mon.sql.gz" -delete
CRON
```

## Phase 10 — Smoke test

```bash
# From your laptop:
curl -fsS https://aipert.top/api/health | jq .status   # → "ok"
curl -fsSL https://aipert.top | head -5

# Server-side:
ssh -i $SSH_KEY root@39.106.43.209 "systemctl status labelhub postgresql-16 nginx --no-pager"
ssh -i $SSH_KEY root@39.106.43.209 "tail -50 /var/labelhub/logs/labelhub.log"
```

## Troubleshooting

| Symptom | Check |
|---|---|
| 502 Bad Gateway | `systemctl status labelhub`; check log file |
| OOM after a few hours | `journalctl -u labelhub | grep oom`; lower `--max-old-space-size` |
| Slow Postgres | `psql -d labelhub -c "SELECT pg_size_pretty(pg_database_size('labelhub'))"`; check `pg_stat_activity` |
| Cert renew failed | `certbot renew --dry-run`; check 80 port open |
| AI calls failing | Check `DOUBAO_API_KEY` set; `curl -X POST -H "Authorization: Bearer $KEY" https://ark.cn-beijing.volces.com/api/v3/chat/completions` |
| DNS not resolving | `getent hosts aipert.top`; check 阿里云域名解析后台 |

## Rollback

```bash
# Previous build is kept at /var/labelhub/code.prev/
ssh root@39.106.43.209 "systemctl stop labelhub && \
  mv /var/labelhub/code /var/labelhub/code.fail && \
  mv /var/labelhub/code.prev /var/labelhub/code && \
  systemctl start labelhub"
```
