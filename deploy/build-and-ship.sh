#!/usr/bin/env bash
#
# Build LabelHub standalone locally + rsync to aipert.top + reload.
#
# Why local build: 2-core / 1.8 GB VPS would OOM on `npm run build`.
# Why standalone: Next.js standalone bundle is ~30 MB vs ~500 MB for
#   a full node_modules upload, and self-contained so the VPS doesn't
#   need to npm-install anything.
#
# Reads SSH connection from D:\Challenge\.deploy.env (sibling of
# labelhub/). Idempotent — run it as many times as you like.
#
# Usage:
#   cd /d/Challenge/labelhub
#   ./deploy/build-and-ship.sh                  # full deploy
#   ./deploy/build-and-ship.sh --no-build       # just rsync (after manual build)
#   ./deploy/build-and-ship.sh --restart-only   # systemd restart, nothing else

set -euo pipefail

ENV_FILE="${ENV_FILE:-/d/Challenge/.deploy.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE missing. Create it per docs/SELF_HOST_DEPLOYMENT.md." >&2
  exit 1
fi
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

: "${SSH_HOST:?SSH_HOST not set}"
: "${SSH_PORT:?SSH_PORT not set}"
: "${SSH_USER:?SSH_USER not set}"
: "${SSH_KEY:?SSH_KEY not set}"

SSH="ssh -i $SSH_KEY -p $SSH_PORT -o StrictHostKeyChecking=accept-new"
SSH_TARGET="$SSH_USER@$SSH_HOST"
REMOTE_CODE="/var/labelhub/code"
REMOTE_PREV="/var/labelhub/code.prev"

mode="${1:-full}"

cd "$(dirname "$0")/.."   # repo root

if [[ "$mode" != "--restart-only" && "$mode" != "--no-build" ]]; then
  echo "==> npm run build (standalone)"
  npm run build
fi

if [[ "$mode" != "--restart-only" ]]; then
  if [[ ! -d ".next/standalone" ]]; then
    echo "ERROR: .next/standalone missing. Set 'output: standalone' in next.config.ts." >&2
    exit 2
  fi
  echo "==> rsync to $SSH_HOST"
  # Keep previous build for rollback. Atomic-ish swap.
  $SSH "$SSH_TARGET" "
    set -e
    if [[ -d $REMOTE_PREV ]]; then rm -rf $REMOTE_PREV; fi
    if [[ -d $REMOTE_CODE && -n \"\$(ls -A $REMOTE_CODE 2>/dev/null)\" ]]; then
      mv $REMOTE_CODE $REMOTE_PREV
    fi
    install -d -m 0755 $REMOTE_CODE
  "
  # Three rsync passes — standalone bundle + public/ + .next/static/
  # .next/standalone already contains the server entry + bundled deps.
  rsync -az --delete --rsh "$SSH" \
    .next/standalone/ "$SSH_TARGET:$REMOTE_CODE/"
  rsync -az --rsh "$SSH" \
    public/ "$SSH_TARGET:$REMOTE_CODE/public/"
  rsync -az --rsh "$SSH" \
    .next/static/ "$SSH_TARGET:$REMOTE_CODE/.next/static/"
  $SSH "$SSH_TARGET" "chown -R root:root $REMOTE_CODE"
fi

echo "==> systemctl restart labelhub"
$SSH "$SSH_TARGET" "systemctl restart labelhub && systemctl status labelhub --no-pager | head -12"

echo "==> health check"
sleep 3
status_code=$(curl -fsS -o /dev/null -w "%{http_code}" "https://${DEPLOY_DOMAIN:-aipert.top}/api/health" 2>/dev/null || echo "—")
if [[ "$status_code" == "200" ]]; then
  echo "✓ https://${DEPLOY_DOMAIN:-aipert.top}/api/health → 200"
else
  echo "⚠ health check returned: $status_code (cert / DNS / app may still be coming up)"
fi
