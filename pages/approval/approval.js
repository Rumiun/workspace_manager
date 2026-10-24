var store = require('../../utils/store.js')
var api = require('../../utils/api.js')
var sync = require('../../utils/sync.js')
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
    this.user = user
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
        // 先按服务端已归属的工位排掉冲突项，剩下的串行提交
        var seats = store.getSeats()
        var ownerMap = {}
        seats.forEach(function (s) { if (s.owner) ownerMap[s.id] = s.owner })
        var queue = []
        list.forEach(function (a) {
          var seatKey = a.seatId || a.seatCode
          var owner = ownerMap[seatKey]
          if (owner && owner !== a.studentId) {
            return
          }
          queue.push(a)
          ownerMap[seatKey] = a.studentId
        })
        if (!queue.length) return util.toast('没有可审批的申请')

        wx.showLoading({ title: '处理中…' })
        var pass = 0
        var skipped = []
        // 串行提交：每条都等服务端返回，避免并发把同一个工位分配给两个人
        var step = function (i) {
          if (i >= queue.length) {
            wx.hideLoading()
            // 服务端为准：审批结果以服务端最新数据重渲染
            sync.refresh().then(function () { self.render() })
            if (!skipped.length) return util.toast('已通过 ' + pass + ' 条', 'success')
            wx.showModal({
              title: '批量审批完成',
              content: '通过 ' + pass + ' 条，跳过 ' + skipped.length + ' 条（工位不可用）：' + skipped.join('、'),
              showCancel: false,
              confirmText: '知道了'
            })
            return
          }
          api.handleApp(queue[i].id, true, self.user, '批量审批通过，工位已分配。').then(function (res) {
            if (res && res.ok) pass += 1
            else skipped.push(queue[i].seatCode)
            step(i + 1)
          })
        }
        step(0)
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
        wx.showLoading({ title: '提交中…' })
        api.handleApp(id, true, self.user, '符合工位分配条件，予以通过。').then(function (res) {
          wx.hideLoading()
          if (!res || !res.ok) return util.toast((res && res.msg) || '操作失败')
          util.toast('已通过并分配工位', 'success')
          sync.refresh().then(function () { self.render() })
        })
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
        wx.showLoading({ title: '提交中…' })
        api.handleApp(id, false, self.user, res.content || '不符合当前工位分配条件。').then(function (r) {
          wx.hideLoading()
          if (!r || !r.ok) return util.toast((r && r.msg) || '操作失败')
          util.toast('已驳回', 'success')
          sync.refresh().then(function () { self.render() })
        })
      }
    })
  }
}))
