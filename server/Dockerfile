# 微信云托管部署用镜像
# 构建：docker build -f server/Dockerfile -t gss-seat-server .
# 本地验证：docker run -p 8080:80 --env-file server/.env.example gss-seat-server
# Node 22：当前仍在维护期的 LTS（18 已停止维护，不建议再上生产）
FROM node:22-alpine

WORKDIR /app

# 1) 先装依赖（利用 Docker 缓存层）
COPY server/package.json ./
# mysql2 是 optionalDependencies：装上也支持云数据库模式；装不上也不阻断构建
RUN npm install --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund --omit=optional

# 2) 再拷源码（不带本地 data：演示数据首次启动会自动播种到数据库）
COPY server/index.js ./
COPY server/storage.js ./

# 云托管默认监听 80（控制台里也能改「监听端口」）
ENV PORT=80
ENV NODE_ENV=production
EXPOSE 80

CMD ["node", "index.js"]
