// cloudfunctions/chat/index.js
// 见岸 AI 对话云函数：服务端持有全部人格设定与安全护栏，DeepSeek 优先、AI Ping 兜底。
// 前端只传 personaId + messages，绝不包含任何系统提示词或 API Key。
//
// 模型（2026-09 更新）：
//   主链路 DeepSeek `deepseek-flash`（旧名 deepseek-chat 已下线，仅作兼容路由）
//   兜底   AI Ping 网关（GLM 系列）
//   人格差异体现在 temperature / maxTokens（注意：思考模式下 temperature 不生效）
//
// Key 来源：只从环境变量读，代码里不留任何兜底值。
//   · 云端：cloudbaserc.json 的 envVariables，或云开发控制台手工配置
//   · 本地：项目根目录 .env（已被 .gitignore 排除）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { loadEnv, maskKey } = require('./env-loader');
const {
  LEVELS,
  ROUTES,
  assessSafety,
  assessReassuranceLoop,
  buildFallbackSafety
} = require('./safety-router');
const {
  CRISIS_REPLY,
  SAFETY_CHECK_REPLY,
  OTHER_PERSON_CHECK_REPLY,
  OTHER_PERSON_DANGER_REPLY,
  SAFETY_CHECK_INSTRUCTION,
  OCD_SUPPORT_INSTRUCTION,
  OTHER_PERSON_INSTRUCTION,
  UNCERTAINTY_PAUSE_INSTRUCTION
} = require('./safety-copy');
// 情绪标签（emotion_label）：规则快通道 + 模型伴生结构化输出 + 安全层危机覆盖
const {
  classifyRule,
  normalizeModelEmotion,
  mentionsOtherEmotion,
  finalizeEmotion
} = require('./emotion');
const {
  buildStructuredSystem,
  parseProviderResponse,
  parseAssistantContent
} = require('./model-output');
const { buildContext, COMORBIDITY } = require('./ocd-knowledge');
const {
  classifySubtype,
  detectComorbidity,
  decidePriority,
  buildOCDPreamble
} = require('./ocd-router');
const { buildPersonaSystem } = require('./ocd-prompt');
// 本地调试时把 .env 灌进 process.env；云端已有平台变量，loadEnv 不会覆盖它们
const envFile = loadEnv(__dirname);

// 是否运行在腾讯云 SCF（微信云函数云端运行时）。用于让报错文案指向正确的配置位置：
// 云端没有「项目根目录 .env」，再让人去建 .env 就是误导——该去控制台配环境变量。
const IS_CLOUD = process.env.TENCENTCLOUD_RUNENV === 'SCF';

// Key 缺失时的分环境指引
const KEY_HINT_DEEPSEEK = IS_CLOUD
  ? '云端未配置 DeepSeek Key。两种方式任选：① 云开发控制台 → 云函数 → chat → 函数配置 → 环境变量，添加 DEEPSEEK_API_KEY；② 把 .env 放进 cloudfunctions/chat/ 目录后重新部署。'
  : 'DeepSeek API Key 未配置。请在项目根目录 .env 里设置 DEEPSEEK_API_KEY（可参考 .env.example），或在云开发控制台为 chat 函数配置同名环境变量';
const KEY_HINT_AIPING = IS_CLOUD
  ? '云端未启用兜底通道。如需启用：控制台给 chat 配置 AIPING_API_KEY 与 AIPING_BASE_URL，或写入 .env 后重新部署。'
  : '兜底通道未启用（AIPING_API_KEY 或 AIPING_BASE_URL 为空）';

// 统一加超时：上游模型偶发卡死会拖垮整次对话，主动 12s 断开比等云函数默认 20s 更稳。
// 用内置 https 模块（所有 Node 版本都可用），不依赖 Node18+ 才有的全局 fetch / AbortController，
// 这样无论云端运行时版本是多少，对话都不会因 fetch 未定义而整页报错。
const https = require('https');

// ============================================================
// 统一错误类型：带 code / httpStatus / 中文提示，便于前端定位与用户看得懂
// ============================================================
class LLMError extends Error {
  constructor(code, message, httpStatus) {
    super(message);
    this.name = 'LLMError';
    this.code = code; // 机器可读，方便前端/日志分类
    this.httpStatus = httpStatus || 0;
  }
}

// DeepSeek 官方错误码 → 中文可定位提示
// 参考：https://api-docs.deepseek.com/zh-cn/quick_start/error_codes
const DEEPSEEK_ERR_HINT = {
  400: '请求格式错误（可能是模型代号或参数不被支持）',
  401: 'API Key 无效或已被撤销，请到 platform.deepseek.com 重新生成',
  402: '账户余额不足，请前往 DeepSeek 平台充值',
  422: '请求参数不合法（请检查 model / temperature / max_tokens 取值）',
  429: '请求过于频繁或已达配额上限，请稍后重试',
  500: 'DeepSeek 服务器内部故障，请稍后重试',
  503: 'DeepSeek 服务器繁忙，请稍后重试'
};

/** 把任意上游异常归一成 LLMError，附带中文提示 */
function normalizeUpstreamError(provider, e, httpStatus, rawBody) {
  if (e && e.code === 'TIMEOUT') {
    return new LLMError('TIMEOUT', `${provider} 请求超时（12 秒无响应），可能是网络波动或上游繁忙`);
  }
  if (e && e.code === 'NETWORK') {
    return new LLMError(
      'NETWORK',
      `${provider} 网络连接失败：${e.message}。请检查网络或上游地址是否可达`
    );
  }
  if (httpStatus) {
    const hint = DEEPSEEK_ERR_HINT[httpStatus] || `上游返回 HTTP ${httpStatus}`;
    // 只截取响应体前 200 字，且响应体里可能含 key 回显，做一次粗过滤
    const detail = String(rawBody || '')
      .slice(0, 200)
      .replace(/sk-[A-Za-z0-9]{8,}/g, 'sk-****');
    return new LLMError(
      'HTTP_' + httpStatus,
      `${provider} 调用失败：${hint}。原始响应：${detail}`,
      httpStatus
    );
  }
  return new LLMError('UNKNOWN', `${provider} 调用异常：${(e && e.message) || e}`);
}

/**
 * 通过 HTTPS 发送 JSON，应用超时并归一化网络与上游错误。
 * @param {string} url 模型服务 HTTPS 地址。
 * @param {object} headers 请求头（可能包含认证信息，不应输出到日志）。
 * @param {object} bodyObj 请求 JSON 数据。
 * @param {number} [timeoutMs] 单次网络调用超时毫秒数。
 * @param {string} [providerName] 用于错误提示的服务商名称。
 * @returns {Promise<{status:number,text:string}>} 上游 HTTP 状态与响应正文；网络失败拒绝。
 */
function httpsPostJson(url, headers, bodyObj, timeoutMs = 12000, providerName = '上游') {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return reject(new LLMError('BAD_URL', `接口地址非法：${url}`));
    }
    const payload = JSON.stringify(bodyObj);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'POST',
        timeout: timeoutMs,
        headers: Object.assign(
          {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          },
          headers
        )
      },
      (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          buf += c;
        });
        res.on('end', () => resolve({ status: res.statusCode, text: buf }));
      }
    );
    req.on('timeout', () => {
      const err = new Error(`${providerName} 请求超时`);
      err.code = 'TIMEOUT';
      req.destroy(err);
    });
    req.on('error', (e) => {
      // 保留 timeout 标记，其余归为网络错误
      if (!e.code) e.code = 'NETWORK';
      reject(e);
    });
    req.write(payload);
    req.end();
  });
}

