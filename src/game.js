/* ONE BULLET — game.js
   핵심 규칙: 플레이어가 사용할 수 있는 총알은 단 한 발이다.
   발사한 총알을 회수하기 전까지 다시 공격할 수 없다.

   탄환 상태 흐름
     LOADED  -- 발사 -->  FLIGHT
     FLIGHT  -- 도탄 한계 / 비행 시간 -->  RETURNING
     FLIGHT  -- 적·드럼·약점 명중 -->  DROPPED
     RETURNING -- 퍼펙트 캐치 --> LOADED (체인 +1)
     RETURNING -- 회피 / 빗나감 --> DROPPED
     DROPPED -- 접근 회수 --> LOADED (체인 0)
     DROPPED -- 수집병 --> CARRIED
     접근 불가 --> RECOVER --> DROPPED (안전 지점)                        */

const W = 1280, H = 720;

/* ------------------------------------------------------------------ 튜닝 */
const K = {
  playerSpeed: 268,
  playerR: 13,
  dashSpeed: 830,
  dashTime: 0.16,
  dashCd: 0.62,
  hitInvul: 0.7,

  bulletSpeed: 640,
  bulletR: 6,
  maxBounces: 4,
  maxFlight: 2.8,

  returnSpeed: 372,
  returnTurn: 5.4,
  returnLife: 3.4,

  catchWindow: 0.18,
  catchRadius: 58,
  catchSignal: 0.35,

  pickupRadius: 34,
  chainRefire: 1.0,

  drumRadius: 110,
  drumFuse: 0.4,

  weakStun: 1.7,
  weakStunOverload: 2.9,          // 폭발 강화 탄환으로 약점 명중 시 — 더 긴 경직으로 다음 공격을 준비할 시간을 번다
};

/* ------------------------------------------------------------------ 입력 */
const Input = {
  keys: {}, pressed: {},
  mx: W / 2, my: H / 2, mDown: false, mPressed: false,
  init(canvas) {
    addEventListener('keydown', e => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.keys[e.code]) this.pressed[e.code] = true;
      this.keys[e.code] = true;
      Snd.init(); Snd.resume();
    });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    const toLocal = e => {
      const r = canvas.getBoundingClientRect();
      this.mx = (e.clientX - r.left) * (W / r.width);
      this.my = (e.clientY - r.top) * (H / r.height);
    };
    canvas.addEventListener('mousemove', toLocal);
    canvas.addEventListener('mousedown', e => {
      toLocal(e);
      if (e.button === 0) { if (!this.mDown) this.mPressed = true; this.mDown = true; }
      Snd.init(); Snd.resume();
    });
    addEventListener('mouseup', e => { if (e.button === 0) this.mDown = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  },
  down(c) { return !!this.keys[c]; },
  hit(c) { return !!this.pressed[c]; },
  endFrame() { this.pressed = {}; this.mPressed = false; },
};

/* ------------------------------------------------------------------ 게임 */
const G = {
  state: 'title',            // title | intro | play | clear | dead | result | pause
  prevState: 'play',
  t: 0, stateT: 0,
  levelIndex: 0,
  level: null,

  shake: 0, shakeAmt: 1, hitstop: 0, flash: 0, flashColor: C.IVORY,
  desat: 0,

  settings: { shake: 1, volume: 0.8, aimAssist: 1 },
  menuIndex: 0,

  run: null,                 // 전체 플레이 통계
  zone: null,                // 현재 구역 런타임 상태

  /* --------------------------------------------------------- 초기화 */
  startRun() {
    this.run = {
      time: 0, shots: 0, ricochetKills: 0, perfectCatches: 0,
      maxChain: 0, damageTaken: 0, deaths: 0, bossPrint: null,
    };
    this.levelIndex = 0;
    this.loadLevel(0);
    Snd.startMusic();
  },

  loadLevel(i, skipIntro) {
    this.levelIndex = i;
    const L = LEVELS[i];
    this.level = L;

    const z = {
      time: 0,
      shots: 0, ricochetKills: 0, perfectCatches: 0, maxChain: 0, damageTaken: 0,
      walls: [], reflectors: [], drums: [], spikes: [], shutters: [],
      switches: [], chargers: [], enemies: [], projectiles: [], particles: [],
      pops: [], hintText: null, hintT: 0, shownHints: {},
      segs: [], boss: null, cleared: false,
    };

    for (const w of (L.walls || [])) {
      const poly = w.poly ? w.poly.map(p => [p[0], p[1]]) : rectPoly(w.x, w.y, w.w, w.h);
      z.walls.push({ poly, type: w.type || 'solid', hp: w.type === 'cracked' ? 1 : Infinity, dead: false, flash: 0 });
    }
    for (const r of (L.reflectors || [])) {
      z.reflectors.push({ ...r, angle: r.angle, rot: r.rot || 0, spin: 0, flash: 0, active: !r.phase });
    }
    for (const d of (L.drums || [])) z.drums.push({ x: d.x, y: d.y, r: 18, fuse: -1, dead: false });
    for (const s of (L.spikes || [])) z.spikes.push({ ...s, phase: 0, out: false });
    for (const s of (L.shutters || [])) z.shutters.push({ ...s, closed: false });
    for (const s of (L.switches || [])) z.switches.push({ ...s, flash: 0 });
    for (const c of (L.chargers || [])) z.chargers.push({ ...c, cool: 0 });
    for (const e of (L.enemies || [])) z.enemies.push(makeEnemy(e));

    if (L.boss) z.boss = makeBoss();

    this.zone = z;

    this.player = {
      x: L.playerStart.x, y: L.playerStart.y, r: K.playerR,
      vx: 0, vy: 0, aim: 0,
      hp: 3, invul: 0, dashT: 0, dashCd: 0, dashX: 1, dashY: 0,
      alive: true, hitFlash: 0, walkT: 0,
    };

    this.bullet = {
      state: 'LOADED', x: this.player.x, y: this.player.y,
      dx: 1, dy: 0, speed: K.bulletSpeed, bounces: 0, flight: 0,
      element: null, pierce: 0, trail: [], returnT: 0, signal: false,
      dropGlow: 0, carrier: null, recoverT: 0, spin: 0,
    };

    this.chain = 0;
    this.chainRefireT = 0;
    this.bonusVoid = false;
    this.catchT = 0;
    this.catchFx = 0;

    this.print = { shots: [], cur: null };

    // 사망 후 재시작은 안내 화면을 건너뛰고 즉시 전투를 재개한다
    this.state = skipIntro ? 'play' : 'intro';
    this.stateT = 0;
    if (skipIntro) { z.shownHints = { start: true }; }
    Snd.setLayer(0);
  },

  /* --------------------------------------------------------- 상태 전환 */
  setState(s) { this.state = s; this.stateT = 0; },

  killShake(a) { this.shake = Math.max(this.shake, a * this.settings.shake); },
  doFlash(a, col = C.IVORY) { this.flash = Math.max(this.flash, a); this.flashColor = col; },
  stop(t) { this.hitstop = Math.max(this.hitstop, t); },
};

/* ================================================================== 엔티티 */

function makeEnemy(spec) {
  const base = { type: spec.type, x: spec.x, y: spec.y, hp: 1, alive: true, r: 15, hitFlash: 0, t: rnd(3), facing: 0, stun: 0 };
  switch (spec.type) {
    case 'chaser':    return { ...base, r: 15, speed: 96,  windup: 0, atkCd: 0 };
    case 'shooter':   return { ...base, r: 15, speed: 62,  fireCd: rnd(2.4, 1.0), windup: 0 };
    case 'shield':    return { ...base, r: 17, speed: 58,  shieldHalf: 30, shieldDist: 24 };
    case 'collector': return { ...base, r: 14, speed: 138, carrying: false, carryT: 0, flee: 0 };
  }
  return base;
}

function makeBoss() {
  return {
    x: 640, y: 300, r: 56, facing: Math.PI / 2,
    phase: 1, weak: 3, stun: 0, t: 0,
    atkCd: 2.4, windup: 0, mode: 'chase', moveT: 0,
    tx: 640, ty: 300, hitFlash: 0, dead: false, deadT: 0,
    ringT: 0, ringWarn: 0,
  };
}

/* ================================================================== 기하 */

function buildSegments() {
  const z = G.zone, s = [];
  const push = (ax, ay, bx, by, type, ref) => s.push({ ax, ay, bx, by, type, ref });

  // 경기장 외벽
  push(AR.l, AR.t, AR.r, AR.t, 'wall');
  push(AR.r, AR.t, AR.r, AR.b, 'wall');
  push(AR.r, AR.b, AR.l, AR.b, 'wall');
  push(AR.l, AR.b, AR.l, AR.t, 'wall');

  for (const w of z.walls) {
    if (w.dead) continue;
    const p = w.poly;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++)
      push(p[j][0], p[j][1], p[i][0], p[i][1], w.type === 'cracked' ? 'crack' : 'wall', w);
  }

  for (const r of z.reflectors) {
    if (!r.active) continue;
    const c = Math.cos(r.angle), sn = Math.sin(r.angle), h = r.len / 2;
    push(r.x - c * h, r.y - sn * h, r.x + c * h, r.y + sn * h, 'reflector', r);
  }

  for (const sh of z.shutters) {
    if (!sh.closed) continue;
    const p = rectPoly(sh.x, sh.y, sh.w, sh.h);
    for (let i = 0, j = p.length - 1; i < p.length; j = i++)
      push(p[j][0], p[j][1], p[i][0], p[i][1], 'shutter', sh);
  }

  for (const e of z.enemies) {
    if (!e.alive || e.type !== 'shield') continue;
    const c = Math.cos(e.facing), sn = Math.sin(e.facing);
    const cx = e.x + c * e.shieldDist, cy = e.y + sn * e.shieldDist;
    const px = -sn, py = c;
    push(cx - px * e.shieldHalf, cy - py * e.shieldHalf, cx + px * e.shieldHalf, cy + py * e.shieldHalf, 'shield', e);
  }

  const b = z.boss;
  if (b && !b.dead) {
    // 정면 장갑 — 등 뒤 80° 를 제외한 호
    const N = 16, span = Math.PI * 2 - 1.4;
    for (let i = 0; i < N; i++) {
      const a0 = b.facing - span / 2 + span * (i / N);
      const a1 = b.facing - span / 2 + span * ((i + 1) / N);
      push(b.x + Math.cos(a0) * b.r, b.y + Math.sin(a0) * b.r,
           b.x + Math.cos(a1) * b.r, b.y + Math.sin(a1) * b.r, 'armor', b);
    }
  }

  z.segs = s;
  return s;
}

function weakPointPos(b) {
  const a = b.facing + Math.PI;
  return { x: b.x + Math.cos(a) * (b.r * 0.78), y: b.y + Math.sin(a) * (b.r * 0.78), r: 17 };
}

/* 폴리곤/외벽에 대한 원형 충돌 해결 */
function collideBody(body) {
  const z = G.zone;
  body.x = clamp(body.x, AR.l + body.r, AR.r - body.r);
  body.y = clamp(body.y, AR.t + body.r, AR.b - body.r);
  for (const w of z.walls) { if (!w.dead) pushCircleOutOfPoly(body, body.r, w.poly); }
  for (const sh of z.shutters) { if (sh.closed) pushCircleOutOfPoly(body, body.r, rectPoly(sh.x, sh.y, sh.w, sh.h)); }
  for (const r of z.reflectors) {
    if (!r.active) continue;
    const c = Math.cos(r.angle), sn = Math.sin(r.angle), h = r.len / 2;
    const p = closestOnSeg(body.x, body.y, r.x - c * h, r.y - sn * h, r.x + c * h, r.y + sn * h);
    const d = dist(body.x, body.y, p.x, p.y);
    if (d < body.r + 4) {
      const n = norm(body.x - p.x || rnd(1, -1), body.y - p.y || rnd(1, -1));
      body.x = p.x + n.x * (body.r + 4);
      body.y = p.y + n.y * (body.r + 4);
    }
  }
  const b = z.boss;
  if (b && !b.dead && body !== b) {
    const d = dist(body.x, body.y, b.x, b.y);
    if (d < body.r + b.r) {
      const n = norm(body.x - b.x, body.y - b.y);
      body.x = b.x + n.x * (body.r + b.r);
      body.y = b.y + n.y * (body.r + b.r);
    }
  }
}

/** 반지름 여유를 포함한 통행 불가 판정 (투사체·안전 지점 탐색용) */
function isBlocked(x, y, r = 8) {
  if (x < AR.l + r || x > AR.r - r || y < AR.t + r || y > AR.b - r) return true;
  for (const w of G.zone.walls) if (!w.dead && pointInPoly(x, y, w.poly)) return true;
  for (const sh of G.zone.shutters) if (sh.closed && x > sh.x && x < sh.x + sh.w && y > sh.y && y < sh.y + sh.h) return true;
  return false;
}

/** 탄환이 실제로 전투 구역을 벗어났거나 지형 안에 박혔는지.
    도탄 직후 탄환은 벽에서 2.5px 떨어져 있으므로 여유 판정을 쓰면 안 된다. */
function isOutOfPlay(x, y) {
  if (x < AR.l - 2 || x > AR.r + 2 || y < AR.t - 2 || y > AR.b + 2) return true;
  for (const w of G.zone.walls) if (!w.dead && pointInPoly(x, y, w.poly)) return true;
  for (const sh of G.zone.shutters) if (sh.closed && x > sh.x && x < sh.x + sh.w && y > sh.y && y < sh.y + sh.h) return true;
  return false;
}

/** (x, y) 주변에서 플레이어가 접근할 수 있는 가장 가까운 지점.
    복구는 탄환이 있던 자리 근처로만 이동시킨다 — 플레이어 발밑으로 순간이동시키지 않는다. */
