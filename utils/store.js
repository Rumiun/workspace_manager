var util = require('./util.js')

var KEY = {
  SEATS: 'gss_seats',
  APPS: 'gss_apps',
  CLAIMS: 'gss_seat_claims',
  OFFICES: 'gss_offices',
  STUDENTS: 'gss_students',
  SETTINGS: 'gss_settings',
  NOTICES: 'gss_notices',
  USER: 'gss_current_user'
}

/**
 * 工位身份说明（二维码长期不变的关键）：
 *   seat.id   创建时生成的不可变编号（S0001…），二维码内容固定为 {QR_BASE}/s/{id}
 *   seat.code 展示用工位编号（如 A-0102），管理员可改；改编号不会影响二维码
 *   seat.no   工位地图显示的纯数字编号（如 0102），随编号同步；二维码同样不变
 * 因此调整办公室名称、前缀、行列数、工位编号时，已有工位的二维码始终不变。
 */

var ADMINS = [
  {
    id: 'admin',
    password: '123456',
    name: '王雅琴',
    role: 'admin',
    college: '研究生院 · 工位管理办公室',
    grade: '工位管理员',
    tutor: '—',
    phone: '010-6233 8899',
    email: 'wyq@edu.cn'
  }
]

var DEFAULT_OFFICES = [
  { id: 'of1', name: 'A 区 · 科研主楼 3F', building: '科研主楼 3F', prefix: 'A', rows: 4, cols: 6 },
  { id: 'of2', name: 'B 区 · 科研主楼 4F', building: '科研主楼 4F', prefix: 'B', rows: 4, cols: 5 },
  { id: 'of3', name: 'C 区 · 实验楼 2F', building: '实验楼 2F', prefix: 'C', rows: 3, cols: 6 }
]

var DEFAULT_STUDENTS = [
  {
    id: '2023001', password: '123456', name: '张明', role: 'student',
    college: '计算机科学与技术学院', grade: '2023 级硕士研究生', tutor: '李国栋 教授',
    phone: '138 0013 0021', email: 'zhangming@stu.edu.cn'
  },
  {
    id: '2023002', password: '123456', name: '刘思佳', role: 'student',
    college: '电子信息工程学院', grade: '2022 级博士研究生', tutor: '王海涛 教授',
    phone: '139 0088 7766', email: 'liusijia@stu.edu.cn'
  }
]

var DEFAULT_SETTINGS = {
  termStart: util.formatDate(),
  termEnd: util.offsetDay(180),
  mode: 'approval', // approval：扫码提交申请，审批通过后归属生效；direct：扫码直接登记归属
  // 登记开放控制：开关 + 开放时间窗口 + 批次（不同批次登记的同学可使用不同期限）
  registerOpen: true,
  registerStart: '',
  registerEnd: '',
  batches: [],
  seatSeq: 0,
  qrBase: ''
}

/* ---------------- 基础读写 ---------------- */
function read(key, def) {
  var v = wx.getStorageSync(key)
  return v === '' || v === undefined || v === null ? def : v
}

function write(key, value) {
  wx.setStorageSync(key, value)
}

function nowText() {
  return util.formatDate(new Date()) + ' ' + util.formatTime(new Date())
}

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

function newId(prefix, seq) {
  return prefix + ('0000' + seq).slice(-4)
}

/* ---------------- 初始化 ---------------- */
function initData() {
  var settings = read(KEY.SETTINGS, null)
  if (!settings) write(KEY.SETTINGS, DEFAULT_SETTINGS)
  if (!read(KEY.OFFICES, null)) write(KEY.OFFICES, DEFAULT_OFFICES)
  if (!read(KEY.STUDENTS, null)) write(KEY.STUDENTS, DEFAULT_STUDENTS)
  if (!read(KEY.SEATS, null)) {
    var seats = []
    DEFAULT_OFFICES.forEach(function (o) {
      seats = seats.concat(buildOfficeSeats(o, seats.length))
    })
    // 演示：为 2023001 分配一个工位
    var mine = seats.filter(function (s) { return s.code === 'A-0102' })[0]
    if (mine) {
      mine.status = 'used'
      mine.owner = '2023001'
      mine.ownerName = '张明'
      mine.claimedAt = util.offsetDay(-30) + ' 09:00'
    }
    write(KEY.SEATS, seats)
    var s = read(KEY.SETTINGS, DEFAULT_SETTINGS)
    s.seatSeq = seats.length
    write(KEY.SETTINGS, s)
  }
  if (!read(KEY.APPS, null)) write(KEY.APPS, [])
  if (!read(KEY.NOTICES, null)) write(KEY.NOTICES, buildNotices())
  if (!read(KEY.CLAIMS, null)) {
    write(KEY.CLAIMS, [{
      id: util.uuid('cl'), seatCode: 'A-0102', studentId: '2023001', studentName: '张明',
      action: 'claim', operator: '张明', time: util.offsetDay(-30) + ' 09:00'
    }])
  }
}

function buildOfficeSeats(office, offset) {
  var settings = read(KEY.SETTINGS, DEFAULT_SETTINGS)
  var seq = settings.seatSeq + offset
  var list = []
  for (var r = 1; r <= office.rows; r++) {
    for (var c = 1; c <= office.cols; c++) {
      seq += 1
      list.push({
        id: newId('S', seq),
        code: office.prefix + '-' + pad(r) + pad(c),
        no: pad(r) + pad(c),
        officeId: office.id,
        officeName: office.name,
        building: office.building,
        zone: office.prefix,
        row: r,
        col: c,
        status: 'free',
        owner: null,
        ownerName: '',
        claimedAt: '',
        termStart: '',
        termEnd: '',
        hasSocket: c % 2 === 1,
        nearWindow: r === 1 || c === 1
      })
    }
  }
  return list
}

function buildNotices() {
  return [
    {
      id: 'n1', type: '重要',
      title: '关于开展 2026 年度研究生工位调整工作的通知',
      content: '本年度工位调整工作将于本月启动，请各位同学扫描工位二维码提交申请，使用期限由工位管理办公室统一设置。',
      time: util.offsetDay(-2) + ' 09:00', publisher: '研究生院'
    },
    {
      id: 'n2', type: '通知',
      title: '工位二维码使用说明',
      content: '每个工位对应一枚固定二维码，编号一经生成不再变化；请扫描工位上的二维码查看归属并提交申请。',
      time: util.offsetDay(-5) + ' 15:30', publisher: '工位管理办公室'
    }
  ]
}

