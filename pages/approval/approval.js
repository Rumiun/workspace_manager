var store = require('../../utils/store.js')
var util = require('../../utils/util.js')
var layout = require('../../utils/layout.js')

var STATUS = {
  approved: { text: '已通过', cls: 'success' },
  rejected: { text: '已驳回', cls: 'danger' },
  canceled: { text: '已撤回', cls: '' },
  pending: { text: '待审批', cls: 'warning' }
}

Page(layout.wrap({
  data: {
    tab: 'pending',
    apps: [],
    pendingCount: 0,
    doneCount: 0
  },

  onShow: function () {
    var user = store.getCurrentUser()
    if (!user) return wx.redirectTo({ url: '/pages/login/login' })
    if (user.role !== 'admin') {
      util.toast('仅管理员可访问')
      return wx.redirectTo({ url: '/pages/home/home' })
    }
    this.adminName = user.name
    this.render()
  },

  switchTab: function (e) {
    this.setData({ tab: e.currentTarget.dataset.tab })
    this.render()
  },

  render: function () {
    var tab = this.data.tab
    var all = store.getApps().slice().sort(function (a, b) { return a.applyTime < b.applyTime ? 1 : -1 })
    var pending = all.filter(function (a) { return a.status === 'pending' })
    var done = all.filter(function (a) { return a.status !== 'pending' })
    var list = tab === 'pending' ? pending : done
    var apps = list.map(function (a) {
      var st = STATUS[a.status] || { text: a.status, cls: '' }
      return {
        id: a.id,
        studentName: a.studentName,
        studentId: a.studentId,
        seatCode: a.seatCode,
        zone: a.zone,
        startDate: a.startDate,
        endDate: a.endDate,
        applyTime: a.applyTime,
        reason: a.reason,
        comment: a.comment,
        status: a.status,
        statusText: st.text,
        tagClass: st.cls
      }
    })
    this.setData({ apps: apps, pendingCount: pending.length, doneCount: done.length })
  },

  /** 一键通过：批量同意所有待审批申请并分配工位 */
  approveAll: function () {
    var self = this
    var list = store.getApps().filter(function (a) { return a.status === 'pending' })
    if (!list.length) return util.toast('没有待审批申请')
    wx.showModal({
      title: '一键通过',
      content: '共 ' + list.length + ' 条待审批申请，确认全部通过并分配工位？已被他人登记的工位将自动跳过。',
      confirmText: '全部通过',
      success: function (r) {
        if (!r.confirm) return
        var seats = store.getSeats()
        var ownerMap = {}
        seats.forEach(function (s) { if (s.owner) ownerMap[s.id] = s.owner })
        var pass = 0
        var skipped = []
        list.forEach(function (a) {
          var seatKey = a.seatId || a.seatCode
          var owner = ownerMap[seatKey]
          if (owner && owner !== a.studentId) {
            skipped.push(a.seatCode)
            return
          }
          var res = store.handleApp(a.id, true, self.adminName, '批量审批通过，工位已分配。')
          if (res.ok) {
            pass += 1
            ownerMap[seatKey] = a.studentId
          } else {
            skipped.push(a.seatCode)
          }
        })
        self.render()
        if (!skipped.length) return util.toast('已通过 ' + pass + ' 条', 'success')
        wx.showModal({
          title: '批量审批完成',
          content: '通过 ' + pass + ' 条，跳过 ' + skipped.length + ' 条（工位不可用）：' + skipped.join('、'),
          showCancel: false,
          confirmText: '知道了'
        })
      }
    })
  },

  approve: function (e) {
    var self = this
    var id = e.currentTarget.dataset.id
    wx.showModal({
      title: '同意申请',
      content: '确认同意该工位申请并分配工位？',
      confirmColor: '#2f6bff',
      success: function (res) {
        if (!res.confirm) return
        var r = store.handleApp(id, true, self.adminName, '符合工位分配条件，予以通过。')
        if (!r.ok) return util.toast(r.msg)
        util.toast('已通过并分配工位', 'success')
        self.render()
      }
    })
  },

  reject: function (e) {
    var self = this
    var id = e.currentTarget.dataset.id
    wx.showModal({
      title: '驳回申请',
      content: '请填写驳回理由',
      editable: true,
      placeholderText: '如：该工位已分配给其他同学',
      confirmColor: '#f04438',
      success: function (res) {
        if (!res.confirm) return
        var r = store.handleApp(id, false, self.adminName, res.content || '不符合当前工位分配条件。')
        if (!r.ok) return util.toast(r.msg)
        util.toast('已驳回', 'success')
        self.render()
      }
    })
  }
}))