function safeSpotNear(x, y) {
  if (!isBlocked(x, y, 16)) return { x, y };
  for (let ring = 1; ring <= 14; ring++) {
    const rad = ring * 22;
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * TAU + ring * 0.4;
      const nx = x + Math.cos(a) * rad, ny = y + Math.sin(a) * rad;
      if (!isBlocked(nx, ny, 16)) return { x: nx, y: ny };
    }
  }
  return { x: clamp(x, AR.l + 30, AR.r - 30), y: clamp(y, AR.t + 30, AR.b - 30) };
}

/* ================================================================== 파티클 */

function spark(x, y, n, color, spd = 220, life = 0.4, size = 3) {
  const z = G.zone;
  for (let i = 0; i < n; i++) {
    const a = rnd(TAU);
    const s = rnd(spd, spd * 0.25);
    z.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size: rnd(size, size * 0.4), drag: 3.4 });
  }
}

function ring(x, y, r0, r1, color, life = 0.4, lw = 3) {
  G.zone.particles.push({ ring: true, x, y, r0, r1, color, life, max: life, lw });
}

function pop(x, y, str, color = C.IVORY, size = 15) {
  G.zone.pops.push({ x, y, str, color, size, life: 0.85, max: 0.85 });
}

/* ================================================================== 탄환 */

function fireBullet() {
  const p = G.player, b = G.bullet;
  if (b.state !== 'LOADED') return;
  const a = p.aim;
  b.state = 'FLIGHT';
  b.x = p.x + Math.cos(a) * 18;
  b.y = p.y + Math.sin(a) * 18;
  b.dx = Math.cos(a); b.dy = Math.sin(a);
  b.speed = K.bulletSpeed * (G.chain >= 2 ? 1.10 : 1);
  b.bounces = 0; b.flight = 0; b.trail.length = 0;
  b.pierce = G.chain >= 3 ? 1 : 0;
  b.signal = false; b.returnT = 0;

  G.zone.shots++; G.run.shots++;
  G.chainRefireT = 0;                       // 캐치 후 재발사 성공 — 체인 유지

  // SHOTPRINT 기록 시작
  G.print.cur = { pts: [{ x: b.x, y: b.y }], marks: [{ type: 'shot', x: b.x, y: b.y }] };
  G.print.shots.push(G.print.cur);

  Snd.shot(G.chain);
  G.killShake(2.5);
  spark(b.x, b.y, 6, C.GOLD, 160, 0.25, 2.5);
}

function printPoint(x, y, mark) {
  const c = G.print.cur;
  if (!c) return;
  c.pts.push({ x, y });
  if (mark) c.marks.push({ type: mark, x, y });
}

function dmgMult() { return G.chain >= 1 ? 1.25 : 1; }

function dropBullet(x, y, silent) {
  const b = G.bullet;
  b.state = 'DROPPED';
  b.x = x; b.y = y; b.dropGlow = 1;
  b.element = null; b.pierce = 0;
  if (!silent) Snd.drop();
  if (isOutOfPlay(x, y)) recoverBullet();
  G.print.cur = null;
}

function recoverBullet() {
  const b = G.bullet;
  const s = safeSpotNear(b.x, b.y);
  b.x = s.x; b.y = s.y;
  b.state = 'DROPPED'; b.recoverT = 1.2;
  ring(b.x, b.y, 4, 46, C.GOLD, 0.5, 2);
}

function startReturn() {
  const b = G.bullet;
  b.state = 'RETURNING';
  b.returnT = 0;
  b.speed = K.returnSpeed * (G.chain >= 2 ? 1.10 : 1);
  b.signal = false;
  b.element = null;
}

function perfectCatch() {
  const b = G.bullet, p = G.player;
  b.state = 'LOADED';
  b.trail.length = 0;

  if (G.bonusVoid) { G.bonusVoid = false; pop(p.x, p.y - 30, 'CATCH', C.CYAN); }
  else {
    G.chain++;
    G.zone.maxChain = Math.max(G.zone.maxChain, G.chain);
    G.run.maxChain = Math.max(G.run.maxChain, G.chain);
    pop(p.x, p.y - 30, `PERFECT  CHAIN ${Math.min(G.chain, 3)}`, C.CYAN, 16);
  }
  G.chainRefireT = K.chainRefire;
  G.zone.perfectCatches++; G.run.perfectCatches++;

  printPoint(p.x, p.y, 'catch');
  G.print.cur = null;

  Snd.perfect(G.chain);
  Snd.setLayer(Math.min(G.chain, 3));
  G.stop(0.08);
  G.desat = 1;
  G.catchFx = 1;
  ring(p.x, p.y, 10, 90, C.CYAN, 0.45, 4);
  spark(p.x, p.y, 14, C.CYAN, 260, 0.5, 3);
  G.killShake(3);
}

function pickupBullet() {
  const b = G.bullet;
  b.state = 'LOADED';
  b.trail.length = 0;
  if (G.chain > 0) { G.chain = 0; Snd.setLayer(0); }
  G.chainRefireT = 0;
  G.bonusVoid = false;
  Snd.reload();
  ring(G.player.x, G.player.y, 6, 40, C.GOLD, 0.3, 2);
  G.print.cur = null;
}

function breakChain(reason) {
  if (G.chain > 0) {
    G.chain = 0;
    Snd.setLayer(0);
    Snd.chainBreak();
    pop(G.player.x, G.player.y - 34, 'CHAIN BREAK', C.RED, 14);
  }
  G.chainRefireT = 0;
}

/* 적 피해 처리 */
function damageEnemy(e, amount, byRicochet, hx, hy) {
  e.hp -= amount;
  e.hitFlash = 1;
  spark(hx, hy, 10, C.RED, 240, 0.35, 3);
  if (e.hp <= 0 && e.alive) {
    e.alive = false;
    if (e.type === 'collector' && e.carrying) {
      G.bullet.carrier = null;
      dropBullet(e.x, e.y, true);
    }
    spark(e.x, e.y, 20, C.RED, 300, 0.6, 4);
    ring(e.x, e.y, 6, 46, C.RED, 0.4, 3);
    if (byRicochet) { G.zone.ricochetKills++; G.run.ricochetKills++; pop(e.x, e.y - 24, 'RICOCHET', C.GOLD, 13); }
    G.killShake(4);
  }
  Snd.hitEnemy();
}

function applyElement(el, x, y, primary, skipWeak) {
  const z = G.zone;
  if (el === 'electric') {
    Snd.electric();
    let n = 0;
    const targets = z.enemies
      .filter(e => e.alive && e !== primary && dist(e.x, e.y, x, y) < 190)
      .sort((a, b) => dist2(a.x, a.y, x, y) - dist2(b.x, b.y, x, y));
    for (const e of targets) {
      if (n >= 2) break;
      n++;
      for (let i = 0; i < 8; i++) {
        const t = i / 8;
        spark(lerp(x, e.x, t), lerp(y, e.y, t), 1, C.CYAN, 90, 0.28, 2);
      }
      damageEnemy(e, 1, false, e.x, e.y);
    }
    ring(x, y, 8, 190, C.CYAN, 0.35, 2);
  } else if (el === 'explosive') {
    explodeAt(x, y, 128, true, skipWeak);
  }
}

function explodeAt(x, y, radius, fromBullet, skipWeak) {
  const z = G.zone;
  Snd.explode();
  G.killShake(11); G.doFlash(0.35, C.ORANGE); G.stop(0.04);
  ring(x, y, 10, radius, C.ORANGE, 0.45, 6);
  spark(x, y, 34, C.ORANGE, 460, 0.7, 5);

  for (const e of z.enemies) {
    if (e.alive && dist(e.x, e.y, x, y) < radius + e.r) damageEnemy(e, 2, false, e.x, e.y);
  }
  const b = z.boss;
  if (b && !b.dead && !skipWeak) {
    const wp = weakPointPos(b);
    if (dist(wp.x, wp.y, x, y) < radius) hitWeakPoint(b, wp);
  }
  for (const d of z.drums) {
    if (!d.dead && d.fuse < 0 && dist(d.x, d.y, x, y) < radius) d.fuse = 0.18;
  }
  for (const w of z.walls) {
    if (!w.dead && w.type === 'cracked') {
      const c = w.poly.reduce((a, p) => [a[0] + p[0] / w.poly.length, a[1] + p[1] / w.poly.length], [0, 0]);
      if (dist(c[0], c[1], x, y) < radius) { w.dead = true; Snd.breakWall(); }
    }
  }
  const p = G.player;
  if (p.alive && p.invul <= 0 && p.dashT <= 0 && dist(p.x, p.y, x, y) < radius) hurtPlayer();
}

function hitWeakPoint(b, wp, overload) {
  b.weak--;
  b.stun = overload ? K.weakStunOverload : K.weakStun;
  b.hitFlash = 1;
  G.stop(0.09); G.killShake(14); G.doFlash(0.5, C.ORANGE);
  Snd.weakPoint();
  ring(wp.x, wp.y, 8, 130, C.ORANGE, 0.6, 5);
  spark(wp.x, wp.y, 30, C.ORANGE, 380, 0.8, 5);
  pop(b.x, b.y - 70, `WEAK POINT  ${3 - b.weak}/3`, C.ORANGE, 18);
  if (overload) pop(b.x, b.y - 94, 'OVERLOAD STUN', C.ORANGE, 13);
  if (b.weak <= 0) { b.dead = true; b.deadT = 0; }
  else { b.phase = Math.min(3, 4 - b.weak); }
}

/* ------------------------------------------------- 비행 탄환 이동/충돌 */
function marchBullet(dt) {
  const b = G.bullet, z = G.zone;
  const segs = z.segs;
  let remaining = b.speed * dt;
  let guard = 0;

  while (remaining > 0.01 && guard++ < 10 && b.state === 'FLIGHT') {
    let bestT = remaining, hitSeg = null;
    for (const s of segs) {
      const t = rayVsSeg(b.x, b.y, b.dx, b.dy, s.ax, s.ay, s.bx, s.by);
      if (t !== null && t < bestT) { bestT = t; hitSeg = s; }
    }

    let hitEnemy = null, eT = bestT;
    for (const e of z.enemies) {
      if (!e.alive) continue;
      const t = rayVsCircle(b.x, b.y, b.dx, b.dy, e.x, e.y, e.r + K.bulletR);
      if (t !== null && t < eT) { eT = t; hitEnemy = e; }
    }

    let hitDrum = null, dT = eT;
    for (const d of z.drums) {
      if (d.dead) continue;
      const t = rayVsCircle(b.x, b.y, b.dx, b.dy, d.x, d.y, d.r + K.bulletR);
      if (t !== null && t < dT) { dT = t; hitDrum = d; }
    }

    let hitSwitch = null, sT = dT;
    for (const s of z.switches) {
      const t = rayVsCircle(b.x, b.y, b.dx, b.dy, s.x, s.y, s.r + K.bulletR);
      if (t !== null && t < sT) { sT = t; hitSwitch = s; }
    }

    let hitWeak = null, wT = sT;
    if (z.boss && !z.boss.dead) {
      const wp = weakPointPos(z.boss);
      const t = rayVsCircle(b.x, b.y, b.dx, b.dy, wp.x, wp.y, wp.r + K.bulletR);
      if (t !== null && t < wT) { wT = t; hitWeak = wp; }
    }

    const travel = Math.min(remaining, wT);
    const nx = b.x + b.dx * travel, ny = b.y + b.dy * travel;

    // 충전 장치 통과 판정 (관통 — 탄환을 멈추지 않는다)
    for (const c of z.chargers) {
      if (c.cool > 0) continue;
      const cp = closestOnSeg(c.x, c.y, b.x, b.y, nx, ny);
      if (dist(cp.x, cp.y, c.x, c.y) < c.r + K.bulletR) {
        b.element = c.type; c.cool = 0.8;
        Snd.charge();
        ring(c.x, c.y, 6, 44, c.type === 'electric' ? C.CYAN : C.ORANGE, 0.4, 3);
        pop(c.x, c.y - 34, c.type === 'electric' ? 'ELECTRIC' : 'EXPLOSIVE',
            c.type === 'electric' ? C.CYAN : C.ORANGE, 13);
      }
    }

    b.x = nx; b.y = ny;
    remaining -= travel;

    if (hitWeak && wT <= travel + 0.001) {
      printPoint(b.x, b.y, 'hit');
      hitWeakPoint(z.boss, hitWeak, b.element === 'explosive');
      if (b.element) applyElement(b.element, b.x, b.y, null, true);
      // 약점 명중 탄환은 플레이어에게 돌아온다 (캐치 → 즉시 재공격).
      // 캐치에 실패해도 귀환 종료 시 접근 가능한 위치에 떨어진다.
      b.dx = -b.dx; b.dy = -b.dy;
      startReturn();
      return;
    }

    if (hitSwitch && sT <= travel + 0.001) {
      hitSwitch.flash = 1;
      Snd.ricochet(b.bounces);
      for (const id of hitSwitch.targets) {
        const r = z.reflectors.find(rr => rr.id === id);
        if (r) { r.spin = Math.PI / 2; }
      }
      pop(hitSwitch.x, hitSwitch.y - 28, 'ROTATE 90°', C.IVORY, 13);
      const n = norm(b.x - hitSwitch.x, b.y - hitSwitch.y);
      const dot = b.dx * n.x + b.dy * n.y;
      b.dx -= 2 * dot * n.x; b.dy -= 2 * dot * n.y;
      b.x += n.x * 3; b.y += n.y * 3;
      b.bounces++;
      printPoint(b.x, b.y, 'bounce');
      spark(b.x, b.y, 8, C.IVORY, 200, 0.3, 2.5);
      if (b.bounces > K.maxBounces) { startReturn(); return; }
      continue;
    }

    if (hitDrum && dT <= travel + 0.001) {
      hitDrum.fuse = K.drumFuse;
      printPoint(b.x, b.y, 'hit');
      spark(b.x, b.y, 10, C.ORANGE, 200, 0.35, 3);
      Snd.hitEnemy();
      // 드럼은 탄환을 소멸시키지 않는다 — 바닥에 떨어뜨린다
      const off = safeSpotNear(b.x - b.dx * 26, b.y - b.dy * 26);
      dropBullet(off.x, off.y);
      return;
    }

    if (hitEnemy && eT <= travel + 0.001) {
      printPoint(b.x, b.y, 'hit');
      const byRic = b.bounces > 0;
      const el = b.element;
      damageEnemy(hitEnemy, 1 * dmgMult(), byRic, b.x, b.y);
      G.stop(0.03); G.killShake(5);
      if (el) applyElement(el, b.x, b.y, hitEnemy);
      if (b.pierce > 0) {
        b.pierce--;
        b.element = null;
        pop(b.x, b.y - 26, 'PIERCE', C.GOLD, 13);
        b.x += b.dx * (hitEnemy.r + 4); b.y += b.dy * (hitEnemy.r + 4);
        continue;
      }
      dropBullet(b.x, b.y);
      return;
    }

    if (hitSeg && bestT <= travel + 0.001) {
      if (hitSeg.type === 'crack') {
        hitSeg.ref.dead = true;
        Snd.breakWall();
        spark(b.x, b.y, 18, C.CONCRETE, 260, 0.5, 4);
        ring(b.x, b.y, 4, 50, C.IVORY, 0.3, 2);
        G.killShake(5);
        printPoint(b.x, b.y, 'bounce');
        buildSegments();
        b.x += b.dx * 4; b.y += b.dy * 4;
        continue;                                     // 경로 개방 — 관통
      }

      const rf = reflect(b.dx, b.dy, hitSeg.ax, hitSeg.ay, hitSeg.bx, hitSeg.by);
      b.dx = rf.x; b.dy = rf.y;
      b.x += rf.nx * 2.5; b.y += rf.ny * 2.5;
      b.bounces++;

      printPoint(b.x, b.y, 'bounce');
      Snd.ricochet(b.bounces);
      G.stop(0.03);
      G.killShake(2.2);
      spark(b.x, b.y, 7, hitSeg.type === 'shield' ? C.RED : (hitSeg.type === 'armor' ? C.ORANGE : C.GOLD), 210, 0.3, 2.5);

      if (hitSeg.type === 'reflector') hitSeg.ref.flash = 1;
      if (hitSeg.type === 'shield') { hitSeg.ref.hitFlash = 0.6; pop(hitSeg.ref.x, hitSeg.ref.y - 30, 'BLOCKED', C.RED, 12); }
      if (hitSeg.type === 'armor') pop(z.boss.x, z.boss.y - 76, 'ARMOR', C.ORANGE, 13);

      if (b.bounces > K.maxBounces) { startReturn(); return; }
      continue;
    }
  }

  // 지형을 뚫고 새어나간 경우에만 복구
  if (b.state === 'FLIGHT' && isOutOfPlay(b.x, b.y)) { recoverBullet(); }
}

