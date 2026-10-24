var api = require('../../utils/api.js')
var store = require('../../utils/store.js')
var config = require('../../utils/config.js')
var util = require('../../utils/util.js')
var layout = require('../../utils/layout.js')
var app = getApp()

Page(layout.wrap({
  data: {
    stats: {},
    list: [],
    offices: [],
    officeId: '',
    officeName: '全部办公室',
    keyword: '',
    status: 'all',
    tabs: [
      { key: 'all', text: '全部' },
      { key: 'used', text: '已登记' },
      { key: 'free', text: '空闲' },
      { key: 'repair', text: '停用' }
    ],
    loading: false
  },

  onLoad: function (options) {
    if (options && options.officeId) this.setData({ officeId: options.officeId })
  },

  onShow: function () {
    var user = app.getUser()
    if (!user) return wx.redirectTo({ url: '/pages/login/login' })
    if (user.role !== 'admin') {
      util.toast('仅管理员可访问')
      return wx.redirectTo({ url: '/pages/home/home' })
    }
    this.loadOffices()
    this.load()
  },

  onPullDownRefresh: function () {
    var self = this
    this.load(function () {
      wx.stopPullDownRefresh()
    })
  },

  loadOffices: function () {
    var self = this
    api.getOffices().then(function (res) {
      if (!res.ok) return
      var offices = res.list || []
      self.setData({ offices: offices })
      var current = offices.filter(function (o) { return o.id === self.data.officeId })[0]
      if (current) self.setData({ officeName: current.name })
    })
  },

  load: function (done) {
    var self = this
    this.setData({ loading: true })
    api.adminSeats({
      status: this.data.status,
      keyword: this.data.keyword,
      officeId: this.data.officeId
    }, app.getUser()).then(function (res) {
      self.setData({ loading: false })
      if (!res.ok) {
        util.toast(res.msg || '加载失败')
        if (done) done()
        return
      }
      var customOffices = {}
      store.getOffices().forEach(function (o) {
        if (o.mapMode === 'custom') customOffices[o.id] = true
      })
      var list = (res.list || []).map(function (s) {
        // 自定义布局（照片 + 点位）没有行列概念，列表里显示顺序号
        var posText = customOffices[s.officeId]
          ? (String(s.no || s.col) + ' 号')
          : ('第 ' + s.row + ' 排 第 ' + s.col + ' 座')
        return Object.assign({}, s, { qrContent: config.qrContent(s.id), posText: posText })
      })
      self.setData({ list: list, stats: res.stats || {} })
      if (done) done()
    }).catch(function () {
      self.setData({ loading: false })
      util.toast('网络异常')
      if (done) done()
    })
  },

  onSearch: function (e) {
    this.setData({ keyword: e.detail.value })
    this.load()
  },

  switchFilter: function (e) {
    this.setData({ status: e.currentTarget.dataset.key })
    this.load()
  },

  pickOffice: function (e) {
    var id = e.currentTarget.dataset.id
    var name = e.currentTarget.dataset.name
    this.setData({ officeId: id, officeName: name })
    this.load()
  },

  /** 强制释放归属 */
  onRelease: function (e) {
    var self = this
    var id = e.currentTarget.dataset.id
    var code = e.currentTarget.dataset.code
    wx.showModal({
      title: '释放归属',
      content: '确认释放工位 ' + code + ' 的归属？释放后该工位变为空闲，其他同学可申请。',
      confirmText: '确认释放',
      success: function (r) {
        if (!r.confirm) return
        api.releaseSeat(id, app.getUser(), true).then(function (res) {
          if (!res.ok) return util.toast(res.msg || '操作失败')
          util.toast('已释放归属', 'success')
          self.load()
        })
      }
    })
  },

  /** 停用 / 恢复空闲 */
  onToggleStatus: function (e) {
    var self = this
    var id = e.currentTarget.dataset.id
    var next = e.currentTarget.dataset.status
    api.adminSetSeatStatus(id, next, app.getUser()).then(function (res) {
      if (!res.ok) return util.toast(res.msg || '操作失败')
      util.toast(res.msg || '操作成功', 'success')
      self.load()
    })
  },

  /** 修改展示编号（不影响二维码） */
  onRename: function (e) {
    var self = this
    var id = e.currentTarget.dataset.id
    var code = e.currentTarget.dataset.code
    wx.showModal({
      title: '修改工位编号',
      content: '仅修改展示编号，二维码不变。',
      editable: true,
      placeholderText: code,
      success: function (r) {
        if (!r.confirm || !r.content) return
        api.updateSeatCode(id, r.content.trim()).then(function (res) {
          if (!res.ok) return util.toast(res.msg || '修改失败')
          util.toast('编号已更新，二维码不变', 'success')
          self.load()
        })
      }
    })
  },

  /** 二维码内容（固定不变） */
  onQr: function (e) {
    var content = e.currentTarget.dataset.qr
    wx.showModal({
      title: '工位二维码内容',
      content: content,
      confirmText: '复制',
      cancelText: '关闭',
      success: function (r) {
        if (!r.confirm) return
        wx.setClipboardData({ data: content })
      }
    })
  },

  goQrExport: function () {
    wx.navigateTo({ url: '/pages/admin/qrcode' })
  },

  goOffices: function () {
    wx.navigateTo({ url: '/pages/admin/offices' })
  },

  goStudents: function () {
    wx.navigateTo({ url: '/pages/admin/students' })
  },

  goSettings: function () {
    wx.navigateTo({ url: '/pages/admin/settings' })
  },

  logout: function () {
    wx.showModal({
      title: '退出登录',
      content: '确定退出当前管理员账号吗？',
      success: function (r) {
        if (!r.confirm) return
        store.logout()
        app.clearUser()
        wx.reLaunch({ url: '/pages/login/login' })
      }
    })
  }
}))
