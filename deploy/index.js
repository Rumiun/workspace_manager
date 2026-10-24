/**
 * 研究生工位管理系统 · 服务端（零依赖，Node >= 12）
 * 启动：node server/index.js  默认监听 3000
 *
 * 核心：工位身份 = 不可变编号 id（S0001…），二维码内容固定为 {QR_BASE}/s/{id}
 *      办公室、工位数量、展示编号可调整，已有工位的二维码始终不变
 */
const http = require('http')
const storage = require('./storage.js')

/* 生产环境（容器里）默认 80：即使环境变量 PORT 没注入，
   也要落在云托管探活的 80 端口上；本地开发仍是 3000 */
const PORT = Number(process.env.PORT) ||
  (process.env.NODE_ENV === 'production' ? 80 : 3000)
const UPLOAD_EXT = ['.png', '.jpg', '.jpeg', '.webp']
const IMAGE_TYPE = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
const UPLOAD_MAX = 8 * 1024 * 1024
const QR_BASE = process.env.QR_BASE || 'https://seat.example.edu.cn'

const DEFAULT_OFFICES = [
  { id: 'of1', name: 'A 区 · 科研主楼 3F', building: '科研主楼 3F', prefix: 'A', rows: 4, cols: 6 },
  { id: 'of2', name: 'B 区 · 科研主楼 4F', building: '科研主楼 4F', prefix: 'B', rows: 4, cols: 5 },
  { id: 'of3', name: 'C 区 · 实验楼 2F', building: '实验楼 2F', prefix: 'C', rows: 3, cols: 6 }
]