/* ---------------- 用户 ---------------- */
/**
 * 登录。role 只是登录页上的「身份」选择，仅作提示：
 * 账号 + 密码都正确时一律按账号真实身份登录（管理员账号就是管理员），
 * 不再因为选错身份而登录失败——那会让页面停在上一个会话，
 * 表现为「用管理员账号登录，看到的却是学生页面」。
 */
function login(account, password, role) {
  var list = getStudents().concat(ADMINS)
  var user = list.filter(function (u) { return u.id === account })[0]
  if (!user) return { ok: false, msg: '账号不存在，请联系管理员添加' }
  if (user.password !== password) return { ok: false, msg: '密码错误' }
  var info = {
    id: user.id, name: user.name, role: user.role, college: user.college,
    grade: user.grade, tutor: user.tutor, phone: user.phone, email: user.email
  }
  write(KEY.USER, info)
  return { ok: true, user: info }
}

/**
 * 当前登录用户（唯一可信来源）：
 * 早期版本 / 热重载可能往缓存里写过残缺对象（只有 id、丢了 role 或 name），
 * 那样页面会「登录的是管理员，渲染成学生」。这里统一校验并自愈：
 *   - 缺 role 时按 id 反查管理员表 / 学生表补齐
 *   - 缺 name / college 等字段时用原始档案补全
 *   - 连 id 或 name 都没有 → 视为无效会话（返回 null，让页面回登录页）
 */
function getCurrentUser() {
  var u = read(KEY.USER, null)
  if (!u || typeof u !== 'object' || !u.id) return null

  var role = u.role === 'admin' || u.role === 'student' ? u.role : ''
  if (!role) {
    role = ADMINS.filter(function (a) { return a.id === u.id }).length ? 'admin' : 'student'
  }
  var src = role === 'admin'
    ? (ADMINS.filter(function (a) { return a.id === u.id })[0] || null)
    : findStudent(u.id)

  var merged = {
    id: u.id,
    name: u.name || (src && src.name) || '',
    role: role,
    college: u.college || (src && src.college) || '',
    grade: u.grade || (src && src.grade) || '',
    tutor: u.tutor || (src && src.tutor) || '',
    phone: u.phone || (src && src.phone) || '',
    email: u.email || (src && src.email) || ''
  }
  if (!merged.name) return null

  // 有字段被补齐时写回，避免每次都要再算一遍
  if (JSON.stringify(merged) !== JSON.stringify(u)) write(KEY.USER, merged)
  return merged
}

function logout() {
  wx.removeStorageSync(KEY.USER)
}

function demoUsers() {
  return getStudents().map(function (u) { return { id: u.id, name: u.name, role: 'student' } })
    .concat(ADMINS.map(function (u) { return { id: u.id, name: u.name, role: 'admin' } }))
}

/* ---------------- 系统设置 ---------------- */
function getSettings() {
  var s = read(KEY.SETTINGS, null) || DEFAULT_SETTINGS
  return {
    termStart: s.termStart || DEFAULT_SETTINGS.termStart,
    termEnd: s.termEnd || DEFAULT_SETTINGS.termEnd,
    mode: s.mode || 'approval',
    registerOpen: s.registerOpen === undefined ? DEFAULT_SETTINGS.registerOpen : !!s.registerOpen,
    registerStart: s.registerStart || '',
    registerEnd: s.registerEnd || '',
    batches: (s.batches || []).map(function (b) {
      return {
        id: b.id,
        name: b.name || '批次',
        registerStart: b.registerStart || '',
        registerEnd: b.registerEnd || '',
        termStart: b.termStart || '',
        termEnd: b.termEnd || ''
      }
    }),
    seatSeq: s.seatSeq || 0,
    qrBase: s.qrBase || ''
  }
}

function saveSettings(patch) {
  var s = getSettings()
  var next = {
    termStart: patch.termStart || s.termStart,
    termEnd: patch.termEnd || s.termEnd,
    mode: patch.mode || s.mode,
    registerOpen: patch.registerOpen === undefined ? s.registerOpen : !!patch.registerOpen,
    registerStart: patch.registerStart === undefined ? s.registerStart : patch.registerStart,
    registerEnd: patch.registerEnd === undefined ? s.registerEnd : patch.registerEnd,
    batches: patch.batches || s.batches,
    seatSeq: patch.seatSeq || s.seatSeq,
    qrBase: patch.qrBase || s.qrBase
  }
  write(KEY.SETTINGS, next)
  return next
}

/* ---------------- 登记开放与批次 ---------------- */
/** 判断日期（YYYY-MM-DD）是否落在窗口内，起止为空表示不限 */
function inWindow(today, start, end) {
  return (!start || today >= start) && (!end || today <= end)
}

/**
 * 登记开放状态：由「开关 + 开放时间 + 批次窗口」自动计算
 * 返回 { open, reason, text, today, batch }
 * reason: closed（手动关闭） / not_started / ended / batch（批次开放中） / open
 */
function registerState(now) {
  var s = getSettings()
  var today = util.formatDate(now || new Date())
  var batch = null
  ;(s.batches || []).forEach(function (b) {
    if (!batch && inWindow(today, b.registerStart, b.registerEnd)) batch = b
  })
  var reason = 'open'
  var text = '登记开放中'
  if (!s.registerOpen) {
    reason = 'closed'
    text = '未开放登记（管理员已关闭）'
  } else if (batch) {
    reason = 'batch'
    text = '批次「' + batch.name + '」登记中（' + (batch.registerStart || '不限') + ' 至 ' + (batch.registerEnd || '不限') + '）'
  } else if (s.registerStart && today < s.registerStart) {
    reason = 'not_started'
    text = '登记将于 ' + s.registerStart + ' 开放'
  } else if (s.registerEnd && today > s.registerEnd) {
    reason = 'ended'
    text = '登记已于 ' + s.registerEnd + ' 结束'
  }
  return {
    open: reason === 'open' || reason === 'batch',
    reason: reason,
    text: text,
    today: today,
    batch: batch
  }
}

/** 当前登记应使用的工作期限：命中批次用批次期限，否则用默认期限 */
function currentTerm(now) {
  var s = getSettings()
  var rs = registerState(now)
  if (rs.batch && rs.batch.termStart && rs.batch.termEnd) {
    return { termStart: rs.batch.termStart, termEnd: rs.batch.termEnd, batchName: rs.batch.name }
  }
  return { termStart: s.termStart, termEnd: s.termEnd, batchName: '' }
}

/* ---------------- 办公室 ---------------- */
function getOffices() {
  return read(KEY.OFFICES, [])
}

function saveOffices(list) {
  write(KEY.OFFICES, list)
}

