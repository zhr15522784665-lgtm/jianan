// pages/breathe/breathe.js
// 可切换节奏：盒式呼吸 4-4-4-4 / 助眠呼吸 4-7-8
Page({
  data: {
    patterns: [
      {
        key: 'box',
        label: '盒式 4-4-4-4',
        desc: '平稳放松',
        phases: [
          { key: 'inhale', label: '吸气', dur: 4 },
          { key: 'hold', label: '屏息', dur: 4 },
          { key: 'exhale', label: '呼气', dur: 4 },
          { key: 'hold2', label: '屏息', dur: 4 }
        ]
      },
      {
        key: '478',
        label: '助眠 4-7-8',
        desc: '帮助入睡',
        phases: [
          { key: 'inhale', label: '吸气', dur: 4 },
          { key: 'hold', label: '屏息', dur: 7 },
          { key: 'exhale', label: '呼气', dur: 8 }
        ]
      }
    ],
    patternIdx: 0,
    running: false,
    phase: 'ready',
    phaseLabel: '准备',
    count: 4,
    phaseDur: 4,
    rounds: 0
  },

  _phases() {
    return this.data.patterns[this.data.patternIdx].phases;
  },

  selectPattern(e) {
    if (this.data.running) this.stop();
    this.setData({ patternIdx: Number(e.currentTarget.dataset.i), rounds: 0 });
  },

  start() {
    if (this.data.running) return;
    // 防御：上一个定时器若还在，先清掉，避免双表并行导致秒数跳变
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this.setData({ running: true });
    this._idx = 0;
    this._enterPhase(0);
    this._timer = setInterval(() => this._tick(), 1000);
  },

  _enterPhase(i) {
    const p = this._phases()[i];
    this.setData({ phase: p.key, phaseLabel: p.label, count: p.dur, phaseDur: p.dur });
  },

  _tick() {
    let count = this.data.count - 1;
    if (count <= 0) {
      this._idx = (this._idx + 1) % this._phases().length;
      if (this._idx === 0) {
        this.setData({ rounds: this.data.rounds + 1 });
      }
      this._enterPhase(this._idx);
    } else {
      this.setData({ count });
    }
  },

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this.setData({ running: false, phase: 'ready', phaseLabel: '准备', count: 4, rounds: 0 });
  },

  // 切后台停表，回前台接着走（呼吸引导不需要后台计时）
  onHide() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  onShow() {
    if (this.data.running && !this._timer) {
      this._timer = setInterval(() => this._tick(), 1000);
    }
  },

  onUnload() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
});
