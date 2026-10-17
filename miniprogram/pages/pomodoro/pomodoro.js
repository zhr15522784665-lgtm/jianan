// pages/pomodoro/pomodoro.js
// 番茄钟：预设 / 步进自定义 / 输入自定义 / 长休息 / 连续模式 / 任务名 / 后台计时补偿
const app = getApp();

const RING_R = 120;
const RING_C = 2 * Math.PI * RING_R;

// 边界
const LIM = {
  work: { min: 1, max: 600 }, // 专注 1~600 分钟
  brk: { min: 1, max: 120 }, // 短休息 1~120 分钟
  long: { min: 1, max: 120 }, // 长休息 1~120 分钟
  every: { min: 2, max: 8 } // 每几段长休息
};

function clamp(v, fall, lim) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return fall;
  return Math.max(lim.min, Math.min(lim.max, n));
}

Page({
  data: {
    presets: [
      { label: '专注 25 / 休 5', work: 25, brk: 5 },
      { label: '专注 45 / 休 10', work: 45, brk: 10 },
      { label: '专注 15 / 休 3', work: 15, brk: 3 }
    ],
    presetIdx: 0,
    custom: false,

    // 自定义：step = 步进器，input = 直接输入
    customMode: 'step',
    customWork: 25,
    customBreak: 5,

    // 长休息
    longBreakOn: true,
    longBreak: 15,
    longBreakEvery: 4,

    // 连续模式：一段结束后自动开始下一段
    autoNext: false,

    // 本段任务名
    taskName: '',

    mode: 'work', // work | break
    breakKind: 'short', // short | long
    running: false,
    remaining: 25 * 60,
    total: 25 * 60,
    ringC: RING_C,
    ringOffset: 0,

    sessionsToday: 0,
    minutesToday: 0,
    streak: 0
  },

  onLoad() {
    this._loadPrefs();
    this._loadStats();
    // 先尝试恢复上次没跑完的计时
    if (!this._restoreRun()) this._applyPreset(0);
  },

  onShow() {
    this._loadStats();
    this._resyncFromStore();
    // 切回前台：如果计时逻辑上还在跑但定时器已被 onHide 停掉，用真实时间重新起表
    if (this.data.running && !this._timer) {
      this._timer = setInterval(() => this._tick(), 1000);
    }
  },

  onHide() {
    // 切后台停掉定时器（后台会被系统节流且白耗电）。
    // 剩余时间由 jianan_pomodoro_run 的 endAt 决定，回前台再 _resyncFromStore 校正。
    this._clear();
  },

  onUnload() {
    // 只停定时器，落盘记录保留，下次进来可恢复
    this._clear();
  },

  // ---------- 计时落盘：抗进程回收 ----------
  // 只存「预计结束时间戳」而非剩余秒数，这样无论被销毁多久，
  // 回来都能用 endAt - now 算出真实剩余。
  _saveRun() {
    if (!this.data.running) {
      this._clearRun();
      return;
    }
    const rec = {
      endAt: Date.now() + this.data.remaining * 1000,
      mode: this.data.mode,
      breakKind: this.data.breakKind,
      total: this.data.total,
      custom: this.data.custom,
      presetIdx: this.data.presetIdx,
      taskName: this.data.taskName || ''
    };
    try {
      wx.setStorageSync('jianan_pomodoro_run', rec);
    } catch (e) {}
  },

  _clearRun() {
    try {
      wx.removeStorageSync('jianan_pomodoro_run');
    } catch (e) {}
  },

  // 冷启动恢复：有未完成的计时就续上（暂停态，等用户点开始）
  _restoreRun() {
    let rec = null;
    try {
      rec = wx.getStorageSync('jianan_pomodoro_run') || null;
    } catch (e) {}
    if (!rec || !rec.endAt) return false;

    const left = Math.round((rec.endAt - Date.now()) / 1000);
    this.setData({
      mode: rec.mode || 'work',
      breakKind: rec.breakKind || 'short',
      total: rec.total || 25 * 60,
      custom: !!rec.custom,
      presetIdx: rec.presetIdx || 0,
      taskName: rec.taskName || '',
      running: false
    });

    if (left <= 0) {
      // 离开期间已经跑完
      this._clearRun();
      this.setData({ remaining: 0, ringOffset: this.data.ringC });
      this._onPhaseEnd();
    } else {
      this.setData({
        remaining: left,
        ringOffset: this.data.ringC * (1 - left / this.data.total)
      });
      wx.showToast({ title: '已恢复上次的计时', icon: 'none' });
    }
    return true;
  },

  // 页面仍在但曾切后台：按真实时间校正（setInterval 后台会被节流）
  _resyncFromStore() {
    if (!this.data.running) return;
    let rec = null;
    try {
      rec = wx.getStorageSync('jianan_pomodoro_run') || null;
    } catch (e) {}
    if (!rec || !rec.endAt) return;
    const left = Math.round((rec.endAt - Date.now()) / 1000);
    if (left <= 0) {
      this._clearRun();
      this._onPhaseEnd();
      return;
    }
    if (left !== this.data.remaining) {
      this.setData({
        remaining: left,
        ringOffset: this.data.ringC * (1 - left / this.data.total)
      });
    }
  },

  // ---------- 偏好持久化（自定义时长/开关，仅本机） ----------
  _loadPrefs() {
    let p = null;
    try {
      p = wx.getStorageSync('jianan_pomodoro_prefs') || null;
    } catch (e) {}
    if (!p) return;
    this.setData({
      customWork: clamp(p.work, 25, LIM.work),
      customBreak: clamp(p.brk, 5, LIM.brk),
      longBreak: clamp(p.long, 15, LIM.long),
      longBreakEvery: clamp(p.every, 4, LIM.every),
      longBreakOn: p.longOn !== false,
      autoNext: p.autoNext === true,
      customMode: p.mode === 'input' ? 'input' : 'step'
    });
  },

  _savePrefs() {
    const p = {
      work: this.data.customWork,
      brk: this.data.customBreak,
      long: this.data.longBreak,
      every: this.data.longBreakEvery,
      longOn: this.data.longBreakOn,
      autoNext: this.data.autoNext,
      mode: this.data.customMode
    };
    try {
      wx.setStorageSync('jianan_pomodoro_prefs', p);
    } catch (e) {}
  },

  _loadStats() {
    let rec = null;
    try {
      rec = wx.getStorageSync('jianan_pomodoro') || null;
    } catch (e) {}
    const today = app.todayKey();
    if (rec && rec.date === today) {
      this.setData({
        sessionsToday: rec.sessions || 0,
        minutesToday: rec.minutes || 0,
        streak: rec.streak || 0
      });
    } else if (rec && rec.date !== today) {
      this.setData({ sessionsToday: 0, minutesToday: 0, streak: rec.streak || 0 });
    }
  },

  _saveStats() {
    const rec = {
      date: app.todayKey(),
      sessions: this.data.sessionsToday,
      minutes: this.data.minutesToday,
      streak: this.data.streak,
      lastTask: this.data.taskName || ''
    };
    try {
      wx.setStorageSync('jianan_pomodoro', rec);
    } catch (e) {}
  },

  // ---------- 预设 / 自定义 ----------
  _applyPreset(i) {
    const p = this.data.presets[i];
    const total = p.work * 60;
    this.setData({
      presetIdx: i,
      custom: false,
      mode: 'work',
      breakKind: 'short',
      running: false,
      total,
      remaining: total,
      ringOffset: 0
    });
    this._clearRun();
    this._clear();
  },

  selectPreset(e) {
    this._applyPreset(Number(e.currentTarget.dataset.i));
  },

  toggleCustom() {
    if (!this.data.custom) {
      const total = this.data.customWork * 60;
      this.setData({
        custom: true,
        mode: 'work',
        breakKind: 'short',
        running: false,
        total,
        remaining: total,
        ringOffset: 0
      });
      this._clear();
    } else {
      this._applyPreset(this.data.presetIdx);
    }
  },

  setCustomMode(e) {
    this.setData({ customMode: e.currentTarget.dataset.m });
    this._savePrefs();
  },

  // 步进器
  stepWork(e) {
    const v = clamp(this.data.customWork + Number(e.currentTarget.dataset.d), 25, LIM.work);
    const total = v * 60;
    this.setData({
      customWork: v,
      mode: 'work',
      running: false,
      total,
      remaining: total,
      ringOffset: 0
    });
    this._savePrefs();
    this._clear();
  },

  stepBreak(e) {
    const v = clamp(this.data.customBreak + Number(e.currentTarget.dataset.d), 5, LIM.brk);
    this.setData({ customBreak: v });
    this._savePrefs();
  },

  stepLong(e) {
    const v = clamp(this.data.longBreak + Number(e.currentTarget.dataset.d), 15, LIM.long);
    this.setData({ longBreak: v });
    this._savePrefs();
  },

  stepEvery(e) {
    const v = clamp(this.data.longBreakEvery + Number(e.currentTarget.dataset.d), 4, LIM.every);
    this.setData({ longBreakEvery: v });
    this._savePrefs();
  },

  // 输入框：边输入边更新，失焦时归一化
  onWorkInput(e) {
    this.setData({ customWork: e.detail.value });
  },
  onBreakInput(e) {
    this.setData({ customBreak: e.detail.value });
  },
  onLongInput(e) {
    this.setData({ longBreak: e.detail.value });
  },
  onTaskInput(e) {
    this.setData({ taskName: e.detail.value });
  },

  applyInput() {
    const w = clamp(this.data.customWork, 25, LIM.work);
    const b = clamp(this.data.customBreak, 5, LIM.brk);
    const l = clamp(this.data.longBreak, 15, LIM.long);
    this.setData({ customWork: w, customBreak: b, longBreak: l });
    this._savePrefs();
    if (this.data.custom && !this.data.running) {
      const total = w * 60;
      this.setData({ mode: 'work', total, remaining: total, ringOffset: 0 });
    }
  },

  // ---------- 开关 ----------
  toggleAutoNext() {
    this.setData({ autoNext: !this.data.autoNext });
    this._savePrefs();
  },

  toggleLongBreak() {
    this.setData({ longBreakOn: !this.data.longBreakOn });
    this._savePrefs();
  },

  _currentDurations() {
    if (this.data.custom) return { work: this.data.customWork, brk: this.data.customBreak };
    const p = this.data.presets[this.data.presetIdx];
    return { work: p.work, brk: p.brk };
  },

  // ---------- 计时 ----------
  start() {
    if (this.data.running) return;
    // 防御：若上一个 interval 还在（自动续接、快速点按等场景），先清掉再起新的，
    // 否则会同时跑多个计时器，秒数会成倍跳。
    this._clear();
    this.setData({ running: true });
    this._saveRun();
    this._timer = setInterval(() => this._tick(), 1000);
  },

  pause() {
    this.setData({ running: false });
    this._clearRun();
    this._clear();
  },

  toggleRun() {
    if (this.data.running) this.pause();
    else this.start();
  },

  reset() {
    this._clear();
    this._clearRun();
    const d = this._currentDurations();
    const total = (this.data.mode === 'work' ? d.work : d.brk) * 60;
    this.setData({ running: false, remaining: total, total, ringOffset: 0 });
  },

  _tick() {
    let rem = this.data.remaining - 1;
    if (rem <= 0) {
      this._onPhaseEnd();
      return;
    }
    const offset = this.data.ringC * (1 - rem / this.data.total);
    this.setData({ remaining: rem, ringOffset: offset });
  },

  _onPhaseEnd() {
    this._clearRun();
    this._clear();
    wx.vibrateLong && wx.vibrateLong({ fail() {} });
    const d = this._currentDurations();

    if (this.data.mode === 'work') {
      // 完成一段专注
      const newSessions = this.data.sessionsToday + 1;
      const newMinutes = this.data.minutesToday + d.work;
      // 每 N 段进入长休息
      const isLong =
        this.data.longBreakOn && newSessions > 0 && newSessions % this.data.longBreakEvery === 0;
      const brk = isLong ? this.data.longBreak : d.brk;

      this.setData({
        sessionsToday: newSessions,
        minutesToday: newMinutes,
        streak: this.data.streak + 1,
        mode: 'break',
        breakKind: isLong ? 'long' : 'short',
        running: false,
        total: brk * 60,
        remaining: brk * 60,
        ringOffset: 0
      });
      this._saveStats();
      wx.showToast({
        title: isLong
          ? `已${this.data.longBreakEvery}段，长休息 ${brk} 分钟`
          : '专注完成，休息一下',
        icon: 'none'
      });
      if (this.data.autoNext) this.start();
    } else {
      this.setData({
        mode: 'work',
        breakKind: 'short',
        running: false,
        total: d.work * 60,
        remaining: d.work * 60,
        ringOffset: 0
      });
      wx.showToast({ title: '休息结束，继续加油', icon: 'none' });
      if (this.data.autoNext) this.start();
    }
  },

  _clear() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  // 格式化 mm:ss
  fmt(s) {
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return `${m < 10 ? '0' + m : m}:${ss < 10 ? '0' + ss : ss}`;
  }
});
