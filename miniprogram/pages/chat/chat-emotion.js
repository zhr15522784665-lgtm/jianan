'use strict';

// miniprogram/pages/chat/chat-emotion.js
// 前端情绪状态层（与 chat-safety.js 同构的纯函数模块）。
//
// 设计约束（来自审核修订版）：
// 1. 读云函数回包的 r.emotion（不是 res.data.emotion）。
// 2. 只有 r.emotion.mode === 'on' 才应用普通情绪标签（shadow 不渲染）。
// 3. safetyPatch.isCrisis === true 时无条件 serious；危机粘性跟随安全层，
//    直到切换人格 / 新建会话时 resetEmotionState() 才解除。
// 4. 情绪只驱动表情层，绝不覆盖安全确认、危机卡等安全交互。

const FACE_CALM = 'calm';
const FACE_CARE = 'care';
const FACE_SERIOUS = 'serious';

// 前端读到的回包 emotion 归一化；无 emotion 字段返回 null（off 模式或旧回包）。
/**
 * 读取回包的 emotion 字段；旧回包返回 null。
 * @param {object} response 云函数 result 回包。
 * @returns {?object} 规范情绪字段，缺失时为 null。
 */
function normalizeEmotionResponse(response) {
  const raw = response && typeof response === 'object' ? response : {};
  const emotion = raw.emotion && typeof raw.emotion === 'object' ? raw.emotion : null;
  if (!emotion) return null;
  return {
    label: typeof emotion.label === 'string' ? emotion.label : 'calm',
    source: typeof emotion.source === 'string' ? emotion.source : 'default',
    mode: typeof emotion.mode === 'string' ? emotion.mode : 'off'
  };
}

// label → 表情层。危机优先于一切。
/**
 * 将情绪映射到表情；危机状态优先。
 * @param {string} label 情绪标签。
 * @param {boolean} isCrisis 安全层确定的当前危机状态。
 * @returns {string} calm、care 或 serious。
 */
function emotionToFace(label, isCrisis) {
  if (isCrisis === true) return FACE_SERIOUS;
  if (label === 'crisis') return FACE_SERIOUS;
  if (
    label === 'sad' ||
    label === 'anxious' ||
    label === 'angry' ||
    label === 'tired' ||
    label === 'warm'
  ) {
    return FACE_CARE;
  }
  return FACE_CALM;
}

/**
 * 由一轮回包计算情绪状态补丁。
 * @param {object} currentState 当前页面 data（需含 faceClass / faceCrisisSticky）
 * @param {object} response 云函数回包
 * @param {object} safetyPatch buildSafetyStatePatch 的输出（提供 isCrisis 粘性）
 */
function buildEmotionStatePatch(currentState, response, safetyPatch) {
  const current = currentState || {};
  const safety = safetyPatch || {};
  const emotion = normalizeEmotionResponse(response);
  const crisis =
    current.faceCrisisSticky === true ||
    safety.isCrisis === true ||
    (emotion !== null && emotion.label === 'crisis');

  if (!emotion || emotion.mode !== 'on') {
    // off / shadow / 无 emotion：不应用普通情绪；危机粘性仍保证 serious
    if (crisis) {
      return { faceClass: FACE_SERIOUS, faceCrisisSticky: true, emotionLabel: null };
    }
    return {
      faceClass: current.faceClass || FACE_CALM,
      faceCrisisSticky: false,
      emotionLabel: null
    };
  }

  return {
    faceClass: emotionToFace(emotion.label, crisis),
    faceCrisisSticky: crisis,
    emotionLabel: emotion.label
  };
}

// 切换人格 / 新建会话时调用：解除危机粘性，回到 calm。
/**
 * 返回新会话的初始表情状态并解除危机粘性。
 * @returns {object} 初始情绪界面状态。
 */
function resetEmotionState() {
  return {
    faceClass: FACE_CALM,
    faceCrisisSticky: false,
    emotionLabel: null
  };
}

module.exports = {
  FACE_CALM,
  FACE_CARE,
  FACE_SERIOUS,
  normalizeEmotionResponse,
  emotionToFace,
  buildEmotionStatePatch,
  resetEmotionState
};
