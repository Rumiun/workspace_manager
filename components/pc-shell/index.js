/**
 * pc-shell：电脑 / 平板（宽屏）专用外壳
 *
 * - 手机模式：直接透传内容，不做任何改变
 * - 宽屏模式：顶栏 + 左侧导航 + 自适应比例画布中的内容列 + 右侧概览信息栏
 *   画布宽高比跟随窗口（最宽 16:9、最高 1:2），内容列沿用移动端页面（rpx 排版）
 *   并按画布宽度整体缩放，保证可读且不溢出
 */
var layout = require('../../utils/layout.js')
var store = require('../../utils/store.js')
var util = require('../../utils/util.js')

/** 导航菜单：type = tab 走 switchTab，nav 走 navigateTo */
var BASE_GROUPS = [
  {
    name: '工位服务',
    items: [
      { key: 'home', icon: '首', text: '首页概览', url: '/pages/home/home', type: 'tab' },
      { key: 'seat', icon: '图', text: '工位地图', url: '/pages/seat/seat', type: 'tab' },
      { key: 'register', icon: '码', text: '扫码 / 登记', url: '/pages/register/register', type: 'nav' },
      { key: 'records', icon: '记', text: '申请记录', url: '/pages/records/records', type: 'nav' },
      { key: 'approval', icon: '审', text: '审批', url: '/pages/approval/approval', type: 'tab' }
    ]
  },
  {
    name: '个人',
    items: [
      { key: 'mine', icon: '我', text: '个人中心', url: '/pages/mine/mine', type: 'tab' }
    ]
  }
]

var ADMIN_GROUP = {
  name: '后台管理',
  items: [
    { key: 'seats', icon: '属', text: '工位归属', url: '/pages/admin/seats', type: 'nav' },
    { key: 'offices', icon: '室', text: '办公室', url: '/pages/admin/offices', type: 'nav' },
    { key: 'students', icon: '生', text: '学生', url: '/pages/admin/students', type: 'nav' },
    { key: 'adminRegister', icon: '登', text: '登记管理', url: '/pages/admin/register', type: 'nav' },
    { key: 'qrcode', icon: '签', text: '二维码标签', url: '/pages/admin/qrcode', type: 'nav' },
    { key: 'settings', icon: '设', text: '系统设置', url: '/pages/admin/settings', type: 'nav' }
  ]
}

