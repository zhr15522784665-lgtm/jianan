// app.js —— 见岸小程序入口
//
// 本版本已恢复 AI 对话能力（云函数 chat，环境 your-cloud-env-id）。
// 心情等日常工具存本机；OCD 档案、日志、阶梯和自评在单独同意后经云函数保存。
// 对话经云函数转发至模型；本项目不把对话写入数据库，上游留存策略由部署者确认。
// storage 键一览（均以 jianan_ 开头，「关于」页按前缀扫描做导入导出）：
//   jianan_moods / jianan_pomodoro / jianan_meditation / jianan_notes
//   jianan_threegood / jianan_safety / jianan_wall / jianan_draft_*
//   jianan_pomodoro_prefs / jianan_pomodoro_run / jianan_launched

// 云开发环境 ID（与 cloudbaserc.json 的 envId 保持一致）
const CLOUD_ENV = 'your-cloud-env-id';

// 允许用 storage 覆盖环境，便于在测试/正式环境间切换
function initEnv() {
  try {
    const override = wx.getStorageSync('jianan_cloud_env_override');
    if (override) return override;
  } catch (e) {}
  return CLOUD_ENV || undefined;
}

App({
  globalData: {
    // 危机干预热线。
    // 号码均取自官方公开渠道：国家卫健委、省市卫健委、热线主办方官网。
    // primary: true 的会进入首页 SOS 面板（只放全国 24 小时号，危机时选项越少越好）。
    hotlines: [
      {
        name: '全国心理援助热线',
        tel: '12356',
        note: '24 小时 · 全国统一号码 · 国家卫健委设立',
        primary: true
      },
      {
        name: '希望 24 热线',
        tel: '400-161-9995',
        note: '24 小时 · 学生按 1 / 抑郁与自伤按 2 / 生命按 3',
        primary: true
      },
      {
        name: '青少年服务台',
        tel: '12355',
        note: '心理咨询与法律援助 · 各地服务时间以当地公告为准'
      },
      {
        name: '北京市心理援助热线',
        tel: '010-82951332',
        note: '24 小时 · 座机请拨 800-810-1117 · 北京心理危机研究与干预中心'
      },
      {
        name: '上海市心理热线',
        tel: '021-962525',
        note: '24 小时 · 上海市精神卫生中心'
      },
      {
        name: '天津市心理援助热线',
        tel: '022-88188858',
        note: '24 小时 · 天津市安定医院'
      },
      {
        name: '妇女维权公益热线',
        tel: '12338',
        note: '维权与心理支持 · 以工作日为主'
      }
    ],

    // 各省官方心理援助热线（「全部援助热线」页按省份展开）
    // 数据截至 2025-2026，来源国家卫健委及各地精神卫生中心；号码以当地最新公布为准。
    // 注意：一律不带分机（形如「区号-主号-分机」），带分机的号拨号盘识别不了。
    provHotlines: [
      { p: '北京', tel: '010-82951332', h24: true, org: '北京心理危机研究与干预中心' },
      { p: '天津', tel: '022-88188858', h24: true, org: '天津市安定医院' },
      { p: '河北', tel: '0312-96312', h24: true, org: '河北省精神卫生中心' },
      { p: '山西', tel: '0351-8726199', h24: true, org: '山西省精神卫生中心' },
      { p: '内蒙古', tel: '0471-12320', h24: true, org: '内蒙古自治区精神卫生中心' },
      { p: '辽宁', tel: '024-96687', h24: true, org: '辽宁省精神卫生中心' },
      { p: '吉林', tel: '0431-89685000', h24: true, org: '长春市第六医院' },
      { p: '黑龙江', tel: '0451-12320', h24: true, org: '黑龙江省危机干预热线' },
      { p: '上海', tel: '021-962525', h24: true, org: '上海市精神卫生中心' },
      { p: '江苏', tel: '025-83712977', h24: true, org: '南京脑科医院（江苏省精神卫生中心）' },
      { p: '浙江', tel: '0571-85029595', h24: true, org: '杭州市第七人民医院' },
      { p: '安徽', tel: '0551-63666903', h24: true, org: '合肥市第四人民医院' },
      { p: '福建', tel: '0591-85666661', h24: true, org: '福州神经精神病防治院' },
      { p: '江西', tel: '0791-966525', h24: true, org: '江西省社会心理服务热线' },
      {
        p: '山东',
        tel: '0531-86336666',
        h24: false,
        time: '17:30-21:00（工作日）',
        org: '山东省精神卫生中心'
      },
      { p: '河南', tel: '0373-7095888', h24: true, org: '河南省精神卫生中心' },
      { p: '湖北', tel: '027-85844666', h24: true, org: '武汉市精神卫生中心' },
      { p: '湖南', tel: '0731-85501010', h24: true, org: '长沙市第九医院' },
      { p: '广东', tel: '020-81899120', h24: true, org: '广州医科大学附属脑科医院' },
      { p: '广西', tel: '0772-3136120', h24: true, org: '广西壮族自治区脑科医院' },
      { p: '海南', tel: '0898-96363', h24: true, org: '海南省安宁医院' },
      { p: '重庆', tel: '023-96320', h24: true, org: '重庆市精神卫生中心' },
      { p: '四川', tel: '028-87577510', h24: true, org: '成都市第四人民医院' },
      {
        p: '贵州',
        tel: '0851-88417888',
        h24: false,
        time: '周一至周五 8:00-17:00',
        org: '贵州省第二人民医院'
      },
      { p: '云南', tel: '0871-12320', h24: true, org: '昆明心理危机研究与干预中心' },
      {
        p: '西藏',
        tel: '0891-12320',
        h24: false,
        time: '以当地最新公布为准',
        org: '西藏自治区卫健委'
      },
      { p: '陕西', tel: '400-896-0960', h24: false, time: '8:00-22:00', org: '西安市精神卫生中心' },
      { p: '甘肃', tel: '0931-12320', h24: false, time: '8:00-22:00', org: '兰州市精神卫生中心' },
      { p: '青海', tel: '0971-8140371', h24: true, org: '青海省第三人民医院' },
      { p: '宁夏', tel: '0951-2160707', h24: true, org: '宁夏心理援助热线' },
      { p: '新疆', tel: '0991-3016111', h24: true, org: '新疆心理援助热线' },
      { p: '香港', tel: '23820000', h24: true, org: '香港撒玛利亚防止自杀会' },
      { p: '澳门', tel: '853-28261126', h24: true, org: '澳门明爱生命热线' },
      { p: '台湾', tel: '1925', h24: true, org: '安心专线（中国台湾地区）' }
    ],

    // AI 对话人格（仅展示信息）。prompt 与护栏都在服务端 chat 云函数内，前端绝不持有。
    personas: [
      { id: 'jianan', name: '见岸', avatar: '🏝️', tag: '温柔陪伴 · 轻科普' },
      { id: 'anxin', name: '安心', avatar: '🩺', tag: '专业理性 · 心理科普' },
      { id: 'xiaonuan', name: '小暖', avatar: '🌤️', tag: '情感倾听 · 共病承接' }
    ],
    // 首页选人格后临时挂起，待对话页 onShow 消费（chat 是 tab 页，不能用 URL 参数）
    pendingPersona: null,
    cloudEnv: CLOUD_ENV,
    cloudReady: false
  },

  onLaunch() {
    this.globalData.cloudReady = false;
    if (!wx.cloud) {
      console.error('[app] wx.cloud 不可用：基础库需 2.2.3+，请更新微信');
      return;
    }
    try {
      const envUsed = initEnv();
      wx.cloud.init({ env: envUsed, traceUser: true });
      this.globalData.cloudEnv = envUsed;
      this.globalData.cloudReady = true;
      console.log('[app] 云开发已初始化，env =', envUsed || '(SDK 自动选择)');
    } catch (e) {
      console.error('[app] 云开发初始化失败：', e);
    }
  },

  // 号码规范化：只保留数字和前导 +，去掉 -、（空格等分隔符
  // 展示时保留连字符更好读，但个别安卓机型把 "400-161-9995" 原样传给拨号盘会失败
  formatTel(t) {
    return String(t || '').replace(/[^\d+]/g, '');
  },

  // 今日日期串 yyyy-mm-dd（本地时区）
  todayKey() {
    const d = new Date();
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },

  // 读取心情记录（本地存储，不出端）
  getMoods() {
    try {
      return wx.getStorageSync('jianan_moods') || [];
    } catch (e) {
      return [];
    }
  },

  // 是否已打卡今日
  moodToday() {
    const list = this.getMoods();
    return list.find((m) => m.date === this.todayKey()) || null;
  },

  // 今日番茄钟统计（本地存储，不出端）
  getPomodoro() {
    try {
      return wx.getStorageSync('jianan_pomodoro') || null;
    } catch (e) {
      return null;
    }
  },

  // 今日冥想次数（本地存储，不出端）
  getMeditation() {
    try {
      return wx.getStorageSync('jianan_meditation') || null;
    } catch (e) {
      return null;
    }
  },

  // 云环境连通性自检（对话页 / 关于页可用于提示环境异常）
  checkCloudEnv() {
    return new Promise((resolve) => {
      if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
        resolve({
          ok: false,
          code: 'NO_CLOUD',
          env: this.globalData.cloudEnv,
          msg: '当前微信版本不支持云能力，请更新微信到最新版'
        });
        return;
      }
      wx.cloud
        .callFunction({ name: 'ocd', data: { action: 'profile.get' } })
        .then((response) => {
          if (!response.result || response.result.ok !== true) {
            resolve({
              ok: false,
              code: (response.result && response.result.errorCode) || 'DATA_ERROR',
              env: this.globalData.cloudEnv,
              msg: '云端数据服务暂不可用，请检查部署和身份配置'
            });
            return;
          }
          resolve({ ok: true, env: this.globalData.cloudEnv, msg: '云环境可用' });
        })
        .catch((err) => {
          const em = (err && (err.errMsg || err.message)) || '';
          if (/-501000|environment not found/i.test(em)) {
            resolve({
              ok: false,
              code: 'ENV_NOT_FOUND',
              env: this.globalData.cloudEnv,
              msg:
                '云环境 ' +
                CLOUD_ENV +
                ' 在云端不存在。请到开发者工具「云开发」确认已开通，且环境 ID 与 app.js 一致。'
            });
          } else {
            resolve({
              ok: false,
              code: 'CLOUD_UNAVAILABLE',
              env: this.globalData.cloudEnv,
              msg: '云服务调用失败，请检查网络、云函数部署和权限'
            });
          }
        });
    });
  }
});
