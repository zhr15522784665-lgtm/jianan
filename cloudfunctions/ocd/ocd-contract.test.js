'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const rows = { ocd_profiles: [], ocd_logs: [], exposure_steps: [], ocd_assessments: [] };
const command = {};
for (const op of ['lt', 'gt', 'gte', 'eq', 'inc', 'nin']) command[op] = (value) => ({ op, value });
function compare(value, expected) {
  if (!expected || !expected.op) return value === expected;
  if (expected.op === 'eq') return new Date(value).getTime() === new Date(expected.value).getTime();
  if (expected.op === 'nin') return !expected.value.includes(value);
  const a = expected.value instanceof Date ? new Date(value).getTime() : value;
  const b = expected.value instanceof Date ? expected.value.getTime() : expected.value;
  return expected.op === 'lt' ? a < b : expected.op === 'gt' ? a > b : a >= b;
}
function matches(row, where) {
  return Object.entries(where).every(([key, value]) =>
    key === '$or' ? value.some((part) => matches(row, part)) : compare(row[key], value)
  );
}
function query(name, where = {}) {
  const sorts = [];
  let start = 0;
  let size = Infinity;
  const api = {
    where(extra) {
      return query(name, Object.assign({}, where, extra));
    },
    orderBy(key, direction) {
      sorts.push([key, direction]);
      return api;
    },
    skip(value) {
      start = value;
      return api;
    },
    limit(value) {
      size = value;
      return api;
    },
    async get() {
      const found = rows[name]
        .filter((row) => matches(row, where))
        .slice()
        .sort((a, b) => {
          for (const [key, dir] of sorts) {
            if (a[key] !== b[key]) return (a[key] > b[key] ? 1 : -1) * (dir === 'desc' ? -1 : 1);
          }
          return 0;
        });
      return { data: found.slice(start, start + size) };
    },
    async update({ data }) {
      const found = rows[name].filter((row) => matches(row, where));
      for (const row of found)
        for (const [key, value] of Object.entries(data))
          row[key] = value && value.op === 'inc' ? (row[key] || 0) + value.value : value;
      return { stats: { updated: found.length } };
    },
    async remove() {
      const before = rows[name].length;
      rows[name] = rows[name].filter((row) => !matches(row, where));
      return { stats: { removed: before - rows[name].length } };
    }
  };
  return api;
}
const db = {
  command,
  serverDate: () => new Date(),
  createCollection: async () => ({}),
  collection(name) {
    return Object.assign(query(name), {
      async add({ data }) {
        const row = Object.assign({}, data, { _id: name + '-' + rows[name].length });
        rows[name].push(row);
        return { _id: row._id };
      },
      doc(id) {
        return {
          async set({ data }) {
            const row = Object.assign({}, data, { _id: id });
            const old = rows[name].findIndex((x) => x._id === id);
            if (old >= 0) rows[name][old] = row;
            else rows[name].push(row);
            return {};
          }
        };
      }
    });
  }
};
let identity = 'A';
const cloud = {
  init() {},
  DYNAMIC_CURRENT_ENV: 'test',
  getWXContext: () => ({ OPENID: identity }),
  database: () => db
};
const original = Module._load;
Module._load = function (request, parent, isMain) {
  return request === 'wx-server-sdk' ? cloud : original.call(this, request, parent, isMain);
};
const fn = require('./index');
Module._load = original;
const logic = require('./logic');
test.beforeEach(() => {
  for (const name of Object.keys(rows)) rows[name].length = 0;
  identity = 'A';
});
const validLog = {
  type: 'exposure',
  trigger: '门锁',
  thought: '怀疑',
  behavior: '延迟检查',
  resisted: true,
  durationMin: 2,
  sudsBefore: 70,
  sudsAfter: 45,
  sensitiveConsent: true
};
test('入口仅从微信上下文取身份，忽略伪造openid', async () => {
  await fn.main({
    action: 'log.add',
    openid: 'B',
    payload: Object.assign({}, validLog, { _openid: 'B' })
  });
  assert.equal(rows.ocd_logs[0]._openid, 'A');
});
test('无可信身份拒绝SCF与HTTP', async () => {
  identity = '';
  const input = { action: 'profile.get', openid: 'A' };
  assert.equal((await fn.main(input)).errorCode, 'UNAUTHENTICATED');
  const result = await fn.main({ httpMethod: 'POST', body: JSON.stringify(input) });
  assert.equal(result.statusCode, 401);
});
test('A不能读B日志或自评', async () => {
  await fn.main({ action: 'log.add', payload: validLog });
  identity = 'B';
  assert.deepEqual((await fn.main({ action: 'log.list' })).data.items, []);
  assert.deepEqual((await fn.main({ action: 'assess.history' })).data, []);
});
test('越权更新阶梯返回NOT_FOUND且原记录不变', async () => {
  const created = await fn.main({
    action: 'step.add',
    payload: { title: '轻微不齐', level: 20, sudsTarget: 30, sensitiveConsent: true }
  });
  identity = 'B';
  const result = await fn.main({
    action: 'step.update',
    payload: { id: created.data._id, status: 'completed' }
  });
  assert.equal(result.errorCode, 'NOT_FOUND');
  assert.equal(rows.exposure_steps[0].status, 'not_started');
});
for (const value of [-1, 101, NaN, '50'])
  test('SUDS拒绝非法值 ' + String(value), async () => {
    const result = await fn.main({
      action: 'log.add',
      payload: Object.assign({}, validLog, { sudsBefore: value })
    });
    assert.equal(result.ok, false);
    assert.equal(rows.ocd_logs.length, 0);
  });
