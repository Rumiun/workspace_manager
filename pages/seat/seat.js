var store = require('../../utils/store.js')
var api = require('../../utils/api.js')
var util = require('../../utils/util.js')
var layout = require('../../utils/layout.js')

var STATUS_TEXT = { free: '空闲', used: '已占用', repair: '维修中' }
var TAG_CLASS = { free: 'success', used: '', repair: 'danger' }

/** 点位 → 可渲染的座位标记（服务端数据与本机缓存共用同一套规则） */
function buildPoints(points, hit, userId, keyword) {
  var list = []
  ;(points || []).forEach(function (p, i) {
    if (hit && p.seatId && !hit[p.seatId]) return
    var type = 'used'
    if (p.status === 'repair') type = 'repair'
    else if (p.status === 'free') type = 'free'
    else if (p.owner === userId) type = 'mine'
    var text = (p.code || '') + ' ' + (p.no || '')
    if (keyword && text.toUpperCase().indexOf(keyword) === -1) return
    list.push({ code: p.code, label: p.no || (i + 1), type: type, x: p.x, y: p.y })
  })
  return list
}

Page(layout.wrap({
  data: {
    zones: [],
    zoneTabs: [],
    currentZone: 'ALL',
    keyword: '',
    detail: null,
    isAdmin: false,
    userId: ''
  },

  onShow: function () {
    var user = store.getCurrentUser()
    if (!user) return wx.redirectTo({ url: '/pages/login/login' })
    this.user = user
    this.setData({ userId: user.id, isAdmin: user.role === 'admin', detail: null })
    this.buildTabs()
    this.render()
  },

  buildTabs: function () {
    var tabs = [{ key: 'ALL', label: '全部区域' }]
    store.getZones().forEach(function (z) {
      tabs.push({ key: z.key, label: z.key + ' 区' })
    })
    this.setData({ zoneTabs: tabs })
  },

  render: function () {
    var self = this
    var keyword = (this.data.keyword || '').trim().toUpperCase()
    var currentZone = this.data.currentZone
    var userId = this.data.userId
    var zones = []
    // 需要向服务端核对地图的区域（先用本机数据立即渲染，避免白屏，再用服务端结果覆盖）
    this.pendingMaps = []

    store.getZones().forEach(function (z) {
      if (currentZone !== 'ALL' && currentZone !== z.key) return
      var seats = store.getSeats().filter(function (s) { return s.zone === z.key })
      if (keyword) {
        seats = seats.filter(function (s) {
          return s.code.indexOf(keyword) > -1 || String(s.no || '').indexOf(keyword) > -1
        })
        if (!seats.length) return
      }

      // 自定义布局：按上传的照片 + 百分比点位渲染
      // 先按本地区域信息立即渲染，再异步从服务端拉取最新地图与点位（服务端为准）
      if (z.mapMode === 'custom' && z.mapImage) {
        var hit = {}
        seats.forEach(function (s) { hit[s.id] = true })
        var info = store.getOfficeMap(z.officeId)
        zones.push({
          key: z.key,
          name: z.name,
          map: { image: z.mapImage, points: buildPoints(info.ok ? info.points : [], hit, userId, keyword) },
          total: 0,
          freeCount: 0
        })
        self.pendingMaps.push({ zone: z, hit: hit, userId: userId, keyword: keyword })
        return
      }

      // 标准网格也登记一下：服务端若已经是自定义布局（照片 + 点位），等下会整体替换为地图视图
      self.pendingMaps.push({ zone: z, hit: {}, userId: userId, keyword: keyword })

      var rows = []
      for (var r = 1; r <= z.rows; r++) {
        var row = seats.filter(function (s) { return s.row === r }).sort(function (a, b) { return a.col - b.col })
        if (!row.length) continue
        rows.push({
          key: z.key + '-r' + r,
          list: row.map(function (s) {
            var type = 'used'
            if (s.status === 'repair') type = 'repair'
            else if (s.status === 'free') type = 'free'
            else if (s.owner === userId) type = 'mine'
            return {
              id: s.id,
              code: s.code,
              label: s.no || s.col,
              type: type
            }
          })
        })
      }
      if (!rows.length) return
      var freeCount = seats.filter(function (s) { return s.status === 'free' }).length
      zones.push({ key: z.key, name: z.name, rows: rows, total: seats.length, freeCount: freeCount })
    })

    this.setData({ zones: zones })
    this.syncMapsFromServer()
  },

  /**
   * 自定义布局：地图照片 + 点位一律以服务端为准。
   * 本地数据已经先渲染出来（保证不白屏），这里再拉服务端的最新版本覆盖，
   * 并把照片下载到本地缓存后再交给 <image> 渲染。
   */
  syncMapsFromServer: function () {
    var self = this
    var pending = this.pendingMaps || []
    if (!pending.length) return
    this.pendingMaps = []
    pending.forEach(function (item) {
      api.getOfficeMap(item.zone.officeId).then(function (res) {
        if (!res || res.ok === false) return
        var zones = self.data.zones || []
        var index = -1
        for (var i = 0; i < zones.length; i++) {
          if (zones[i].key === item.zone.key) { index = i; break }
        }
        if (index < 0) return
        // 服务端没有地图数据时保留本机渲染结果（可能是服务端尚未同步的历史布局）
        if (!(res.image && (res.points || []).length)) return
        // 服务端为自定义布局时整体替换该区域：本机是网格也会切换成「照片 + 点位」视图
        var hit = {}
        if (item.hit) Object.keys(item.hit).forEach(function (k) { hit[k] = true })
        ;(res.points || []).forEach(function (p) { if (p.seatId) hit[p.seatId] = true })
        var points = buildPoints(res.points || [], hit, item.userId, item.keyword)
        var freeCount = points.filter(function (s) { return s.type === 'free' }).length
        var remote = res.image || ''
        // 整体替换区域对象：本机原本是网格时也能切到「照片 + 点位」的地图视图
        var patch = {}
        patch['zones[' + index + ']'] = {
          key: item.zone.key,
          name: zones[index].name,
          map: { image: remote, source: res.source || 'server', points: points },
          total: points.length,
          freeCount: freeCount
        }
        self.setData(patch)
        // 照片下载到本地缓存后再渲染，避免 http 直连被域名 / 证书校验挡住
        if (remote) {
          api.downloadMapImage(remote).then(function (img) {
            if (!img) return
            var next = {}
            var zone = (self.data.zones || [])[index]
            if (!zone || !zone.map) return
            next['zones[' + index + '].map'] = Object.assign({}, zone.map, { image: img })
            self.setData(next)
          })
        }
      })
    })
  },

  switchZone: function (e) {
    this.setData({ currentZone: e.currentTarget.dataset.zone })
    this.render()
  },

  onSearch: function (e) {
    this.setData({ keyword: e.detail.value, currentZone: 'ALL' })
    this.render()
  },

  clearSearch: function () {
    this.setData({ keyword: '' })
    this.render()
  },

  onSeatTap: function (e) {
    var code = e.currentTarget.dataset.code
    var seat = store.getSeatByCode(code)
    if (!seat) return
    var type = 'used'
    if (seat.status === 'repair') type = 'repair'
    else if (seat.status === 'free') type = 'free'
    else if (seat.owner === this.data.userId) type = 'mine'
    var facility = ['标准工位']
    if (seat.hasSocket) facility.push('独立插座')
    if (seat.nearWindow) facility.push('靠窗')
    var office = store.getOffice(seat.officeId)
    // 自定义布局（照片 + 点位）没有行列概念，展示顺序号
    var posText = office && office.mapMode === 'custom'
      ? '（' + (String(seat.no || seat.col) + ' 号') + '）'
      : ('第 ' + seat.row + ' 排 第 ' + seat.col + ' 列')
    this.setData({
      detail: {
        id: seat.id,
        code: seat.code,
        no: seat.no || '',
        codeLong: String(seat.no || seat.code || '').length > 8,
        zoneName: seat.officeName || seat.zone + ' 区',
        ownerName: seat.ownerName,
        facility: facility.join(' · '),
        status: seat.status,
        type: type,
        row: seat.row,
        col: seat.col,
        statusText: type === 'mine' ? '我的工位' : STATUS_TEXT[seat.status],
        tagClass: type === 'mine' ? 'primary' : TAG_CLASS[seat.status],
        posText: posText
      }
    })
  },

  closeDetail: function () {
    this.setData({ detail: null })
  },
  noop: function () {},

  adminRepair: function () {
    var detail = this.data.detail
    var self = this
    var next = detail.status === 'repair' ? 'free' : 'repair'
    var r = store.adminSetSeatStatus(detail.code, next, self.user)
    if (!r.ok) return util.toast(r.msg)
    util.toast(next === 'repair' ? '已标记为维修中' : '已恢复为可用', 'success')
    self.setData({ detail: null })
    self.render()
  },

  /** 管理员在地图上修改工位展示编号（二维码编号不变） */
  adminRename: function () {
    var self = this
    var detail = this.data.detail
    wx.showModal({
      title: '修改工位编号',
      content: detail.code,
      editable: true,
      placeholderText: '输入新编号，如 ' + detail.code,
      confirmText: '保存',
      success: function (r) {
        if (!r.confirm) return
        var code = String(r.content || '').trim()
        if (!code) return util.toast('请输入工位编号')
        if (code === detail.code) return
        api.updateSeatCode(detail.id, code).then(function (res) {
          if (!res.ok) return util.toast(res.msg || '修改失败')
          util.toast('编号已更新，二维码无需更换', 'success')
          self.setData({ detail: null })
          self.render()
        })
      }
    })
  },

  adminRelease: function () {
    var detail = this.data.detail
    var self = this
    wx.showModal({
      title: '释放工位',
      content: '确定释放 ' + detail.code + ' 并将该工位置为空闲吗？',
      confirmColor: '#f04438',
      success: function (res) {
        if (!res.confirm) return
        var r = store.releaseSeatByCode(detail.code, self.user, true)
        if (!r.ok) return util.toast(r.msg)
        util.toast(r.msg, 'success')
        self.setData({ detail: null })
        self.render()
      }
    })
  }
}))
