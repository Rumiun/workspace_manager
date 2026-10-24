var store = require('./utils/store.js')
var layout = require('./utils/layout.js')
var config = require('./utils/config.js')

App({
  globalData: {
    userInfo: null,
    isAdmin: false,
    // 宽屏适配信息：mode = phone / pad / pc，wide 模式下使用电脑端 UI
    layout: layout.detect()
  },
  onLaunch: function () {
    this.initCloud()
    this.detectLayout()
    // 窗口尺寸变化时重算画布（电脑端可拉伸窗口）
    if (typeof wx.onWindowResize === 'function') {
      var self = this
      wx.onWindowResize(function () {
        self.globalData.layout = layout.detect()
        // 拖拽改变窗口大小后，通知已挂载的电脑版外壳立即按新尺寸重算（顶栏 / 侧栏 / 内容列）
        try { layout.emitLayoutChange() } catch (e) {}
      })
    }
    store.initData()
    this.getUser()
  },

  /**
   * 云托管初始化：只有填了 CLOUD_ENV 才会 init。
   * wx.cloud.init 后才能用 wx.cloud.callContainer（走微信内网，免配合法域名）；
   * 本地调试 / 自建服务器时保持关闭，接口仍走 BASE_URL 的普通 https 请求。
   */
  initCloud: function () {
    if (!config.CLOUD_RUN || !config.CLOUD_ENV) return
    if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.init !== 'function') return
    try {
      wx.cloud.init({ env: config.CLOUD_ENV, traceUser: true })
    } catch (e) {}
  },

  /**
   * 取当前用户并同步全局状态（页面统一用 app.getUser()）：
   * 以缓存为准，避免 globalData 里残留上一次会话的对象，
   * 导致「底部导航是管理员、首页内容还是学生」这种错位。
   */
  getUser: function () {
    var user = store.getCurrentUser()
    this.globalData.userInfo = user
    this.globalData.isAdmin = !!(user && user.role === 'admin')
    return user
  },
  /**
   * 设备与画布检测：
   * - 微信电脑端（windows / mac）或横屏平板 → 宽屏模式，使用电脑端 UI
   * - 其余 → 移动端 UI
   * 每次 window resize 都会重算，保证拉伸窗口后布局自适应
   */
  detectLayout: function () {
    this.globalData.layout = layout.detect()
    return this.globalData.layout
  },
  setUser: function (user) {
    this.globalData.userInfo = user
    this.globalData.isAdmin = user && user.role === 'admin'
    if (this.tabbarCallback) this.tabbarCallback()
  },
  clearUser: function () {
    this.globalData.userInfo = null
    this.globalData.isAdmin = false
  }
})
