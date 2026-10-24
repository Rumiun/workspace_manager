var api = require('../../utils/api.js')
var store = require('../../utils/store.js')
var util = require('../../utils/util.js')
var config = require('../../utils/config.js')
var excel = require('../../utils/excel.js')
var layout = require('../../utils/layout.js')
var app = getApp()

var EMPTY_FORM = {
  id: '', name: '', college: '', grade: '', tutor: '', phone: '', email: '', password: ''
}

var HEADER = ['学号', '姓名', '学院', '年级', '导师', '手机', '邮箱']

var SAMPLE = [
  HEADER.join('\t'),
  '2023010\t王五\t计算机科学与技术学院\t2023 级硕士研究生\t李国栋 教授\t138 0000 0001\twangwu@stu.edu.cn',
  '2023011\t赵六\t电子信息工程学院\t2022 级博士研究生\t王海涛 教授\t139 0000 0002\tzhaoliu@stu.edu.cn'
].join('\n')

Page(layout.wrap({
  data: {
    students: [],
    keyword: '',
    form: Object.assign({}, EMPTY_FORM),
    editingId: '',
    checkedCount: 0,
    importRows: [],
    fileName: '',
    preview: null,
    pasteText: '',
    pastePreview: null,
    isWide: false,
    isPC: false
  },

  onShow: function () {
    var user = app.getUser()
    if (!user) return wx.redirectTo({ url: '/pages/login/login' })
    if (user.role !== 'admin') {
      util.toast('仅管理员可访问')
      return wx.redirectTo({ url: '/pages/home/home' })
    }
    this.load()
  },

  load: function () {
    var self = this
    var keyword = (this.data.keyword || '').trim().toLowerCase()
    api.getStudents().then(function (res) {
      var list = (res.ok && res.list ? res.list : []).filter(function (s) {
        if (!keyword) return true
        return (s.id + ' ' + s.name + ' ' + (s.tutor || '') + ' ' + (s.college || '')).toLowerCase().indexOf(keyword) >= 0
      })
      self.setData({
        students: list.map(function (s) { return Object.assign({}, s, { checked: false }) }),
        checkedCount: 0
      })
    }).catch(function () {
      util.toast('学生数据加载失败')
    })
  },

  onSearch: function (e) {
    this.setData({ keyword: e.detail.value })
    this.load()
  },

  onFormInput: function (e) {
    var field = e.currentTarget.dataset.field
    var form = Object.assign({}, this.data.form)
    form[field] = e.detail.value
    this.setData({ form: form })
  },

  submitForm: function () {
    var self = this
    var form = this.data.form
    if (!String(form.id || '').trim()) return util.toast('请填写学号')
    if (!String(form.name || '').trim()) return util.toast('请填写姓名')
    var payload = {
      id: String(form.id).trim(),
      name: String(form.name).trim(),
      college: form.college,
      grade: form.grade,
      tutor: form.tutor,
      phone: form.phone,
      email: form.email,
      password: form.password || ''
    }
    var task = this.data.editingId ? api.updateStudent(this.data.editingId, payload) : api.addStudent(payload)
    task.then(function (res) {
      if (!res.ok) return util.toast(res.msg || '保存失败')
      util.toast(self.data.editingId ? '已保存' : '已添加', 'success')
      self.setData({ form: Object.assign({}, EMPTY_FORM), editingId: '' })
      self.load()
    })
  },

  editStudent: function (e) {
    var item = this.data.students[e.currentTarget.dataset.index]
    if (!item) return
    this.setData({
      editingId: item.id,
      form: {
        id: item.id, name: item.name, college: item.college || '', grade: item.grade || '',
        tutor: item.tutor || '', phone: item.phone || '', email: item.email || '', password: ''
      }
    })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  cancelEdit: function () {
    this.setData({ form: Object.assign({}, EMPTY_FORM), editingId: '' })
  },

  toggleCheck: function (e) {
    var index = e.currentTarget.dataset.index
    var patch = {}
    patch['students[' + index + '].checked'] = !this.data.students[index].checked
    this.setData(patch, this.syncChecked.bind(this))
  },

  toggleAll: function () {
    var self = this
    var all = this.data.students.length > 0 && this.data.checkedCount === this.data.students.length
    var patch = {}
    this.data.students.forEach(function (s, i) { patch['students[' + i + '].checked'] = !all })
    this.setData(patch, function () { self.syncChecked() })
  },

  syncChecked: function () {
    this.setData({ checkedCount: this.data.students.filter(function (s) { return s.checked }).length })
  },

  deleteOne: function (e) {
    var self = this
    var id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除学生',
      content: '确认删除学号 ' + id + ' 吗？该学生如有工位归属将提示先释放。',
      confirmColor: '#f04438',
      success: function (r) {
        if (!r.confirm) return
        api.removeStudents([id]).then(function (res) {
          if (!res.ok) return util.toast(res.msg)
          util.toast('已删除', 'success')
          self.load()
        })
      }
    })
  },

  batchDelete: function () {
    var self = this
    var ids = this.data.students.filter(function (s) { return s.checked }).map(function (s) { return s.id })
    if (!ids.length) return util.toast('请先选择学生')
    wx.showModal({
      title: '批量删除',
      content: '确认删除选中的 ' + ids.length + ' 名学生吗？',
      confirmColor: '#f04438',
      success: function (r) {
        if (!r.confirm) return
        api.removeStudents(ids).then(function (res) {
          if (!res.ok) return util.toast(res.msg)
          util.toast('已删除 ' + ids.length + ' 名', 'success')
          self.load()
        })
      }
    })
  },

  /* ---------------- Excel 上传导入 ---------------- */
  /** 下载示例表格并保存到本地设备 */
  downloadSample: function () {
    var self = this
    var name = '研究生名单导入示例.csv'
    excel.downloadCsv(name, SAMPLE).then(function () {
      wx.showModal({
        title: '示例已生成',
        content: '已保存到本地设备：' + name + '。用 Excel 打开后按示例填写名单，保存后在本页上传即可。',
        showCancel: false,
        confirmText: '知道了'
      })
    }).catch(function (err) {
      wx.showModal({
        title: '示例内容',
        content: '当前环境无法直接保存文件，可复制以下示例到 Excel：\n' + SAMPLE,
        showCancel: true,
        cancelText: '关闭',
        confirmText: '复制示例',
        success: function (r) { if (r.confirm) wx.setClipboardData({ data: SAMPLE }) }
      })
      if (self.data.isWide) util.toast(String(err.message || err))
    })
  },

  /** 选择并上传 Excel 文件 */
  chooseFile: function () {
    var self = this
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['xlsx', 'csv', 'txt'],
      success: function (res) {
        var file = (res.tempFiles || [])[0]
        if (!file) return
        wx.showLoading({ title: '解析中…', mask: true })
        excel.readUploadedFile(file.path, file.name).then(function (rows) {
          wx.hideLoading()
          self.buildPreview(rows, file.name)
        }).catch(function (err) {
          wx.hideLoading()
          wx.showModal({
            title: '文件解析失败',
            content: (err && err.message ? err.message : '文件无法解析') + '。请上传 .xlsx 或 CSV UTF-8 文件。',
            showCancel: false
          })
        })
      },
      fail: function () {}
    })
  },

  /** 解析结果 → 预览（新增 / 更新 / 无效 统计） */
  buildPreview: function (rows, fileName) {
    var list = store.parseStudentRows(rows)
    if (!list.length) return util.toast('未解析到有效数据，请检查文件内容')
    var existMap = {}
    store.getStudents().forEach(function (s) { existMap[s.id] = true })
    var seen = {}
    var added = 0
    var updated = 0
    list.forEach(function (r) {
      if (seen[r.id]) return
      seen[r.id] = true
      if (existMap[r.id]) updated += 1
      else added += 1
    })
    var valid = Object.keys(seen).length
    var dataRows = store.isHeaderRow(rows[0] || []) ? rows.length - 1 : rows.length
    this.setData({
      importRows: list,
      fileName: fileName || '',
      preview: {
        total: dataRows,
        valid: valid,
        added: added,
        updated: updated,
        invalid: Math.max(0, dataRows - valid),
        rows: list.slice(0, 8)
      }
    })
  },

  confirmImport: function () {
    var self = this
    var rows = this.data.importRows || []
    if (!rows.length) return util.toast('请先上传文件')
    wx.showModal({
      title: '确认导入',
      content: '共 ' + rows.length + ' 条记录（新增 ' + this.data.preview.added + '，更新 ' + this.data.preview.updated + '），确认导入吗？',
      confirmText: '确认导入',
      success: function (r) {
        if (!r.confirm) return
        wx.showLoading({ title: '导入中…', mask: true })
        api.importStudents(rows).then(function (res) {
          wx.hideLoading()
          if (!res.ok) return util.toast(res.msg || '导入失败')
          var msg = '新增 ' + res.added.length + ' 人，更新 ' + res.updated.length + ' 人'
          if (res.failed.length) msg += '，失败 ' + res.failed.length + ' 条'
          util.toast(msg, 'success')
          self.setData({ importRows: [], preview: null, fileName: '' })
          self.load()
        }).catch(function () {
          wx.hideLoading()
          util.toast('导入失败，请重试')
        })
      }
    })
  },

  clearImport: function () {
    this.setData({ importRows: [], preview: null, fileName: '' })
  },

  /* ---------------- 粘贴导入（无文件时备用） ---------------- */
  onPasteText: function (e) {
    this.setData({ pasteText: e.detail.value })
  },

  parsePaste: function () {
    var rows = excel.parseCsvText(this.data.pasteText)
    if (!rows.length) return util.toast('未解析到有效数据')
    this.buildPreview(rows, '粘贴内容')
    this.setData({ pasteText: '' })
  },

  clearPaste: function () {
    this.setData({ pasteText: '', pastePreview: null })
  },

  /* ---------------- 导出 ---------------- */
  exportFile: function () {
    var text = store.exportStudentsText()
    excel.downloadCsv('研究生名单.csv', text).then(function () {
      util.toast('已保存到本地设备', 'success')
    }).catch(function (err) {
      wx.showModal({
        title: '导出名单',
        content: String(err.message || err) + '\n\n也可直接复制内容后粘贴到 Excel。',
        cancelText: '关闭',
        confirmText: '复制名单',
        success: function (r) { if (r.confirm) wx.setClipboardData({ data: text }) }
      })
    })
  },

  copyStudents: function () {
    if (config.USE_MOCK) return wx.setClipboardData({ data: store.exportStudentsText() })
    api.exportStudentsText().then(function (res) {
      if (res && res.ok) wx.setClipboardData({ data: res.text })
    })
  }
}))
