/* 任务1 集成验收：图片上传 + 静态目录 + 自定义布局接口 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const PORT = 3999
process.env.PORT = String(PORT)
let fail = 0
const check = (n, a, e) => {
  const ok = String(a) === String(e)
  if (!ok) fail++
  console.log((ok ? 'PASS ' : 'FAIL ') + n + ' → ' + a + (ok ? '' : ' (期望 ' + e + ')'))
}
const ok = (n, c, i) => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + ' → ' + i) }

function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null
    const r = http.request({
      host: '127.0.0.1', port: PORT, path: p, method,
      headers: data ? { 'content-type': 'application/json', 'content-length': data.length } : {}
    }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks)
        let json = null
        try { json = JSON.parse(raw.toString()) } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, raw, json })
      })
    })
    r.on('error', reject)
    if (data) r.write(data)
    r.end()
  })
}

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
const child = spawn(process.execPath, [path.join(__dirname, 'index.js')], { stdio: 'ignore' })
const wait = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  await wait(800)
  let officeId
  try {
    console.log('=== 1. 图片上传接口 ===')
    let r = await req('POST', '/api/upload', { ext: '.png', data: PNG })
    check('上传成功', r.status, 200)
    ok('返回访问路径', !!(r.json && r.json.url), r.json && r.json.url)
    const url = r.json.url
    ok('文件名带随机后缀', /^\/uploads\/seat-map-\d+-[a-z0-9]+\.png$/.test(url), url)

    console.log('=== 2. 静态目录读取 ===')
    r = await req('GET', url)
    check('读取状态', r.status, 200)
    check('content-type', r.headers['content-type'], 'image/png')
    check('字节完全一致', r.raw.toString('base64'), PNG)

    console.log('=== 3. 安全与限流 ===')
    check('拒绝非法后缀', (await req('POST', '/api/upload', { ext: '.exe', data: 'aGk=' })).status, 400)
    check('拒绝非图片内容', (await req('POST', '/api/upload', { ext: '.png', data: Buffer.from('not image').toString('base64') })).status, 400)
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(9 * 1024 * 1024)])
    check('超过 8MB 拒绝', (await req('POST', '/api/upload', { ext: '.png', data: big.toString('base64') })).status, 413)
    let tr = (await req('GET', '/uploads/..%2fstate.json')).status
    ok('禁止路径穿越', tr === 400 || tr === 404, '状态 ' + tr)
    check('不存在的文件', (await req('GET', '/uploads/nope.png')).status, 404)

    console.log('=== 4. 自定义布局接口 ===')
    r = await req('POST', '/api/admin/offices', { name: 'D 区 · 云端验收', building: '科研主楼 5F', prefix: 'D', rows: 2, cols: 3, mapMode: 'custom' })
    check('新建自定义办公室', r.json && r.json.ok, true)
    officeId = r.json.office.id
    check('布局方式为 custom', r.json.office.mapMode, 'custom')
    check('初始不建工位', r.json.seats.count, 0)

    const pts = []
    for (let i = 0; i < 7; i++) pts.push({ x: 8 + i * 11.5, y: 20 + (i % 2) * 40 })
    r = await req('POST', '/api/admin/offices/' + officeId + '/map', { image: 'http://127.0.0.1:' + PORT + url, points: pts })
    check('保存地图', r.json && r.json.ok, true)
    check('按点位生成工位', r.json && r.json.count, 7)
    ok('图片存的是云端地址', /\/uploads\//.test(r.json.image || ''), r.json.image)

    r = await req('GET', '/api/admin/offices/' + officeId + '/map')
    check('读取地图模式', r.json && r.json.mode, 'custom')
    check('点位数', r.json && r.json.points.length, 7)
    check('首个编号', r.json && r.json.points[0].code, 'D-01')
    check('末位编号', r.json && r.json.points[6].code, 'D-07')
    check('坐标为百分比', r.json && r.json.points[1].x, 19.5)
    check('点位带状态', r.json && r.json.points[0].status, 'free')

    r = await req('POST', '/api/admin/offices/' + officeId + '/map', { points: [] })
    check('空点位拒绝保存', r.json && r.json.ok, false)

    console.log('=== 5. 布局方式互切 ===')
    r = await req('POST', '/api/admin/offices/' + officeId + '/map-mode', { mode: 'grid' })
    check('切回标准网格', r.json && r.json.mode, 'grid')
    check('工位数 = rows × cols', r.json && r.json.seats.count, 6)
    check('点位已清空', r.json && r.json.points, 0)
    r = await req('POST', '/api/admin/offices/' + officeId + '/map-mode', { mode: 'custom' })
    check('再切自定义', r.json && r.json.mode, 'custom')
    check('自动生成默认点位', r.json && r.json.points, 6)
    r = await req('GET', '/api/admin/offices')
    const found = (r.json.list || []).filter(o => o.id === officeId)[0]
    check('办公室列表带布局信息', found && found.mapMode, 'custom')
  } catch (e) {
    fail++
    console.log('FAIL 异常 → ' + (e && e.message))
  }
  try {
    if (officeId) {
      await req('POST', '/api/admin/offices/' + officeId + '/map-mode', { mode: 'grid' })
      await req('POST', '/api/admin/offices/' + officeId + '/delete')
    }
    const dir = path.join(__dirname, 'data', 'uploads')
    if (fs.existsSync(dir)) fs.readdirSync(dir).forEach(f => {
      const p = path.join(dir, f)
      if (/^seat-map-/.test(f) && fs.statSync(p).size < 1024) fs.unlinkSync(p)
    })
  } catch (e) {}
  child.kill()
  console.log(fail ? '\n=== 失败 ' + fail + ' 项 ===' : '\n=== 任务1 全部通过 ===')
  process.exit(fail ? 1 : 0)
}

main()
