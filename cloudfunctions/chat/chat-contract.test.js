'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { EventEmitter } = require('events');

let safetySuggestion = 'pass';
const cloudMock = {
  DYNAMIC_CURRENT_ENV: 'test',
  init() {},
  getWXContext() {
    return { OPENID: 'test-openid' };
  },
  openapi: {
    security: {
      async msgSecCheck() {
        return { result: { suggestion: safetySuggestion } };
      }
    }
  }
};

// ── https mock：按队列返回预置响应，并记录请求体 ─────────────────
// 目的：不访问真实 API 的情况下验证结构化输出链路、有界重试与失败回包。
let httpsQueue = [];
let lastRequestBody = '';
const httpsMock = {
  request(opts, cb) {
    const req = new EventEmitter();
    req.write = (chunk) => {
      lastRequestBody += String(chunk);
    };
    req.setTimeout = () => {};
    req.destroy = (err) => {
      if (err) process.nextTick(() => req.emit('error', err));
    };
    req.end = () => {
      const behavior = httpsQueue.length > 1 ? httpsQueue.shift() : httpsQueue[0];
      const res = new EventEmitter();
      res.statusCode = behavior.status;
      res.setEncoding = () => {};
      process.nextTick(() => {
        cb(res);
        res.emit('data', behavior.body);
        res.emit('end');
      });
    };
    return req;
  }
};
function enqueue(...behaviors) {
  httpsQueue = behaviors.slice();
  lastRequestBody = '';
}
function okBody(text) {
  return { status: 200, body: JSON.stringify({ choices: [{ message: { content: text } }] }) };
}
function statusBody(status, text) {
  return { status, body: text || '{}' };
}

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'wx-server-sdk') return cloudMock;
  if (request === 'https') return httpsMock;
  return originalLoad.call(this, request, parent, isMain);
};

process.env.SAFETY_ROUTER_V2_MODE = 'on';
process.env.EMOTION_LABEL_MODE = 'on';
process.env.UNCERTAINTY_PAUSE_ENABLED = '1';
process.env.DEEPSEEK_API_KEY = 'test-key-not-real';
delete require.cache[require.resolve('./index')];
const chat = require('./index');

test.after(() => {
  Module._load = originalLoad;
});

// ── 原有确定性用例（保持回归） ──────────────────────────────────