const DEFAULT_STUDENTS = [
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

const pad = n => (n < 10 ? '0' + n : '' + n)
const newId = seq => 'S' + ('0000' + seq).slice(-4)

function nowText() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function isoDay(offset) {
  const d = new Date()
  d.setDate(d.getDate() + (offset || 0))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function seedState() {
  const state = {
    offices: DEFAULT_OFFICES,
    seats: [],
    apps: [],
    students: DEFAULT_STUDENTS,
    logs: [],
    settings: {
    termStart: isoDay(0),
    termEnd: isoDay(180),
    mode: 'approval',
    // 登记开放控制：开关 + 开放时间窗口 + 批次（不同批次登记的同学可使用不同期限）
    registerOpen: true,
    registerStart: '',
    registerEnd: '',
    batches: [],
    seatSeq: 0
  }
  }
  state.offices.forEach(buildSeats.bind(null, state))
  return state
}

function buildSeats(state, office) {
  for (let r = 1; r <= office.rows; r++) {
    for (let c = 1; c <= office.cols; c++) {
      state.settings.seatSeq += 1
      state.seats.push({
        id: newId(state.settings.seatSeq),
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
}

/* 业务状态与地图照片的读写全部交给存储层：
   file  → server/data/state.json + server/data/uploads（本地开发）
   mysql → 云数据库（微信云托管部署：容器重启不丢数据） */
let state = null

let queue = Promise.resolve()
function transaction(fn) {
  const run = queue.then(async () => {
    const result = await fn()
    await storage.save(state)
    return result
  })
  queue = run.catch(() => {})
  return run
}

/* ---------------- 视图 ---------------- */
function maskName(name) {
  if (!name) return ''
  if (name.length === 1) return name
  if (name.length === 2) return name[0] + '*'
  return name[0] + '*'.repeat(name.length - 2) + name[name.length - 1]
}

/** 从编号提取数字部分作为地图数字编号：A-0102 -> 0102 */
function seatNo(code, fallback) {
  const groups = String(code || '').match(/\d+/g)
  if (groups && groups.length) return groups[groups.length - 1]
  return fallback || ''
}

function seatView(seat, viewerId, keepName) {
  const mine = !!viewerId && seat.owner === viewerId
  const facility = (seat.hasSocket ? '独立插座 ' : '') + (seat.nearWindow ? '靠窗' : '内区')
  if (!seat.no) seat.no = seatNo(seat.code, pad(seat.row) + pad(seat.col))
  // 楼栋以办公室配置为准（工位上的冗余字段可能为空或过期）
  const office = state.offices.find(o => o.id === seat.officeId)
  // 楼栋为空时回退办公室名称，保证标签上始终有可读的区域信息
  const building = (office && office.building) || seat.building || (office && office.name) || ''
  return {
    id: seat.id,
    code: seat.code,
    no: seat.no,
    officeId: seat.officeId,
    officeName: (office && office.name) || seat.officeName,
    building,
    zone: seat.zone,
    row: seat.row,
    col: seat.col,
    status: seat.status,
    facility,
    hasSocket: seat.hasSocket,
    nearWindow: seat.nearWindow,
    owner: seat.owner || '',
    ownerName: seat.ownerName ? (mine || keepName ? seat.ownerName : maskName(seat.ownerName)) : '',
    ownerIdMasked: seat.owner ? seat.owner.slice(0, 4) + '***' : '',
    claimedAt: seat.claimedAt || '',
    termStart: seat.termStart || state.settings.termStart,
    termEnd: seat.termEnd || state.settings.termEnd,
    isMine: mine
  }
}

function findSeat(token) {
  if (!token) return null
  const key = String(token).trim()
  return state.seats.find(s => s.id === key || s.code === key) || null
}

function pushLog(log) {
  state.logs.unshift(log)
  state.logs = state.logs.slice(0, 2000)
}

const ok = data => ({ status: 200, body: Object.assign({ ok: true }, data) })
const fail = (status, code, msg, extra) => ({ status, body: Object.assign({ ok: false, code, msg }, extra || {}) })

/* ---------------- 登记开放与批次 ---------------- */
/** 日期（YYYY-MM-DD）是否落在窗口内，起止为空表示不限 */
function inWindow(today, start, end) {
  return (!start || today >= start) && (!end || today <= end)
}

/**
 * 登记开放状态：由「开关 + 开放时间 + 批次窗口」自动计算
 * reason: closed（手动关闭） / not_started / ended / batch（批次开放中） / open
 */
function registerState() {
  const s = state.settings
  const today = isoDay(0)
  const batch = (s.batches || []).find(b => inWindow(today, b.registerStart, b.registerEnd)) || null
  let reason = 'open'
  let text = '登记开放中'
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
  return { open: reason === 'open' || reason === 'batch', reason: reason, text: text, today: today, batch: batch }
}

/** 当前登记应使用的工作期限：命中批次用批次期限，否则用默认期限 */
function currentTerm() {
  const rs = registerState()
  if (rs.batch && rs.batch.termStart && rs.batch.termEnd) {
    return { termStart: rs.batch.termStart, termEnd: rs.batch.termEnd, batchName: rs.batch.name }
  }
  return { termStart: state.settings.termStart, termEnd: state.settings.termEnd, batchName: '' }
}

/* ---------------- 业务 ---------------- */
function claimSeat(token, user) {
  return transaction(() => {
    const seat = findSeat(token)
    if (!seat) return fail(404, 'SEAT_NOT_FOUND', '工位不存在：' + token)
    if (seat.status === 'repair') return fail(403, 'SEAT_DISABLED', '该工位已停用（维修中），暂不可登记')
    // 登记开放时间由管理员设置，按当前日期自动开闭
    const rs = registerState()
    if (!rs.open) return fail(403, 'REGISTER_CLOSED', '暂不可登记：' + rs.text)
    if (seat.owner === user.studentId) return ok({ seat: seatView(seat, user.studentId), msg: '你已登记该工位' })
    if (seat.owner) return fail(409, 'SEAT_TAKEN', '该工位已被其他同学登记，不可重复登记')
    const mine = state.seats.find(s => s.owner === user.studentId)
    if (mine) return fail(409, 'ALREADY_HAS_SEAT', '你已登记工位 ' + mine.code + '，请先退订后再登记', { seatCode: mine.code })
    seat.status = 'used'
    seat.owner = user.studentId
    seat.ownerName = user.name || ''
    const term = currentTerm()
    seat.claimedAt = nowText()
    seat.termStart = term.termStart
    seat.termEnd = term.termEnd
    pushLog({ id: 'cl_' + Date.now(), seatId: seat.id, seatCode: seat.code, studentId: seat.owner, studentName: seat.ownerName, action: 'claim', operator: seat.ownerName, time: nowText() })
    return ok({ seat: seatView(seat, user.studentId), msg: '登记成功，该工位归你使用' })
  })
}

function releaseSeat(token, user) {
  return transaction(() => {
    const seat = findSeat(token)
    if (!seat) return fail(404, 'SEAT_NOT_FOUND', '工位不存在：' + token)
    if (!seat.owner) return fail(409, 'NOT_CLAIMED', '该工位当前无人登记')
    const force = !!user.force && user.role === 'admin'
    if (seat.owner !== user.studentId && user.role !== 'admin') return fail(403, 'NO_AUTH', '仅本人或管理员可退订该工位')
    pushLog({ id: 'cl_' + Date.now(), seatId: seat.id, seatCode: seat.code, studentId: seat.owner, studentName: seat.ownerName, action: force ? 'admin_release' : 'release', operator: user.name || user.studentId, time: nowText() })
    seat.owner = null
    seat.ownerName = ''
    seat.claimedAt = ''
    seat.termStart = ''
    seat.termEnd = ''
    seat.status = 'free'
    return ok({ seat: seatView(seat, user.studentId), msg: force ? '已强制释放该工位' : '已退订该工位' })
  })
}

function createApp(body) {
  return transaction(() => {
    // 登记开放时间由管理员设置，按当前日期自动开闭
    const rs = registerState()
    if (!rs.open) return fail(403, 'REGISTER_CLOSED', '暂不可申请：' + rs.text)
    const term = currentTerm()
    const seat = findSeat(body.seatToken)
    if (!seat) return fail(404, 'SEAT_NOT_FOUND', '工位不存在')
    // 一工位一归属：已有工位时不可再申请其他工位
    const mine = state.seats.find(s => s.owner === body.studentId)
    if (mine && mine.id !== seat.id) {
      return fail(409, 'ALREADY_HAS_SEAT', '你已登记工位 ' + mine.code + '，请先退订后再申请', { seatCode: mine.code })
    }
    const pending = state.apps.find(a => a.studentId === body.studentId && a.status === 'pending')
    if (pending) return fail(409, 'ALREADY_PENDING', '已有待审批申请，请等待处理')
    const app = {
      id: 'ap_' + Date.now(),
      studentId: body.studentId,
      studentName: body.studentName,
      seatId: seat.id,
      seatCode: seat.code,
      officeId: seat.officeId,
      zone: seat.zone,
      reason: body.reason || '',
      startDate: term.termStart,
      endDate: term.termEnd,
      batchName: term.batchName || '',
      status: 'pending',
      applyTime: nowText(),
      handleTime: '',
      handler: '',
      comment: ''
    }
    state.apps.unshift(app)
    return ok({ app })
  })
}

function handleApp(id, pass, handlerName, comment) {
  return transaction(() => {
    const app = state.apps.find(a => a.id === id)
    if (!app) return fail(404, 'NOT_FOUND', '申请不存在')
    if (app.status !== 'pending') return fail(409, 'HANDLED', '该申请已处理')
    app.status = pass ? 'approved' : 'rejected'
    app.handleTime = nowText()
    app.handler = handlerName
    app.comment = comment || (pass ? '同意申请。' : '不同意，请联系管理员。')
    if (pass) {
      const seat = findSeat(app.seatId)
      if (!seat) return fail(404, 'SEAT_NOT_FOUND', '工位不存在，无法分配')
      if (seat.status === 'repair') return fail(409, 'SEAT_DISABLED', '该工位已停用，无法分配')
      if (seat.owner && seat.owner !== app.studentId) return fail(409, 'SEAT_TAKEN', '该工位已被其他同学登记')
      const other = state.seats.find(s => s.owner === app.studentId && s.id !== seat.id)
      if (other) return fail(409, 'ALREADY_HAS_SEAT', '该同学已登记工位 ' + other.code)
      const term = currentTerm()
      seat.status = 'used'
      seat.owner = app.studentId
      seat.ownerName = app.studentName
      seat.claimedAt = nowText()
      seat.termStart = term.termStart
      seat.termEnd = term.termEnd
      pushLog({ id: 'cl_' + Date.now(), seatId: seat.id, seatCode: seat.code, studentId: seat.owner, studentName: seat.ownerName, action: 'claim', operator: handlerName, time: nowText() })
    }
    return ok({})
  })
}

/** 自定义布局：按点位顺序重排工位（行固定为 1，列 = 序号，编号 A-01、A-02…） */
function reindexCustomSeats(office, seats) {
  seats.forEach((s, i) => {
    s.row = 1
    s.col = i + 1
    s.no = pad(i + 1)
    if (!s.codeEdited) s.code = office.prefix + '-' + pad(i + 1)
    s.officeName = office.name
    s.building = office.building
    s.zone = office.prefix
  })
}

/**
 * 办公室工位数与「布局」对齐：
 * - 标准网格：目标数 = rows × cols
 * - 自定义地图：目标数 = 点位数
 * 不足补建（新二维码），超出仅删末尾空闲工位
 * @param {object} office
 * @param {number} [forceTarget] 指定目标数量（地图保存时使用）
 */
function syncOfficeSeats(office, forceTarget) {
  const custom = office.mapMode === 'custom'
  let seats = state.seats.filter(s => s.officeId === office.id)
    .sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row))
  const target = typeof forceTarget === 'number'
    ? Math.max(0, forceTarget)
    : (custom ? (office.mapPoints || []).length : office.rows * office.cols)
  if (custom && seats.length < target) {
    while (seats.length < target) {
      const idx = seats.length + 1
      state.settings.seatSeq += 1
      state.seats.push({
        id: newId(state.settings.seatSeq),
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
      })
      seats = state.seats.filter(s => s.officeId === office.id)
        .sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row))
    }
    return ok({ count: seats.length })
  }
  if (seats.length < target) {
    const exist = {}
    seats.forEach(s => { exist[s.row + '-' + s.col] = true })
    for (let r = 1; r <= office.rows && seats.length < target; r++) {
      for (let c = 1; c <= office.cols && seats.length < target; c++) {
        if (exist[r + '-' + c]) continue
        state.settings.seatSeq += 1
        state.seats.push({
          id: newId(state.settings.seatSeq),
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
        })
        seats = state.seats.filter(s => s.officeId === office.id)
          .sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row))
      }
    }
  } else if (seats.length > target) {
    const extra = seats.slice(target)
    const blocked = extra.filter(s => s.owner || s.status === 'used')
    if (blocked.length) return fail(409, 'SEAT_USED', '末尾 ' + blocked.length + ' 个工位已登记，无法减少')
    const drop = {}
    extra.forEach(s => { drop[s.id] = true })
    state.seats = state.seats.filter(s => !drop[s.id])
  }
  return ok({ count: Math.min(target, seats.length) })
}

