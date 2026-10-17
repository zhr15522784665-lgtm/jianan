'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('./ocd-router');
const examples = {
  contamination: ['我怕细菌反复消毒很痛苦', '我洗手洗到破皮'],
  harm: ['我害怕失控伤人，反复确认', '我反复害怕自己撞人'],
  sexual: ['禁忌念头反复出现很痛苦', '性方面的念头让我不敢想'],
  religious: ['我担心报应反复忏悔', '我怕亵渎而不断祈祷'],
  relationship: ['我反复确认关系是否正确', '我反复想他爱不爱我'],
  symmetry: ['东西必须一样才安心', '我反复摆正直到对称'],
  somatic: ['我盯着某个感觉停不下来', '我反复注意呼吸和心跳'],
  magical: ['怕倒霉必须做几次', '吉利数字的忌讳让我痛苦'],
  hoarding: ['东西扔不掉影响生活', '舍不得丢，只能囤着'],
  mixed: ['今天晴天', '最近工作很多']
};
for (const [id, texts] of Object.entries(examples)) {
  texts.forEach((text) =>
    test(`亚型 ${id}：${text}`, () => assert.equal(r.classifySubtype(text).subtype, id))
  );
  test(`亚型 ${id} 不误收无关主题`, () =>
    assert.notEqual(r.classifySubtype(id === 'mixed' ? '我洗手洗到破皮' : '今天晴天').subtype, id));
}
for (const text of ['我每天洗手', '洗手', '我洗手'])
  test(`正常洗手不贴标签：${text}`, () => assert.equal(r.classifySubtype(text).subtype, 'mixed'));
const signals = {
  depression: ['我没兴趣', '我什么都不想做'],
  sleep: ['我睡不着', '我整夜醒'],
  substance: ['我靠酒才能睡', '我吃药助眠'],
  adhd: ['我从小就坐不住', '我注意力集中不了']
};
for (const [flag, texts] of Object.entries(signals))
  texts.forEach((text) =>
    test(`共病 ${flag}：${text}`, () => assert.ok(r.detectComorbidity(text).flags.includes(flag)))
  );
test('他人信号不归本人', () =>
  assert.deepEqual(r.detectComorbidity('朋友睡不着，朋友什么都不想做，我该怎么帮助她').flags, []));
test('共病跨轮两次建议评估', () =>
  assert.equal(r.detectComorbidity('我还是睡不着', ['我昨晚失眠']).suggestProfessional, true));
test('只取最近六条用户消息', () =>
  assert.deepEqual(
    r.detectComorbidity('你好', [
      '我没兴趣',
      '天气好',
      '天气好',
      '天气好',
      '天气好',
      '天气好',
      '天气好'
    ]).flags,
    []
  ));
test('P0 压倒一切', () =>
  assert.equal(
    r.decidePriority({
      safety: { shouldShowCrisisCard: true },
      flags: ['depression'],
      text: '反复确认'
    }).level,
    'P0'
  ));
test('检查两小时与低落双轨', () => {
  const text = '我检查门锁两个小时，最近也什么都不想做';
  assert.deepEqual(r.decidePriority({ text, flags: r.detectComorbidity(text).flags }), {
    level: 'P1',
    reason: '强迫急性发作并有共病信号',
    dual: true
  });
});
test('纯共病 P3 而不是 OCD', () =>
  assert.equal(
    r.decidePriority({ text: '我没兴趣、睡不着、觉得活着没意思', flags: ['depression', 'sleep'] })
      .level,
    'P3'
  ));
test('纯科普 P2', () =>
  assert.equal(r.decidePriority({ text: '强迫症和ERP是什么', flags: [] }).level, 'P2'));
test('闲聊 P4', () => assert.equal(r.decidePriority({ text: '你好', flags: [] }).level, 'P4'));
test('模型候选只能使用白名单', () => {
  assert.equal(r.classifySubtype('不明确', [], 'harm').source, 'model');
  assert.equal(r.classifySubtype('不明确', [], 'bad').subtype, 'mixed');
});
