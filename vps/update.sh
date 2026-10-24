#!/usr/bin/env bash
# 从 Git 更新服务端代码并重启
# 用法： sudo bash /opt/seat-server/update.sh
#
# 会自动判断仓库里的代码目录：
#   优先 server/（小程序仓库里的服务端源码），没有则用 vps/
# 只覆盖代码文件，data/ 目录（业务数据）永不触碰。
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

# 代码目录：server/ 优先（与小程序同源），否则回退 vps/
if [ -d "$SRC/server" ] && [ -f "$SRC/server/index.js" ]; then
  CODE="$SRC/server"
else
  CODE="$SRC/vps"
fi
echo "==> 代码目录：$CODE"

echo "==> 备份当前数据"
[ -d "$APP/data" ] && bash "$APP/backup.sh" || true

echo "==> 同步到运行目录（只覆盖代码，不动 data）"
mkdir -p "$APP"
[ -f "$CODE/index.js" ] && cp -f "$CODE/index.js" "$APP/index.js"
[ -f "$CODE/storage.js" ] && cp -f "$CODE/storage.js" "$APP/storage.js"
[ -f "$CODE/package.json" ] && cp -f "$CODE/package.json" "$APP/package.json"
for f in ecosystem.config.js nginx-seat.conf install.sh backup.sh update.sh; do
  [ -f "$SRC/vps/$f" ] && cp -f "$SRC/vps/$f" "$APP/$f"
done

echo "==> 安装依赖（file 模式零依赖，通常秒过）"
cd "$APP"
npm install --omit=dev --no-audit --no-fund || true

echo "==> 重启服务"
pm2 restart seat --update-env || pm2 start ecosystem.config.js
pm2 save

sleep 1
echo "==> 最近日志"
pm2 logs seat --lines 10 --nostream || true

echo "==> 接口自检"
echo "健康检查：  $(curl -s http://127.0.0.1:3000/ || echo 'curl 未安装')"
echo "申请列表：  $(curl -s 'http://127.0.0.1:3000/api/apps' || echo 'curl 未安装')"
