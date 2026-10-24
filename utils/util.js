function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

function formatDate(d) {
  var date = d ? new Date(d) : new Date()
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

function formatTime(d) {
  var date = d ? new Date(d) : new Date()
  return pad(date.getHours()) + ':' + pad(date.getMinutes())
}

function formatDateTime(ts) {
  if (!ts) return ''
  var d = new Date(ts)
  return formatDate(d) + ' ' + formatTime(d)
}

function offsetDay(n) {
  var d = new Date()
  d.setDate(d.getDate() + n)
  return formatDate(d)
}

function weekday(dateStr) {
  var d = dateStr ? new Date(dateStr.replace(/-/g, '/')) : new Date()
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
}

function diffMinutes(startTs, endTs) {
  if (!startTs || !endTs) return 0
  return Math.max(0, Math.round((endTs - startTs) / 60000))
}

function durationText(minutes) {
  if (!minutes) return '0 分钟'
  var h = Math.floor(minutes / 60)
  var m = minutes % 60
  if (h === 0) return m + ' 分钟'
  return h + ' 小时 ' + (m ? m + ' 分' : '')
}

function monthInfo(year, month) {
  var now = new Date()
  var y = year || now.getFullYear()
  var m = month || now.getMonth() + 1
  var first = new Date(y, m - 1, 1)
  var days = new Date(y, m, 0).getDate()
  var list = []
  for (var i = 0; i < first.getDay(); i++) list.push({ empty: true })
  for (var d = 1; d <= days; d++) {
    list.push({ day: d, date: y + '-' + pad(m) + '-' + pad(d) })
  }
  return { year: y, month: m, days: list }
}

function uuid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function toast(title, icon) {
  wx.showToast({ title: title, icon: icon || 'none', duration: 1500 })
}

/** 姓名脱敏：张明 -> 张*，欧阳小明 -> 欧***明 */
function maskName(name) {
  if (!name) return ''
  if (name.length === 1) return name
  if (name.length === 2) return name.charAt(0) + '*'
  var stars = new Array(name.length - 1).join('*')
  return name.charAt(0) + stars + name.charAt(name.length - 1)
}

/** 学号脱敏：2023001 -> 2023*** */
function maskId(id) {
  if (!id) return ''
  if (id.length <= 4) return id
  return id.slice(0, 4) + '***'
}

/**
 * 解析二维码 / 扫码结果中的工位编号
 * 支持：
 *   https://seat.example.edu.cn/s/A-0102
 *   https://seat.example.edu.cn/r?code=A-0102
 *   A-0102
 */
function parseSeatCode(input) {
  if (!input) return ''
  var raw = String(input)
  try {
    if (raw.indexOf('%') >= 0) raw = decodeURIComponent(raw)
  } catch (e) {}
  var m = raw.match(/[?&]code=([^&#]+)/)
  if (m) return decodeURIComponent(m[1]).trim()
  m = raw.match(/\/s\/([A-Za-z0-9_\-]+)/)
  if (m) return m[1]
  var text = raw.trim()
  if (/^[A-Za-z]-?\d{2,4}$/.test(text)) return text.toUpperCase()
  return ''
}

module.exports = {
  maskName: maskName,
  maskId: maskId,
  parseSeatCode: parseSeatCode,
  pad: pad,
  formatDate: formatDate,
  formatTime: formatTime,
  formatDateTime: formatDateTime,
  offsetDay: offsetDay,
  weekday: weekday,
  diffMinutes: diffMinutes,
  durationText: durationText,
  monthInfo: monthInfo,
  uuid: uuid,
  toast: toast
}
