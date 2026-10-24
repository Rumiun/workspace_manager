var store = require('../../utils/store.js')
var api = require('../../utils/api.js')
var sync = require('../../utils/sync.js')
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

/** 服务端 office（/api/admin/offices）→ 页面渲染用的 zone 结构 */
function zoneFromOffice(o) {
  return {
    key: String(o.prefix || ''),
    name: o.name || '',
    rows: Math.max(1, parseInt(o.rows, 10) || 1),
    cols: Math.max(1, parseInt(o.cols, 10) || 1),
    officeId: o.id,
    mapMode: o.mapMode === 'custom' ? 'custom' : 'grid',
    mapImage: o.mapImage || '',
    mapPoints: (o.mapPoints || []).slice()
  }
}

function seatTypeOf(s, userId) {
  if (s.status === 'repair') return 'repair'
  if (s.status === 'free') return 'free'
  if (userId && s.owner === userId) return 'mine'
  return 'used'
}

function seatCell(s, userId) {
  return {
    id: s.id,
    code: s.code,
    label: s.no || s.col,
    type: seatTypeOf(s, userId)
  }
}

/**
 * 自定义地图点位：服务端只存 { seatId, x, y }，
 * 编号与状态要从工位表里补，才能画在照片上。
 */
function pointsFromOffice(zone, seats, userId, keyword) {
  var byId = {}
  seats.forEach(function (s) { byId[s.id] = s })
  var hit = {}
  var list = []
  ;(zone.mapPoints || []).forEach(function (p, i) {
    var s = byId[p.seatId]
    if (!s) return
    hit[s.id] = true
    var text = String(s.code || '') + ' ' + String(s.no || '')
    if (keyword && text.toUpperCase().indexOf(keyword) === -1) return
    list.push({ code: s.code, label: s.no || (i + 1), type: seatTypeOf(s, userId), x: p.x, y: p.y })
  })
  return { points: list, hit: hit }
}

/**
 * 统一渲染入口：本地缓存与服务端快照用同一套规则。
 * opt = { keyword, currentZone, userId, pointsOf(zone, seats) }
 */
