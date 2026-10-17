// pages/meditation/meditation.js
const RING_R = 120;
const RING_C = 2 * Math.PI * RING_R;
const CUE_INTERVAL = 40; // 每 40 秒轮换一句引导语

Page({
  data: {
    sessions: [
      {
        id: 'breathe',
        icon: '🌬️',
        title: '呼吸冥想',
        minutes: 5,
        desc: '把注意力轻轻放在呼吸上，走神了就回来。',
        open: '找个舒服的姿势坐下或躺下，闭上眼睛，先做三次长长的呼吸。',
        close: '慢慢把注意力带回身体，活动一下手指脚趾，当你准备好了，睁开眼睛。',
        cues: [
          '感受空气从鼻尖流入，再缓缓流出。',
          '不需要改变呼吸，只是看着它。',
          '如果思绪飘走了，没关系，轻轻把它带回到呼吸。',
          '此刻没有什么要急着去做。',
          '让肩膀松下来，让下巴松下来。'
        ]
      },
      {
        id: 'body',
        icon: '🧘',
        title: '身体扫描',
        minutes: 8,
        desc: '从脚到头顶，逐一觉察身体的感受。',
        open: '平躺下来，闭上眼睛，把注意力交还给身体。',
        close: '感受整个身体作为一个整体，安静地躺在这里。慢慢睁开眼睛。',
        cues: [
          '把注意力带到脚趾，感受它们的重量与温度。',
          '沿着小腿、膝盖，慢慢向上。',
          '觉察腹部随着呼吸轻轻起伏。',
          '注意胸口、肩膀，看是否有什么紧绷。',
          '让注意力滑过手臂、手指。',
          '来到脖颈、脸颊、眉心，让它们慢慢松开。',
          '最后，感受整个身体安静地休息着。'
        ]
      },
      {
        id: 'loving',
        icon: '💗',
        title: '慈心冥想',
        minutes: 6,
        desc: '把温柔的善意，先给自己，再给世界。',
        open: '闭上眼睛，把手轻放胸口，感受那里的温度。',
        close: '带着这份善意，慢慢睁开眼睛，把它带进今天。',
        cues: [
          '在心里对自己说：愿我平安，愿我健康，愿我自在。',
          '想起一个你亲近的人，愿他也被温柔以待。',
          '想起一个平时疏远的人，也把善意轻轻送给他。',
          '把这份善意扩展开来，愿所有生命都被善待。',
          '回到自己，再一次，愿我平安。'
        ]
      },
      {
        id: 'sleep',
        icon: '🌙',
        title: '入睡引导',
        minutes: 10,
        desc: '慢慢松掉一整天的紧绷，沉入睡眠。',
        open: '躺好，把灯调暗，让身体陷进床里。',
        close: '你已经很努力了今天。现在，把一切交给夜晚，安心睡去。',
        cues: [
          '从脚趾开始，想象它们一点点变沉、变松。',
          '松弛感沿着双腿向上，来到腰和背。',
          '肩膀不再扛着什么，慢慢落下来。',
          '下巴放松，舌头放松，眼皮也沉沉地合上。',
          '想象自己漂浮在温暖的水面，随波轻轻摇晃。',
          '不需要再想任何事，只要跟着呼吸，慢慢沉下去。',
          '如果还醒着，也没关系，继续放松，睡眠会自己到来。'
        ]
      }
    ],
    view: 'list', // list | play
    current: null,
    running: false,
    elapsed: 0,
    total: 0,
    remaining: 0,
    ringC: RING_C,
    ringOffset: 0,
    stepText: '',
    finished: false
  },

  onUnload() {
    this._clear();
  },

  choose(e) {
    const id = e.currentTarget.dataset.id;
    const s = this.data.sessions.find((x) => x.id === id);
    const total = s.minutes * 60;
    this.setData({
      view: 'play',
      current: s,
      running: false,
      elapsed: 0,
      total,
      remaining: total,
      ringOffset: 0,
      finished: false,
      stepText: s.open
    });
    this._clear();
  },

  backToList() {
    this._clear();
    this.setData({ view: 'list', running: false });
  },

  start() {
    if (this.data.running || this.data.finished) return;
    // 防御：先清旧表，避免重复 start 造成多个定时器并行
    this._clear();
    this.setData({ running: true });
    this._timer = setInterval(() => this._tick(), 1000);
  },

  pause() {
    this.setData({ running: false });
    this._clear();
  },

  toggleRun() {
    if (this.data.running) this.pause();
    else this.start();
  },

  restart() {
    this._clear();
    const total = this.data.current.minutes * 60;
    this.setData({
      running: false,
      elapsed: 0,
      total,
      remaining: total,
      ringOffset: 0,
      finished: false,
      stepText: this.data.current.open
    });
  },

  _tick() {
    let el = this.data.elapsed + 1;
    if (el >= this.data.total) {
      this._finish();
      return;
    }
    this.setData({ elapsed: el, remaining: this.data.total - el });
    this._updateStep(el);
    this.setData({ ringOffset: this.data.ringC * (1 - el / this.data.total) });
  },

  _updateStep(el) {
    const s = this.data.current;
    const rem = this.data.total - el;
    let text;
    if (el < 15) text = s.open;
    else if (rem <= 15) text = s.close;
    else {
      const idx = Math.floor((el - 15) / CUE_INTERVAL) % s.cues.length;
      text = s.cues[idx];
    }
    if (text !== this.data.stepText) this.setData({ stepText: text });
  },

  _finish() {
    this._clear();
    wx.vibrateLong && wx.vibrateLong({ fail() {} });
    // 记录今日冥想次数（本地，不出端）
    const app = getApp();
    let rec = null;
    try {
      rec = wx.getStorageSync('jianan_meditation') || null;
    } catch (e) {}
    const today = app.todayKey();
    if (!rec || rec.date !== today) rec = { date: today, count: 0 };
    rec.count += 1;
    try {
      wx.setStorageSync('jianan_meditation', rec);
    } catch (e) {}
    this.setData({
      running: false,
      finished: true,
      elapsed: this.data.total,
      remaining: 0,
      ringOffset: this.data.ringC,
      stepText: this.data.current.close
    });
  },

  // 完成/退出后回到正念空间（meditation 总由 mindspace 进入）
  toMindspace() {
    wx.navigateBack({
      delta: 1,
      fail() {
        wx.reLaunch({ url: '/pages/mindspace/mindspace' });
      }
    });
  },

  // 切后台停表省电，回前台继续（引导音频/语音由系统自行处理，与计时无关）
  onHide() {
    this._clear();
  },

  onShow() {
    if (this.data.view === 'play' && this.data.running && !this._timer) {
      this._timer = setInterval(() => this._tick(), 1000);
    }
  },

  _clear() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
});
