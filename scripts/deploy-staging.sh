#!/usr/bin/env bash
#
# Deploy IntelliMail to staging.
#
# Usage:
#   scripts/deploy-staging.sh               # full deploy (rsync + npm + restart)
#   scripts/deploy-staging.sh --dry-run     # rsync --dry-run, skip npm + restart
#   scripts/deploy-staging.sh --no-restart  # rsync + npm, skip service restart
#   scripts/deploy-staging.sh --no-install  # rsync + restart, skip npm install
#
# Config via env vars (override any of the defaults below):
#   DEPLOY_HOST      staging hostname/IP           (default: 10.11.13.237)
#   DEPLOY_USER      SSH user                      (default: root)
#   DEPLOY_PATH      absolute remote path          (default: /home/AjayData/xgen-intel/intellimail)
#   SERVICE_CMD      command that restarts the app (default: systemctl restart intellimail)
#   HEALTH_URL       URL to curl on the remote     (default: http://localhost:3000/api/users/any)
#   SSH_KEY          path to a private key to use  (default: whatever ssh-agent provides)
#
# Credentials:
#   This script does NOT read a password. Use SSH key-based auth. If your
#   ~/.ssh is set up, rsync+ssh will Just Work. To provision a key the first
#   time on a password-only staging box:
#     ssh-keygen -t ed25519 -f ~/.ssh/intellimail-staging
#     ssh-copy-id -i ~/.ssh/intellimail-staging.pub root@10.11.13.237
#     export SSH_KEY=~/.ssh/intellimail-staging
#
# Or keep staging-specific overrides in ./.deploy-env (gitignored):
#   DEPLOY_HOST=10.11.13.237
#   DEPLOY_USER=root
#   DEPLOY_PATH=/home/AjayData/xgen-intel/intellimail
#   SSH_KEY=/c/Users/HP/.ssh/intellimail-staging

set -euo pipefail

# Load ./.deploy-env if present. Never commit this file.
if [ -f .deploy-env ]; then
  # shellcheck disable=SC1091
  set -a; . ./.deploy-env; set +a
fi

DEPLOY_HOST="${DEPLOY_HOST:-10.11.13.237}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_PATH="${DEPLOY_PATH:-/home/AjayData/xgen-intel/intellimail}"
SERVICE_CMD="${SERVICE_CMD:-systemctl restart intellimail}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/api/users/any}"

DRY_RUN=0
SKIP_INSTALL=0
SKIP_RESTART=0
for arg in "$@"; do
  case "$arg" in
    --dry-run)     DRY_RUN=1; SKIP_INSTALL=1; SKIP_RESTART=1 ;;
    --no-install)  SKIP_INSTALL=1 ;;
    --no-restart)  SKIP_RESTART=1 ;;
    -h|--help)     sed -n '2,32p' "$0"; exit 0 ;;
    *)             echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=~/.ssh/known_hosts)
[ -n "${SSH_KEY:-}" ] && SSH_OPTS+=(-i "$SSH_KEY")

SSH_TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"

banner() { printf '\n\033[1;36m=== %s ===\033[0m\n' "$*"; }
ok()     { printf '\033[1;32m✓ %s\033[0m\n'  "$*"; }
warn()   { printf '\033[1;33m⚠ %s\033[0m\n'  "$*"; }

banner "Target"
echo "  host: $SSH_TARGET"
echo "  path: $DEPLOY_PATH"
echo "  key:  ${SSH_KEY:-(ssh-agent)}"
echo "  mode: $([ $DRY_RUN -eq 1 ] && echo DRY-RUN || echo LIVE)"

banner "Step 1: verify SSH reachability"
if ! ssh "${SSH_OPTS[@]}" -o ConnectTimeout=10 "$SSH_TARGET" true; then
  echo "SSH to $SSH_TARGET failed. Check SSH_KEY / agent / credentials." >&2
  exit 1
fi
ok "connected"

banner "Step 2: rsync source"
RSYNC_FLAGS=(-avz --delete)
[ $DRY_RUN -eq 1 ] && RSYNC_FLAGS+=(--dry-run)

rsync "${RSYNC_FLAGS[@]}" \
  -e "ssh ${SSH_OPTS[*]}" \
  --exclude='.git/' \
  --exclude='.gitignore' \
  --exclude='node_modules/' \
  --exclude='.claude/' \
  --exclude='.deploy-env' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='data/jwt.secret' \
  --exclude='*.db' \
  --exclude='*.db-wal' \
  --exclude='*.db-shm' \
  --exclude='*.sqlite' \
  --exclude='*.log' \
  --exclude='server.log' \
  --exclude='intellimail-*-test.db*' \
  --exclude='data-test-*/' \
  --exclude='docs/superpowers/' \
  --exclude='data/aeslc_raw.jsonl' \
  --exclude='data/enron_spam_raw.jsonl' \
  --exclude='main_*.py' \
  --exclude='task21_*.py' \
  --exclude='task22_*.py' \
  --exclude='check_*.py' \
  --exclude='deploy_*.py' \
  --exclude='deploy.py' \
  --exclude='diag_*.py' \
  --exclude='fix_*.py' \
  --exclude='read_staging*.py' \
  --exclude='update_*.py' \
  --exclude='verify_staging.py' \
  --exclude='wait_and_verify.py' \
  ./ "${SSH_TARGET}:${DEPLOY_PATH}/"
ok "synced"

if [ $SKIP_INSTALL -eq 0 ]; then
  banner "Step 3: npm install --omit=dev"
  ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "cd '$DEPLOY_PATH' && npm install --omit=dev"
  ok "installed"
fi

if [ $SKIP_RESTART -eq 0 ]; then
  banner "Step 4: restart service"
  ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$SERVICE_CMD" || {
    warn "service restart returned non-zero — check '$SERVICE_CMD' manually"
    exit 1
  }
  ok "restarted"

  banner "Step 5: health check"
  sleep 3
  code=$(ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "curl -s -o /dev/null -w '%{http_code}' '$HEALTH_URL' || echo 000")
  if [ "$code" = "200" ]; then
    ok "health 200"
  else
    warn "health check got HTTP $code — check logs: ssh $SSH_TARGET 'journalctl -u intellimail -n 50 --no-pager'"
    exit 1
  fi
fi

banner "Done"
echo "Open: http://${DEPLOY_HOST}:3000/login"
