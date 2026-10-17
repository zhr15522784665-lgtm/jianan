const { callOCD } = require('../../utils/ocd-client');
Page({
  data: { stats: null, stepProgress: { total: 0, completed: 0 }, error: '' },
  onShow() {
    this.load();
  },
  call: callOCD,
  load() {
    Promise.all([
      this.call('log.stats', { days: 7, sensitiveConsent: true }),
      this.call('step.list', { sensitiveConsent: true })
    ])
      .then(([stats, steps]) => {
        const list = Array.isArray(steps) ? steps : [];
        this.setData({
          stats,
          stepProgress: {
            total: list.length,
            completed: list.filter((item) => item.status === 'completed').length
          },
          error: ''
        });
      })
      .catch(() => this.setData({ error: '本周数据暂时无法加载；进入具体工具后可重试。' }));
  },
  goAssess() {
    wx.navigateTo({ url: '/pages/ocd-assess/ocd-assess' });
  },
  goExposure() {
    wx.navigateTo({ url: '/pages/exposure/exposure' });
  },
  goLog() {
    wx.navigateTo({ url: '/pages/ocd-log/ocd-log' });
  }
});
