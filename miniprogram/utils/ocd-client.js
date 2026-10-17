/**
 * 调用 OCD 数据服务；统一解包与错误处理，不改变服务端的身份校验和敏感信息同意要求。
 * @param {string} action 数据接口名，例如 step.list。
 * @param {object} [payload={}] 接口参数。
 * @returns {Promise<*>} 服务端返回的 data；云能力缺失或请求失败时拒绝。
 */
function callOCD(action, payload = {}) {
  if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.reject(new Error('云能力不可用'));
  }
  return wx.cloud.callFunction({ name: 'ocd', data: { action, payload } }).then((response) => {
    const result = response && response.result;
    if (!result || result.ok === false) {
      throw new Error((result && result.errorMessage) || '云端请求失败');
    }
    return result.data;
  });
}

module.exports = { callOCD };