/* ------------------------------------------------- 귀환 탄환 */
function updateReturning(dt) {
  const b = G.bullet, p = G.player;
  b.returnT += dt;

  const want = angTo(b.x, b.y, p.x, p.y);
  const cur = Math.atan2(b.dy, b.dx);
  const d = angDelta(cur, want);
  const turn = clamp(d, -K.returnTurn * dt, K.returnTurn * dt);
  const na = cur + turn;
  b.dx = Math.cos(na); b.dy = Math.sin(na);

  // 벽 반사 (도탄 횟수에 포함하지 않는다)
  let remaining = b.speed * dt, guard = 0;
  while (remaining > 0.01 && guard++ < 4) {
    let bestT = remaining, hit = null;
    for (const s of G.zone.segs) {
      if (s.type === 'armor' || s.type === 'shield') continue;
      const t = rayVsSeg(b.x, b.y, b.dx, b.dy, s.ax, s.ay, s.bx, s.by);
      if (t !== null && t < bestT) { bestT = t; hit = s; }
    }
    const travel = Math.min(remaining, bestT);
    b.x += b.dx * travel; b.y += b.dy * travel;
    remaining -= travel;
    if (hit && bestT <= travel + 0.001) {
      const rf = reflect(b.dx, b.dy, hit.ax, hit.ay, hit.bx, hit.by);
      b.dx = rf.x; b.dy = rf.y;
      b.x += rf.nx * 2.5; b.y += rf.ny * 2.5;
      Snd.ricochet(1);
      spark(b.x, b.y, 4, C.CYAN, 160, 0.25, 2);
    }
  }

  const dp = dist(b.x, b.y, p.x, p.y);

  // 사전 신호 — 충돌 0.35초 전
  const eta = dp / b.speed;
  if (!b.signal && eta < K.catchSignal) { b.signal = true; Snd.warn(); }

  // 퍼펙트 캐치 판정
  if (G.catchT > 0 && dp < K.catchRadius) { perfectCatch(); return; }

  // 충돌
  if (dp < p.r + K.bulletR + 2) {
    if (p.dashT > 0 || p.invul > 0) {
      // 회피 성공 — 피해 없이 통과
    } else {
      hurtPlayer(true);
      const s = safeSpotNear(p.x - b.dx * 60, p.y - b.dy * 60);
      dropBullet(s.x, s.y, true);
      return;
    }
  }

  // 빗나감 → 낙하
  const away = (b.dx * (p.x - b.x) + b.dy * (p.y - b.y)) < 0;
  if ((away && dp > 90) || b.returnT > K.returnLife) {
    dropBullet(b.x, b.y);
  }
}

/* ================================================================== 플레이어 */

function hurtPlayer(byBullet) {
  const p = G.player;
  if (p.invul > 0 || !p.alive) return;
  p.hp--;
  p.invul = K.hitInvul;
  p.hitFlash = 1;
  G.zone.damageTaken++; G.run.damageTaken++;
  Snd.playerHit();
  G.killShake(13); G.doFlash(0.4, C.RED); G.stop(0.05);
  ring(p.x, p.y, 8, 70, C.RED, 0.5, 4);
  spark(p.x, p.y, 16, C.RED, 300, 0.5, 3);

  if (byBullet) breakChain('returnHit');
  else if (G.chain > 0) { G.bonusVoid = true; pop(p.x, p.y - 44, 'BONUS LOST', C.RED, 12); }

  if (p.hp <= 0) {
    p.alive = false;
    G.run.deaths++;
    Snd.failJingle();
    G.setState('dead');
  }
}

function updatePlayer(dt) {
  const p = G.player;
  if (!p.alive) return;

  p.invul = Math.max(0, p.invul - dt);
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.hitFlash = Math.max(0, p.hitFlash - dt * 3);
  p.aim = angTo(p.x, p.y, Input.mx, Input.my);

  let ix = (Input.down('KeyD') || Input.down('ArrowRight') ? 1 : 0) - (Input.down('KeyA') || Input.down('ArrowLeft') ? 1 : 0);
  let iy = (Input.down('KeyS') || Input.down('ArrowDown') ? 1 : 0) - (Input.down('KeyW') || Input.down('ArrowUp') ? 1 : 0);
  const m = Math.hypot(ix, iy);
  if (m > 0) { ix /= m; iy /= m; }

  // 대시
  if (p.dashT > 0) {
    p.dashT -= dt;
    p.x += p.dashX * K.dashSpeed * dt;
    p.y += p.dashY * K.dashSpeed * dt;
    if (Math.random() < 0.6) {
      G.zone.particles.push({ x: p.x, y: p.y, vx: rnd(30, -30), vy: rnd(30, -30), life: 0.3, max: 0.3, color: C.CYAN, size: 4, drag: 4 });
    }
  } else {
    p.x += ix * K.playerSpeed * dt;
    p.y += iy * K.playerSpeed * dt;
    if (m > 0) p.walkT += dt * 9;
    if (Input.hit('Space') && p.dashCd <= 0) {
      const dx = m > 0 ? ix : Math.cos(p.aim), dy = m > 0 ? iy : Math.sin(p.aim);
      p.dashX = dx; p.dashY = dy;
      p.dashT = K.dashTime; p.dashCd = K.dashCd;
      Snd.tone(300, 0.16, { type: 'triangle', gain: 0.16, slideTo: 780 });
      ring(p.x, p.y, 4, 34, C.CYAN, 0.28, 2);
    }
  }
  collideBody(p);

  // 발사
  if (Input.mPressed) {
    if (G.bullet.state === 'LOADED') fireBullet();
    else {
      Snd.tone(120, 0.08, { type: 'square', gain: 0.08 });
      pop(p.x, p.y - 32, 'NO AMMO', C.RED, 12);
    }
  }

  // 캐치 / 회수
  if (Input.hit('KeyE')) {
    G.catchT = K.catchWindow;
    if (G.bullet.state === 'DROPPED' && dist(p.x, p.y, G.bullet.x, G.bullet.y) < K.pickupRadius + 18) pickupBullet();
  }
  G.catchT = Math.max(0, G.catchT - dt);

  // 바닥 탄환 자동 회수
  if (G.bullet.state === 'DROPPED' && dist(p.x, p.y, G.bullet.x, G.bullet.y) < K.pickupRadius) pickupBullet();

  // 수집병에게서 탈환
  if (G.bullet.state === 'CARRIED' && G.bullet.carrier) {
    const c = G.bullet.carrier;
    if (dist(p.x, p.y, c.x, c.y) < p.r + c.r + 6) {
      c.carrying = false; c.flee = 1.2; G.bullet.carrier = null;
      dropBullet(p.x, p.y, true);
      pickupBullet();
      pop(p.x, p.y - 30, 'RECLAIMED', C.GOLD, 13);
    }
  }

  // 체인 유지 시간 — 캐치 후 1초 안에 재발사하지 않으면 초기화
  if (G.chainRefireT > 0) {
    G.chainRefireT -= dt;
    if (G.chainRefireT <= 0 && G.chain > 0) {
      G.chain = 0; Snd.setLayer(0);
      pop(p.x, p.y - 34, 'CHAIN LOST', C.RED, 12);
      Snd.chainBreak();
    }
  }
}

/* ================================================================== 적 */

function updateEnemies(dt) {
  const z = G.zone, p = G.player, b = G.bullet;
  for (const e of z.enemies) {
    if (!e.alive) continue;
    e.t += dt;
    e.hitFlash = Math.max(0, e.hitFlash - dt * 3);
    if (e.stun > 0) { e.stun -= dt; collideBody(e); continue; }

    const toP = angTo(e.x, e.y, p.x, p.y);
    const dP = dist(e.x, e.y, p.x, p.y);

    if (e.type === 'chaser') {
      e.facing = toP;
      if (e.windup > 0) {
        e.windup -= dt;
        if (e.windup <= 0) {
          if (dist(e.x, e.y, p.x, p.y) < 52) hurtPlayer(false);
          ring(e.x + Math.cos(toP) * 22, e.y + Math.sin(toP) * 22, 6, 40, C.RED, 0.28, 3);
          Snd.tone(200, 0.1, { type: 'sawtooth', gain: 0.14, slideTo: 90 });
          e.atkCd = 1.1;
        }
      } else if (e.atkCd > 0) {
        e.atkCd -= dt;
        e.x += Math.cos(toP) * e.speed * 0.4 * dt;
        e.y += Math.sin(toP) * e.speed * 0.4 * dt;
      } else if (dP < 40) {
        e.windup = 0.42;
      } else {
        e.x += Math.cos(toP) * e.speed * dt;
        e.y += Math.sin(toP) * e.speed * dt;
      }
    }

    else if (e.type === 'shooter') {
      e.facing = toP;
      const want = 300;
      const move = dP > want + 40 ? 1 : (dP < want - 60 ? -1 : 0);
      if (e.windup <= 0) {
        e.x += Math.cos(toP) * e.speed * move * dt;
        e.y += Math.sin(toP) * e.speed * move * dt;
        // 옆으로 흐르며 조준
        e.x += Math.cos(toP + Math.PI / 2) * e.speed * 0.5 * Math.sin(e.t * 0.8) * dt;
        e.y += Math.sin(toP + Math.PI / 2) * e.speed * 0.5 * Math.sin(e.t * 0.8) * dt;
      }
      e.fireCd -= dt;
      if (e.fireCd <= 0 && e.windup <= 0) { e.windup = 0.5; e.fireCd = rnd(3.0, 2.0); }
      if (e.windup > 0) {
        e.windup -= dt;
        if (e.windup <= 0) {
          z.projectiles.push({ x: e.x + Math.cos(toP) * 18, y: e.y + Math.sin(toP) * 18, dx: Math.cos(toP), dy: Math.sin(toP), speed: 330, r: 6, life: 4 });
          Snd.tone(520, 0.1, { type: 'square', gain: 0.12, slideTo: 220 });
        }
      }
    }

    else if (e.type === 'shield') {
      // 정면을 항상 플레이어 쪽으로 — 측면·후방을 노려야 한다
      e.facing += clamp(angDelta(e.facing, toP), -2.0 * dt, 2.0 * dt);
      if (dP > 120) {
        e.x += Math.cos(toP) * e.speed * dt;
        e.y += Math.sin(toP) * e.speed * dt;
      }
      if (dP < 46 && e.t % 1.4 < dt) hurtPlayer(false);
    }

    else if (e.type === 'collector') {
      if (e.carrying) {
        e.carryT += dt;
        b.x = e.x; b.y = e.y;
        const away = angTo(p.x, p.y, e.x, e.y);
        e.facing = away;
        e.x += Math.cos(away) * e.speed * 0.85 * dt;
        e.y += Math.sin(away) * e.speed * 0.85 * dt;
        if (e.carryT > 6) {                       // 오래 들고 있지 않는다
          e.carrying = false; e.carryT = 0; b.carrier = null;
          dropBullet(e.x, e.y);
        }
      } else if (e.flee > 0) {
        e.flee -= dt;
        const away = angTo(p.x, p.y, e.x, e.y);
        e.x += Math.cos(away) * e.speed * dt;
        e.y += Math.sin(away) * e.speed * dt;
      } else if (b.state === 'DROPPED') {
        const a = angTo(e.x, e.y, b.x, b.y);
        e.facing = a;
        e.x += Math.cos(a) * e.speed * dt;
        e.y += Math.sin(a) * e.speed * dt;
        if (dist(e.x, e.y, b.x, b.y) < e.r + 10) {
          e.carrying = true; e.carryT = 0;
          b.state = 'CARRIED'; b.carrier = e;
          Snd.tone(220, 0.2, { type: 'sawtooth', gain: 0.16, slideTo: 520 });
          pop(e.x, e.y - 28, 'STOLEN', C.RED, 13);
          G.killShake(5);
        }
      } else {
        e.facing = toP;
        const orbit = toP + Math.PI / 2 * Math.sign(Math.sin(e.t * 0.6));
        e.x += Math.cos(orbit) * e.speed * 0.5 * dt;
        e.y += Math.sin(orbit) * e.speed * 0.5 * dt;
      }
    }

    collideBody(e);

    // 접촉 피해 (추격병 제외 — 추격병은 공격 모션으로 처리)
    if (e.type !== 'chaser' && e.type !== 'shield' && dP < p.r + e.r && p.invul <= 0 && p.dashT <= 0) {
      // 수집병은 탈환 판정이 우선이라 피해 없음
    }
  }
}