/**
 * 兼容旧调用方解析模型正文。
 * @param {string} jsonText 上游返回的原始 JSON 文本。
 * @returns {object} 正文 content 或诊断 err。
 */
function parseChoices(jsonText) {
  // 兼容旧调用点：解析逻辑已抽到 model-output.parseProviderResponse
  return parseProviderResponse(jsonText);
}

// ---------------- 人格设定（仅服务端，与桌面主进程 / web 版保持一致：去 AI 味、什么都能聊） ----------------
// 注意：llm.model 字段现在【只对 AI Ping 兜底通道生效】。
// DeepSeek 主链路的模型由全局 DEEPSEEK_MODEL 决定（deepseek-flash），人格差异只体现在
// temperature / maxTokens 上——因为 DeepSeek 那边所有人格共用同一个在售模型代号。
const DEFAULT_LLM = { model: 'GLM-4.7', temperature: 0.9, maxTokens: 800 };

const PERSONAS = [
  {
    id: 'jianan',
    name: '见岸',
    llm: { model: 'GLM-4.7', temperature: 0.9, maxTokens: 600 },
    prompt: `你叫见岸，是用户手机里一个说话温和的朋友。什么都能聊——今天吃了啥、工作烦不烦、心里堵不堵，都行。先听清楚对方在说什么再接话；对方低落时先让他感觉被听懂，别急着给建议。像真人微信聊天那样回，口语、简短、自然，可加一两个表情。别列条条框框、别写小作文、别说"作为一个AI"。只说给用户听的话。若对方流露出想伤害自己或不愿活，马上停下闲聊，认真说你担心他，把全国心理援助热线 12356（24 小时）告诉他，劝他打或找信任的人说。`
  },
  {
    id: 'anxin',
    name: '安心',
    llm: { model: 'GLM-4.7', temperature: 0.6, maxTokens: 800 },
    prompt: `你叫安心，是用户随叫随到的靠谱朋友，脑子清楚、说话有条理，拿任何问题来都能接：怎么选、怎么想通一件事、某个知识是什么，都行。先一句话给结论，再把关键几点说清，别绕、像跟朋友解释、不像写论文、控制篇幅。像真人聊天，别说"作为一个AI"。只说给用户听的话。若对方说不想活或有自伤念头，立刻停下去劝，给全国心理援助热线 12356（24 小时）。`
  },
  {
    id: 'xiaoxian',
    name: '小闲',
    llm: { model: 'GLM-4.7-Flash', temperature: 0.85, maxTokens: 500 },
    prompt: `你叫小闲，是用户手机里爱贫嘴的玩伴。天南地北都能扯：八卦、游戏、今天遇到的离谱事、脑洞，都接得住。语气松快、多用表情、时不时抛个新话题带气氛。像朋友瞎聊、别正经八百、别说"作为一个AI"。只说给用户听的话。若对方流露出不想活或想伤害自己，立刻收起玩闹认真关心，给全国心理援助热线 12356（24 小时）。`
  },
  {
    id: 'shiyu',
    name: '诗语',
    prompt: `你是一个热爱文学、历史、艺术的文艺青年，擅长用诗词、名著中的句子来回应情感。你的回答要有意境，能让人从艺术和人文角度理解自己的感受，但始终以共情和支持为前提，避免过于说教或掉书袋。如果用户表达自伤或自杀倾向，立即停止文艺风格，严肃表达关心，提供全国心理援助热线 12356，鼓励用户拨打或联系信任的人。`
  },
  {
    id: 'xiaonuan',
    name: '小暖',
    prompt: `你是一个温暖、真诚的朋辈倾听者，像朋友一样陪伴用户。你从不评判，总是先共情，说"我懂你的感受""这真的很难"。你可以适当分享自己类似的经历来安慰对方，但不要喧宾夺主。如果用户表达自伤或自杀倾向，立即表达关心，提供全国心理援助热线 12356，鼓励用户拨打或联系信任的人。`
  },
  {
    id: 'siyuan',
    name: '思远',
    prompt: `你是一个喜欢哲学思辨的陪伴者，熟悉存在主义、斯多葛学派、东方哲学等。你的回答要引导用户从更宏观的角度看待当前的痛苦、焦虑或强迫，探讨意义、自由、接纳等主题。语气深沉但不冷漠，始终传递关怀。如果用户表达自伤或自杀倾向，立即停止哲学讨论，严肃表达关心，提供全国心理援助热线 12356，鼓励用户拨打或联系信任的人。`
  }
];

const SPECIALIST_PERSONAS = {
  jianan:
    '你叫见岸，是专注强迫症自助的温和入口。理清强迫性怀疑、仪式循环与普通担心，承接情绪并引导到自评、阶梯或日志；不诊断、不给保证。像微信聊天一样口语、简短，整段不超过 200 字。',
  anxin:
    '你叫安心，是专注强迫症自助的专业教练。通俗解释反刍、求保证和 ERP，制定循序渐进的安全练习，独立回应共病并建议专业评估；不提供药物方案。先给结论再讲要点，整段不超过 200 字。',
  xiaonuan:
    '你叫小暖，是温暖的强迫症自助陪伴者。承接羞耻、自责与家庭不理解，允许共病情绪完整展开，不把一切归因于 OCD；不虚构亲身经历、不诊断、不提供保证。先共情再问需要，整段不超过 250 字。'
};
/**
 * 按人格 ID 与 OCD 开关选择服务端提示配置。
 * @param {string} id 人格或知识亚型标识。
 * @param {string} ocdModeValue OCD 开关档位。
 * @returns {object} 匹配的人格或默认人格。
 */
function findPersona(id, ocdModeValue) {
  if (ocdModeValue !== 'on') return PERSONAS.find((p) => p.id === id) || PERSONAS[0];
  const legacy = { xiaoxian: 'xiaonuan', shiyu: 'xiaonuan', siyuan: 'anxin' };
  const canonical = legacy[id] || id;
  const persona = PERSONAS.find((p) => p.id === canonical) || PERSONAS[0];
  return Object.assign({}, persona, {
    prompt: SPECIALIST_PERSONAS[persona.id] || SPECIALIST_PERSONAS.jianan
  });
}

// ---------------- 安全护栏（仅服务端） ----------------
const SAFETY_PREAMBLE = `【安全与边界·你必须遵守】
- 你不是医生，不做任何医学诊断、不开药、不替代精神科或心理治疗。
- 涉及具体治疗、用药、剂量时，主动降级为"建议咨询专业医生 / 精神科"，不要给出医疗建议。
- 当用户流露自伤、自杀或严重伤害自己的意图时，立即停止闲聊风格，真诚表达关心，优先给出专业援助渠道（见下方热线），并鼓励其联系身边信任的人或立即就医。
- 你只做陪伴、共情与轻科普，必要时把人引向专业帮助。
- 【输出格式】只输出说给用户听的话。严禁输出任何思考过程、内心独白、分析笔记、计划清单或阶段标注（例如 "Initial Thought"、"Plan"、"让我分析一下" 这类内容），不要加旁白与动作描写。`;

