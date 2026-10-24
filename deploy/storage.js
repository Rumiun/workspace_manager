/**
 * 存储层（本地文件 / 云数据库两套实现，靠环境变量切换）
 *
 * 为什么要抽象：
 *   微信云托管是「随时可能重启 / 扩缩容」的容器，容器内的文件系统**不保证持久化**，
 *   直接把 state.json 和图片写在本地磁盘上，重启就全丢（办公室、工位、地图都没了）。
 *   所以把「业务状态」和「地图照片」两样东西抽成同一套接口：
 *
 *     init()                      初始化（建表 / 建目录）
 *     load()          -> state    读取业务状态（没有则返回 null，由上层播种）
 *     save(state)                 写业务状态
 *     putImage(name, ext, buf)    保存照片
 *     getImage(name)  -> Buffer   读取照片（没有返回 null）
 *
 * 切换：
 *   不配 DB_HOST           → file  ：server/data/state.json + server/data/uploads（本地开发用，零依赖）
 *   配了 DB_HOST           → mysql ：云数据库 MySQL（云托管部署用，重启不丢）
 *   STORAGE=file|mysql     可强行指定
 *
 * 注意：mysql 驱动是**用到才 require**，本地 file 模式完全不需要装依赖。
 */
const fs = require('fs')
const path = require('path')

const DATA_DIR = path.join(__dirname, 'data')
const STATE_FILE = path.join(DATA_DIR, 'state.json')
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads')
const STATE_ROW = 'default'

/* ---------------- 本地文件实现 ---------------- */
const fileAdapter = {
  name: 'file',
  init: function () {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })
    return Promise.resolve()
  },
  load: function () {
    try {
      if (fs.existsSync(STATE_FILE)) return Promise.resolve(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')))
    } catch (e) {}
    return Promise.resolve(null)
  },
  save: function (state) {
    return Promise.resolve().then(function () {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
    })
  },
  putImage: function (name, ext, buf) {
    return Promise.resolve().then(function () {
      if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })
      fs.writeFileSync(path.join(UPLOAD_DIR, name), buf)
    })
  },
  getImage: function (name) {
    return Promise.resolve().then(function () {
      const file = path.join(UPLOAD_DIR, name)
      if (!name || /[\\/]|\.\./.test(name) || !fs.existsSync(file)) return null
      return fs.readFileSync(file)
    })
  }
}

/* ---------------- 云数据库（MySQL）实现 ---------------- */
let driver = null          // 可被测试注入（__setDriver）
let pool = null

/** 当前生效的连接参数（隐藏密码），用于 /api/_diag 排查「容器到底读到了什么」 */
function describe() {
  if (impl && impl.name !== 'mysql') return { mode: 'file' }
  return {
    mode: 'mysql',
    host: process.env.DB_HOST || '',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || 'seat',
    user: process.env.DB_USER || 'root',
    hasPassword: !!process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true',
    connectTimeout: Number(process.env.DB_TIMEOUT || 15000)
  }
}

function mysqlConfig() {
  return {
    host: process.env.DB_HOST || '',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'seat',
    ssl: process.env.DB_SSL === 'true' ? {} : undefined,
    connectionLimit: Number(process.env.DB_POOL || 4),
    charset: 'utf8mb4',
    waitForConnections: true,
    // 云数据库开启了「自动暂停」时，唤醒需要几秒，别用默认的短超时
    connectTimeout: Number(process.env.DB_TIMEOUT || 15000)
  }
}

/** 优先 mysql2/promise，其次 mysql/promise；都没装则给出明确报错 */
function getDriver() {
  if (driver) return driver
  const tries = ['mysql2/promise', 'mysql/promise']
  for (const name of tries) {
    try {
      const mod = require(name)
      if (mod && typeof mod.createPool === 'function') {
        driver = mod
        return driver
      }
    } catch (e) {}
  }
  throw new Error('云数据库模式需要 mysql2：npm i mysql2（已列入 optionalDependencies）')
}

const TABLES = [
  'CREATE TABLE IF NOT EXISTS app_state (' +
  '  id VARCHAR(64) NOT NULL PRIMARY KEY,' +
  '  data LONGTEXT NOT NULL,' +
  '  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' +
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
  'CREATE TABLE IF NOT EXISTS map_image (' +
  '  name VARCHAR(191) NOT NULL PRIMARY KEY,' +
  '  ext VARCHAR(16) NOT NULL DEFAULT \'.jpg\',' +
  '  size INT NOT NULL DEFAULT 0,' +
  '  content LONGBLOB NOT NULL,' +
  '  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP' +
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
]

