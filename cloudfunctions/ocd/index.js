'use strict';
const cloud = require('wx-server-sdk');
const logic = require('./logic');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const COLLECTIONS = ['ocd_profiles', 'ocd_logs', 'exposure_steps', 'ocd_assessments'];
const ensured = new Set();
/**
 * 尝试创建数据集合；仅缓存成功或已存在的集合，不配置客户端权限。
 * @param {object} db 微信云数据库实例。
 * @returns {Promise<void>} 集合创建尝试结束；部分失败会记录告警。
 */
async function ensure(db) {
  for (const name of COLLECTIONS) {
    if (ensured.has(name)) continue;
    try {
      await db.createCollection(name);
      ensured.add(name);
    } catch (error) {
      // 创建失败不阻断；实际读写仍会报告权限/集合不存在问题。绝不声称已设置安全规则。
      if (/exist|已存在/i.test(String(error.errMsg || error.message))) ensured.add(name);
      else
        console.warn('[ocd] collection provisioning pending', {
          collection: name,
          code: error.code || 'UNKNOWN'
        });
    }
  }
}
/**
 * 创建始终由可信 openid 限定的数据查询。
 * @param {object} db 微信云数据库实例。
 * @param {string} name 集合名称。
 * @param {string} openid 来自微信上下文的可信用户标识。
 * @param {object} [extra] 附加查询条件；不能覆盖身份隔离。
 * @returns {object} 已限定 _openid 的查询。
 */
function query(db, name, openid, extra = {}) {
  return db.collection(name).where(Object.assign({}, extra, { _openid: openid }));
}
/**
 * 按稳定双字段顺序分页读取当前用户的全部匹配记录。
 * @param {object} db 微信云数据库实例。
 * @param {string} name 集合名称。
 * @param {string} openid 来自微信上下文的可信用户标识。
 * @param {object} [extra] 附加查询条件；不能覆盖身份隔离。
 * @param {string} [sort] 主排序字段。
 * @param {string} [direction] 主排序方向 asc 或 desc。
 * @returns {Promise<Array<object>>} 全部匹配记录。
 */
async function all(db, name, openid, extra = {}, sort = 'created_at', direction = 'desc') {
  const items = [];
  let offset = 0;
  while (true) {
    const result = await query(db, name, openid, extra)
      .orderBy(sort, direction)
      .orderBy('_id', 'asc')
      .skip(offset)
      .limit(100)
      .get();
    items.push(...result.data);
    if (result.data.length < 100) return items;
    offset += 100;
  }
}
/**
 * 校验分页条数并应用默认值。
 * @param {*} value 待校验的外部输入。
 * @param {number} fallback 参数缺失时采用的默认数值。
 * @param {number} max 允许的最大值（含）。
 * @returns {number} 合法的分页条数。
 */
function limit(value, fallback, max) {
  return logic.number(value, 'limit', 1, max, fallback, true);
}
/**
 * 分发数据操作；调用方必须先验证微信身份。
 * @param {object} db 微信云数据库实例。
 * @param {string} openid 来自微信上下文的可信用户标识。
 * @param {string} action 数据接口操作名。
 * @param {object} [p] 已经过请求外形检查的操作参数。
 * @returns {Promise<*>} 操作结果；无效参数或越权更新会抛错。
 */
