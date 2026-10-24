# 自有 Ubuntu 服务器部署（不使用云托管）

核心文件只有 4 个：`index.js`、`storage.js`、`package.json`、`ecosystem.config.js`
（外加 `nginx-seat.conf` 示例、`install.sh` 一键部署、`update.sh` 一键更新、`backup.sh` 备份脚本）。

## 本次更新内容（v1.1.0）

服务端适配「以服务端为准」的数据模型，新增两个接口，供小程序不用本地缓存就能读申请数据：

| 接口 | 说明 |
| --- | --- |
| `GET /api/apps?studentId=&status=` | 申请列表；不带 studentId 返回全部（管理员），带上只返回该学生的 |
| `POST /api/apps/:id/cancel` | 学生撤回自己的申请（服务端校验归属，别人撤回返回 403） |

其余接口不变；老版本的服务端没有这两个接口，小程序「我的记录 / 审批」页会读不到服务端数据，
所以**必须更新服务端**。

## 新装：放到服务器上

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

## 已装过的服务器：一键更新

```bash
sudo bash /opt/seat-server/update.sh
```

脚本会自动：git 拉最新代码 → 备份 `data/` → 只覆盖代码文件 → `pm2 restart` → 打印日志与接口自检结果。
代码目录自动识别（优先 `server/`，回退 `vps/`），**业务数据 `data/` 不会被覆盖**。

没有用 Git 的服务器，手动更新同样一句：

```bash
cd /opt/seat-server && pm2 restart seat
```

（先把本包的 `index.js`、`storage.js` 覆盖过去即可。）

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