/** 兼容工位地图：办公室按 { key, name, rows, cols } 暴露（含自定义地图信息） */
function getZones() {
  return getOffices().map(function (o) {
    return {
      key: o.prefix,
      name: o.name,
      rows: o.rows,
      cols: o.cols,
      officeId: o.id,
      mapMode: o.mapMode === 'custom' ? 'custom' : 'grid',
      mapImage: o.mapImage || '',
      mapPoints: (o.mapPoints || []).slice()
    }
  })
}

function getOffice(id) {
  return getOffices().filter(function (o) { return o.id === id })[0]
}

function addOffice(data) {
  var list = getOffices()
  var custom = data.mapMode === 'custom'
  var office = {
    id: util.uuid('of'),
    name: data.name,
    building: data.building || '',
    prefix: (data.prefix || '').toUpperCase(),
    rows: Math.max(1, parseInt(data.rows, 10) || 1),
    cols: Math.max(1, parseInt(data.cols, 10) || 1),
    // 布局方式：grid = 标准网格（行 × 列）；custom = 自定义地图（上传照片后放置工位）
    mapMode: custom ? 'custom' : 'grid',
    mapImage: '',
    mapPoints: []
  }
  list.push(office)
  saveOffices(list)
  // 自定义布局先不生成工位，等在地图编辑器里放置并保存后再创建
  var res = custom ? { ok: true, count: 0 } : syncOfficeSeats(office.id)
  return { ok: true, office: office, seats: res }
}

/** 自定义布局下按序号重排工位（行固定为 1，列 = 序号，编号 A-01、A-02…） */
function reindexCustomSeats(office, seats) {
  seats.forEach(function (s, i) {
    s.row = 1
    s.col = i + 1
    s.no = pad(i + 1)
    if (!s.codeEdited) s.code = office.prefix + '-' + pad(i + 1)
    s.officeName = office.name
    s.building = office.building
    s.zone = office.prefix
  })
}

function updateOffice(id, patch) {
  var list = getOffices()
  var office = list.filter(function (o) { return o.id === id })[0]
  if (!office) return { ok: false, msg: '办公室不存在' }
  if (patch.name) office.name = patch.name
  if (patch.building !== undefined) office.building = patch.building
  if (patch.prefix) office.prefix = patch.prefix.toUpperCase()
  if (patch.rows) office.rows = Math.max(1, parseInt(patch.rows, 10) || 1)
  if (patch.cols) office.cols = Math.max(1, parseInt(patch.cols, 10) || 1)
  if (patch.mapMode !== undefined) office.mapMode = patch.mapMode === 'custom' ? 'custom' : 'grid'
  if (patch.mapImage !== undefined) office.mapImage = patch.mapImage || ''
  saveOffices(list)
  var res = syncOfficeSeats(id)
  // 办公室信息变化同步到工位冗余字段（编号前缀变化时重排编号，id 与二维码不变）
  var seats = getSeats()
  var mine = seats.filter(function (s) { return s.officeId === id })
  if (office.mapMode === 'custom') reindexCustomSeats(office, mine)
  else {
    mine.forEach(function (s) {
      s.officeName = office.name
      s.building = office.building
      s.zone = office.prefix
      if (!s.codeEdited) s.code = office.prefix + '-' + pad(s.row) + pad(s.col)
    })
  }
  saveSeats(seats)
  return { ok: !res || res.ok !== false ? true : false, office: office, seats: res }
}

function removeOffice(id) {
  var seats = getSeats()
  var used = seats.filter(function (s) { return s.officeId === id && (s.owner || s.status === 'used') })
  if (used.length) return { ok: false, msg: '该办公室还有 ' + used.length + ' 个已登记工位，请先释放归属' }
  var rest = seats.filter(function (s) { return s.officeId !== id })
  saveSeats(rest)
  saveOffices(getOffices().filter(function (o) { return o.id !== id }))
  return { ok: true, msg: '已删除办公室及其空闲工位' }
}

/**
 * 使办公室实际工位数与「布局」一致：
 * - 标准网格（grid）：目标数 = rows × cols，按行列空位补建
 * - 自定义地图（custom）：目标数 = 地图上的点位数，按序号补建
 * 减少时仅从末尾删除空闲工位，避免误删已登记工位
 * @param {string} officeId
 * @param {number} [forceTarget] 指定目标数量（地图编辑器保存时使用）
 */
function syncOfficeSeats(officeId, forceTarget) {
  var office = getOffice(officeId)
  if (!office) return { ok: false, msg: '办公室不存在' }
  var custom = office.mapMode === 'custom'
  var seats = getSeats()
  var mine = seats.filter(function (s) { return s.officeId === officeId })
    .sort(function (a, b) { return a.row === b.row ? a.col - b.col : a.row - b.row })
  var target = typeof forceTarget === 'number'
    ? Math.max(0, forceTarget)
    : (custom ? (office.mapPoints || []).length : office.rows * office.cols)
  var settings = getSettings()
  var seq = settings.seatSeq

  if (mine.length < target) {
    if (custom) {
      while (mine.length < target) {
        seq += 1
        var idx = mine.length + 1
        var cSeat = {
          id: newId('S', seq),
          code: office.prefix + '-' + pad(idx),
          no: pad(idx),
          officeId: office.id,
          officeName: office.name,
          building: office.building,
          zone: office.prefix,
          row: 1, col: idx,
          status: 'free', owner: null, ownerName: '', claimedAt: '', termStart: '', termEnd: '',
          hasSocket: true,
          nearWindow: false
        }
        seats.push(cSeat)
        mine.push(cSeat)
      }
    } else {
      var existMap = {}
      mine.forEach(function (s) { existMap[s.row + '-' + s.col] = true })
      for (var r = 1; r <= office.rows && mine.length < target; r++) {
        for (var c = 1; c <= office.cols && mine.length < target; c++) {
          if (existMap[r + '-' + c]) continue
          seq += 1
          var seat = {
            id: newId('S', seq),
            code: office.prefix + '-' + pad(r) + pad(c),
            no: pad(r) + pad(c),
            officeId: office.id,
            officeName: office.name,
            building: office.building,
            zone: office.prefix,
            row: r, col: c,
            status: 'free', owner: null, ownerName: '', claimedAt: '', termStart: '', termEnd: '',
            hasSocket: c % 2 === 1,
            nearWindow: r === 1 || c === 1
          }
          seats.push(seat)
          mine.push(seat)
        }
      }
    }
    saveSettings({ seatSeq: seq })
  } else if (mine.length > target) {
    var extra = mine.slice(target)
    var blocked = extra.filter(function (s) { return s.owner || s.status === 'used' })
    if (blocked.length) return { ok: false, msg: '多出的 ' + blocked.length + ' 个工位已登记，无法减少' }
    var dropMap = {}
    extra.forEach(function (s) { dropMap[s.id] = true })
    seats = seats.filter(function (s) { return !dropMap[s.id] })
  }
  saveSeats(seats)
  return { ok: true, count: Math.min(target, mine.length) }
}

