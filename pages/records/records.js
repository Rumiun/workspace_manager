var store = require('../../utils/store.js')
var api = require('../../utils/api.js')
var sync = require('../../utils/sync.js')
var util = require('../../utils/util.js')
var layout = require('../../utils/layout.js')

var STATUS = {
  pending: { text: '待审批', cls: 'warning' },
  approved: { text: '已通过', cls: 'success' },
  rejected: { text: '已驳回', cls: 'danger' },
  canceled: { text: '已撤回', cls: '' }
}

Page(layout.wrap({
  data: {
    tabs: [
      { key: 'all', label: '全部' },
      { key: 'pending', label: '待审批' },
      { key: 'approved', label: '已通过' },
      { key: 'rejected', label: '已驳回' }
    ],
    tab: 'all',
    apps: []
  },

  onLoad: function (options) {
    var user = store.getCurrentUser()
    if (!user) return wx.redirectTo({ url: '/pages/login/login' })
    this.userId = user.id
    var tab = options && options.tab ? options.tab : 'all'
    if (['all', 'pending', 'approved', 'rejected'].indexOf(tab) < 0) tab = 'all'
    this.setData({ tab: tab })
    this.render()
  },

  switchTab: function (e) {
    this.setData({ tab: e.currentTarget.dataset.tab })
    this.render()
  },

  render: function () {
    var tab = this.data.tab
    var list = store.getMyApps(this.userId).filter(function (a) {
      return tab === 'all' || a.status === tab
    })
    var apps = list.map(function (a) {
      var st = STATUS[a.status] || { text: a.status, cls: '' }
      return {
        id: a.id,
        seatCode: a.seatCode,
        status: a.status,
        statusText: st.text,
        tagClass: st.cls,
        applyTime: a.applyTime,
        startDate: a.startDate,
        endDate: a.endDate,
        handler: a.handler,
        handleTime: a.handleTime,
        comment: a.comment,
        reason: a.reason
      }
    })
    this.setData({ apps: apps })
  },

  cancelApp: function (e) {
    var self = this
    wx.showModal({
      title: '撤回申请',
      content: '确定撤回该工位申请吗？',
      confirmColor: '#f04438',
      success: function (res) {
        if (!res.confirm) return
        wx.showLoading({ title: '提交中…' })
        api.cancelApp(e.currentTarget.dataset.id, store.getCurrentUser()).then(function (r) {
          wx.hideLoading()
          if (!r || !r.ok) return util.toast((r && r.msg) || '撤回失败')
          util.toast('已撤回', 'success')
          // 服务端为准：撤回后以服务端最新申请列表重渲染
          sync.refresh().then(function () { self.render() })
        })
      }
    })
  }
}))
