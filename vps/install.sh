#!/usr/bin/env bash
# 自有 Ubuntu 服务器一键部署（首次执行）
# 用法： sudo bash install.sh
set -e

APP_DIR=/opt/seat-server
BACKUP_DIR=/opt/backup

echo "==> 1/5 安装依赖（已有则跳过）"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
command -v pm2 >/dev/null 2>&1 || npm i -g pm2
command -v nginx >/dev/null 2>&1 || (apt-get update && apt-get install -y nginx)

echo "==> 2/5 准备目录"
mkdir -p "$APP_DIR" "$BACKUP_DIR"

echo "==> 3/5 拷贝代码（把本脚本所在目录的文件放进 $APP_DIR）"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp -f "$SCRIPT_DIR"/index.js "$SCRIPT_DIR"/storage.js "$SCRIPT_DIR"/package.json "$SCRIPT_DIR"/ecosystem.config.js "$APP_DIR"/
cd "$APP_DIR"

echo "==> 4/5 安装 npm 依赖（file 模式零依赖，mysql 模式才需要 mysql2）"
npm install --omit=dev --no-audit --no-fund || true

echo "==> 5/5 启动服务（PM2 守护 + 开机自启）"
pm2 delete seat >/dev/null 2>&1 || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root | tail -n 1

echo
echo "完成。常用命令："
echo "  pm2 logs seat           看日志"
echo "  pm2 restart seat        重启"
echo "  curl 127.0.0.1:3000     本地验证，应返回 {\"ok\":true,...}"
echo
echo "Nginx 反代： cp $APP_DIR/nginx-seat.conf /etc/nginx/sites-available/seat"
echo "            ln -s /etc/nginx/sites-available/seat /etc/nginx/sites-enabled/seat"
echo "            nginx -t && systemctl reload nginx"
