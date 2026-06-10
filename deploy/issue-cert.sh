#!/usr/bin/env bash
#
# Let's Encrypt cert for aipert.top + www.aipert.top.
# Run on the SERVER as root, ONLY AFTER DNS A records resolve.

set -euo pipefail

DOMAIN="${DEPLOY_DOMAIN:-aipert.top}"
EMAIL="${ACME_EMAIL:-}"

if [[ -z "$EMAIL" ]]; then
  echo "Set ACME_EMAIL=your@email.com first (used for cert expiry notices)."
  echo "Run:  ACME_EMAIL=you@example.com ./deploy/issue-cert.sh"
  exit 1
fi

# Sanity: DNS A record must resolve to THIS host before requesting.
this_ip=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
resolved_ip=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1)
if [[ "$resolved_ip" != "$this_ip" ]]; then
  echo "ERROR: $DOMAIN resolves to '$resolved_ip' but this host is '$this_ip'."
  echo "Update the A record + wait for TTL before re-running."
  exit 2
fi

certbot --nginx \
  -d "$DOMAIN" -d "www.$DOMAIN" \
  --non-interactive --agree-tos -m "$EMAIL" --redirect

systemctl reload nginx

echo
echo " ✓ Cert installed. Auto-renew via certbot.timer:"
systemctl status certbot-renew.timer --no-pager 2>/dev/null | head -5 || \
  systemctl list-timers | grep certbot
echo
echo "Test renew:  certbot renew --dry-run"