/* ================================================================== 보스 */

function updateBoss(dt) {
  const b = G.zone.boss, p = G.player, z = G.zone;
  if (!b) return;
  b.t += dt;
  b.hitFlash = Math.max(0, b.hitFlash - dt * 2);

  if (b.dead) {
    b.deadT += dt;
    if (Math.random() < 0.5) spark(b.x + rnd(60, -60), b.y + rnd(60, -60), 2, C.ORANGE, 200, 0.5, 4);
    return;
  }

  // 페이즈에 따른 반사판 전개
  for (const r of z.reflectors) {
    if (r.phase) {
      const want = b.phase >= r.phase;
      if (want !== r.active) { r.active = want; if (want) { Snd.charge(); ring(r.x, r.y, 4, 60, C.IVORY, 0.4, 2); } }
    }
  }

  if (b.stun > 0) {
    b.stun -= dt;
    b.facing += dt * 5.0;
    if (Math.random() < 0.4) spark(b.x + rnd(50, -50), b.y + rnd(50, -50), 1, C.ORANGE, 150, 0.4, 3);
    collideBody(b);
    return;
  }

  const toP = angTo(b.x, b.y, p.x, p.y);
  b.facing += clamp(angDelta(b.facing, toP), -2.1 * dt, 2.1 * dt);

  if (b.phase === 1) {
    // 추적하며 정면 장갑 유지
    const dP = dist(b.x, b.y, p.x, p.y);
    if (dP > 150) {
      b.x += Math.cos(toP) * 74 * dt;
      b.y += Math.sin(toP) * 74 * dt;
    }
    b.atkCd -= dt;
    if (b.atkCd <= 0 && dP < 210) {
      b.windup = 0.6; b.atkCd = 3.0;
    }
    if (b.windup > 0) {
      b.windup -= dt;
      if (b.windup <= 0) {
        explodeRingWarnDone(b, 150);
      }
    }
  }

  else if (b.phase === 2) {
    b.moveT -= dt;
    if (b.moveT <= 0) {
      b.moveT = rnd(2.6, 1.6);
      b.tx = rnd(AR.r - 220, AR.l + 220);
      b.ty = rnd(AR.b - 200, AR.t + 200);
    }
    const a = angTo(b.x, b.y, b.tx, b.ty);
    if (dist(b.x, b.y, b.tx, b.ty) > 20) { b.x += Math.cos(a) * 96 * dt; b.y += Math.sin(a) * 96 * dt; }

    b.atkCd -= dt;
    if (b.atkCd <= 0) { b.windup = 0.55; b.atkCd = 2.5; }
    if (b.windup > 0) {
      b.windup -= dt;
      if (b.windup <= 0) {
        for (let i = -1; i <= 1; i++) {
          const a2 = toP + i * 0.22;
          z.projectiles.push({ x: b.x + Math.cos(a2) * 60, y: b.y + Math.sin(a2) * 60, dx: Math.cos(a2), dy: Math.sin(a2), speed: 340, r: 8, life: 4, big: true });
        }
        Snd.tone(420, 0.16, { type: 'sawtooth', gain: 0.16, slideTo: 140 });
        G.killShake(4);
      }
    }
  }

  else if (b.phase === 3) {
    // 중앙 고정 후 광역 공격
    const a = angTo(b.x, b.y, 640, 356);
    if (dist(b.x, b.y, 640, 356) > 14) { b.x += Math.cos(a) * 120 * dt; b.y += Math.sin(a) * 120 * dt; }
    b.atkCd -= dt;
    if (b.atkCd <= 0) { b.windup = 1.0; b.atkCd = 3.6; b.ringWarn = 1; }
    if (b.windup > 0) {
      b.windup -= dt;
      if (b.windup <= 0) {
        b.ringWarn = 0;
        const n = 18;
        for (let i = 0; i < n; i++) {
          const a2 = i / n * TAU + b.t;
          z.projectiles.push({ x: b.x + Math.cos(a2) * 62, y: b.y + Math.sin(a2) * 62, dx: Math.cos(a2), dy: Math.sin(a2), speed: 260, r: 7, life: 5 });
        }
        Snd.explode(); G.killShake(9);
        ring(b.x, b.y, 40, 200, C.RED, 0.5, 4);
      }
    }
  }

  collideBody(b);
}

function explodeRingWarnDone(b, radius) {
  const p = G.player;
  ring(b.x, b.y, 20, radius, C.RED, 0.42, 5);
  Snd.explode();
  G.killShake(9);
  if (dist(p.x, p.y, b.x, b.y) < radius && p.invul <= 0 && p.dashT <= 0) hurtPlayer(false);
}

/* ================================================================== 기믹 */

function updateGimmicks(dt) {
  const z = G.zone, p = G.player, t = z.time;

  for (const r of z.reflectors) {
    r.flash = Math.max(0, r.flash - dt * 3);
    if (r.rot) r.angle += r.rot * dt;
    if (r.spin > 0) {                            // 회전 스위치에 의한 90° 회전
      const step = Math.min(r.spin, 5.0 * dt);
      r.angle += step; r.spin -= step;
    }
  }

  for (const s of z.switches) s.flash = Math.max(0, s.flash - dt * 3);
  for (const c of z.chargers) c.cool = Math.max(0, c.cool - dt);

  // 압력 가시판
  for (const sp of z.spikes) {
    const ph = ((t + sp.offset) % sp.period) / sp.period;
    sp.phase = ph;
    const wasOut = sp.out;
    sp.out = ph > 0.55 && ph < 0.85;
    if (sp.out && !wasOut) Snd.tone(140, 0.12, { type: 'square', gain: 0.12, slideTo: 420 });
    if (sp.out && p.alive && p.invul <= 0 && p.dashT <= 0 &&
        p.x > sp.x && p.x < sp.x + sp.w && p.y > sp.y && p.y < sp.y + sp.h) hurtPlayer(false);
  }

  // 레이저 셔터
  for (const sh of z.shutters) {
    const ph = ((t + sh.offset) % sh.period) / sh.period;
    const wasClosed = sh.closed;
    sh.closed = ph < sh.duty;
    sh.phase = ph;
    if (sh.closed && !wasClosed) Snd.laser();
    if (sh.closed && p.alive && p.invul <= 0 &&
        p.x > sh.x - p.r && p.x < sh.x + sh.w + p.r && p.y > sh.y - p.r && p.y < sh.y + sh.h + p.r) {
      hurtPlayer(false);
      const cx = sh.x + sh.w / 2;
      p.x += (p.x < cx ? -1 : 1) * 30;
    }
  }

  // 폭발 드럼
  for (const d of z.drums) {
    if (d.dead || d.fuse < 0) continue;
    d.fuse -= dt;
    if (d.fuse <= 0) { d.dead = true; explodeAt(d.x, d.y, K.drumRadius, false); }
  }

  // 적 투사체
  for (let i = z.projectiles.length - 1; i >= 0; i--) {
    const pr = z.projectiles[i];
    pr.life -= dt;
    const nx = pr.x + pr.dx * pr.speed * dt, ny = pr.y + pr.dy * pr.speed * dt;
    if (pr.life <= 0 || isBlocked(nx, ny, pr.r)) {
      spark(pr.x, pr.y, 5, C.RED, 140, 0.25, 2);
      z.projectiles.splice(i, 1);
      continue;
    }
    pr.x = nx; pr.y = ny;
    if (p.alive && p.invul <= 0 && p.dashT <= 0 && dist(pr.x, pr.y, p.x, p.y) < p.r + pr.r) {
      hurtPlayer(false);
      z.projectiles.splice(i, 1);
    }
  }
}

/* ================================================================== 업데이트 */

function updatePlay(dt) {
  const z = G.zone, b = G.bullet, p = G.player;
  z.time += dt;
  G.run.time += dt;

  buildSegments();

  updatePlayer(dt);
  updateEnemies(dt);
  updateBoss(dt);
  updateGimmicks(dt);

  // 탄환
  if (b.state === 'LOADED') { b.x = p.x; b.y = p.y; }
  else if (b.state === 'FLIGHT') {
    b.flight += dt;
    b.trail.push({ x: b.x, y: b.y, t: 0 });
    marchBullet(dt);
    if (b.state === 'FLIGHT') printPoint(b.x, b.y, null);
    if (b.state === 'FLIGHT' && b.flight > K.maxFlight) startReturn();
  } else if (b.state === 'RETURNING') {
    b.trail.push({ x: b.x, y: b.y, t: 0 });
    updateReturning(dt);
  } else if (b.state === 'DROPPED') {
    b.dropGlow = Math.max(0, b.dropGlow - dt * 1.4);
    b.recoverT = Math.max(0, b.recoverT - dt);
    b.spin += dt * 2;
    if (isOutOfPlay(b.x, b.y)) recoverBullet();
  }

  const trailMax = 14 + Math.min(G.chain, 3) * 10;
  for (const pt of b.trail) pt.t += dt;
  while (b.trail.length > trailMax) b.trail.shift();

  // 파티클
  for (let i = z.particles.length - 1; i >= 0; i--) {
    const q = z.particles[i];
    q.life -= dt;
    if (q.life <= 0) { z.particles.splice(i, 1); continue; }
    if (!q.ring) {
      q.x += q.vx * dt; q.y += q.vy * dt;
      const dr = Math.exp(-q.drag * dt);
      q.vx *= dr; q.vy *= dr;
    }
  }
  for (let i = z.pops.length - 1; i >= 0; i--) {
    const q = z.pops[i];
    q.life -= dt; q.y -= dt * 24;
    if (q.life <= 0) z.pops.splice(i, 1);
  }

  updateHints(dt);

  // 클리어 판정
  const enemiesLeft = z.enemies.filter(e => e.alive).length;
  const bossDone = z.boss ? z.boss.dead : true;
  if (!z.cleared && enemiesLeft === 0 && bossDone) {
    z.cleared = true;
    G.setState('clear');
    Snd.clearJingle();
    Snd.setLayer(0);
    G.desat = 1;
    if (z.boss) G.run.bossPrint = G.print;
  }
}

function updateHints(dt) {
  const z = G.zone, L = G.level, b = G.bullet;
  z.hintT = Math.max(0, z.hintT - dt);
  const show = (h) => {
    if (z.shownHints[h.at]) return;
    z.shownHints[h.at] = true;
    z.hintText = h.text; z.hintT = 4.2;
  };
  for (const h of (L.hints || [])) {
    if (h.at === 'start' && z.time > 0.4) show(h);
    if (h.at === 'dropped' && b.state === 'DROPPED') show(h);
    if (h.at === 'returning' && b.state === 'RETURNING') show(h);
  }
}

/* ================================================================== 렌더 */

let canvas, ctx;

function drawBackground() {
  ctx.fillStyle = C.BG;
  ctx.fillRect(0, 0, W, H);

  // 바닥
  ctx.fillStyle = '#10151C';
  ctx.fillRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);

  // 측정선 그리드
  ctx.save();
  ctx.beginPath(); ctx.rect(ARENA.x, ARENA.y, ARENA.w, ARENA.h); ctx.clip();
  ctx.strokeStyle = rgba(C.IVORY, 0.045); ctx.lineWidth = 1;
  for (let x = ARENA.x; x <= AR.r; x += 40) { ctx.beginPath(); ctx.moveTo(x, ARENA.y); ctx.lineTo(x, AR.b); ctx.stroke(); }
  for (let y = ARENA.y; y <= AR.b; y += 40) { ctx.beginPath(); ctx.moveTo(ARENA.x, y); ctx.lineTo(AR.r, y); ctx.stroke(); }
  ctx.strokeStyle = rgba(C.IVORY, 0.10);
  for (let x = ARENA.x; x <= AR.r; x += 200) { ctx.beginPath(); ctx.moveTo(x, ARENA.y); ctx.lineTo(x, AR.b); ctx.stroke(); }
  for (let y = ARENA.y; y <= AR.b; y += 200) { ctx.beginPath(); ctx.moveTo(ARENA.x, y); ctx.lineTo(AR.r, y); ctx.stroke(); }

  // 구역 번호 (바닥 각인)
  const L = G.level;
  text(ctx, String(L.id).padStart(2, '0'), ARENA.x + ARENA.w / 2, ARENA.y + ARENA.h / 2 + 90,
    { size: 260, color: rgba(C.IVORY, 0.035), align: 'center', baseline: 'middle', weight: 900 });
  text(ctx, `TEST CHAMBER / ${L.tag}`, ARENA.x + 18, AR.b - 16,
    { size: 12, color: rgba(C.IVORY, 0.12), spacing: 3 });
  ctx.restore();

  // 외곽 경계
  ctx.strokeStyle = rgba(C.IVORY, 0.28); ctx.lineWidth = 2;
  ctx.strokeRect(ARENA.x + 0.5, ARENA.y + 0.5, ARENA.w - 1, ARENA.h - 1);
  // 코너 마커
  ctx.strokeStyle = C.IVORY; ctx.lineWidth = 3;
  const cl = 22;
  const corners = [[AR.l, AR.t, 1, 1], [AR.r, AR.t, -1, 1], [AR.l, AR.b, 1, -1], [AR.r, AR.b, -1, -1]];
  for (const [cx, cy, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * cl, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy * cl);
    ctx.stroke();
  }
}

