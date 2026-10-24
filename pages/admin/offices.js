var api = require('../../utils/api.js')
var store = require('../../utils/store.js')
var util = require('../../utils/util.js')
var layout = require('../../utils/layout.js')
var app = getApp()

Page(layout.wrap({
  data: {
    offices: [],
    form: { name: '', building: '', prefix: '', rows: 4, cols: 5, mapMode: 'grid' },
    totalSeats: 0
  },

  onShow: function () {
    var user = app.getUser()
    if (!user) return wx.redirectTo({ url: '/pages/login/login' })
    if (user.role !== 'admin') {
      util.toast('仅管理员可访问')
      return wx.redirectTo({ url: '/pages/home/home' })
    }
    this.drafts = {}
    this.load()
  },

  load: function () {
    var self = this
    api.getOffices().then(function (res) {
      var offices = (res.ok && res.list ? res.list : []).map(function (o) {
        return {
          id: o.id, name: o.name, building: o.building || '', prefix: o.prefix,
          rows: o.rows, cols: o.cols, seats: o.rows * o.cols, used: 0,
          mapMode: o.mapMode === 'custom' ? 'custom' : 'grid',
          mapImage: o.mapImage || '',
          mapPoints: (o.mapPoints || []).length
        }
      })
      self.offices = offices
      return api.adminSeats({}, app.getUser())
    }).then(function (res) {
      var map = {}
      if (res && res.ok && res.list) {
        res.list.forEach(function (s) {
          map[s.officeId] = map[s.officeId] || { total: 0, used: 0 }
          map[s.officeId].total += 1
          if (s.status === 'used') map[s.officeId].used += 1
        })
      }
      var offices = self.offices.map(function (o) {
        var info = map[o.id] || { total: 0, used: 0 }
        return Object.assign({}, o, { total: info.total, used: info.used })
      })
      self.setData({
        offices: offices,
        totalSeats: offices.reduce(function (sum, o) { return sum + o.total }, 0)
      })
    }).catch(function () {
      util.toast('办公室数据加载失败')
    })
  },

  /** 新增表单：选择布局方式（标准网格 / 自定义地图） */
  onModePick: function (e) {
    var form = Object.assign({}, this.data.form)
    form.mapMode = e.currentTarget.dataset.mode === 'custom' ? 'custom' : 'grid'
    this.setData({ form: form })
  },

  onFormInput: function (e) {
    var field = e.currentTarget.dataset.field
    var value = e.detail.value
    var form = Object.assign({}, this.data.form)
    form[field] = (field === 'rows' || field === 'cols') ? parseInt(value, 10) || 0 : value
    this.setData({ form: form })
  },

  addOffice: function () {
    var self = this
    var form = this.data.form
    if (!form.name.trim()) return util.toast('请填写办公室名称')
    if (!form.prefix.trim()) return util.toast('请填写编号前缀')
    if (form.mapMode !== 'custom') {
      if (!form.rows || !form.cols) return util.toast('行数与列数需大于 0')
      if (form.rows * form.cols > 200) return util.toast('单个办公室工位数过多')
    }
    var custom = form.mapMode === 'custom'
    api.addOffice({
      name: form.name.trim(),
      building: form.building.trim(),
      prefix: form.prefix.trim(),
      rows: form.rows || 1,
      cols: form.cols || 1,
      mapMode: custom ? 'custom' : 'grid'
    }).then(function (res) {
      if (!res.ok) return util.toast(res.msg || '添加失败')
      self.setData({ form: { name: '', building: '', prefix: '', rows: 4, cols: 5, mapMode: 'grid' } })
      if (custom && res.office && res.office.id) {
        // 自定义布局：直接进地图编辑器上传照片并放置工位
        util.toast('已添加办公室，请上传照片并放置工位', 'success')
        self.load()
        wx.navigateTo({ url: '/pages/admin/map?officeId=' + res.office.id })
        return
      }
      util.toast('已添加 ' + (res.seats && res.seats.count ? res.seats.count : 0) + ' 个工位', 'success')
      self.load()
    })
  },

  onOfficeInput: function (e) {
    var id = e.currentTarget.dataset.id
    var field = e.currentTarget.dataset.field
    var value = e.detail.value
    this.drafts[id] = this.drafts[id] || {}
    this.drafts[id][field] = (field === 'rows' || field === 'cols') ? parseInt(value, 10) || 0 : value
  },

  saveOffice: function (e) {
    var self = this
    var id = e.currentTarget.dataset.id
    var patch = this.drafts[id] || {}
    if (!Object.keys(patch).length) return util.toast('未修改内容')
    if (patch.prefix !== undefined && !patch.prefix.trim()) return util.toast('编号前缀不能为空')
    if ((patch.rows !== undefined && !patch.rows) || (patch.cols !== undefined && !patch.cols)) {
      return util.toast('行数与列数需大于 0')
    }
    api.updateOffice(id, patch).then(function (res) {
      if (!res.ok) return util.toast(res.msg || '保存失败')
      if (res.seats && res.seats.ok === false) return util.toast(res.seats.msg)
      util.toast('已保存', 'success')
      self.drafts[id] = null
      self.load()
    })
  },

  removeOffice: function (e) {
    var self = this
    var id = e.currentTarget.dataset.id
    var name = e.currentTarget.dataset.name
    wx.showModal({
      title: '删除办公室',
      content: '确认删除「' + name + '」？该办公室下的空闲工位将一并删除（二维码随之作废），已登记工位需先释放。',
      confirmColor: '#f04438',
      success: function (r) {
        if (!r.confirm) return
        api.removeOffice(id).then(function (res) {
          if (!res.ok) return util.toast(res.msg || '删除失败')
          util.toast('已删除', 'success')
          self.load()
        })
      }
    })
  },

  viewSeats: function (e) {
    wx.navigateTo({ url: '/pages/admin/seats?officeId=' + e.currentTarget.dataset.id })
  },

  /** 已有办公室：进入工位地图编辑器 */
  editMap: function (e) {
    wx.navigateTo({ url: '/pages/admin/map?officeId=' + e.currentTarget.dataset.id })
  },

  /**
   * 切换布局方式
   * - 自定义地图：先按当前行列生成一份默认点位，再打开编辑器
   * - 标准网格：清空点位，恢复 行数 × 列数
   */
  switchMapMode: function (e) {
    var self = this
    var id = e.currentTarget.dataset.id
    var mode = e.currentTarget.dataset.mode === 'custom' ? 'custom' : 'grid'
    var current = (this.data.offices.filter(function (o) { return o.id === id })[0] || {}).mapMode
    if (current === mode) {
      return mode === 'custom' ? this.editMap(e) : util.toast('当前已是标准网格布局')
    }
    var go = function () {
      api.setOfficeMapMode(id, mode).then(function (res) {
        if (!res || res.ok === false) return util.toast((res && res.msg) || '切换失败')
        if (mode === 'custom') {
          util.toast('已生成默认点位，请在地图中调整', 'success')
          self.load()
          wx.navigateTo({ url: '/pages/admin/map?officeId=' + id })
        } else {
          util.toast('已切换为标准网格布局', 'success')
          self.load()
        }
      })
    }
    if (mode !== 'custom') {
      return wx.showModal({
        title: '切换为标准网格',
        content: '自定义地图的点位将被清除，工位数恢复为 行数 × 列数。',
        confirmColor: '#f04438',
        success: function (r) { if (r.confirm) go() }
      })
    }
    go()
  },

  goQrExport: function () {
    wx.navigateTo({ url: '/pages/admin/qrcode' })
  }
}))