/* ---------------- 工位地图（自定义布局） ---------------- */

function clampPct(v) {
  var n = Number(v)
  if (!isFinite(n)) return 50
  if (n < 0) return 0
  if (n > 100) return 100
  return Math.round(n * 100) / 100
}

/** 读取某办公室的自定义地图（含工位实时状态），供地图编辑器与工位地图页使用 */
function getOfficeMap(officeId) {
  var office = getOffice(officeId)
  if (!office) return { ok: false, msg: '办公室不存在' }
  var seats = getSeatsByOffice(officeId)
  var byId = {}
  seats.forEach(function (s) { byId[s.id] = s })
  var points = (office.mapPoints || []).map(function (p) {
    var seat = byId[p.seatId]
    return {
      seatId: p.seatId,
      code: seat ? seat.code : '',
      no: seat ? (seat.no || '') : '',
      status: seat ? seat.status : 'free',
      owner: seat ? seat.owner : null,
      x: p.x,
      y: p.y
    }
  })
  return {
    ok: true,
    office: office,
    mode: office.mapMode === 'custom' ? 'custom' : 'grid',
    image: office.mapImage || '',
    points: points,
    seats: seats,
    rows: office.rows,
    cols: office.cols
  }
}

/**
 * 保存自定义地图：点位顺序即工位顺序（第 1 个点 = 01 号工位）
 * 已有工位按顺序复用（id 与二维码不变），数量多余的空闲工位会被删除
 */
function saveOfficeMap(officeId, payload) {
  var list = getOffices()
  var office = list.filter(function (o) { return o.id === officeId })[0]
  if (!office) return { ok: false, msg: '办公室不存在' }
  var raw = (payload && payload.points) || []
  if (!raw.length) return { ok: false, msg: '请至少放置一个工位' }
  if (raw.length > 200) return { ok: false, msg: '单个办公室工位数过多（上限 200）' }
  var points = raw.map(function (p) {
    return { seatId: p.seatId || '', x: clampPct(p.x), y: clampPct(p.y) }
  })

  office.mapMode = 'custom'
  if (payload && payload.image !== undefined) office.mapImage = payload.image || ''
  // 先按点位数量对齐工位（可能新建或删除末尾空闲工位）
  var res = syncOfficeSeats(officeId, points.length)
  if (res && res.ok === false) return res

  var seats = getSeats()
  var mine = seats.filter(function (s) { return s.officeId === officeId })
    .sort(function (a, b) { return a.row === b.row ? a.col - b.col : a.row - b.row })
  if (mine.length !== points.length) {
    return { ok: false, msg: '工位数量与点位不一致，请重试' }
  }
  reindexCustomSeats(office, mine)
  office.mapPoints = mine.map(function (s, i) {
    return { seatId: s.id, x: points[i].x, y: points[i].y }
  })
  saveSeats(seats)
  saveOffices(list)
  return { ok: true, count: mine.length, image: office.mapImage }
}

/**
 * 切换布局方式
 * - custom：若还没有点位，按现有行列生成一份「默认排布」点位，方便在此基础上增删
 * - grid：恢复为 rows × cols 的标准网格
 */
function setOfficeMapMode(officeId, mode) {
  var list = getOffices()
  var office = list.filter(function (o) { return o.id === officeId })[0]
  if (!office) return { ok: false, msg: '办公室不存在' }
  var wantCustom = mode === 'custom'
  if (!wantCustom) {
    // 预检：切回网格后多余的工位若已登记则拒绝（避免改了模式又删不掉工位）
    var target = office.rows * office.cols
    var owned = getSeatsByOffice(officeId)
      .sort(function (a, b) { return a.row === b.row ? a.col - b.col : a.row - b.row })
      .slice(target)
      .filter(function (s) { return s.owner || s.status === 'used' }).length
    if (owned) {
      return { ok: false, msg: '标准网格只有 ' + target + ' 个工位，请先释放 ' + owned + ' 个已登记工位或调大行列数' }
    }
  }
  if (wantCustom) {
    office.mapMode = 'custom'
    if (!(office.mapPoints || []).length) {
      var rows = Math.max(1, office.rows)
      var cols = Math.max(1, office.cols)
      // 先把模式落盘：syncOfficeSeats 才会按 custom 的逻辑建工位
      saveOffices(list)
      var all = getSeats()
      var seats = all.filter(function (s) { return s.officeId === officeId })
        .sort(function (a, b) { return a.row === b.row ? a.col - b.col : a.row - b.row })
      // 还没有工位时先按行列建满，再按行列均匀摆点
      if (!seats.length) {
        syncOfficeSeats(officeId, rows * cols)
        all = getSeats()
        seats = all.filter(function (s) { return s.officeId === officeId })
          .sort(function (a, b) { return a.row === b.row ? a.col - b.col : a.row - b.row })
      }
      office.mapPoints = seats.map(function (s, i) {
        var r = Math.floor(i / cols)
        var c = i % cols
        return {
          seatId: s.id,
          x: Math.round(((c + 0.5) / cols) * 10000) / 100,
          y: Math.round(((r + 0.5) / rows) * 10000) / 100
        }
      })
      // seats 是 all 里的引用，改完直接存回同一份数组
      reindexCustomSeats(office, seats)
      saveSeats(all)
    }
  } else {
    office.mapMode = 'grid'
    office.mapPoints = []
  }
  saveOffices(list)
  var res = syncOfficeSeats(officeId)
  if (res && res.ok === false) return res
  return { ok: true, mode: office.mapMode, points: (office.mapPoints || []).length }
}

/* ---------------- 工位 ---------------- */
/** 从编号中提取数字部分作为地图数字编号：A-0102 -> 0102 */
function seatNo(code, fallback) {
  var groups = String(code || '').match(/\d+/g)
  if (groups && groups.length) return groups[groups.length - 1]
  return fallback || ''
}

function getSeats() {
  var seats = read(KEY.SEATS, [])
  // 旧数据补齐数字编号，并同步办公室名称 / 楼栋（以办公室配置为准）
  var offices = getOffices()
  var officeMap = {}
  offices.forEach(function (o) { officeMap[o.id] = o })
  var dirty = false
  seats.forEach(function (s) {
    if (!s.no) {
      s.no = seatNo(s.code, pad(s.row) + pad(s.col))
      dirty = true
    }
    var office = officeMap[s.officeId]
    if (!office) return
    if (s.building !== office.building) {
      s.building = office.building
      dirty = true
    }
    if (s.officeName !== office.name) {
      s.officeName = office.name
      dirty = true
    }
  })
  if (dirty) write(KEY.SEATS, seats)
  return seats
}