function drawWalls() {
  const z = G.zone;
  for (const w of z.walls) {
    if (w.dead) continue;
    // 바닥 그림자로 깊이감
    ctx.save();
    ctx.translate(5, 7);
    drawPoly(ctx, w.poly, 'rgba(0,0,0,0.45)');
    ctx.restore();

    if (w.type === 'cracked') {
      drawPoly(ctx, w.poly, '#2C2530', rgba(C.IVORY, 0.5), 2);
      // 균열 표시
      const p = w.poly;
      const cx = p.reduce((a, q) => a + q[0], 0) / p.length;
      const cy = p.reduce((a, q) => a + q[1], 0) / p.length;
      ctx.save();
      ctx.strokeStyle = rgba(C.IVORY, 0.55); ctx.lineWidth = 1.5;
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * TAU + 0.4;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * 26, cy + Math.sin(a) * 34);
        ctx.stroke();
      }
      ctx.restore();
      text(ctx, 'FRAGILE', cx, cy + 52, { size: 9, color: rgba(C.IVORY, 0.45), align: 'center', spacing: 2 });
    } else {
      drawPoly(ctx, w.poly, C.CONCRETE, rgba(C.IVORY, 0.22), 2);
      // 상단 하이라이트
      const p = w.poly;
      ctx.save();
      ctx.strokeStyle = rgba(C.IVORY, 0.12); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); ctx.lineTo(p[1][0], p[1][1]); ctx.stroke();
      ctx.restore();
    }
  }
}

function drawFloorGimmicks() {
  const z = G.zone;

  // 압력 가시판
  for (const sp of z.spikes) {
    const warn = sp.phase > 0.35 && sp.phase <= 0.55;
    ctx.save();
    ctx.fillStyle = sp.out ? rgba(C.RED, 0.20) : (warn ? rgba(C.RED, 0.10 + 0.10 * Math.sin(G.t * 26)) : rgba(C.IVORY, 0.03));
    ctx.fillRect(sp.x, sp.y, sp.w, sp.h);
    ctx.strokeStyle = sp.out ? C.RED : rgba(C.RED, warn ? 0.7 : 0.28);
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(sp.x + 1, sp.y + 1, sp.w - 2, sp.h - 2);
    ctx.setLineDash([]);
    if (sp.out) {
      for (let x = sp.x + 18; x < sp.x + sp.w - 6; x += 26) {
        for (let y = sp.y + 18; y < sp.y + sp.h - 6; y += 26) {
          drawPoly(ctx, [[x, y + 9], [x + 5, y - 9], [x + 10, y + 9]], C.RED, rgba(C.IVORY, 0.5), 1);
        }
      }
    }
    text(ctx, 'PRESSURE', sp.x + sp.w / 2, sp.y + 13, { size: 9, color: rgba(C.RED, 0.6), align: 'center', spacing: 2 });
    ctx.restore();
  }

  // 충전 장치
  for (const c of z.chargers) {
    const col = c.type === 'electric' ? C.CYAN : C.ORANGE;
    const on = c.cool <= 0;
    ctx.save();
    ctx.globalAlpha = on ? 1 : 0.3;
    circle(ctx, c.x, c.y, c.r + 6, null, rgba(col, 0.25), 1);
    circle(ctx, c.x, c.y, c.r, rgba(col, 0.10), col, 2);
    const a = G.t * (c.type === 'electric' ? 3 : 1.4);
    for (let i = 0; i < 3; i++) {
      const aa = a + i / 3 * TAU;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r - 7, aa, aa + 0.8);
      ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.stroke();
    }
    circle(ctx, c.x, c.y, 4 + Math.sin(G.t * 6) * 1.2, col);
    text(ctx, c.type === 'electric' ? 'ELEC' : 'EXPL', c.x, c.y + c.r + 16,
      { size: 9, color: rgba(col, 0.75), align: 'center', spacing: 2 });
    ctx.restore();
  }

  // 회전 스위치
  for (const s of z.switches) {
    ctx.save();
    circle(ctx, s.x, s.y, s.r + 5, null, rgba(C.IVORY, 0.2), 1);
    circle(ctx, s.x, s.y, s.r, rgba(C.IVORY, 0.08 + s.flash * 0.4), C.IVORY, 2);
    ctx.translate(s.x, s.y); ctx.rotate(G.t * 0.8 + s.flash * 6);
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      line(ctx, 0, -s.r + 4, 0, -s.r - 6, C.IVORY, 2);
    }
    ctx.restore();
    text(ctx, 'ROTATE', s.x, s.y + s.r + 18, { size: 9, color: rgba(C.IVORY, 0.4), align: 'center', spacing: 2 });
  }
}

function drawReflectors() {
  for (const r of G.zone.reflectors) {
    if (!r.active) continue;
    const c = Math.cos(r.angle), s = Math.sin(r.angle), h = r.len / 2;
    const ax = r.x - c * h, ay = r.y - s * h, bx = r.x + c * h, by = r.y + s * h;
    ctx.save();
    ctx.shadowColor = rgba(C.IVORY, 0.5); ctx.shadowBlur = 8 + r.flash * 20;
    line(ctx, ax + 4, ay + 6, bx + 4, by + 6, 'rgba(0,0,0,0.4)', 8);
    line(ctx, ax, ay, bx, by, rgba(C.IVORY, 0.85 + r.flash * 0.15), 7);
    line(ctx, ax, ay, bx, by, r.flash > 0.1 ? C.GOLD : rgba(C.IVORY, 0.55), 3);
    ctx.restore();
    circle(ctx, r.x, r.y, 5, C.CONCRETE, rgba(C.IVORY, 0.7), 2);
    if (r.rot) {
      ctx.save();
      ctx.setLineDash([4, 5]);
      circle(ctx, r.x, r.y, h + 8, null, rgba(C.IVORY, 0.12), 1);
      ctx.restore();
    }
  }
}

function drawShutters() {
  for (const sh of G.zone.shutters) {
    const closing = !sh.closed && sh.phase > sh.duty && sh.phase < sh.duty + 0.12;
    ctx.save();
    if (sh.closed) {
      ctx.fillStyle = rgba(C.RED, 0.20);
      ctx.fillRect(sh.x, sh.y, sh.w, sh.h);
      ctx.strokeStyle = C.RED; ctx.lineWidth = 2;
      ctx.strokeRect(sh.x, sh.y, sh.w, sh.h);
      for (let y = sh.y + 6; y < sh.y + sh.h; y += 12) {
        line(ctx, sh.x + 3, y, sh.x + sh.w - 3, y, rgba(C.RED, 0.75), 2);
      }
      ctx.shadowColor = C.RED; ctx.shadowBlur = 14;
      ctx.strokeRect(sh.x, sh.y, sh.w, sh.h);
    } else {
      ctx.strokeStyle = rgba(C.RED, closing ? 0.75 : 0.22);
      ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
      ctx.strokeRect(sh.x, sh.y, sh.w, sh.h);
    }
    ctx.restore();
    text(ctx, 'SHUTTER', sh.x + sh.w / 2, sh.y - 8, { size: 9, color: rgba(C.RED, 0.5), align: 'center', spacing: 2 });
  }
}

function drawDrums() {
  for (const d of G.zone.drums) {
    if (d.dead) continue;
    const fusing = d.fuse >= 0;
    const blink = fusing ? (Math.sin(G.t * 40) * 0.5 + 0.5) : 0;
    ctx.save();
    circle(ctx, d.x + 3, d.y + 5, d.r, 'rgba(0,0,0,0.45)');
    circle(ctx, d.x, d.y, d.r, fusing ? rgba(C.ORANGE, 0.3 + blink * 0.5) : '#3A2A20', C.ORANGE, 2);
    line(ctx, d.x - d.r + 4, d.y - 5, d.x + d.r - 4, d.y - 5, rgba(C.ORANGE, 0.5), 2);
    line(ctx, d.x - d.r + 4, d.y + 5, d.x + d.r - 4, d.y + 5, rgba(C.ORANGE, 0.5), 2);
    if (fusing) {
      ctx.setLineDash([6, 8]);
      circle(ctx, d.x, d.y, K.drumRadius * (1 - d.fuse / K.drumFuse * 0.35), null, rgba(C.RED, 0.5 + blink * 0.4), 2);
    }
    ctx.restore();
  }
}

function drawEnemy(e) {
  const flash = e.hitFlash;
  ctx.save();
  circle(ctx, e.x + 3, e.y + 5, e.r, 'rgba(0,0,0,0.45)');

  const col = flash > 0.02 ? C.IVORY : C.RED;

  if (e.type === 'chaser') {
    const wind = e.windup > 0;
    if (wind) {
      circle(ctx, e.x, e.y, 52, null, rgba(C.RED, 0.4 + Math.sin(G.t * 30) * 0.3), 2);
      const t = 1 - e.windup / 0.42;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 52, -Math.PI / 2, -Math.PI / 2 + t * TAU);
      ctx.strokeStyle = C.RED; ctx.lineWidth = 3; ctx.stroke();
    }
    ctx.translate(e.x, e.y); ctx.rotate(e.facing);
    drawPoly(ctx, [[14, 0], [-9, -11], [-5, 0], [-9, 11]], rgba(col, 0.9), C.IVORY, 1.5);
  }

  else if (e.type === 'shooter') {
    if (e.windup > 0) {
      const len = 700;
      line(ctx, e.x, e.y, e.x + Math.cos(e.facing) * len, e.y + Math.sin(e.facing) * len,
        rgba(C.RED, 0.35 + Math.sin(G.t * 30) * 0.25), 2, [10, 8]);
    }
    ctx.translate(e.x, e.y); ctx.rotate(e.facing);
    drawPoly(ctx, [[-10, -12], [8, -8], [14, 0], [8, 8], [-10, 12]], rgba(col, 0.85), C.IVORY, 1.5);
    ctx.fillStyle = C.IVORY; ctx.fillRect(6, -2, 12, 4);
  }

  else if (e.type === 'shield') {
    ctx.translate(e.x, e.y); ctx.rotate(e.facing);
    circle(ctx, 0, 0, e.r, rgba(col, 0.85), C.IVORY, 1.5);
    // 방패
    ctx.save();
    ctx.shadowColor = C.IVORY; ctx.shadowBlur = 6 + (e.hitFlash || 0) * 22;
    ctx.beginPath();
    ctx.moveTo(e.shieldDist, -e.shieldHalf);
    ctx.lineTo(e.shieldDist, e.shieldHalf);
    ctx.strokeStyle = e.hitFlash > 0.02 ? C.GOLD : rgba(C.IVORY, 0.9);
    ctx.lineWidth = 7; ctx.stroke();
    ctx.restore();
  }

  else if (e.type === 'collector') {
    ctx.translate(e.x, e.y); ctx.rotate(e.facing);
    drawPoly(ctx, [[12, 0], [0, -13], [-11, -7], [-11, 7], [0, 13]], rgba(col, 0.85), C.IVORY, 1.5);
    // 집게
    line(ctx, 10, -6, 20, -10, C.IVORY, 2);
    line(ctx, 10, 6, 20, 10, C.IVORY, 2);
    ctx.restore();
    if (e.carrying) {
      circle(ctx, e.x, e.y - 22, 5, C.GOLD, C.IVORY, 1);
      text(ctx, 'STOLEN', e.x, e.y - 34, { size: 10, color: C.GOLD, align: 'center', spacing: 2 });
    }
    return;
  }

  ctx.restore();
}

