/**
 * Excel 文件处理：上传解析 + 示例/导出文件保存到本地设备
 *
 * 支持：
 *   .xlsx  直接解析（zip + sharedStrings + sheet1，UTF-8 无乱码问题）
 *   .csv/.txt  按 UTF-8 解析（自动识别逗号 / 制表符 / 分号分隔，支持引号）
 *   .xls   老版二进制格式，须另存为 xlsx 或 csv 后上传
 *
 * 依赖 utils/inflate.js（pako inflateRaw，MIT/Zlib）用于解压 xlsx 内部的 zip
 */
var inflate = require('./inflate.js')

/* ---------------- 编码 ---------------- */
function utf8Decode(bytes) {
  var out = ''
  var i = 0
  while (i < bytes.length) {
    var b = bytes[i]
    if (b < 0x80) {
      out += String.fromCharCode(b)
      i += 1
    } else if (b >= 0xc0 && b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f))
      i += 2
    } else if (b >= 0xe0 && b < 0xf0) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f))
      i += 3
    } else {
      out += String.fromCharCode(((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f))
      i += 4
    }
  }
  return out
}

function utf8Encode(text) {
  var bytes = []
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i)
    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      var next = text.charCodeAt(i + 1)
      var cp = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
      bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
      i += 1
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    }
  }
  return new Uint8Array(bytes)
}

function decodeXml(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(parseInt(d, 10)) })
    .replace(/&amp;/g, '&')
}

