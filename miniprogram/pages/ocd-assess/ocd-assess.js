const { BRIEF, DETAIL, OPTIONS } = require('./assess-items');
const { scoreAnswers, nextStep } = require('./scoring');

Page({
  data: {
    stage: 'choose',
    version: '',
    items: [],
    options: OPTIONS,
    answers: [],
    current: 0,
    disclaimer: false,
    cloudConsent: false,
    result: null,
    saving: false,
    error: ''
  },

  choose(e) {
    if (!this.data.disclaimer) {
      wx.showToast({ title: '请先确认这不是诊断', icon: 'none' });
      return;
    }
    const version = e.currentTarget.dataset.version;
    this._submissionId = Date.now() + '-' + Math.random().toString(36).slice(2);
    const items = version === 'brief-12' ? BRIEF : DETAIL;
    this.setData({
      stage: 'quiz',
      version,
      items,
      answers: Array(items.length).fill(null),
      current: 0,
      error: ''
    });
  },

  checkDisclaimer(e) {
    this.setData({ disclaimer: Array.isArray(e.detail.value) && e.detail.value.includes('yes') });
  },

  checkCloudConsent(e) {
    this.setData({ cloudConsent: Array.isArray(e.detail.value) && e.detail.value.includes('yes') });
  },

  answer(e) {
    const answers = this.data.answers.slice();
    answers[this.data.current] = Number(e.currentTarget.dataset.value);
    this.setData({ answers });
  },

  next() {
    if (this.data.answers[this.data.current] == null) {
      wx.showToast({ title: '先选择一个频率', icon: 'none' });
      return;
    }
    if (this.data.current + 1 < this.data.items.length) {
      this.setData({ current: this.data.current + 1 });
      return;
    }
    this.submit();
  },

  prev() {
    if (this.data.current > 0) this.setData({ current: this.data.current - 1 });
  },

  submit() {
    if (!this.data.disclaimer) {
      wx.showToast({ title: '请先确认这不是诊断', icon: 'none' });
      return;
    }
    let result;
    try {
      result = scoreAnswers(this.data.answers, this.data.version);
    } catch (error) {
      this.setData({ error: error.message });
      return;
    }
    result.nextStep = nextStep(result);
    this.setData({ result, stage: 'result', saving: true, error: '' });
    if (this.data.cloudConsent) this._save(result);
    else this.setData({ saving: false });
  },

  _save(result) {
    if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      this.setData({
        saving: false,
        error: '当前只显示本地结果，云端保存需要在微信云开发环境中使用。'
      });
      return;
    }
    wx.cloud
      .callFunction({
        name: 'ocd',
        data: {
          action: 'assess.submit',
          payload: {
            answers: this.data.answers,
            submissionId: this._submissionId,
            scaleVersion: result.scaleVersion,
            disclaimerAccepted: true,
            sensitiveConsent: true
          }
        }
      })
      .then((res) => {
        if (!res.result || res.result.ok === false) throw new Error('保存失败');
        this.setData({ saving: false });
      })
      .catch(() => {
        this.setData({
          saving: false,
          error: '结果已显示，但云端暂时未保存。请检查网络后重新提交。'
        });
      });
  },

  retrySave() {
    if (!this.data.result || !this.data.cloudConsent || this.data.saving) return;
    this.setData({ saving: true, error: '' });
    this._save(this.data.result);
  },

  restart() {
    this.setData({
      stage: 'choose',
      result: null,
      version: '',
      answers: [],
      disclaimer: false,
      cloudConsent: false,
      error: ''
    });
  }
});
