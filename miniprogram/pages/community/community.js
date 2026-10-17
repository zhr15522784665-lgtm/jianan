// pages/community/community.js
const app = getApp();

const WALL_KEY = 'jianan_wall';

// 手记可选的情绪标签
const MOOD_TAGS = [
  { k: '温暖', e: '🤍' },
  { k: '低落', e: '🌧️' },
  { k: '焦虑', e: '🌪️' },
  { k: '迷茫', e: '🌫️' },
  { k: '坚定', e: '🌟' }
];

// 首次进入时的温暖示例（明确为「见岸的话」，官方内容，仅作手记的起头）
const SEED_WALL = [
  {
    id: 'seed-1',
    text: '你今天愿意打开这个小程序，就已经在照顾自己了。',
    mood: '温暖',
    mine: false,
    seed: true
  },
  {
    id: 'seed-2',
    text: '上岸不是一瞬间的事，是一点一点走出来的。慢慢来。',
    mood: '坚定',
    mine: false,
    seed: true
  },
  {
    id: 'seed-3',
    text: '那些吓到自己的念头，不代表你。它们只是路过。',
    mood: '温暖',
    mine: false,
    seed: true
  },
  {
    id: 'seed-4',
    text: '有些日子只是撑着就已经很累了，撑住的你很勇敢。',
    mood: '低落',
    mine: false,
    seed: true
  },
  {
    id: 'seed-5',
    text: '不知道什么时候会好，也没关系，先过好今天这一小会儿。',
    mood: '迷茫',
    mine: false,
    seed: true
  },
  {
    id: 'seed-6',
    text: '手抖、心慌的时候，我在。我们一起慢慢呼吸。',
    mood: '焦虑',
    mine: false,
    seed: true
  },
  {
    id: 'seed-7',
    text: '今天比昨天多忍住了一次检查，这值得记下来。',
    mood: '坚定',
    mine: false,
    seed: true
  }
];

Page({
  data: {
    articles: [],
    allWall: [],
    wall: [],
    total: 0,
    filter: '全部',
    filters: ['全部', '温暖', '低落', '焦虑', '迷茫', '坚定'],
    moodTags: MOOD_TAGS,
    composer: false,
    draftText: '',
    draftMood: '温暖'
  },

  onLoad() {
    this.loadWall();
    // 文章列表首屏渲染完再补，不阻塞手记内容的出现
    wx.nextTick(() => {
      let ARTICLES = [];
      try {
        ARTICLES = require('../../utils/articles.js').ARTICLES || [];
      } catch (e) {}
      if (ARTICLES.length) this.setData({ articles: ARTICLES });
    });
  },

  onShow() {
    // 仅当数据被别处改动过（或首次）才重读，避免每次切 tab 都全量读盘+重排
    if (this._wallDirty !== false) {
      this.loadWall();
      this._wallDirty = false;
    }
    // 文章页「也想留句话」跳转而来：自动打开留言浮层
    if (app.globalData.openWallComposer) {
      app.globalData.openWallComposer = false;
      this.setData({ composer: true, draftText: '', draftMood: '温暖' });
    }
  },

  loadWall() {
    let wall = [];
    try {
      wall = wx.getStorageSync(WALL_KEY) || [];
    } catch (e) {
      wall = [];
    }
    if (!wall.length) {
      wall = SEED_WALL.slice();
      try {
        wx.setStorageSync(WALL_KEY, wall);
      } catch (e) {}
    }
    // 一次 setData 同时落 allWall 与过滤结果，省掉一轮多余渲染
    this.setData(Object.assign({ allWall: wall, total: wall.length }, this._filtered(wall)));
  },

  // 按当前筛选条件算出要展示的列表（纯函数）
  _filtered(allWall) {
    const f = this.data.filter;
    return { wall: f === '全部' ? allWall : allWall.filter((w) => w.mood === f) };
  },

  applyFilter() {
    this.setData(this._filtered(this.data.allWall));
  },

  setFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.f }, () => this.applyFilter());
  },

  goArticle(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/article/article?id=${id}` });
  },

  openComposer() {
    this.setData({ composer: true, draftText: '', draftMood: '温暖' });
  },

  closeComposer() {
    this.setData({ composer: false });
  },

  onDraftInput(e) {
    this.setData({ draftText: e.detail.value });
  },

  pickMood(e) {
    this.setData({ draftMood: e.currentTarget.dataset.mood });
  },

  submitWall() {
    const text = (this.data.draftText || '').trim();
    if (!text) {
      wx.showToast({ title: '写点什么再记下吧', icon: 'none' });
      return;
    }
    const item = {
      id: 'w-' + Date.now(),
      text,
      mood: this.data.draftMood,
      mine: true,
      seed: false,
      ts: Date.now()
    };
    const allWall = [item].concat(this.data.allWall);
    try {
      wx.setStorageSync(WALL_KEY, allWall);
    } catch (e) {}
    // 重置到「全部」再筛选，确保用户刚写下的话立刻可见（避免被当前情绪筛选挡住）
    // 合并成一次 setData：先更新 filter，再用新 filter 算列表
    this.setData(
      Object.assign(
        { allWall, total: allWall.length, composer: false, draftText: '', filter: '全部' },
        { wall: allWall }
      )
    );
    wx.showToast({ title: '已记下，谢谢你', icon: 'none' });
  },

  deleteWall(e) {
    const id = e.currentTarget.dataset.id;
    const allWall = this.data.allWall.filter((w) => w.id !== id);
    try {
      wx.setStorageSync(WALL_KEY, allWall);
    } catch (e) {}
    this.setData(Object.assign({ allWall, total: allWall.length }, this._filtered(allWall)));
  },

  noop() {}
});