const CRISIS_PROTOCOL = `我真的很关心你。此刻如果你有伤害自己的念头，请先停下，拨打全国心理援助热线 12356（24 小时），或者告诉身边你信任的人。你不是一个人，也不丢人——愿意说出来，本身就是勇敢。`;

// 必须与 miniprogram/app.js 的 globalData.hotlines 保持一致
// 号码来源：国家卫健委、各省市卫健委、热线主办方官网公开信息
const HOTLINES = [
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
  { name: '青少年服务台', tel: '12355', note: '心理咨询与法律援助 · 各地服务时间以当地公告为准' },
  {
    name: '北京市心理援助热线',
    tel: '010-82951332',
    note: '24 小时 · 座机请拨 800-810-1117 · 北京心理危机研究与干预中心'
  },
  { name: '上海市心理热线', tel: '021-962525', note: '24 小时 · 上海市精神卫生中心' },
  { name: '天津市心理援助热线', tel: '022-88188858', note: '24 小时 · 天津市安定医院' },
  { name: '妇女维权公益热线', tel: '12338', note: '维权与心理支持 · 以工作日为主' }
];

// 各省官方热线（与 miniprogram/app.js 的 globalData.provHotlines 保持一致）
// 用途：用户提到具体省份时，AI 能直接报出当地号码，而不是只会说 12356。
// 注意：一律不带分机，带分机的号用户拨不出去。
const PROV_HOTLINES = [
  { p: '北京', tel: '010-82951332', org: '北京心理危机研究与干预中心' },
  { p: '天津', tel: '022-88188858', org: '天津市安定医院' },
  { p: '河北', tel: '0312-96312', org: '河北省精神卫生中心' },
  { p: '山西', tel: '0351-8726199', org: '山西省精神卫生中心' },
  { p: '内蒙古', tel: '0471-12320', org: '内蒙古自治区精神卫生中心' },
  { p: '辽宁', tel: '024-96687', org: '辽宁省精神卫生中心' },
  { p: '吉林', tel: '0431-89685000', org: '长春市第六医院' },
  { p: '黑龙江', tel: '0451-12320', org: '黑龙江省危机干预热线' },
  { p: '上海', tel: '021-962525', org: '上海市精神卫生中心' },
  { p: '江苏', tel: '025-83712977', org: '南京脑科医院' },
  { p: '浙江', tel: '0571-85029595', org: '杭州市第七人民医院' },
  { p: '安徽', tel: '0551-63666903', org: '合肥市第四人民医院' },
  { p: '福建', tel: '0591-85666661', org: '福州神经精神病防治院' },
  { p: '江西', tel: '0791-966525', org: '江西省社会心理服务热线' },
  { p: '山东', tel: '0531-86336666', org: '山东省精神卫生中心（17:30-21:00）' },
  { p: '河南', tel: '0373-7095888', org: '河南省精神卫生中心' },
  { p: '湖北', tel: '027-85844666', org: '武汉市精神卫生中心' },
  { p: '湖南', tel: '0731-85501010', org: '长沙市第九医院' },
  { p: '广东', tel: '020-81899120', org: '广州医科大学附属脑科医院' },
  { p: '广西', tel: '0772-3136120', org: '广西壮族自治区脑科医院' },
  { p: '海南', tel: '0898-96363', org: '海南省安宁医院' },
  { p: '重庆', tel: '023-96320', org: '重庆市精神卫生中心' },
  { p: '四川', tel: '028-87577510', org: '成都市第四人民医院' },
  { p: '贵州', tel: '0851-88417888', org: '贵州省第二人民医院（工作日 8:00-17:00）' },
  { p: '云南', tel: '0871-12320', org: '昆明心理危机研究与干预中心' },
  { p: '西藏', tel: '0891-12320', org: '西藏自治区卫健委' },
  { p: '陕西', tel: '400-896-0960', org: '西安市精神卫生中心（8:00-22:00）' },
  { p: '甘肃', tel: '0931-12320', org: '兰州市精神卫生中心（8:00-22:00）' },
  { p: '青海', tel: '0971-8140371', org: '青海省第三人民医院' },
  { p: '宁夏', tel: '0951-2160707', org: '宁夏心理援助热线' },
  { p: '新疆', tel: '0991-3016111', org: '新疆心理援助热线' },
  { p: '香港', tel: '23820000', org: '香港撒玛利亚防止自杀会' },
  { p: '澳门', tel: '853-28261126', org: '澳门明爱生命热线' },
  { p: '台湾', tel: '1925', org: '安心专线（中国台湾地区）' }
];

const CRISIS_KEYWORDS = [
  '自杀',
  '自伤',
  '不想活',
  '活不下去',
  '结束生命',
  '想死',
  '去死',
  '没有意义了',
  '活着没意思',
  '活着没意义',
  '伤害自己',
  '了结',
  '解脱',
  '轻生',
  '不想活了',
  '一了百了',
  '寻死',
  '自尽',
  '割腕',
  '吞药',
  '跳楼',
  'kill myself',
  'suicide',
  'end my life',
  'want to die',
  'kms'
];

/**
 * 执行既有旧版危机规则，供灰度比较与异常保守回退。
 * @param {string} [text] 当前用户文本。
 * @returns {boolean} 旧规则是否命中。
 */
function legacyDetectCrisis(text = '') {
  const t = String(text).toLowerCase();
  return CRISIS_KEYWORDS.some((k) => t.includes(k.toLowerCase()));
}

const VALID_SAFETY_MODES = new Set(['off', 'shadow', 'on']);

/**
 * 读取安全路由档位，非法值回退 shadow。
 * @returns {string} 生效的安全档位。
 */
function safetyMode() {
  const raw = String(process.env.SAFETY_ROUTER_V2_MODE || 'shadow').toLowerCase();
  if (VALID_SAFETY_MODES.has(raw)) return raw;
  console.warn('[safety] 非法 SAFETY_ROUTER_V2_MODE，回退 shadow');
  return 'shadow';
}

/**
 * 读取不确定性暂停开关，仅 0 关闭。
 * @returns {boolean} 暂停功能是否开启。
 */
function uncertaintyPauseEnabled() {
  return process.env.UNCERTAINTY_PAUSE_ENABLED !== '0';
}

// ── 情绪标签（emotion_label）模式 ──────────────────────────────
// off    ：不请求结构化输出，回包不含 emotion 字段（与旧合同逐字一致）
// shadow ：请求结构化输出并计算标签，回包含 emotion，前端不渲染（默认）
// on     ：全链路生效，前端渲染三态表情
const VALID_EMOTION_MODES = new Set(['off', 'shadow', 'on']);

/**
 * 读取情绪标签档位，非法值回退 shadow。
 * @returns {string} 生效的情绪档位。
 */
function emotionMode() {
  const raw = String(process.env.EMOTION_LABEL_MODE || 'shadow').toLowerCase();
  if (VALID_EMOTION_MODES.has(raw)) return raw;
  console.warn('[emotion] 非法 EMOTION_LABEL_MODE，回退 shadow');
  return 'shadow';
}

/**
 * 判断本轮是否请求伴生结构化情绪输出。
 * @param {string} mode 功能档位 off、shadow 或 on。
 * @returns {boolean} 是否请求结构化输出。
 */
function shouldUseStructuredEmotion(mode) {
  return mode === 'shadow' || mode === 'on';
}

