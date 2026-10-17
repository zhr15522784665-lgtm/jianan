'use strict';
const SUBTYPES = [
  'contamination',
  'harm',
  'sexual',
  'religious',
  'relationship',
  'symmetry',
  'somatic',
  'magical',
  'hoarding',
  'mixed'
];
/**
 * 抛出带 VALIDATION_ERROR 代码的参数校验异常。
 * @param {string} message 参数校验失败时显示的错误提示。
 * @returns {never} 始终抛出 VALIDATION_ERROR。
 */
function invalid(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  throw error;
}
/**
 * 校验并修剪单个文本字段，限制为 2000 字。
 * @param {*} value 待校验的外部输入。
 * @param {string} field 校验错误中显示的字段名。
 * @param {boolean} [required] 是否要求非空文本。
 * @returns {string} 校验并修剪后的文本。
 */
function text(value, field, required = false) {
  if (value == null) value = '';
  if (typeof value !== 'string' || value.length > 2000) invalid(`${field}须为不超过2000字的文本`);
  const clean = value.trim();
  if (required && !clean) invalid(`${field}不能为空`);
  return clean;
}
/**
 * 校验有限数值、上下界和可选整数要求。
 * @param {*} value 待校验的外部输入。
 * @param {string} field 校验错误中显示的字段名。
 * @param {number} min 允许的最小值（含）。
 * @param {number} max 允许的最大值（含）。
 * @param {number} fallback 参数缺失时采用的默认数值。
 * @param {boolean} [integer] 是否仅接受整数。
 * @returns {number} 校验后的数值或默认值。
 */
function number(value, field, min, max, fallback, integer = false) {
  if (value == null) {
    if (fallback !== undefined) return fallback;
    invalid(`${field}不能为空`);
  }
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    invalid(`${field}须在${min}到${max}之间${integer ? '且为整数' : ''}`);
  return value;
}
/**
 * 校验文本数组及其合计长度。
 * @param {*} value 待校验的外部输入。
 * @param {string} field 校验错误中显示的字段名。
 * @returns {string[]} 规范化文本数组。
 */
function texts(value, field) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 30) invalid(`${field}格式不正确`);
  const clean = value.map((item) => text(item, field, true));
  if (clean.join('').length > 2000) invalid(`${field}合计不能超过2000字`);
  return clean;
}
/**
 * 要求独立的敏感健康信息云端保存同意，否则抛错。
 * @param {object} payload 接口参数；写入操作需显式包含 sensitiveConsent。
 * @returns {void} 同意有效时正常结束，否则抛出校验错误。
 */
function consent(payload) {
  if (payload.sensitiveConsent !== true) invalid('请单独同意敏感健康信息的云端保存后再继续');
}
/**
 * 校验档案并返回规范化记录。
 * @param {object} payload 接口参数；写入操作需显式包含 sensitiveConsent。
 * @returns {object} 规范化档案。
 */
function profile(payload) {
  consent(payload);
  const subtypes = texts(payload.subtypes, 'subtypes');
  if (subtypes.some((id) => !SUBTYPES.includes(id))) invalid('subtypes包含无效亚型');
  return {
    subtypes,
    primaryObsession: text(payload.primaryObsession, 'primaryObsession'),
    compulsions: texts(payload.compulsions, 'compulsions'),
    avoidance: texts(payload.avoidance, 'avoidance'),
    onsetBand: text(payload.onsetBand, 'onsetBand'),
    sensitiveConsent: true
  };
}
/**
 * 校验症状或暴露日志并返回可存储字段。
 * @param {object} payload 接口参数；写入操作需显式包含 sensitiveConsent。
 * @returns {object} 规范化日志。
 */