test('明确危机早返回，未配置模型Key也能成功', async () => {
  safetySuggestion = 'pass';
  const result = await chat.main({
    personaId: 'jianan',
    messages: [{ role: 'user', content: '我已经把药拿出来了，准备吞下去' }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.isCrisis, true);
  assert.equal(result.safety.level, 'crisis');
  assert.match(result.reply, /12356/);
});

test('内容安全判定risky时仍保留危机卡', async () => {
  safetySuggestion = 'risky';
  const result = await chat.main({
    personaId: 'jianan',
    messages: [{ role: 'user', content: '我现在想死' }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.blockedBySafe, true);
  assert.equal(result.isCrisis, true);
  assert.equal(result.safety.shouldShowCrisisCard, true);
});

test('模糊风险只返回一个安全确认问题', async () => {
  safetySuggestion = 'pass';
  const result = await chat.main({
    personaId: 'jianan',
    messages: [{ role: 'user', content: '最近总出现伤害自己的念头' }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.isCrisis, false);
  assert.equal(result.safety.level, 'safety_check');
  assert.match(result.reply, /是否有伤害自己的意图/);
});

test('他人风险使用他人安全确认文案', async () => {
  const result = await chat.main({
    personaId: 'jianan',
    messages: [{ role: 'user', content: '朋友说她不想活了' }]
  });
  assert.equal(result.safety.target, 'other');
  assert.match(result.reply, /这个人现在是否正处于即时危险/);
});

test('他人风险回答yes返回固定求助步骤且不标记用户危机', async () => {
  safetySuggestion = 'pass';
  const result = await chat.main({
    personaId: 'jianan',
    messages: [
      { role: 'user', content: '朋友说她不想活了' },
      { role: 'assistant', content: '我想先确认对方此刻的安全。' },
      { role: 'user', content: '有，对方现在正处于即时危险或已经准备了相关物品。' }
    ],
    safetyContext: {
      pendingSafetyCheck: true,
      safetyAnswer: 'yes',
      previousSafetyRoute: 'OTHER_PERSON_SUPPORT'
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.isCrisis, false);
  assert.equal(result.safety.target, 'other');
  assert.equal(result.safety.shouldAskSafetyCheck, false);
  assert.match(result.reply, /120/);
  assert.match(result.reply, /不要独自承担救援/);
});

test('HTTP 形态的 event 不再被解析为对话请求', async () => {
  enqueue(okBody('普通回复'));
  const result = await chat.main({
    httpMethod: 'POST',
    headers: { referer: 'http://localhost:3000/' },
    body: JSON.stringify({
      personaId: 'jianan',
      messages: [{ role: 'user', content: '我准备今晚跳楼' }]
    })
  });
  // 入口只认小程序直调的顶层字段：body 里的内容不会被解析，也不会返回 HTTP 响应壳。
  assert.equal(result.statusCode, undefined);
  assert.notEqual(result.isCrisis, true);
});

// ── emotion_label 合同用例（新增） ──────────────────────────────

test('on 模式：正常链路模型 JSON 被拆分，用户只见 reply', async () => {
  process.env.EMOTION_LABEL_MODE = 'on';
  enqueue(okBody('{"reply":"我在听，慢慢说。","emotion":"sad"}'));
  const result = await chat.main({
    personaId: 'jianan',
    messages: [{ role: 'user', content: '今天天气不错，随便聊聊' }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.reply, '我在听，慢慢说。');
  assert.equal(result.emotion.label, 'sad');
  assert.equal(result.emotion.source, 'model');
  assert.equal(result.emotion.mode, 'on');
});

test('on 模式：结构化请求体带 response_format', async () => {
  process.env.EMOTION_LABEL_MODE = 'on';
  enqueue(okBody('{"reply":"好","emotion":"calm"}'));
  await chat.main({
    personaId: 'jianan',
    messages: [{ role: 'user', content: '你好' }]
  });
  const sent = JSON.parse(lastRequestBody);
  assert.deepEqual(sent.response_format, { type: 'json_object' });
  assert.match(sent.messages[0].content, /输出协议/);
});

test('on 模式：截断 JSON 触发纯文本重试，不展示 JSON 片段', async () => {
  process.env.EMOTION_LABEL_MODE = 'on';
  enqueue(okBody('{"reply":"我在听，"emo'), okBody('plain fallback reply'));
  const result = await chat.main({
    personaId: 'jianan',
    messages: [{ role: 'user', content: '你好' }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.reply, 'plain fallback reply');
  assert.ok(!result.reply.includes('{'));
  assert.equal(result.emotion.source, 'default');
});

test('on 模式：非法 emotion 不影响 reply', async () => {
  process.env.EMOTION_LABEL_MODE = 'on';
  enqueue(okBody('{"reply":"照常回复","emotion":"crisis"}'));
  const result = await chat.main({
    personaId: 'jianan',
    messages: [{ role: 'user', content: '你好' }]
  });
  assert.equal(result.reply, '照常回复');
  assert.equal(result.emotion.source, 'default');
});

test('on 模式：低落输入走规则快通道', async () => {
  process.env.EMOTION_LABEL_MODE = 'on';
  enqueue(okBody('{"reply":"我在这儿。","emotion":"calm"}'));
  const result = await chat.main({
    personaId: 'jianan',
    messages: [{ role: 'user', content: '我今天真的很难过' }]
  });
  assert.equal(result.emotion.label, 'sad');
  assert.equal(result.emotion.source, 'rule');
});

test('on 模式：危机输入 emotion 恒为 crisis/safety', async () => {
  process.env.EMOTION_LABEL_MODE = 'on';
  const result = await chat.main({
    personaId: 'jianan',
    messages: [{ role: 'user', content: '我想死' }]
  });
  assert.equal(result.emotion.label, 'crisis');
  assert.equal(result.emotion.source, 'safety');
});

test('on 模式：模型失败回包携带 rule/default 情绪', async () => {
  process.env.EMOTION_LABEL_MODE = 'on';
  enqueue(statusBody(500, 'boom'), statusBody(500, 'boom'));
  const result = await chat.main({
    personaId: 'jianan',
    messages: [{ role: 'user', content: '你好' }]
  });
  assert.equal(result.ok, false);
  assert.ok(result.emotion);
  assert.equal(result.emotion.label, 'calm');
  assert.equal(result.emotion.source, 'default');
});

test('shadow 模式：回包带 emotion 但 source 标注 shadow', async () => {
  process.env.EMOTION_LABEL_MODE = 'shadow';
  enqueue(okBody('{"reply":"在的。","emotion":"warm"}'));
  const result = await chat.main({
    personaId: 'jianan',
    messages: [{ role: 'user', content: '谢谢你' }]
  });
  assert.ok(result.emotion);
  assert.equal(result.emotion.mode, 'shadow');
});

test('off 模式：正常链路回包不含 emotion 字段', async () => {
  process.env.EMOTION_LABEL_MODE = 'off';
  enqueue(okBody('just plain text reply'));
  const result = await chat.main({
    personaId: 'jianan',
    messages: [{ role: 'user', content: '你好' }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.reply, 'just plain text reply');
  assert.equal(result.emotion, undefined);
});

test('off 模式：确定性返回也不含 emotion', async () => {
  process.env.EMOTION_LABEL_MODE = 'off';
  const result = await chat.main({
    personaId: 'jianan',
    messages: [{ role: 'user', content: '我想死' }]
  });
  assert.equal(result.emotion, undefined);
});

test('on 模式：他人风险永不产生 crisis 情绪', async () => {
  process.env.EMOTION_LABEL_MODE = 'on';
  const result = await chat.main({
    personaId: 'jianan',
    messages: [{ role: 'user', content: '朋友说她不想活了' }]
  });
  assert.notEqual(result.emotion.label, 'crisis');
});

test('on 模式：他人情绪不取模型标签（只反映用户本人）', async () => {
  process.env.EMOTION_LABEL_MODE = 'on';
  // 模型返回 sad（模拟把朋友的情绪当成用户的），但 target=other 应丢弃模型标签
  enqueue(okBody('{"reply":"我陪你想想怎么帮她。","emotion":"sad"}'));
  const result = await chat.main({
    personaId: 'jianan',
    messages: [{ role: 'user', content: '朋友很难过，我该怎么安慰她' }]
  });
  assert.equal(result.emotion.label, 'calm');
  assert.equal(result.emotion.source, 'default');
});

test('on 模式：内容安全拦截仍带情绪', async () => {
  process.env.EMOTION_LABEL_MODE = 'on';
  safetySuggestion = 'risky';
  enqueue(okBody('blocked content'));
  const result = await chat.main({
    personaId: 'jianan',
    messages: [{ role: 'user', content: '你好' }]
  });
  assert.equal(result.blockedBySafe, true);
  assert.ok(result.emotion);
  safetySuggestion = 'pass';
});

test('OCD off 模式：不增加ocd字段且保留旧人格', async () => {
  process.env.EMOTION_LABEL_MODE = 'off';
  process.env.OCD_ROUTER_MODE = 'off';
  enqueue(okBody('legacy reply'));
  const result = await chat.main({
    personaId: 'xiaoxian',
    messages: [{ role: 'user', content: '你好' }]
  });
  assert.equal(result.ocd, undefined);
  assert.equal(result.persona, '小闲');
});

test('OCD shadow 模式：只计算合同，不改变旧system', async () => {
  process.env.EMOTION_LABEL_MODE = 'off';
  process.env.OCD_ROUTER_MODE = 'shadow';
  enqueue(okBody('shadow reply'));
  const result = await chat.main({
    personaId: 'jianan',
    messages: [{ role: 'user', content: '我又在反复确认门锁' }]
  });
  assert.equal(result.ocd.priority, 'P1');
  const sent = JSON.parse(lastRequestBody);
  assert.doesNotMatch(sent.messages[0].content, /OCD 专业路由/);
});

test('OCD on 模式：危机优先级为P0且不调用模型', async () => {
  process.env.EMOTION_LABEL_MODE = 'on';
  process.env.OCD_ROUTER_MODE = 'on';
  enqueue(okBody('should not be called'));
  const result = await chat.main({
    personaId: 'jianan',
    messages: [{ role: 'user', content: '我想死' }]
  });
  assert.equal(result.ocd.priority, 'P0');
  assert.equal(result.isCrisis, true);
  assert.equal(lastRequestBody, '');
});
