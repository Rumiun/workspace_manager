/**
 * 全局配置
 * USE_MOCK = true  时，接口层走本地演示数据（utils/store.js），无需后端即可跑通全流程
 * USE_MOCK = false 时，接口层走真实后端（server/index.js），需在小程序后台配置 request 合法域名
 */
module.exports = {
  /* 自建服务器（腾讯云 Ubuntu + nginx 反代到 3000 端口）
     注意：http + IP 只能用于开发者工具调试；
     真机/体验版/正式版仍需要 https + 已备案域名，届时把这里换成 https://域名 */
  /* 微信开发者工具会拦截「公网 IP 直连」，所以用 sslip.io 把 IP 转成域名：
     120-26-250-166.sslip.io 由公共 DNS 解析到 120.26.250.166，无需买域名/备案。
     换成正式域名后把这两处一起改掉即可。 */
  BASE_URL: 'https://120-26-250-166.sslip.io',
  USE_MOCK: false,

  // 工位地图（自定义布局）：照片与点位以服务端为准
  // true  → 读 / 写一律走 server/index.js（GET/POST /api/admin/offices/:id/map、POST /api/upload）
  //         服务端不可用时自动回落到本地缓存，并在页面上标注「本机缓存」
  // false → 只走本地演示数据
  MAP_ON_SERVER: true,

  // 上传地图照片：true = 传服务端并返回图片 URL；false = 只保存在本机
  UPLOAD_CLOUD: true,

  /* ---------- 部署到微信云托管后的调用方式 ----------
     CLOUD_RUN = true 且填好 CLOUD_ENV 时，接口走 wx.cloud.callContainer：
     微信内网调用，**不需要在小程序后台配置 request 合法域名**。
     不填则仍走 BASE_URL 的普通 https 请求（本地 / 自建服务器）。 */
  CLOUD_RUN: false,
  CLOUD_ENV: '',
  // 云托管里的服务名（部署后在控制台看到的服务名，不含版本号）
  CLOUD_SERVICE: '',
  // 地图照片是 <image> 直接拉的静态资源，走不了 callContainer，
  // 需要填服务的公网域名（控制台「服务 → 公网访问」开启后可复制），
  // 并把它加到小程序后台的 downloadFile 合法域名里
  CLOUD_PUBLIC_BASE: 'https://express-qkf9-334520-7-1515923759.sh.run.tcloudbase.com',

  // 固定二维码域名：二维码内容统一为 {QR_BASE}/s/{工位编号}
  QR_BASE: 'https://seat.example.edu.cn',

  /* 拼接图片等静态资源地址时使用的 HOST：
     云托管 + 配了公网域名 → 用公网域名；否则用 BASE_URL */
  assetBase: function () {
    return this.CLOUD_RUN && this.CLOUD_PUBLIC_BASE ? this.CLOUD_PUBLIC_BASE : this.BASE_URL
  },

  qrContent: function (code) {
    return this.QR_BASE + '/s/' + code
  }
}
