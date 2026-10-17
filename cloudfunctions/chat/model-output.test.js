'use strict';

// app/chat/model-output.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STRUCTURED_OUTPUT_INSTRUCTION,
  buildStructuredSystem,
  parseProviderResponse,
  parseAssistantContent
} = require('./model-output');

// ── 合法 JSON ─────────────────────────────────────────────────
test('合法 JSON：拆出 reply 与 emotion', () => {
  const r = parseAssistantContent('{"reply":"我在这儿，慢慢说。","emotion":"sad"}', true);
  assert.equal(r.content, '我在这儿，慢慢说。');
  assert.equal(r.emotion, 'sad');
  assert.equal(r.parseStatus, 'json_ok');
});

// ── 代码围栏 ──────────────────────────────────────────────────
test('```json 围栏：正确剥离', () => {
  const r = parseAssistantContent('```json\n{"reply":"好","emotion":"calm"}\n```', true);
  assert.equal(r.content, '好');
  assert.equal(r.emotion, 'calm');
  assert.equal(r.parseStatus, 'json_ok');
});

test('无语言标记围栏：正确剥离', () => {
  const r = parseAssistantContent('```\n{"reply":"好","emotion":"warm"}\n```', true);
  assert.equal(r.parseStatus, 'json_ok');
  assert.equal(r.emotion, 'warm');
});

// ── 合法 reply + 非法 emotion ─────────────────────────────────
test('非法 emotion：保留 reply，parseStatus 为 invalid_emotion', () => {
  const r = parseAssistantContent('{"reply":"我在听","emotion":"crisis"}', true);
  assert.equal(r.content, '我在听');
  assert.equal(r.emotion, null);
  assert.equal(r.parseStatus, 'invalid_emotion');
});

// ── 普通纯文本 ────────────────────────────────────────────────
test('普通纯文本：放行，情绪交规则通道', () => {
  const r = parseAssistantContent('今天想聊点什么？', true);
  assert.equal(r.content, '今天想聊点什么？');
  assert.equal(r.emotion, null);
  assert.equal(r.parseStatus, 'plain_text');
});

// ── 截断 JSON ─────────────────────────────────────────────────
test('截断 JSON：malformed_json 且不暴露原文', () => {
  const r = parseAssistantContent('{"reply":"我在听，"emo', true);
  assert.equal(r.content, '');
  assert.equal(r.parseStatus, 'malformed_json');
});

test('缺 reply 字段的 JSON：malformed_json', () => {
  const r = parseAssistantContent('{"emotion":"sad"}', true);
  assert.equal(r.parseStatus, 'malformed_json');
});

test('reply 为空白字符串：malformed_json', () => {
  const r = parseAssistantContent('{"reply":"   ","emotion":"sad"}', true);
  assert.equal(r.parseStatus, 'malformed_json');
});

// ── 空正文 ────────────────────────────────────────────────────
test('空正文：parseStatus 为 empty', () => {
  assert.equal(parseAssistantContent('', true).parseStatus, 'empty');
  assert.equal(parseAssistantContent(null, true).parseStatus, 'empty');
  assert.equal(parseAssistantContent(undefined, false).parseStatus, 'empty');
});

// ── 上游响应解析 ──────────────────────────────────────────────
test('parseProviderResponse：正常响应', () => {
  const body = JSON.stringify({
    choices: [{ message: { content: 'hello' } }]
  });
  assert.deepEqual(parseProviderResponse(body), { content: 'hello' });
});

test('parseProviderResponse：非 JSON 上游', () => {
  const r = parseProviderResponse('<html>502</html>');
  assert.ok(r.err.includes('返回非 JSON'));
});

test('parseProviderResponse：reasoning-only 诊断', () => {
  const body = JSON.stringify({
    choices: [{ message: { content: '', reasoning_content: 'thinking...' } }]
  });
  const r = parseProviderResponse(body);
  assert.equal(r.reasoningOnly, true);
  assert.ok(r.err.includes('思考'));
});

test('parseProviderResponse：空 content 无 reasoning', () => {
  const body = JSON.stringify({ choices: [{ message: { content: '' } }] });
  const r = parseProviderResponse(body);
  assert.equal(r.empty, true);
});

// ── 结构化指令 ────────────────────────────────────────────────
test('buildStructuredSystem：原样拼接且含协议', () => {
  const s = buildStructuredSystem('你是见岸');
  assert.ok(s.startsWith('你是见岸'));
  assert.ok(s.includes(STRUCTURED_OUTPUT_INSTRUCTION));
  assert.ok(s.includes('calm/sad/anxious/angry/tired/warm'));
});
