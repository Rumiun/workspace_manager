var api = require('../../utils/api.js')
var store = require('../../utils/store.js')
var util = require('../../utils/util.js')
var layout = require('../../utils/layout.js')
var app = getApp()

function emptyBatch() {
  return {
    id: 'bt_' + Date.now() + Math.floor(Math.random() * 1000),
    name: '新批次',
    registerStart: util.formatDate(),
    registerEnd: util.offsetDay(7),
    termStart: util.formatDate(),
    termEnd: util.offsetDay(180)
  }
}

Page(layout.wrap({
  data: {
    settings: {
      registerOpen: true,
      registerStart: '',
      registerEnd: '',
      termStart: '',
      termEnd: ''
    },
    batches: [],
    register: { open: true, text: '登记开放中', reason: 'open', today: '' },
    termText: ''
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
      var s = res && res.ok && res.settings ? res.settings : store.getSettings()
      var register = (res && res.register) || store.registerState()
      var term = (res && res.term) || store.currentTerm()
      self.setData({
        settings: {
          registerOpen: s.registerOpen !== false,
          registerStart: s.registerStart || '',
          registerEnd: s.registerEnd || '',
          termStart: s.termStart || '',
          termEnd: s.termEnd || ''
        },
        batches: s.batches || [],
        register: register,
        termText: term.termStart + ' 至 ' + term.termEnd + (term.batchName ? '（' + term.batchName + '）' : '')
      })
    })
  },

  /** 手动开关：关闭时立即停止登记 */
  toggleOpen: function () {
    var next = !this.data.settings.registerOpen
    var patch = { registerOpen: next }
    this.setData({ settings: Object.assign({}, this.data.settings, patch) })
    this.save(next ? '已开放登记' : '已关闭登记')
  },

  onDate: function (e) {
    var field = e.currentTarget.dataset.field
    var settings = Object.assign({}, this.data.settings)
    // 清空：允许传空字符串
    settings[field] = e.detail.value || ''
    this.setData({ settings: settings })
  },

  clearRange: function () {
    var settings = Object.assign({}, this.data.settings)
    settings.registerStart = ''
    settings.registerEnd = ''
    this.setData({ settings: settings })
    this.save('已清除登记开放时间（改为长期开放）')
  },

  addBatch: function () {
    var batches = this.data.batches.slice()
    batches.push(emptyBatch())
    this.setData({ batches: batches })
  },

  onBatchName: function (e) {
    var i = e.currentTarget.dataset.index
    var batches = this.data.batches.slice()
    var b = Object.assign({}, batches[i])
    b.name = e.detail.value
    batches[i] = b
    this.setData({ batches: batches })
  },

  onBatchDate: function (e) {
    var i = e.currentTarget.dataset.index
    var key = e.currentTarget.dataset.key
    var batches = this.data.batches.slice()
    var b = Object.assign({}, batches[i])
    b[key] = e.detail.value || ''
    batches[i] = b
    this.setData({ batches: batches })
  },

  removeBatch: function (e) {
    var self = this
    var i = e.currentTarget.dataset.index
    var name = (this.data.batches[i] || {}).name || '该批次'
    wx.showModal({
      title: '删除批次',
      content: '确定删除「' + name + '」吗？已按该批次登记的工位不受影响。',
      confirmColor: '#f04438',
      success: function (r) {
        if (!r.confirm) return
        var batches = self.data.batches.slice()
        batches.splice(i, 1)
        self.setData({ batches: batches })
        self.save('已删除批次')
      }
    })
  },

  save: function (tip) {
    var self = this
    var s = this.data.settings
    if (s.registerStart && s.registerEnd && s.registerStart > s.registerEnd) {
      return util.toast('登记结束时间需晚于开始时间')
    }
    if (s.termStart >= s.termEnd) return util.toast('使用期限截止日期需晚于起始日期')
    var batches = this.data.batches
    for (var i = 0; i < batches.length; i++) {
      var b = batches[i]
      if (!b.name.trim()) return util.toast('请填写批次名称')
      if (b.registerStart && b.registerEnd && b.registerStart > b.registerEnd) {
        return util.toast('批次「' + b.name + '」的登记时间有误')
      }
      if (b.termStart && b.termEnd && b.termStart >= b.termEnd) {
        return util.toast('批次「' + b.name + '」的使用期限有误')
      }
    }
    api.saveSettings({
      termStart: s.termStart,
      termEnd: s.termEnd,
      registerOpen: s.registerOpen,
      registerStart: s.registerStart,
      registerEnd: s.registerEnd,
      batches: batches
    }).then(function (res) {
      if (!res.ok) return util.toast(res.msg || '保存失败')
      util.toast(tip || '已保存', 'success')
      self.load()
    }).catch(function () {
      util.toast('网络异常，保存失败')
    })
  },

  onSave: function () {
    var self = this
    wx.showModal({
      title: '保存登记设置',
      content: '新的登记开放时间与使用期限将对之后提交的申请/登记生效，已登记工位不受影响。',
      success: function (r) {
        if (r.confirm) self.save('已保存')
      }
    })
  },

  resetData: function () {
    var self = this
    wx.showModal({
      title: '重置演示数据',
      content: '将清空本地工位、申请、签到数据并重新生成演示数据，确定继续？',
      confirmColor: '#f04438',
      success: function (res) {
        if (!res.confirm) return
        store.resetAll()
        util.toast('已重置', 'success')
        self.load()
      }
    })
  }
}))