/* ---------------- HTTP ---------------- */
function readBody(req) {
  return new Promise(resolve => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}) } catch (e) { resolve({}) }
    })
  })
}

function send(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json;charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS'
  })
  res.end(JSON.stringify(body))
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {})
  const url = new URL(req.url, 'http://localhost')
  const seg = url.pathname.split('/').filter(Boolean)
  /* 静态：工位地图照片（服务端保存 = 云端） */
  if (seg[0] === 'uploads' && seg[1] && (req.method === 'GET' || req.method === 'HEAD')) {
    const name = decodeURIComponent(seg.slice(1).join('/'))
    if (/[\\/]|\.\./.test(name)) return send(res, 400, { ok: false, code: 'BAD_NAME', msg: '文件名不合法' })
    let buf = null
    try {
      buf = await storage.getImage(name)
    } catch (e) {
      return send(res, 500, { ok: false, code: 'SERVER_ERROR', msg: '读取图片失败：' + String(e && e.message) })
    }
    if (!buf) return send(res, 404, { ok: false, code: 'NOT_FOUND', msg: '图片不存在' })
    const type = IMAGE_TYPE[String(name).toLowerCase().match(/\.[a-z0-9]+$/)] || 'application/octet-stream'
    res.writeHead(200, { 'content-type': type, 'access-control-allow-origin': '*', 'cache-control': 'max-age=86400' })
    return res.end(req.method === 'HEAD' ? undefined : buf)
  }

  /* 健康检查：云托管 / 负载均衡会探活，必须返回 200，
     否则容器被判为未就绪（表现为部署后一直「启动中」或反复重启）。
     微信云托管实际探的是 /__tcb_probe__，这里一并放行。
     注意：初始化没完成时也要返回 200（否则探活失败会直接让部署失败），
     用 ready / boot 字段把真实状态告诉调用方。 */
  if (!seg.length || (seg.length === 1 && (seg[0] === 'healthz' || seg[0] === '__tcb_probe__'))) {
    return send(res, 200, {
      ok: true,
      ready: !!state,
      boot: bootText || '服务正在初始化',
      service: 'gss-seat-server',
      storage: storage.mode,
      offices: state ? state.offices.length : 0,
      seats: state ? state.seats.length : 0,
      time: nowText()
    })
  }

  /* 自检接口：把容器里真正读到的配置吐出来（不含密码），
     排查「环境变量填了却没生效 / 地址填错」时不用再猜。 */
  if (seg.length === 2 && seg[0] === 'api' && seg[1] === '_diag' && req.method === 'GET') {
    return send(res, 200, {
      ok: true,
      ready: !!state,
      boot: bootText || '',
      node: process.version,
      port: PORT,
      env: process.env.NODE_ENV || '',
      storage: storage.describe ? storage.describe() : { mode: storage.mode },
      lastError: lastBootError || '',
      offices: state ? state.offices.length : 0,
      seats: state ? state.seats.length : 0,
      time: nowText()
    })
  }

  /* 存储还没就绪（数据库连接中）时不要往下走：state 还是 null 会直接崩掉请求 */
  if (!state) {
    return send(res, 503, {
      ok: false,
      code: 'BOOTING',
      msg: '服务正在初始化：' + (bootText || '正在连接数据库，请稍候重试')
    })
  }

  if (seg[0] !== 'api') return send(res, 404, { ok: false, code: 'NOT_FOUND', msg: '接口不存在' })

  const body = req.method === 'POST' ? await readBody(req) : {}
  const user = { studentId: body.studentId || url.searchParams.get('studentId') || '', name: body.name || '', role: body.role || 'student', force: !!body.force }

  try {
    /* 上传：工位地图照片（小程序压缩后以 base64 提交，零依赖解析；服务端保存 = 云端） */
    if (seg[1] === 'upload' && req.method === 'POST') {
      const ext = String(body.ext || '.jpg').toLowerCase()
      if (!UPLOAD_EXT.includes(ext)) return send(res, 400, { ok: false, code: 'BAD_EXT', msg: '不支持的图片格式：' + ext })
      const data = String(body.data || '')
      if (!data) return send(res, 400, { ok: false, code: 'NO_DATA', msg: '图片内容为空' })
      const buf = Buffer.from(data, 'base64')
      if (!buf.length) return send(res, 400, { ok: false, code: 'NO_DATA', msg: '图片内容为空' })
      // 轻量校验：只接受 PNG / JPEG / WEBP 的文件头，避免写入非图片内容
      const head = buf.slice(0, 4)
      const isImage = (head[0] === 0x89 && head[1] === 0x50) ||
        (head[0] === 0xff && head[1] === 0xd8) ||
        head.toString('ascii') === 'RIFF'
      if (!isImage) return send(res, 400, { ok: false, code: 'BAD_IMAGE', msg: '不是有效的图片文件' })
      if (buf.length > UPLOAD_MAX) return send(res, 413, { ok: false, code: 'TOO_LARGE', msg: '图片过大（上限 8MB）' })
      const name = 'seat-map-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext
      await storage.putImage(name, ext, buf)
      return send(res, 200, { ok: true, url: '/uploads/' + name, size: buf.length, storage: storage.mode })
    }
  } catch (e) {
    return send(res, 500, { ok: false, code: 'SERVER_ERROR', msg: String(e && e.message) })
  }

  try {
    /* 工位 */
    if (seg[1] === 'seats' && seg[2] && seg[3] === 'logs' && req.method === 'GET') {
      const seat = findSeat(decodeURIComponent(seg[2]))
      const list = state.logs.filter(l => (seat && (l.seatId === seat.id || l.seatCode === seat.code))).slice(0, 50)
      return send(res, 200, { ok: true, list })
    }
    if (seg[1] === 'seats' && seg[2] && req.method === 'GET') {
      const seat = findSeat(decodeURIComponent(seg[2]))
      if (!seat) return send(res, 404, { ok: false, code: 'SEAT_NOT_FOUND', msg: '工位不存在' })
      return send(res, 200, { ok: true, seat: seatView(seat, user.studentId) })
    }
    if (seg[1] === 'seats' && seg[2] && seg[3] === 'claim' && req.method === 'POST') {
      const r = await claimSeat(decodeURIComponent(seg[2]), user)
      return send(res, r.status, r.body)
    }
    if (seg[1] === 'seats' && seg[2] && seg[3] === 'release' && req.method === 'POST') {
      const r = await releaseSeat(decodeURIComponent(seg[2]), user)
      return send(res, r.status, r.body)
    }
    if (seg[1] === 'students' && seg[2] && seg[3] === 'seat' && req.method === 'GET') {
      const seat = state.seats.find(s => s.owner === decodeURIComponent(seg[2]))
      return send(res, 200, { ok: true, seat: seat ? seatView(seat, seat.owner) : null })
    }

    /* 申请 */
    // 审批路由需放在「创建申请」之前，否则 POST /api/apps/:id/handle 会被创建分支吃掉
    if (seg[1] === 'apps' && seg[2] && seg[3] === 'handle' && req.method === 'POST') {
      const r = await handleApp(decodeURIComponent(seg[2]), !!body.pass, body.handler || '管理员', body.comment || '')
      return send(res, r.status, r.body)
    }
    if (seg[1] === 'apps' && !seg[2] && req.method === 'POST') {
      const r = await createApp(body)
      return send(res, r.status, r.body)
    }

    /* 设置 */
    if (seg[1] === 'settings' && req.method === 'GET') {
      return send(res, 200, { ok: true, settings: state.settings, register: registerState(), term: currentTerm() })
    }
    if (seg[1] === 'settings' && req.method === 'POST') {
      if (body.termStart) state.settings.termStart = body.termStart
      if (body.termEnd) state.settings.termEnd = body.termEnd
      if (body.mode) state.settings.mode = body.mode
      if (body.registerOpen !== undefined) state.settings.registerOpen = !!body.registerOpen
      if (body.registerStart !== undefined) state.settings.registerStart = body.registerStart || ''
      if (body.registerEnd !== undefined) state.settings.registerEnd = body.registerEnd || ''
      if (body.batches !== undefined) {
        state.settings.batches = (body.batches || []).map(b => ({
          id: b.id || 'bt_' + Date.now(),
          name: b.name || '批次',
          registerStart: b.registerStart || '',
          registerEnd: b.registerEnd || '',
          termStart: b.termStart || '',
          termEnd: b.termEnd || ''
        }))
      }
      await storage.save(state)
      return send(res, 200, { ok: true, settings: state.settings, register: registerState(), term: currentTerm() })
    }

    /* 后台：办公室 */
    if (seg[1] === 'admin' && seg[2] === 'offices' && !seg[3] && req.method === 'GET') {
      return send(res, 200, { ok: true, list: state.offices })
    }
    if (seg[1] === 'admin' && seg[2] === 'offices' && !seg[3] && req.method === 'POST') {
      const r = await transaction(() => {
        const custom = body.mapMode === 'custom'
      const office = {
          id: 'of_' + Date.now(),
          name: body.name,
          building: body.building || '',
          prefix: String(body.prefix || '').toUpperCase(),
          rows: Math.max(1, parseInt(body.rows, 10) || 1),
          cols: Math.max(1, parseInt(body.cols, 10) || 1),
          // grid = 标准网格（行 × 列）；custom = 自定义地图（照片 + 点击放置的点位）
          mapMode: custom ? 'custom' : 'grid',
          mapImage: '',
          mapPoints: []
        }
        state.offices.push(office)
        // 自定义布局先不建工位，等地图编辑器保存点位后再生成
        const s = custom ? ok({ count: 0 }) : syncOfficeSeats(office)
        return ok({ office, seats: s.body })
      })
      return send(res, r.status, r.body)
    }
    if (seg[1] === 'admin' && seg[2] === 'offices' && seg[3] && seg[4] === 'delete' && req.method === 'POST') {
      const r = await transaction(() => {
        const id = decodeURIComponent(seg[3])
        const used = state.seats.filter(s => s.officeId === id && (s.owner || s.status === 'used'))
        if (used.length) return fail(409, 'SEAT_USED', '该办公室还有 ' + used.length + ' 个已登记工位，请先释放归属')
        state.seats = state.seats.filter(s => s.officeId !== id)
        state.offices = state.offices.filter(o => o.id !== id)
        return ok({ msg: '已删除办公室及其空闲工位' })
      })
      return send(res, r.status, r.body)
    }
    /* 后台：工位地图（自定义布局）——必须放在 POST /:id 之前，否则会被通用分支吃掉 */
    if (seg[1] === 'admin' && seg[2] === 'offices' && seg[3] && seg[4] === 'map' && req.method === 'GET') {
      const office = state.offices.find(o => o.id === decodeURIComponent(seg[3]))
      if (!office) return send(res, 404, { ok: false, code: 'NOT_FOUND', msg: '办公室不存在' })
      const seats = state.seats.filter(s => s.officeId === office.id)
      const byId = {}
      seats.forEach(s => { byId[s.id] = s })
      const points = (office.mapPoints || []).map(p => ({
        seatId: p.seatId,
        code: byId[p.seatId] ? byId[p.seatId].code : '',
        no: byId[p.seatId] ? byId[p.seatId].no : '',
        status: byId[p.seatId] ? byId[p.seatId].status : 'free',
        owner: byId[p.seatId] ? byId[p.seatId].owner : null,
        x: p.x,
        y: p.y
      }))
      return send(res, 200, {
        ok: true,
        office: office,
        mode: office.mapMode === 'custom' ? 'custom' : 'grid',
        image: office.mapImage || '',
        points: points,
        seats: seats,
        rows: office.rows,
        cols: office.cols
      })
    }
    if (seg[1] === 'admin' && seg[2] === 'offices' && seg[3] && seg[4] === 'map' && req.method === 'POST') {
      const r = await transaction(() => {
        const office = state.offices.find(o => o.id === decodeURIComponent(seg[3]))
        if (!office) return fail(404, 'NOT_FOUND', '办公室不存在')
        const raw = Array.isArray(body.points) ? body.points : []
        if (!raw.length) return fail(400, 'PARAM_ERROR', '请至少放置一个工位')
        if (raw.length > 200) return fail(400, 'PARAM_ERROR', '单个办公室工位数过多（上限 200）')
        const clamp = v => Math.max(0, Math.min(100, Math.round(Number(v) * 100) / 100 || 0))
        const points = raw.map(p => ({ seatId: p.seatId || '', x: clamp(p.x), y: clamp(p.y) }))
        office.mapMode = 'custom'
        if (body.image !== undefined) office.mapImage = String(body.image || '')
        const s = syncOfficeSeats(office, points.length)
        if (s.status !== 200) return s
        const mine = state.seats.filter(seat => seat.officeId === office.id)
          .sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row))
        if (mine.length !== points.length) return fail(500, 'SERVER_ERROR', '工位数量与点位不一致')
        reindexCustomSeats(office, mine)
        office.mapPoints = mine.map((seat, i) => ({ seatId: seat.id, x: points[i].x, y: points[i].y }))
        return ok({ count: mine.length, image: office.mapImage, mode: office.mapMode })
      })
      return send(res, r.status, r.body)
    }
    if (seg[1] === 'admin' && seg[2] === 'offices' && seg[3] && seg[4] === 'map-mode' && req.method === 'POST') {
      const r = await transaction(() => {
        const office = state.offices.find(o => o.id === decodeURIComponent(seg[3]))
        if (!office) return fail(404, 'NOT_FOUND', '办公室不存在')
        const wantCustom = body.mode === 'custom'
        let seats = state.seats.filter(s => s.officeId === office.id)
          .sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row))
        if (!wantCustom) {
          const target = office.rows * office.cols
          const owned = seats.slice(target).filter(s => s.owner || s.status === 'used').length
          if (owned) return fail(409, 'SEAT_USED', '标准网格只有 ' + target + ' 个工位，请先释放 ' + owned + ' 个已登记工位或调大行列数')
          office.mapMode = 'grid'
          office.mapPoints = []
        } else {
          office.mapMode = 'custom'
          if (!(office.mapPoints || []).length) {
            const rows = Math.max(1, office.rows)
            const cols = Math.max(1, office.cols)
            if (!seats.length) {
              syncOfficeSeats(office, rows * cols)
              seats = state.seats.filter(s => s.officeId === office.id)
                .sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row))
            }
            office.mapPoints = seats.map((s, i) => ({
              seatId: s.id,
              x: Math.round(((i % cols + 0.5) / cols) * 10000) / 100,
              y: Math.round(((Math.floor(i / cols) + 0.5) / rows) * 10000) / 100
            }))
            reindexCustomSeats(office, seats)
          }
        }
        const s = syncOfficeSeats(office)
        if (s.status !== 200) return s
        return ok({ mode: office.mapMode, points: (office.mapPoints || []).length, seats: s.body })
      })
      return send(res, r.status, r.body)
    }
    if (seg[1] === 'admin' && seg[2] === 'offices' && seg[3] && req.method === 'POST') {
      const r = await transaction(() => {
        const office = state.offices.find(o => o.id === decodeURIComponent(seg[3]))
        if (!office) return fail(404, 'NOT_FOUND', '办公室不存在')
        if (body.name) office.name = body.name
        if (body.building !== undefined) office.building = body.building
        if (body.prefix) office.prefix = String(body.prefix).toUpperCase()
        if (body.rows) office.rows = Math.max(1, parseInt(body.rows, 10) || 1)
        if (body.cols) office.cols = Math.max(1, parseInt(body.cols, 10) || 1)
        if (body.mapMode !== undefined) office.mapMode = body.mapMode === 'custom' ? 'custom' : 'grid'
        if (body.mapImage !== undefined) office.mapImage = String(body.mapImage || '')
        const s = syncOfficeSeats(office)
        const mine = state.seats.filter(seat => seat.officeId === office.id)
        if (office.mapMode === 'custom') {
          reindexCustomSeats(office, mine.sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row)))
        } else {
          mine.forEach(seat => {
            seat.officeName = office.name
            seat.building = office.building
            seat.zone = office.prefix
            if (!seat.codeEdited) {
              seat.code = office.prefix + '-' + pad(seat.row) + pad(seat.col)
              seat.no = pad(seat.row) + pad(seat.col)
            }
          })
        }
        if (s.status !== 200) return s
        return ok({ office, seats: s.body })
      })
      return send(res, r.status, r.body)
    }

    /* 后台：工位 */
    if (seg[1] === 'admin' && seg[2] === 'seats' && !seg[3] && req.method === 'GET') {
      const status = url.searchParams.get('status') || 'all'
      const keyword = (url.searchParams.get('keyword') || '').trim().toLowerCase()
      const officeId = url.searchParams.get('officeId') || ''
      let list = state.seats.map(s => seatView(s, s.owner))
      if (officeId) list = list.filter(s => s.officeId === officeId)
      if (status !== 'all') list = list.filter(s => s.status === status)
      if (keyword) list = list.filter(s => (s.code + s.id + s.officeName + s.owner + s.ownerName).toLowerCase().includes(keyword))
      const total = state.seats.length
      const used = state.seats.filter(s => s.status === 'used').length
      const repair = state.seats.filter(s => s.status === 'repair').length
      return send(res, 200, {
        ok: true,
        list,
        stats: {
          total, used, free: total - used - repair, repair,
          rate: total ? Math.round((used / total) * 100) : 0,
          offices: state.offices.length,
          students: state.students.length,
          pending: state.apps.filter(a => a.status === 'pending').length
        }
      })
    }
    if (seg[1] === 'admin' && seg[2] === 'seats' && seg[3] && seg[4] === 'status' && req.method === 'POST') {
      const r = await transaction(() => {
        const seat = findSeat(decodeURIComponent(seg[3]))
        if (!seat) return fail(404, 'SEAT_NOT_FOUND', '工位不存在')
        if (body.status !== 'free' && body.status !== 'repair') return fail(400, 'PARAM_ERROR', '状态不合法')
        if (body.status === 'free' && seat.owner) return fail(409, 'HAS_OWNER', '该工位已有人登记，请先释放归属')
        seat.status = body.status
        if (body.status === 'repair') {
          seat.owner = null
          seat.ownerName = ''
          seat.claimedAt = ''
          seat.termStart = ''
          seat.termEnd = ''
        }
        pushLog({ id: 'cl_' + Date.now(), seatId: seat.id, seatCode: seat.code, studentId: '', studentName: '', action: body.status === 'repair' ? 'disable' : 'enable', operator: body.operator || '管理员', time: nowText() })
        return ok({ seat: seatView(seat, ''), msg: body.status === 'repair' ? '已停用' : '已恢复为空闲' })
      })
      return send(res, r.status, r.body)
    }
    if (seg[1] === 'admin' && seg[2] === 'seats' && seg[3] && seg[4] === 'code' && req.method === 'POST') {
      const r = await transaction(() => {
        const seat = findSeat(decodeURIComponent(seg[3]))
        if (!seat) return fail(404, 'SEAT_NOT_FOUND', '工位不存在')
        const code = String(body.code || '').trim()
        if (!code) return fail(400, 'PARAM_ERROR', '编号不能为空')
        if (state.seats.find(s => s.code === code && s.id !== seat.id)) return fail(409, 'CODE_DUP', '编号已存在')
        seat.code = code
        seat.no = seatNo(code, seat.no)
        seat.codeEdited = true
        return ok({ seat: seatView(seat, '') })
      })
      return send(res, r.status, r.body)
    }

    /* 后台：学生 */
    if (seg[1] === 'admin' && seg[2] === 'students' && !seg[3] && req.method === 'GET') {
      return send(res, 200, { ok: true, list: state.students })
    }
    if (seg[1] === 'admin' && seg[2] === 'students' && !seg[3] && req.method === 'POST') {
      const r = await transaction(() => {
        const id = String(body.id || '').trim()
        if (!id) return fail(400, 'PARAM_ERROR', '学号不能为空')
        if (state.students.find(s => s.id === id)) return fail(409, 'EXIST', '学号 ' + id + ' 已存在')
        const student = {
          id, name: String(body.name || '').trim(), password: body.password || '123456', role: 'student',
          college: body.college || '', grade: body.grade || '', tutor: body.tutor || '',
          phone: body.phone || '', email: body.email || ''
        }
        state.students.push(student)
        return ok({ student })
      })
      return send(res, r.status, r.body)
    }
    if (seg[1] === 'admin' && seg[2] === 'students' && seg[3] === 'delete' && req.method === 'POST') {
      const r = await transaction(() => {
        const ids = body.ids || []
        const blocked = ids.filter(id => state.seats.some(s => s.owner === id))
        if (blocked.length) return fail(409, 'HAS_SEAT', '以下学生仍有工位归属，请先释放：' + blocked.join('、'))
        state.students = state.students.filter(s => ids.indexOf(s.id) < 0)
        return ok({ removed: ids.length })
      })
      return send(res, r.status, r.body)
    }
    if (seg[1] === 'admin' && seg[2] === 'students' && seg[3] === 'import' && req.method === 'POST') {
      const r = await transaction(() => {
        const rows = body.rows || []
        const added = []
        const updated = []
        const failed = []
        rows.forEach(row => {
          const id = String(row.id || '').trim()
          const name = String(row.name || '').trim()
          if (!id || !name) return failed.push(id || '空行')
          const exist = state.students.find(s => s.id === id)
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
            state.students.push({
              id, name, password: row.password || '123456', role: 'student',
              college: row.college || '', grade: row.grade || '', tutor: row.tutor || '',
              phone: row.phone || '', email: row.email || ''
            })
            added.push(id)
          }
        })
        return ok({ added, updated, failed })
      })
      return send(res, r.status, r.body)
    }
    if (seg[1] === 'admin' && seg[2] === 'students' && seg[3] === 'export' && req.method === 'GET') {
      const head = ['学号', '姓名', '学院', '年级', '导师', '手机', '邮箱']
      const rows = state.students.map(s => [s.id, s.name, s.college || '', s.grade || '', s.tutor || '', s.phone || '', s.email || ''].join('\t'))
      return send(res, 200, { ok: true, text: [head.join('\t')].concat(rows).join('\n') })
    }
    if (seg[1] === 'admin' && seg[2] === 'students' && seg[3] && req.method === 'POST') {
      const r = await transaction(() => {
        const student = state.students.find(s => s.id === decodeURIComponent(seg[3]))
        if (!student) return fail(404, 'NOT_FOUND', '学生不存在')
        ;['name', 'college', 'grade', 'tutor', 'phone', 'email', 'password'].forEach(f => {
          if (body[f]) student[f] = body[f]
        })
        return ok({ student })
      })
      return send(res, r.status, r.body)
    }

    /* 二维码内容 */
    if (seg[1] === 'qr' && seg[2] && req.method === 'GET') {
      const seat = findSeat(decodeURIComponent(seg[2]))
      const token = seat ? seat.id : decodeURIComponent(seg[2])
      return send(res, 200, { ok: true, code: token, qrContent: `${QR_BASE}/s/${token}` })
    }

    return send(res, 404, { ok: false, code: 'NOT_FOUND', msg: '接口不存在' })
  } catch (e) {
    return send(res, 500, { ok: false, code: 'SERVER_ERROR', msg: String(e && e.message) })
  }
})

