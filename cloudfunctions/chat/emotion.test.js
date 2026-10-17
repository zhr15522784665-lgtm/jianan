'use strict';

// app/chat/emotion.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { LABELS, classifyRule, normalizeModelEmotion, finalizeEmotion } = require('./emotion');

// ── 每标签两个正例 ─────────────────────────────────────────────
test('sad：两个正例', () => {
  assert.equal(classifyRule('我今天真的很难过'), 'sad');
  assert.equal(classifyRule('说着说着我就哭了'), 'sad');
});

test('anxious：两个正例', () => {
  assert.equal(classifyRule('我最近好焦虑'), 'anxious');
  assert.equal(classifyRule('我每天晚上都睡不着'), 'anxious');
});

test('angry：两个正例', () => {
  assert.equal(classifyRule('我烦死了'), 'angry');
  assert.equal(classifyRule('我真的好生气'), 'angry');
});

test('tired：两个正例', () => {
  assert.equal(classifyRule('我好累'), 'tired');
  assert.equal(classifyRule('我整个人都麻木了'), 'tired');
});

test('warm：两个正例', () => {
  assert.equal(classifyRule('谢谢你陪我说话'), 'warm');
  assert.equal(classifyRule('我真的很感动'), 'warm');
});

// ── 每标签一个反例（不得命中） ─────────────────────────────────
test('反例：无第一人称锚点的描述不命中', () => {
  assert.equal(classifyRule('今天天气不错'), null);
  assert.equal(classifyRule('这部电影真让人难过'), null);
  assert.equal(classifyRule('加班文化真累人'), null);
});

// ── 否定句不命中 ───────────────────────────────────────────────
test('否定语境不命中', () => {
  assert.equal(classifyRule('我不焦虑了'), null);
  assert.equal(classifyRule('我没那么难过了'), null);
  assert.equal(classifyRule('我已经不生气了'), null);
  assert.equal(classifyRule('没什么好累的'), null);
});

// ── 科普问题不命中 ─────────────────────────────────────────────
test('科普问句返回 null', () => {
  assert.equal(classifyRule('抑郁是什么意思'), null);
  assert.equal(classifyRule('焦虑和恐惧有什么区别'), null);
  assert.equal(classifyRule('科普一下强迫症'), null);
});

// ── 他人情绪不当作用户情绪 ─────────────────────────────────────
test('第三人称描述不命中', () => {
  assert.equal(classifyRule('朋友很难过'), null);
  assert.equal(classifyRule('我室友说她压力很大'), null);
  assert.equal(classifyRule('我妈生气了'), null);
});

// ── 模型标签归一化 ─────────────────────────────────────────────
test('normalizeModelEmotion：大小写与空白归一', () => {
  assert.equal(normalizeModelEmotion('SAD'), 'sad');
  assert.equal(normalizeModelEmotion(' Anxious '), 'anxious');
});

test('normalizeModelEmotion：非法值与 crisis 一律拒绝', () => {
  assert.equal(normalizeModelEmotion('crisis'), null);
  assert.equal(normalizeModelEmotion('happy'), null);
  assert.equal(normalizeModelEmotion(''), null);
  assert.equal(normalizeModelEmotion(undefined), null);
});

// ── 第三人称转述不误判（v1.1 修复） ───────────────────────────
test('句首「谢谢你」命中 warm', () => {
  assert.equal(classifyRule('谢谢你陪我说话'), 'warm');
  assert.equal(classifyRule('今天聊得挺好。真的谢谢你'), 'warm');
});

test('他人转述「他说谢谢你」不命中 warm', () => {
  assert.equal(classifyRule('他说谢谢你帮了他'), null);
  assert.equal(classifyRule('朋友让我跟你说感谢你'), null);
});

// ── 安全层覆盖 ─────────────────────────────────────────────────
test('finalizeEmotion：危机卡覆盖一切候选', () => {
  const r = finalizeEmotion(
    { label: 'warm', source: 'rule' },
    { shouldShowCrisisCard: true },
    'on'
  );
  assert.deepEqual(r, { label: 'crisis', source: 'safety', mode: 'on' });
});

test('finalizeEmotion：非危机透传播候选与 mode', () => {
  const r = finalizeEmotion(
    { label: 'sad', source: 'model' },
    { shouldShowCrisisCard: false },
    'shadow'
  );
  assert.deepEqual(r, { label: 'sad', source: 'model', mode: 'shadow' });
});

test('finalizeEmotion：无候选回落 calm/default', () => {
  const r = finalizeEmotion(null, { shouldShowCrisisCard: false }, 'on');
  assert.deepEqual(r, { label: 'calm', source: 'default', mode: 'on' });
});

test('LABELS 恰好六个非危机标签', () => {
  assert.equal(LABELS.length, 6);
  assert.ok(!LABELS.includes('crisis'));
});

test('超长文本按 2000 字截断不抛错', () => {
  const long = '我今天好累'.repeat(500);
  assert.equal(classifyRule(long), 'tired');
  assert.equal(classifyRule('x'.repeat(3000) + '我很难过'), null); // 超出部分不参与
});