// 把情绪字段统一挂到返回体上。off 模式原样返回，不增加任何字段。
/**
 * 按档位附加情绪字段并由安全层覆盖危机。
 * @param {object} payload 待附加情绪字段的响应对象。
 * @param {object} candidate 规则或模型产生的普通情绪候选。
 * @param {object} safety 规则层安全评估结果。
 * @param {string} mode 功能档位 off、shadow 或 on。
 * @returns {object} 按档位附加情绪的响应。
 */
function attachEmotion(payload, candidate, safety, mode) {
  if (mode === 'off') return payload;
  return Object.assign({}, payload, {
    emotion: finalizeEmotion(candidate, safety, mode)
  });
}

const VALID_OCD_MODES = new Set(['off', 'shadow', 'on']);
/**
 * 读取 OCD 路由档位，非法值回退 shadow。
 * @returns {string} 生效的 OCD 档位。
 */
function ocdMode() {
  const raw = String(process.env.OCD_ROUTER_MODE || 'shadow').toLowerCase();
  if (VALID_OCD_MODES.has(raw)) return raw;
  console.warn('[ocd] 非法 OCD_ROUTER_MODE，回退 shadow');
  return 'shadow';
}

/**
 * 按 OCD 档位附加公开路由字段。
 * @param {object} payload 待附加 OCD 摘要的响应对象。
 * @param {object} ocd 待返回前端的 OCD 路由摘要。
 * @param {string} mode 功能档位 off、shadow 或 on。
 * @returns {object} 按档位附加 OCD 摘要的响应。
 */
function attachOCD(payload, ocd, mode) {
  if (mode === 'off') return payload;
  return Object.assign({}, payload, { ocd: Object.assign({}, ocd, { mode }) });
}

/**
 * 提取可返回前端的亚型、优先级和共病摘要。
 * @param {object} subtype 亚型分类结果及来源。
 * @param {object} priority 优先级及双主轴标记。
 * @param {object} comorbidity 共病信号识别结果。
 * @returns {object} 面向前端的 OCD 摘要。
 */
function publicOCD(subtype, priority, comorbidity) {
  return {
    subtype: subtype.subtype,
    priority: priority.level,
    dual: priority.dual === true,
    comorbidity: {
      flags: comorbidity.flags,
      suggestProfessional: comorbidity.suggestProfessional === true
    }
  };
}

// 情绪脱敏日志：只记元数据，不记用户原文、OPENID 或模型完整回复。
/**
 * 记录不含原始对话的情绪结构化诊断字段。
 * @param {string} label 情绪标签。
 * @param {string} source 情绪候选的来源。
 * @param {string} mode 功能档位 off、shadow 或 on。
 * @param {string} provider 模型服务商名称，仅用于诊断。
 * @param {string} parseStatus 输出解析状态。
 * @returns {void} 只记录结构化诊断。
 */
function logEmotion(label, source, mode, provider, parseStatus) {
  if (mode === 'off') return;
  console.log('[emotion]', { label, source, mode, provider, parseStatus });
}

/**
 * 过滤角色并裁剪用户输入的模型消息历史。
 * @param {*} input 尚未规范化的客户端输入。
 * @returns {Array<object>} 角色与长度已规范化的消息。
 */
function normalizeMessages(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .slice(-20)
    .map((m) => ({
      role: m.role,
      content: String(m.content || '').slice(0, 2000)
    }));
}

/**
 * 规范客户端安全确认上下文，不信任任意附加字段。
 * @param {*} input 尚未规范化的客户端输入。
 * @returns {object} 规范化的安全确认上下文。
 */
function normalizeSafetyContext(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const answer = ['yes', 'unsure', 'no'].includes(raw.safetyAnswer) ? raw.safetyAnswer : null;
  const validRoutes = new Set(Object.values(ROUTES));
  return {
    pendingSafetyCheck: raw.pendingSafetyCheck === true,
    safetyAnswer: answer,
    previousSafetyRoute: validRoutes.has(raw.previousSafetyRoute) ? raw.previousSafetyRoute : null,
    ocdHint: typeof raw.ocdHint === 'string' && raw.ocdHint.length <= 40 ? raw.ocdHint : null
  };
}

/**
 * 提取最近的用户文本供规则层比较。
 * @param {Array<object>} messages 模型消息历史。
 * @param {number} [limit] 最多保留的用户消息条数。
 * @returns {string[]} 最近的用户文本。
 */
function getRecentUserTexts(messages, limit = 4) {
  return messages
    .filter((m) => m.role === 'user')
    .slice(-limit)
    .map((m) => m.content);
}

/**
 * 仅导出约定的安全响应字段。
 * @param {object} safety 规则层安全评估结果。
 * @param {string} mode 功能档位 off、shadow 或 on。
 * @returns {object} 面向前端的安全摘要。
 */
function publicSafety(safety, mode) {
  return {
    level: safety.level,
    route: safety.route,
    target: safety.target,
    confidence: safety.confidence,
    shouldShowCrisisCard: safety.shouldShowCrisisCard,
    shouldAskSafetyCheck: safety.shouldAskSafetyCheck,
    ruleVersion: safety.ruleVersion,
    fallbackUsed: safety.fallbackUsed === true,
    mode
  };
}

/**
 * 按规则层路由选择固定安全指令。
 * @param {string} route 规则安全路由名称。
 * @returns {string} 对应路由的固定指令。
 */
function instructionForRoute(route) {
  if (route === ROUTES.CLARIFY_SAFETY) return SAFETY_CHECK_INSTRUCTION;
  if (route === ROUTES.OCD_SUPPORT) return OCD_SUPPORT_INSTRUCTION;
  if (route === ROUTES.OTHER_PERSON_SUPPORT) return OTHER_PERSON_INSTRUCTION;
  return '';
}

// 把可用热线整理成给模型看的清单。
// 目的：用户说「我在成都」「我是山东的」时，AI 能直接给出当地号码，而不是只会复读 12356。
// 只在 system prompt 里加，不额外增加对话轮次，也不影响原有的危机分流逻辑。
/**
 * 构造供服务端提示使用的热线信息。
 * @returns {string} 热线提示文本。
 */
function buildHotlineContext() {
  const nation = HOTLINES.map((h) => `- ${h.name}：${h.tel}（${h.note}）`).join('\n');
  const prov = PROV_HOTLINES.map((p) => `${p.p} ${p.tel}`).join('；');
  return `【可用心理援助热线·请据此作答，不要编造号码】
全国通用（优先推荐）：
${nation}

各省官方热线（用户明确提到所在省份时，可一并给出对应号码）：
${prov}

使用原则：
- 平时不要主动罗列热线，只在对方情绪明显低落、流露轻生念头，或主动询问求助渠道时才给。
- 给的时候最多报 1-2 个最合适的（先给 12356），不要一次性甩出一整屏号码。
- 用户说了具体省份就带上当地那条；不确定省份就只给 12356。
- 号码必须与上面完全一致，不得改写、补全或编造。`;
}

// ---------------- 内容安全校验（微信强制要求） ----------------
// 在转发模型前校验用户输入、在返回前校验模型输出，规避违规内容导致审核不过 / 上线后被下架。
// 校验服务异常（如接口未开通 / 网络抖动）时不阻断对话，仅记录告警（fail-open），避免全站不可用。
/**
 * 调用微信文本安全检测；异常延续原有 fail-open 行为。
 * @param {string} text 当前用户文本。
 * @returns {Promise<boolean>} 是否允许继续；异常沿用原有 fail-open。
 */
