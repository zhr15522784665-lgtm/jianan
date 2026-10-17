'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const k = require('./ocd-knowledge');
test('十类亚型独立且字段完整', () => {
  assert.equal(k.SUBTYPES.length, 10);
  assert.equal(new Set(k.SUBTYPES.map((s) => s.id)).size, 10);
  k.SUBTYPES.forEach((s) =>
    ['id', 'name', 'obsessions', 'compulsions', 'erpHints'].forEach((key) =>
      assert.ok(s[key].length)
    )
  );
});
for (const s of k.SUBTYPES)
  test(`知识上下文受控且确定：${s.id}`, () => {
    for (const intent of ['P0', 'P1', 'P2', 'P3', 'P4']) {
      const output = k.buildContext(s.id, intent);
      assert.ok(output.length <= 1200);
      assert.match(output, /不诊断/);
      assert.equal(output, k.buildContext(s.id, intent));
    }
  });
test('未知亚型安全回落', () => assert.match(k.buildContext('bad'), /混合/));
test('机制短句、纠偏和安全红线齐备', () => {
  k.MECHANISMS.forEach((m) => {
    assert.ok(m.summary.length <= 80);
    assert.ok(m.misconception);
  });
  assert.match(k.RED_LINES.join(''), /药物/);
  assert.match(k.RED_LINES.join(''), /12356/);
});