/* 连接被回收 / 数据库从「自动暂停」中唤醒时的典型错误码 */
const RETRY_RE = /PROTOCOL_CONNECTION_LOST|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ER_SERVER_SHUTDOWN|ER_CON_COUNT_ERROR|PROTOCOL_SEQUENCE_TIMEOUT|Connection lost|closed state|Cannot enqueue/i

function newPool() {
  pool = getDriver().createPool(mysqlConfig())
  return pool
}

function resetPool() {
  const old = pool
  pool = null
  try {
    if (old && typeof old.end === 'function') old.end(function () {})
  } catch (e) {}
}

/**
 * 统一出口：连接池还没建/已被回收就重建，遇到连接类错误重试一次。
 * 云托管 MySQL 可以「自动暂停」，暂停后旧连接全部失效，
 * 不重试的话用户第一次打开页面会直接 500（第二次才正常）。
 */
function query(sql, params, retried) {
  if (!pool) newPool()
  return Promise.resolve(pool.query(sql, params)).catch(function (err) {
    const text = String((err && (err.code || err.message)) || '')
    if (!retried && RETRY_RE.test(text)) {
      resetPool()
      return query(sql, params, true)
    }
    throw err
  })
}

const mysqlAdapter = {
  name: 'mysql',
  init: function () {
    return Promise.resolve().then(function () {
      if (!pool) newPool()
      return TABLES.reduce(function (chain, sql) {
        return chain.then(function () { return query(sql) })
      }, Promise.resolve())
    })
  },
  load: function () {
    return Promise.resolve()
      .then(function () { return query('SELECT data FROM app_state WHERE id = ?', [STATE_ROW]) })
      .then(function (rows) {
        const list = Array.isArray(rows) ? rows : (rows && rows[0]) || []
        if (!list.length) return null
        const raw = list[0] && list[0].data
        if (raw == null || raw === '') return null
        return typeof raw === 'string' ? JSON.parse(raw) : raw
      })
  },
  save: function (state) {
    const data = typeof state === 'string' ? state : JSON.stringify(state)
    return Promise.resolve().then(function () {
      return query(
        'INSERT INTO app_state (id, data) VALUES (?, ?) ' +
        'ON DUPLICATE KEY UPDATE data = VALUES(data)',
        [STATE_ROW, data]
      )
    })
  },
  putImage: function (name, ext, buf) {
    return Promise.resolve().then(function () {
      return query(
        'INSERT INTO map_image (name, ext, size, content) VALUES (?, ?, ?, ?) ' +
        'ON DUPLICATE KEY UPDATE ext = VALUES(ext), size = VALUES(size), content = VALUES(content)',
        [name, ext || '.jpg', buf.length, buf]
      )
    })
  },
  getImage: function (name) {
    if (!name) return Promise.resolve(null)
    return Promise.resolve()
      .then(function () { return query('SELECT content FROM map_image WHERE name = ?', [name]) })
      .then(function (rows) {
        const list = Array.isArray(rows) ? rows : (rows && rows[0]) || []
        if (!list.length || !list[0] || list[0].content == null) return null
        return Buffer.isBuffer(list[0].content) ? list[0].content : Buffer.from(list[0].content)
      })
  }
}

/* ---------------- 选择实现 ---------------- */
function choose() {
  const force = (process.env.STORAGE || '').toLowerCase()
  if (force === 'mysql') return mysqlAdapter
  if (force === 'file') return fileAdapter
  return process.env.DB_HOST ? mysqlAdapter : fileAdapter
}

let impl = choose()

const api = {
  /** 当前实现名：file / mysql */
  get mode() { return impl.name },
  init: function () { return impl.init() },
  load: function () { return impl.load() },
  save: function (state) { return impl.save(state) },
  putImage: function (name, ext, buf) { return impl.putImage(name, ext, buf) },
  getImage: function (name) { return impl.getImage(name) },
  /** 当前生效的连接参数（不含密码），排查环境变量用 */
  describe: describe,
  /* 仅供测试：注入假驱动 / 强制某种实现 */
  __setDriver: function (d) { driver = d },
  __use: function (adapter) { impl = adapter },
  __adapters: { file: fileAdapter, mysql: mysqlAdapter }
}

module.exports = api