function drawBoss() {
  const b = G.zone.boss;
  if (!b) return;
  const wp = weakPointPos(b);

  ctx.save();
  circle(ctx, b.x + 5, b.y + 8, b.r, 'rgba(0,0,0,0.5)');

  if (b.dead) {
    ctx.globalAlpha = Math.max(0, 1 - b.deadT / 1.6);
  }

  // 몸체
  circle(ctx, b.x, b.y, b.r, '#1B222C', rgba(C.IVORY, 0.25), 2);

  // 정면 장갑 호
  const span = Math.PI * 2 - 1.4;
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r, b.facing - span / 2, b.facing + span / 2);
  ctx.strokeStyle = b.hitFlash > 0.02 ? C.IVORY : C.CONCRETE;
  ctx.lineWidth = 13; ctx.stroke();
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r, b.facing - span / 2, b.facing + span / 2);
  ctx.strokeStyle = rgba(C.IVORY, 0.35); ctx.lineWidth = 2; ctx.stroke();

  // 약점
  if (!b.dead) {
    const blink = 0.55 + 0.45 * Math.sin(G.t * 6);
    ctx.save();
    ctx.shadowColor = C.ORANGE; ctx.shadowBlur = 18 * blink;
    circle(ctx, wp.x, wp.y, wp.r, rgba(C.ORANGE, 0.35 + blink * 0.4), C.ORANGE, 3);
    circle(ctx, wp.x, wp.y, wp.r * 0.45, C.ORANGE);
    ctx.restore();
  }

  // 코어
  circle(ctx, b.x, b.y, 18, rgba(C.RED, b.stun > 0 ? 0.2 : 0.6), rgba(C.IVORY, 0.4), 2);
  text(ctx, String(b.weak), b.x, b.y + 1, { size: 18, color: C.IVORY, align: 'center', baseline: 'middle' });

  // 조준 방향 표시선
  line(ctx, b.x, b.y, b.x + Math.cos(b.facing) * (b.r + 16), b.y + Math.sin(b.facing) * (b.r + 16), rgba(C.RED, 0.4), 2);

  // 광역 공격 예고
  if (b.ringWarn && b.windup > 0) {
    const t = 1 - b.windup / 1.0;
    circle(ctx, b.x, b.y, 40 + t * 200, null, rgba(C.RED, 0.25 + 0.35 * Math.sin(G.t * 24)), 3);
  }
  if (b.phase === 1 && b.windup > 0) {
    const t = 1 - b.windup / 0.6;
    circle(ctx, b.x, b.y, 150, null, rgba(C.RED, 0.3), 2);
    ctx.beginPath();
    ctx.arc(b.x, b.y, 150, -Math.PI / 2, -Math.PI / 2 + t * TAU);
    ctx.strokeStyle = C.RED; ctx.lineWidth = 4; ctx.stroke();
  }
  if (b.stun > 0) {
    text(ctx, 'STUNNED', b.x, b.y - b.r - 20, { size: 12, color: C.ORANGE, align: 'center', spacing: 3 });
  }
  ctx.restore();
}

function drawPlayer() {
  const p = G.player;
  if (!p.alive) return;
  ctx.save();
  circle(ctx, p.x + 3, p.y + 6, p.r, 'rgba(0,0,0,0.45)');

  const blink = p.invul > 0 && Math.floor(p.invul * 20) % 2 === 0;
  ctx.globalAlpha = blink ? 0.35 : 1;

  // 대시 잔상
  if (p.dashT > 0) {
    for (let i = 1; i <= 3; i++) {
      ctx.globalAlpha = 0.14 * (4 - i);
      circle(ctx, p.x - p.dashX * i * 13, p.y - p.dashY * i * 13, p.r * (1 - i * 0.13), rgba(C.CYAN, 0.5));
    }
    ctx.globalAlpha = blink ? 0.35 : 1;
  }

  ctx.save();
  ctx.translate(p.x, p.y); ctx.rotate(p.aim);
  ctx.shadowColor = C.CYAN; ctx.shadowBlur = 12;
  drawPoly(ctx, [[15, 0], [-8, -11], [-4, 0], [-8, 11]],
    p.hitFlash > 0.02 ? C.IVORY : C.CYAN, C.IVORY, 1.5);
  // 총구
  ctx.fillStyle = C.IVORY;
  ctx.fillRect(10, -2.5, 12, 5);
  ctx.restore();

  // 장전 표시 링
  if (G.bullet.state === 'LOADED') {
    circle(ctx, p.x, p.y, p.r + 7, null, rgba(C.GOLD, 0.55 + Math.sin(G.t * 5) * 0.2), 2);
  }
  // 캐치 판정 범위
  if (G.catchT > 0) {
    circle(ctx, p.x, p.y, K.catchRadius, null, rgba(C.CYAN, 0.7), 3);
  } else if (G.bullet.state === 'RETURNING') {
    ctx.save(); ctx.setLineDash([5, 7]);
    circle(ctx, p.x, p.y, K.catchRadius, null, rgba(C.CYAN, 0.28), 2);
    ctx.restore();
  }
  ctx.restore();
}

function drawBullet() {
  const b = G.bullet;
  const chainLv = Math.min(G.chain, 3);

  // 잔상
  if (b.trail.length > 1 && (b.state === 'FLIGHT' || b.state === 'RETURNING')) {
    const col = b.state === 'RETURNING' ? C.CYAN : C.GOLD;
    for (let i = 1; i < b.trail.length; i++) {
      const a = i / b.trail.length;
      line(ctx, b.trail[i - 1].x, b.trail[i - 1].y, b.trail[i].x, b.trail[i].y,
        rgba(col, a * (0.35 + chainLv * 0.18)), 1 + a * (3 + chainLv * 1.6));
    }
  }

  if (b.state === 'LOADED') return;

  if (b.state === 'DROPPED' || b.state === 'CARRIED') {
    const px = b.x, py = b.y;
    // 금색 빛기둥
    ctx.save();
    const g = ctx.createLinearGradient(px, py - 90, px, py);
    g.addColorStop(0, rgba(C.GOLD, 0));
    g.addColorStop(1, rgba(C.GOLD, 0.30));
    ctx.fillStyle = g;
    ctx.fillRect(px - 9, py - 90, 18, 90);
    ctx.restore();

    const pulse = 0.5 + 0.5 * Math.sin(G.t * 4);
    circle(ctx, px, py, 16 + pulse * 8, null, rgba(C.GOLD, 0.25), 2);
    circle(ctx, px, py, K.pickupRadius, null, rgba(C.GOLD, 0.12), 1);
    ctx.save();
    ctx.shadowColor = C.GOLD; ctx.shadowBlur = 16;
    circle(ctx, px, py, K.bulletR, C.GOLD, C.IVORY, 1.5);
    ctx.restore();

    if (b.recoverT > 0) text(ctx, 'RECOVERED', px, py - 100, { size: 11, color: C.GOLD, align: 'center', spacing: 2 });

    // 거리 표시
    const d = Math.round(dist(px, py, G.player.x, G.player.y));
    if (d > 90) text(ctx, `${d}`, px, py - 100, { size: 12, color: rgba(C.GOLD, 0.7), align: 'center', spacing: 1 });
    return;
  }

  // 비행/귀환
  const returning = b.state === 'RETURNING';
  const col = returning ? C.CYAN : C.GOLD;
  ctx.save();
  ctx.shadowColor = col; ctx.shadowBlur = 14 + chainLv * 8;
  const blinkSig = returning && b.signal && Math.floor(G.t * 24) % 2 === 0;
  circle(ctx, b.x, b.y, K.bulletR + (blinkSig ? 3 : 0), blinkSig ? C.IVORY : col, C.IVORY, 1.5);
  ctx.restore();

  if (b.element) {
    const ec = b.element === 'electric' ? C.CYAN : C.ORANGE;
    ctx.save();
    ctx.setLineDash([3, 4]);
    circle(ctx, b.x, b.y, 13 + Math.sin(G.t * 20) * 2, null, ec, 2);
    ctx.restore();
  }
  if (returning) {
    // 귀환 방향 화살
    const a = Math.atan2(b.dy, b.dx);
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(a);
    drawPoly(ctx, [[12, 0], [4, -5], [4, 5]], rgba(C.CYAN, 0.8));
    ctx.restore();
  }
}

/* 조준선 — 첫 충돌 지점과 1회 반사까지만 */
function drawAimLine() {
  const p = G.player, b = G.bullet;
  if (b.state !== 'LOADED' || !p.alive) return;

  let x = p.x, y = p.y, dx = Math.cos(p.aim), dy = Math.sin(p.aim);
  let willHit = false;
  const pts = [{ x, y }];

  for (let seg = 0; seg < 2; seg++) {
    let bestT = 3000, hit = null;
    for (const s of G.zone.segs) {
      const t = rayVsSeg(x, y, dx, dy, s.ax, s.ay, s.bx, s.by);
      if (t !== null && t < bestT) { bestT = t; hit = s; }
    }
    let eT = bestT, eHit = null;
    for (const e of G.zone.enemies) {
      if (!e.alive) continue;
      const t = rayVsCircle(x, y, dx, dy, e.x, e.y, e.r + K.bulletR);
      if (t !== null && t < eT) { eT = t; eHit = e; }
    }
    if (G.zone.boss && !G.zone.boss.dead) {
      const wp = weakPointPos(G.zone.boss);
      const t = rayVsCircle(x, y, dx, dy, wp.x, wp.y, wp.r + K.bulletR);
      if (t !== null && t < eT) { eT = t; eHit = 'weak'; }
    }

    const t = Math.min(bestT, eT);
    x += dx * t; y += dy * t;
    pts.push({ x, y });

    if (eHit) { willHit = true; break; }
    if (!hit) break;
    if (seg === 0) {
      const rf = reflect(dx, dy, hit.ax, hit.ay, hit.bx, hit.by);
      dx = rf.x; dy = rf.y;
      x += rf.nx * 2; y += rf.ny * 2;
    } else break;
  }

  ctx.save();
  ctx.setLineDash([9, 7]);
  ctx.lineDashOffset = -G.t * 30;
  for (let i = 1; i < pts.length; i++) {
    const first = i === 1;
    ctx.beginPath();
    ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
    ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = willHit && i === pts.length - 1 ? rgba(C.RED, 0.85) : rgba(C.GOLD, first ? 0.5 : 0.3);
    ctx.lineWidth = first ? 2 : 1.5;
    ctx.stroke();
  }
  ctx.restore();

  // 충돌 지점 표기
  if (pts.length > 1) {
    const hp = pts[1];
    const col = willHit && pts.length === 2 ? C.RED : C.GOLD;
    circle(ctx, hp.x, hp.y, 5, null, rgba(col, 0.8), 2);
    line(ctx, hp.x - 8, hp.y, hp.x + 8, hp.y, rgba(col, 0.4), 1);
    line(ctx, hp.x, hp.y - 8, hp.x, hp.y + 8, rgba(col, 0.4), 1);
  }
  const last = pts[pts.length - 1];
  if (willHit) circle(ctx, last.x, last.y, 9, null, rgba(C.RED, 0.9), 2);
}

function drawProjectiles() {
  for (const pr of G.zone.projectiles) {
    ctx.save();
    ctx.shadowColor = C.RED; ctx.shadowBlur = 10;
    circle(ctx, pr.x, pr.y, pr.r, C.RED, rgba(C.IVORY, 0.6), 1.5);
    line(ctx, pr.x - pr.dx * 14, pr.y - pr.dy * 14, pr.x, pr.y, rgba(C.RED, 0.4), 3);
    ctx.restore();
  }
}

function drawParticles() {
  for (const q of G.zone.particles) {
    const a = q.life / q.max;
    if (q.ring) {
      const r = lerp(q.r0, q.r1, easeOut(1 - a));
      circle(ctx, q.x, q.y, r, null, rgba(q.color, a * 0.85), q.lw * a);
    } else {
      ctx.globalAlpha = a;
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
      ctx.globalAlpha = 1;
    }
  }
  for (const q of G.zone.pops) {
    const a = clamp(q.life / q.max * 1.6, 0, 1);
    text(ctx, q.str, q.x, q.y, { size: q.size, color: q.color, align: 'center', alpha: a, spacing: 1 });
  }
}

/* ================================================================== HUD */

