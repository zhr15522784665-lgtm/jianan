const { callOCD } = require('../../utils/ocd-client');
const { clampSuds, sortSteps, progressSeries, practiceId } = require('./exposure-logic');
Page({
  data: {
    steps: [],
    selected: null,
    stage: 'choose',
    title: '',
    description: '',
    level: 30,
    target: 50,
    before: 50,
    after: 50,
    resisted: false,
    paused: false,
    remaining: 120,
    history: [],
    error: '',
    saving: false,
    cloudConsent: false
  },
  onShow() {
    this.loadSteps();
  },
  call: callOCD,
  loadSteps() {
    this.call('step.list', {})
      .then((steps) => this.setData({ steps: sortSteps(steps), error: '' }))
      .catch(() => this.setData({ error: '阶梯暂时加载失败，请检查网络后重试。' }));
  },
  onField(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },
  onLevel(e) {
    this.setData({ level: clampSuds(e.detail.value) });
  },
  onTarget(e) {
    this.setData({ target: clampSuds(e.detail.value) });
  },
  onBefore(e) {
    this.setData({ before: clampSuds(e.detail.value) });
  },
  onAfter(e) {
    this.setData({ after: clampSuds(e.detail.value) });
  },
  toggleResisted(e) {
    this.setData({ resisted: Array.isArray(e.detail.value) && e.detail.value.includes('done') });
  },
  checkCloudConsent(e) {
    this.setData({ cloudConsent: Array.isArray(e.detail.value) && e.detail.value.includes('yes') });
  },
  addStep() {
    if (this._adding || this.data.saving) return;
    if (!String(this.data.title).trim()) {
      wx.showToast({ title: '请填写情境标题', icon: 'none' });
      return;
    }
    if (!this.data.cloudConsent) {
      wx.showToast({ title: '请先同意云端保存', icon: 'none' });
      return;
    }
    this._adding = true;
    this.setData({ saving: true });
    return this.call('step.add', {
      title: this.data.title,
      description: this.data.description,
      level: clampSuds(this.data.level),
      sudsTarget: clampSuds(this.data.target),
      sensitiveConsent: true
    })
      .then(() => {
        this.setData({ title: '', description: '', saving: false });
        this.loadSteps();
      })
      .catch(() => this.setData({ saving: false, error: '新增失败，请稍后重试。' }))
      .finally(() => {
        this._adding = false;
      });
  },
  selectStep(e) {
    const selected = this.data.steps.find((item) => item._id === e.currentTarget.dataset.id);
    if (!selected || this.data.saving) return;
    this._clearTimer();
    this._practice = null;
    this._startedAt = Date.now();
    this.setData({ selected, stage: 'before', before: 50, after: 50, resisted: false, error: '' });
    return this.loadHistory(selected._id);
  },
  async loadHistory(stepId) {
    try {
      const items = [];
      let before;
      do {
        const page = await this.call('log.list', { limit: 100, stepId, before });
        items.push(...page.items);
        before = page.hasMore ? page.nextBefore : null;
      } while (before);
      if (this.data.selected && this.data.selected._id === stepId)
        this.setData({ history: progressSeries(items, stepId) });
    } catch (error) {
      this.setData({ error: '历史加载失败，请重新选择阶梯重试。' });
    }
  },
  begin() {
    this._clearTimer();
    this._elapsed = 0;
    this._segmentStart = Date.now();
    this.setData({ stage: 'running', remaining: 120, paused: false });
    this._tick();
  },
  _activeMs() {
    return (
      (this._elapsed || 0) +
      (this._segmentStart == null ? 0 : Math.max(0, Date.now() - this._segmentStart))
    );
  },
  _freezeTime() {
    this._elapsed = this._activeMs();
    this._segmentStart = null;
  },
  _tick() {
    this._clearTimer();
    if (this.data.paused || this.data.stage !== 'running') return;
    const remaining = Math.max(0, 120 - Math.floor(this._activeMs() / 1000));
    this.setData({ remaining });
    if (remaining <= 0) {
      this.finish();
      return;
    }
    this._timer = setTimeout(() => this._tick(), 250);
  },
  togglePause() {
    const paused = !this.data.paused;
    this._clearTimer();
    if (paused) this._freezeTime();
    else this._segmentStart = Date.now();
    this.setData({ paused });
    if (!paused) this._tick();
  },
  finish() {
    this._freezeTime();
    this._clearTimer();
    this.setData({
      stage: 'after',
      paused: false,
      remaining: Math.max(0, 120 - Math.floor(this._elapsed / 1000))
    });
  },
  savePractice() {
    if (
      !this.data.selected ||
      this._savingPractice ||
      this.data.saving ||
      this.data.stage !== 'after'
    )
      return;
    if (!this.data.cloudConsent) {
      wx.showToast({ title: '请先同意云端保存', icon: 'none' });
      return;
    }
    this._savingPractice = true;
    const id = practiceId(this.data.selected._id, this._startedAt);
    this.setData({ saving: true });
    if (!this._practice)
      this._practice = {
        type: 'exposure',
        trigger: this.data.selected.title,
        thought: this.data.selected.description || '',
        behavior: '练习中减少检查、中和和寻求保证',
        resisted: this.data.resisted,
        durationMin: Math.round(Math.min(120000, this._activeMs()) / 6000) / 10,
        sudsBefore: clampSuds(this.data.before),
        sudsAfter: clampSuds(this.data.after),
        stepId: this.data.selected._id,
        practiceId: id,
        note: '',
        sensitiveConsent: true
      };
    const payload = this._practice;
    return this.call('log.add', payload)
      .then(() =>
        this.call('step.update', {
          id: payload.stepId,
          status: 'in_progress',
          lastSuds: payload.sudsAfter,
          attemptsDelta: 1,
          practiceId: payload.practiceId,
          sensitiveConsent: true
        })
      )
      .then(() => {
        this.setData({ stage: 'done' });
        this.loadSteps();
        return this.loadHistory(payload.stepId);
      })
      .catch(() => this.setData({ error: '记录保存不完整，请重试保存。' }))
      .finally(() => {
        this._savingPractice = false;
        this.setData({ saving: false });
      });
  },
  reset() {
    if (this.data.saving) return;
    this._clearTimer();
    this._practice = null;
    this.setData({ stage: 'choose', selected: null, error: '' });
  },
  _clearTimer() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  },
  onHide() {
    if (this.data.stage === 'running' && !this.data.paused) this.togglePause();
  },
  onUnload() {
    this._clearTimer();
  }
});