async function contentSafe(text) {
  if (!text || !String(text).trim()) return { pass: true };
  try {
    const ctx = cloud.getWXContext();
    const res = await cloud.openapi.security.msgSecCheck({
      content: String(text).slice(0, 2000), // 2.0 接口单次上限，超长截断
      version: 2,
      scene: 2, // 评论/交流场景
      openid: (ctx && ctx.OPENID) || undefined
    });
    const suggestion = (res && res.result && res.result.suggestion) || 'pass';
    // pass=通过；review=疑似，放行并转人工复审；risky=违规，拦截
    return { pass: suggestion !== 'risky', suggestion };
  } catch (e) {
    console.warn(
      '[contentSafe] msgSecCheck 调用异常，按 fail-open 放行：',
      (e && (e.errMsg || e.message)) || e
    );
    return { pass: true, warn: true };
  }
}

// ---------------- 模型调用（主链路 + 可选兜底链路） ----------------
// 主链路：任意 OpenAI 兼容服务，通过 DEEPSEEK_BASE_URL 指定
//   默认 https://api.deepseek.com（带不带 /v1 都可以）
//   模型代号参考：deepseek-flash（快、省）/ deepseek-v4-pro（更强推理）
//   思考模式由 reasoning_effort 控制（none 关闭）；旧参数 extra_body.enable_thinking 已废弃
// 兜底链路：可选。配置 AIPING_BASE_URL 后启用，主链路失败时自动降级。
//   不配置则只走主链路，不会报错。
const DEEPSEEK_BASE = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(
  /\/+$/,
  ''
);
const DEEPSEEK_URL = DEEPSEEK_BASE + '/chat/completions';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
// 思考强度：none 关闭思维链。心理陪伴要的是接住情绪、不是推理链；
// 关闭后实测更快、更省 token，回复也更简短自然。留空则用服务端默认（通常 high）。
const DEEPSEEK_EFFORT = process.env.DEEPSEEK_REASONING_EFFORT || 'none';

// 兜底通道地址由环境变量提供；留空表示不启用兜底。
const AIPING_BASE = (process.env.AIPING_BASE_URL || '').replace(/\/+$/, '');
const AIPING_URL = AIPING_BASE ? AIPING_BASE + '/chat/completions' : '';
// 注意：不要在环境变量里常设 AIPING_MODEL——它会强制统一所有人格的模型，
// 把下面的人格差异化配置冲掉。仅作为临时排障开关使用。

// ── 结构化输出通道执行器（emotion_label 用） ───────────────────
// 每个模型通道最多一次「本通道纯文本重试」，把最坏情况限制为可预测的有限重试：
//   1. HTTP 400/422 且错误明确指向 response_format / json mode / structured output → 去结构化重试
//   2. content 为空（含 reasoning-only）→ 纯文本重试一次
//   3. 内容以 { 或代码围栏开头但解析失败（截断 JSON）→ 纯文本重试一次，不展示损坏 JSON
//   4. 正常纯文本 → 放行，emotion 交规则/默认通道，不重试
//   5. JSON 合法但 emotion 非法 → 保留 reply，丢弃 emotion，不重试
//   6. 本通道重试仍失败 → 抛错，由 callLLM 走 DeepSeek → AI Ping 降级
/**
 * 判断上游是否拒绝结构化输出协议。
 * @param {string} text 当前用户文本。
 * @returns {boolean} 是否为协议不兼容错误。
 */
function isStructuredUnsupportedError(text) {
  const t = String(text || '').toLowerCase();
  return (
    t.includes('response_format') ||
    t.includes('json_mode') ||
    t.includes('json mode') ||
    t.includes('json_object') ||
    t.includes('structured output')
  );
}

/**
 * 不带结构化参数重试同一通道并解析正文。
 * @param {object} options 函数参数对象，字段见解构声明。
 * @returns {Promise<object>} 纯文本重试的解析结果。
 */
async function plainRetry({ provider, url, headers, buildBody, timeoutMs }) {
  try {
    const resp = await httpsPostJson(url, headers, buildBody(false), timeoutMs, provider);
    if (resp.status !== 200) return null;
    const parsed = parseProviderResponse(resp.text);
    if (parsed.err) return null;
    const out = parseAssistantContent(parsed.content, false);
    if (out.parseStatus === 'empty' || out.parseStatus === 'malformed_json') return null;
    return {
      content: out.content,
      emotion: out.emotion,
      parseStatus: out.parseStatus,
      provider,
      retriedPlain: true
    };
  } catch (e) {
    return null;
  }
}

/**
 * 执行一次模型通道及既有有界重试。
 * @param {object} options 函数参数对象，字段见解构声明。
 * @returns {Promise<object>} 通道结果，含解析状态或错误。
 */
async function runChannel({ provider, url, headers, buildBody, timeoutMs, structured }) {
  let resp;
  try {
    resp = await httpsPostJson(url, headers, buildBody(structured), timeoutMs, provider);
  } catch (e) {
    throw normalizeUpstreamError(provider, e);
  }
  if (resp.status !== 200) {
    if (structured && isStructuredUnsupportedError(resp.text)) {
      const retry = await plainRetry({ provider, url, headers, buildBody, timeoutMs });
      if (retry) return retry;
    }
    throw normalizeUpstreamError(provider, null, resp.status, resp.text);
  }
  const parsed = parseProviderResponse(resp.text);
  if (parsed.err) {
    if (structured && (parsed.empty || parsed.reasoningOnly)) {
      const retry = await plainRetry({ provider, url, headers, buildBody, timeoutMs });
      if (retry) return retry;
    }
    throw new LLMError('BAD_RESPONSE', provider + ' ' + parsed.err, resp.status);
  }
  const out = parseAssistantContent(parsed.content, structured);
  if (structured && (out.parseStatus === 'malformed_json' || out.parseStatus === 'empty')) {
    const retry = await plainRetry({ provider, url, headers, buildBody, timeoutMs });
    if (retry) return retry;
    throw new LLMError('BAD_RESPONSE', provider + ' 结构化输出解析失败', resp.status);
  }
  return { content: out.content, emotion: out.emotion, parseStatus: out.parseStatus, provider };
}

/**
 * 调用可选备用兼容服务，未配置时抛出明确错误。
 * @param {string} system 服务端 system 提示。
 * @param {Array<object>} messages 模型消息历史。
 * @param {object} llm 人格对应的模型采样与输出预算配置。
 * @param {boolean} structured 是否请求同次结构化输出。
 * @returns {Promise<object>} 备用通道结果；未启用或失败时抛错。
 */
