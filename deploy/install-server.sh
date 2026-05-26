#!/usr/bin/env bash
#
# One-shot server bootstrap — Alibaba Cloud Linux 3 (RHEL 8 衍生).
# Idempotent: re-running is safe.
#
# Run on the SERVER as root:
#   curl -fsSL https://aipert.top/deploy/install-server.sh | bash
# Or paste this script content directly via SSH.
#
# What it does:
#   1. Base tools (nginx, postgres deps, certbot, jq, htop, etc.)
#   2. Node 22 LTS (replaces 20)
#   3. PostgreSQL 16 from PGDG repo (RHEL 8 default is 13)
#   4. Project directory tree at /var/labelhub/
#   5. labelhub system user
#   6. firewalld + fail2ban basic config
#
# What it DOES NOT do (run-on-trigger files in deploy/):
#   - Configure nginx for aipert.top  → deploy/setup-nginx.sh
#   - Create the labelhub DB + apply tuning → deploy/setup-postgres.sh
#   - Drop /etc/labelhub.env  → manual, never automated
#   - Issue Let's Encrypt cert → deploy/issue-cert.sh (run after DNS resolves)
#   - systemd unit for labelhub  → deploy/install-systemd-unit.sh
#
# Total runtime: ~3 minutes on a fresh server.

set -euo pipefail

echo "==> 1/6 dnf update + base tools"
dnf -y update --setopt=tsflags=nodocs
dnf -y install --setopt=tsflags=nodocs \
  nginx certbot python3-certbot-nginx fail2ban firewalld \
  jq tmux htop vim rsync logrotate \
  gcc gcc-c++ make \
  bind-utils

echo "==> 2/6 Node 22 LTS"
if ! node --version 2>/dev/null | grep -q "^v22"; then
  curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
  dnf -y install nodejs
fi
node --version

echo "==> 3/6 PostgreSQL 16"
if ! rpm -q postgresql16-server >/dev/null 2>&1; then
  dnf -y install https://download.postgresql.org/pub/repos/yum/reporpms/EL-8-x86_64/pgdg-redhat-repo-latest.noarch.rpm
  dnf -qy module disable postgresql || true
  dnf -y install postgresql16 postgresql16-server postgresql16-contrib
fi
if [[ ! -d /var/lib/pgsql/16/data/base ]]; then
  /usr/pgsql-16/bin/postgresql-16-setup initdb
fi
systemctl enable --now postgresql-16

echo "==> 4/6 project tree at /var/labelhub"
install -d -m 0755 /var/labelhub
install -d -m 0755 /var/labelhub/code
install -d -m 0755 /var/labelhub/storage
install -d -m 0755 /var/labelhub/storage/labelhub-media
install -d -m 0755 /var/labelhub/storage/labelhub-exports
install -d -m 0755 /var/labelhub/backup
install -d -m 0755 /var/labelhub/logs

echo "==> 5/6 labelhub system user"
if ! id labelhub &>/dev/null; then
  useradd --system --no-create-home --shell /sbin/nologin labelhub
fi
chown -R labelhub:labelhub /var/labelhub/storage /var/labelhub/logs
chown -R root:root /var/labelhub/code

echo "==> 6/6 firewalld + fail2ban"
systemctl enable --now firewalld
firewall-cmd --permanent --add-service=ssh --quiet 2>/dev/null || firewall-cmd --permanent --add-service=ssh
firewall-cmd --permanent --add-service=http --quiet 2>/dev/null || firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https --quiet 2>/dev/null || firewall-cmd --permanent --add-service=https
firewall-cmd --reload

cat > /etc/fail2ban/jail.d/labelhub-sshd.local <<'F2B'
[sshd]
enabled = true
port = 22
maxretry = 3
findtime = 600
bantime = 3600
F2B
systemctl enable --now fail2ban

echo
echo "==> DONE. Next steps:"
echo "  1. ./deploy/setup-postgres.sh  (creates labelhub DB + applies 2GB tuning)"
echo "  2. ./deploy/setup-nginx.sh     (drops aipert.top vhost config)"
echo "  3. Configure DNS A record: aipert.top → $(curl -s ifconfig.me)"
echo "  4. ./deploy/issue-cert.sh      (once DNS resolves)"
echo "  5. From your laptop: ./deploy/build-and-ship.sh"
