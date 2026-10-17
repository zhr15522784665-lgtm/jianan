// pages/chat/chat.js
const app = getApp();
const {
  buildSafetyStatePatch,
  buildSafetyAnswerText,
  resetSafetyState,
  clampSuds
} = require('./chat-safety');
const { buildEmotionStatePatch, resetEmotionState } = require('./chat-emotion');

const WELCOME = '我在这里。无论你想说什么，都可以慢慢讲，我会认真听。';

// 心情 → 分数（用于趋势计算）
const MOOD_SCORE = { 很好: 5, 不错: 4, 一般: 3, 低落: 2, 糟糕: 1 };

// 由近 7 次打卡计算情绪趋势
function computeTrend(moods) {
  if (!moods || moods.length === 0) return null;
  const recent = moods.slice(-7);
  const scores = recent.map((m) => (MOOD_SCORE[m.mood] != null ? MOOD_SCORE[m.mood] : 3));
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  let dir = '平稳';
  if (scores.length >= 3) {
    const h = Math.floor(scores.length / 2);
    const first = scores.slice(0, h).reduce((a, b) => a + b, 0) / h;
    const second = scores.slice(h).reduce((a, b) => a + b, 0) / (scores.length - h);
    const d = second - first;
    if (d > 0.3) dir = '向好';
    else if (d < -0.3) dir = '下滑';
  }
  const level = avg >= 3.5 ? 'ok' : avg < 2.5 ? 'low' : 'mixed';
  const cnt = {};
  recent.forEach((m) => {
    cnt[m.mood] = (cnt[m.mood] || 0) + 1;
  });
  const dominant = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
  return { has: recent.length >= 2, n: recent.length, avg, dir, level, dominant };
}

// 趋势感知的开场白（替代千篇一律的欢迎语）
function trendGreeting(trend) {
  if (!trend || !trend.has) return null;
  const { level, dir } = trend;
  if (level === 'ok') {
    return dir === '向好'
      ? '看你最近状态还挺稳，而且似乎在一点点变好，真为你高兴。今天有什么想聊聊或分享的吗？'
      : '看你最近状态比较平稳，挺好的。今天想聊点什么？';
  }
  if (level === 'low') {
    return dir === '下滑'
      ? '我注意到你最近几次打卡都不太轻松，好像还有点往下走。没关系，这里可以慢慢说，我不急。'
      : '最近你似乎过得有点沉，但还在往前。想从哪件事开始聊起？';
  }
  return '看你最近的打卡起起伏伏的，辛苦了。今天想先说说哪一块？';
}

// 切换人格时附带的轻量趋势提示
function trendSuffix(trend) {
  if (!trend || !trend.has) return '';
  const map = { ok: '状态还挺稳', low: '似乎过得有点沉', mixed: '起起伏伏' };
  return `我留意到你最近心情${map[trend.level]}，想从这儿聊聊吗？`;
}

