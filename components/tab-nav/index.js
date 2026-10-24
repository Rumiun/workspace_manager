/**
 * 底部导航栏（页面内组件，取代 app.json 的 tabBar）
 *
 * 为什么不用 app.json 的 tabBar：
 *   custom: true 时 WeChat 会保留一块 tabBar 容器并用 tabBar.backgroundColor 填充，
 *   即使自定义组件渲染为空也会在电脑版底部留下白条；且该容器无法可靠收起。
 *   现在改为由 pc-shell 在「手机版分支」渲染本组件：
 *   - 手机版：正常显示底部导航
 *   - 电脑版：pc-shell 只渲染 16:9 画布分支，本组件根本不会被渲染，底部没有任何导航与留白
 *
 * 导航方式：tabBar 已从 app.json 移除，原来的 wx.switchTab 一律改用 wx.redirectTo。
 */
var TAB_ROUTES = [
  '/pages/home/home',
  '/pages/seat/seat',
  '/pages/approval/approval',
  '/pages/mine/mine'
]

var STUDENT_TABS = [
  { pagePath: '/pages/home/home', text: '首页', type: 'tab' },
  { pagePath: '/pages/seat/seat', text: '工位', type: 'tab' },
  { pagePath: '/pages/mine/mine', text: '我的', type: 'tab' }
]

var ADMIN_TABS = [
  { pagePath: '/pages/home/home', text: '首页', type: 'tab' },
  { pagePath: '/pages/approval/approval', text: '审批', type: 'tab' },
  { pagePath: '/pages/admin/seats', text: '后台', type: 'nav' },
  { pagePath: '/pages/mine/mine', text: '我的', type: 'tab' }
]

Component({
  data: {
    list: [],
    selected: 0,
    // 只在这几个「原 tabBar 页面」显示，其余页面（登录、后台、扫码、记录等）不显示
    visible: false
  },

  lifetimes: {
    attached: function () {
      this.refresh()
    }
  },

  pageLifetimes: {
    show: function () {
      this.refresh()
    }
  },

  methods: {
    refresh: function () {
      var app = typeof getApp === 'function' ? getApp() : null
      // 与页面同源：用 app.getUser() 重新校验缓存里的用户，避免底部导航与页面内容角色不一致
      var user = app && typeof app.getUser === 'function' ? app.getUser() : null
      var isAdmin = !!(user && user.role === 'admin')
      var source = isAdmin ? ADMIN_TABS : STUDENT_TABS
      var pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
      var current = pages.length ? '/' + pages[pages.length - 1].route : ''
      var selected = -1
      source.forEach(function (item, index) {
        if (item.pagePath === current) selected = index
      })
      this.setData({
        list: source,
        selected: selected,
        visible: !!current && TAB_ROUTES.indexOf(current) >= 0
      })
    },

    onTap: function (e) {
      var path = e.currentTarget.dataset.path
      var index = e.currentTarget.dataset.index
      var item = this.data.list[index]
      if (!item) return
      if (this.data.selected === Number(index)) return
      if (item.type === 'nav') {
        wx.navigateTo({
          url: path,
          fail: function () { wx.redirectTo({ url: path }) }
        })
      } else {
        wx.redirectTo({ url: path })
      }
    }
  }
})