function saveSeats(seats) {
  write(KEY.SEATS, seats)
}

function getSeatsByOffice(officeId) {
  return getSeats().filter(function (s) { return s.officeId === officeId })
    .sort(function (a, b) { return a.row === b.row ? a.col - b.col : a.row - b.row })
}

/** 在指定数组内按 id（二维码）或 code（工位编号）查找，保证后续修改能随该数组一起保存 */
function findIn(list, token) {
  if (!token) return null
  var key = String(token).trim()
  return (list || []).filter(function (s) { return s.id === key || s.code === key })[0] || null
}

/** 按 id（二维码）或 code（工位编号）查找（只读用） */
function findSeat(token) {
  return findIn(getSeats(), token)
}

function getSeatByCode(code) {
  return findSeat(code)
}

function getMySeat(studentId) {
  return getSeats().filter(function (s) { return s.owner === studentId })[0] || null
}

function seatView(seat, viewerId, keepName) {
  if (!seat) return null
  var mine = !!(viewerId && seat.owner && seat.owner === viewerId)
  var facility = (seat.hasSocket ? '独立插座 ' : '') + (seat.nearWindow ? '靠窗' : '内区')
  var settings = getSettings()
  // 楼栋以办公室配置为准（工位上的冗余字段可能为空或过期）
  var office = getOffice(seat.officeId)
  // 楼栋为空时回退办公室名称，保证标签上始终有可读的区域信息
  var building = (office && office.building) || seat.building || (office && office.name) || ''
  return {
    id: seat.id,
    code: seat.code,
    no: seat.no || seatNo(seat.code, pad(seat.row) + pad(seat.col)),
    officeId: seat.officeId,
    officeName: (office && office.name) || seat.officeName,
    building: building,
    zone: seat.zone,
    row: seat.row,
    col: seat.col,
    status: seat.status,
    facility: facility,
    hasSocket: seat.hasSocket,
    nearWindow: seat.nearWindow,
    owner: seat.owner || '',
    ownerName: seat.ownerName ? (mine || keepName ? seat.ownerName : util.maskName(seat.ownerName)) : '',
    ownerIdMasked: seat.owner ? util.maskId(seat.owner) : '',
    claimedAt: seat.claimedAt || '',
    termStart: seat.termStart || settings.termStart,
    termEnd: seat.termEnd || settings.termEnd,
    isMine: mine
  }
}

function getSeatView(token, user) {
  var seat = findSeat(token)
  if (!seat) return { ok: false, code: 'SEAT_NOT_FOUND', msg: '工位不存在：' + token }
  return { ok: true, seat: seatView(seat, user ? user.id : '') }
}

/** 修改展示编号（不影响二维码） */
function updateSeatCode(id, code) {
  var seats = getSeats()
  var target = seats.filter(function (s) { return s.id === id })[0]
  if (!target) return { ok: false, msg: '工位不存在' }
  var codeText = String(code || '').trim()
  if (!codeText) return { ok: false, msg: '编号不能为空' }
  var dup = seats.filter(function (s) { return s.code === codeText && s.id !== id })[0]
  if (dup) return { ok: false, msg: '编号已被 ' + dup.officeName + ' 使用' }
  target.code = codeText
  target.no = seatNo(codeText, target.no)
  target.codeEdited = true
  saveSeats(seats)
  return { ok: true, seat: seatView(target, '') }
}

function getClaims() {
  return read(KEY.CLAIMS, [])
}

function saveClaims(list) {
  write(KEY.CLAIMS, list)
}

function pushClaim(log) {
  var list = getClaims()
  list.unshift(log)
  saveClaims(list)
}

/** 登记归属（direct 模式或审批通过后调用） */
function claimSeat(token, user) {
  var seats = getSeats()
  var target = findIn(seats, token)
  if (!target) return { ok: false, code: 'SEAT_NOT_FOUND', msg: '工位不存在：' + token }
  if (target.status === 'repair') return { ok: false, code: 'SEAT_DISABLED', msg: '该工位已停用（维修中），暂不可登记' }
  // 登记开放时间由管理员设置，按当前日期自动开闭
  var rs = registerState()
  if (!rs.open) return { ok: false, code: 'REGISTER_CLOSED', msg: '暂不可登记：' + rs.text }
  if (target.owner === user.id) return { ok: true, code: 'ALREADY_MINE', msg: '你已登记该工位', seat: seatView(target, user.id) }
  if (target.owner) return { ok: false, code: 'SEAT_TAKEN', msg: '该工位已被其他同学登记，不可重复登记' }
  var mineSeat = seats.filter(function (s) { return s.owner === user.id })[0]
  if (mineSeat) {
    return { ok: false, code: 'ALREADY_HAS_SEAT', msg: '你已登记工位 ' + mineSeat.code + '，请先退订后再登记', seatCode: mineSeat.code }
  }
  var term = currentTerm()
  var time = nowText()
  target.status = 'used'
  target.owner = user.id
  target.ownerName = user.name
  target.claimedAt = time
  target.termStart = term.termStart
  target.termEnd = term.termEnd
  saveSeats(seats)
  pushClaim({ id: util.uuid('cl'), seatCode: target.code, seatId: target.id, studentId: user.id, studentName: user.name, action: 'claim', operator: user.name, time: time })
  return { ok: true, msg: '登记成功，该工位归你使用', seat: seatView(target, user.id) }
}

function releaseSeatByCode(token, user, force) {
  if (!user) return { ok: false, code: 'NO_AUTH', msg: '请先登录' }
  var seats = getSeats()
  var target = findIn(seats, token)
  if (!target) return { ok: false, code: 'SEAT_NOT_FOUND', msg: '工位不存在：' + token }
  if (!target.owner) return { ok: false, code: 'NOT_CLAIMED', msg: '该工位当前无人登记' }
  var isAdmin = force && user.role === 'admin'
  if (target.owner !== user.id && !isAdmin) return { ok: false, code: 'NO_AUTH', msg: '仅本人或管理员可退订该工位' }
  pushClaim({
    id: util.uuid('cl'), seatCode: target.code, seatId: target.id, studentId: target.owner,
    studentName: target.ownerName, action: isAdmin ? 'admin_release' : 'release', operator: user.name, time: nowText()
  })
  target.owner = null
  target.ownerName = ''
  target.claimedAt = ''
  target.termStart = ''
  target.termEnd = ''
  target.status = 'free'
  saveSeats(seats)
  return { ok: true, msg: isAdmin ? '已强制释放该工位' : '已退订该工位', seat: seatView(target, user.id) }
}

