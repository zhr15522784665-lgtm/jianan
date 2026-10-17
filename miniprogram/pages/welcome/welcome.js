// pages/welcome/welcome.js —— 启动欢迎页
// 对焦虑的人来说，每次打开都强制等 1.8 秒是一种负担。
// 首次启动慢一点（看清品牌），之后快速掠过；任何时候都可以点「进入」直接走。
const FIRST_DELAY = 1600;
const AGAIN_DELAY = 600;
const LAUNCH_KEY = 'jianan_launched';

Page({
  _t: null,
  onLoad() {
    let launched = false;
    try {
      launched = !!wx.getStorageSync(LAUNCH_KEY);
    } catch (e) {}
    this._t = setTimeout(() => this.enter(), launched ? AGAIN_DELAY : FIRST_DELAY);
  },
  enter() {
    if (this._t) {
      clearTimeout(this._t);
      this._t = null;
    }
    try {
      wx.setStorageSync(LAUNCH_KEY, true);
    } catch (e) {}
    wx.reLaunch({ url: '/pages/index/index' });
  },
  onUnload() {
    if (this._t) {
      clearTimeout(this._t);
      this._t = null;
    }
  }
});