async function dispatch(db, openid, action, p = {}) {
  const stamp = () => db.serverDate();
  const add = async (name, data, id) => {
    const record = Object.assign({}, data, { _openid: openid, created_at: stamp() });
    if (id) {
      await db.collection(name).doc(id).set({ data: record });
      return Object.assign({}, record, { _id: id });
    }
    const result = await db.collection(name).add({ data: record });
    return Object.assign({}, record, { _id: result._id });
  };
  if (action === 'profile.get') {
    const result = await query(db, 'ocd_profiles', openid).limit(1).get();
    return (
      result.data[0] || {
        subtypes: [],
        primaryObsession: '',
        compulsions: [],
        avoidance: [],
        onsetBand: ''
      }
    );
  }
  if (action === 'profile.save') {
    const data = logic.profile(p);
    // 稳定文档ID避免并发首存产生重复档案；所有读写仍携带 _openid。
    const id = require('crypto')
      .createHash('sha256')
      .update('profile:' + openid)
      .digest('hex');
    const existing = await query(db, 'ocd_profiles', openid, { _id: id }).limit(1).get();
    if (existing.data.length) {
      const previous = existing.data[0];
      const merged = {
        subtypes: data.subtypes.length ? data.subtypes : previous.subtypes || [],
        primaryObsession: data.primaryObsession || previous.primaryObsession || '',
        compulsions: data.compulsions.length ? data.compulsions : previous.compulsions || [],
        avoidance: data.avoidance.length ? data.avoidance : previous.avoidance || [],
        onsetBand: data.onsetBand || previous.onsetBand || '',
        sensitiveConsent: true,
        updated_at: stamp()
      };
      await query(db, 'ocd_profiles', openid, { _id: id }).update({ data: merged });
      return Object.assign({}, previous, merged);
    }
    return add('ocd_profiles', Object.assign(data, { updated_at: stamp() }), id);
  }
  if (action === 'log.add') {
    const data = logic.log(p);
    if (data.practiceId) {
      const existing = await query(db, 'ocd_logs', openid, { practiceId: data.practiceId })
        .limit(1)
        .get();
      if (existing.data.length) return existing.data[0];
      const id = require('crypto')
        .createHash('sha256')
        .update(openid + ':' + data.practiceId)
        .digest('hex');
      return add('ocd_logs', data, id);
    }
    return add('ocd_logs', data);
  }
  if (action === 'log.list') {
    const size = limit(p.limit, 20, 100);
    const extra = {};
    if (p.stepId != null) extra.stepId = logic.text(p.stepId, 'stepId', true);
    if (p.before) {
      const cursor = p.before;
      if (
        !cursor ||
        typeof cursor !== 'object' ||
        !Number.isFinite(new Date(cursor.at).getTime()) ||
        typeof cursor.id !== 'string'
      )
        logic.invalid('before须为服务器返回的分页游标');
      const time = new Date(cursor.at);
      extra.$or = [
        { created_at: db.command.lt(time) },
        { created_at: db.command.eq(time), _id: db.command.gt(cursor.id) }
      ];
    }
    const result = await query(db, 'ocd_logs', openid, extra)
      .orderBy('created_at', 'desc')
      .orderBy('_id', 'asc')
      .limit(size + 1)
      .get();
    const items = result.data.slice(0, size);
    const last = items[items.length - 1];
    return {
      items,
      hasMore: result.data.length > size,
      nextBefore: last ? { at: last.created_at, id: last._id } : null
    };
  }
  if (action === 'log.stats') {
    const days = logic.number(p.days, 'days', 1, 90, 7, true);
    return logic.stats(
      await all(db, 'ocd_logs', openid, {
        created_at: db.command.gte(new Date(Date.now() - days * 86400000))
      }),
      days
    );
  }
  if (action === 'step.add')
    return add('exposure_steps', Object.assign(logic.step(p), { updated_at: stamp() }));
  if (action === 'step.list') {
    const extra = {};
    if (p.status) {
      if (!['not_started', 'in_progress', 'completed'].includes(p.status))
        logic.invalid('status无效');
      extra.status = p.status;
    }
    return all(db, 'exposure_steps', openid, extra, 'level', 'asc');
  }
  if (action === 'step.update') {
    const id = logic.text(p.id, 'id', true);
    const data = { updated_at: stamp() };
    if (p.status != null) {
      if (!['not_started', 'in_progress', 'completed'].includes(p.status))
        logic.invalid('status无效');
      data.status = p.status;
    }
    if (p.lastSuds != null) data.lastSuds = logic.number(p.lastSuds, 'lastSuds', 0, 100);
    if (p.attemptsDelta != null)
      data.attempts = db.command.inc(
        logic.number(p.attemptsDelta, 'attemptsDelta', 0, 100, 0, true)
      );
    if (p.practiceId) {
      const practiceId = logic.text(p.practiceId, 'practiceId', true);
      data.lastPracticeId = practiceId;
      const result = await query(db, 'exposure_steps', openid, {
        _id: id,
        lastPracticeId: db.command.nin([practiceId])
      }).update({ data });
      if (result.stats.updated) return { updated: result.stats.updated };
      const found = await query(db, 'exposure_steps', openid, { _id: id }).limit(1).get();
      if (found.data.length) return { updated: 0, alreadySaved: true };
      const error = new Error('阶梯不存在或不属于当前用户');
      error.code = 'NOT_FOUND';
      throw error;
    }
    const result = await query(db, 'exposure_steps', openid, { _id: id }).update({ data });
    if (!result.stats.updated) {
      const e = new Error('阶梯不存在或不属于当前用户');
      e.code = 'NOT_FOUND';
      throw e;
    }
    return { updated: result.stats.updated };
  }
  if (action === 'assess.submit') {
    const id = p.submissionId
      ? require('crypto')
          .createHash('sha256')
          .update(openid + ':assess:' + logic.text(p.submissionId, 'submissionId', true))
          .digest('hex')
      : undefined;
    return add('ocd_assessments', logic.assess(p), id);
  }
  if (action === 'assess.history')
    return (
      await query(db, 'ocd_assessments', openid)
        .orderBy('created_at', 'desc')
        .limit(limit(p.limit, 10, 50))
        .get()
    ).data;
  if (action === 'privacy.deleteMine') {
    if (p.confirmation !== 'DELETE_MY_OCD_DATA') logic.invalid('请先明确确认删除云端自助记录');
    const deleted = {};
    for (const name of COLLECTIONS) {
      const result = await query(db, name, openid).remove();
      deleted[name] = result.stats.removed;
    }
    return { deleted };
  }
  logic.invalid('不支持的action');
}
/**
 * 包装数据服务的 HTTP JSON 响应。
 * @param {number} statusCode HTTP 状态码。
 * @param {*} body 待编码的响应体。
 * @returns {object} 含状态码、CORS 头和 JSON 字符串的响应。
 */
