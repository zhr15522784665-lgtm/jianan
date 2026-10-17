// pages/safety/safety.js
// 个人安全计划（Safety Plan）：基于 Stanley & Brown 临床验证模型——
// 在平静时预先写下预警信号、自我应对、信任联系人、专业热线， crisis 时刻能直接照着做。
// 数据只存本机，不上传。
const app = getApp();

const DEF = { signs: '', cope: '', contacts: [{ name: '', phone: '' }], note: '' };

Page({
  data: {
    signs: '',
    cope: '',
    contacts: [{ name: '', phone: '' }],
    note: '',
    saved: false
  },

  onShow() {
    let s = DEF;
    try {
      s = wx.getStorageSync('jianan_safety') || DEF;
    } catch (e) {}

    const contacts = s.contacts && s.contacts.length ? s.contacts : [{ name: '', phone: '' }];
    this.setData({
      signs: s.signs || '',
      cope: s.cope || '',
      contacts,
      note: s.note || '',
      saved: false
    });
  },

  onSigns(e) {
    this.setData({ signs: e.detail.value, saved: false });
  },
  onCope(e) {
    this.setData({ cope: e.detail.value, saved: false });
  },
  onNote(e) {
    this.setData({ note: e.detail.value, saved: false });
  },

  onCName(e) {
    const i = Number(e.currentTarget.dataset.i);
    const c = this.data.contacts.slice();
    c[i] = Object.assign({}, c[i], { name: e.detail.value });
    this.setData({ contacts: c, saved: false });
  },
  onCPhone(e) {
    const i = Number(e.currentTarget.dataset.i);
    const c = this.data.contacts.slice();
    c[i] = Object.assign({}, c[i], { phone: e.detail.value });
    this.setData({ contacts: c, saved: false });
  },

  addContact() {
    const c = this.data.contacts.slice();
    if (c.length < 3) c.push({ name: '', phone: '' });
    this.setData({ contacts: c });
  },
  delContact(e) {
    const i = Number(e.currentTarget.dataset.i);
    const c = this.data.contacts.slice();
    c.splice(i, 1);
    if (!c.length) c.push({ name: '', phone: '' });
    this.setData({ contacts: c, saved: false });
  },

  callContact(e) {
    const tel = e.currentTarget.dataset.tel;
    if (tel) wx.makePhoneCall({ phoneNumber: tel, fail() {} });
  },

  callHotline() {
    wx.makePhoneCall({ phoneNumber: '12356', fail() {} });
  },

  save() {
    const data = {
      signs: this.data.signs,
      cope: this.data.cope,
      contacts: this.data.contacts.filter((c) => c.name || c.phone),
      note: this.data.note
    };
    try {
      wx.setStorageSync('jianan_safety', data);
    } catch (e) {}
    this.setData({ saved: true });
    wx.showToast({ title: '已保存安全计划', icon: 'none' });
  }
});
