var api = require('../../utils/api.js')
var store = require('../../utils/store.js')
var util = require('../../utils/util.js')
var config = require('../../utils/config.js')
var qr = require('../../utils/qr.js')
var layout = require('../../utils/layout.js')
var app = getApp()

var THEMES = [
  { key: 'blue', name: '科技蓝', fg: '#000000', qrBg: '#ffffff', cellBg: '#ffffff', pageBg: '#eef3fb', headerColor: '#1f5fc4' },
  { key: 'classic', name: '经典黑', fg: '#000000', qrBg: '#ffffff', cellBg: '#ffffff', pageBg: '#f2f4f8', headerColor: '#1a2233' },
  { key: 'green', name: '墨绿', fg: '#000000', qrBg: '#ffffff', cellBg: '#ffffff', pageBg: '#f0f7f4', headerColor: '#0e7a56' },
  { key: 'ink', name: '深灰', fg: '#000000', qrBg: '#ffffff', cellBg: '#ffffff', pageBg: '#f5f6f8', headerColor: '#33415c' }
]

var DEFAULT_STYLE = {
  theme: 'blue',
  fg: '#000000',
  qrBg: '#ffffff',
  cellBg: '#ffffff',
  pageBg: '#eef3fb',
  textColor: '#1a2233',
  subColor: '#6b7688',
  headerColor: '#1f5fc4',
  headerText: '研究生工位管理系统',
  tips: ['请使用微信扫描二维码', '扫码后查看工位并登记', '一个工位仅可被一人登记'],
  footerText: '研究生院 · 工位管理',
  numbered: true,
  shape: 'square',
  ecl: 'M',
  cols: 3,
  showCode: true,
  showZone: false,
  badge: false
}

