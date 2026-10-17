'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cases = require('./testdata/safety-cases.json');
const {
  LEVELS,
  ROUTES,
  assessSafety,
  assessReassuranceLoop,
  buildFallbackSafety
} = require('./safety-router');

for (const item of cases) {
  test(item.id + ' ' + item.text, () => {
    const actual = assessSafety(item.text);
    assert.equal(actual.level, item.expectedLevel);
    assert.equal(actual.route, item.expectedRoute);
    assert.equal(actual.shouldShowCrisisCard, item.expectedCard);
    assert.equal(actual.target, item.expectedTarget);
  });
}

test('结构化安全回答 yes 进入危机', () => {
  const actual = assessSafety('有', {
    pendingSafetyCheck: true,
    safetyAnswer: 'yes',
    previousSafetyRoute: ROUTES.CLARIFY_SAFETY
  });
  assert.equal(actual.level, LEVELS.CRISIS);
  assert.equal(actual.shouldShowCrisisCard, true);
});

test('结构化安全回答 unsure 保持安全追问', () => {
  const actual = assessSafety('不确定', {
    pendingSafetyCheck: true,
    safetyAnswer: 'unsure',
    previousSafetyRoute: ROUTES.CLARIFY_SAFETY
  });
  assert.equal(actual.level, LEVELS.SAFETY_CHECK);
});

test('结构化安全回答 no 返回OCD支持', () => {
  const actual = assessSafety('没有', {
    pendingSafetyCheck: true,
    safetyAnswer: 'no',
    previousSafetyRoute: ROUTES.OCD_SUPPORT
  });
  assert.equal(actual.level, LEVELS.OCD_INTRUSIVE);
  assert.equal(actual.route, ROUTES.OCD_SUPPORT);
});

test('回答「没有」不能把明确的危机文本降级', () => {
  const actual = assessSafety('我准备今晚跳楼', {
    pendingSafetyCheck: true,
    safetyAnswer: 'no',
    previousSafetyRoute: ROUTES.CLARIFY_SAFETY
  });
  assert.equal(actual.level, LEVELS.CRISIS);
  assert.equal(actual.route, ROUTES.CRISIS_RESPONSE);
  assert.equal(actual.shouldShowCrisisCard, true);
});

test('回答「不确定」遇到危机文本时仍判危机', () => {
  const actual = assessSafety('我已经写好遗书了', {
    pendingSafetyCheck: true,
    safetyAnswer: 'unsure',
    previousSafetyRoute: ROUTES.CLARIFY_SAFETY
  });
  assert.equal(actual.level, LEVELS.CRISIS);
  assert.equal(actual.shouldShowCrisisCard, true);
});

test('回答「没有」遇到强迫观念文本时仍回落 OCD 支持', () => {
  const actual = assessSafety('我脑子里冒出伤害自己的念头，但我不会去做', {
    pendingSafetyCheck: true,
    safetyAnswer: 'no',
    previousSafetyRoute: ROUTES.OCD_SUPPORT
  });
  assert.equal(actual.level, LEVELS.OCD_INTRUSIVE);
  assert.equal(actual.shouldShowCrisisCard, false);
});

test('他人风险回答 yes 不把用户本人标成危机', () => {
  const actual = assessSafety('有', {
    pendingSafetyCheck: true,
    safetyAnswer: 'yes',
    previousSafetyRoute: ROUTES.OTHER_PERSON_SUPPORT
  });
  assert.equal(actual.route, ROUTES.OTHER_PERSON_SUPPORT);
  assert.equal(actual.target, 'other');
  assert.equal(actual.shouldShowCrisisCard, false);
});

test('连续寻求保证触发暂停键', () => {
  const actual = assessReassuranceLoop('你确定我不会真的伤害家人吗？', [
    '我是不是会伤害家人？',
    '你能保证我不会伤害家人吗？'
  ]);
  assert.equal(actual.likely, true);
});

test('单次普通提问不触发暂停键', () => {
  const actual = assessReassuranceLoop('ERP练习通常怎么开始？', ['我今天有点焦虑']);
  assert.equal(actual.likely, false);
});

test('旧规则命中时保守回退为危机', () => {
  const actual = buildFallbackSafety(true);
  assert.equal(actual.level, LEVELS.CRISIS);
  assert.equal(actual.fallbackUsed, true);
});

test('10000次规则判断在回归阈值内', () => {
  const started = Date.now();
  for (let i = 0; i < 10000; i += 1) {
    assessSafety(cases[i % cases.length].text);
  }
  assert.ok(Date.now() - started < 3000);
});

test('长文本尾部危机语言不被截断（4000 字窗口）', () => {
  const padding = '今天天气一般，工作有点忙。'.repeat(120); // ≈2400 字
  const actual = assessSafety(padding + '其实我一直想死');
  assert.equal(actual.level, LEVELS.CRISIS);
  assert.equal(actual.shouldShowCrisisCard, true);
});

test('安慰循环：同一问题重复两次仍能识别', () => {
  const actual = assessReassuranceLoop('你确定我不会伤害家人吗？', ['你确定我不会伤害家人吗？']);
  assert.equal(actual.likely, true);
});

test('安慰循环：不同问题不因归一化而误判', () => {
  // 两句都含安慰寻求标记（你确定 / 你能保证），但内容无关 → 不应判为重复
  const actual = assessReassuranceLoop('你确定我不会伤害家人吗？', ['你能保证我明天会升职吗？']);
  assert.equal(actual.likely, false);
});