function drawHUD() {
  const p = G.player, b = G.bullet, L = G.level, z = G.zone;

  // 상단 바
  ctx.fillStyle = 'rgba(11,15,20,0.92)';
  ctx.fillRect(0, 0, W, ARENA.y);
  line(ctx, 0, ARENA.y - 1, W, ARENA.y - 1, rgba(C.IVORY, 0.15), 1);

  // 체력
  for (let i = 0; i < 3; i++) {
    const x = 26 + i * 26, y = 28;
    const on = i < p.hp;
    ctx.save();
    if (on) { ctx.shadowColor = C.CYAN; ctx.shadowBlur = 8; }
    drawPoly(ctx, [[x, y - 10], [x + 9, y], [x, y + 10], [x - 9, y]],
      on ? C.CYAN : 'rgba(255,255,255,0.06)', on ? C.IVORY : rgba(C.IVORY, 0.25), 1.5);
    ctx.restore();
  }
  text(ctx, 'HP', 108, 33, { size: 11, color: rgba(C.IVORY, 0.45), spacing: 2 });

  // 구역 정보
  text(ctx, `${L.code}`, 175, 22, { size: 11, color: rgba(C.IVORY, 0.45), spacing: 3 });
  text(ctx, `${L.name}`, 175, 42, { size: 17, color: C.IVORY, spacing: 1 });

  const left = z.enemies.filter(e => e.alive).length;
  if (!L.boss) {
    text(ctx, 'TARGETS', 300, 22, { size: 11, color: rgba(C.IVORY, 0.45), spacing: 3 });
    text(ctx, `${z.enemies.length - left} / ${z.enemies.length}`, 300, 42, { size: 17, color: left ? C.IVORY : C.GOLD });
  }

  // 시간
  const tt = z.time;
  const over = tt > L.targetTime;
  text(ctx, 'TIME', 420, 22, { size: 11, color: rgba(C.IVORY, 0.45), spacing: 3 });
  text(ctx, `${tt.toFixed(1)}`, 420, 42, { size: 17, color: over ? C.RED : C.IVORY });
  text(ctx, `/ ${L.targetTime}s`, 470, 42, { size: 12, color: rgba(C.IVORY, 0.35) });

  // 보스 체력 (상단 중앙)
  if (z.boss) {
    const bw = 300, bx = W / 2 - bw / 2, by = 30;
    text(ctx, 'EXPERIMENT ZERO', W / 2, 16, { size: 11, color: rgba(C.IVORY, 0.5), align: 'center', spacing: 4 });
    for (let i = 0; i < 3; i++) {
      const seg = bw / 3 - 6;
      const x = bx + i * (bw / 3);
      const alive = i < z.boss.weak;
      ctx.fillStyle = alive ? C.ORANGE : 'rgba(255,255,255,0.08)';
      ctx.fillRect(x, by, seg, 9);
      ctx.strokeStyle = rgba(C.IVORY, 0.3); ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, by + 0.5, seg - 1, 8);
    }
    text(ctx, `PHASE ${z.boss.phase}`, bx + bw + 12, by + 9, { size: 12, color: rgba(C.IVORY, 0.6) });
  }

  // 체인 (우상단)
  const cl = Math.min(G.chain, 3);
  text(ctx, 'ONE CHAIN', W - 30, 20, { size: 11, color: rgba(C.IVORY, 0.45), align: 'right', spacing: 3 });
  ctx.save();
  for (let i = 0; i < 3; i++) {
    const x = W - 30 - i * 22, y = 38;
    const on = i < cl;
    if (on) { ctx.shadowColor = C.CYAN; ctx.shadowBlur = 10; } else ctx.shadowBlur = 0;
    circle(ctx, x - 8, y, 7, on ? C.CYAN : 'rgba(255,255,255,0.05)', on ? C.IVORY : rgba(C.IVORY, 0.2), 1.5);
  }
  ctx.restore();
  if (cl > 0) {
    const label = cl === 1 ? 'DMG ×1.25' : cl === 2 ? 'SPEED +10%' : 'PIERCE 1';
    text(ctx, label, W - 105, 42, { size: 11, color: C.CYAN, align: 'right', spacing: 1 });
  }
  if (G.chainRefireT > 0) {
    const w = 60 * (G.chainRefireT / K.chainRefire);
    ctx.fillStyle = rgba(C.CYAN, 0.7);
    ctx.fillRect(W - 30 - 60, 50, w, 3);
    text(ctx, 'REFIRE', W - 95, 52, { size: 9, color: rgba(C.CYAN, 0.7), align: 'right', spacing: 1 });
  }

  /* ---------------------------------------------- 하단: 탄환 상태 */
  ctx.fillStyle = 'rgba(11,15,20,0.92)';
  ctx.fillRect(0, AR.b, W, H - AR.b);
  line(ctx, 0, AR.b, W, AR.b, rgba(C.IVORY, 0.15), 1);

  const stateInfo = {
    LOADED:    { word: 'LOADED',    col: C.GOLD, sub: '발사 가능' },
    FLIGHT:    { word: 'IN FLIGHT', col: C.GOLD, sub: `BOUNCE ${G.bullet.bounces}/${K.maxBounces}` },
    RETURNING: { word: 'RETURNING', col: C.CYAN, sub: 'E 로 캐치' },
    DROPPED:   { word: 'DROPPED',   col: C.RED,  sub: '회수 필요' },
    CARRIED:   { word: 'STOLEN',    col: C.RED,  sub: '수집병 처치' },
  }[b.state];

  const cx = W / 2, cy = AR.b + 32;
  ctx.save();
  ctx.shadowColor = stateInfo.col; ctx.shadowBlur = 12;
  circle(ctx, cx - 92, cy, 9, b.state === 'LOADED' ? C.GOLD : 'rgba(255,255,255,0.08)',
    stateInfo.col, 2);
  ctx.restore();
  text(ctx, stateInfo.word, cx - 72, cy - 2, { size: 20, color: stateInfo.col, baseline: 'middle', spacing: 3 });
  text(ctx, stateInfo.sub, cx - 72, cy + 17, { size: 11, color: rgba(C.IVORY, 0.45), baseline: 'middle', spacing: 1 });

  // 대시 쿨다운
  const dx0 = cx + 130;
  text(ctx, 'DASH', dx0, cy - 8, { size: 11, color: rgba(C.IVORY, 0.45), spacing: 2 });
  const dw = 90, dr = 1 - p.dashCd / K.dashCd;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(dx0, cy + 2, dw, 8);
  ctx.fillStyle = p.dashCd <= 0 ? C.CYAN : rgba(C.CYAN, 0.45);
  ctx.fillRect(dx0, cy + 2, dw * clamp(dr, 0, 1), 8);
  ctx.strokeStyle = rgba(C.IVORY, 0.25); ctx.lineWidth = 1;
  ctx.strokeRect(dx0 + 0.5, cy + 2.5, dw - 1, 7);
  text(ctx, 'SPACE', dx0 + dw + 10, cy + 10, { size: 10, color: rgba(C.IVORY, 0.35), spacing: 1 });

  // 조작 안내
  text(ctx, 'WASD 이동   ·   마우스 조준   ·   좌클릭 발사   ·   SPACE 대시   ·   E 캐치/회수   ·   ESC 설정',
    30, cy + 6, { size: 11, color: rgba(C.IVORY, 0.28), baseline: 'middle', spacing: 0.5 });

  // 튜토리얼 힌트
  if (z.hintT > 0 && z.hintText) {
    const a = clamp(z.hintT / 0.6, 0, 1);
    const tw = ctx.measureText(z.hintText).width;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(11,15,20,0.85)';
    ctx.fillRect(W / 2 - 260, AR.b - 74, 520, 40);
    ctx.strokeStyle = rgba(C.GOLD, 0.5); ctx.lineWidth = 1;
    ctx.strokeRect(W / 2 - 260, AR.b - 74, 520, 40);
    text(ctx, z.hintText, W / 2, AR.b - 54, { size: 14, color: C.GOLD, align: 'center', baseline: 'middle', alpha: a });
    ctx.restore();
  }
}

/* ================================================================== SHOTPRINT */

function drawShotprint(print, progress, alpha = 1, box = null) {
  if (!print) return;
  const all = print.shots;
  let total = 0;
  for (const s of all) total += Math.max(0, s.pts.length - 1);
  let budget = total * progress;

  ctx.save();
  ctx.globalAlpha = alpha;
  if (box) {
    // 결과 화면용 축소 배치
    ctx.translate(box.x, box.y);
    ctx.scale(box.s, box.s);
    ctx.translate(-ARENA.x, -ARENA.y);
    ctx.strokeStyle = rgba(C.IVORY, 0.15); ctx.lineWidth = 2 / box.s;
    ctx.strokeRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
  }

  for (const s of all) {
    const n = Math.max(0, s.pts.length - 1);
    const take = clamp(budget, 0, n);
    budget -= n;
    if (take <= 0) continue;

    ctx.save();
    ctx.shadowColor = C.GOLD; ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(s.pts[0].x, s.pts[0].y);
    const full = Math.floor(take);
    for (let i = 1; i <= full && i < s.pts.length; i++) ctx.lineTo(s.pts[i].x, s.pts[i].y);
    const frac = take - full;
    if (frac > 0 && full + 1 < s.pts.length) {
      const a = s.pts[full], b2 = s.pts[full + 1];
      ctx.lineTo(lerp(a.x, b2.x, frac), lerp(a.y, b2.y, frac));
    }
    ctx.strokeStyle = C.GOLD; ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    // 지점 표식
    const drawnLen = take;
    let acc = 0;
    for (const m of s.marks) {
      // 표식 위치가 이미 그려진 구간 안에 있을 때만 표시
      let idx = s.pts.findIndex(q => q.x === m.x && q.y === m.y);
      if (idx < 0) idx = 0;
      if (idx > drawnLen + 0.5) continue;
      if (m.type === 'shot') {
        circle(ctx, m.x, m.y, 7, rgba(C.GOLD, 0.35), C.GOLD, 2.5);
        circle(ctx, m.x, m.y, 2.5, C.IVORY);
      } else if (m.type === 'bounce') {
        ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(Math.PI / 4);
        ctx.strokeStyle = C.GOLD; ctx.lineWidth = 2;
        ctx.strokeRect(-4, -4, 8, 8);
        ctx.restore();
      } else if (m.type === 'hit') {
        ctx.save();
        ctx.shadowColor = C.RED; ctx.shadowBlur = 10;
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * TAU;
          line(ctx, m.x + Math.cos(a) * 3, m.y + Math.sin(a) * 3,
            m.x + Math.cos(a) * 10, m.y + Math.sin(a) * 10, C.RED, 2);
        }
        circle(ctx, m.x, m.y, 3.5, C.RED);
        ctx.restore();
      } else if (m.type === 'catch') {
        ctx.save();
        ctx.shadowColor = C.CYAN; ctx.shadowBlur = 12;
        circle(ctx, m.x, m.y, 9, null, C.CYAN, 2.5);
        circle(ctx, m.x, m.y, 3, C.CYAN);
        ctx.restore();
      }
      acc++;
    }
  }

  // 마지막 공격 = 가장 밝은 종점
  const lastShot = all[all.length - 1];
  if (lastShot && progress >= 0.999) {
    const e = lastShot.pts[lastShot.pts.length - 1];
    ctx.save();
    ctx.shadowColor = C.GOLD; ctx.shadowBlur = 30;
    circle(ctx, e.x, e.y, 12, rgba(C.GOLD, 0.5), C.IVORY, 3);
    circle(ctx, e.x, e.y, 5, C.IVORY);
    ctx.restore();
  }
  ctx.restore();
}

/* ================================================================== 오버레이 */

function drawIntro() {
  const L = G.level, t = G.stateT;
  const a = clamp(t < 0.3 ? t / 0.3 : (t > 1.5 ? 1 - (t - 1.5) / 0.4 : 1), 0, 1);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(11,15,20,0.82)';
  ctx.fillRect(0, 0, W, H);

  const cy = H / 2;
  line(ctx, W / 2 - 220, cy - 62, W / 2 + 220, cy - 62, rgba(C.GOLD, 0.6), 2);
  text(ctx, L.code, W / 2, cy - 34, { size: 13, color: C.GOLD, align: 'center', spacing: 8 });
  text(ctx, L.name, W / 2, cy + 18, { size: 52, color: C.IVORY, align: 'center', spacing: 6 });
  text(ctx, L.brief, W / 2, cy + 50, { size: 14, color: rgba(C.IVORY, 0.6), align: 'center', spacing: 2 });
  text(ctx, `목표   ${L.goal}`, W / 2, cy + 82, { size: 13, color: rgba(C.IVORY, 0.75), align: 'center' });
  text(ctx, `TARGET TIME   ${L.targetTime}s`, W / 2, cy + 104, { size: 12, color: rgba(C.IVORY, 0.4), align: 'center', spacing: 2 });
  line(ctx, W / 2 - 220, cy + 126, W / 2 + 220, cy + 126, rgba(C.GOLD, 0.6), 2);
  ctx.restore();
}

function drawClear() {
  const t = G.stateT, z = G.zone, L = G.level;
  // 환경 감광
  ctx.fillStyle = `rgba(11,15,20,${clamp(t / 0.5, 0, 1) * 0.88})`;
  ctx.fillRect(0, 0, W, H);

  const prog = clamp((t - 0.35) / 3.0, 0, 1);
  drawShotprint(G.print, prog, 1);

  const a = clamp((t - 0.3) / 0.4, 0, 1);
  text(ctx, 'SHOTPRINT', W / 2, 100, { size: 13, color: rgba(C.GOLD, 0.8 * a), align: 'center', spacing: 10 });
  text(ctx, `${L.code}  ·  ${L.name}  CLEAR`, W / 2, 138, { size: 30, color: rgba(C.IVORY, a), align: 'center', spacing: 4 });

  if (t > 1.2) {
    const b = clamp((t - 1.2) / 0.5, 0, 1);
    const rows = [
      ['TIME', `${z.time.toFixed(2)}s`, z.time <= L.targetTime ? C.GOLD : C.IVORY],
      ['SHOTS', `${z.shots}`, C.IVORY],
      ['RICOCHET KILLS', `${z.ricochetKills}`, C.GOLD],
      ['PERFECT CATCH', `${z.perfectCatches}`, C.CYAN],
      ['MAX ONE CHAIN', `${Math.min(z.maxChain, 3)}`, C.CYAN],
      ['DAMAGE TAKEN', `${z.damageTaken}`, z.damageTaken ? C.RED : C.IVORY],
    ];
    const x0 = W / 2 - 210;
    rows.forEach((r, i) => {
      const y = H - 210 + i * 26;
      text(ctx, r[0], x0, y, { size: 12, color: rgba(C.IVORY, 0.45 * b), spacing: 2 });
      text(ctx, r[1], x0 + 420, y, { size: 15, color: rgba(r[2], b), align: 'right' });
      line(ctx, x0, y + 6, x0 + 420, y + 6, rgba(C.IVORY, 0.07 * b), 1);
    });
    if (t > 2.0) {
      const blink = 0.5 + 0.5 * Math.sin(G.t * 4);
      text(ctx, G.levelIndex < LEVELS.length - 1 ? 'SPACE  다음 구역' : 'SPACE  결과 확인',
        W / 2, H - 38, { size: 14, color: rgba(C.IVORY, 0.4 + blink * 0.5), align: 'center', spacing: 4 });
    }
  }
}

function drawDead() {
  const t = G.stateT;
  ctx.fillStyle = `rgba(20,4,8,${clamp(t / 0.3, 0, 1) * 0.8})`;
  ctx.fillRect(0, 0, W, H);
  text(ctx, 'SECTOR FAILED', W / 2, H / 2 - 10, { size: 42, color: C.RED, align: 'center', spacing: 8 });
  text(ctx, '구역을 재시작합니다', W / 2, H / 2 + 26, { size: 14, color: rgba(C.IVORY, 0.6), align: 'center', spacing: 2 });
  const p = clamp(t / 1.3, 0, 1);
  ctx.fillStyle = rgba(C.RED, 0.6);
  ctx.fillRect(W / 2 - 100, H / 2 + 52, 200 * p, 4);
  ctx.strokeStyle = rgba(C.IVORY, 0.25); ctx.lineWidth = 1;
  ctx.strokeRect(W / 2 - 100.5, H / 2 + 51.5, 201, 5);
}