function cors(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    },
    body: JSON.stringify(body)
  };
}
exports.main = async (event) => {
  const http = !!(event && event.httpMethod);
  if (http && event.httpMethod === 'OPTIONS') return cors(204, {});
  if (http && event.httpMethod !== 'POST')
    return cors(405, { ok: false, errorCode: 'METHOD_NOT_ALLOWED', errorMessage: '仅支持POST' });
  let input = event || {};
  try {
    if (http) {
      try {
        input = JSON.parse(event.body || '{}');
      } catch (e) {
        const error = new Error('JSON格式不正确');
        error.code = 'BAD_JSON';
        throw error;
      }
    }
    const openid = cloud.getWXContext().OPENID;
    if (!openid) {
      const error = new Error('未取得可信微信身份；请从小程序调用');
      error.code = 'UNAUTHENTICATED';
      throw error;
    }
    if (
      !input ||
      typeof input !== 'object' ||
      (input.payload != null && (typeof input.payload !== 'object' || Array.isArray(input.payload)))
    )
      logic.invalid('请求格式不正确');
    const db = cloud.database();
    await ensure(db);
    const result = {
      ok: true,
      data: await dispatch(db, openid, input.action, input.payload || {})
    };
    return http ? cors(200, result) : result;
  } catch (error) {
    const code = error.code || 'DATA_ERROR';
    const message = ['VALIDATION_ERROR', 'BAD_JSON', 'UNAUTHENTICATED', 'NOT_FOUND'].includes(code)
      ? error.message
      : '数据服务暂不可用，请重试';
    const result = { ok: false, errorCode: code, errorMessage: message };
    return http ? cors(code === 'UNAUTHENTICATED' ? 401 : 400, result) : result;
  }
};
exports._test = { dispatch, query, all };