async function callAiping(system, messages, llm, structured) {
  const apiKey = process.env.AIPING_API_KEY;
  if (!apiKey || !AIPING_URL) {
    throw new LLMError('NO_KEY_AIPING', KEY_HINT_AIPING);
  }

  // 人格自带配置优先，缺省走 DEFAULT_LLM；环境变量 AIPING_MODEL 可强制统一覆盖（紧急切换用）
  const cfg = Object.assign({}, DEFAULT_LLM, llm || {});
  if (process.env.AIPING_MODEL) cfg.model = process.env.AIPING_MODEL;

  const buildBody = (useStructured) => {
    const sys = useStructured ? buildStructuredSystem(system) : system;
    const body = {
      model: cfg.model,
      messages: [{ role: 'system', content: sys }, ...messages],
      temperature: cfg.temperature,
      max_tokens: cfg.maxTokens,
      // 关掉深度思考：实测快 4 倍、省 6 成 token，且共情回复更简短自然。
      // 心理陪伴要的是接住情绪，不是推理链。
      // 注意：这是 AI Ping 第三方网关（跑 GLM-4.7），它沿用旧式的 extra_body 开关；
      // 主链路的 DeepSeek 已改用 reasoning_effort，两者协议不同，不要混用。
      extra_body: {
        enable_thinking: false,
        consume_type: 'api'
      }
    };
    if (useStructured) body.response_format = { type: 'json_object' };
    return body;
  };

  return runChannel({
    provider: 'AI Ping',
    url: AIPING_URL,
    headers: { Authorization: `Bearer ${apiKey}` },
    buildBody,
    // 兜底链路 15s：与主链路 25s 合计 40s，需小于云函数超时（建议 60s）
    timeoutMs: 15000,
    structured: structured === true
  });
}

// 主链路：DeepSeek
/**
 * 使用服务端环境密钥调用默认 DeepSeek 通道。
 * @param {string} system 服务端 system 提示。
 * @param {Array<object>} messages 模型消息历史。
 * @param {object} llm 人格对应的模型采样与输出预算配置。
 * @param {boolean} structured 是否请求同次结构化输出。
 * @returns {Promise<object>} 默认通道结果；配置缺失或失败时抛错。
 */
async function callDeepSeek(system, messages, llm, structured) {
  // 只从环境变量读，不留内置兜底值——避免 Key 随源码泄露。
  // 本地开发由 env-loader 从项目根 .env 灌入；云端由平台环境变量提供。
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new LLMError('NO_KEY_DEEPSEEK', KEY_HINT_DEEPSEEK);
  }

  const cfg = Object.assign({}, DEFAULT_LLM, llm || {});

  // 组装请求体。
  // · temperature 只在「非思考模式」下生效；思考模式下官方会忽略它，不报错也不起作用。
  //   我们默认 effort=none，所以 temperature 是有效的。
  // · reasoning_effort 显式传入，避免依赖服务端默认值（默认是 high，会拖慢响应）。
  const buildBody = (useStructured) => {
    const sys = useStructured ? buildStructuredSystem(system) : system;
    const body = {
      model: DEEPSEEK_MODEL,
      messages: [{ role: 'system', content: sys }, ...messages],
      max_tokens: cfg.maxTokens
    };
    if (useStructured) body.response_format = { type: 'json_object' };
    if (DEEPSEEK_EFFORT && DEEPSEEK_EFFORT !== 'none') {
      body.reasoning_effort = DEEPSEEK_EFFORT;
    } else {
      // 关闭思考链：显式 none，且不传 temperature 会丢失人格差异，所以 temperature 照传
      body.reasoning_effort = 'none';
    }
    body.temperature = cfg.temperature;
    return body;
  };

  return runChannel({
    provider: 'DeepSeek',
    url: DEEPSEEK_URL,
    headers: { Authorization: `Bearer ${apiKey}` },
    buildBody,
    // 主链路 25s：gpt-5.6-sol 长回复实测可超 12s，原 12000 会误报 TIMEOUT
    timeoutMs: 25000,
    structured: structured === true
  });
}

// 统一入口：DeepSeek 优先（国内直连、便宜），失败自动降级到 AI Ping。
// 日志只打脱敏后的 Key 与错误分类，绝不打完整 Key。
/**
 * 优先调用 DeepSeek，失败后尝试已配置的备用通道。
 * @param {string} system 服务端 system 提示。
 * @param {Array<object>} messages 模型消息历史。
 * @param {object} llm 人格对应的模型采样与输出预算配置。
 * @param {boolean} structured 是否请求同次结构化输出。
 * @returns {Promise<object>} 首个成功通道的解析结果，全部失败则抛错。
 */
async function callLLM(system, messages, llm, structured) {
  console.log('[callLLM] 主链路 DeepSeek', {
    model: DEEPSEEK_MODEL,
    effort: DEEPSEEK_EFFORT,
    环境文件: envFile || '(未找到，使用平台环境变量)',
    key: maskKey(process.env.DEEPSEEK_API_KEY)
  });
  try {
    return await callDeepSeek(system, messages, llm, structured);
  } catch (e) {
    const code = (e && e.code) || 'UNKNOWN';
    console.warn('[callLLM] DeepSeek 失败，降级 AI Ping', { code, msg: e && e.message });
    // Key 缺失属于配置错误，降级也救不了（AI Ping 一样可能没配），但先试一次更友好
    try {
      return await callAiping(system, messages, llm, structured);
    } catch (e2) {
      // 两条链路都挂了：把两条原因都带上，便于一次定位
      throw new LLMError(
        'ALL_CHANNELS_FAILED',
        `DeepSeek（${code}）与兜底通道均不可用。\nDeepSeek：${e && e.message}\nAI Ping：${(e2 && e2.message) || e2}`
      );
    }
  }
}

// ---------------- 入口 ----------------
// 同时支持两种调用方式：
//   1) 小程序云开发 SCF 触发：event = { personaId, messages }
//   2) 公网网站（CloudStudio 静态站）经 HTTP 触发调用：event = { httpMethod, body(字符串), headers }
//      body = { personaId, messages }。前端不持有任何 Key，Key 只留在云端。
/**
 * 包装对话服务的 HTTP 响应。
 * @param {number} statusCode HTTP 状态码。
 * @param {*} body 待编码的响应体。
 * @param {boolean} [isJson] 是否将响应体编码为 JSON。
 * @returns {object} 含 CORS 头的 HTTP 响应。
 */
function corsResp(statusCode, body, isJson = true) {
  return {
    statusCode,
    headers: {
      'Content-Type': isJson ? 'application/json' : 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    },
    body: isJson ? (typeof body === 'string' ? body : JSON.stringify(body)) : body
  };
}