Page(layout.wrap({
  data: {
    themes: THEMES,
    shapes: [{ key: 'square', name: '方形' }, { key: 'dot', name: '圆点' }],
    ecls: ['L', 'M', 'Q', 'H'],
    colOptions: [2, 3, 4],
    scopes: [
      { key: 'all', name: '全部' },
      { key: 'free', name: '仅空闲' },
      { key: 'used', name: '仅已登记' }
    ],
    style: DEFAULT_STYLE,
    scope: 'all',
    total: 0,
    pageIndex: 0,
    pageCount: 1,
    canvasW: 640,
    canvasH: 600,
    exporting: false
  },

  onShow: function () {
    var user = app.getUser()
    if (!user) return wx.redirectTo({ url: '/pages/login/login' })
    if (user.role !== 'admin') {
      util.toast('仅管理员可访问')
      return wx.redirectTo({ url: '/pages/home/home' })
    }
    this.allSeats = []
    this.load()
  },

  load: function () {
    var self = this
    // 先取办公室配置，标签上的楼栋以办公室配置为准
    api.getOffices().then(function (res) {
      var offices = res && res.ok && res.list ? res.list : store.getOffices()
      self.officeMap = {}
      offices.forEach(function (o) { self.officeMap[o.id] = o })
      var scopes = [
        { key: 'all', name: '全部' },
        { key: 'free', name: '仅空闲' },
        { key: 'used', name: '仅已登记' }
      ].concat(offices.map(function (o) { return { key: o.id, name: o.name } }))
      self.setData({ scopes: scopes })
      return api.adminSeats({ status: 'all' }, app.getUser())
    }).then(function (res) {
      var list = res && res.ok && res.list ? res.list : store.adminSeats({}).list
      // 二维码绑定不可变编号 id，导出内容固定为 {QR_BASE}/s/{id}
      self.allSeats = list.map(function (s) {
        var office = (self.officeMap || {})[s.officeId]
        // 楼栋取办公室配置里的「楼栋」，留空时回退办公室名称
        var zoneName = (office && office.building) || s.building || (office && office.name) || s.officeName || ''
        return { id: s.id, code: s.code, zone: s.zone, zoneName: zoneName, officeId: s.officeId, status: s.status }
      })
      self.applyFilter()
    }).catch(function () {
      util.toast('工位数据加载失败')
    })
  },

  applyFilter: function () {
    var scope = this.data.scope
    var list = (this.allSeats || []).filter(function (s) {
      if (scope === 'all') return true
      if (scope === 'free') return s.status === 'free'
      if (scope === 'used') return s.status === 'used'
      return s.officeId === scope
    })
    var layout = qr.buildLayout(this.data.style, list.length)
    var pages = []
    for (var i = 0; i < list.length; i += layout.perPage) pages.push(list.slice(i, i + layout.perPage))
    if (!pages.length) pages.push([])
    this.layout = layout
    this.pages = pages
    this.filteredList = list
    var self = this
    this.setData({
      total: list.length,
      pageCount: layout.pageCount,
      pageIndex: 0,
      canvasW: layout.canvasW
    }, function () {
      self.renderPage()
    })
  },

  pageHeight: function (count) {
    var layout = this.layout
    if (!count) return layout.gutter * 2
    var rows = Math.ceil(count / layout.cols)
    return layout.gutter + rows * (layout.cellH + layout.gutter)
  },

  renderPage: function (cb) {
    var self = this
    if (!this.layout) return cb && cb()
    var items = this.pages[this.data.pageIndex] || []
    this.setData({ canvasH: this.pageHeight(items.length) }, function () {
      setTimeout(function () {
        var ctx = wx.createCanvasContext('qrCanvas', self)
        qr.drawPage(ctx, {
          items: items,
          style: self.data.style,
          layout: self.layout,
          urlOf: function (item) { return config.qrContent(item.id) }
        })
        ctx.draw(false, function () { if (cb) cb() })
      }, 30)
    })
  },

  /* ---------------- 样式设置 ---------------- */
  pickTheme: function (e) {
    var theme = THEMES.filter(function (t) { return t.key === e.currentTarget.dataset.key })[0]
    if (!theme) return
    var style = Object.assign({}, this.data.style, {
      theme: theme.key,
      fg: theme.fg,
      qrBg: theme.qrBg,
      cellBg: theme.cellBg,
      pageBg: theme.pageBg,
      headerColor: theme.headerColor
    })
    this.setData({ style: style }, function () { this.applyFilter() }.bind(this))
  },

  pickShape: function (e) {
    this.updateStyle({ shape: e.currentTarget.dataset.key })
  },

  pickEcl: function (e) {
    this.updateStyle({ ecl: e.currentTarget.dataset.key })
  },

  pickCols: function (e) {
    this.updateStyle({ cols: parseInt(e.currentTarget.dataset.key, 10) })
  },

  toggle: function (e) {
    var patch = {}
    patch[e.currentTarget.dataset.key] = !this.data.style[e.currentTarget.dataset.key]
    this.updateStyle(patch)
  },

  updateStyle: function (patch) {
    var style = Object.assign({}, this.data.style, patch)
    this.setData({ style: style }, function () { this.applyFilter() }.bind(this))
  },

  /** 标题 / 提示文案 / 底部文案输入（失焦或确认后重绘） */
  onText: function (e) {
    var ds = e.currentTarget.dataset
    var style = Object.assign({}, this.data.style)
    var val = e.detail.value
    if (ds.field === 'tips') {
      var tips = (style.tips || []).slice()
      tips[ds.index] = val
      style.tips = tips
    } else {
      style[ds.field] = val
    }
    this.setData({ style: style })
  },

  applyStyle: function () {
    this.applyFilter()
  },

  resetStyle: function () {
    this.setData({ style: Object.assign({}, DEFAULT_STYLE) }, function () {
      this.applyFilter()
    }.bind(this))
  },

  pickScope: function (e) {
    this.setData({ scope: e.currentTarget.dataset.key }, function () { this.applyFilter() }.bind(this))
  },

  /* ---------------- 分页预览 ---------------- */
  prevPage: function () {
    if (this.data.pageIndex <= 0) return
    this.setData({ pageIndex: this.data.pageIndex - 1 }, function () { this.renderPage() }.bind(this))
  },

  nextPage: function () {
    if (this.data.pageIndex >= this.data.pageCount - 1) return
    this.setData({ pageIndex: this.data.pageIndex + 1 }, function () { this.renderPage() }.bind(this))
  },

  /* ---------------- 导出 ---------------- */
  savePage: function (index, cb) {
    var self = this
    this.setData({ pageIndex: index }, function () {
      self.renderPage(function () {
        wx.canvasToTempFilePath({
          canvasId: 'qrCanvas',
          fileType: 'png',
          destWidth: self.layout.canvasW * 3,
          destHeight: self.data.canvasH * 3,
          success: function (r) {
            wx.saveImageToPhotosAlbum({
              filePath: r.tempFilePath,
              success: function () { cb && cb(null) },
              fail: function (e) { cb && cb(e) }
            })
          },
          fail: function (e) { cb && cb(e) }
        }, self)
      })
    })
  },

  exportCurrent: function () {
    var self = this
    if (!this.data.total) return util.toast('暂无可导出工位')
    this.ensureAuth(function (ok) {
      if (!ok) return
      self.savePage(self.data.pageIndex, function (err) {
        if (err) return util.toast('保存失败：' + (err.errMsg || '请检查相册权限'))
        util.toast('已保存到相册', 'success')
      })
    })
  },

  exportAll: function () {
    var self = this
    if (!this.data.total) return util.toast('暂无可导出工位')
    wx.showModal({
      title: '一键导出全部',
      content: '共 ' + this.data.total + ' 个工位，将分 ' + this.data.pageCount + ' 张图片保存到相册，是否继续？',
      confirmText: '开始导出',
      success: function (r) {
        if (!r.confirm) return
        self.ensureAuth(function (ok) {
          if (!ok) return
          self.setData({ exporting: true })
          self.doExportAll(0, 0)
        })
      }
    })
  },

  doExportAll: function (index, done) {
    var self = this
    if (index >= this.pages.length || this.data.exporting === false) {
      this.setData({ exporting: false })
      wx.hideLoading()
      return util.toast('导出完成：' + done + ' 张', 'success')
    }
    wx.showLoading({ title: '导出中 ' + (index + 1) + '/' + this.pages.length, mask: true })
    this.savePage(index, function (err) {
      self.doExportAll(index + 1, done + (err ? 0 : 1))
    })
  },

  ensureAuth: function (cb) {
    wx.getSetting({
      success: function (res) {
        if (res.authSetting && res.authSetting['scope.writePhotosAlbum']) return cb(true)
        wx.authorize({
          scope: 'scope.writePhotosAlbum',
          success: function () { cb(true) },
          fail: function () {
            wx.showModal({
              title: '需要相册权限',
              content: '导出二维码需要「保存到相册」权限，请在设置中开启。',
              confirmText: '去设置',
              success: function (r) { if (r.confirm) wx.openSetting() }
            })
            cb(false)
          }
        })
      },
      fail: function () { cb(true) }
    })
  },

  /** 导出二维码内容清单（便于用外部工具批量生成） */
  copyList: function () {
    var list = this.filteredList || []
    if (!list.length) return util.toast('暂无可导出工位')
    var text = list.map(function (s) { return s.code + '\t' + s.id + '\t' + config.qrContent(s.id) }).join('\n')
    wx.setClipboardData({ data: text })
  }
}))
