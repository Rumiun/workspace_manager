var api = require('../../utils/api.js')
var store = require('../../utils/store.js')
var util = require('../../utils/util.js')
var config = require('../../utils/config.js')
var layout = require('../../utils/layout.js')
var app = getApp()

var STATUS_MAP = {
  free: { text: '空闲 · 可申请', cls: 'success' },
  used: { text: '已登记', cls: 'primary' },
  repair: { text: '停用 · 维修中', cls: 'danger' }
}

Page(layout.wrap({
  data: {
    token: '',
    inputCode: '',
    seat: null,
    logs: [],
    loading: false,
    errorMsg: '',
    statusText: '',
    statusClass: '',
    canApply: false,
    canClaim: false,
    isMine: false,
    taken: false,
    disabled: false,
    isAdmin: false,
    reason: '',
    pendingTip: '',
    termText: '',
    mode: 'approval',
    registerOpen: true,
    registerText: '',
    hasSeat: false,
    mySeatCode: '',
    qrContent: ''
  },

  onLoad: function (options) {
    var token = util.parseSeatCode(options.code || options.seat || options.q || options.scene)
    this.setData({ token: token, inputCode: token })
    if (token) this.load(token)
  },

  onPullDownRefresh: function () {
    var self = this
    if (!this.data.token) return wx.stopPullDownRefresh()
    this.load(this.data.token, function () {
      wx.stopPullDownRefresh()
    })
  },

  load: function (token, done) {
    var self = this
    var user = app.getUser()
    if (!user) {
      util.toast('请先登录')
      return wx.redirectTo({
        url: '/pages/login/login?redirect=' + encodeURIComponent('/pages/register/register?code=' + token)
      })
    }
    this.setData({ loading: true, errorMsg: '', isAdmin: user.role === 'admin' })
    api.getSettings().then(function (sres) {
      var settings = sres && sres.ok && sres.settings ? sres.settings : store.getSettings()
      var register = (sres && sres.register) || store.registerState()
      // 学生已有工位时不可再申请/登记其他工位，先查自己名下工位
      var mineReq = user.role === 'student'
        ? api.getMySeat(user)
        : Promise.resolve({ ok: true, seat: null })
      return Promise.all([api.getSeat(token, user), mineReq]).then(function (arr) {
        var res = arr[0]
        var mineRes = arr[1]
        var mySeat = mineRes && mineRes.ok ? mineRes.seat : null
        self.setData({ loading: false })
        if (!res.ok) {
          self.setData({ seat: null, errorMsg: res.msg || '查询失败' })
          return null
        }
        self.applySeatView(res.seat, settings, user, register, mySeat)
        return api.seatLogs(token)
      })
    }).then(function (logRes) {
      if (logRes && logRes.ok) self.setData({ logs: logRes.list.slice(0, 3) })
      if (done) done()
    }).catch(function () {
      self.setData({ loading: false, errorMsg: '网络异常，请稍后重试' })
      if (done) done()
    })
  },

  applySeatView: function (seat, settings, user, register, mySeat) {
    var meta = STATUS_MAP[seat.status] || STATUS_MAP.free
    var isMine = !!seat.isMine
    var taken = seat.status === 'used' && !isMine
    var pending = user.role === 'student'
      ? store.getMyApps(user.id).filter(function (a) { return a.status === 'pending' })[0]
      : null
    var open = register ? register.open !== false : true
    var free = !isMine && !taken && seat.status === 'free'
    // 一工位一归属：已有工位时不能再申请/登记其他工位（自己的工位除外）
    var hasSeat = !isMine && !!mySeat && !!mySeat.id && mySeat.id !== seat.id
    this.setData({
      seat: seat,
      statusText: isMine ? '我的工位' : meta.text,
      statusClass: isMine ? 'primary' : meta.cls,
      isMine: isMine,
      taken: taken,
      disabled: seat.status === 'repair',
      registerOpen: open,
      registerText: register ? register.text : '',
      hasSeat: hasSeat,
      mySeatCode: mySeat ? (mySeat.code || '') : '',
      canClaim: free && open && !hasSeat && settings.mode === 'direct',
      canApply: free && open && !hasSeat && settings.mode === 'approval' && !pending,
      termText: (seat.termStart || settings.termStart) + ' 至 ' + (seat.termEnd || settings.termEnd),
      mode: settings.mode,
      pendingTip: pending ? '你有一条待审批申请（' + pending.seatCode + '），请先等待处理结果' : '',
      qrContent: config.qrContent(seat.id)
    })
  },

  onInput: function (e) {
    this.setData({ inputCode: e.detail.value })
  },

  onReason: function (e) {
    this.setData({ reason: e.detail.value })
  },

  onQuery: function () {
    var token = util.parseSeatCode(this.data.inputCode)
    if (!token) return util.toast('请输入工位编号，如 A-0102 或 S0001')
    this.setData({ token: token })
    this.load(token)
  },

  onScan: function () {
    var self = this
    wx.scanCode({
      onlyFromCamera: false,
      success: function (res) {
        var token = util.parseSeatCode(res.result)
        if (!token) return util.toast('无法识别的二维码')
        self.setData({ token: token, inputCode: token })
        self.load(token)
      },
      fail: function () {}
    })
  },

  /** 扫码提交工位申请（使用期限由管理员设置，学生不可填报） */
  onApply: function () {
    var self = this
    var seat = this.data.seat
    if (!seat) return
    var user = app.getUser()
    // 已有工位不可再申请其他工位，请先退订
    if (this.data.hasSeat) {
      return util.toast('你已登记工位 ' + this.data.mySeatCode + '，请先退订后再申请')
    }
    if (!this.data.reason.trim()) return util.toast('请填写申请理由')
    api.applySeat(seat.id, user, this.data.reason.trim()).then(function (res) {
      if (!res.ok) return util.toast(res.msg || '提交失败')
      util.toast('申请已提交，等待审批', 'success')
      self.setData({ reason: '' })
      self.load(seat.id)
    }).catch(function () {
      util.toast('网络异常，提交失败')
    })
  },

  /** 扫码直接登记（管理员开启直接登记模式时） */
  onClaim: function () {
    var self = this
    var seat = this.data.seat
    if (!seat) return
    var user = app.getUser()
    // 已有工位不可再登记其他工位，请先退订
    if (this.data.hasSeat) {
      return util.toast('你已登记工位 ' + this.data.mySeatCode + '，请先退订后再登记')
    }
    wx.showModal({
      title: '确认登记',
      content: '登记后工位 ' + seat.code + ' 归你使用，其他人将无法登记。确定登记吗？',
      confirmText: '确认登记',
      success: function (r) {
        if (!r.confirm) return
        api.claimSeat(seat.id, user).then(function (res) {
          if (!res.ok) return util.toast(res.msg || '登记失败')
          util.toast(res.msg || '登记成功', 'success')
          self.load(seat.id)
        }).catch(function () {
          util.toast('网络异常，登记失败')
        })
      }
    })
  },

  onRelease: function () {
    var self = this
    var seat = this.data.seat
    if (!seat) return
    var user = app.getUser()
    wx.showModal({
      title: '退订工位',
      content: '退订后工位 ' + seat.code + ' 将释放为空闲，其他同学可申请。确定退订吗？',
      confirmText: '确认退订',
      success: function (r) {
        if (!r.confirm) return
        api.releaseSeat(seat.id, user, false).then(function (res) {
          if (!res.ok) return util.toast(res.msg || '退订失败')
          util.toast(res.msg || '已退订', 'success')
          self.load(seat.id)
        })
      }
    })
  },

  /** 管理员：强制释放归属 */
  onAdminRelease: function () {
    var self = this
    var seat = this.data.seat
    var user = app.getUser()
    wx.showModal({
      title: '释放归属',
      content: '确认释放工位 ' + seat.code + ' 的归属？',
      confirmText: '确认释放',
      success: function (r) {
        if (!r.confirm) return
        api.releaseSeat(seat.id, user, true).then(function (res) {
          if (!res.ok) return util.toast(res.msg || '操作失败')
          util.toast('已释放归属', 'success')
          self.load(seat.id)
        })
      }
    })
  },

  /** 管理员：停用 / 恢复 */
  onAdminToggle: function () {
    var self = this
    var seat = this.data.seat
    var user = app.getUser()
    var next = seat.status === 'repair' ? 'free' : 'repair'
    api.adminSetSeatStatus(seat.id, next, user).then(function (res) {
      if (!res.ok) return util.toast(res.msg || '操作失败')
      util.toast(res.msg || '操作成功', 'success')
      self.load(seat.id)
    })
  },

  copyQr: function () {
    wx.setClipboardData({ data: this.data.qrContent })
  },

  goHome: function () {
    wx.redirectTo({ url: '/pages/home/home' })
  }
}))
