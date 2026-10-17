const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregate } = require('./stats');
test('统计记录数、下降幅度和抵抗率', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const result = aggregate(
    [
      {
        created_at: '2026-10-16T12:00:00Z',
        trigger: '门锁',
        sudsBefore: 80,
        sudsAfter: 40,
        resisted: true
      },
      {
        created_at: '2026-10-15T12:00:00Z',
        trigger: '门锁',
        sudsBefore: 60,
        sudsAfter: 50,
        resisted: false
      }
    ],
    7,
    now
  );
  assert.equal(result.count, 2);
  assert.equal(result.averageSudsDrop, 25);
  assert.equal(result.resistanceRate, 0.5);
  assert.equal(result.topTriggers[0].trigger, '门锁');
});
test('排除统计窗口外的记录', () => {
  assert.equal(
    aggregate([{ created_at: '2026-01-01', trigger: '旧' }], 7, Date.parse('2026-10-17')).count,
    0
  );
});
