// pages/hotlines/hotlines.js
// 全部援助热线：全国热线置顶 + 31 省（含港澳台地区）官方热线，支持搜索与一键拨号
const app = getApp();

Page({
  data: {
    nation: [], // 全国性热线（不带 primary 标记也全列）
    provinces: [], // 全部省份
    filtered: [], // 搜索后的结果
    keyword: '',
    activeProv: '', // 当前选中的省份（'' 表示全部）
    hotCount: 0
  },

  onLoad() {
    const nation = (app.globalData.hotlines || []).map((h) => ({
      name: h.name,
      tel: h.tel,
      note: h.note || '',
      // 24 小时的热线优先展示判断
      is24: /24\s*小时|24h/i.test(h.note || '')
    }));
    const provinces = (app.globalData.provHotlines || []).map((p) => ({
      p: p.p,
      tel: p.tel,
      h24: !!p.h24,
      time: p.time || '',
      org: p.org || '',
      // 预先算好小写检索串，避免每次输入都重复 toLowerCase
      _s: (p.p + ' ' + p.tel + ' ' + (p.org || '')).toLowerCase()
    }));
    this.setData({
      nation,
      provinces,
      filtered: provinces,
      hotCount: provinces.filter((p) => p.h24).length
    });
  },

  onSearch(e) {
    const kw = (e.detail.value || '').trim();
    // 输入抖动：合并 120ms 内的连续按键，只算一次
    if (this._t) clearTimeout(this._t);
    this._t = setTimeout(() => {
      this._t = null;
      this.setData({ keyword: kw });
      this._apply(kw, this.data.activeProv);
    }, 120);
    // 同步记下最新输入值，便于与省份筛选组合时取到当前词
    this._kw = kw;
  },

  clearKeyword() {
    if (this._t) {
      clearTimeout(this._t);
      this._t = null;
    }
    this._kw = '';
    this.setData({ keyword: '' });
    this._apply('', this.data.activeProv);
  },

  // 点省份快捷筛选：再点一次取消
  tapProv(e) {
    const p = e.currentTarget.dataset.p;
    const next = this.data.activeProv === p ? '' : p;
    const kw = this._kw != null ? this._kw : this.data.keyword;
    this.setData({ activeProv: next });
    this._apply(kw, next);
  },

  resetFilter() {
    if (this._t) {
      clearTimeout(this._t);
      this._t = null;
    }
    this._kw = '';
    this.setData({ keyword: '', activeProv: '' });
    this._apply('', '');
  },

  onUnload() {
    if (this._t) {
      clearTimeout(this._t);
      this._t = null;
    }
  },

  // 搜索命中省份名、号码、机构名；省份筛选叠加生效
  // 用预存的 _s 小写串匹配，省掉每次输入的多次 toLowerCase
  _apply(kw, prov) {
    const k = String(kw || '').toLowerCase();
    let list = this.data.provinces;
    if (prov) list = list.filter((x) => x.p === prov);
    if (k) list = list.filter((x) => x._s.indexOf(k) >= 0);
    this.setData({ filtered: list });
  },

  // 一键拨号：号码先去分隔符，避免个别安卓机型拨号盘识别失败
  call(e) {
    const tel = e.currentTarget.dataset.tel;
    if (!tel) return;
    const phoneNumber = app.formatTel(tel);
    wx.makePhoneCall({
      phoneNumber,
      fail: () => {
        // 用户取消拨号不算错误，只有真失败才提示
      }
    });
  },

  // 长按复制号码（部分设备无法直接拨号时的兜底）
  copyTel(e) {
    const tel = e.currentTarget.dataset.tel;
    if (!tel) return;
    wx.setClipboardData({
      data: tel,
      success() {
        wx.showToast({ title: '号码已复制', icon: 'none' });
      }
    });
  }
});
