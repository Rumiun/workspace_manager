/**
 * 工位地图编辑器（自定义布局）
 * 流程：上传办公室照片 → 点击画布空白处放置工位 → 拖动微调 → 保存（自动生成/对齐工位与二维码）
 * 坐标以百分比存储（0-100），换设备、换屏幕宽高都不会错位。
 */
var api = require('../../utils/api.js')
var store = require('../../utils/store.js')
var util = require('../../utils/util.js')
var layout = require('../../utils/layout.js')
var app = getApp()

var MAX_SEATS = 200
var EDGE = 2.5      // 距离边缘最小百分比，避免工位按钮被裁掉

var keySeq = 0
function nextKey() {
  keySeq += 1
  return 'pt' + keySeq
}

function clampPct(v) {
  var n = Number(v)
  if (!isFinite(n)) return 50
  if (n < EDGE) return EDGE
  if (n > 100 - EDGE) return 100 - EDGE
  return Math.round(n * 100) / 100
}

Page(layout.wrap({
  data: {
    officeId: '',
    officeName: '',
    officePrefix: '',
    // image：渲染用的地址（可能是下载到本地的缓存文件）
    image: '',
    // imageRemote：保存到服务端的地址（上传到云端的 http 地址）
    imageRemote: '',
    points: [],
    selected: -1,
    batchCount: 5,
    dirty: false,
    saving: false,
    uploading: false,
    cloud: false,
    imageName: '',
    // 数据来源：server = 服务端下载，local = 本机缓存（服务端不可用时的回落）
    source: '',
    loading: false
  },

  onLoad: function (options) {
    this.setData({ officeId: (options && options.officeId) || '' })
  },

  onShow: function () {
    var user = app.getUser()
    if (!user) return wx.redirectTo({ url: '/pages/login/login' })
    if (user.role !== 'admin') {
      util.toast('仅管理员可访问')
      return wx.redirectTo({ url: '/pages/home/home' })
    }
    // 只加载一次：从相册 / 相机返回时不覆盖正在编辑的内容
    if (this.loaded) {
      this.measure()
      return
    }
    this.load()
  },

  /** 忽略本机内容，重新从服务端拉取地图与点位 */
  reloadFromServer: function () {
    if (this.data.loading) return
    if (this.data.dirty) {
      var self = this
      return wx.showModal({
        title: '重新拉取服务端数据',
        content: '当前有未保存的修改，重新加载会丢失，确定继续吗？',
        success: function (r) {
          if (!r.confirm) return
          self.data.dirty = false
          self.loaded = false
          self.load()
        }
      })
    }
    this.loaded = false
    this.load()
  },

  load: function () {
    var self = this
    if (!this.data.officeId) return util.toast('缺少办公室参数')
    this.setData({ loading: true })
    api.getOfficeMap(this.data.officeId).then(function (res) {
      if (!res || res.ok === false) {
        self.setData({ loading: false })
        return util.toast((res && res.msg) || '工位地图加载失败')
      }
      self.loaded = true
      // 点位保留 seatId / 编号 / 归属：保存时要原样回传，服务端才能沿用已有工位与二维码
      var points = (res.points || []).map(function (p) {
        return {
          k: nextKey(),
          seatId: p.seatId || '',
          code: p.code || '',
          no: p.no || '',
          owner: p.owner || '',
          status: p.status || 'free',
          x: clampPct(p.x),
          y: clampPct(p.y)
        }
      })
      var remote = res.image || ''
      self.setData({
        officeName: res.office ? res.office.name : '',
        officePrefix: res.office ? res.office.prefix : '',
        imageRemote: remote,
        imageName: remote ? String(remote).split('/').pop() : '',
        cloud: api.isCloudImage(remote),
        points: points,
        selected: points.length ? 0 : -1,
        source: res.source || 'server',
        loading: false
      })
      self.measure()
      // 照片从服务端下载到本地缓存后再渲染，避免 http 直连被域名 / 证书校验挡住
      if (remote) {
        api.downloadMapImage(remote).then(function (img) {
          if (img) self.setData({ image: img })
          self.measure()
        })
      } else {
        self.setData({ image: '' })
      }
      if (res.source === 'local') util.toast('服务端不可用，当前显示的是本机缓存')
    }).catch(function () {
      self.setData({ loading: false })
      util.toast('工位地图加载失败')
    })
  },

  /* ---------------- 画布测量与坐标换算 ---------------- */
  measure: function () {
    var self = this
    wx.createSelectorQuery().select('#mapCanvas').boundingClientRect(function (rect) {
      if (rect && rect.width) self.rect = rect
    }).exec()
  },

  posFromTouch: function (clientX, clientY) {
    var r = this.rect
    if (!r || !r.width || !r.height) return null
    return {
      x: clampPct(((clientX - r.left) / r.width) * 100),
      y: clampPct(((clientY - r.top) / r.height) * 100)
    }
  },

  onImgLoad: function () {
    // 图片加载后画布高度才确定，重新测量
    this.measure()
  },

  /* ---------------- 放置 / 拖动 / 选择 ---------------- */
  onCanvasTap: function (e) {
    var points = this.data.points
    if (points.length >= MAX_SEATS) return util.toast('单个办公室最多 ' + MAX_SEATS + ' 个工位')
    var p = this.posFromTouch(e.detail.x, e.detail.y)
    if (!p) {
      this.measure()
      return util.toast('画布尚未就绪，请再点一次')
    }
    this.setData({
      points: points.concat([{ k: nextKey(), x: p.x, y: p.y }]),
      selected: points.length,
      dirty: true
    })
  },

  onPointTap: function (e) {
    this.setData({ selected: Number(e.currentTarget.dataset.index) })
  },

  onPointMove: function (e) {
    var index = Number(e.currentTarget.dataset.index)
    var t = e.touches && e.touches[0]
    if (!t || isNaN(index)) return
    var p = this.posFromTouch(t.clientX, t.clientY)
    if (!p) return this.measure()
    var patch = { selected: index, dirty: true }
    patch['points[' + index + '].x'] = p.x
    patch['points[' + index + '].y'] = p.y
    this.setData(patch)
  },

  /* ---------------- 背景图：拍照 / 从相册选择 → 上传云端 ---------------- */
  takePhoto: function () {
    this.pickImage(['camera'])
  },

  chooseFromAlbum: function () {
    this.pickImage(['album'])
  },

  pickImage: function (sourceType) {
    var self = this
    if (this.data.uploading) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: sourceType,
      success: function (res) {
        var file = res.tempFiles && res.tempFiles[0]
        if (!file) return
        self.uploadMapImage(file.tempFilePath)
      }
    })
  },

  /** 上传到服务端保存并返回图片 URL；失败自动回退本机，并如实标注来源 */
  uploadMapImage: function (tempPath) {
    var self = this
    this.setData({ uploading: true })
    api.uploadSeatImage(tempPath).then(function (r) {
      self.setData({ uploading: false })
      if (!r || r.ok === false) return util.toast((r && r.msg) || '上传失败')
      var remote = r.path || ''
      self.setData({
        imageRemote: remote,
        imageName: String(remote).split('/').pop(),
        cloud: !!r.cloud,
        dirty: true,
        source: r.cloud ? 'server' : 'local'
      })
      // 渲染优先用本地缓存文件
      api.downloadMapImage(remote).then(function (img) {
        self.setData({ image: img || remote })
        setTimeout(function () { self.measure() }, 80)
      })
      util.toast(r.cloud ? '照片已保存到服务端' : (r.msg || '照片已保存到本机'), 'success')
    }).catch(function () {
      self.setData({ uploading: false })
      util.toast('上传失败，请检查网络或服务端是否启动')
    })
  },

  removeImage: function () {
    var self = this
    wx.showModal({
      title: '移除背景图',
      content: '仅移除照片，已放置的工位会保留。',
      success: function (r) {
        if (!r.confirm) return
        self.setData({ image: '', imageRemote: '', imageName: '', cloud: false, dirty: true })
      }
    })
  },

  /**
   * 保存前确保照片已经在服务端：
   * 本机路径说明当时服务端不可用，这里补一次上传，避免「地图点位存到服务端、照片却只在本机」。
   */
  ensureRemoteImage: function (done) {
    var remote = this.data.imageRemote
    if (!remote) return util.toast('请先上传办公室照片')
    if (api.isCloudImage(remote)) return done()
    var self = this
    this.setData({ uploading: true })
    api.uploadSeatImage(remote).then(function (r) {
      self.setData({ uploading: false })
      if (!r || r.ok === false) return util.toast((r && r.msg) || '照片上传失败')
      self.setData({ imageRemote: r.path, cloud: !!r.cloud, source: r.cloud ? 'server' : 'local' })
      if (!r.cloud) return util.toast('服务端不可用，照片只保存在本机')
      done()
    }).catch(function () {
      self.setData({ uploading: false })
      util.toast('照片上传失败，请检查服务端是否启动')
    })
  },

  /* ---------------- 批量操作 ---------------- */
  onBatchInput: function (e) {
    this.setData({ batchCount: parseInt(e.detail.value, 10) || 0 })
  },

  batchAdd: function () {
    var n = parseInt(this.data.batchCount, 10) || 0
    if (n <= 0) return util.toast('请输入要添加的工位数量')
    var points = this.data.points
    if (points.length + n > MAX_SEATS) return util.toast('单个办公室最多 ' + MAX_SEATS + ' 个工位')
    // 按 5 列网格自动铺开，随后可逐个拖动到实际位置
    var total = points.length + n
    var cols = 5
    var rows = Math.max(1, Math.ceil(total / cols))
    var list = points.slice()
    for (var i = points.length; i < total; i++) {
      var r = Math.floor(i / cols)
      var c = i % cols
      list.push({
        k: nextKey(),
        x: clampPct(((c + 0.5) / cols) * 100),
        y: clampPct(((r + 0.5) / rows) * 100)
      })
    }
    this.setData({ points: list, selected: list.length - 1, dirty: true })
  },

  removeSelected: function () {
    var index = this.data.selected
    if (index < 0 || index >= this.data.points.length) return util.toast('请先点击选中一个工位')
    var list = this.data.points.slice()
    list.splice(index, 1)
    this.setData({ points: list, selected: list.length ? Math.min(index, list.length - 1) : -1, dirty: true })
  },

  clearAll: function () {
    var self = this
    if (!this.data.points.length) return util.toast('当前没有工位')
    wx.showModal({
      title: '清空所有工位',
      content: '将移除画布上的全部工位（保存后才生效）。',
      confirmColor: '#f04438',
      success: function (r) {
        if (!r.confirm) return
        self.setData({ points: [], selected: -1, dirty: true })
      }
    })
  },

  /* ---------------- 保存 ---------------- */
  save: function () {
    var self = this
    if (this.data.saving) return
    if (!this.data.points.length) return util.toast('请先在画布上放置工位')
    // 先把照片补传到服务端（本机路径时），成功后连同点位一起保存
    this.ensureRemoteImage(function () {
      self.setData({ saving: true })
      api.saveOfficeMap(self.data.officeId, {
        image: self.data.imageRemote,
        points: self.data.points.map(function (p) {
          return { seatId: p.seatId, x: p.x, y: p.y }
        })
      }).then(function (res) {
        self.setData({ saving: false })
        if (!res || res.ok === false) return util.toast((res && res.msg) || '保存失败')
        self.data.dirty = false
        self.setData({
          source: res.source || 'server',
          imageRemote: res.image || self.data.imageRemote
        })
        util.toast(res.source === 'server'
          ? '已保存到服务端 ' + res.count + ' 个工位'
          : (res.msg || '已保存 ' + res.count + ' 个工位（本机）'), res.source === 'server' ? 'success' : 'none')
        setTimeout(function () {
          wx.navigateBack({
            fail: function () { wx.redirectTo({ url: '/pages/admin/offices' }) }
          })
        }, 600)
      }).catch(function () {
        self.setData({ saving: false })
        util.toast('保存失败，请检查网络')
      })
    })
  },

  goBack: function () {
    var self = this
    if (!this.data.dirty) {
      return wx.navigateBack({ fail: function () { wx.redirectTo({ url: '/pages/admin/offices' }) } })
    }
    wx.showModal({
      title: '放弃修改',
      content: '工位布局尚未保存，确定离开吗？',
      success: function (r) {
        if (!r.confirm) return
        self.data.dirty = false
        wx.navigateBack({ fail: function () { wx.redirectTo({ url: '/pages/admin/offices' }) } })
      }
    })
  }
}))
