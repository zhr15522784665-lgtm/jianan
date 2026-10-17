// pages/ground/ground.js
// 5-4-3-2-1 着陆法：把注意力拉回此刻的身体感官，缓解焦虑/解离
Page({
  data: {
    steps: [
      {
        n: 5,
        sense: '看到',
        hint: '留意身边 5 样你能看见的东西，描述它们的颜色或形状。',
        note: '',
        done: false
      },
      {
        n: 4,
        sense: '摸到',
        hint: '感受 4 样你能触摸的物体，注意它们的温度、质地、软硬。',
        note: '',
        done: false
      },
      { n: 3, sense: '听到', hint: '倾听 3 种声音，近处的和远处的都可以。', note: '', done: false },
      { n: 2, sense: '闻到', hint: '辨别 2 种气味，哪怕很淡。', note: '', done: false },
      { n: 1, sense: '尝到', hint: '留意 1 种味道，或喝一口水感受它。', note: '', done: false }
    ]
  },

  onNote(e) {
    const i = e.currentTarget.dataset.i;
    const key = `steps[${i}].note`;
    this.setData({ [key]: e.detail.value });
  },

  toggle(e) {
    const i = e.currentTarget.dataset.i;
    const key = `steps[${i}].done`;
    this.setData({ [key]: !this.data.steps[i].done });
  }
});
