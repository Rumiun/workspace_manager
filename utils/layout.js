/**
 * 宽屏（电脑 / 平板）适配
 *
 * 1) detect()：判定设备类型（phone / pad / pc），并按窗口比例计算整套电脑端画布尺寸
 *    （宽高比跟随窗口，最宽 16:9、最高 1:2，手机选电脑版也能铺满而不是缩成一条细带）
 * 2) wrap()：把这些结果注入到每个页面的 data 中，页面根节点可直接使用
 *
 * 页面用法：
 *   Page(layout.wrap({ ... }))
 *   <pc-shell nav="seats" title="归属管理">  ...页面内容...  </pc-shell>
 *
 * 判定规则：
 *   pc    ：微信 Windows / Mac 客户端，或开发者工具中宽度 >= 1024（模拟电脑）
 *   pad   ：iPad / 平板（型号或最小边 >= 600px），且处于横屏
 *   phone ：其余情况，沿用移动端布局
 *
 * 电脑版 UI 默认关闭（手机版），由管理员在首页用户卡片右上角的下拉菜单切换；
 * 选择之后不再依据手机 / 电脑设备判定，选什么就渲染什么。
 */
var LAYOUT_KEY = '__layout__'

/* 电脑版：1rpx 对应的视觉像素。页面用 rpx 排版，缩放后 32rpx ≈ 18px、26rpx ≈ 15px，
   这样内容列铺满画布时文字仍是桌面字号，而不会随宽度一起放大。 */
var RPX_PX = 0.58

/* 电脑版框架：直接铺满整个窗口（顶栏 + 左侧导航 + 内容列占满 100vw × 100vh），
   微信电脑端把小程序窗口最大化即可获得「全屏」效果；不再按 16:9 留边，
   避免拖拽 / 最大化窗口后四周出现深色或灰色空带。 */

/* 开发调试用：正常情况下保持 ''（不参与实际逻辑）
   ''      → 按真实设备 / 窗口判定
   'pc'    → 强制电脑模式
   'pad'   → 强制平板模式
   'phone' → 强制手机 UI */
var DEBUG_FORCE_MODE = ''

function readWindowInfo() {
  try {
    if (typeof wx.getWindowInfo === 'function') return wx.getWindowInfo() || {}
  } catch (e) {}
  try {
    if (typeof wx.getSystemInfoSync === 'function') return wx.getSystemInfoSync() || {}
  } catch (e) {}
  return {}
}

/** 给定窗口信息，判定设备类型与画布尺寸；forceMode 可覆盖模式（用于人为选择电脑版） */
function detect(forceMode) {
  var info = readWindowInfo()
  var W = Number(info.windowWidth) || Number(info.screenWidth) || 375
  var H = Number(info.windowHeight) || Number(info.screenHeight) || 667
  var platform = String(info.platform || '')
  var model = String(info.model || '')
  var orientation = String(info.deviceOrientation || (W >= H ? 'landscape' : 'portrait'))
  var landscape = orientation === 'landscape'
  var smallSide = Math.min(W, H)

  var isPC = platform === 'windows' || platform === 'mac' || (platform === 'devtools' && W >= 1024)
  var padModel = /ipad|pad|tablet|sm-[tx]/i.test(model)
  var isPad = !isPC && (padModel || ((platform === 'ios' || platform === 'android') && smallSide >= 600))
  var mode = isPC ? 'pc' : (isPad && landscape ? 'pad' : 'phone')

  // forced 只标记「开发调试强制」，人为选择电脑版走 forceMode，不算调试
  var forced = false
  if (DEBUG_FORCE_MODE === 'pc' || DEBUG_FORCE_MODE === 'pad' || DEBUG_FORCE_MODE === 'phone') {
    mode = DEBUG_FORCE_MODE
    forced = true
  } else if (forceMode === 'pc' || forceMode === 'pad' || forceMode === 'phone') {
    mode = forceMode
  }
  isPC = mode === 'pc'
  isPad = mode === 'pad'
  var wide = mode !== 'phone'

  var layout = {
    windowWidth: W,
    windowHeight: H,
    platform: platform,
    model: model,
    landscape: landscape,
    isPC: isPC,
    isPad: isPad,
    isWide: wide,
    mode: mode,
    deviceLabel: isPC ? '电脑端' : (isPad ? '平板端' : '移动端'),
    modeLabel: mode === 'pc' ? '电脑模式' : (mode === 'pad' ? '平板模式' : '手机模式'),
    forced: forced,
    // 以下为电脑 / 平板画布尺寸（左侧导航 + 内容列，无底部导航栏与右侧信息栏）
    frameW: 0, frameH: 0,
    sideW: 208, topH: 56, gap: 16,
    contentW: 0, contentH: 0,
    layerW: W, scale: 1,
    compact: false,
    tiny: false
  }

  if (wide) {
    // 全屏铺满：画布直接等于窗口（微信电脑端把窗口最大化即「全屏」），四周不留深色/灰色空带
    var frameW = Math.max(320, Math.round(W))
    var frameH = Math.max(240, Math.round(H))

    // 画布较窄时侧栏收成图标条（极窄再收一档，给内容列让出宽度）
    var compact = frameW < 900
    // 极窄（手机上选电脑版）：侧栏再收一档，顶栏也隐藏次要信息
    var tiny = frameW < 560
    var sideW = compact ? (tiny ? 56 : 72) : 208
    var topH = 56
    var gap = tiny ? 8 : 16
    // 内容列铺满画布可用宽度（不再限制 640px，避免内容缩在中间一条窄列里）
    var restW = Math.max(200, frameW - sideW - gap * 2)
    var contentW = restW
    var contentH = Math.max(240, frameH - topH - gap * 2)
    // 兜底：画布过矮时（例如强制宽屏下的手机窗口），压缩内容列高度避免溢出画布
    var maxContentH = Math.max(80, frameH - topH - gap * 2)
    if (contentH > maxContentH) contentH = maxContentH

    layout.frameW = frameW
    layout.frameH = frameH
    layout.sideW = sideW
    layout.topH = topH
    layout.gap = gap
    layout.compact = compact
    layout.tiny = tiny
    layout.contentW = contentW
    layout.contentH = contentH
    /* 内容层用 rpx 排版（750rpx = 窗口宽度），再整体缩放放进内容列。
       关键：rpx → 视觉像素的比例固定为 RPX_PX，不再等于 contentW / 750，
       这样内容列变宽时文字不会跟着膨胀（内容才能真正左右铺开而不显得「放大」）。 */
    var scale = W > 0 ? Math.min(1, (RPX_PX * 750) / W) : 1
    // 内容列比窗口还窄时（手机上选电脑版等），按「装得下 750rpx 设计宽度」缩放，避免内容被裁掉
    var fitScale = W > 0 ? contentW / W : 1
    if (fitScale < scale) scale = fitScale
    layout.scale = +scale.toFixed(4)
    layout.layerW = Math.round(contentW / layout.scale)
  }

  return layout
}

