# 自有 Ubuntu 服务器部署（不使用云托管）

文件只有 4 个：`index.js`、`storage.js`、`package.json`、`ecosystem.config.js`
（外加 `nginx-seat.conf` 示例、`install.sh` 一键脚本、`backup.sh` 备份脚本）。

## 放到服务器上

```bash
# 服务器上先建目录
sudo mkdir -p /opt/seat-server
```

然后从本机（Windows PowerShell）上传：

```powershell
scp F:\program\run\vps\* root@服务器IP:/opt/seat-server/
```

上传后一键部署：

```bash
ssh root@服务器IP
cd /opt/seat-server && sudo bash install.sh
```

## 手动启动（不用脚本时）

```bash
cd /opt/seat-server
npm install --omit=dev        # file 模式零依赖，可跳过
pm2 start ecosystem.config.js
pm2 save && pm2 startup       # 开机自启
```

## 验证

```bash
curl http://127.0.0.1:3000/
# {"ok":true,"ready":true,"storage":"file","offices":3,"seats":62,...}

curl http://127.0.0.1:3000/api/settings
```

## 数据在磁盘上（file 模式）

```
/opt/seat-server/data/state.json    全部业务数据
/opt/seat-server/data/uploads/      地图照片
```

首次启动会自动创建并播种演示数据（3 间办公室 / 62 个工位 / admin 123456）。
备份：`sudo bash backup.sh`，或配 crontab `0 3 * * * /opt/seat-server/backup.sh`。

## Nginx 反代 + HTTPS

```bash
sudo cp nginx-seat.conf /etc/nginx/sites-available/seat
sudo ln -s /etc/nginx/sites-available/seat /etc/nginx/sites-enabled/seat
sudo nginx -t && sudo systemctl reload nginx

# 有域名就开 HTTPS（免费证书）
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d 你的域名
```

## 小程序端对应改法

`utils/config.js`：

```js
USE_MOCK: false,
CLOUD_RUN: false,
CLOUD_ENV: '',
BASE_URL: 'https://你的域名',     // 或内网 http://192.168.x.x:3000（仅供开发者工具）
CLOUD_PUBLIC_BASE: '',
```

正式版小程序仍要求 HTTPS + 已备案域名；仅校内电脑端/开发者工具使用可直接用 `http://内网IP:3000`
并勾选「不校验合法域名」。
