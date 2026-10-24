/**
 * 二维码生成与拼版绘制
 * 编码能力来自内置库 utils/qrcode-lib.js（qrcode-generator, MIT）
 *
 * 卡片样式（参照工位标签实物）：
 *   ┌──────────────────┐
 *   │  蓝色标题条（大字）  │
 *   │   ┌──────────┐   │
 *   │   │  二维码   │   │
 *   │   └──────────┘   │
 *   │   工位编号 A-0102 │
 *   │   科研主楼 3F     │  楼栋名称（办公室配置中的楼栋）
 *   │  ① 提示一         │
 *   │  ② 提示二         │
 *   │  ③ 提示三         │
 *   │  底部色条 · 单位   │
 *   └──────────────────┘
 */
var qrcode = require('./qrcode-lib.js')

qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8']

/** 生成二维码模块矩阵（0/1 二维数组） */
function matrix(text, ecl) {
  var qr = qrcode(0, ecl || 'M')
  qr.addData(text, 'Byte')
  qr.make()
  var n = qr.getModuleCount()
  var out = []
  for (var r = 0; r < n; r++) {
    var row = []
    for (var c = 0; c < n; c++) row.push(qr.isDark(r, c) ? 1 : 0)
    out.push(row)
  }
  return out
}

/** 估算文字宽度（中文≈字号，英文≈0.55 字号） */
function textWidth(str, fontSize) {
  var width = 0
  var text = String(str == null ? '' : str)
  for (var i = 0; i < text.length; i++) {
    width += text.charCodeAt(i) > 255 ? fontSize : fontSize * 0.55
  }
  return width
}

/** 在限定宽度内自动缩小字号（不低于 min） */
function shrinkFont(text, maxWidth, prefer, min) {
  var size = Math.round(prefer)
  var floor = min || 10
  while (size > floor && textWidth(text, size) > maxWidth) size -= 1
  return size
}

/** 按宽度自动折行 */
function wrapText(text, maxWidth, fontSize) {
  var str = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
  if (!str) return []
  var lines = []
  var line = ''
  for (var i = 0; i < str.length; i++) {
    var ch = str.charAt(i)
    if (line && textWidth(line + ch, fontSize) > maxWidth) {
      lines.push(line)
      line = ch
    } else {
      line += ch
    }
  }
  if (line) lines.push(line)
  return lines
}

/** 按估算宽度裁剪文字 */
function fitText(text, maxWidth, fontSize) {
  var str = String(text == null ? '' : text)
  if (!str) return ''
  var width = 0
  var out = ''
  for (var i = 0; i < str.length; i++) {
    var ch = str.charAt(i)
    var w = ch.charCodeAt(0) > 255 ? fontSize : fontSize * 0.55
    if (width + w > maxWidth) return out + '…'
    width += w
    out += ch
  }
  return out
}

/** 拼版布局计算 */
function buildLayout(style, total) {
  var cols = style.cols || 3
  var gutter = 14
  // 每个标签固定 210 逻辑像素宽，保证标题/提示文案可读，导出时按 3 倍输出
  var canvasW = cols * 210 + gutter * (cols + 1)
  var cellW = Math.floor((canvasW - gutter * (cols + 1)) / cols)
  var qrPad = Math.max(8, Math.round(cellW * 0.06))
  var qrBox = cellW - qrPad * 2
  var textMaxW = cellW - qrPad * 2

  // 标题：优先用偏好字号，放不下自动缩小；仍超出则折行（不超过 2 行）
  var titleText = String(style.headerText || '').trim()
  var titleSize = 0
  var titleLines = []
  if (titleText) {
    var prefer = Math.min(28, Math.round(cellW * 0.12))
    var oneLineMin = Math.max(14, Math.round(cellW * 0.085))
    // 先尽量排成一行（缩小到仍清晰的字号）
    titleSize = prefer
    titleLines = wrapText(titleText, textMaxW, titleSize)
    while (titleLines.length > 1 && titleSize > oneLineMin) {
      titleSize -= 1
      titleLines = wrapText(titleText, textMaxW, titleSize)
    }
    // 一行排不下则允许两行，字号尽量大
    if (titleLines.length > 1) {
      titleSize = prefer
      titleLines = wrapText(titleText, textMaxW, titleSize)
      while (titleLines.length > 2 && titleSize > 9) {
        titleSize -= 1
        titleLines = wrapText(titleText, textMaxW, titleSize)
      }
      if (titleLines.length > 2) {
        titleLines = titleLines.slice(0, 2)
        titleLines[1] = fitText(titleLines[1] + '…', textMaxW, titleSize)
      }
    }
  }
  var titleLineH = Math.round(titleSize * 1.35)
  var headerH = titleLines.length
    ? Math.max(Math.round(cellW * 0.18), titleLines.length * titleLineH + 10)
    : 0

  var codeH = style.showCode ? Math.round(cellW * 0.085) : 0
  var zoneH = style.showZone ? Math.round(cellW * 0.075) : 0
  var labelH = codeH + zoneH
  var tipRow = Math.round(cellW * 0.095)
  var tips = (style.tips || []).filter(function (t) { return String(t || '').trim() })
  var tipsH = tips.length ? tips.length * tipRow + 10 : 0
  var footerH = style.footerText ? Math.round(cellW * 0.11) : 0
  var cellH = headerH + qrBox + labelH + tipsH + footerH
  var maxH = 1800
  var rowsPerPage = Math.max(1, Math.floor((maxH - gutter) / (cellH + gutter)))
  var perPage = cols * rowsPerPage
  return {
    canvasW: canvasW,
    cols: cols,
    gutter: gutter,
    qrPad: qrPad,
    cellW: cellW,
    cellH: cellH,
    qrBox: qrBox,
    headerH: headerH,
    titleSize: titleSize,
    titleLines: titleLines,
    titleLineH: titleLineH,
    labelH: labelH,
    codeH: codeH,
    zoneH: zoneH,
    tipsH: tipsH,
    tipRow: tipRow,
    tips: tips,
    footerH: footerH,
    rowsPerPage: rowsPerPage,
    perPage: perPage,
    pageCount: Math.max(1, Math.ceil((total || 1) / perPage))
  }
}