function fallbackLayout() {
  if (typeof wx === 'undefined') return detect()
  try {
    var app = getApp()
    if (app && app.globalData && app.globalData.layout) return app.globalData.layout
  } catch (e) {}
  return detect()
}

var sync = require('./sync.js')

/* ============ 电脑版 UI 的启用范围与版本选择 ============
   默认：无论手机还是电脑登录，所有页面一律手机版。
   切换：仅管理员可用。管理员在首页用户卡片右上角的下拉菜单选「电脑版页面」后，
        当前页面立即变成电脑版，之后所有页面都按电脑版渲染；选择记在缓存 ui_pc_mode，
        不再依据手机 / 电脑设备判定。电脑版顶栏「手机版」按钮可随时切回。
   学生、未登录用户：不显示任何切换入口，永远手机版。 */

var UI_PREF_KEY = 'ui_pc_mode'

/** 已选择的版本：'pc' | 'phone' | ''（未选择，跟随设备） */
function getUiChoice() {
  var v = ''
  try { v = String(wx.getStorageSync(UI_PREF_KEY) || '') } catch (e) {}
  return v === 'pc' || v === 'phone' ? v : ''
}

function setUiChoice(mode) {
  var v = mode === 'pc' ? 'pc' : (mode === 'phone' ? 'phone' : '')
  try {
    if (v) wx.setStorageSync(UI_PREF_KEY, v)
    else wx.removeStorageSync(UI_PREF_KEY)
  } catch (e) {}
  return getUiChoice()
}

function currentRoute() {
  try {
    var pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    return pages.length ? '/' + pages[pages.length - 1].route : ''
  } catch (e) {
    return ''
  }
}

function currentUser() {
  // 以缓存为准（getCurrentUser 会校验并补齐字段），避免全局残留对象判断错角色
  try {
    var store = require('./store.js')
    var user = store.getCurrentUser()
    if (user) {
      try {
        var app = getApp()
        if (app && app.globalData) {
          app.globalData.userInfo = user
          app.globalData.isAdmin = user.role === 'admin'
        }
      } catch (e) {}
      return user
    }
  } catch (e) {}
  try {
    var a = getApp()
    if (a && a.globalData && a.globalData.userInfo) return a.globalData.userInfo
  } catch (e) {}
  return null
}

/** 后台页面（仅 pages/admin/* 开放电脑版 UI） */
function isAdminRoute() {
  return /^\/pages\/admin\//.test(currentRoute())
}

/** 当前用户是否具备切换到电脑版的资格（仅管理员） */
function pcAllowed() {
  var user = currentUser()
  return !!(user && user.role === 'admin')
}

/** 当前设备是否是电脑端（Windows / Mac 微信，或开发者工具宽屏） */
function deviceIsDesktop() {
  return !!detect().isPC
}

