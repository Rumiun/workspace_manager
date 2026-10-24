/**
 * 接口层（工位归属 / 办公室 / 学生 / 设置）
 * 页面只依赖本层，不直接操作存储；USE_MOCK 切换本地演示数据与真实后端。
 *
 * 约定：工位以不可变 id（S0001…）为准，二维码内容 = {QR_BASE}/s/{id}，
 *      所有工位相关接口使用 token（id 或展示编号）定位。
 *
 * 业务错误码：SEAT_NOT_FOUND / SEAT_TAKEN / SEAT_DISABLED / ALREADY_HAS_SEAT / NO_AUTH / NOT_CLAIMED / HAS_OWNER
 */
var config = require('./config.js')
var store = require('./store.js')

function canCloudRun() {
  return !!(config.CLOUD_RUN && config.CLOUD_ENV &&
    typeof wx !== 'undefined' && wx.cloud && typeof wx.cloud.callContainer === 'function')
}

/**
 * 微信云托管调用：wx.cloud.callContainer 走微信内网，
 * 不需要在小程序后台配置 request 合法域名（本地调试要配域名时关掉它）。
 * 返回结构与 wx.request 对齐后才交给上层：ok 与否、code、msg 都能照旧判断。
 */
function cloudRunHttp(method, path, data) {
  return new Promise(function (resolve, reject) {
    var header = { 'content-type': 'application/json' }
    if (config.CLOUD_SERVICE) header['X-WX-SERVICE'] = config.CLOUD_SERVICE
    wx.cloud.callContainer({
      config: { env: config.CLOUD_ENV },
      path: path,
      method: method,
      header: header,
      data: data || {},
      dataType: 'text',
      success: function (res) {
        var payload = res && res.data
        if (typeof payload === 'string') {
          try { payload = payload ? JSON.parse(payload) : {} } catch (e) { payload = {} }
        }
        var status = Number(res && res.statusCode) || 0
        if (status >= 200 && status < 300) return resolve(payload)
        resolve(payload && payload.code ? payload : { ok: false, code: 'HTTP_' + status, msg: '服务异常，请稍后重试' })
      },
      fail: function (err) {
        reject(err)
      }
    })
  })
}

function http(method, path, data) {
  if (canCloudRun()) return cloudRunHttp(method, path, data)
  return new Promise(function (resolve, reject) {
    wx.request({
      url: config.BASE_URL + path,
      method: method,
      data: data || {},
      header: { 'content-type': 'application/json' },
      timeout: 8000,
      success: function (res) {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(res.data)
        resolve(res.data && res.data.code ? res.data : { ok: false, code: 'HTTP_' + res.statusCode, msg: '服务异常，请稍后重试' })
      },
      fail: function (err) {
        reject(err)
      }
    })
  })
}

function mock(result) {
  return Promise.resolve(result)
}

function enc(token) {
  return encodeURIComponent(token)
}

function extOf(path) {
  var m = String(path || '').match(/\.[a-zA-Z0-9]+$/)
  return (m ? m[0] : '.jpg').toLowerCase()
}

/** 远程 / 本机直连地址不需要再拼 HOST */
function isDirect(src) {
  return /^(https?:|wxfile:|cloud:|\/\/)/i.test(String(src || ''))
}

/** 地图图片统一成可直接渲染的地址：服务端返回的 /uploads/xxx 补上 HOST */
function absImage(p) {
  var s = String(p || '')
  if (!s) return ''
  if (isDirect(s)) return s
  if (s.charAt(0) === '/') return config.assetBase() + s
  return s
}

/** 图片是否已经保存在服务端（http(s) 的就是云端） */
function isCloudImage(p) {
  return /^https?:/i.test(String(absImage(p)))
}

/**
 * 下载服务端图片到本地缓存后再渲染：
 * 避免 <image> 直连 http 地址时因合法域名 / 证书校验导致地图空白，
 * 下载失败会退回远程地址（仍能显示，只是依赖直连）。
 */
function downloadMapImage(url) {
  return new Promise(function (resolve) {
    var src = absImage(url)
    if (!src || !/^https?:/i.test(src) || typeof wx.downloadFile !== 'function') return resolve(src)
    wx.downloadFile({
      url: src,
      success: function (r) {
        if (r && r.statusCode >= 200 && r.statusCode < 300 && r.tempFilePath) return resolve(r.tempFilePath)
        resolve(src)
      },
      fail: function () { resolve(src) }
    })
  })
}

/**
 * 压缩后再上传：拍照原图动辄几 MB，压到 70% 可显著缩短上传耗时。
 * 微信云托管 callContainer 的请求体有大小限制，所以还要限制分辨率与体积，
 * 见 encodeForUpload()。
 */
