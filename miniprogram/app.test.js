const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

/**
 * 在独立微信 mock 上下文加载应用，避免污染其他测试。
 * @param {object} cloud 云 SDK mock。
 * @returns {object} 应用定义。
 */
function loadApp(cloud) {
  let application;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8'), {
    wx: { getStorageSync: () => 'synthetic-env', cloud },
    App: (definition) => {
      application = definition;
    },
    console: { log() {}, error() {} }
  });
  return application;
}

test('云初始化使用覆盖环境，检测调用已存在的数据云函数', async () => {
  let initialized;
  const app = loadApp({
    init: (options) => {
      initialized = options;
    },
    async callFunction(request) {
      assert.equal(request.name, 'ocd');
      assert.equal(request.data.action, 'profile.get');
      return { result: { ok: true, data: {} } };
    }
  });
  app.onLaunch();
  assert.equal(initialized.env, 'synthetic-env');
  assert.equal(app.globalData.cloudEnv, 'synthetic-env');
  assert.equal((await app.checkCloudEnv()).ok, true);
});

test('云检测不会将网络失败或无可信身份误报为可达', async () => {
  const app = loadApp({
    init() {},
    async callFunction() {
      throw new Error('synthetic network failure');
    }
  });
  app.onLaunch();
  assert.equal((await app.checkCloudEnv()).ok, false);
  const denied = loadApp({
    init() {},
    async callFunction() {
      return { result: { ok: false, errorCode: 'UNAUTHENTICATED' } };
    }
  });
  denied.onLaunch();
  assert.equal((await denied.checkCloudEnv()).code, 'UNAUTHENTICATED');
});
