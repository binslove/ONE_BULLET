/* ONE BULLET — audio.js
   WebAudio 절차적 사운드.
   · 발사 / 도탄 / 낙하 / 캐치 음색을 명확히 구분한다 (실패해도 소리만으로 상태 파악)
   · 도탄이 이어질수록 타격음 음정이 상승한다
   · ONE CHAIN 단계에 따라 배경음 레이어가 3단계로 쌓인다 */

const Snd = {
  ctx: null,
  master: null,
  musicGain: null,
  sfxGain: null,
  ready: false,
  volume: 0.8,
  muted: false,

  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.5;
    this.musicGain.connect(this.master);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);

    // 노이즈 버퍼 (스파크 · 폭발용)
    const len = this.ctx.sampleRate * 1.2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.ready = true;
    this._initMusic();
  },

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = this.muted ? 0 : v; },

  /* ---------------------------------------------------------- 기본 보이스 */

  tone(freq, dur, {
    type = 'square', gain = 0.25, attack = 0.004, decay = null,
    slideTo = null, dest = null, detune = 0,
  } = {}) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (decay || dur));
    o.connect(g); g.connect(dest || this.sfxGain);
    o.start(t); o.stop(t + dur + 0.05);
  },

  noise(dur, { gain = 0.25, freq = 1200, q = 1, type = 'bandpass', slideTo = null } = {}) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (slideTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, slideTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfxGain);
    s.start(t); s.stop(t + dur + 0.05);
  },

  /* ---------------------------------------------------------- 게임 이벤트 */

  // 발사: 짧고 건조하게. 체인이 높을수록 밝아진다.
  shot(chain = 0) {
    this.tone(180 + chain * 40, 0.12, { type: 'square', gain: 0.22, slideTo: 70 });
    this.noise(0.07, { gain: 0.3, freq: 2600, slideTo: 700 });
  },

  // 도탄: 금속성 스파크. bounce 가 늘수록 음정 상승.
  ricochet(bounce = 0) {
    const f = 620 * Math.pow(1.18, bounce);
    this.tone(f, 0.09, { type: 'triangle', gain: 0.18, slideTo: f * 0.6 });
    this.noise(0.05, { gain: 0.22, freq: 3800, q: 2, slideTo: 1500 });
  },

  hitEnemy() {
    this.tone(140, 0.14, { type: 'sawtooth', gain: 0.2, slideTo: 55 });
    this.noise(0.09, { gain: 0.25, freq: 900, slideTo: 200 });
  },

  // 낙하: 낮고 둔탁 — "지금 무장 해제 상태" 신호
  drop() {
    this.tone(90, 0.28, { type: 'sine', gain: 0.25, slideTo: 48 });
    this.noise(0.12, { gain: 0.12, freq: 400, slideTo: 120 });
  },

  // 일반 회수: 담백한 재장전
  reload() {
    this.tone(420, 0.07, { type: 'square', gain: 0.16 });
    this.tone(640, 0.09, { type: 'square', gain: 0.12 });
  },

  // 퍼펙트 캐치: 청록색 파동 — 체인 단계마다 위로 쌓인다
  perfect(chain = 1) {
    const base = 520 * Math.pow(1.26, Math.min(chain, 4) - 1);
    this.tone(base, 0.16, { type: 'triangle', gain: 0.26 });
    this.tone(base * 1.5, 0.22, { type: 'sine', gain: 0.2 });
    this.tone(base * 2, 0.3, { type: 'sine', gain: 0.1 });
    this.noise(0.18, { gain: 0.1, freq: 5200, slideTo: 2000 });
  },

  // 귀환 탄환 경고
  warn() { this.tone(880, 0.06, { type: 'sine', gain: 0.14 }); },

  // 체인 파손
  chainBreak() {
    this.tone(300, 0.3, { type: 'sawtooth', gain: 0.22, slideTo: 60 });
    this.noise(0.2, { gain: 0.18, freq: 800, slideTo: 120 });
  },

  playerHit() {
    this.tone(160, 0.32, { type: 'sawtooth', gain: 0.3, slideTo: 40 });
    this.noise(0.22, { gain: 0.3, freq: 500, slideTo: 90 });
  },

  explode() {
    this.noise(0.55, { gain: 0.45, freq: 900, slideTo: 60, type: 'lowpass' });
    this.tone(70, 0.5, { type: 'sine', gain: 0.35, slideTo: 30 });
  },

  electric() {
    for (let i = 0; i < 4; i++) this.tone(1400 + i * 380, 0.06, { type: 'square', gain: 0.1 });
    this.noise(0.16, { gain: 0.16, freq: 5000, q: 6 });
  },

  charge() {
    this.tone(300, 0.22, { type: 'triangle', gain: 0.16, slideTo: 1200 });
  },

  breakWall() { this.noise(0.3, { gain: 0.3, freq: 1400, slideTo: 200 }); },

  laser() { this.tone(1200, 0.12, { type: 'sawtooth', gain: 0.08, slideTo: 400 }); },

  weakPoint() {
    this.tone(880, 0.5, { type: 'square', gain: 0.28, slideTo: 220 });
    this.tone(1320, 0.6, { type: 'sine', gain: 0.2 });
    this.noise(0.4, { gain: 0.24, freq: 3000, slideTo: 200 });
  },

  uiMove() { this.tone(600, 0.05, { type: 'square', gain: 0.09 }); },
  uiSelect() { this.tone(760, 0.1, { type: 'square', gain: 0.14, slideTo: 1140 }); },

  clearJingle() {
    const seq = [523, 659, 784, 1046];
    seq.forEach((f, i) => setTimeout(() => this.tone(f, 0.35, { type: 'triangle', gain: 0.2 }), i * 110));
  },

  failJingle() {
    const seq = [392, 330, 262];
    seq.forEach((f, i) => setTimeout(() => this.tone(f, 0.4, { type: 'sawtooth', gain: 0.18 }), i * 140));
  },

  /* ---------------------------------------------------------- 배경음 레이어
     레이어 1: 기본 베이스 (항상)
     레이어 2: CHAIN 2 이상 — 저음 리듬 추가
     레이어 3: CHAIN 3 — 상단 아르페지오로 음악 완성  */

  music: { on: false, step: 0, next: 0, bpm: 132, layer: 0, target: 0 },

  _initMusic() {
    this.music.next = this.ctx.currentTime;
  },

  startMusic() { if (this.ready) { this.music.on = true; this.music.next = this.ctx.currentTime; } },
  stopMusic()  { this.music.on = false; },
  setLayer(chain) { this.music.target = clamp(chain, 0, 3); },

  updateMusic() {
    if (!this.ready || !this.music.on) return;
    const m = this.music;
    const spb = 60 / m.bpm / 2;                 // 8분음표
    const now = this.ctx.currentTime;
    while (m.next < now + 0.1) {
      const t = m.next;
      const s = m.step % 16;
      m.layer += (m.target - m.layer) * 0.25;
      const L = m.target;

      // 레이어 1 — 베이스 펄스
      if (s % 4 === 0) this._mNote(41.2 * (s === 8 ? 1.5 : 1), 0.26, t, 'sine', 0.30);
      if (s % 8 === 2) this._mNote(82.4, 0.12, t, 'triangle', 0.12);

      // 레이어 2 — 저음 리듬 (CHAIN 2+)
      if (L >= 2) {
        if (s % 2 === 0) this._mNoise(0.05, t, 0.10, 240);
        if (s % 8 === 6) this._mNoise(0.12, t, 0.14, 1800);
        if (s % 4 === 2) this._mNote(110, 0.1, t, 'square', 0.07);
      }

      // 레이어 3 — 상단 아르페지오 (CHAIN 3)
      if (L >= 3) {
        const arp = [659, 784, 988, 784, 1175, 988, 784, 659];
        this._mNote(arp[s % 8], 0.14, t, 'triangle', 0.075);
        if (s % 16 === 0) this._mNote(1318, 0.4, t, 'sine', 0.05);
      }

      m.step++;
      m.next += spb;
    }
  },

  _mNote(freq, dur, t, type, gain) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.musicGain);
    o.start(t); o.stop(t + dur + 0.05);
  },

  _mNoise(dur, t, gain, freq) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.musicGain);
    s.start(t); s.stop(t + dur + 0.05);
  },
};