/** 绘制单个二维码卡片 */
function drawCard(ctx, item, style, layout, x0, y0, urlOf) {
  var cellW = layout.cellW
  var cellH = layout.cellH
  var qrPad = layout.qrPad
  var qrBox = layout.qrBox
  var headerH = layout.headerH
  var footerH = layout.footerH
  var cx = x0 + cellW / 2

  // 卡片底色
  ctx.setFillStyle(style.cellBg || '#ffffff')
  ctx.fillRect(x0, y0, cellW, cellH)

  // 顶部标题条（字号随文字长度自适应，必要时折行）
  if (headerH && layout.titleLines && layout.titleLines.length) {
    ctx.setFillStyle(style.headerColor || '#1f5fc4')
    ctx.fillRect(x0, y0, cellW, headerH)
    ctx.setFillStyle('#ffffff')
    ctx.setTextAlign('center')
    ctx.setTextBaseline('middle')
    ctx.setFontSize(layout.titleSize)
    var lines = layout.titleLines
    var firstY = y0 + headerH / 2 - ((lines.length - 1) * layout.titleLineH) / 2
    for (var li = 0; li < lines.length; li++) {
      ctx.fillText(lines[li], cx, firstY + li * layout.titleLineH)
    }
  }

  // 二维码白底框（同时充当静默区）
  var boxY = y0 + headerH + Math.round(cellW * 0.03)
  ctx.setFillStyle(style.qrBg || '#ffffff')
  ctx.fillRect(x0 + qrPad, boxY, qrBox, qrBox)

  var text = urlOf ? urlOf(item) : item.code
  var m = matrix(text, style.ecl || 'M')
  var n = m.length
  var unit = Math.max(1, Math.floor(qrBox / (n + 8)))
  var qrSize = unit * n
  var qx = x0 + qrPad + Math.floor((qrBox - qrSize) / 2)
  var qy = boxY + Math.floor((qrBox - qrSize) / 2)

  ctx.setFillStyle(style.fg || '#000000')
  if (style.shape === 'dot') {
    ctx.beginPath()
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (!m[r][c]) continue
        var dx = qx + c * unit + unit / 2
        var dy = qy + r * unit + unit / 2
        ctx.moveTo(dx + unit / 2, dy)
        ctx.arc(dx, dy, unit / 2, 0, Math.PI * 2)
      }
    }
    ctx.fill()
  } else {
    for (var r2 = 0; r2 < n; r2++) {
      for (var c2 = 0; c2 < n; c2++) {
        if (!m[r2][c2]) continue
        ctx.fillRect(qx + c2 * unit, qy + r2 * unit, unit, unit)
      }
    }
  }

  // 中心徽标
  if (style.badge) {
    var bcx = qx + qrSize / 2
    var bcy = qy + qrSize / 2
    var radius = unit * 2.6
    ctx.setFillStyle(style.qrBg || '#ffffff')
    ctx.beginPath()
    ctx.arc(bcx, bcy, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.setFillStyle(style.fg || '#000000')
    ctx.setFontSize(Math.floor(radius * 1.2))
    ctx.setTextAlign('center')
    ctx.setTextBaseline('middle')
    ctx.fillText(String(item.zone || item.code.charAt(0)), bcx, bcy)
  }

  // 工位编号 / 区域名（各自固定行高，保证都能显示）
  var textMaxW = cellW - qrPad * 2
  var labelTop = boxY + qrBox
  ctx.setTextAlign('center')
  ctx.setTextBaseline('middle')
  if (style.showCode) {
    var codeText = String(item.code || '')
    var codeSize = shrinkFont(codeText, textMaxW, Math.round(cellW * 0.078), 9)
    ctx.setFillStyle(style.textColor || '#1a2233')
    ctx.setFontSize(codeSize)
    ctx.fillText(fitText(codeText, textMaxW, codeSize), cx, labelTop + layout.codeH / 2)
  }
  if (style.showZone) {
    var zoneText = String(item.zoneName || (item.zone ? item.zone + ' 区' : '')).trim()
    if (zoneText) {
      var zoneSize = shrinkFont(zoneText, textMaxW, Math.round(cellW * 0.062), 8)
      ctx.setFillStyle(style.subColor || '#6b7688')
      ctx.setFontSize(zoneSize)
      ctx.fillText(fitText(zoneText, textMaxW, zoneSize), cx, labelTop + layout.codeH + layout.zoneH / 2)
    }
  }

  // 提示文案（带序号圆点）
  var tips = layout.tips
  if (tips.length) {
    var rowH = layout.tipRow
    var startY = boxY + qrBox + layout.labelH + 4
    var dotR = Math.max(5, Math.round(rowH * 0.28))
    var dotX = x0 + qrPad + dotR + 2
    var textX = dotX + dotR + Math.max(6, Math.round(rowH * 0.32))
    var tipSize = Math.max(9, Math.round(rowH * 0.62))
    for (var i = 0; i < tips.length; i++) {
      var ty = startY + i * rowH + rowH / 2
      if (style.numbered !== false) {
        ctx.setFillStyle(style.headerColor || '#1f5fc4')
        ctx.beginPath()
        ctx.arc(dotX, ty, dotR, 0, Math.PI * 2)
        ctx.fill()
        ctx.setFillStyle('#ffffff')
        ctx.setFontSize(Math.round(dotR * 1.15))
        ctx.setTextAlign('center')
        ctx.setTextBaseline('middle')
        ctx.fillText(String(i + 1), dotX, ty)
      }
      ctx.setFillStyle(style.textColor || '#1a2233')
      var maxW = x0 + cellW - qrPad - textX
      ctx.setFontSize(shrinkFont(tips[i], maxW, tipSize, 8))
      ctx.setTextAlign('left')
      ctx.setTextBaseline('middle')
      ctx.fillText(fitText(tips[i], maxW, tipSize), textX, ty)
    }
  }

  // 底部色条
  if (footerH) {
    ctx.setFillStyle(style.headerColor || '#1f5fc4')
    ctx.fillRect(x0, y0 + cellH - footerH, cellW, footerH)
    var footSize = shrinkFont(style.footerText, cellW - qrPad * 2, footerH * 0.5, 8)
    ctx.setFillStyle('#ffffff')
    ctx.setFontSize(footSize)
    ctx.setTextAlign('center')
    ctx.setTextBaseline('middle')
    ctx.fillText(fitText(style.footerText, cellW - qrPad * 2, footSize), cx, y0 + cellH - footerH / 2)
  }
}

/**
 * 绘制一页拼版
 * ctx: canvas 上下文；opts: { items, style, layout, urlOf }
 * items: [{ code, zone, zoneName }]
 * 返回该页画布高度
 */
function drawPage(ctx, opts) {
  var style = opts.style
  var layout = opts.layout
  var items = opts.items || []
  var rows = Math.ceil(items.length / layout.cols)
  var canvasH = items.length ? layout.gutter + rows * (layout.cellH + layout.gutter) : layout.gutter * 2

  ctx.setFillStyle(style.pageBg || '#f2f4f8')
  ctx.fillRect(0, 0, layout.canvasW, canvasH)

  items.forEach(function (item, index) {
    var col = index % layout.cols
    var row = Math.floor(index / layout.cols)
    var x0 = layout.gutter + col * (layout.cellW + layout.gutter)
    var y0 = layout.gutter + row * (layout.cellH + layout.gutter)
    drawCard(ctx, item, style, layout, x0, y0, opts.urlOf)
  })

  return canvasH
}

module.exports = {
  matrix: matrix,
  buildLayout: buildLayout,
  drawPage: drawPage,
  fitText: fitText,
  wrapText: wrapText,
  textWidth: textWidth
}
