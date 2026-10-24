#!/usr/bin/env bash
# 从 Git 更新代码并重启（服务器上执行）
# 用法： sudo bash /opt/seat-server/update.sh
set -e

REPO=https://github.com/Rumiun/workspace_manager.git
SRC=/opt/seat-src
APP=/opt/seat-server

echo "==> 拉最新代码"
if [ -d "$SRC/.git" ]; then
  cd "$SRC" && git pull --ff-only
else
  git clone --depth 1 "$REPO" "$SRC"
fi

echo "==> 备份当前数据"
[ -d "$APP/data" ] && bash "$APP/backup.sh"

echo "==> 同步到运行目录（只覆盖代码，不动 data）"
mkdir -p "$APP"
cp -f "$SRC"/vps/index.js "$SRC"/vps/storage.js "$SRC"/vps/package.json \
      "$SRC"/vps/ecosystem.config.js "$SRC"/vps/nginx-seat.conf \
      "$SRC"/vps/install.sh "$SRC"/vps/backup.sh "$SRC"/vps/update.sh "$APP"/

echo "==> 重启服务"
cd "$APP"
pm2 restart seat --update-env || pm2 start ecosystem.config.js
pm2 save
pm2 logs seat --lines 10 --nostream
