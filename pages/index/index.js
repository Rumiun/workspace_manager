var store = require('../../utils/store.js')

Page({
  onLoad: function () {
    var user = store.getCurrentUser()
    var self = this
    setTimeout(function () {
      if (user) {
        wx.redirectTo({ url: '/pages/home/home' })
      } else {
        wx.redirectTo({ url: '/pages/login/login' })
      }
    }, 900)
  }
})
