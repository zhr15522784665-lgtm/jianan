'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSafetyResponse,
  buildSafetyStatePatch,
  buildSafetyAnswerText,
  resetSafetyState,
  clampSuds
} = require('./chat-safety');

test('旧版危机响应仍能解析', () => {
  const safety = normalizeSafetyResponse({ isCrisis: true });
  assert.equal(safety.level, 'crisis');
  assert.equal(safety.shouldShowCrisisCard, true);
});

test('危机状态不会被后续普通响应覆盖', () => {
  const patch = buildSafetyStatePatch(Object.assign(resetSafetyState(), { isCrisis: true }), {
    isCrisis: false,
    safety: { level: 'none', route: 'GENERAL' }
  });
  assert.equal(patch.isCrisis, true);
});

test('安全追问显示黄色卡', () => {
  const patch = buildSafetyStatePatch(resetSafetyState(), {
    safety: {
      level: 'safety_check',
      route: 'CLARIFY_SAFETY',
      target: 'unclear',
      shouldAskSafetyCheck: true
    }
  });
  assert.equal(patch.safetyCheckVisible, true);
  assert.equal(patch.pendingSafetyCheck, true);
});

test('危机强制关闭暂停键', () => {
  const patch = buildSafetyStatePatch(
    Object.assign(resetSafetyState(), { uncertaintyPauseRunning: true }),
    {
      isCrisis: true,
      safety: { level: 'crisis', route: 'CRISIS_RESPONSE', shouldShowCrisisCard: true },
      intervention: { type: 'uncertainty_pause' }
    }
  );
  assert.equal(patch.uncertaintyPauseVisible, false);
  assert.equal(patch.uncertaintyPauseRunning, false);
});

test('合法干预显示暂停键', () => {
  const patch = buildSafetyStatePatch(resetSafetyState(), {
    safety: { level: 'ocd_intrusive', route: 'OCD_SUPPORT', target: 'self' },
    intervention: { type: 'uncertainty_pause', durationSeconds: 120 }
  });
  assert.equal(patch.uncertaintyPauseVisible, true);
});

test('他人风险不会显示暂停键', () => {
  const patch = buildSafetyStatePatch(resetSafetyState(), {
    safety: {
      level: 'safety_check',
      route: 'OTHER_PERSON_SUPPORT',
      target: 'other',
      shouldAskSafetyCheck: true
    },
    intervention: { type: 'uncertainty_pause' }
  });
  assert.equal(patch.uncertaintyPauseVisible, false);
});

test('结构化按钮文本区分本人和他人', () => {
  assert.match(buildSafetyAnswerText('yes', 'self'), /我现在有/);
  assert.match(buildSafetyAnswerText('yes', 'other'), /对方现在/);
});

test('SUDS限制在0到100', () => {
  assert.equal(clampSuds(-5), 0);
  assert.equal(clampSuds(120), 100);
  assert.equal(clampSuds('63'), 63);
});