function compressFile(path, quality, done, onError) {
  var finish = function (src) { done(src, extOf(src)) }
  if (typeof wx.compressImage !== 'function') return finish(path)
  wx.compressImage({
    src: path,
    quality: quality || 70,
    /* 地图照片不需要原图分辨率：限制宽度能大幅缩小 base64 体积。
       低版本基础库没有这两个参数，会被忽略（不影响功能）。 */
    compressedWidth: 1600,
    success: function (r) { finish((r && r.tempFilePath) || path) },
    fail: function () { finish(path) }
  })
}

function readBase64(path, done, onError) {
  var fs = typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : null
  if (!fs) return onError(new Error('no fs'))
  fs.readFile({
    filePath: path,
    encoding: 'base64',
    success: function (r) { done(r.data) },
    fail: onError
  })
}

/* 上传用的体积预算（base64 字符数）：
   callContainer 对请求体大小敏感，超过这个值就降质量重压一次。
   约 400KB base64 ≈ 300KB 原图，地图照片清晰度足够。 */
var UPLOAD_B64_BUDGET = 420 * 1024
var QUALITY_LADDER = [70, 50, 35, 20]

/** 压缩到「能传上去」为止：质量 70 → 50 → 35 → 20，逐级降 */
function encodeForUpload(path, cb, onError, step) {
  var i = step || 0
  compressFile(path, QUALITY_LADDER[i], function (src, ext) {
    readBase64(src, function (data) {
      if (data && data.length <= UPLOAD_B64_BUDGET) return cb(data, ext, src)
      if (i >= QUALITY_LADDER.length - 1) return cb(data, ext, src)   // 到底了，如实上传并由服务端判断
      encodeForUpload(path, cb, onError, i + 1)
    }, onError)
  }, onError)
}

/** 直连公网域名上传（callContainer 不可用 / 请求体过大时的兜底） */
function httpsUpload(payload) {
  var base = config.CLOUD_PUBLIC_BASE || config.BASE_URL
  if (!base || !/^https?:/i.test(base)) return Promise.reject(new Error('没有可用的公网地址'))
  return new Promise(function (resolve, reject) {
    wx.request({
      url: base + '/api/upload',
      method: 'POST',
      data: payload,
      header: { 'content-type': 'application/json' },
      timeout: 30000,
      success: function (r) {
        var d = r && r.data
        if (r.statusCode >= 200 && r.statusCode < 300 && d && d.ok) return resolve(d)
        reject(new Error((d && d.msg) || ('HTTP ' + r.statusCode)))
      },
      fail: function (err) { reject(new Error((err && err.errMsg) || 'request:fail')) }
    })
  })
}

