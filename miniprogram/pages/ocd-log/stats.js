'use strict';
/**
 * 在本地统计时间窗口内的日志，与服务端统计作为兼容兜底配合。
 * @param {Array<object>} items 待汇总的日志记录。
 * @param {number} days 统计窗口天数。
 * @param {number} now 窗口结束的毫秒时间戳。
 * @returns {object} 本地统计结果。
 */
function aggregate(items, days, now) {
  const list = Array.isArray(items) ? items : [];
  const end = now == null ? Date.now() : now;
  const since = end - (days || 7) * 86400000;
  const recent = list.filter((item) => {
    const time = new Date(item.created_at || item.createdAt || 0).getTime();
    return Number.isFinite(time) && time >= since && time <= end;
  });
  const triggers = {};
  recent.forEach((item) => {
    const key = item.trigger || '未填写';
    triggers[key] = (triggers[key] || 0) + 1;
  });
  const drop = recent.reduce(
    (sum, item) => sum + Number(item.sudsBefore || 0) - Number(item.sudsAfter || 0),
    0
  );
  const resisted = recent.filter((item) => item.resisted === true).length;
  return {
    days: days || 7,
    count: recent.length,
    averageSudsDrop: recent.length ? Math.round((drop / recent.length) * 10) / 10 : 0,
    resistanceRate: recent.length ? Math.round((resisted / recent.length) * 1000) / 1000 : 0,
    topTriggers: Object.keys(triggers)
      .sort((a, b) => triggers[b] - triggers[a] || a.localeCompare(b))
      .slice(0, 3)
      .map((trigger) => ({ trigger, count: triggers[trigger] }))
  };
}
module.exports = { aggregate };
