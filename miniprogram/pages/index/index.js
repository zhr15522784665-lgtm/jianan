// pages/index/index.js
const app = getApp();

// 选完「此刻」后给的建议：只给一件事，不给一堆选择
const SUGGEST = {
  不错: {
    text: '状态还行，就记一笔吧。攒起来，过阵子回看会看见变化。',
    btn: '去记一笔',
    act: 'goMood'
  },
  一般: {
    text: '不算好也不算坏。要不先喘口气？跟着做两组呼吸，两分钟就够。',
    btn: '开始呼吸',
    act: 'goBreathe'
  },
  低落: {
    text: '有点沉的时候，说出来会轻一点。跟见岸聊聊，不用组织语言。',
    btn: '去聊聊',
    act: 'goChatDefault'
  }
};

Page({
  data: {
    moodToday: null,
    moodEmoji: { 很好: '😊', 不错: '🙂', 一般: '😐', 低落: '😔', 糟糕: '😣' },
    suggest: null,
    reads: [],
    streak: 0,
    total: 0,
    personas: []
  },

  onLoad() {
    this.setData({ personas: app.globalData.personas });
    // 值得一读：只取前三篇，首页不做内容仓库。
    // 延后到首屏渲染之后执行，避免和首屏 setData 抢主线程。
    // 文章模块本身用惰性 require，让首页启动路径不背这个模块的解析开销。
    wx.nextTick(() => {
      let ARTICLES = [];
      try {
        ARTICLES = require('../../utils/articles.js').ARTICLES || [];
      } catch (e) {}
      if (!ARTICLES.length) return;
      this.setData({
        reads: ARTICLES.slice(0, 3).map((a) => ({ id: a.id, title: a.title, cat: a.cat }))
      });
    });
  },

  onShow() {
    const m = app.moodToday();
    const st = this._streak();
    this.setData({
      moodToday: m,
      suggest: m ? SUGGEST[m.mood] || null : null,
      streak: st.streak,
      total: st.total
    });
  },

  // 连续打卡天数：从今天往前数，遇到断签即止（今天还没打卡则从昨天起算）
  _streak() {
    const list = app.getMoods() || [];
    if (!list.length) return { streak: 0, total: list.length };
    const set = new Set(list.map((x) => x.date));
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    const d = new Date();
    if (!set.has(app.todayKey())) d.setDate(d.getDate() - 1);
    let streak = 0;
    while (set.has(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`)) {
      streak++;
      d.setDate(d.getDate() - 1);
    }
    return { streak, total: list.length };
  },

  // 主线：点一下就是一次轻打卡，同时给出建议
  // 只把新记录直接回填到 data，不再从 storage 重读整张表
  checkNow(e) {
    const mood = e.currentTarget.dataset.m;
    const rec = this._saveMood(mood);
    const st = this._streak();
    this.setData({
      moodToday: rec,
      suggest: SUGGEST[mood] || null,
      streak: st.streak,
      total: st.total
    });
    wx.showToast({ title: '已记下', icon: 'none' });
  },

  // 写入今日心情，返回落库后的记录（供调用方直接 setData，省一次读盘）
  _saveMood(mood) {
    const list = app.getMoods() || [];
    const today = app.todayKey();
    const idx = list.findIndex((x) => x.date === today);
    const rec = { date: today, mood, note: (idx >= 0 && list[idx].note) || '' };
    if (idx >= 0) list[idx] = rec;
    else list.push(rec);
    try {
      wx.setStorageSync('jianan_moods', list);
    } catch (e) {}
    return rec;
  },

  // 执行建议动作
  doSuggest() {
    const act = this.data.suggest && this.data.suggest.act;
    if (act === 'goMood') this.goMood();
    else if (act === 'goBreathe') this.goBreathe();
    else if (act === 'goChatDefault') this.goChatDefault();
  },

  // 常驻危机入口：不经过任何中间页，直接给热线
  // 用 ActionSheet 只能放 6 项（硬上限，超了直接失败），且危机时刻选项越少越好。
  // 这里先给最稳妥的 2 条全国 24 小时号，第 3 项引导去全量热线页。
  openSos() {
    const hot = (app.globalData.hotlines || []).filter((h) => h.primary).slice(0, 2);
    const items = hot.map((h) => `${h.name} ${h.tel}`);
    items.push('查看全部援助热线 ›');
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        if (res.tapIndex >= hot.length) {
          wx.navigateTo({ url: '/pages/hotlines/hotlines' });
          return;
        }
        const h = hot[res.tapIndex];
        if (!h) return;
        wx.makePhoneCall({ phoneNumber: app.formatTel(h.tel), fail() {} });
      },
      fail() {}
    });
  },

  // 选人格 → 跳到对话 tab（pendingPersona 由 chat 页读取）
  goChat(e) {
    const id = e.currentTarget.dataset.id;
    app.globalData.pendingPersona = id;
    wx.switchTab({ url: '/pages/chat/chat' });
  },

  goChatDefault() {
    app.globalData.pendingPersona = 'jianan';
    wx.switchTab({ url: '/pages/chat/chat' });
  },

  goMindspace() {
    wx.switchTab({ url: '/pages/mindspace/mindspace' });
  },

  goBreathe() {
    wx.navigateTo({ url: '/pages/breathe/breathe' });
  },

  goGround() {
    wx.navigateTo({ url: '/pages/ground/ground' });
  },

  goMeditation() {
    wx.navigateTo({ url: '/pages/meditation/meditation' });
  },

  goPomodoro() {
    wx.navigateTo({ url: '/pages/pomodoro/pomodoro' });
  },

  goMood() {
    wx.navigateTo({ url: '/pages/mood/mood' });
  },

  goCommunity() {
    wx.switchTab({ url: '/pages/community/community' });
  },

  goThreegood() {
    wx.navigateTo({ url: '/pages/threegood/threegood' });
  },

  goSafety() {
    wx.navigateTo({ url: '/pages/safety/safety' });
  },

  goAbout() {
    wx.navigateTo({ url: '/pages/about/about' });
  },

  goArticle(e) {
    wx.navigateTo({ url: `/pages/article/article?id=${e.currentTarget.dataset.id}` });
  }
});