function adminSeats(params) {
  params = params || {}
  var keyword = (params.keyword || '').trim().toLowerCase()
  var list = getSeats().map(function (s) { return seatView(s, s.owner) })
  if (params.officeId) list = list.filter(function (s) { return s.officeId === params.officeId })
  if (params.status && params.status !== 'all') list = list.filter(function (s) { return s.status === params.status })
  if (keyword) {
    list = list.filter(function (s) {
      return (s.code + ' ' + s.id + ' ' + s.officeName + ' ' + (s.owner || '') + ' ' + (s.ownerName || '')).toLowerCase().indexOf(keyword) >= 0
    })
  }
  return { ok: true, list: list, stats: getStats() }
}

function adminSetSeatStatus(token, status, user) {
  var seats = getSeats()
  var target = findIn(seats, token)
  if (!target) return { ok: false, code: 'SEAT_NOT_FOUND', msg: '工位不存在：' + token }
  if (status !== 'free' && status !== 'repair') return { ok: false, code: 'PARAM_ERROR', msg: '状态不合法' }
  if (status === 'free' && target.owner) return { ok: false, code: 'HAS_OWNER', msg: '该工位已有人登记，请先释放归属' }
  target.status = status
  if (status === 'repair') {
    target.owner = null
    target.ownerName = ''
    target.claimedAt = ''
    target.termStart = ''
    target.termEnd = ''
  }
  saveSeats(seats)
  pushClaim({ id: util.uuid('cl'), seatCode: target.code, seatId: target.id, studentId: '', studentName: '', action: status === 'repair' ? 'disable' : 'enable', operator: user ? user.name : '管理员', time: nowText() })
  return { ok: true, msg: status === 'repair' ? '已停用' : '已恢复为空闲', seat: seatView(target, '') }
}

function seatLogs(token) {
  var seat = findSeat(token)
  var list = getClaims()
  if (seat) list = list.filter(function (l) { return l.seatId === seat.id || l.seatCode === seat.code })
  return list.slice(0, 50)
}

/* ---------------- 学生信息 ---------------- */
function getStudents() {
  return read(KEY.STUDENTS, [])
}

function saveStudents(list) {
  write(KEY.STUDENTS, list)
}

function findStudent(id) {
  return getStudents().filter(function (s) { return s.id === id })[0] || null
}

function addStudent(data) {
  var list = getStudents()
  var id = String(data.id || '').trim()
  if (!id) return { ok: false, msg: '学号不能为空' }
  if (!String(data.name || '').trim()) return { ok: false, msg: '姓名不能为空' }
  if (findStudent(id)) return { ok: false, msg: '学号 ' + id + ' 已存在' }
  var student = {
    id: id,
    password: data.password || '123456',
    name: String(data.name).trim(),
    role: 'student',
    college: data.college || '',
    grade: data.grade || '',
    tutor: data.tutor || '',
    phone: data.phone || '',
    email: data.email || ''
  }
  list.push(student)
  saveStudents(list)
  return { ok: true, student: student }
}

function updateStudent(id, patch) {
  var list = getStudents()
  var student = list.filter(function (s) { return s.id === id })[0]
  if (!student) return { ok: false, msg: '学生不存在' }
  if (patch.name) student.name = patch.name
  if (patch.college !== undefined) student.college = patch.college
  if (patch.grade !== undefined) student.grade = patch.grade
  if (patch.tutor !== undefined) student.tutor = patch.tutor
  if (patch.phone !== undefined) student.phone = patch.phone
  if (patch.email !== undefined) student.email = patch.email
  if (patch.password) student.password = patch.password
  saveStudents(list)
  return { ok: true, student: student }
}

function removeStudents(ids) {
  var list = getStudents()
  var seats = getSeats()
  var blocked = []
  var dropMap = {}
  ids.forEach(function (id) { dropMap[id] = true })
  ids.forEach(function (id) {
    var owned = seats.filter(function (s) { return s.owner === id }).length
    if (owned) blocked.push(id)
  })
  if (blocked.length) return { ok: false, msg: '以下学生仍有工位归属，请先释放：' + blocked.join('、') }
  saveStudents(list.filter(function (s) { return !dropMap[s.id] }))
  return { ok: true, removed: ids.length }
}

var STUDENT_FIELDS = [
  { keys: ['学号', '编号', 'id', 'ID'], prop: 'id' },
  { keys: ['姓名', '名字', 'name'], prop: 'name' },
  { keys: ['学院', '院系', '单位'], prop: 'college' },
  { keys: ['年级', '层次'], prop: 'grade' },
  { keys: ['导师', '指导教师'], prop: 'tutor' },
  { keys: ['手机', '电话', '联系方式'], prop: 'phone' },
  { keys: ['邮箱', '邮件', 'email'], prop: 'email' },
  { keys: ['密码', 'password'], prop: 'password' }
]

/**
 * 将 Excel 文件的二维数组转为学生对象数组
 * 首行若为表头（含学号/姓名等关键字）则按列名映射，否则按列顺序：
 * 学号、姓名、学院、年级、导师、手机、邮箱
 */
/** 判断首行是否为表头 */
function isHeaderRow(cells) {
  return (cells || []).some(function (cell) {
    var text = String(cell || '').trim()
    return STUDENT_FIELDS.some(function (f) { return f.keys.indexOf(text) >= 0 })
  })
}

function parseStudentRows(rows) {
  var list = rows || []
  if (!list.length) return []
  var first = list[0].map(function (cell) { return String(cell || '').trim() })
  var hasHeader = isHeaderRow(first)
  var header = null
  if (hasHeader) {
    header = first.map(function (cell) {
      var matched = STUDENT_FIELDS.filter(function (f) { return f.keys.indexOf(cell) >= 0 })[0]
      return matched ? matched.prop : ''
    })
  }
  var body = hasHeader ? list.slice(1) : list
  return body.map(function (cells) {
    var row = {}
    if (header) {
      header.forEach(function (prop, index) { if (prop) row[prop] = String(cells[index] || '').trim() })
    } else {
      row.id = String(cells[0] || '').trim()
      row.name = String(cells[1] || '').trim()
      row.college = String(cells[2] || '').trim()
      row.grade = String(cells[3] || '').trim()
      row.tutor = String(cells[4] || '').trim()
      row.phone = String(cells[5] || '').trim()
      row.email = String(cells[6] || '').trim()
      row.password = String(cells[7] || '').trim()
    }
    return row
  }).filter(function (r) { return r.id && r.name })
}

