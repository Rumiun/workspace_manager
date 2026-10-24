var util = require('../../utils/util.js')
var store = require('../../utils/store.js')
var layout = require('../../utils/layout.js')
var app = getApp()

Page(layout.wrap({
  data: {
    user: {},
    isAdmin: false
  },

  onShow: function () {
    var user = app.getUser()
    if (!user) return wx.redirectTo({ url: '/pages/login/login' })
    this.setData({ user: user, isAdmin: user.role === 'admin' })
  },

  goRegister: function () {
    wx.navigateTo({ url: '/pages/register/register' })
  },

  logout: function () {
    wx.showModal({
      title: '退出登录',
      content: '确定退出当前账号吗？',
      success: function (r) {
        if (!r.confirm) return
        store.logout()
        app.clearUser()
        wx.reLaunch({ url: '/pages/login/login' })
      }
    })
  }
}))