test('文本2001字拒绝，2000字允许', () => {
  assert.throws(() => logic.text('字'.repeat(2001), 'text'));
  assert.equal(logic.text('字'.repeat(2000), 'text').length, 2000);
});
test('记录写入需要单独敏感同意', async () => {
  const result = await fn.main({
    action: 'log.add',
    payload: Object.assign({}, validLog, { sensitiveConsent: false })
  });
  assert.equal(result.ok, false);
});
test('相同时间戳分页无重复或遗漏', async () => {
  const at = new Date();
  for (let i = 0; i < 5; i++) rows.ocd_logs.push({ _id: 'a' + i, _openid: 'A', created_at: at });
  const first = (await fn.main({ action: 'log.list', payload: { limit: 2 } })).data;
  const second = (
    await fn.main({ action: 'log.list', payload: { limit: 2, before: first.nextBefore } })
  ).data;
  const third = (
    await fn.main({ action: 'log.list', payload: { limit: 2, before: second.nextBefore } })
  ).data;
  assert.deepEqual(
    [...first.items, ...second.items, ...third.items].map((x) => x._id),
    ['a0', 'a1', 'a2', 'a3', 'a4']
  );
  assert.equal(third.hasMore, false);
});
test('统计超过100条不会被默认查询上限截断', async () => {
  for (let i = 0; i < 205; i++)
    rows.ocd_logs.push(
      Object.assign({}, validLog, { _id: String(i), _openid: 'A', created_at: new Date() })
    );
  rows.ocd_logs.push(
    Object.assign({}, validLog, { _id: 'B', _openid: 'B', created_at: new Date() })
  );
  assert.equal((await fn.main({ action: 'log.stats' })).data.count, 205);
});
test('重复档案保存不产生多份', async () => {
  const payload = { subtypes: ['harm'], sensitiveConsent: true };
  await fn.main({ action: 'profile.save', payload });
  await fn.main({ action: 'profile.save', payload });
  assert.equal(rows.ocd_profiles.length, 1);
});
test('部分档案更新不会清空已有字段', async () => {
  await fn.main({
    action: 'profile.save',
    payload: {
      subtypes: ['harm'],
      primaryObsession: '门锁',
      compulsions: ['确认'],
      sensitiveConsent: true
    }
  });
  await fn.main({
    action: 'profile.save',
    payload: { subtypes: ['contamination'], sensitiveConsent: true }
  });
  assert.deepEqual(rows.ocd_profiles[0].compulsions, ['确认']);
  assert.equal(rows.ocd_profiles[0].primaryObsession, '门锁');
});
test('重复练习更新不重复计次', async () => {
  const step = (
    await fn.main({
      action: 'step.add',
      payload: { title: '小步', level: 20, sudsTarget: 30, sensitiveConsent: true }
    })
  ).data;
  await fn.main({
    action: 'step.update',
    payload: { id: step._id, attemptsDelta: 1, practiceId: 'p1', sensitiveConsent: true }
  });
  const retry = await fn.main({
    action: 'step.update',
    payload: { id: step._id, attemptsDelta: 1, practiceId: 'p1', sensitiveConsent: true }
  });
  assert.equal(retry.data.alreadySaved, true);
  assert.equal(rows.exposure_steps[0].attempts, 1);
});
test('云端删除必须使用明确确认词且仅删当前用户', async () => {
  await fn.main({ action: 'log.add', payload: validLog });
  identity = 'B';
  await fn.main({ action: 'log.add', payload: validLog });
  identity = 'A';
  assert.equal(
    (await fn.main({ action: 'privacy.deleteMine', payload: { confirmation: 'bad' } })).errorCode,
    'VALIDATION_ERROR'
  );
  assert.deepEqual(
    (
      await fn.main({
        action: 'privacy.deleteMine',
        payload: { confirmation: 'DELETE_MY_OCD_DATA' }
      })
    ).data.deleted.ocd_logs,
    1
  );
  identity = 'B';
  assert.equal(rows.ocd_logs.length, 1);
});
test('双版本自评分档与答案类型校验', () => {
  for (const [version, count] of [
    ['brief-12', 12],
    ['detail-18', 18]
  ]) {
    assert.equal(logic.score(Array(count).fill(4), version).band, '高');
    assert.equal(logic.score(Array(count).fill(0), version).band, '低');
  }
  assert.throws(() => logic.score(Array(12).fill('1'), 'brief-12'));
  assert.throws(() => logic.assess({ answers: Array(12).fill(0), sensitiveConsent: true }));
});
test('HTTP预检和错误JSON合同', async () => {
  assert.equal((await fn.main({ httpMethod: 'OPTIONS' })).statusCode, 204);
  assert.equal(
    JSON.parse((await fn.main({ httpMethod: 'POST', body: '{' })).body).errorCode,
    'BAD_JSON'
  );
});