/** 解析 Excel 粘贴文本（TSV / CSV，支持表头） */
function parseStudentTable(text) {
  var lines = String(text || '').split(/\r?\n/).filter(function (l) { return l.trim() })
  if (!lines.length) return []
  var fields = [
    { keys: ['学号', '编号', 'id', 'ID'], prop: 'id' },
    { keys: ['姓名', '名字', 'name'], prop: 'name' },
    { keys: ['学院', '院系', '单位'], prop: 'college' },
    { keys: ['年级', '层次'], prop: 'grade' },
    { keys: ['导师', '指导教师'], prop: 'tutor' },
    { keys: ['手机', '电话', '联系方式'], prop: 'phone' },
    { keys: ['邮箱', '邮件', 'email'], prop: 'email' },
    { keys: ['密码', 'password'], prop: 'password' }
  ]
  function split(line) {
    if (line.indexOf('\t') >= 0) return line.split('\t').map(function (s) { return s.trim() })
    if (line.indexOf(',') >= 0) return line.split(',').map(function (s) { return s.trim() })
    return line.split(/\s{2,}/).map(function (s) { return s.trim() })
  }
  var header = null
  var first = split(lines[0])
  var hasHeader = first.some(function (cell) {
    return fields.some(function (f) { return f.keys.indexOf(cell) >= 0 })
  })
  if (hasHeader) {
    header = first.map(function (cell) {
      var matched = fields.filter(function (f) { return f.keys.indexOf(cell) >= 0 })[0]
      return matched ? matched.prop : ''
    })
    lines = lines.slice(1)
  }
  return lines.map(function (line) {
    var cells = split(line)
    var row = {}
    if (header) {
      header.forEach(function (prop, index) { if (prop) row[prop] = cells[index] || '' })
    } else {
      row.id = cells[0] || ''
      row.name = cells[1] || ''
      row.college = cells[2] || ''
      row.grade = cells[3] || ''
      row.tutor = cells[4] || ''
      row.phone = cells[5] || ''
      row.email = cells[6] || ''
    }
    return row
  }).filter(function (r) { return r.id && r.name })
}

/** 批量导入：存在则更新，不存在则新增 */
function importStudents(rows) {
  var list = getStudents()
  var added = []
  var updated = []
  var failed = []
  rows.forEach(function (row) {
    var id = String(row.id || '').trim()
    var name = String(row.name || '').trim()
    if (!id || !name) return failed.push(id || '空行')
    var exist = list.filter(function (s) { return s.id === id })[0]
    if (exist) {
      exist.name = name
      if (row.college) exist.college = row.college
      if (row.grade) exist.grade = row.grade
      if (row.tutor) exist.tutor = row.tutor
      if (row.phone) exist.phone = row.phone
      if (row.email) exist.email = row.email
      if (row.password) exist.password = row.password
      updated.push(id)
    } else {
      list.push({
        id: id, name: name, password: row.password || '123456', role: 'student',
        college: row.college || '', grade: row.grade || '', tutor: row.tutor || '',
        phone: row.phone || '', email: row.email || ''
      })
      added.push(id)
    }
  })
  saveStudents(list)
  return { ok: true, added: added, updated: updated, failed: failed }
}

/** 导出为可粘贴到 Excel 的文本（TSV） */
function exportStudentsText() {
  var head = ['学号', '姓名', '学院', '年级', '导师', '手机', '邮箱']
  var rows = getStudents().map(function (s) {
    return [s.id, s.name, s.college || '', s.grade || '', s.tutor || '', s.phone || '', s.email || ''].join('\t')
  })
  return [head.join('\t')].concat(rows).join('\n')
}

/* ---------------- 工位申请 ---------------- */
function getApps() {
  return read(KEY.APPS, [])
}

function saveApps(apps) {
  write(KEY.APPS, apps)
}

function getMyApps(studentId) {
  return getApps().filter(function (a) { return a.studentId === studentId })
}

function getPendingApps() {
  return getApps().filter(function (a) { return a.status === 'pending' })
}

/** 学生扫码提交申请：使用期限由管理员设置（settings），学生不可填报 */
function createApp(data) {
  // 登记开放时间由管理员设置，按当前日期自动开闭
  var rs = registerState()
  if (!rs.open) return { ok: false, code: 'REGISTER_CLOSED', msg: '暂不可申请：' + rs.text }
  var term = currentTerm()
  var seat = findSeat(data.seatToken || data.seatCode)
  // 一工位一归属：已有工位时不可再申请其他工位
  var mine = getMySeat(data.studentId)
  if (mine && (!seat || mine.id !== seat.id)) {
    return { ok: false, code: 'ALREADY_HAS_SEAT', msg: '你已登记工位 ' + mine.code + '，请先退订后再申请', seatCode: mine.code }
  }
  var apps = getApps()
  var app = {
    id: util.uuid('ap'),
    studentId: data.studentId,
    studentName: data.studentName,
    seatId: seat ? seat.id : '',
    seatCode: seat ? seat.code : (data.seatCode || ''),
    officeId: seat ? seat.officeId : '',
    zone: seat ? seat.zone : '',
    reason: data.reason || '',
    startDate: term.termStart,
    endDate: term.termEnd,
    batchName: term.batchName || '',
    status: 'pending',
    applyTime: nowText(),
    handleTime: '',
    handler: '',
    comment: ''
  }
  apps.unshift(app)
  saveApps(apps)
  return { ok: true, app: app }
}

function handleApp(id, pass, handlerName, comment) {
  var apps = getApps()
  var target = apps.filter(function (a) { return a.id === id })[0]
  if (!target) return { ok: false, msg: '申请不存在' }
  if (target.status !== 'pending') return { ok: false, msg: '该申请已处理' }
  target.status = pass ? 'approved' : 'rejected'
  target.handleTime = nowText()
  target.handler = handlerName
  target.comment = comment || (pass ? '同意申请。' : '不同意，请联系管理员。')
  if (pass) {
    var seats = getSeats()
    var seat = findIn(seats, target.seatId || target.seatCode)
    if (!seat) return { ok: false, msg: '工位不存在，无法分配' }
    if (seat.status === 'repair') return { ok: false, msg: '该工位已停用，无法分配' }
    if (seat.owner && seat.owner !== target.studentId) return { ok: false, msg: '该工位已被其他同学登记' }
    var term = currentTerm()
    var hasOther = seats.filter(function (s) { return s.owner === target.studentId && s.id !== seat.id })[0]
    if (hasOther) return { ok: false, msg: '该同学已登记工位 ' + hasOther.code + '，请先释放' }
    seat.status = 'used'
    seat.owner = target.studentId
    seat.ownerName = target.studentName
    seat.claimedAt = nowText()
    seat.termStart = term.termStart
    seat.termEnd = term.termEnd
    saveSeats(seats)
    pushClaim({ id: util.uuid('cl'), seatCode: seat.code, seatId: seat.id, studentId: target.studentId, studentName: target.studentName, action: 'claim', operator: handlerName, time: nowText() })
  }
  saveApps(apps)
  return { ok: true }
}

