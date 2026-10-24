var store = require('../../utils/store.js')
var util = require('../../utils/util.js')

var app = getApp()

Page({
  data: {
    role: 'student',
    account: '2023001',
    password: '123456',
    redirect: ''
  },
  onLoad: function (options) {
    if (options && options.redirect) {
      this.setData({ redirect: decodeURIComponent(options.redirect) })
    }
  },
  switchRole: function (e) {
    this.setData({ role: e.currentTarget.dataset.role })
  },
  onAccount: function (e) {
    this.setData({ account: e.detail.value })
  },
  onPassword: function (e) {
    this.setData({ password: e.detail.value })
  },
  fillDemo: function (e) {
    this.setData({
      account: e.currentTarget.dataset.account,
      password: '123456',
      role: e.currentTarget.dataset.role
    })
  },
  doLogin: function () {
    if (!this.data.account) return util.toast('请输入账号')
    if (!this.data.password) return util.toast('请输入密码')
    var res = store.login(this.data.account.trim(), this.data.password, this.data.role)
    if (!res.ok) return util.toast(res.msg)
    app.setUser(res.user)
    util.toast('登录成功', 'success')
    if (this.data.redirect) return wx.redirectTo({ url: this.data.redirect })
    wx.redirectTo({ url: '/pages/home/home' })
  }
})
