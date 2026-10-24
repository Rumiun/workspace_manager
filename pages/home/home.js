var api = require('../../utils/api.js')
var store = require('../../utils/store.js')
var util = require('../../utils/util.js')
var config = require('../../utils/config.js')
var layout = require('../../utils/layout.js')
var app = getApp()

Page(layout.wrap({
  data: {
    user: {},
    isAdmin: false,
    mySeat: null,
    seatFacility: '',
    stats: {},
    pendingCount: 0,
    notices: [],
    termText: '',
    uiPc: false,
    uiMenuOpen: false
  },

  onShow: function () {
    var user = app.getUser()
    if (!user) return wx.redirectTo({ url: '/pages/login/login' })
    this.setData({ user: user, isAdmin: user.role === 'admin' })
    this.refreshUiPref()
    this.load(user)
  },

  onPullDownRefresh: function () {
    this.load(this.data.user)
    wx.stopPullDownRefresh()
  },

  /** 当前实际生效的版本：管理员在电脑端默认电脑版，可手动切回手机版（选择会记住） */
  refreshUiPref: function () {
    var pc = layout.wideUI()
    this.setData({ uiPc: pc })
    return pc
  },

  toggleUiMenu: function () {
    this.setData({ uiMenuOpen: !this.data.uiMenuOpen })
  },

  closeUiMenu: function () {
    if (this.data.uiMenuOpen) this.setData({ uiMenuOpen: false })
  },

  /** 立即切换页面类型：当前页（含外壳）原地重渲染，不跳转、不新开页面层级 */
  switchUi: function (mode) {
    layout.setUiChoice(mode)
    var pc = layout.wideUI()
    this.setData({ uiMenuOpen: false, uiPc: pc })
    // 同步当前页的视图标志并让 pc-shell 按新版本重算
    layout.syncPageFlags(pc)
    layout.emitLayoutChange()
    util.toast(pc ? '已切换为电脑版页面' : '已切换为手机版页面')
  },

  usePhoneUI: function () {
    this.switchUi('phone')
  },

  usePcUI: function () {
    this.switchUi('pc')
  },

  load: function (user) {
    var self = this
    var settings = store.getSettings()
    this.setData({
      notices: store.getNotices(),
      stats: store.getStats(),
      termText: settings.termStart + ' 至 ' + settings.termEnd,
      pendingCount: user.role === 'admin'
        ? store.getPendingApps().length
        : store.getMyApps(user.id).filter(function (a) { return a.status === 'pending' }).length
    })
    if (user.role === 'admin') return
    api.getMySeat(user).then(function (res) {
      var seat = res.ok ? res.seat : null
      self.setData({ mySeat: seat, seatFacility: seat ? seat.facility : '' })
    })
  },

  /** 扫码申请/登记：解析二维码内容后进入工位页 */
  goScan: function () {
    wx.scanCode({
      onlyFromCamera: false,
      success: function (res) {
        var token = util.parseSeatCode(res.result)
        if (!token) return util.toast('无法识别的二维码')
        wx.navigateTo({ url: '/pages/register/register?code=' + token })
      },
      fail: function () {}
    })
  },

  goRegister: function () {
    wx.navigateTo({ url: '/pages/register/register' })
  },

  goMySeat: function () {
    if (this.data.mySeat) return wx.navigateTo({ url: '/pages/register/register?code=' + this.data.mySeat.id })
    this.goScan()
  },

  showQrRule: function () {
    wx.showModal({
      title: '固定二维码规则',
      content: '每个工位生成时获得不可变编号（如 S0001），二维码内容固定为 ' + config.QR_BASE + '/s/{工位编号}，例如 ' + config.qrContent('S0001') + '。调整办公室或工位编号不会影响二维码，一工位始终只对应一个二维码。',
      showCancel: false,
      confirmText: '知道了'
    })
  },

  goSeat: function () {
    wx.redirectTo({ url: '/pages/seat/seat' })
  },

  goRecords: function () {
    wx.navigateTo({ url: '/pages/records/records' })
  },

  goPending: function () {
    if (this.data.isAdmin) return wx.redirectTo({ url: '/pages/approval/approval' })
    wx.navigateTo({ url: '/pages/records/records?tab=pending' })
  },

  goApproval: function () {
    wx.redirectTo({ url: '/pages/approval/approval' })
  },

  goRegister: function () {
    wx.navigateTo({ url: '/pages/admin/register' })
  },

  goAdmin: function () {
    wx.navigateTo({ url: '/pages/admin/seats' })
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

  goMine: function () {
    wx.redirectTo({ url: '/pages/mine/mine' })
  },

  showNotice: function (e) {
    var item = this.data.notices[e.currentTarget.dataset.index]
    if (!item) return
    wx.showModal({
      title: item.title,
      content: item.content,
      showCancel: false,
      confirmText: '知道了'
    })
  }
}))
