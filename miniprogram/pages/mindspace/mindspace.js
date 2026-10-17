// pages/mindspace/mindspace.js
const app = getApp();

Page({
  data: {
    moodToday: null,
    moodEmoji: { 很好: '😊', 不错: '🙂', 一般: '😐', 低落: '😔', 糟糕: '😣' },
    overview: { minutes: 0, meditation: 0, sessions: 0, mood: null, moodEmoji: '🌤️' },
    // 只放情绪调节三件套。番茄钟是效率工具，归到首页「把日子过稳」，
    // 放在这里会稀释「我很难受，先缓一缓」的场景。
    tools: [
      {
        key: 'breathe',
        icon: '🌬️',
        title: '呼吸训练',
        desc: '跟着节奏吸气呼气，快速平复',
        page: '/pages/breathe/breathe'
      },
      {
        key: 'ground',
        icon: '🪨',
        title: '着陆练习',
        desc: '5-4-3-2-1 把注意力拉回此刻',
        page: '/pages/ground/ground'
      },
      {
        key: 'meditation',
        icon: '🧘',
        title: '冥想引导',
        desc: '身体扫描 · 慈心 · 入睡引导',
        page: '/pages/meditation/meditation'
      },
      {
        key: 'mood',
        icon: '🌤️',
        title: '情绪打卡',
        desc: '记录此刻心情，看见变化',
        page: '/pages/mood/mood'
      }
    ]
  },

  onShow() {
    const m = app.moodToday();
    const pomo = app.getPomodoro();
    const med = app.getMeditation();
    const today = app.todayKey();
    const sameDay = (r) => r && r.date === today;
    this.setData({
      moodToday: m,
      overview: {
        minutes: sameDay(pomo) ? pomo.minutes || 0 : 0,
        sessions: sameDay(pomo) ? pomo.sessions || 0 : 0,
        meditation: sameDay(med) ? med.count || 0 : 0,
        mood: m ? m.mood : null,
        moodEmoji: m ? this.data.moodEmoji[m.mood] : '🌤️'
      }
    });
  },

  openTool(e) {
    const page = e.currentTarget.dataset.page;
    wx.navigateTo({ url: page });
  }
});
