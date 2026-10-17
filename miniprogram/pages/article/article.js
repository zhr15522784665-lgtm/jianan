// pages/article/article.js
const { getArticle } = require('../../utils/articles.js');

Page({
  data: {
    article: null
  },

  onLoad(options) {
    const id = options.id;
    const article = getArticle(id);
    if (!article) {
      wx.showToast({ title: '文章不存在', icon: 'none' });
      return;
    }
    wx.setNavigationBarTitle({ title: article.cat });
    this.setData({ article });
  },

  goHotline() {
    wx.makePhoneCall({ phoneNumber: '12356', fail() {} });
  },

  leaveOnWall() {
    // 跳转社区并自动打开留言浮层（community onShow 消费该标记）
    getApp().globalData.openWallComposer = true;
    wx.switchTab({ url: '/pages/community/community' });
  }
});
