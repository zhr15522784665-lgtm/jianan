const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreAnswers, nextStep } = require('./scoring');

test('简化版四档计分', () => {
  assert.equal(scoreAnswers(Array(12).fill(0), 'brief-12').band, '低');
  assert.equal(scoreAnswers(Array(12).fill(4), 'brief-12').band, '高');
});

test('详细版等比阈值', () => {
  assert.equal(scoreAnswers(Array(18).fill(2), 'detail-18').band, '中等');
  assert.match(nextStep(scoreAnswers(Array(18).fill(4), 'detail-18')), /评估/);
});

test('拒绝错误答案', () => {
  assert.throws(() => scoreAnswers([1], 'brief-12'));
  assert.throws(() => scoreAnswers(Array(12).fill(5), 'brief-12'));
});
