'use strict';
/**
 * 将主观痛苦评分规范到 0–100 整数；非数值使用模块约定默认值。
 * @param {*} value 待校验的外部输入。
 * @returns {number} 规范化的痛苦评分。
 */
function clampSuds(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}
/**
 * 按难度与创建时间返回阶梯副本，不改变输入数组。
 * @param {Array<object>} steps 待排序的阶梯记录。
 * @returns {Array<object>} 按难度稳定排序的副本。
 */
function sortSteps(steps) {
  return (Array.isArray(steps) ? steps : [])
    .slice()
    .sort(
      (a, b) =>
        Number(a.level) - Number(b.level) ||
        String(a.created_at || '').localeCompare(String(b.created_at || ''))
    );
}
/**
 * 提取指定阶梯的 SUDS 练习序列。
 * @param {Array<object>} logs 包含前后测与阶梯 ID 的日志记录。
 * @param {string} stepId 需要筛选或关联的阶梯 ID。
 * @returns {Array<object>} 含 before、after、at 的序列。
 */
function progressSeries(logs, stepId) {
  return (Array.isArray(logs) ? logs : [])
    .filter((item) => !stepId || item.stepId === stepId)
    .map((item) => ({
      before: clampSuds(item.sudsBefore),
      after: clampSuds(item.sudsAfter),
      at: item.created_at || ''
    }));
}
/**
 * 按阶梯和练习开始时间生成重试时可复用的练习标识。
 * @param {string} stepId 需要筛选或关联的阶梯 ID。
 * @param {number} startedAt 练习开始的毫秒时间戳，重试时应保持一致。
 * @returns {string} 当前练习的幂等标识。
 */
function practiceId(stepId, startedAt) {
  return String(stepId || 'step') + '-' + String(startedAt || Date.now());
}
module.exports = { clampSuds, sortSteps, progressSeries, practiceId };
