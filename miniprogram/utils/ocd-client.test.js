const test = require('node:test');
const assert = require('node:assert/strict');
const { callOCD } = require('./ocd-client');

test.afterEach(() => {
  delete global.wx;
});

test('无微信云能力时异步拒绝', async () => {
  await assert.rejects(callOCD('step.list'), /云能力不可用/);
  global.wx = { cloud: {} };
  await assert.rejects(callOCD('step.list'), /云能力不可用/);
});

test('保持 action、参数、敏感同意和返回数据', async () => {
  const payload = { sensitiveConsent: true, title: '虚构阶梯' };
  let request;
  global.wx = {
    cloud: {
      async callFunction(input) {
        request = input;
        return { result: { ok: true, data: { _id: 'synthetic-id' } } };
      }
    }
  };
  assert.deepEqual(await callOCD('step.add', payload), { _id: 'synthetic-id' });
  assert.deepEqual(request, { name: 'ocd', data: { action: 'step.add', payload } });
  assert.equal(request.data.payload, payload);
});

test('未传参数时发送空对象', async () => {
  global.wx = {
    cloud: {
      async callFunction(request) {
        assert.deepEqual(request.data.payload, {});
        return { result: { ok: true, data: [] } };
      }
    }
  };
  assert.deepEqual(await callOCD('step.list'), []);
});

test('服务端校验错误保留提示，缺失回包使用兜底', async () => {
  global.wx = {
    cloud: {
      async callFunction() {
        return { result: { ok: false, errorMessage: '请单独同意敏感健康信息的云端保存后再继续' } };
      }
    }
  };
  await assert.rejects(callOCD('step.add'), /请单独同意/);
  for (const response of [undefined, {}, { result: null }]) {
    global.wx.cloud.callFunction = async () => response;
    await assert.rejects(callOCD('step.list'), /云端请求失败/);
  }
});

test('网络错误原样传递，让页面重试流程处理', async () => {
  const error = new Error('synthetic network failure');
  global.wx = { cloud: { callFunction: () => Promise.reject(error) } };
  await assert.rejects(callOCD('step.list'), (actual) => actual === error);
});