exports.main = async (event) => {
  let personaId,
    messages,
    safetyContext,
    isHttp = false;
  if (event && (event.httpMethod || typeof event.body === 'string')) {
    isHttp = true;
    if (event.httpMethod === 'OPTIONS') return corsResp(204, '');
    // 仅允许本站点与本地调用，防止 Key 被任意第三方盗刷。
    // 注意：公网部署域名会随重新部署变化，这里做成「前缀白名单」而不是写死完整域名，
    // 否则换一次部署地址就被 403 拦掉（历史踩坑）。
    const referer = (event.headers && (event.headers.referer || event.headers.Referer)) || '';
    // 后缀白名单，不写死完整域名 —— 公网部署地址会随每次发布变化，
    // 写死就会出现「换一次域名就被 403 拦掉」（历史踩坑，已发生过两轮）：
    //   第一轮：写死 37be0bdd...app.workbuddy.link → 换域名后 403
    //   第二轮：只放行 .app.workbuddy.link → 新版域名 .app.workbuddy.host 又被 403
    // 所以这里把 workbuddy 的两种域名后缀都列上，以后换域名只需按需追加后缀。
    const allowedSuffix = [
      '.app.workbuddy.link', // 旧版公网域名后缀
      '.app.workbuddy.host', // 新版公网域名后缀
      '.workbuddy.host',
      'localhost',
      '127.0.0.1'
    ];
    if (!allowedSuffix.some((d) => referer.includes(d)))
      return corsResp(403, { ok: false, error: 'forbidden' });
    let parsed;
    try {
      parsed = JSON.parse(event.body || '{}');
    } catch (e) {
      return corsResp(400, { ok: false, error: 'bad json' });
    }
    personaId = parsed.personaId;
    messages = parsed.messages;
    safetyContext = parsed.safetyContext;
  } else {
    ({ personaId, messages, safetyContext } = event || {});
  }

  messages = normalizeMessages(messages);
  safetyContext = normalizeSafetyContext(safetyContext);
  const oMode = ocdMode();
  const persona = findPersona(personaId, oMode);
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const lastUserContent = lastUser ? lastUser.content : '';
  const mode = safetyMode();
  const oldCrisis = legacyDetectCrisis(lastUserContent);
  let routerFailed = false;
  let v2Safety;

  try {
    v2Safety = assessSafety(lastUserContent, safetyContext);
  } catch (e) {
    routerFailed = true;
    v2Safety = buildFallbackSafety(oldCrisis);
    console.error('[safety] 路由异常，已保守回退旧规则', {
      name: e && e.name,
      mode
    });
  }

  let effectiveSafety;
  if (mode === 'on' || routerFailed) {
    effectiveSafety = v2Safety;
  } else {
    effectiveSafety = buildFallbackSafety(oldCrisis);
    effectiveSafety.fallbackUsed = false;
  }

  const recentUserTexts = getRecentUserTexts(messages, 4);
  const ocdUserTexts = getRecentUserTexts(messages, 6);
  let reassurance = { likely: false, repeatScore: 0, reasonCodes: [] };
  try {
    reassurance = assessReassuranceLoop(lastUserContent, recentUserTexts.slice(0, -1));
  } catch (e) {
    console.warn('[safety] 寻求保证判断异常，已跳过', { name: e && e.name });
  }

  const interventionAllowed =
    mode === 'on' &&
    uncertaintyPauseEnabled() &&
    reassurance.likely &&
    !effectiveSafety.shouldAskSafetyCheck &&
    (effectiveSafety.level === LEVELS.NONE || effectiveSafety.level === LEVELS.OCD_INTRUSIVE) &&
    effectiveSafety.target !== 'other' &&
    effectiveSafety.target !== 'topic';

  console.log('[safety_router]', {
    ruleVersion: v2Safety.ruleVersion,
    mode,
    oldCrisis,
    level: v2Safety.level,
    route: v2Safety.route,
    target: v2Safety.target,
    disagreement: oldCrisis !== v2Safety.shouldShowCrisisCard,
    fallbackUsed: v2Safety.fallbackUsed === true,
    reasonCodes: v2Safety.reasonCodes,
    textLength: lastUserContent.length
  });

  const ocdSubtype = classifySubtype(lastUserContent, ocdUserTexts.slice(0, -1));
  const comorbidity = detectComorbidity(lastUserContent, ocdUserTexts.slice(0, -1));
  const ocdPriority = decidePriority({
    safety: effectiveSafety,
    subtype: ocdSubtype.subtype,
    flags: comorbidity.flags,
    text: lastUserContent
  });
  const ocdPayload = publicOCD(ocdSubtype, ocdPriority, comorbidity);
  let system = persona.prompt + '\n\n' + SAFETY_PREAMBLE + '\n\n' + buildHotlineContext();
  if (oMode === 'on') {
    system =
      buildPersonaSystem(persona, {
        subtype: ocdSubtype.subtype,
        priority: ocdPriority.level,
        flags: comorbidity.flags,
        knowledge: buildContext(ocdSubtype.subtype, ocdPriority.level),
        comorbidityNotes: comorbidity.flags
          .map((id) => {
            const item = COMORBIDITY.find((c) => c.id === id);
            return item
              ? `- ${item.name}：${item.relationToOCD}可建议：${item.support.join('；')}`
              : '';
          })
          .filter(Boolean)
          .join('\n'),
        hotlines: buildHotlineContext(),
        route: buildOCDPreamble({
          subtype: ocdSubtype.subtype,
          priority: ocdPriority.level,
          flags: comorbidity.flags
        })
      }) +
      '\n\n' +
      SAFETY_PREAMBLE;
  }
  if (mode === 'on') {
    const routeInstruction = instructionForRoute(effectiveSafety.route);
    if (routeInstruction) system += '\n\n' + routeInstruction;
    if (interventionAllowed) system += '\n\n' + UNCERTAINTY_PAUSE_INSTRUCTION;
  }

  // —— 输入内容安全校验（微信强制要求）：违规直接拦截，不转发模型 ——
  // HTTP 触发下无微信 openid，msgSecCheck 会异常，contentSafe 已 fail-open 放行。
  const inputCheck = await contentSafe(lastUserContent);

  const safetyPayload = publicSafety(effectiveSafety, mode);
  const intervention = interventionAllowed
    ? { type: 'uncertainty_pause', durationSeconds: 120 }
    : null;

  // ── 情绪标签候选初始化（emotion_label） ─────────────────────
  // 三级瀑布：规则快通道 → 模型伴生（正常链路拿到 llmOut 后覆盖）→ 默认 calm。
  // 规则优先于模型；crisis 只由安全层在 attachEmotion 内覆盖产生。
  const eMode = emotionMode();
  const ruleLabel =
    eMode === 'off' ? null : classifyRule(lastUserContent, { safety: effectiveSafety });
  let emotionCandidate = ruleLabel
    ? { label: ruleLabel, source: 'rule' }
    : { label: 'calm', source: 'default' };
  let lastProvider = null;
  let lastParseStatus = null;

  if (mode === 'on' && effectiveSafety.level === LEVELS.CRISIS) {
    const crisis = attachOCD(
      attachEmotion(
        {
          ok: true,
          reply: CRISIS_REPLY,
          isCrisis: true,
          persona: persona.name,
          crisisProtocol: CRISIS_PROTOCOL,
          hotlines: HOTLINES,
          safety: safetyPayload,
          intervention: null,
          blockedBySafe: !inputCheck.pass
        },
        emotionCandidate,
        effectiveSafety,
        eMode
      ),
      ocdPayload,
      oMode
    );
    logEmotion(
      crisis.emotion && crisis.emotion.label,
      crisis.emotion && crisis.emotion.source,
      eMode,
      null,
      null
    );
    return isHttp ? corsResp(200, crisis) : crisis;
  }

  // 用户已经通过结构化按钮确认“他人正处于即时危险”时，必须给出确定、
  // 可立即执行的求助步骤，不能把关键安全建议继续依赖模型 Key、网络或模型发挥。
  // 这里仍保持 isCrisis=false：风险对象是他人，不能误把用户本人标成危机。
  if (
    mode === 'on' &&
    safetyContext.safetyAnswer === 'yes' &&
    effectiveSafety.route === ROUTES.OTHER_PERSON_SUPPORT &&
    effectiveSafety.target === 'other' &&
    !effectiveSafety.shouldAskSafetyCheck
  ) {
    const otherPersonDanger = attachOCD(
      attachEmotion(
        {
          ok: true,
          reply: OTHER_PERSON_DANGER_REPLY,
          isCrisis: false,
          persona: persona.name,
          crisisProtocol: '',
          hotlines: HOTLINES,
          safety: safetyPayload,
          intervention: null,
          blockedBySafe: !inputCheck.pass
        },
        emotionCandidate,
        effectiveSafety,
        eMode
      ),
      ocdPayload,
      oMode
    );
    return isHttp ? corsResp(200, otherPersonDanger) : otherPersonDanger;
  }

  if (!inputCheck.pass) {
    const keepCrisis = effectiveSafety.shouldShowCrisisCard === true;
    const needsCheck = mode === 'on' && effectiveSafety.shouldAskSafetyCheck;
    const blockedReply = keepCrisis
      ? CRISIS_REPLY
      : needsCheck
        ? effectiveSafety.target === 'other'
          ? OTHER_PERSON_CHECK_REPLY
          : SAFETY_CHECK_REPLY
        : '（内容安全提醒）你发送的内容中包含平台暂不支持展示的内容，我们换个方式继续聊。如果你正经历情绪上的困境，可以拨打全国心理援助热线 12356（24 小时）。';
    const blocked = attachOCD(
      attachEmotion(
        {
          ok: true,
          reply: blockedReply,
          isCrisis: keepCrisis,
          persona: persona.name,
          crisisProtocol: keepCrisis ? CRISIS_PROTOCOL : '',
          hotlines: HOTLINES,
          blockedBySafe: true,
          safety: safetyPayload,
          intervention: null
        },
        emotionCandidate,
        effectiveSafety,
        eMode
      ),
      ocdPayload,
      oMode
    );
    return isHttp ? corsResp(200, blocked) : blocked;
  }

  if (mode === 'on' && effectiveSafety.shouldAskSafetyCheck) {
    const safetyCheck = attachOCD(
      attachEmotion(
        {
          ok: true,
          reply: effectiveSafety.target === 'other' ? OTHER_PERSON_CHECK_REPLY : SAFETY_CHECK_REPLY,
          isCrisis: false,
          persona: persona.name,
          crisisProtocol: '',
          hotlines: HOTLINES,
          safety: safetyPayload,
          intervention: null
        },
        emotionCandidate,
        effectiveSafety,
        eMode
      ),
      ocdPayload,
      oMode
    );
    return isHttp ? corsResp(200, safetyCheck) : safetyCheck;
  }

  try {
    const structured = shouldUseStructuredEmotion(eMode);
    const llmOut = await callLLM(system, messages, persona.llm, structured);
    lastProvider = llmOut.provider;
    lastParseStatus = llmOut.parseStatus;
    let reply = llmOut.content;
    // 情绪候选：规则优先；规则未命中且模型标签合法时才覆盖为 model 来源。
    // 安全网（只反映用户本人情绪）：
    //   ① 安全层判定风险对象是他人（target=other）→ 丢弃模型标签；
    //   ② 文本在描述他人情绪（「朋友很难过」）且规则未命中本人情绪 → 丢弃模型标签。
    // 规则通道有第一人称锚定，谈论他人时天然不命中，因此回落为 calm/default。
    const otherEmotion = mentionsOtherEmotion(lastUserContent);
    const modelEmotionUsable =
      llmOut.emotion &&
      effectiveSafety.target !== 'other' &&
      !(otherEmotion && emotionCandidate.source !== 'rule');
    if (emotionCandidate.source !== 'rule' && modelEmotionUsable) {
      emotionCandidate = { label: llmOut.emotion, source: 'model' };
    }
    logEmotion(
      emotionCandidate.label,
      emotionCandidate.source,
      eMode,
      lastProvider,
      lastParseStatus
    );
    // —— 输出内容安全校验：模型回复违规则替换为安全兜底，不展示原回复 ——
    const outCheck = await contentSafe(reply);
    if (!outCheck.pass) {
      reply =
        '（内容安全提醒）为遵守平台规范，这条回复暂不展示。如果你需要倾诉或遇到困难，欢迎拨打全国心理援助热线 12356，或换个方式继续聊。';
    }
    const result = attachOCD(
      attachEmotion(
        {
          ok: true,
          reply,
          isCrisis: effectiveSafety.shouldShowCrisisCard === true,
          persona: persona.name,
          crisisProtocol: effectiveSafety.shouldShowCrisisCard ? CRISIS_PROTOCOL : '',
          hotlines: HOTLINES,
          safety: safetyPayload,
          intervention
        },
        emotionCandidate,
        effectiveSafety,
        eMode
      ),
      ocdPayload,
      oMode
    );
    return isHttp ? corsResp(200, result) : result;
  } catch (e) {
    // 把错误分类与提示原样返回给前端：前端据此给出可定位的中文提示，
    // 而不是笼统的「网络异常」——那会让人误以为是手机网络问题，白排查半天。
    const errCode = (e && e.code) || 'UNKNOWN';
    const errMsg = String((e && e.message) || e);
    console.error('[chat] 模型调用失败', {
      code: errCode,
      msg: errMsg,
      key: maskKey(process.env.DEEPSEEK_API_KEY)
    });
    // 模型调用失败回包同样携带情绪：前端不会沿用上一轮表情（审核修订第 3 条）。
    const err = attachOCD(
      attachEmotion(
        {
          ok: false,
          error: errMsg,
          errorCode: errCode, // 机器可读分类：NO_KEY_DEEPSEEK / TIMEOUT / HTTP_401 ...
          errorHint: friendlyHint(errCode), // 给用户看的一句话
          persona: persona.name,
          isCrisis: effectiveSafety.shouldShowCrisisCard === true,
          crisisProtocol: effectiveSafety.shouldShowCrisisCard ? CRISIS_PROTOCOL : '',
          hotlines: HOTLINES,
          safety: safetyPayload,
          intervention: null
        },
        emotionCandidate,
        effectiveSafety,
        eMode
      ),
      ocdPayload,
      oMode
    );
    return isHttp ? corsResp(200, err) : err;
  }
};

/** 错误分类 → 面向用户的一句话提示（不暴露技术细节，但足够定位） */
function friendlyHint(code) {
  const map = {
    NO_KEY_DEEPSEEK: '服务端还没配置 AI 密钥，请联系管理员',
    NO_KEY_AIPING: '备用通道未配置，请联系管理员',
    TIMEOUT: 'AI 响应超时了，稍等一下再试',
    NETWORK: '服务端连不上 AI 服务，请稍后再试',
    BAD_URL: 'AI 服务地址配置有误，请联系管理员',
    BAD_RESPONSE: 'AI 返回了异常内容，换个说法再试试',
    HTTP_400: '请求参数有问题（可能是模型代号过期），请联系管理员',
    HTTP_401: 'AI 密钥无效或已过期，请联系管理员更换',
    HTTP_402: 'AI 账户余额不足，请联系管理员充值',
    HTTP_429: '问得太快啦，缓一分钟再聊',
    HTTP_500: 'AI 服务商临时故障，稍后再试',
    HTTP_503: 'AI 服务商繁忙，稍后再试',
    ALL_CHANNELS_FAILED: '所有 AI 通道都暂时不可用，请稍后再试'
  };
  return map[code] || '暂时没能连上 AI，稍后再试';
}
