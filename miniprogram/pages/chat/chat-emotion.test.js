'use strict';

// miniprogram/pages/chat/chat-emotion.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FACE_CALM,
  FACE_CARE,
  FACE_SERIOUS,
  normalizeEmotionResponse,
  emotionToFace,
  buildEmotionStatePatch,
  resetEmotionState
} = require('./chat-emotion');

// ── 三态映射 ──────────────────────────────────────────────────
test('emotionToFace：crisis 与 isCrisis 映射 serious', () => {
  assert.equal(emotionToFace('crisis', false), FACE_SERIOUS);
  assert.equal(emotionToFace('sad', true), FACE_SERIOUS);
  assert.equal(emotionToFace('calm', true), FACE_SERIOUS);
});

test('emotionToFace：五个情绪标签映射 care', () => {
  for (const label of ['sad', 'anxious', 'angry', 'tired', 'warm']) {
    assert.equal(emotionToFace(label, false), FACE_CARE);
  }
});

test('emotionToFace：calm 与其他映射 calm', () => {
  assert.equal(emotionToFace('calm', false), FACE_CALM);
  assert.equal(emotionToFace('unknown_label', false), FACE_CALM);
  assert.equal(emotionToFace(null, false), FACE_CALM);
});

// ── 回包归一化 ────────────────────────────────────────────────
test('normalizeEmotionResponse：无 emotion 字段返回 null', () => {
  assert.equal(normalizeEmotionResponse({ ok: true }), null);
  assert.equal(normalizeEmotionResponse(null), null);
  assert.equal(normalizeEmotionResponse(undefined), null);
});

test('normalizeEmotionResponse：读 r.emotion', () => {
  const r = normalizeEmotionResponse({ emotion: { label: 'sad', source: 'rule', mode: 'on' } });
  assert.deepEqual(r, { label: 'sad', source: 'rule', mode: 'on' });
});

// ── mode 门禁 ─────────────────────────────────────────────────
test('shadow 模式：返回 emotion 但不应用', () => {
  const patch = buildEmotionStatePatch(
    { faceClass: FACE_CALM },
    { emotion: { label: 'sad', source: 'model', mode: 'shadow' } },
    { isCrisis: false }
  );
  assert.equal(patch.faceClass, FACE_CALM);
  assert.equal(patch.emotionLabel, null);
});

test('off 模式回包（无 emotion）：保持当前表情', () => {
  const patch = buildEmotionStatePatch(
    { faceClass: FACE_CARE, faceCrisisSticky: false },
    { ok: true, reply: '...' },
    { isCrisis: false }
  );
  assert.equal(patch.faceClass, FACE_CARE);
  assert.equal(patch.emotionLabel, null);
});

// ── 正常应用 ──────────────────────────────────────────────────
test('on 模式：低落输入得到 care', () => {
  const patch = buildEmotionStatePatch(
    { faceClass: FACE_CALM },
    { emotion: { label: 'sad', source: 'model', mode: 'on' } },
    { isCrisis: false }
  );
  assert.equal(patch.faceClass, FACE_CARE);
  assert.equal(patch.emotionLabel, 'sad');
  assert.equal(patch.faceCrisisSticky, false);
});

// ── 危机粘性 ──────────────────────────────────────────────────
test('危机粘性：safetyPatch.isCrisis 优先且 sticky', () => {
  const patch = buildEmotionStatePatch(
    { faceClass: FACE_CARE },
    { emotion: { label: 'warm', source: 'model', mode: 'on' } },
    { isCrisis: true }
  );
  assert.equal(patch.faceClass, FACE_SERIOUS);
  assert.equal(patch.faceCrisisSticky, true);
});

test('危机粘性：sticky 后即使回包非危机也保持 serious', () => {
  const patch = buildEmotionStatePatch(
    { faceClass: FACE_SERIOUS, faceCrisisSticky: true },
    { emotion: { label: 'calm', source: 'default', mode: 'on' } },
    { isCrisis: false }
  );
  assert.equal(patch.faceClass, FACE_SERIOUS);
  assert.equal(patch.faceCrisisSticky, true);
});

test('回包 label=crisis 时即使 mode=on 也 serious', () => {
  const patch = buildEmotionStatePatch(
    { faceClass: FACE_CALM },
    { emotion: { label: 'crisis', source: 'safety', mode: 'on' } },
    { isCrisis: false }
  );
  assert.equal(patch.faceClass, FACE_SERIOUS);
  assert.equal(patch.faceCrisisSticky, true);
});

// ── 重置 ──────────────────────────────────────────────────────
test('resetEmotionState：回到 calm 且解除粘性', () => {
  assert.deepEqual(resetEmotionState(), {
    faceClass: FACE_CALM,
    faceCrisisSticky: false,
    emotionLabel: null
  });
});
