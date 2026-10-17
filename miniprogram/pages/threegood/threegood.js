// pages/threegood/threegood.js
// 三件好事（Three Good Things）：积极心理学中证据充分的感恩练习。
// 每天睡前记下三件还不错的小事，长期能提升主观幸福感。数据只存本机。
const app = getApp();

Page({
  data: {
    today: '',
    items: ['', '', ''],
    savedToday: false,
    recent: [] // 最近 7 天 [{date, items:[...]}]
  },

  onShow() {
    const today = app.todayKey();
    let list = [];
    try {
      list = wx.getStorageSync('jianan_threegood') || [];
    } catch (e) {}

    const cur = list.find((x) => x.date === today);
    const recent = list.slice().reverse().slice(0, 7);

    this.setData({
      today,
      items: cur ? cur.items.concat(['', '', '']).slice(0, 3) : ['', '', ''],
      savedToday: !!cur,
      recent
    });
  },

  onInput(e) {
    const i = Number(e.currentTarget.dataset.i);
    const items = this.data.items.slice();
    items[i] = e.detail.value;
    this.setData({ items, savedToday: false });
  },

  save() {
    const cleaned = this.data.items.map((s) => (s || '').trim()).filter(Boolean);
    if (cleaned.length === 0) {
      wx.showToast({ title: '先写下至少一件吧', icon: 'none' });
      return;
    }
    let list = [];
    try {
      list = wx.getStorageSync('jianan_threegood') || [];
    } catch (e) {}

    const idx = list.findIndex((x) => x.date === this.data.today);
    const rec = { date: this.data.today, items: cleaned };
    if (idx >= 0) list[idx] = rec;
    else list.push(rec);

    try {
      wx.setStorageSync('jianan_threegood', list.slice(-90));
    } catch (e) {}

    this.setData({
      savedToday: true,
      items: cleaned.concat(['', '', '']).slice(0, 3),
      recent: list.slice().reverse().slice(0, 7)
    });
    wx.showToast({ title: '记下了，真好', icon: 'none' });
  }
});