function buildZones(offices, seats, opt) {
  var keyword = opt.keyword || ''
  var currentZone = opt.currentZone || 'ALL'
  var userId = opt.userId || ''
  var zones = []
  var pending = []

  offices.forEach(function (z) {
    if (currentZone !== 'ALL' && currentZone !== z.key) return
    var mine = seats.filter(function (s) {
      if (z.officeId && s.officeId) return s.officeId === z.officeId
      return s.zone === z.key
    })
    if (keyword) {
      mine = mine.filter(function (s) {
        return String(s.code || '').indexOf(keyword) > -1 || String(s.no || '').indexOf(keyword) > -1
      })
      if (!mine.length) return
    }

    // 自定义布局：照片 + 百分比点位
    if (z.mapMode === 'custom' && z.mapImage) {
      var info = (opt.pointsOf ? opt.pointsOf(z, mine) : null) || { points: [], hit: {} }
      zones.push({
        key: z.key,
        name: z.name,
        map: { image: api.absImage(z.mapImage), points: info.points || [] },
        total: mine.length,
        freeCount: (info.points || []).filter(function (p) { return p.type === 'free' }).length
      })
      pending.push({ zone: z, hit: info.hit || {}, userId: userId, keyword: keyword })
      return
    }

    // 标准网格：也登记一下，服务端若已是自定义布局会整体替换
    pending.push({ zone: z, hit: {}, userId: userId, keyword: keyword })

    var rows = []
    var rowCount = Math.max(1, parseInt(z.rows, 10) || 1)
    for (var r = 1; r <= rowCount; r++) {
      var rowSeats = mine.filter(function (s) { return (parseInt(s.row, 10) || 1) === r })
        .sort(function (a, b) { return (parseInt(a.col, 10) || 0) - (parseInt(b.col, 10) || 0) })
      if (!rowSeats.length) continue
      rows.push({
        key: z.key + '-r' + r,
        list: rowSeats.map(function (s) { return seatCell(s, userId) })
      })
    }

    /* 兜底：自定义布局但照片丢了 / 老数据的 row 全是 1 时，
       按列数折行，避免所有工位挤成一行横向溢出屏幕 */
    var cols = Math.max(1, parseInt(z.cols, 10) || 1)
    if (rows.length <= 1 && mine.length > cols) {
      rows = []
      for (var i = 0; i < mine.length; i += cols) {
        rows.push({
          key: z.key + '-c' + i,
          list: mine.slice(i, i + cols).map(function (s) { return seatCell(s, userId) })
        })
      }
    }
    if (!rows.length) return

    zones.push({
      key: z.key,
      name: z.name,
      rows: rows,
      total: mine.length,
      freeCount: mine.filter(function (s) { return s.status === 'free' }).length
    })
  })

  return { zones: zones, pending: pending }
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
    // 首屏用缓存渲染完成后，再用服务端数据覆盖（照片、点位、工位状态都以服务端为准）
    this.pullFromServer()
  },

  buildTabs: function (offices) {
    var list = offices || store.getZones()
    var tabs = [{ key: 'ALL', label: '全部区域' }]
    list.forEach(function (z) {
      tabs.push({ key: z.key, label: z.key + ' 区' })
    })
    this.setData({ zoneTabs: tabs })
  },

  viewOptions: function () {
    return {
      keyword: (this.data.keyword || '').trim().toUpperCase(),
      currentZone: this.data.currentZone,
      userId: this.data.userId
    }
  },

  /**
   * 先用手里的缓存立刻渲染（不白屏），再由 pullFromServer() 用服务端快照覆盖。
   * 多端各自缓存时，本地只作首屏，服务端才是准的。
   */
  render: function () {
    var opt = this.viewOptions()
    var built = buildZones(store.getZones(), store.getSeats(), Object.assign({}, opt, {
      pointsOf: function (z, mine) {
        var info = store.getOfficeMap(z.officeId)
        if (info && info.ok && (info.points || []).length) {
          var hit = {}
          mine.forEach(function (s) { hit[s.id] = true })
          return { points: buildPoints(info.points, hit, opt.userId, opt.keyword), hit: hit }
        }
        return pointsFromOffice(z, mine, opt.userId, opt.keyword)
      }
    }))
    this.pendingMaps = built.pending
    this.setData({ zones: built.zones })
    this.syncMapsFromServer()
  },

  /**
   * 服务端为准：拉办公室 + 工位，重建整页（含自定义地图照片与点位）。
   * 手机端如果只有本地旧数据（比如域名没通时建的区域），这里会被服务端数据替换。
   */
  pullFromServer: function () {
    var self = this
    if (this.pulling) return
    this.pulling = true
    var user = this.user || store.getCurrentUser()
    Promise.all([
      api.getOffices().catch(function () { return null }),
      api.adminSeats({ status: 'all' }, user).catch(function () { return null })
    ]).then(function (r) {
      self.pulling = false
      var officeRes = r[0]
      var seatRes = r[1]
      if (!officeRes || !officeRes.ok || !(officeRes.list || []).length) return
      var offices = officeRes.list.map(zoneFromOffice)
      var seats = (seatRes && seatRes.ok && seatRes.list) || []
      self.serverOffices = officeRes.list
      self.serverSeats = seats
      self.buildTabs(offices)

      var opt = self.viewOptions()
      // 选中的区域在服务端已不存在（通常是本地独有数据）→ 回到「全部区域」
      var exists = false
      offices.forEach(function (o) { if (o.key === opt.currentZone) exists = true })
      if (opt.currentZone !== 'ALL' && !exists) {
        opt.currentZone = 'ALL'
        self.setData({ currentZone: 'ALL' })
      }

      var built = buildZones(offices, seats, Object.assign({}, opt, {
        pointsOf: function (z, mine) {
          var info = pointsFromOffice(z, mine, opt.userId, opt.keyword)
          if (!(info.points || []).length) {
            // 服务端点位缺失（老数据）时退回本机缓存的点位
            var local = store.getOfficeMap(z.officeId)
            if (local && local.ok && (local.points || []).length) {
              var hit = {}
              mine.forEach(function (s) { hit[s.id] = true })
              return { points: buildPoints(local.points, hit, opt.userId, opt.keyword), hit: hit }
            }
          }
          return info
        }
      }))
      self.pendingMaps = built.pending
      self.setData({ zones: built.zones })
      self.syncMapsFromServer()
    }).catch(function () { self.pulling = false })
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
    /* 服务端有、本地缓存没有的工位（换了设备/刚在别的端新建）也要能点开 */
    var seat = store.getSeatByCode(code)
    if (!seat) {
      var pool = this.serverSeats || []
      for (var i = 0; i < pool.length; i++) {
        if (pool[i].code === code) { seat = pool[i]; break }
      }
    }
    if (!seat) return
    var type = 'used'
    if (seat.status === 'repair') type = 'repair'
    else if (seat.status === 'free') type = 'free'
    else if (seat.owner === this.data.userId) type = 'mine'
    var facility = ['标准工位']
    if (seat.hasSocket) facility.push('独立插座')
    if (seat.nearWindow) facility.push('靠窗')
    var office = store.getOffice(seat.officeId)
    var isCustom = office ? office.mapMode === 'custom' : false
    if (!office && seat.officeId) {
      // 服务端新数据本地还没有对应 office 时，按 zone 判定布局方式
      var zs = this.data.zones || []
      for (var zi = 0; zi < zs.length; zi++) {
        if (zs[zi].key === seat.zone && zs[zi].map) { isCustom = true; break }
      }
    }
    // 自定义布局（照片 + 点位）没有行列概念，展示顺序号
    var posText = isCustom
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
    wx.showLoading({ title: '提交中…' })
    api.adminSetSeatStatus(detail.code, next).then(function (r) {
      wx.hideLoading()
      if (!r || !r.ok) return util.toast((r && r.msg) || '操作失败')
      util.toast(next === 'repair' ? '已标记为维修中' : '已恢复为可用', 'success')
      self.setData({ detail: null })
      sync.refresh().then(function () { self.render() })
    })
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
        wx.showLoading({ title: '提交中…' })
        api.releaseSeat(detail.code, self.user, true).then(function (r) {
          wx.hideLoading()
          if (!r || !r.ok) return util.toast((r && r.msg) || '释放失败')
          util.toast(r.msg || '已释放该工位', 'success')
          self.setData({ detail: null })
          sync.refresh().then(function () { self.render() })
        })
      }
    })
  }
}))
