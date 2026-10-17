const test = require('node:test');
const assert = require('node:assert/strict');
const { clampSuds, sortSteps, progressSeries, practiceId } = require('./exposure-logic');
test('SUDS限制在0到100', () => {
  assert.equal(clampSuds(-3), 0);
  assert.equal(clampSuds(120), 100);
  assert.equal(clampSuds('55'), 55);
});
test('阶梯按难度稳定排序', () => {
  assert.deepEqual(
    sortSteps([
      { level: 80, _id: 'b' },
      { level: 20, _id: 'a' }
    ]).map((x) => x._id),
    ['a', 'b']
  );
});
test('进度只取指定步骤', () => {
  assert.equal(
    progressSeries([{ stepId: 'a', sudsBefore: 70, sudsAfter: 40 }, { stepId: 'b' }], 'a').length,
    1
  );
});
test('练习ID可用于幂等更新', () => {
  assert.equal(practiceId('a', 12), 'a-12');
});