/**
 * 启动：先把存储初始化好、把状态读出来再监听端口，
 * 避免请求进来时 state 还是空的（云托管容器首次启动时尤其明显）。
 * 没有历史数据时用演示数据播种并立即落库。
 */
/**
 * 初始化存储：不是一次成功就一直重试。
 * 云托管部署时会同时做「健康检查」和「数据库连通性」两件事，
 * 若数据库还没准备好（自动暂停 / IP 不通），也不能让整个容器起不来，
 * 否则探针直接判部署失败，日志里什么都看不到（这是本次失败的真正原因）。
 */
let bootText = ''
let lastBootError = ''
async function initStorageWithRetry() {
  let attempt = 0
  while (!state) {
    attempt++
    try {
      bootText = '正在初始化存储（第 ' + attempt + ' 次尝试）'
      await storage.init()
      const loaded = await storage.load()
      if (loaded) state = loaded
      else {
        const fresh = seedState()
        await storage.save(fresh)
        state = fresh
      }
      bootText = '就绪'
      lastBootError = ''
      console.log(`存储模式 ${storage.mode} · 办公室 ${state.offices.length} 间 · 工位 ${state.seats.length} 个`)
      return
    } catch (e) {
      lastBootError = String((e && (e.code ? e.code + ' ' : '') + (e.message || e)) || e)
      bootText = '初始化失败（第 ' + attempt + ' 次）：' + lastBootError
      console.error(bootText)
      /* 数据库可能只是「自动暂停」或还没就绪：一直重试（最长 15 秒一次），
         容器保持存活，配置改好后重启一次就能自愈 */
      await new Promise(r => setTimeout(r, Math.min(3000 * attempt, 15000)))
    }
  }
}

async function bootstrap() {
  /* 先监听端口，保证云托管的存活探针（/__tcb_probe__）能拿到 200，
     再去连数据库；连不上的话每 3 秒重试一次，日志里能直接看到原因。 */
  await new Promise(resolve => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`工位登记服务已启动: http://0.0.0.0:${PORT} · 存储模式 ${storage.mode}`)
      resolve()
    })
  })
  await initStorageWithRetry()
}

bootstrap().catch(err => {
  console.error('启动失败：' + (err && err.stack))
  /* 不退出：端口已经监听，留着让日志可查；探针仍会因为这里出问题重启容器 */
})

/* 兜底日志：任何未捕获异常都打出来，避免容器静默退出后无从排查 */
process.on('uncaughtException', err => { console.error('未捕获异常：' + (err && err.stack)) })
process.on('unhandledRejection', err => { console.error('未处理的 Promise 拒绝：' + (err && (err.stack || err.message))) })

/* 容器停机时尽量把内存里的状态刷回去（file 模式本来每次事务都落盘） */
process.on('SIGTERM', () => {
  Promise.resolve()
    .then(() => (state ? storage.save(state) : null))
    .catch(() => {})
    .then(() => process.exit(0))
})