Page({
  data: {
    personas: [],
    current: null,
    messages: [],
    inputValue: '',
    sending: false,
    isCrisis: false,
    // 情绪三态（emotion_label）：faceClass ∈ calm/care/serious，危机粘性见 faceCrisisSticky
    faceClass: 'calm',
    faceCrisisSticky: false,
    emotionLabel: null,
    safetyLevel: 'none',
    safetyRoute: 'GENERAL',
    safetyTarget: 'self',
    safetyCheckVisible: false,
    pendingSafetyCheck: false,
    previousSafetyRoute: null,
    uncertaintyPauseVisible: false,
    uncertaintyPauseRunning: false,
    uncertaintyPauseCompleted: false,
    uncertaintyPauseRemaining: 120,
    uncertaintyPauseDismissed: false,
    uncertaintySudsBefore: 50,
    uncertaintySudsAfter: 50,
    hotlines: [],
    quick: ['我有点焦虑', '又忍不住反复检查', '今晚睡不着', '心情很低落', '只是想有人聊聊'],
    scrollIntoView: '',
    scrollTop: 0,
    moodEmoji: { 很好: '😊', 不错: '🙂', 一般: '😐', 低落: '😔', 糟糕: '😣' },
    lastMood: null,
    trend: null,
    ocdSubtypes: [
      { id: 'contamination', name: '污染' },
      { id: 'harm', name: '伤害' },
      { id: 'relationship', name: '关系' },
      { id: 'symmetry', name: '秩序' },
      { id: 'mixed', name: '其他' }
    ],
    ocdSubtypeHint: 'mixed',
    comorbidityCardVisible: false,
    profileCloudConsent: false
  },

  onLoad(options) {
    this._comorbidityDismissed = false;
    const personas = app.globalData.personas;
    const id = options.personaId || 'jianan';
    const current = personas.find((p) => p.id === id) || personas[0];
    const trend = computeTrend(app.getMoods());
    const welcome = trendGreeting(trend) || WELCOME;
    // 恢复该人格上次的对话（没有则从欢迎语开始）
    const history = this._loadHistory(current.id);
    this.setData({
      personas,
      current,
      // 危机卡只放全国性 24 小时热线：人处在危机里时，给 7 个选项是添乱
      hotlines: (app.globalData.hotlines || []).filter((h) => h.primary),
      trend,
      // 恢复上次没发出去的草稿
      inputValue: this._loadDraft(current.id),
      messages: history && history.length ? history : [{ role: 'ai', content: welcome }]
    });
    this._destroyed = false;
    this.scrollToBottom();
  },

  onUnload() {
    // 离开页面时收掉打字机定时器，避免残留
    if (this._twTimer) {
      clearTimeout(this._twTimer);
      this._twTimer = null;
    }
    this._clearUncertaintyTimer();
    // 标记销毁：拦截仍在途的重试/打字机回调，避免向已卸载页面 setData 告警
    this._destroyed = true;
    this._saveHistory();
  },

  // 对话历史：按人格分别存本机，冷启动 / 切换后可恢复
  _historyKey(id) {
    return `jianan_chat_${id}`;
  },

  _loadHistory(id) {
    try {
      const list = wx.getStorageSync(this._historyKey(id));
      return Array.isArray(list) && list.length ? list : null;
    } catch (e) {
      return null;
    }
  },

  _saveHistory() {
    if (!this.data.current) return;
    // 只留最近 40 条，避免无限增长
    const list = this.data.messages.slice(-40);
    try {
      wx.setStorageSync(this._historyKey(this.data.current.id), list);
    } catch (e) {}
  },

  // ---------------- 输入框草稿（按人格分别存） ----------------
  // 为什么需要：chat 是 tabBar 页，切到别的 tab 再回来不会触发 onLoad/onUnload，
  // 但页面实例的 data 在极端情况下可能被重建；更常见的是用户打字打到一半
  // 切去看别的页面，回来发现字没了。存本机是最省事的兜底。
  _draftKey(id) {
    return `jianan_draft_${id}`;
  },

  _saveDraft(value) {
    if (!this.data.current) return;
    try {
      const k = this._draftKey(this.data.current.id);
      if (value) wx.setStorageSync(k, value);
      else wx.removeStorageSync(k);
    } catch (e) {}
  },

  _loadDraft(id) {
    try {
      return wx.getStorageSync(this._draftKey(id)) || '';
    } catch (e) {
      return '';
    }
  },

  _clearDraft() {
    if (!this.data.current) return;
    try {
      wx.removeStorageSync(this._draftKey(this.data.current.id));
    } catch (e) {}
  },

  // 切换到某个人格：各自的历史独立保存，不会丢
  _switchTo(id, needConfirm) {
    const target = this.data.personas.find((p) => p.id === id);
    if (!target || target.id === this.data.current.id) return;

    const doIt = () => {
      // 切人格前收掉可能在跑的打字机定时器，避免它之后写入已被替换的消息数组
      if (this._twTimer) {
        clearTimeout(this._twTimer);
        this._twTimer = null;
      }
      this._saveHistory();
      const history = this._loadHistory(target.id);
      const messages =
        history && history.length
          ? history
          : [
              {
                role: 'ai',
                content: `我是${target.name}，${target.tag}。${trendSuffix(this.data.trend) || '想聊点什么？'}`
              }
            ];
      // 切过去时带上那个人格自己的草稿，不会串台
      this._clearUncertaintyTimer();
      this.setData(
        Object.assign(
          {
            current: target,
            messages,
            inputValue: this._loadDraft(target.id)
          },
          resetSafetyState(),
          resetEmotionState()
        )
      );
      this._saveDraft(this.data.inputValue);
      this.scrollToBottom();
    };

    // 已经聊过几句时，防手滑误触
    const talked = this.data.messages.filter((m) => m.role === 'user').length;
    if (needConfirm && talked > 0) {
      wx.showModal({
        title: '切换陪伴者',
        content: `和「${this.data.current.name}」的对话会保留，回来还能接着聊。要切换到「${target.name}」吗？`,
        confirmText: '切换',
        cancelText: '留下',
        success: (res) => {
          if (res.confirm) doIt();
        }
      });
      return;
    }
    doIt();
  },

  // 开启一段新对话（旧的清掉）
  startNewChat() {
    wx.showModal({
      title: '开启新对话',
      content: `将清空和「${this.data.current.name}」的这段聊天记录，无法恢复。`,
      confirmText: '清空并新开',
      cancelText: '再想想',
      success: (res) => {
        if (!res.confirm) return;
        this._comorbidityDismissed = false;
        if (this._twTimer) {
          clearTimeout(this._twTimer);
          this._twTimer = null;
        }
        try {
          wx.removeStorageSync(this._historyKey(this.data.current.id));
        } catch (e) {}
        this._clearDraft();
        this._clearUncertaintyTimer();
        this.setData(
          Object.assign(
            {
              messages: [{ role: 'ai', content: trendGreeting(this.data.trend) || WELCOME }],
              inputValue: ''
            },
            resetSafetyState(),
            resetEmotionState()
          )
        );
        this.scrollToBottom();
        wx.showToast({ title: '已开启新对话', icon: 'none' });
      }
    });
  },

  // 手动收起危机卡片；下一条再命中会重新出现
  dismissCrisis() {
    this.setData({ isCrisis: false });
  },

  // chat 已是 tab 页：首页选人格后通过 globalData.pendingPersona 传递
  onShow() {
    const pending = app.globalData.pendingPersona;
    // 从首页人格卡片进来 = 明确选择，不需要二次确认
    if (pending) this._switchTo(pending, false);
    // 消费掉待切换标记
    app.globalData.pendingPersona = null;

    // 联动：最近一次心情 + 近 7 次情绪趋势（打卡后回到对话也会刷新）
    const moods = app.getMoods() || [];
    const trend = computeTrend(moods);
    const lastMood = moods.length
      ? (() => {
          const last = moods[moods.length - 1];
          return {
            mood: last.mood,
            emoji: this.data.moodEmoji[last.mood] || '🌤️',
            date: last.date
          };
        })()
      : null;
    this.setData({ trend, lastMood });
  },

  // 把最近一次心情一键带入输入框
  tellMood() {
    const m = this.data.lastMood;
    if (!m) return;
    const text = `我最近一次打卡感觉「${m.mood}」，想聊聊这个。`;
    this.setData({ inputValue: text });
    wx.showToast({ title: '已带入，可修改后发送', icon: 'none' });
  },

  // 把近段情绪趋势一键带入输入框
  tellTrend() {
    const t = this.data.trend;
    if (!t) return;
    const text = `我最近 ${t.n} 次打卡，多数感觉「${t.dominant}」，整体${t.dir}，想聊聊这段时间的状态。`;
    this.setData({ inputValue: text });
    wx.showToast({ title: '已带入，可修改后发送', icon: 'none' });
  },

  selectPersona(e) {
    // 点人格胶囊 = 可能误触，聊过则先确认
    this._switchTo(e.currentTarget.dataset.id, true);
  },

  onInput(e) {
    const value = e.detail.value;
    this.setData({ inputValue: value });
    this._saveDraft(value);
  },

  // 快捷问题：直接把文本当参数传给 send()
  // ⚠️ 不能写成 setData({inputValue}) 后再无参调 send() —— setData 是异步的，
  //    send() 里读 this.data.inputValue 可能还是旧值/空值；而在 sending=true 时
  //    send() 会直接 return，导致输入框被填上了字、消息却没发出去（历史 bug）。
  tapQuick(e) {
    const text = e.currentTarget.dataset.text;
    if (this.data.sending) {
      wx.showToast({ title: '上一条还在回复中', icon: 'none' });
      return;
    }
    this.send(text);
  },

  // 发送按钮入口。WXML 的 bindtap 会把「事件对象」作为第一个参数传入，
  // 不能直接绑到 send(overrideText)——否则 String(事件对象) 会变成 "[object Object]"
  // 发出去（2026-09-20 真机踩坑）。包一层无参转发，语义清晰且杜绝后患。
  onSend() {
    this.send();
  },

  /**
   * 发送消息
   * @param {string} [overrideText] 显式指定要发送的文本（快捷问题用）。
   *        不传则取输入框当前值 —— 避免依赖 setData 的异步落地时机。
   */
  send(overrideText, options) {
    // 防御：bindtap 直连会把事件对象当参数传进来。只要不是字符串，一律当无参调用，
    // 从根上杜绝 "[object Object]" 被当成消息内容发出去。
    if (typeof overrideText !== 'string') overrideText = undefined;
    options = options && typeof options === 'object' ? options : {};
    const text = String(overrideText != null ? overrideText : this.data.inputValue || '').trim();
    if (!text) return;
    if (this.data.sending) return;

    // 防御：若上一条回复的打字机还在跑，新发送前先停掉，避免两个定时器同时写 messages
    if (this._twTimer) {
      clearTimeout(this._twTimer);
      this._twTimer = null;
    }
    // 发送即清草稿
    this._clearDraft();

    const userMessage = { role: 'user', content: text };
    if (['yes', 'unsure', 'no'].includes(options.safetyAnswer)) {
      // 只保存结构化枚举，不保存额外敏感文本。失败后点“重试”时可完整恢复安全上下文。
      userMessage._safetyAnswer = options.safetyAnswer;
    }
    const messages = this.data.messages.concat([userMessage]);
    const idx = messages.length - 1;
    this.setData({ messages, inputValue: '', sending: true });
    this._saveHistory();
    this.scrollToBottom();

    // 仅取最近 20 条，且只传 role/content 给云函数
    // 注意：本地用 'ai' 表示 AI 气泡，但 DeepSeek 只认 'assistant'，发送前统一转换
    const payload = messages
      .filter((m) => m.role === 'user' || m.role === 'ai')
      .slice(-20)
      .map((m) => ({ role: m.role === 'ai' ? 'assistant' : m.role, content: m.content }));

    const safetyContext = {
      pendingSafetyCheck: this.data.pendingSafetyCheck === true,
      safetyAnswer: options.safetyAnswer || null,
      previousSafetyRoute: this.data.previousSafetyRoute || null
    };

    this._callChat(payload, idx, 1, safetyContext);
  },

  // 调用云函数；失败先自动重试一次（弱网抖动），仍失败则插入本地离线陪伴回复，
  // 让对话页永远不会出现「一片报错」的坏体验，同时把用户那条消息标记为可重试。
  _callChat(payload, idx, attempt, safetyContext) {
    // 云能力未就绪时（真机上基础库过低 / 未开通云开发）直接给明确指引，
    // 而不是笼统地报「网络异常」——那会让人以为是手机网络问题，白白排查半天。
    if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      this._onChatFailed(idx, '（当前微信版本不支持云能力，请更新微信到最新版后重试。）');
      wx.showToast({ title: '请更新微信版本', icon: 'none' });
      return;
    }
    // 并发闸门：同一时刻只允许一条在途请求。重试用 setTimeout(1200ms) 排队，
    // 期间用户点「重试」会再进一次 _callChat —— 没有这道闸门就会把同一个问题发 2-3 次、
    // AI 也回 2-3 条，既烧额度又让用户以为程序坏了。用令牌保证「只有当前这次」有效。
    const ticket = (this._chatTicket || 0) + 1;
    this._chatTicket = ticket;
    wx.cloud
      .callFunction({
        name: 'chat',
        data: {
          personaId: this.data.current.id,
          messages: payload,
          safetyContext: Object.assign({}, safetyContext || {}, {
            ocdHint: this.data.ocdSubtypeHint || null
          })
        }
      })
      .then((res) => {
        // 已被更新的一次调用（用户重试 / 换了会话）取代，丢弃这个迟到的响应
        if (this._destroyed || ticket !== this._chatTicket) return;
        const r = res.result || {};
        if (r.ok === false) {
          const detail = r.error ? String(r.error).slice(0, 80) : '云端返回异常';
          if (attempt < 2) {
            setTimeout(() => this._callChat(payload, idx, attempt + 1, safetyContext), 1200);
            return;
          }
          // 失败回包也带 emotion（服务端已实现）：更新表情，避免沿用上一轮造成情绪误读
          this.setData(buildEmotionStatePatch(this.data, r, { isCrisis: this.data.isCrisis }));
          wx.showModal({
            title: '云端没能接住这条',
            content: detail + '\n\n可截图这段信息反馈。点「重试」可再试一次。',
            showCancel: false,
            confirmText: '知道了'
          });
          this._onChatFailed(idx, '（云端暂时没接住这条，点「重试」我们再试一次。）');
          return;
        }
        const assistantIdx = this.data.messages.length;
        const safetyPatch = buildSafetyStatePatch(this.data, r);
        const ocd = r.ocd && r.ocd.mode === 'on' ? r.ocd : null;
        const comorbidityCardVisible = Boolean(
          ocd &&
            ocd.comorbidity &&
            ocd.comorbidity.suggestProfessional &&
            !this._comorbidityDismissed
        );
        // 情绪与安全在同一次 setData 中落地，避免表情闪回 calm（审核修订第 6 条）
        const emotionPatch = buildEmotionStatePatch(this.data, r, safetyPatch);
        if (!safetyPatch.uncertaintyPauseRunning) this._clearUncertaintyTimer();
        this.setData(
          Object.assign(
            {
              messages: this.data.messages.concat([{ role: 'ai', content: '' }]),
              sending: false,
              ocdSubtypeHint: ocd && ocd.subtype ? ocd.subtype : this.data.ocdSubtypeHint,
              comorbidityCardVisible
            },
            safetyPatch,
            emotionPatch
          )
        );
        this._saveHistory();
        this.scrollToBottom();
        this._typewriter(assistantIdx, r.reply || '（暂无回复）');
      })
      .catch((err) => {
        if (this._destroyed || ticket !== this._chatTicket) return;
        console.error('[chat] 云函数调用失败：', err);
        if (attempt < 2) {
          setTimeout(() => this._callChat(payload, idx, attempt + 1, safetyContext), 1200);
          return;
        }
        // 把云函数的真实错误码/原因摊开给用户看，而不是笼统说「网络异常」。
        //
        // 判定顺序有讲究，必须「先具体后笼统」：
        // -501000 的完整文案是 `Environment not found`，它同时命中 `not found` 和 `environment`。
        // 如果先判 `not found`，就会被误报成「云函数没部署」——而这两件事的排查方向完全相反：
        // 前者要在开发者工具里开通/绑定云环境，后者才要重新部署函数。判错会让人白折腾一轮。
        const em = (err && (err.errMsg || err.message)) || '未知错误';
        // 从 globalData 取环境 ID（app.js 的 CLOUD_ENV），避免提示文案里的 ID 和真实配置漂移
        const envId = (app.globalData && app.globalData.cloudEnv) || '（未配置）';
        const hint = /-501000|environment not found/i.test(em)
          ? '小程序里写的云环境 ID 在云端找不到。请确认开发者工具「云开发」已开通、且环境 ID 与 app.js 中的一致（当前：' +
            envId +
            '）。'
          : /-404011|-404012|functionname parameter|函数不存在/i.test(em)
            ? '云函数 chat 没找到，可能没部署成功。请在开发者工具里右键 cloudfunctions/chat 文件夹，选「上传并部署：云端安装依赖」。'
            : /\bnot found\b/i.test(em)
              ? '云函数 chat 没找到，可能没部署成功。请在开发者工具里右键 cloudfunctions/chat 文件夹，选「上传并部署：云端安装依赖」。'
              : '连不上云端。可先检查手机网络，再确认开发者工具「云开发」是否已开通。';
        wx.showModal({
          title: '连接不上云端',
          content: hint + '\n\n错误信息：' + String(em).slice(0, 120),
          showCancel: false,
          confirmText: '知道了'
        });
        this._onChatFailed(
          idx,
          '（这会儿连不上云端了，但我在。你刚才说的我记下了——先做个慢呼吸，等网络好了点「重试」就能继续。）'
        );
      });
  },

  selectOcdSubtype(e) {
    const id = e.currentTarget.dataset.id;
    if (!this.data.ocdSubtypes.some((item) => item.id === id)) return;
    this.setData({ ocdSubtypeHint: id });
    if (this.data.profileCloudConsent) {
      this._saveOcdProfile(id);
      return;
    }
    wx.showModal({
      title: '保存当前困扰',
      content: '当前困扰属于敏感健康信息。是否同意将你选择的标签保存到云端，用于后续练习和对话？',
      confirmText: '同意保存',
      cancelText: '仅本次使用',
      success: (result) => {
        if (result.confirm) {
          this.setData({ profileCloudConsent: true });
          this._saveOcdProfile(id);
        }
      }
    });
  },

  _saveOcdProfile(id) {
    if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') return;
    wx.cloud
      .callFunction({
        name: 'ocd',
        data: {
          action: 'profile.save',
          payload: {
            subtypes: [id],
            primaryObsession: '',
            compulsions: [],
            avoidance: [],
            onsetBand: '',
            sensitiveConsent: true
          }
        }
      })
      .then((res) => {
        if (!res.result || res.result.ok !== true) throw new Error('profile save failed');
      })
      .catch(() => {
        this.setData({ profileCloudConsent: false });
        wx.showToast({ title: '标签未保存，点击可重试', icon: 'none' });
      });
  },

  dismissComorbidityCard() {
    this._comorbidityDismissed = true;
    this.setData({ comorbidityCardVisible: false });
  },

  // 云端不可达时的兜底：保留用户原话可重试，并补一句本地离线陪伴，避免空白报错
  _onChatFailed(idx, offlineText) {
    this.setData({ [`messages[${idx}].failed`]: true, sending: false });
    const assistantIdx = this.data.messages.length;
    this.setData({ messages: this.data.messages.concat([{ role: 'ai', content: '' }]) });
    this._saveHistory();
    this.scrollToBottom();
    this._typewriter(assistantIdx, offlineText);
  },

  // 拿到完整回复后逐字渲染，营造流式观感；节流写入避免频繁 setData 造成卡顿
  // （参考官方 wx.cloud.extend.AI 流式渲染的节流思路）
  //
  // 步长按文本长度自适应：原先固定「2 字 / 30ms」，长回复会「假死」——
  // 800 字要 12 秒才渲染完，最后一大段迟迟不出现，用户会以为卡住了。
  // 现在保证整段在 3 秒内走完（超过上限时按 4 字/帧兜底，避免步长太碎反而卡）。
  _typewriter(idx, full) {
    if (!full) return;
    const total = full.length;
    const TARGET_MS = 3000;
    const INTERVAL = 30;
    const frames = Math.max(1, Math.ceil(TARGET_MS / INTERVAL));
    const step = Math.max(1, Math.min(12, Math.ceil(total / frames)));

    let i = 0;
    const tick = () => {
      if (this._destroyed) return;
      i = Math.min(total, i + step);
      this.setData({ [`messages[${idx}].content`]: full.slice(0, i) });
      this.scrollToBottom();
      if (i < total) {
        this._twTimer = setTimeout(tick, INTERVAL);
      } else {
        this._saveHistory();
      }
    };
    tick();
  },

  // 重发：截掉这条及其之后的内容，把原文放回输入框再发一次
  retrySend(e) {
    const i = Number(e.currentTarget.dataset.i);
    const msg = this.data.messages[i];
    if (!msg || msg.role !== 'user') return;
    // 正在回复中就不允许重发：否则会打断在途的请求，叠出重复消息
    if (this.data.sending) {
      wx.showToast({ title: '上一条还在回复中', icon: 'none' });
      return;
    }
    // 打字机动画还在跑，先停掉并补全内容，避免旧动画往新数组的同一个下标里写内容，
    // 出现「上一条回复串到新气泡里」的错位。
    if (this._twTimer) {
      clearTimeout(this._twTimer);
      this._twTimer = null;
    }
    const messages = this.data.messages.slice(0, i);
    const retryOptions = ['yes', 'unsure', 'no'].includes(msg._safetyAnswer)
      ? { safetyAnswer: msg._safetyAnswer }
      : undefined;
    this.setData({ messages, inputValue: '', sending: false });
    this._saveHistory();
    // 显式传原文，避免 setData 尚未落地时从 inputValue 读到旧值或空值。
    this.send(msg.content, retryOptions);
  },

  onSafetyAnswer(e) {
    if (this.data.sending) return;
    const answer = e.currentTarget.dataset.answer;
    if (!['yes', 'unsure', 'no'].includes(answer)) return;
    const text = buildSafetyAnswerText(answer, this.data.safetyTarget);
    this.setData({ safetyCheckVisible: false });
    this.send(text, { safetyAnswer: answer });
  },

  onSudsBeforeChange(e) {
    this.setData({ uncertaintySudsBefore: clampSuds(e.detail.value) });
  },

  onSudsAfterChange(e) {
    this.setData({ uncertaintySudsAfter: clampSuds(e.detail.value) });
  },

  startUncertaintyPause() {
    if (this.data.uncertaintyPauseRunning) return;
    this._clearUncertaintyTimer();
    this._uncertaintyStartedAt = Date.now();
    this.setData({
      uncertaintyPauseRunning: true,
      uncertaintyPauseCompleted: false,
      uncertaintyPauseRemaining: 120
    });
    this._tickUncertaintyPause();
  },

  _tickUncertaintyPause() {
    if (this._destroyed || !this.data.uncertaintyPauseRunning) return;
    const elapsed = Math.floor((Date.now() - this._uncertaintyStartedAt) / 1000);
    const remaining = Math.max(0, 120 - elapsed);
    this.setData({ uncertaintyPauseRemaining: remaining });
    if (remaining <= 0) {
      this._clearUncertaintyTimer();
      this.setData({
        uncertaintyPauseRunning: false,
        uncertaintyPauseCompleted: true,
        uncertaintyPauseRemaining: 0,
        uncertaintySudsAfter: this.data.uncertaintySudsBefore
      });
      return;
    }
    this._uncertaintyTimer = setTimeout(() => this._tickUncertaintyPause(), 250);
  },

  _clearUncertaintyTimer() {
    if (this._uncertaintyTimer) {
      clearTimeout(this._uncertaintyTimer);
      this._uncertaintyTimer = null;
    }
  },

  cancelUncertaintyPause() {
    this._clearUncertaintyTimer();
    this._saveUncertaintyPause(false);
    this.setData({
      uncertaintyPauseVisible: false,
      uncertaintyPauseRunning: false,
      uncertaintyPauseCompleted: false,
      uncertaintyPauseRemaining: 120,
      uncertaintyPauseDismissed: true
    });
  },

  completeUncertaintyPause() {
    this._clearUncertaintyTimer();
    this._saveUncertaintyPause(true);
    this.setData({
      uncertaintyPauseVisible: false,
      uncertaintyPauseRunning: false,
      uncertaintyPauseCompleted: false,
      uncertaintyPauseRemaining: 120
    });
    wx.showToast({ title: '已记录这次变化', icon: 'none' });
  },

  repeatUncertaintyPause() {
    const nextBefore = clampSuds(this.data.uncertaintySudsAfter);
    this.setData({
      uncertaintySudsBefore: nextBefore,
      uncertaintyPauseCompleted: false,
      uncertaintyPauseRemaining: 120
    });
    this.startUncertaintyPause();
  },

  _saveUncertaintyPause(completed) {
    const record = {
      at: new Date().toISOString(),
      personaId: this.data.current ? this.data.current.id : '',
      durationSeconds: completed
        ? 120
        : Math.max(0, 120 - Number(this.data.uncertaintyPauseRemaining || 0)),
      completed: completed === true,
      sudsBefore: clampSuds(this.data.uncertaintySudsBefore),
      sudsAfter: completed ? clampSuds(this.data.uncertaintySudsAfter) : null
    };
    try {
      const key = 'jianan_uncertainty_pauses';
      const old = wx.getStorageSync(key);
      const list = Array.isArray(old) ? old : [];
      wx.setStorageSync(key, list.concat([record]).slice(-50));
    } catch (e) {}
  },

  callHotline(e) {
    const tel = e.currentTarget.dataset.tel;
    wx.makePhoneCall({ phoneNumber: app.formatTel(tel), fail() {} });
  },

  // 长按复制号码：部分设备无法直接拨号时的兜底
  copyTel(e) {
    const tel = e.currentTarget.dataset.tel;
    if (!tel) return;
    wx.setClipboardData({
      data: tel,
      success() {
        wx.showToast({ title: '号码已复制', icon: 'none' });
      }
    });
  },

  // 危机卡只放 2 条全国热线，其余在「关于」页（tab 页，只能 switchTab）
  goHotlines() {
    wx.navigateTo({ url: '/pages/hotlines/hotlines' });
  },

  goMindspace() {
    wx.switchTab({ url: '/pages/mindspace/mindspace' });
  },

  goSafety() {
    wx.navigateTo({ url: '/pages/safety/safety' });
  },

  scrollToBottom() {
    // 用 scroll-top 持续累加一个足够大的值来强制定位到底部：
    // 比 scroll-into-view 更可靠——后者在目标 id 不变时不会重复触发，
    // 导致流式输出过程中视图停在顶部、不跟随最新内容。
    this.setData({ scrollTop: this.data.scrollTop + 100000 });
  }
});