function log(payload) {
  consent(payload);
  if (!['obsession', 'compulsion', 'urge', 'exposure'].includes(payload.type)) invalid('type无效');
  if (typeof payload.resisted !== 'boolean') invalid('resisted须为布尔值');
  return {
    type: payload.type,
    trigger: text(payload.trigger, 'trigger'),
    thought: text(payload.thought, 'thought'),
    behavior: text(payload.behavior, 'behavior'),
    note: text(payload.note, 'note'),
    resisted: payload.resisted,
    durationMin: number(payload.durationMin, 'durationMin', 0, 1440, 0),
    sudsBefore: number(payload.sudsBefore, 'sudsBefore', 0, 100),
    sudsAfter: number(payload.sudsAfter, 'sudsAfter', 0, 100),
    stepId: text(payload.stepId, 'stepId'),
    practiceId: text(payload.practiceId, 'practiceId'),
    sensitiveConsent: true
  };
}
/**
 * 校验恐惧阶梯并初始化进度字段。
 * @param {object} payload 接口参数；写入操作需显式包含 sensitiveConsent。
 * @returns {object} 规范化的新阶梯。
 */
function step(payload) {
  consent(payload);
  return {
    title: text(payload.title, 'title', true),
    description: text(payload.description, 'description'),
    level: number(payload.level, 'level', 0, 100),
    sudsTarget: number(payload.sudsTarget, 'sudsTarget', 0, 100),
    status: 'not_started',
    attempts: 0,
    lastSuds: null,
    sensitiveConsent: true
  };
}
/**
 * 按原有 12/18 题计分规则返回分档，非法答案抛错。
 * @param {number[]} answers 每题为 0–4 的整数答案。
 * @param {string} scaleVersion 自评版本 brief-12 或 detail-18。
 * @returns {object} 总分、最高分、分档与量表版本。
 */
function score(answers, scaleVersion) {
  const count = scaleVersion === 'brief-12' ? 12 : scaleVersion === 'detail-18' ? 18 : 0;
  if (!count || !Array.isArray(answers) || answers.length !== count)
    invalid('自评版本与答案数量不一致');
  answers.forEach((value) => number(value, 'answer', 0, 4, undefined, true));
  const total = answers.reduce((sum, value) => sum + value, 0);
  const cuts = count === 12 ? [15, 27, 39] : [23, 41, 59];
  const bandIndex = total <= cuts[0] ? 0 : total <= cuts[1] ? 1 : total <= cuts[2] ? 2 : 3;
  return {
    score: total,
    maxScore: count * 4,
    band: ['低', '中等', '偏高', '高'][bandIndex],
    bandIndex,
    scaleVersion
  };
}
/**
 * 校验自评同意和答案并组合计分结果。
 * @param {object} payload 接口参数；写入操作需显式包含 sensitiveConsent。
 * @returns {object} 分数、答案及同意字段。
 */
function assess(payload) {
  consent(payload);
  if (payload.disclaimerAccepted !== true) invalid('请确认这不是诊断');
  const result = score(payload.answers, payload.scaleVersion || 'brief-12');
  return Object.assign(result, {
    answers: payload.answers.slice(),
    disclaimerAccepted: true,
    sensitiveConsent: true
  });
}
/**
 * 汇总指定时间窗口的日志数、SUDS 下降与抵抗率。
 * @param {Array<object>} items 待汇总的日志记录。
 * @param {number} [days] 统计窗口天数。
 * @param {number} [now] 窗口结束的毫秒时间戳。
 * @returns {object} 记录数、平均下降、抵抗率与高频触发。
 */
function stats(items, days = 7, now = Date.now()) {
  const since = now - days * 86400000;
  const records = items.filter((item) => {
    const time = new Date(item.created_at).getTime();
    return Number.isFinite(time) && time >= since && time <= now;
  });
  const triggers = {};
  records.forEach((item) => {
    const key = item.trigger || '未填写';
    triggers[key] = (triggers[key] || 0) + 1;
  });
  const sum = records.reduce((value, item) => value + item.sudsBefore - item.sudsAfter, 0);
  return {
    days,
    count: records.length,
    averageSudsDrop: records.length ? Math.round((sum / records.length) * 10) / 10 : 0,
    resistanceRate: records.length
      ? Math.round(
          (records.filter((item) => item.resisted === true).length / records.length) * 1000
        ) / 1000
      : 0,
    topTriggers: Object.keys(triggers)
      .sort((a, b) => triggers[b] - triggers[a] || a.localeCompare(b))
      .slice(0, 3)
      .map((trigger) => ({ trigger, count: triggers[trigger] }))
  };
}
module.exports = {
  SUBTYPES,
  invalid,
  text,
  number,
  consent,
  profile,
  log,
  step,
  score,
  assess,
  stats
};
