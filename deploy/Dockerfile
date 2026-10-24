# 微信云托管：上传本地代码后按此文件构建
# 构建上下文 = 本目录（index.js / storage.js / package.json 都在根目录）
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY index.js storage.js ./

# 云托管默认 80；服务端读 process.env.PORT
ENV PORT=80
ENV NODE_ENV=production
EXPOSE 80

CMD ["node", "index.js"]
