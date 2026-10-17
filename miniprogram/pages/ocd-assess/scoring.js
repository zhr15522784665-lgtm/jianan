'use strict';

const CONFIG = {
  'brief-12': { count: 12, cuts: [15, 27, 39], max: 48 },
  'detail-18': { count: 18, cuts: [23, 41, 59], max: 72 }
};

/**
 * 校验原有自评答案并按对应版本计算分档。
 * @param {number[]} answers 每题为 0–4 的整数答案。
 * @param {string} version 自评版本 brief-12 或 detail-18。
 * @returns {object} 分数、分档与自评版本。
 */
function scoreAnswers(answers, version) {
  const config = CONFIG[version];
  if (!config || !Array.isArray(answers) || answers.length !== config.count) {
    throw new Error('答案数量与版本不匹配');
  }
  if (answers.some((value) => !Number.isInteger(value) || value < 0 || value > 4)) {
    throw new Error('每题请选择0到4分');
  }
  const score = answers.reduce((sum, value) => sum + value, 0);
  const bandIndex =
    score <= config.cuts[0] ? 0 : score <= config.cuts[1] ? 1 : score <= config.cuts[2] ? 2 : 3;
  return {
    score,
    maxScore: config.max,
    band: ['低', '中等', '偏高', '高'][bandIndex],
    bandIndex,
    scaleVersion: version
  };
}

/**
 * 按自评分档给出非诊断性的后续建议。
 * @param {object} result 已计算的自评分档结果。
 * @returns {string} 对应分档的后续建议。
 */
function nextStep(result) {
  return [
    '先了解 OCD 的机制与记录方法。',
    '连续记录两周触发、行为和耗时。',
    '建议预约精神科或心理科做专业评估。',
    '建议尽快预约精神科或心理科评估；如有危机请联系12356。'
  ][result.bandIndex];
}

module.exports = { CONFIG, scoreAnswers, nextStep };
