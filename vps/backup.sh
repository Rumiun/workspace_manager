#!/usr/bin/env bash
# 备份业务数据（state.json + 地图照片），保留最近 7 天
# crontab 示例： 0 3 * * * /opt/seat-server/backup.sh
set -e

APP_DIR=/opt/seat-server
BACKUP_DIR=/opt/backup
DAY=$(date +%F)

mkdir -p "$BACKUP_DIR"

if [ -d "$APP_DIR/data" ]; then
  tar czf "$BACKUP_DIR/seat-$DAY.tar.gz" -C "$APP_DIR" data
  echo "已备份 -> $BACKUP_DIR/seat-$DAY.tar.gz"
else
  echo "没有 data 目录，跳过"
fi

find "$BACKUP_DIR" -name 'seat-*.tar.gz' -mtime +7 -delete