/* ---------------- CSV / 文本表格 ---------------- */
function splitLine(line, sep) {
  var cells = []
  var cur = ''
  var inQuote = false
  for (var i = 0; i < line.length; i++) {
    var ch = line.charAt(i)
    if (inQuote) {
      if (ch === '"') {
        if (line.charAt(i + 1) === '"') { cur += '"'; i += 1 } else inQuote = false
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuote = true
    } else if (ch === sep) {
      cells.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur.trim())
  return cells
}

function parseCsvText(text) {
  var lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(function (l) { return l.trim() })
  if (!lines.length) return []
  var sample = lines[0]
  var candidates = [',', '\t', ';']
  var sep = ','
  var best = -1
  candidates.forEach(function (c) {
    var count = sample.split(c).length
    if (count > best) { best = count; sep = c }
  })
  return lines.map(function (l) { return splitLine(l, sep) })
}

/* ---------------- xlsx ---------------- */
function readZip(buffer) {
  var view = new DataView(buffer)
  var bytes = new Uint8Array(buffer)
  var eocd = -1
  var min = Math.max(0, bytes.length - 66000)
  for (var i = bytes.length - 22; i >= min; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('文件格式不正确，请上传 xlsx 或 CSV 文件')
  var count = view.getUint16(eocd + 10, true)
  var cdOff = view.getUint32(eocd + 16, true)
  var entries = {}
  var p = cdOff
  for (var n = 0; n < count; n++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) break
    var method = view.getUint16(p + 10, true)
    var compSize = view.getUint32(p + 20, true)
    var nameLen = view.getUint16(p + 28, true)
    var extraLen = view.getUint16(p + 30, true)
    var commentLen = view.getUint16(p + 32, true)
    var localOff = view.getUint32(p + 42, true)
    var name = utf8Decode(bytes.subarray(p + 46, p + 46 + nameLen))
    var lnameLen = view.getUint16(localOff + 26, true)
    var lextraLen = view.getUint16(localOff + 28, true)
    var dataStart = localOff + 30 + lnameLen + lextraLen
    entries[name] = { method: method, data: bytes.subarray(dataStart, dataStart + compSize) }
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function unzipEntry(entry) {
  if (!entry) return ''
  if (entry.method === 0) return utf8Decode(entry.data)
  var out = inflate.inflateRaw(entry.data)
  return utf8Decode(out)
}

function colIndex(ref) {
  var n = 0
  for (var i = 0; i < ref.length; i++) n = n * 26 + (ref.charCodeAt(i) - 64)
  return n - 1
}

function parseSharedStrings(xml) {
  var shared = []
  var siRe = /<si>([\s\S]*?)<\/si>/g
  var m
  while ((m = siRe.exec(xml))) {
    var text = ''
    var tRe = /<t[^>]*>([\s\S]*?)<\/t>/g
    var t
    while ((t = tRe.exec(m[1]))) text += decodeXml(t[1])
    shared.push(text)
  }
  return shared
}

function parseSheet(xml, shared) {
  var rows = []
  var rowRe = /<row[^>]*>([\s\S]*?)<\/row>|<row[^>]*\/\s*>/g
  var rm
  while ((rm = rowRe.exec(xml))) {
    var inner = rm[1] || ''
    var cells = []
    var cRe = /<c\b([^>]*?)\/?>([\s\S]*?)<\/c>|<c\b([^>]*?)\/\s*>/g
    var cm
    var order = 0
    while ((cm = cRe.exec(inner))) {
      var attrs = cm[1] || cm[3] || ''
      var ref = /r="([A-Z]+)\d*"/.exec(attrs)
      var col = ref ? colIndex(ref[1]) : order
      order += 1
      var typeMatch = /t="([^"]+)"/.exec(attrs)
      var type = typeMatch ? typeMatch[1] : 'n'
      var value = ''
      if (type === 's') {
        var v = /<v>([\s\S]*?)<\/v>/.exec(cm[2] || '')
        if (v) value = shared[parseInt(v[1], 10)] || ''
      } else if (type === 'inlineStr') {
        var t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(cm[2] || '')
        value = t ? decodeXml(t[1]) : ''
      } else {
        var v2 = /<v>([\s\S]*?)<\/v>/.exec(cm[2] || '')
        if (v2) value = decodeXml(v2[1])
      }
      cells[col] = String(value).trim()
    }
    for (var i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = ''
    if (cells.join('')) rows.push(cells)
  }
  return rows
}

/** 解析 xlsx（ArrayBuffer）为二维数组 */
function parseXlsxBuffer(buffer) {
  var entries = readZip(buffer)
  var shared = []
  if (entries['xl/sharedStrings.xml']) shared = parseSharedStrings(unzipEntry(entries['xl/sharedStrings.xml']))
  var sheetEntry = entries['xl/worksheets/sheet1.xml']
  if (!sheetEntry) {
    Object.keys(entries).forEach(function (name) {
      if (!sheetEntry && /^xl\/worksheets\/sheet\d*\.xml$/.test(name)) sheetEntry = entries[name]
    })
  }
  if (!sheetEntry) throw new Error('未找到工作表内容')
  return parseSheet(unzipEntry(sheetEntry), shared)
}

/* ---------------- 文件读取 ---------------- */
function extOf(name) {
  var m = /\.[A-Za-z0-9]+$/.exec(String(name || ''))
  return m ? m[0].toLowerCase() : ''
}

/**
 * 读取上传文件为二维数组
 * @param {string} path 临时文件路径
 * @param {string} name 原始文件名（用于判断类型）
 */
function readUploadedFile(path, name) {
  return new Promise(function (resolve, reject) {
    var fs = wx.getFileSystemManager()
    var ext = extOf(name)
    if (ext === '.xls') {
      reject(new Error('不支持 .xls 旧格式，请在 Excel 中另存为 .xlsx 或 CSV UTF-8'))
      return
    }
    if (ext === '.xlsx') {
      fs.readFile({
        filePath: path,
        success: function (res) {
          try {
            resolve(parseXlsxBuffer(res.data))
          } catch (e) {
            reject(e)
          }
        },
        fail: function (err) { reject(new Error('文件读取失败：' + (err.errMsg || ''))) }
      })
      return
    }
    fs.readFile({
      filePath: path,
      encoding: 'utf8',
      success: function (res) {
        var text = typeof res.data === 'string' ? res.data : utf8Decode(new Uint8Array(res.data))
        resolve(parseCsvText(text))
      },
      fail: function (err) { reject(new Error('文件读取失败：' + (err.errMsg || ''))) }
    })
  })
}

/* ---------------- 保存到本地设备 ---------------- */
/** 写入 CSV（含 BOM，Excel 打开不乱码），返回文件路径 */
function saveCsvFile(fileName, text) {
  return new Promise(function (resolve, reject) {
    var fs = wx.getFileSystemManager()
    var path = (wx.env && wx.env.USER_DATA_PATH ? wx.env.USER_DATA_PATH : '') + '/' + fileName
    var bytes = utf8Encode('\uFEFF' + text)
    var buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    fs.writeFile({
      filePath: path,
      data: buffer,
      encoding: 'binary',
      success: function () { resolve(path) },
      fail: function (err) { reject(new Error('文件保存失败：' + (err.errMsg || ''))) }
    })
  })
}

/**
 * 保存到本地设备 / 打开预览
 * PC 端（Windows/Mac 微信）优先调用 wx.saveFileToDisk 直接另存；移动端打开预览后可转发保存
 */
function saveToDevice(filePath, fileName) {
  // 电脑端微信：直接另存到本机磁盘
  if (typeof wx.saveFileToDisk === 'function') {
    return new Promise(function (resolve, reject) {
      wx.saveFileToDisk({
        filePath: filePath,
        success: function () { resolve('saved') },
        fail: function () { openDocument(filePath, fileName).then(resolve, reject) }
      })
    })
  }
  return openDocument(filePath, fileName)
}

function openDocument(filePath, fileName) {
  return new Promise(function (resolve, reject) {
    wx.openDocument({
      filePath: filePath,
      fileType: 'csv',
      showMenu: true,
      success: function () { resolve('opened') },
      fail: function () { shareFile(filePath, fileName).then(resolve, reject) }
    })
  })
}

/** 移动端：转发文件（可发给文件传输助手后保存到设备） */
function shareFile(filePath, fileName) {
  return new Promise(function (resolve, reject) {
    if (typeof wx.shareFileMessage !== 'function') {
      reject(new Error('已保存到小程序本地：' + filePath))
      return
    }
    wx.shareFileMessage({
      filePath: filePath,
      fileName: fileName || '研究生名单.csv',
      success: function () { resolve('shared') },
      fail: function (err) { reject(new Error('保存失败：' + (err.errMsg || ''))) }
    })
  })
}

/** 导出/下载：生成文件并保存到设备 */
function downloadCsv(fileName, text) {
  return saveCsvFile(fileName, text).then(function (path) {
    return saveToDevice(path, fileName).then(function () { return path })
  })
}

module.exports = {
  parseCsvText: parseCsvText,
  parseXlsxBuffer: parseXlsxBuffer,
  readUploadedFile: readUploadedFile,
  saveCsvFile: saveCsvFile,
  saveToDevice: saveToDevice,
  downloadCsv: downloadCsv,
  extOf: extOf
}
