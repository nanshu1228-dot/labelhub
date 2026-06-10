#!/usr/bin/env bash
#
# Install + start the labelhub.service systemd unit.
# Run on the SERVER as root, AFTER /etc/labelhub.env exists.

set -euo pipefail

if [[ ! -f /etc/labelhub.env ]]; then
  echo "ERROR: /etc/labelhub.env missing. Create it first (template in docs/SELF_HOST_DEPLOYMENT.md Phase 7)."
  exit 1
fi
chmod 600 /etc/labelhub.env

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
Environment=HOSTNAME=127.0.0.1
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
StandardOutput=append:/var/labelhub/logs/labelhub.log
StandardError=append:/var/labelhub/logs/labelhub.err
LimitNOFILE=4096

# 2GB-server resource guard. Lets systemd kill the worker before
# the OOM killer takes out the whole machine.
MemoryMax=900M
MemoryHigh=800M

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now labelhub
sleep 2
systemctl status labelhub --no-pager | head -16

# Daily backup cron
cat > /etc/cron.d/labelhub-backup <<'CRON'
SHELL=/bin/bash
0 3 * * * postgres pg_dump labelhub | gzip > /var/labelhub/backup/labelhub-$(date +\%F).sql.gz
5 3 * * * root find /var/labelhub/backup -type f -name "labelhub-*.sql.gz" -mtime +7 -delete
CRON

# Log rotation for app logs
cat > /etc/logrotate.d/labelhub <<'LOGROTATE'
/var/labelhub/logs/labelhub.log /var/labelhub/logs/labelhub.err {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    sharedscripts
    postrotate
        systemctl reload labelhub > /dev/null 2>&1 || true
    endscript
}
LOGROTATE

echo
echo " ✓ labelhub.service running. Logs: journalctl -u labelhub -f"
echo " ✓ Daily backup cron installed (3am)."
echo " ✓ Log rotation installed (14 days)."