/**
 * 当前页面是否启用电脑版 UI：
 * - 非管理员一律手机版
 * - 管理员显式选过版本 → 按选择（'pc' 电脑版 / 'phone' 手机版）
 * - 没选过 → 电脑端默认电脑版（管理员登录后直接就是后台控制台，不用先手动切换），
 *   手机 / 平板仍按手机版
 */
function wideUI() {
  if (!pcAllowed()) return false
  var choice = getUiChoice()
  if (choice) return choice === 'pc'
  return deviceIsDesktop()
}

/* ============ 切换后的即时重渲染 ============ */

/** 已挂载的外壳 / 底部导航栏实例，便于版本切换后立刻重渲染当前页面 */
var shells = []

function registerShell(shell) {
  shells.push(shell)
}

function unregisterShell(shell) {
  shells = shells.filter(function (s) { return s !== shell })
}

/** 通知已挂载的外壳与底部导航栏按最新选择重算（不跳转、不新开页面层级） */
function emitLayoutChange() {
  shells.slice().forEach(function (s) {
    if (!s) return
    try {
      if (typeof s.applyLayout === 'function') s.applyLayout()
      else if (typeof s.refresh === 'function') s.refresh()
    } catch (e) {}
  })
}

/** 取当前页面实例 */
function currentPage() {
  var pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
  return pages.length ? pages[pages.length - 1] : null
}


/** 把当前版本标志写回宿主页面，避免 .page.pc 样式残留 */
function syncPageFlags(wide) {
  var page = currentPage()
  if (!page || typeof page.setData !== 'function') return
  page.setData({
    isWide: !!wide,
    isPC: !!wide,
    isPad: false,
    uiMode: wide ? 'pc' : 'phone',
    deviceMode: wide ? 'pc' : 'phone',
    deviceLabel: wide ? '电脑端' : '移动端'
  })
}

/**
 * 当前实际生效的画布信息：
 * 若「手机上选择了电脑版」这类人为强制场景，按 pc 模式重新计算画布（宽高比随窗口），
 * 避免拿手机的尺寸信息（画布为 0）去渲染电脑版骨架。
 */
function activeLayout() {
  var layout = fallbackLayout()
  if (!layout.frameW && wideUI()) return detect('pc')
  return layout
}

/**
 * 页面混入：注入 isWide / isPC / isPad 等页面数据与画布尺寸
 *
 * 同时接管「服务端数据同步」：页面每次显示都向服务端拉一次快照覆盖本地缓存，
 * 数据有变化时自动重新渲染，因此各页面读到的永远是服务端的最新结果。
 *
 * 页面可用 noServerSync: true 关闭（例如地图编辑器自带服务端拉取逻辑）。
 */
function wrap(page) {
  var apply = function (self) {
    // 布局计算异常不能拖垮页面 onLoad / onShow（否则页面数据停在初始值，
    // 表现为「管理员登录后仍是空白的学生页面」）
    try {
      var layout = activeLayout()
      // 非后台页面 / 非管理员 / 选择手机版 → 一律手机版 UI
      var wide = wideUI()
      self.setData({
        isWide: wide,
        isPC: wide,
        isPad: wide && !!layout.isPad,
        deviceMode: wide ? 'pc' : 'phone',
        deviceLabel: wide ? '电脑端' : '移动端',
        uiMode: wide ? 'pc' : 'phone',
        layout: layout
      })
    } catch (e) {}
  }
  var originLoad = page.onLoad
  var originShow = page.onShow
  page.onLoad = function () {
    apply(this)
    if (originLoad) return originLoad.apply(this, arguments)
  }
  page.onShow = function () {
    apply(this)
    if (originShow) originShow.apply(this, arguments)
    if (page.noServerSync) return
    // 服务端为准：本次显示后拉一次快照，数据有变化就重渲染
    var self = this
    sync.pull().then(function (changed) {
      if (changed) rerender(self)
    })
  }
  return page
}

/**
 * 服务端数据到达后触发页面重渲染：
 * 页面自己实现了 onServerUpdate 的优先使用，否则退回无参的 refresh / render / load，
 * 有参数的渲染方法（如 home.load(user)）不会被误调用。
 */
function rerender(self) {
  try {
    if (typeof self.onServerUpdate === 'function') return self.onServerUpdate.call(self)
    var names = ['refresh', 'render', 'load']
    for (var i = 0; i < names.length; i++) {
      var fn = self[names[i]]
      if (typeof fn === 'function' && fn.length === 0) return fn.call(self)
    }
  } catch (e) {}
}

module.exports = {
  detect: detect,
  wrap: wrap,
  current: fallbackLayout,
  activeLayout: activeLayout,
  wideUI: wideUI,
  pcAllowed: pcAllowed,
  isAdminRoute: isAdminRoute,
  getUiChoice: getUiChoice,
  setUiChoice: setUiChoice,
  registerShell: registerShell,
  unregisterShell: unregisterShell,
  emitLayoutChange: emitLayoutChange,
  syncPageFlags: syncPageFlags,
  isWide: function () { return !!fallbackLayout().isWide },
  isPC: function () { return !!fallbackLayout().isPC }
}