function cancelApp(id) {
  var apps = getApps()
  var target = apps.filter(function (a) { return a.id === id })[0]
  if (!target) return
  target.status = 'canceled'
  target.handleTime = nowText()
  saveApps(apps)
}

/* ---------------- 服务端快照 ---------------- */

/**
 * 把服务端返回的数据整体写进本地缓存。
 *
 * 本地缓存只作「渲染缓冲区」，服务端才是唯一数据源：
 * 页面进一次就拉一次快照覆盖这里，任何在别处发生过的修改都会同步过来。
 * 返回是否有变化，便于调用方决定要不要重渲染。
 *
 * @param {{offices?:Array, seats?:Array, students?:Array, apps?:Array, settings?:Object}} payload
 * @returns {boolean} 内容与上次不一致时为 true
 */
function applyServerSnapshot(payload) {
  var data = payload || {}
  var before = [
    JSON.stringify(read(KEY.OFFICES, [])),
    JSON.stringify(read(KEY.SEATS, [])),
    JSON.stringify(read(KEY.STUDENTS, [])),
    JSON.stringify(read(KEY.APPS, [])),
    JSON.stringify(read(KEY.SETTINGS, {}))
  ].join('|')
  var touched = false

  if (data.offices && data.offices.length) {
    write(KEY.OFFICES, data.offices.map(function (o) {
      return {
        id: o.id,
        name: o.name || '',
        building: o.building || '',
        prefix: String(o.prefix || '').toUpperCase(),
        rows: Math.max(1, parseInt(o.rows, 10) || 1),
        cols: Math.max(1, parseInt(o.cols, 10) || 1),
        mapMode: o.mapMode === 'custom' ? 'custom' : 'grid',
        mapImage: o.mapImage || '',
        mapPoints: (o.mapPoints || []).slice()
      }
    }))
    touched = true
  }
  if (data.seats && data.seats.length) {
    write(KEY.SEATS, data.seats.map(function (s) {
      return Object.assign({}, s, {
        row: parseInt(s.row, 10) || 1,
        col: parseInt(s.col, 10) || 1,
        zone: s.zone || String(s.prefix || '')
      })
    }))
    touched = true
  }
  if (data.students && data.students.length) {
    write(KEY.STUDENTS, data.students)
    touched = true
  }
  /* 申请列表允许是空数组（服务端确实没有申请），所以只判断存在性 */
  if (data.apps) {
    write(KEY.APPS, data.apps)
    touched = true
  }
  if (data.settings && Object.keys(data.settings).length) {
    write(KEY.SETTINGS, Object.assign({}, getSettings(), data.settings))
    touched = true
  }
  if (!touched) return false

  var after = [
    JSON.stringify(read(KEY.OFFICES, [])),
    JSON.stringify(read(KEY.SEATS, [])),
    JSON.stringify(read(KEY.STUDENTS, [])),
    JSON.stringify(read(KEY.APPS, [])),
    JSON.stringify(read(KEY.SETTINGS, {}))
  ].join('|')
  return after !== before
}

/* ---------------- 公告与统计 ---------------- */
function getNotices() {
  return read(KEY.NOTICES, [])
}

function addNotice(item) {
  var list = getNotices()
  list.unshift(item)
  write(KEY.NOTICES, list)
}

function getStats() {
  var seats = getSeats()
  var offices = getOffices()
  var total = seats.length
  var used = seats.filter(function (s) { return s.status === 'used' }).length
  var repair = seats.filter(function (s) { return s.status === 'repair' }).length
  var apps = getApps()
  return {
    total: total,
    used: used,
    free: total - used - repair,
    repair: repair,
    rate: total ? Math.round((used / total) * 100) : 0,
    offices: offices.length,
    students: getStudents().length,
    pending: apps.filter(function (a) { return a.status === 'pending' }).length,
    approved: apps.filter(function (a) { return a.status === 'approved' }).length,
    rejected: apps.filter(function (a) { return a.status === 'rejected' }).length,
    byOffice: offices.map(function (o) {
      var list = seats.filter(function (s) { return s.officeId === o.id })
      var u = list.filter(function (s) { return s.status === 'used' }).length
      return { officeId: o.id, name: o.name, total: list.length, used: u, free: list.length - u }
    })
  }
}

function resetAll() {
  Object.keys(KEY).forEach(function (k) {
    if (k === 'USER') return
    wx.removeStorageSync(KEY[k])
  })
  initData()
}

module.exports = {
  KEY: KEY,
  initData: initData,
  login: login,
  getCurrentUser: getCurrentUser,
  logout: logout,
  demoUsers: demoUsers,
  getSettings: getSettings,
  saveSettings: saveSettings,
  registerState: registerState,
  currentTerm: currentTerm,
  getOffices: getOffices,
  getZones: getZones,
  getOffice: getOffice,
  addOffice: addOffice,
  updateOffice: updateOffice,
  removeOffice: removeOffice,
  syncOfficeSeats: syncOfficeSeats,
  getOfficeMap: getOfficeMap,
  saveOfficeMap: saveOfficeMap,
  setOfficeMapMode: setOfficeMapMode,
  getSeats: getSeats,
  getSeatsByOffice: getSeatsByOffice,
  findSeat: findSeat,
  getSeatByCode: getSeatByCode,
  getMySeat: getMySeat,
  seatView: seatView,
  getSeatView: getSeatView,
  updateSeatCode: updateSeatCode,
  seatNo: seatNo,
  claimSeat: claimSeat,
  releaseSeatByCode: releaseSeatByCode,
  adminSeats: adminSeats,
  adminSetSeatStatus: adminSetSeatStatus,
  seatLogs: seatLogs,
  getClaims: getClaims,
  getStudents: getStudents,
  findStudent: findStudent,
  addStudent: addStudent,
  updateStudent: updateStudent,
  removeStudents: removeStudents,
  parseStudentTable: parseStudentTable,
  parseStudentRows: parseStudentRows,
  isHeaderRow: isHeaderRow,
  importStudents: importStudents,
  exportStudentsText: exportStudentsText,
  getApps: getApps,
  getMyApps: getMyApps,
  getPendingApps: getPendingApps,
  createApp: createApp,
  handleApp: handleApp,
  cancelApp: cancelApp,
  getNotices: getNotices,
  addNotice: addNotice,
  getStats: getStats,
  resetAll: resetAll,
  applyServerSnapshot: applyServerSnapshot
}
