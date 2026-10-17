// pages/mood/mood.js
const app = getApp();

const MOODS = [
  { key: '很好', emoji: '😊' },
  { key: '不错', emoji: '🙂' },
  { key: '一般', emoji: '😐' },
  { key: '低落', emoji: '😔' },
  { key: '糟糕', emoji: '😣' }
];
// 心情 → 分数（日历热力与趋势共用）
const MOOD_SCORE = { 很好: 5, 不错: 4, 一般: 3, 低落: 2, 糟糕: 1 };
// 今日一句：按日期取一条，当天稳定，给一个轻反思切口
const PROMPTS = [
  '今天有没有一个瞬间，你是被好好对待的？',
  '最近一次笑，是因为什么？',
  '如果给今天的自己一句安慰，你会说什么？',
  '最近有什么事，是你想谢谢某人的？',
  '此刻你身体最放松的部位是哪里？',
  '哪件小事，让你觉得今天没白过？',
  '你最近一次对自己温柔，是什么时候？'
];

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

Page({
  data: {
    moods: MOODS,
    selected: '',
    note: '',
    saved: false,
    week: [], // 近 7 天 [{label, emoji|null}]
    calMonth: '', // 当前月标题
    calendar: [], // 当月日历 [{blank, day, emoji}]
    trendBars: [], // 近 14 天 [{date, score, filled, h}]
    todayPrompt: '' // 今日一句
  },

  onShow() {
    const list = app.getMoods();
    const today = app.todayKey();
    const cur = list.find((m) => m.date === today);
    const calendar = this._buildCalendar(list);

    // 三块图表 + 表单状态一次 setData 合并提交，避免多次跨线程通信
    this.setData({
      selected: cur ? cur.mood : '',
      note: cur ? cur.note || '' : '',
      saved: false,
      todayPrompt: PROMPTS[this._promptSeed() % PROMPTS.length],
      week: this._buildWeek(list),
      calendar,
      calMonth: this._monthTitle(),
      trendBars: this._buildTrend(list)
    });
  },

  // 以「月*31+日」作种子，同一天稳定同一句
  _promptSeed() {
    const d = new Date();
    return d.getMonth() * 31 + d.getDate();
  },

  _monthTitle() {
    const d = new Date();
    return `${d.getFullYear()}年${d.getMonth() + 1}月`;
  },

  // 构建当月日历格子（纯函数，返回数组，由调用方合并进 setData）
  _buildCalendar(list) {
    const map = {};
    list.forEach((m) => {
      map[m.date] = m;
    });
    const d = new Date();
    const y = d.getFullYear(),
      mo = d.getMonth();
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    const first = new Date(y, mo, 1).getDay();
    const days = new Date(y, mo + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < first; i++) cells.push({ blank: true });
    for (let day = 1; day <= days; day++) {
      const key = `${y}-${p(mo + 1)}-${p(day)}`;
      const rec = map[key];
      cells.push({
        blank: false,
        day,
        emoji: rec ? (MOODS.find((x) => x.key === rec.mood) || {}).emoji || '' : ''
      });
    }
    return cells;
  },

  // 构建近 14 天趋势（纯函数）
  _buildTrend(list) {
    const map = {};
    list.forEach((m) => {
      map[m.date] = m;
    });
    const arr = [];
    const d = new Date();
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    for (let i = 13; i >= 0; i--) {
      const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
      const key = `${dd.getFullYear()}-${p(dd.getMonth() + 1)}-${p(dd.getDate())}`;
      const rec = map[key];
      const score = rec ? (MOOD_SCORE[rec.mood] != null ? MOOD_SCORE[rec.mood] : 3) : 0;
      arr.push({ date: key.slice(5), score, filled: !!rec, h: Math.round((score / 5) * 100) });
    }
    return arr;
  },

  // 构建近 7 天（纯函数）
  _buildWeek(list) {
    const map = {};
    list.forEach((m) => {
      map[m.date] = m;
    });
    const arr = [];
    const d = new Date();
    for (let i = 6; i >= 0; i--) {
      const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
      const p = (n) => (n < 10 ? '0' + n : '' + n);
      const key = `${dd.getFullYear()}-${p(dd.getMonth() + 1)}-${p(dd.getDate())}`;
      const rec = map[key];
      arr.push({
        label: i === 0 ? '今天' : '周' + WEEK[dd.getDay()],
        emoji: rec ? (MOODS.find((x) => x.key === rec.mood) || {}).emoji || '·' : null
      });
    }
    return arr;
  },

  selectMood(e) {
    this.setData({ selected: e.currentTarget.dataset.key, saved: false });
  },

  onNote(e) {
    this.setData({ note: e.detail.value, saved: false });
  },

  save() {
    if (!this.data.selected) {
      wx.showToast({ title: '先选一个心情吧', icon: 'none' });
      return;
    }
    const list = app.getMoods();
    const today = app.todayKey();
    const idx = list.findIndex((m) => m.date === today);
    const rec = { date: today, mood: this.data.selected, note: this.data.note, ts: Date.now() };
    if (idx >= 0) list[idx] = rec;
    else list.push(rec);
    // 最多保留 90 天
    const trimmed = list.slice(-90);
    try {
      wx.setStorageSync('jianan_moods', trimmed);
    } catch (e) {}
    this.setData({ saved: true });
    wx.showToast({ title: '已记录，谢谢你', icon: 'none' });
  },

  goThreegood() {
    wx.navigateTo({ url: '/pages/threegood/threegood' });
  }
});