Component({
  options: { multipleSlots: true },

  properties: {
    /** 当前菜单 key，用于高亮 */
    nav: { type: String, value: '' },
    /** 顶栏标题 */
    title: { type: String, value: '工位管理' },
    /** 是否显示外壳（顶栏 / 侧栏 / 信息栏）；登录页传 false 只保留画布 */
    chrome: { type: Boolean, value: true },
    /** 电脑端提示文案（可选） */
    hint: { type: String, value: '' }
  },

  data: {
    wide: false,
    frameW: 0,
    frameH: 0,
    sideW: 208,
    topH: 56,
    gap: 16,
    contentW: 0,
    contentH: 0,
    layerW: 375,
    scale: 1,
    compact: false,
    tiny: false,
    frameStyle: '',
    sideStyle: '',
    mainStyle: '',
    stageStyle: '',
    layerStyle: '',
    scalerStyle: '',
    scalerFlowing: true,
    groups: [],
    activeKey: '',
    today: '',
    userName: '',
    roleText: '',
    deviceLabel: '',
    modeLabel: '',
    forcedText: '',
    registerText: '',
    registerOpen: false,
    termText: ''
  },

  lifetimes: {
    attached: function () {
      // 注册到 layout，便于管理员切换版本后即时重渲染（不跳转）
      layout.registerShell(this)
      this.applyLayout()
    },
    detached: function () {
      this.stopScaleWatch()
      layout.unregisterShell(this)
    }
  },

  pageLifetimes: {
    show: function () {
      this.applyLayout()
      // 页面显示期间定时校正滚动区域高度（列表数据变化后也能对得上）
      this.startScaleWatch()
    },
    hide: function () {
      this.stopScaleWatch()
    }
  },

  methods: {
    applyLayout: function () {
      var self = this
      var app = null
      try { app = getApp() } catch (e) {}
      var user = (app && typeof app.getUser === 'function' ? app.getUser() : store.getCurrentUser())
      var isAdmin = !!(user && user.role === 'admin')

      // 菜单按角色裁剪：管理员额外显示「后台管理」
      var groups = JSON.parse(JSON.stringify(BASE_GROUPS))
      if (isAdmin) groups.splice(1, 0, JSON.parse(JSON.stringify(ADMIN_GROUP)))

      var info = layout.activeLayout()
      // 管理员在后台页面即可切换电脑版 / 手机版，按选择渲染，不再依据设备判定
      var wide = layout.wideUI()

      var patch = {
        wide: wide,
        groups: groups,
        activeKey: this.data.nav,
        userName: user ? user.name : '未登录',
        roleText: user ? (isAdmin ? '管理员' : '研究生') : '未登录',
        deviceLabel: info.deviceLabel || '',
        modeLabel: info.modeLabel || '',
        forcedText: info.forced ? '（调试强制）' : '',
        today: util.formatDate()
      }

      if (info.isWide && info.frameW) {
        patch.frameW = info.frameW
        patch.frameH = info.frameH
        patch.sideW = info.sideW
        patch.topH = info.topH
        patch.gap = info.gap
        patch.contentW = info.contentW
        patch.contentH = info.contentH
        patch.layerW = info.layerW
        patch.scale = info.scale
        patch.compact = !!info.compact
        patch.tiny = !!info.tiny
        patch.frameStyle = 'width:' + info.frameW + 'px;height:' + info.frameH + 'px'
        patch.sideStyle = 'width:' + info.sideW + 'px'
        patch.mainStyle = 'width:' + (info.frameW - info.sideW) + 'px'
        patch.stageStyle = 'width:' + info.contentW + 'px;height:' + info.contentH + 'px'
        patch.layerStyle = 'width:' + info.layerW + 'px;transform:scale(' + info.scale + ');transform-origin:0 0'
      }

      this.setData(patch)
      // 缩放比例变了以后重新测量内容高度；首屏渲染还没完成时再补测两次
      this.syncScalerHeight()
      var self2 = this
      ;[150, 600].forEach(function (delay) {
        setTimeout(function () { self2.syncScalerHeight() }, delay)
      })
      if (patch.wide) {
        var rs = store.registerState()
        var term = store.currentTerm()
        this.setData({
          registerOpen: rs.open,
          registerText: rs.text,
          termText: (term.termStart || '') + ' 至 ' + (term.termEnd || '')
        })
      }
    },

    /**
     * 把内容层缩放后的「视觉高度」写回 scaler：
     * layer 用 rpx 排版（逻辑宽度远大于内容列），若让它按原始高度参与布局，
     * 滚动区域会比看到的区域大好几倍（能滚出一大段空白），这里统一修正。
     */
    syncScalerHeight: function () {
      var self = this
      if (!this.data.wide || !this.data.scale) return
      if (typeof wx === 'undefined' || typeof wx.createSelectorQuery !== 'function') return
      try {
        var q = wx.createSelectorQuery().in(this)
        q.select('.pc-layer').fields({ size: true })
        q.select('.pc-layer').boundingClientRect()
        q.exec(function (res) {
          if (!res || !res.length) return
          var layoutH = res[0] && res[0].height
          var rectH = res[1] && res[1].height
          var visual = 0
          if (layoutH && rectH) visual = Math.min(layoutH * self.data.scale, rectH)
          else if (rectH) visual = rectH
          else if (layoutH) visual = layoutH * self.data.scale
          if (!visual) return
          visual = Math.ceil(visual)
          if (Math.abs(visual - (self._scalerH || 0)) < 2) return
          self._scalerH = visual
          self.setData({ scalerStyle: 'height:' + visual + 'px', scalerFlowing: false })
        })
      } catch (e) {}
    },

    startScaleWatch: function () {
      var self = this
      this.stopScaleWatch()
      this._scaleTimer = setInterval(function () { self.syncScalerHeight() }, 800)
    },

    stopScaleWatch: function () {
      if (this._scaleTimer) {
        clearInterval(this._scaleTimer)
        this._scaleTimer = null
      }
    },

    /** 电脑版 → 手机版：立即重渲染并刷新页面数据，无需跳转 */
    useMobile: function () {
      this.switchVersion('phone')
    },

    /** 版本切换：写偏好 → 同步宿主页面标志 → 重渲染外壳 → 刷新数据 */
    switchVersion: function (mode) {
      layout.setUiChoice(mode)
      var wide = layout.wideUI()
      layout.syncPageFlags(wide)
      this.applyLayout()
      layout.emitLayoutChange()
      this.refreshPage()
      util.toast(wide ? '已切换为电脑版页面' : '已切换为手机版页面')
    },

    goNav: function (e) {
      var url = e.currentTarget.dataset.url
      var type = e.currentTarget.dataset.type
      if (!url) return
      var pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
      var current = pages.length ? '/' + pages[pages.length - 1].route : ''
      if (current === url) return
      if (type === 'tab') return wx.redirectTo({ url: url })
      wx.navigateTo({
        url: url,
        fail: function () { wx.redirectTo({ url: url }) }
      })
    },

    /** 宽屏模式下页面走内部滚动，无法下拉刷新；用顶栏按钮触发同样的刷新逻辑 */
    refreshPage: function () {
      var pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
      var page = pages.length ? pages[pages.length - 1] : null
      if (!page) return
      var self = this
      setTimeout(function () { self.syncScalerHeight() }, 300)
      try {
        if (typeof page.onPullDownRefresh === 'function') return page.onPullDownRefresh()
        if (typeof page.load === 'function' && !page.data.token) return page.load()
        if (typeof page.render === 'function') return page.render()
      } catch (e) {}
      util.toast('请在页面中使用工具栏刷新')
    },

    quit: function () {
      wx.showModal({
        title: '退出登录',
        content: '确定退出当前账号吗？',
        success: function (r) {
          if (!r.confirm) return
          store.logout()
          try {
            var app = getApp()
            if (app && app.clearUser) app.clearUser()
          } catch (e) {}
          wx.reLaunch({ url: '/pages/login/login' })
        }
      })
    }
  }
})
