const { callOCD } = require('../../utils/ocd-client');
const { aggregate } = require('./stats');
Page({
  data: {
    type: 'obsession',
    trigger: '',
    thought: '',
    behavior: '',
    resisted: false,
    durationMin: 0,
    sudsBefore: 50,
    sudsAfter: 50,
    note: '',
    filter: 'all',
    items: [],
    stats: null,
    loading: false,
    error: '',
    cloudConsent: false,
    hasMore: false,
    nextBefore: null,
    types: [
      { id: 'obsession', name: '强迫思维' },
      { id: 'compulsion', name: '强迫行为' },
      { id: 'urge', name: '冲动' },
      { id: 'exposure', name: '暴露' }
    ]
  },
  onShow() {
    this.load();
  },
  onField(e) {
    this.setData({ [e.currentTarget.dataset.field]: String(e.detail.value).slice(0, 2000) });
  },
  chooseType(e) {
    this.setData({ type: e.currentTarget.dataset.type });
  },
  toggleResisted(e) {
    this.setData({ resisted: Array.isArray(e.detail.value) && e.detail.value.includes('done') });
  },
  checkCloudConsent(e) {
    this.setData({ cloudConsent: Array.isArray(e.detail.value) && e.detail.value.includes('yes') });
  },
  onSuds(e) {
    this.setData({ [e.currentTarget.dataset.field]: Number(e.detail.value) });
  },
  chooseFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.filter });
  },
  call: callOCD,
  save() {
    if (this._savingLog || this.data.loading) return;
    if (!String(this.data.trigger).trim()) {
      wx.showToast({ title: '请填写触发情境', icon: 'none' });
      return;
    }
    if (!this.data.cloudConsent) {
      wx.showToast({ title: '请先同意云端保存', icon: 'none' });
      return;
    }
    this._savingLog = true;
    this.setData({ loading: true, error: '' });
    this.call('log.add', {
      type: this.data.type,
      trigger: this.data.trigger,
      thought: this.data.thought,
      behavior: this.data.behavior,
      resisted: this.data.resisted,
      durationMin: Number(this.data.durationMin) || 0,
      sudsBefore: Number(this.data.sudsBefore),
      sudsAfter: Number(this.data.sudsAfter),
      note: this.data.note,
      sensitiveConsent: true
    })
      .then(() => {
        this.setData({ trigger: '', thought: '', behavior: '', note: '', loading: false });
        this.load();
        wx.showToast({ title: '已记录', icon: 'none' });
      })
      .catch(() => this.setData({ loading: false, error: '保存失败，请检查网络后重试。' }))
      .finally(() => {
        this._savingLog = false;
      });
  },
  load() {
    this.setData({ loading: true, nextBefore: null, hasMore: false });
    Promise.all([this.call('log.list', { limit: 50 }), this.call('log.stats', { days: 7 })])
      .then(([result, stats]) => {
        const page =
          result && Array.isArray(result.items)
            ? result
            : { items: Array.isArray(result) ? result : [], hasMore: false, nextBefore: null };
        this.setData({
          items: page.items,
          stats: stats || aggregate(page.items, 7),
          hasMore: page.hasMore === true,
          nextBefore: page.nextBefore || null,
          loading: false,
          error: ''
        });
      })
      .catch(() => this.setData({ loading: false, error: '记录暂时加载失败，请稍后重试。' }));
  },
  loadMore() {
    if (!this.data.hasMore || this.data.loading || !this.data.nextBefore) return;
    this.setData({ loading: true });
    this.call('log.list', { limit: 50, before: this.data.nextBefore })
      .then((result) => {
        const page =
          result && Array.isArray(result.items)
            ? result
            : { items: [], hasMore: false, nextBefore: null };
        const items = this.data.items.concat(page.items);
        this.setData({
          items,
          hasMore: page.hasMore === true,
          nextBefore: page.nextBefore || null,
          loading: false
        });
      })
      .catch(() => this.setData({ loading: false, error: '加载更多失败，请稍后重试。' }));
  },
  retry() {
    this.load();
  }
});
