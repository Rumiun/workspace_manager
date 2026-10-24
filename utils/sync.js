/**
 * 服务端数据同步（单一数据源）
 *
 * 原则：服务端为准，本地缓存只作渲染缓冲区。
 * - 已登录才拉取；没登录不产生任何请求
 * - 同一次会话内默认 3 秒内的重复请求会被合并，避免页面来回切疯狂打接口
 * - 拉到的数据整体覆盖本地缓存（store.applyServerSnapshot），返回是否有变化
 * - 管理员拉全量申请，学生只拉自己的申请
 */

var api = require('./api.js')
var store = require('./store.js')

var pulling = false
var lastAt = 0
var FRESH_MS = 3000

/**
 * 拉一次服务端快照覆盖本地缓存
 * @param {boolean} [force] 忽略节流（写操作后立即刷新时使用）
 * @returns {Promise<boolean>} 数据是否有变化
 */
function pull(force) {
  var now = Date.now()
  if (!force && pulling) return Promise.resolve(false)
  if (!force && lastAt && now - lastAt < FRESH_MS) return Promise.resolve(false)

  var user = store.getCurrentUser()
  if (!user) return Promise.resolve(false)
  pulling = true

  var isAdmin = user.role === 'admin'
  return Promise.all([
    api.getOffices().catch(function () { return null }),
    api.adminSeats({ status: 'all' }, user).catch(function () { return null }),
    api.getSettings().catch(function () { return null }),
    (isAdmin ? api.getApps({}) : api.getApps({ studentId: user.id })).catch(function () { return null }),
    (isAdmin ? api.getStudents() : Promise.resolve(null)).catch(function () { return null })
  ]).then(function (r) {
    lastAt = Date.now()
    return store.applyServerSnapshot({
      offices: r[0] && r[0].list,
      seats: r[1] && r[1].list,
      settings: r[2] && r[2].settings,
      apps: r[3] && r[3].list,
      students: r[4] && r[4].list
    })
  }).catch(function () {
    return false
  }).then(function (changed) {
    pulling = false
    return changed
  })
}

/** 写操作之后用：强制刷新一次（跳过节流），保证看到的是服务端最新结果 */
function refresh() {
  lastAt = 0
  return pull(true)
}

/** 标记数据已过期（比如下一次进页面时希望强制重拉） */
function invalidate() {
  lastAt = 0
}

module.exports = {
  pull: pull,
  refresh: refresh,
  invalidate: invalidate
}
