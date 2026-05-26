#!/usr/bin/env bash
#
# Drop nginx vhost for aipert.top (HTTP only initially — cert added
# by issue-cert.sh once DNS resolves). Run as root on the server.

set -euo pipefail

DOMAIN="${DEPLOY_DOMAIN:-aipert.top}"
APP_PORT="${APP_PORT:-3001}"

cat > /etc/nginx/conf.d/aipert.conf <<NGINX
upstream labelhub_upstream {
    server 127.0.0.1:${APP_PORT} fail_timeout=0;
}

# HTTP — will be the redirect target after cert lands.
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};

    # Allow ACME challenges before certbot rewrites this file
    location /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
    }

    # Pre-cert: serve the app directly so we can verify it works.
    # certbot will replace this with a 301 → https://... after issue-cert.sh.
    location /storage/ {
        alias /var/labelhub/storage/;
        access_log off;
        expires 1h;
        add_header Cache-Control "public, max-age=3600";
    }
    location / {
        proxy_pass http://labelhub_upstream;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_read_timeout 90;
        proxy_buffering off;
        client_max_body_size 100M;
    }
}
NGINX

install -d -m 0755 /var/www/letsencrypt
nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo
echo " ✓ nginx vhost for ${DOMAIN} is live on port 80."
echo "   Confirm: curl -fsSI http://${DOMAIN}/api/health"
echo "   Once DNS A record resolves to this server, run:"
echo "     ./deploy/issue-cert.sh"
