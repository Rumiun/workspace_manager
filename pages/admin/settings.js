var api = require('../../utils/api.js')
var store = require('../../utils/store.js')
var util = require('../../utils/util.js')
var config = require('../../utils/config.js')
var layout = require('../../utils/layout.js')
var app = getApp()

var MODES = [
  { key: 'approval', name: '审批模式', desc: '学生扫码提交申请，管理员审批通过后归属生效' },
  { key: 'direct', name: '直接登记', desc: '学生扫码即可直接登记归属，无需审批' }
]

Page(layout.wrap({
  data: {
    modes: MODES,
    settings: {},
    termStart: '',
    termEnd: '',
    mode: 'approval',
    qrBase: ''
  },

  onShow: function () {
    var user = app.getUser()
    if (!user) return wx.redirectTo({ url: '/pages/login/login' })
    if (user.role !== 'admin') {
      util.toast('仅管理员可访问')
      return wx.redirectTo({ url: '/pages/home/home' })
    }
    this.load()
  },

  load: function () {
    var self = this
    api.getSettings().then(function (res) {
      var s = res.ok && res.settings ? res.settings : store.getSettings()
      self.setData({
        settings: s,
        termStart: s.termStart,
        termEnd: s.termEnd,
        mode: s.mode || 'approval',
        qrBase: config.QR_BASE
      })
    })
  },

  onStart: function (e) {
    this.setData({ termStart: e.detail.value })
  },

  onEnd: function (e) {
    this.setData({ termEnd: e.detail.value })
  },

  pickMode: function (e) {
    this.setData({ mode: e.currentTarget.dataset.key })
  },

  save: function () {
    var self = this
    wx.showModal({
      title: '保存设置',
      content: '登记模式保存后立即生效；使用期限与登记开放时间请在「登记管理」中设置。',
      success: function (r) {
        if (!r.confirm) return
        api.saveSettings({
          mode: self.data.mode
        }).then(function (res) {
          if (!res.ok) return util.toast(res.msg || '保存失败')
          util.toast('已保存', 'success')
          self.load()
        })
      }
    })
  },

  goOffices: function () {
    wx.navigateTo({ url: '/pages/admin/offices' })
  },

  goStudents: function () {
    wx.navigateTo({ url: '/pages/admin/students' })
  },

  goSeats: function () {
    wx.navigateTo({ url: '/pages/admin/seats' })
  },

  goQr: function () {
    wx.navigateTo({ url: '/pages/admin/qrcode' })
  },

  goRegister: function () {
    wx.navigateTo({ url: '/pages/admin/register' })
  }
}))
