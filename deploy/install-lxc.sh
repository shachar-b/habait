#!/usr/bin/env bash
set -euo pipefail

# Idempotent setup script for habait on a fresh Debian 12 Proxmox LXC container

APP_USER="habait"
APP_DIR="/opt/habait"
DATA_DIR="/var/lib/habait"

echo "==> Setting container timezone to Asia/Jerusalem"
ln -sf /usr/share/zoneinfo/Asia/Jerusalem /etc/localtime
echo "Asia/Jerusalem" > /etc/timezone

echo "==> Installing system dependencies and Node.js 22 LTS"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg build-essential python3 sqlite3

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v22* ]]; then
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
fi

echo "==> Creating unprivileged user and directories"
if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "${DATA_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
fi

mkdir -p "${APP_DIR}" "${DATA_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${DATA_DIR}"

echo "==> Syncing application files into ${APP_DIR}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${SCRIPT_DIR}" != "${APP_DIR}" ]]; then
  cp -a "${SCRIPT_DIR}/." "${APP_DIR}/"
fi

cd "${APP_DIR}"
npm ci
npm run build
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

echo "==> Installing and enabling systemd unit"
# Per-install session secret (generated once, kept across re-runs); server refuses to boot without it.
mkdir -p /etc/habait
if [[ ! -s /etc/habait/habait.env ]]; then
  umask 077
  echo "SESSION_SECRET=$(head -c 32 /dev/urandom | base64 | tr -d '\n')" > /etc/habait/habait.env
fi
chmod 600 /etc/habait/habait.env
cp "${APP_DIR}/deploy/habait.service" /etc/systemd/system/habait.service
systemctl daemon-reload
systemctl enable habait.service
systemctl restart habait.service

echo "==> habait is running on port 3000 (TZ=Asia/Jerusalem)"