module.exports = {
  /* ---------------- 工位 ---------------- */
  getSeat: function (token, user) {
    if (config.USE_MOCK) return mock(store.getSeatView(token, user))
    return http('GET', '/api/seats/' + enc(token) + (user ? '?studentId=' + enc(user.id) : ''))
  },

  claimSeat: function (token, user) {
    if (config.USE_MOCK) return mock(store.claimSeat(token, user))
    return http('POST', '/api/seats/' + enc(token) + '/claim', { studentId: user.id, name: user.name, role: user.role })
  },

  releaseSeat: function (token, user, force) {
    if (config.USE_MOCK) return mock(store.releaseSeatByCode(token, user, !!force))
    return http('POST', '/api/seats/' + enc(token) + '/release', { studentId: user.id, name: user.name, role: user.role, force: !!force })
  },

  seatLogs: function (token) {
    if (config.USE_MOCK) return mock({ ok: true, list: store.seatLogs(token) })
    return http('GET', '/api/seats/' + enc(token) + '/logs')
  },

  getMySeat: function (user) {
    if (config.USE_MOCK) {
      var seat = store.getMySeat(user.id)
      return mock({ ok: true, seat: seat ? store.seatView(seat, user.id) : null })
    }
    return http('GET', '/api/students/' + enc(user.id) + '/seat')
  },

  updateSeatCode: function (id, code) {
    if (config.USE_MOCK) return mock(store.updateSeatCode(id, code))
    return http('POST', '/api/admin/seats/' + enc(id) + '/code', { code: code })
  },

  /* ---------------- 申请（扫码提交） ---------------- */
  applySeat: function (token, user, reason) {
    if (config.USE_MOCK) {
      var pending = store.getMyApps(user.id).filter(function (a) { return a.status === 'pending' })[0]
      if (pending) return mock({ ok: false, msg: '已有待审批申请，请等待处理' })
      return mock(store.createApp({ studentId: user.id, studentName: user.name, seatToken: token, reason: reason }))
    }
    return http('POST', '/api/apps', { studentId: user.id, studentName: user.name, seatToken: token, reason: reason })
  },

  /* ---------------- 办公室 ---------------- */
  getOffices: function () {
    if (config.USE_MOCK) return mock({ ok: true, list: store.getOffices() })
    return http('GET', '/api/admin/offices')
  },

  addOffice: function (data) {
    if (config.USE_MOCK) return mock(store.addOffice(data))
    return http('POST', '/api/admin/offices', data)
  },

  updateOffice: function (id, patch) {
    if (config.USE_MOCK) return mock(store.updateOffice(id, patch))
    return http('POST', '/api/admin/offices/' + enc(id), patch)
  },

  removeOffice: function (id) {
    if (config.USE_MOCK) return mock(store.removeOffice(id))
    return http('POST', '/api/admin/offices/' + enc(id) + '/delete')
  },

  /* ---- 工位地图（自定义布局：上传照片 + 放置工位） ----
     地图照片与点位一律以服务端为准（config.MAP_ON_SERVER）：
       - 读取：GET /api/admin/offices/:id/map，并把图片地址补成绝对 URL、下载到本地缓存后渲染
       - 保存：POST /api/admin/offices/:id/map，成功后顺手写本地缓存（离线仍可看）
       - 服务端不可用（未启动 / 域名未配）时回落到本地缓存，并返回 source='local' 让页面标注出来 */
  getOfficeMap: function (officeId) {
    return this.officeMapFromServer(officeId)
  },

  officeMapFromLocal: function (officeId) {
    var res = store.getOfficeMap(officeId)
    res.source = 'local'
    res.image = absImage(res.image)
    return res
  },

  officeMapFromServer: function (officeId) {
    var self = this
    if (!config.MAP_ON_SERVER) return mock(self.officeMapFromLocal(officeId))
    return http('GET', '/api/admin/offices/' + enc(officeId) + '/map')
      .then(function (res) {
        if (!res || res.ok === false) return self.officeMapFromLocal(officeId)
        res.source = 'server'
        res.image = absImage(res.image)
        return res
      })
      .catch(function () { return self.officeMapFromLocal(officeId) })
  },

  saveOfficeMap: function (officeId, payload) {
    var self = this
    if (!config.MAP_ON_SERVER) return mock(store.saveOfficeMap(officeId, payload))
    return http('POST', '/api/admin/offices/' + enc(officeId) + '/map', payload)
      .then(function (res) {
        if (!res || res.ok === false) {
          // 服务端不可用：写本地缓存并如实告知，避免「以为存到服务器了」
          var r = store.saveOfficeMap(officeId, payload)
          r.source = 'local'
          r.msg = r.ok ? '服务端不可用，已只保存在本机' : (r.msg || '保存失败')
          return r
        }
        try { store.saveOfficeMap(officeId, payload) } catch (e) {}
        res.source = 'server'
        res.image = absImage(res.image)
        return res
      })
      .catch(function () {
        var r = store.saveOfficeMap(officeId, payload)
        r.source = 'local'
        r.msg = r.ok ? '服务端不可用，已只保存在本机' : (r.msg || '保存失败')
        return r
      })
  },

  setOfficeMapMode: function (officeId, mode) {
    var self = this
    if (!config.MAP_ON_SERVER) return mock(store.setOfficeMapMode(officeId, mode))
    return http('POST', '/api/admin/offices/' + enc(officeId) + '/map-mode', { mode: mode })
      .then(function (res) {
        if (!res || res.ok === false) {
          var r = store.setOfficeMapMode(officeId, mode)
          r.source = 'local'
          return r
        }
        try { store.setOfficeMapMode(officeId, mode) } catch (e) {}
        res.source = 'server'
        return res
      })
      .catch(function () {
        var r = store.setOfficeMapMode(officeId, mode)
        r.source = 'local'
        return r
      })
  },

  /** 地图图片地址处理 / 云端判定 / 下载到本地缓存 */
  absImage: absImage,
  isCloudImage: isCloudImage,
  downloadMapImage: downloadMapImage,

  /** 照片只保存在本机（云端不可用时兜底，重启小程序仍可读） */
  saveLocalImage: function (tempPath) {
    return new Promise(function (resolve) {
      var fs = typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : null
      var dir = wx.env && wx.env.USER_DATA_PATH
      var dest = dir ? dir + '/seat-map-' + Date.now() + extOf(tempPath) : ''
      var finish = function (p) { resolve({ ok: true, cloud: false, path: p }) }
      if (!fs || !dest) return finish(tempPath)
      try {
        fs.saveFile({
          tempFilePath: tempPath,
          filePath: dest,
          success: function () { finish(dest) },
          fail: function () { finish(tempPath) }
        })
      } catch (e) {
        finish(tempPath)
      }
    })
  },

  /**
   * 上传工位地图照片：压缩 → 读 base64 → POST /api/upload → 返回图片 URL（云端）
   * 服务端不可用（未启动 / 域名未配）时自动回退本机保存，功能不受影响
   */
  uploadSeatImage: function (tempPath) {
    var self = this
    if (!config.UPLOAD_CLOUD) return this.saveLocalImage(tempPath)
    return new Promise(function (resolve, reject) {
      encodeForUpload(tempPath, function (data, ext, src) {
        var payload = { ext: ext, data: data }
        var viaCloud = true
        /* 先走 callContainer；失败（体积超限 / 云调用不可用）再直连公网域名试一次 */
        http('POST', '/api/upload', payload).then(function (res) {
          if (!res || res.ok !== true || !res.url) throw new Error((res && res.msg) || '上传失败')
          return res
        }).catch(function (err) {
          viaCloud = false
          if (!config.CLOUD_RUN) throw err
          return httpsUpload(payload)
        }).then(function (res) {
          resolve({
            ok: true,
            cloud: true,
            via: viaCloud ? 'cloud' : 'https',
            /* 落库只存相对路径 /uploads/xxx：绝对地址里的 127.0.0.1 换到手机 / 其它电脑就失效了，
               客户端渲染前统一用 absImage() 拼上当前公网域名 */
            path: res.url,
            absPath: config.assetBase() + res.url,
            url: res.url,
            size: res.size
          })
        }).catch(function (err) {
          var why = (err && (err.errMsg || err.message)) || '未知原因'
          self.saveLocalImage(src).then(function (r) {
            resolve(Object.assign({}, r, { cloud: false, msg: '服务端上传失败（' + why + '），已只保存到本机' }))
          }, reject)
        })
      }, reject)
    })
  },

  /* ---------------- 后台工位 ---------------- */
  adminSeats: function (params, user) {
    if (config.USE_MOCK) return mock(store.adminSeats(params || {}))
    var query = []
    if (params && params.status) query.push('status=' + enc(params.status))
    if (params && params.keyword) query.push('keyword=' + enc(params.keyword))
    if (params && params.officeId) query.push('officeId=' + enc(params.officeId))
    return http('GET', '/api/admin/seats' + (query.length ? '?' + query.join('&') : ''))
  },

  adminSetSeatStatus: function (token, status, user) {
    if (config.USE_MOCK) return mock(store.adminSetSeatStatus(token, status, user))
    return http('POST', '/api/admin/seats/' + enc(token) + '/status', { status: status, operator: user ? user.id : '' })
  },

  /* ---------------- 学生信息 ---------------- */
  getStudents: function () {
    if (config.USE_MOCK) return mock({ ok: true, list: store.getStudents() })
    return http('GET', '/api/admin/students')
  },

  addStudent: function (data) {
    if (config.USE_MOCK) return mock(store.addStudent(data))
    return http('POST', '/api/admin/students', data)
  },

  updateStudent: function (id, patch) {
    if (config.USE_MOCK) return mock(store.updateStudent(id, patch))
    return http('POST', '/api/admin/students/' + enc(id), patch)
  },

  removeStudents: function (ids) {
    if (config.USE_MOCK) return mock(store.removeStudents(ids))
    return http('POST', '/api/admin/students/delete', { ids: ids })
  },

  importStudents: function (rows) {
    if (config.USE_MOCK) return mock(store.importStudents(rows))
    return http('POST', '/api/admin/students/import', { rows: rows })
  },

  parseStudentTable: function (text) {
    return store.parseStudentTable(text)
  },

  exportStudentsText: function () {
    if (config.USE_MOCK) return mock({ ok: true, text: store.exportStudentsText() })
    return http('GET', '/api/admin/students/export')
  },

  /* ---------------- 系统设置 ---------------- */
  getSettings: function () {
    if (config.USE_MOCK) {
      return mock({
        ok: true,
        settings: store.getSettings(),
        register: store.registerState(),
        term: store.currentTerm()
      })
    }
    return http('GET', '/api/settings')
  },

  saveSettings: function (patch) {
    if (config.USE_MOCK) return mock({ ok: true, settings: store.saveSettings(patch) })
    return http('POST', '/api/settings', patch)
  }
}