function grade() {
  const r = G.run;
  if (r.damageTaken === 0 && r.perfectCatches >= 10 && r.time <= TOTAL_TARGET_TIME) return 'ONE';
  if (r.time <= TOTAL_TARGET_TIME && r.ricochetKills >= 8) return 'A';
  if (r.time <= TOTAL_TARGET_TIME) return 'B';
  return 'C';
}

function drawResult() {
  const t = G.stateT, r = G.run;
  ctx.fillStyle = C.BG;
  ctx.fillRect(0, 0, W, H);

  // 최종 보스 SHOTPRINT 를 대표 이미지로
  const prog = clamp((t - 0.3) / 2.5, 0, 1);
  if (r.bossPrint) {
    drawShotprint(r.bossPrint, prog, 0.55, { x: W / 2 - ARENA.w * 0.42 / 2, y: 150, s: 0.42 });
  }

  const g = grade();
  const gc = g === 'ONE' ? C.GOLD : (g === 'A' ? C.CYAN : C.IVORY);
  text(ctx, 'EXPERIMENT COMPLETE', W / 2, 62, { size: 13, color: rgba(C.IVORY, 0.5), align: 'center', spacing: 10 });
  text(ctx, 'ONE BULLET', W / 2, 112, { size: 44, color: C.IVORY, align: 'center', spacing: 12 });

  if (t > 0.8) {
    ctx.save();
    ctx.shadowColor = gc; ctx.shadowBlur = 30;
    text(ctx, g, W / 2, 470, { size: 100, color: gc, align: 'center', spacing: 6 });
    ctx.restore();
    text(ctx, 'GRADE', W / 2, 400, { size: 12, color: rgba(C.IVORY, 0.45), align: 'center', spacing: 8 });
  }

  if (t > 1.2) {
    const rows = [
      ['CLEAR TIME', `${r.time.toFixed(2)}s`, r.time <= TOTAL_TARGET_TIME ? C.GOLD : C.IVORY],
      ['TOTAL SHOTS', `${r.shots}`, C.IVORY],
      ['RICOCHET KILLS', `${r.ricochetKills}`, C.GOLD],
      ['PERFECT CATCH', `${r.perfectCatches}`, C.CYAN],
      ['MAX ONE CHAIN', `${Math.min(r.maxChain, 3)}`, C.CYAN],
      ['DAMAGE TAKEN', `${r.damageTaken}`, r.damageTaken ? C.RED : C.GOLD],
      ['RETRIES', `${r.deaths}`, C.IVORY],
    ];
    const x0 = W / 2 - 250;
    rows.forEach((row, i) => {
      const y = 520 + i * 24;
      text(ctx, row[0], x0, y, { size: 12, color: rgba(C.IVORY, 0.45), spacing: 2 });
      text(ctx, row[1], x0 + 500, y, { size: 14, color: row[2], align: 'right' });
      line(ctx, x0, y + 5, x0 + 500, y + 5, rgba(C.IVORY, 0.06), 1);
    });
    const blink = 0.5 + 0.5 * Math.sin(G.t * 4);
    text(ctx, 'R  다시 시작', W / 2, H - 22, { size: 13, color: rgba(C.IVORY, 0.35 + blink * 0.4), align: 'center', spacing: 4 });
  }
}

function drawTitle() {
  const t = G.stateT;
  ctx.fillStyle = C.BG;
  ctx.fillRect(0, 0, W, H);

  // 배경 격자
  ctx.strokeStyle = rgba(C.IVORY, 0.04);
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // 대표 탄도 — 여러 번 꺾인 금색 선
  const path = [[120, 560], [420, 300], [700, 470], [980, 210], [1120, 330], [860, 560], [640, 430]];
  const prog = clamp(t / 2.2, 0, 1);
  ctx.save();
  ctx.shadowColor = C.GOLD; ctx.shadowBlur = 16;
  ctx.strokeStyle = rgba(C.GOLD, 0.85); ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(path[0][0], path[0][1]);
  const seg = (path.length - 1) * prog;
  for (let i = 1; i < path.length; i++) {
    if (seg >= i) ctx.lineTo(path[i][0], path[i][1]);
    else {
      const f = seg - (i - 1);
      if (f > 0) ctx.lineTo(lerp(path[i - 1][0], path[i][0], f), lerp(path[i - 1][1], path[i][1], f));
      break;
    }
  }
  ctx.stroke();
  ctx.restore();
  for (let i = 1; i < path.length - 1; i++) {
    if (seg > i) {
      ctx.save(); ctx.translate(path[i][0], path[i][1]); ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = rgba(C.GOLD, 0.7); ctx.lineWidth = 2; ctx.strokeRect(-5, -5, 10, 10);
      ctx.restore();
    }
  }
  // 궤적 끝의 탄환 한 발
  if (prog >= 1) {
    const e = path[path.length - 1];
    ctx.save(); ctx.shadowColor = C.GOLD; ctx.shadowBlur = 24;
    circle(ctx, e[0], e[1], 7, C.GOLD, C.IVORY, 2);
    ctx.restore();
  }

  // 워드마크
  ctx.fillStyle = 'rgba(11,15,20,0.72)';
  ctx.fillRect(0, 180, W, 250);
  text(ctx, 'ONE BULLET', W / 2, 290, { size: 86, color: C.IVORY, align: 'center', spacing: 16, weight: 900 });
  line(ctx, W / 2 - 300, 320, W / 2 + 300, 320, C.GOLD, 3);
  text(ctx, '단 한 발', W / 2, 358, { size: 20, color: C.GOLD, align: 'center', spacing: 12 });
  text(ctx, '한 발의 궤적을 설계하고, 되찾고, 이어간다', W / 2, 392,
    { size: 14, color: rgba(C.IVORY, 0.6), align: 'center', spacing: 3 });

  const blink = 0.5 + 0.5 * Math.sin(G.t * 3.4);
  text(ctx, 'SPACE  실험 시작', W / 2, 500, { size: 18, color: rgba(C.IVORY, 0.4 + blink * 0.55), align: 'center', spacing: 6 });

  const ctrl = [
    'WASD  이동', '마우스  조준', '좌클릭  발사',
    'SPACE  대시', 'E  캐치 / 회수', 'ESC  설정',
  ];
  ctrl.forEach((s, i) => {
    text(ctx, s, W / 2 - 330 + (i % 3) * 220, 570 + Math.floor(i / 3) * 26,
      { size: 12, color: rgba(C.IVORY, 0.45), align: 'center', spacing: 1 });
  });
  text(ctx, '총알은 한 발뿐입니다.  쏜 총알을 직접 되찾아야 다시 공격할 수 있습니다.',
    W / 2, 660, { size: 13, color: rgba(C.GOLD, 0.75), align: 'center', spacing: 1 });
  text(ctx, 'BALLISTIC BRUTALISM  ·  TEST FACILITY', W / 2, 690,
    { size: 10, color: rgba(C.IVORY, 0.25), align: 'center', spacing: 6 });
}

function drawPause() {
  ctx.fillStyle = 'rgba(11,15,20,0.88)';
  ctx.fillRect(0, 0, W, H);
  text(ctx, 'SETTINGS', W / 2, 200, { size: 34, color: C.IVORY, align: 'center', spacing: 10 });
  const items = [
    ['화면 흔들림', `${Math.round(G.settings.shake * 100)}%`],
    ['음량', `${Math.round(G.settings.volume * 100)}%`],
    ['조준 보조선', G.settings.aimAssist ? 'ON' : 'OFF'],
    ['구역 재시작', 'ENTER'],
  ];
  items.forEach((it, i) => {
    const y = 290 + i * 46;
    const sel = i === G.menuIndex;
    if (sel) {
      ctx.fillStyle = rgba(C.GOLD, 0.12);
      ctx.fillRect(W / 2 - 230, y - 22, 460, 38);
      text(ctx, '>', W / 2 - 250, y + 4, { size: 18, color: C.GOLD });
    }
    text(ctx, it[0], W / 2 - 210, y + 4, { size: 16, color: sel ? C.IVORY : rgba(C.IVORY, 0.6) });
    text(ctx, it[1], W / 2 + 210, y + 4, { size: 16, color: sel ? C.GOLD : rgba(C.IVORY, 0.5), align: 'right' });
  });
  text(ctx, 'W/S 선택   ·   A/D 조절   ·   ESC 계속', W / 2, 520,
    { size: 12, color: rgba(C.IVORY, 0.4), align: 'center', spacing: 3 });
}

/* ================================================================== 메인 */

function render() {
  const shakeX = G.shake > 0 ? rnd(G.shake, -G.shake) : 0;
  const shakeY = G.shake > 0 ? rnd(G.shake, -G.shake) : 0;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);

  if (G.state === 'title') { drawTitle(); return; }
  if (G.state === 'result') { drawResult(); return; }

  ctx.save();
  ctx.translate(shakeX, shakeY);

  drawBackground();
  drawFloorGimmicks();
  drawShutters();
  drawWalls();
  drawReflectors();
  drawDrums();

  if (G.settings.aimAssist && G.state === 'play') drawAimLine();

  for (const e of G.zone.enemies) if (e.alive) drawEnemy(e);
  drawBoss();
  drawProjectiles();
  drawPlayer();
  drawBullet();
  drawParticles();

  // 퍼펙트 캐치 채도 감소 연출
  if (G.desat > 0.01) {
    ctx.fillStyle = `rgba(53,224,230,${G.desat * 0.10})`;
    ctx.fillRect(0, 0, W, H);
  }

  ctx.restore();

  drawHUD();

  // 비네트
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.78);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  if (G.state === 'intro') drawIntro();
  if (G.state === 'clear') drawClear();
  if (G.state === 'dead') drawDead();
  if (G.state === 'pause') drawPause();

  if (G.flash > 0.01) {
    ctx.fillStyle = rgba(G.flashColor, G.flash * 0.5);
    ctx.fillRect(0, 0, W, H);
  }
}

let lastT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const raw = Math.min(0.05, (now - lastT) / 1000 || 0);
  lastT = now;

  Snd.updateMusic();

  G.t += raw;
  G.stateT += raw;
  G.shake *= Math.pow(0.0015, raw);
  if (G.shake < 0.2) G.shake = 0;
  G.flash = Math.max(0, G.flash - raw * 3);
  G.desat = Math.max(0, G.desat - raw * 2.4);
  G.catchFx = Math.max(0, G.catchFx - raw * 3);

  let dt = raw;
  if (G.hitstop > 0) { G.hitstop -= raw; dt = 0; }

  switch (G.state) {
    case 'title':
      if (Input.hit('Space') || Input.hit('Enter')) { Snd.init(); Snd.uiSelect(); G.startRun(); }
      break;

    case 'intro':
      if (G.stateT > 1.9 || Input.hit('Space')) { G.setState('play'); G.zone.time = 0; }
      break;

    case 'play':
      if (Input.hit('Escape')) { G.prevState = 'play'; G.menuIndex = 0; G.setState('pause'); }
      else updatePlay(dt);
      break;

    case 'pause': {
      if (Input.hit('Escape')) { G.setState('play'); break; }
      if (Input.hit('KeyW') || Input.hit('ArrowUp')) { G.menuIndex = (G.menuIndex + 3) % 4; Snd.uiMove(); }
      if (Input.hit('KeyS') || Input.hit('ArrowDown')) { G.menuIndex = (G.menuIndex + 1) % 4; Snd.uiMove(); }
      const dir = (Input.hit('KeyD') || Input.hit('ArrowRight') ? 1 : 0) - (Input.hit('KeyA') || Input.hit('ArrowLeft') ? 1 : 0);
      if (dir) {
        if (G.menuIndex === 0) G.settings.shake = clamp(G.settings.shake + dir * 0.25, 0, 1);
        if (G.menuIndex === 1) { G.settings.volume = clamp(G.settings.volume + dir * 0.1, 0, 1); Snd.setVolume(G.settings.volume); }
        if (G.menuIndex === 2) G.settings.aimAssist = G.settings.aimAssist ? 0 : 1;
        Snd.uiMove();
      }
      if (Input.hit('Enter') && G.menuIndex === 3) { G.loadLevel(G.levelIndex); }
      break;
    }

    case 'clear':
      if (G.stateT > 2.0 && (Input.hit('Space') || Input.hit('Enter'))) {
        if (G.levelIndex < LEVELS.length - 1) { Snd.uiSelect(); G.loadLevel(G.levelIndex + 1); }
        else { Snd.uiSelect(); G.setState('result'); Snd.stopMusic(); }
      }
      break;

    case 'dead':
      // 사망 후 2초 이내 현재 구역에서 재시작
      if (G.stateT > 1.3 || (G.stateT > 0.4 && (Input.hit('Space') || Input.hit('Enter'))))
        G.loadLevel(G.levelIndex, true);
      break;

    case 'result':
      if (Input.hit('KeyR')) { Snd.uiSelect(); G.state = 'title'; G.stateT = 0; Snd.startMusic(); }
      break;
  }

  render();
  Input.endFrame();
}

function boot() {
  canvas = document.getElementById('game');
  ctx = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;
  Input.init(canvas);

  // 타이틀에서도 zone/level 참조가 필요하므로 최소 상태를 준비
  G.run = { time: 0, shots: 0, ricochetKills: 0, perfectCatches: 0, maxChain: 0, damageTaken: 0, deaths: 0, bossPrint: null };
  G.state = 'title';

  const resize = () => {
    const s = Math.min(innerWidth / W, innerHeight / H);
    canvas.style.width = `${W * s}px`;
    canvas.style.height = `${H * s}px`;
  };
  addEventListener('resize', resize);
  resize();

  requestAnimationFrame(loop);
}

addEventListener('load', boot);
