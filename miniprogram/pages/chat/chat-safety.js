'use strict';

const DEFAULT_SAFETY = Object.freeze({
  level: 'none',
  route: 'GENERAL',
  target: 'self',
  confidence: 'low',
  shouldShowCrisisCard: false,
  shouldAskSafetyCheck: false,
  ruleVersion: 'legacy',
  fallbackUsed: false,
  mode: 'off'
});

/**
 * 兼容新旧回包的安全字段，保留危机覆盖。
 * @param {object} response 云函数 result 回包。
 * @returns {object} 兼容旧版回包的完整安全字段。
 */
function normalizeSafetyResponse(response) {
  const raw = response && typeof response === 'object' ? response : {};
  const safety =
    raw.safety && typeof raw.safety === 'object'
      ? raw.safety
      : {
          level: raw.isCrisis ? 'crisis' : 'none',
          route: raw.isCrisis ? 'CRISIS_RESPONSE' : 'GENERAL',
          target: 'self',
          confidence: 'low',
          shouldShowCrisisCard: !!raw.isCrisis,
          shouldAskSafetyCheck: false,
          ruleVersion: 'legacy',
          fallbackUsed: false,
          mode: 'off'
        };

  return Object.assign({}, DEFAULT_SAFETY, safety, {
    shouldShowCrisisCard: safety.shouldShowCrisisCard === true || raw.isCrisis === true,
    shouldAskSafetyCheck: safety.shouldAskSafetyCheck === true
  });
}

/**
 * 依据安全状态和关闭标记判断是否显示不确定性暂停。
 * @param {object} response 云函数 result 回包。
 * @param {object} currentState 当前页面 data 状态。
 * @returns {boolean} 是否可以展示暂停练习。
 */
function shouldShowUncertaintyPause(response, currentState) {
  const raw = response && typeof response === 'object' ? response : {};
  const safety = normalizeSafetyResponse(raw);
  const intervention = raw.intervention;
  if (!intervention || intervention.type !== 'uncertainty_pause') return false;
  if (currentState && currentState.uncertaintyPauseDismissed) return false;
  if (safety.level === 'crisis' || safety.level === 'safety_check') return false;
  if (safety.shouldAskSafetyCheck || safety.target === 'other') return false;
  return true;
}

/**
 * 生成安全界面状态补丁，保留危机粘性与追问优先级。
 * @param {object} currentState 当前页面 data 状态。
 * @param {object} response 云函数 result 回包。
 * @returns {object} 可传给 setData 的安全状态补丁。
 */
function buildSafetyStatePatch(currentState, response) {
  const current = currentState || {};
  const safety = normalizeSafetyResponse(response);
  const crisis = current.isCrisis === true || safety.shouldShowCrisisCard;
  const needsCheck = !crisis && safety.shouldAskSafetyCheck;
  const showPause = !crisis && !needsCheck && shouldShowUncertaintyPause(response, current);

  return {
    isCrisis: crisis,
    safetyLevel: safety.level,
    safetyRoute: safety.route,
    safetyTarget: safety.target,
    safetyCheckVisible: needsCheck,
    pendingSafetyCheck: needsCheck,
    previousSafetyRoute: needsCheck ? safety.route : null,
    uncertaintyPauseVisible: showPause,
    uncertaintyPauseRunning: showPause ? current.uncertaintyPauseRunning === true : false,
    uncertaintyPauseCompleted: showPause ? current.uncertaintyPauseCompleted === true : false,
    uncertaintyPauseRemaining: showPause ? Number(current.uncertaintyPauseRemaining || 120) : 120
  };
}

/**
 * 按风险对象和结构化按钮答案生成确认文本。
 * @param {string} answer 结构化答案 yes、no 或 unsure。
 * @param {string} target 风险对象 self、other 或 unclear。
 * @returns {string} 安全确认按钮对应的文本。
 */
function buildSafetyAnswerText(answer, target) {
  if (target === 'other') {
    if (answer === 'yes') return '有，对方现在正处于即时危险或已经准备了相关物品。';
    if (answer === 'unsure') return '我不确定对方是否会马上伤害自己。';
    return '没有，我目前没有发现对方处于即时危险或已经准备相关物品。';
  }
  if (answer === 'yes') return '有，我现在有伤害自己的意图、计划或已经准备了相关物品。';
  if (answer === 'unsure') return '不确定，我担心自己可能会失控。';
  return '没有，我现在没有伤害自己的意图、具体计划，也没有准备相关物品。';
}

/**
 * 返回新会话的初始安全界面状态。
 * @returns {object} 初始安全状态。
 */
function resetSafetyState() {
  return {
    isCrisis: false,
    safetyLevel: 'none',
    safetyRoute: 'GENERAL',
    safetyTarget: 'self',
    safetyCheckVisible: false,
    pendingSafetyCheck: false,
    previousSafetyRoute: null,
    uncertaintyPauseVisible: false,
    uncertaintyPauseRunning: false,
    uncertaintyPauseCompleted: false,
    uncertaintyPauseRemaining: 120,
    uncertaintyPauseDismissed: false,
    uncertaintySudsBefore: 50,
    uncertaintySudsAfter: 50
  };
}

/**
 * 将主观痛苦评分规范到 0–100 整数；非数值使用模块约定默认值。
 * @param {*} value 待校验的外部输入。
 * @returns {number} 规范化的痛苦评分。
 */
function clampSuds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

module.exports = {
  normalizeSafetyResponse,
  shouldShowUncertaintyPause,
  buildSafetyStatePatch,
  buildSafetyAnswerText,
  resetSafetyState,
  clampSuds
};
