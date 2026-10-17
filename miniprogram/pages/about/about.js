// pages/about/about.js
const app = getApp();

// 本机数据键前缀，清除时按前缀扫描
const DATA_PREFIX = 'jianan_';

// 备份文件格式标识，导入时用于校验
const BACKUP_FORMAT = 'jianan-backup';
const BACKUP_VERSION = 1;

// 生成文件名用的时间戳：20260921-114530
function backupStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

Page({
  data: {
    hotlines: [],
    provCount: 0,
    // 导出/导入进行中：用于按钮禁用与防重复点击
    exporting: false
  },
  onLoad() {
    this.setData({
      hotlines: app.globalData.hotlines,
      provCount: (app.globalData.provHotlines || []).length
    });
  },
  callHotline(e) {
    wx.makePhoneCall({ phoneNumber: app.formatTel(e.currentTarget.dataset.tel), fail() {} });
  },
  // 长按复制号码：部分设备无法直接拨号时的兜底
  copyTel(e) {
    const tel = e.currentTarget.dataset.tel;
    if (!tel) return;
    wx.setClipboardData({
      data: tel,
      success() {
        wx.showToast({ title: '号码已复制', icon: 'none' });
      }
    });
  },
  goHotlines() {
    wx.navigateTo({ url: '/pages/hotlines/hotlines' });
  },

  // 列出本机所有见岸数据键
  _dataKeys() {
    let keys = [];
    try {
      keys = (wx.getStorageInfoSync() && wx.getStorageInfoSync().keys) || [];
    } catch (e) {
      return [];
    }
    return keys.filter((k) => k.indexOf(DATA_PREFIX) === 0);
  },

  // 汇总本机数据，返回 { payload, keys }；失败返回空 keys
  _collectPayload() {
    const keys = this._dataKeys();
    if (!keys.length) return { payload: null, keys: [] };
    const data = {};
    keys.forEach((k) => {
      try {
        data[k] = wx.getStorageSync(k);
      } catch (e) {}
    });
    return {
      payload: {
        app: '见岸',
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        dataKey: 'jianan_',
        data: data
      },
      keys: keys
    };
  },

  // 导出：把本机记录写入 JSON 文件，交给用户自行保存或转发
  // 小程序没有浏览器下载，落地路径是「写进 USER_DATA_PATH 再打开/转发」
  exportMyData() {
    if (this.data.exporting) return;
    const { payload, keys } = this._collectPayload();
    if (!keys.length || !payload) {
      wx.showToast({ title: '本机还没有记录', icon: 'none' });
      return;
    }

    let text = '';
    try {
      text = JSON.stringify(payload, null, 2);
      if (!text) throw new Error('序列化结果为空');
    } catch (err) {
      wx.showModal({
        title: '导出失败',
        content: '没能生成备份内容。\n' + ((err && err.message) || ''),
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }

    const name = `见岸备份-${backupStamp()}.json`;
    this.setData({ exporting: true });
    wx.showLoading({ title: '正在生成备份…', mask: true });

    wx.getFileSystemManager().writeFile({
      filePath: `${wx.env.USER_DATA_PATH}/${name}`,
      data: text,
      encoding: 'utf8',
      success: () => {
        wx.hideLoading();
        this.setData({ exporting: false });
        this._afterWriteSuccess(name, keys, text);
      },
      fail: (err) => {
        wx.hideLoading();
        this.setData({ exporting: false });
        // 写文件失败时退回剪贴板，至少让用户能把数据带走
        this._fallbackToClipboard(text, (err && err.errMsg) || '文件写入失败');
      }
    });
  },

  // 文件写入成功后的收尾：给出明确提示并提供「打开/转发」两种拿走文件的方式
  _afterWriteSuccess(name, keys, text) {
    const n = keys.length;
    const content =
      `文件名：${name}\n共 ${n} 项本机记录。\n\n` +
      '点「转发文件」可发给自己的微信好友（如文件传输助手）长期留存，' +
      '点「打开文件」可选用其他应用打开或另存到手机。\n' +
      '备份里含你的心情与留言，请自行保管，不要外传。';
    wx.showModal({
      title: '备份已生成',
      content,
      confirmText: '转发文件',
      cancelText: '打开文件',
      success: (res) => {
        if (res.confirm) {
          wx.shareFileMessage({
            filePath: `${wx.env.USER_DATA_PATH}/${name}`,
            fileName: name,
            fail: () => this._openBackupFile(name, true)
          });
        } else if (res.cancel) {
          this._openBackupFile(name, false);
        }
      }
    });
  },

  // 打开备份文件；打开失败时再退回剪贴板
  _openBackupFile(name, fromShare) {
    const filePath = `${wx.env.USER_DATA_PATH}/${name}`;
    wx.openDocument({
      filePath: filePath,
      fileType: 'json',
      showMenu: true,
      fail: () => {
        if (fromShare) {
          // 转发与打开都不行，退回剪贴板
          try {
            const text = wx.getFileSystemManager().readFileSync(filePath, 'utf8');
            this._fallbackToClipboard(text, '当前环境不支持打开或转发文件');
          } catch (e) {
            wx.showModal({
              title: '导出失败',
              content:
                '备份文件已生成，但当前环境无法打开或转发。请改用「导入恢复」所在的旧设备重试。',
              showCancel: false,
              confirmText: '知道了'
            });
          }
          return;
        }
        try {
          const text = wx.getFileSystemManager().readFileSync(filePath, 'utf8');
          this._fallbackToClipboard(text, '当前设备不支持直接打开文件');
        } catch (e) {
          wx.showModal({
            title: '导出失败',
            content: '备份文件已生成，但当前设备无法打开。可尝试从「转发文件」另存。',
            showCancel: false,
            confirmText: '知道了'
          });
        }
      }
    });
  },

  // 兜底：复制到剪贴板（保留原有能力），成功/失败都明确告知
  _fallbackToClipboard(text, reason) {
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showModal({
          title: '已改用剪贴板',
          content: `${reason}，备份内容已复制到剪贴板，请粘贴到备忘录或文件中保存。\n注意：里面含有你的心情与留言，请自行保管。`,
          showCancel: false,
          confirmText: '知道了'
        });
      },
      fail: (err) => {
        wx.showModal({
          title: '导出失败',
          content: `${reason}，复制到剪贴板也未成功，原有数据未受影响。\n${(err && err.errMsg) || ''}`,
          showCancel: false,
          confirmText: '知道了'
        });
      }
    });
  },

  // 导入：从剪贴板读回备份，校验后覆盖（换手机时迁移用）
  // 兼容两种格式：新版 { format:'jianan-backup', data:{...} } 与旧版 { jianan_xxx: ... }
  importMyData() {
    if (this.data.exporting) return;
    wx.getClipboardData({
      success: (res) => {
        const text = res.data || '';
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          wx.showModal({
            title: '无法识别',
            content:
              '剪贴板里的内容不是见岸导出的备份。请先在旧手机上点「导出备份」，复制成功后回到这里导入。',
            showCancel: false,
            confirmText: '知道了'
          });
          return;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          wx.showToast({ title: '备份格式不正确', icon: 'none' });
          return;
        }

        // 新格式：数据在 data 字段里；旧格式：键平铺在顶层
        const src =
          parsed.format === BACKUP_FORMAT &&
          parsed.data &&
          typeof parsed.data === 'object' &&
          !Array.isArray(parsed.data)
            ? parsed.data
            : parsed;
        // 只认 jianan_ 开头的键，避免误写其他数据
        const keys = Object.keys(src).filter(
          (k) => k.indexOf(DATA_PREFIX) === 0 && k !== 'exportedAt'
        );
        if (!keys.length) {
          wx.showModal({
            title: '备份里没有数据',
            content: '没有找到见岸的记录，可能是复制的文本不完整。请重新导出一次。',
            showCancel: false,
            confirmText: '知道了'
          });
          return;
        }

        const desc = keys
          .map((k) => {
            const v = src[k];
            const n = Array.isArray(v) ? v.length : 1;
            return `${k.replace(DATA_PREFIX, '')}（${n}）`;
          })
          .join('、');

        wx.showModal({
          title: '导入备份',
          content: `将用备份覆盖当前数据：\n${desc}\n\n覆盖后无法撤销，建议先导出当前记录。`,
          confirmText: '导入并覆盖',
          cancelText: '取消',
          success: (r) => {
            if (r.confirm) this._doImport(src, keys);
          }
        });
      },
      fail: () => {
        wx.showToast({ title: '读取剪贴板失败', icon: 'none' });
      }
    });
  },

  _doImport(payload, keys) {
    this.setData({ exporting: true });
    wx.showLoading({ title: '正在导入…', mask: true });
    let fail = 0;
    const failMsgs = [];
    keys.forEach((k) => {
      try {
        wx.setStorageSync(k, payload[k]);
      } catch (e) {
        fail++;
        failMsgs.push(k);
      }
    });
    wx.hideLoading();
    this.setData({ exporting: false });
    if (fail) {
      wx.showModal({
        title: `有 ${fail} 项导入失败`,
        content: `失败项：${failMsgs.map((k) => k.replace(DATA_PREFIX, '')).join('、')}\n其余记录已恢复，原有数据未被清空。`,
        showCancel: false,
        confirmText: '知道了'
      });
    } else {
      wx.showModal({
        title: '导入完成',
        content: '记录已恢复。部分页面需要重新进入才会刷新显示。',
        showCancel: false,
        confirmText: '好'
      });
    }
  },

  // 清除：删掉本机全部见岸数据
  clearCloudData() {
    if (this._cloudDeleting) return;
    wx.showModal({
      title: '删除云端健康自助记录',
      content:
        '将删除当前微信账号保存的自评、阶梯、症状日志和困扰档案。此操作不可恢复，本机记录和自行导出的备份需另外清理。',
      confirmText: '确认删除',
      confirmColor: '#e2483d',
      success: (result) => {
        if (!result.confirm || this._cloudDeleting) return;
        if (!wx.cloud || !wx.cloud.callFunction) {
          wx.showToast({ title: '云能力不可用', icon: 'none' });
          return;
        }
        this._cloudDeleting = true;
        wx.cloud
          .callFunction({
            name: 'ocd',
            data: { action: 'privacy.deleteMine', payload: { confirmation: 'DELETE_MY_OCD_DATA' } }
          })
          .then((res) => {
            if (!res.result || !res.result.ok) throw new Error('delete failed');
            wx.showModal({
              title: '删除完成',
              content: '当前账号的云端健康自助记录已删除。',
              showCancel: false
            });
          })
          .catch(() =>
            wx.showModal({
              title: '删除未完成',
              content: '部分记录可能已删除，请检查网络后再次操作以完成清理。',
              showCancel: false
            })
          )
          .finally(() => {
            this._cloudDeleting = false;
          });
      }
    });
  },

  clearMyData() {
    const keys = this._dataKeys();
    if (!keys.length) {
      wx.showToast({ title: '本机没有可清除的记录', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '清除我的数据',
      content: `将删除本机的全部记录（${keys.length} 项）：心情打卡、番茄与冥想统计、手记。\n\n此操作不可恢复，建议先导出备份。`,
      confirmText: '确认清除',
      confirmColor: '#e2483d',
      cancelText: '再想想',
      success: (res) => {
        if (!res.confirm) return;
        let fail = 0;
        keys.forEach((k) => {
          try {
            wx.removeStorageSync(k);
          } catch (e) {
            fail++;
          }
        });
        if (fail) {
          wx.showToast({ title: `有 ${fail} 项清除失败`, icon: 'none' });
        } else {
          wx.showModal({
            title: '已清除',
            content:
              '本机记录已全部清空。此操作不会删除你另行同意保存的云端自评、阶梯、档案和日志，也不会删除你自行导出的备份。',
            showCancel: false,
            confirmText: '好'
          });
        }
      }
    });
  }
});
