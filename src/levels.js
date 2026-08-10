/* ONE BULLET — levels.js
   전투 구역 정의.
   한 구역에는 새로운 적 또는 지형 규칙을 하나만 추가한다.
   좌표는 캔버스 절대 좌표 (ARENA 내부). */

const ARENA = { x: 40, y: 56, w: 1200, h: 600 };
const AR = { l: ARENA.x, t: ARENA.y, r: ARENA.x + ARENA.w, b: ARENA.y + ARENA.h };

const LEVELS = [
  /* ------------------------------------------------------------ 1. 회수 */
  {
    id: 1, code: 'SECTOR 01', name: '회수', tag: 'RETRIEVE',
    brief: '발사 · 낙하 · 회수',
    goal: '추격병 3기 처치',
    targetTime: 40,
    playerStart: { x: 180, y: 356 },
    walls: [
      { x: 520, y: 160, w: 64, h: 64 },
      { x: 520, y: 488, w: 64, h: 64 },
      { x: 880, y: 324, w: 88, h: 88 },
    ],
    enemies: [
      { type: 'chaser', x: 1080, y: 200 },
      { type: 'chaser', x: 1080, y: 512 },
      { type: 'chaser', x: 860, y: 160 },
    ],
    hints: [
      { at: 'start',   text: '마우스로 조준 · 좌클릭 발사' },
      { at: 'dropped', text: '탄환에 다가가면 회수한다 · E' },
      { at: 'returning', text: '돌아오는 탄환 · E 로 퍼펙트 캐치' },
    ],
  },

  /* ------------------------------------------------------------ 2. 반사 */
  {
    id: 2, code: 'SECTOR 02', name: '반사', tag: 'RICOCHET',
    brief: '벽 도탄 · 균열 벽 · 반사판',
    goal: '엄폐물 뒤 적 포함 4기 처치',
    targetTime: 50,
    playerStart: { x: 150, y: 356 },
    walls: [
      { x: 430, y: 96,  w: 42, h: 210 },
      { x: 430, y: 406, w: 42, h: 210 },
      { x: 770, y: 286, w: 42, h: 140, type: 'cracked' },
      { poly: [[1000, 96], [1200, 96], [1200, 260]] },
      { poly: [[1000, 616], [1200, 616], [1200, 452]] },
    ],
    reflectors: [
      { id: 'r1', x: 660, y: 180, len: 150, angle: -Math.PI / 4 },
      { id: 'r2', x: 660, y: 532, len: 150, angle: Math.PI / 4 },
    ],
    enemies: [
      { type: 'chaser',  x: 660, y: 356 },
      { type: 'chaser',  x: 900, y: 356 },
      { type: 'shooter', x: 1120, y: 190 },
      { type: 'shooter', x: 1120, y: 520 },
    ],
    hints: [
      { at: 'start', text: '벽에 튕겨 엄폐물 뒤를 노린다 · 조준선은 1회 반사까지 표시' },
    ],
  },

  /* ------------------------------------------------------------ 3. 방패 */
  {
    id: 3, code: 'SECTOR 03', name: '방패', tag: 'SHIELD',
    brief: '방패 반사 · 압력 가시판 · 레이저 셔터',
    goal: '방패병 포함 5기 처치',
    targetTime: 60,
    playerStart: { x: 150, y: 356 },
    walls: [
      { x: 380, y: 56,  w: 40, h: 190 },
      { x: 380, y: 466, w: 40, h: 190 },
      { x: 860, y: 176, w: 40, h: 130 },
      { x: 860, y: 406, w: 40, h: 130 },
    ],
    reflectors: [
      { id: 'r1', x: 640, y: 356, len: 190, angle: Math.PI / 2, rot: 0.45 },
    ],
    spikes: [
      { x: 520, y: 130, w: 150, h: 150, period: 3.4, offset: 0 },
      { x: 520, y: 432, w: 150, h: 150, period: 3.4, offset: 1.7 },
    ],
    shutters: [
      { x: 856, y: 306, w: 48, h: 100, period: 4.0, offset: 0, duty: 0.45 },
    ],
    enemies: [
      { type: 'shield',  x: 700, y: 200 },
      { type: 'shield',  x: 700, y: 512 },
      { type: 'chaser',  x: 1000, y: 356 },
      { type: 'chaser',  x: 1140, y: 180 },
      { type: 'shooter', x: 1140, y: 540 },
    ],
    hints: [
      { at: 'start', text: '방패병의 정면은 탄환을 반사한다 · 측면과 후방을 노려라' },
    ],
  },

  /* ------------------------------------------------------------ 4. 탈취 */
  {
    id: 4, code: 'SECTOR 04', name: '탈취', tag: 'STEAL',
    brief: '수집병 · 폭발 드럼 · 전기 강화',
    goal: '탄환을 지키며 6기 처치',
    targetTime: 70,
    playerStart: { x: 150, y: 356 },
    walls: [
      { x: 330, y: 250, w: 44, h: 212 },
      { x: 620, y: 56,  w: 44, h: 176 },
      { x: 620, y: 480, w: 44, h: 176 },
      { poly: [[930, 300], [1030, 240], [1030, 472], [930, 412]] },
    ],
    reflectors: [
      { id: 'r1', x: 800, y: 150, len: 140, angle: -Math.PI / 4 },
      { id: 'r2', x: 800, y: 562, len: 140, angle: Math.PI / 4 },
    ],
    drums: [
      { x: 520, y: 356 },
      { x: 1130, y: 210 },
      { x: 1130, y: 500 },
    ],
    chargers: [
      { x: 250, y: 130, r: 26, type: 'electric' },
      { x: 250, y: 582, r: 26, type: 'electric' },
    ],
    enemies: [
      { type: 'collector', x: 1150, y: 356 },
      { type: 'collector', x: 900,  y: 130 },
      { type: 'chaser',    x: 780,  y: 356 },
      { type: 'chaser',    x: 1000, y: 590 },
      { type: 'shooter',   x: 1180, y: 90 },
      { type: 'shooter',   x: 1180, y: 620 },
    ],
    hints: [
      { at: 'start', text: '수집병이 바닥의 탄환을 노린다 · 충전 장치를 통과시키면 전기 강화' },
    ],
  },

  /* ------------------------------------------------------------ 5. 보스 */
  {
    id: 5, code: 'SECTOR 05', name: '실험체 ZERO', tag: 'BOSS',
    brief: '다중 도탄 · 퍼펙트 캐치',
    goal: '약점 3회 파괴',
    targetTime: 120,
    boss: true,
    playerStart: { x: 200, y: 356 },
    walls: [
      { poly: [[40, 56], [190, 56], [40, 206]] },
      { poly: [[1240, 56], [1090, 56], [1240, 206]] },
      { poly: [[40, 656], [190, 656], [40, 506]] },
      { poly: [[1240, 656], [1090, 656], [1240, 506]] },
    ],
    reflectors: [
      { id: 'b1', x: 400, y: 170, len: 160, angle: -Math.PI / 4, phase: 2 },
      { id: 'b2', x: 880, y: 170, len: 160, angle: Math.PI / 4, phase: 2 },
      { id: 'b3', x: 400, y: 542, len: 160, angle: Math.PI / 4, phase: 2 },
      { id: 'b4', x: 880, y: 542, len: 160, angle: -Math.PI / 4, phase: 2 },
    ],
    switches: [
      { x: 640, y: 110, r: 18, targets: ['b1', 'b2'] },
      { x: 640, y: 602, r: 18, targets: ['b3', 'b4'] },
    ],
    chargers: [
      { x: 120, y: 356, r: 26, type: 'explosive' },
      { x: 1160, y: 356, r: 26, type: 'explosive' },
    ],
    enemies: [],
    hints: [
      { at: 'start', text: '정면 장갑은 탄환을 반사한다 · 벽에 튕겨 등 뒤 약점을 노려라' },
    ],
  },
];

/* 목표 시간 합계 — 등급 B 판정에 사용 */
const TOTAL_TARGET_TIME = LEVELS.reduce((s, l) => s + l.targetTime, 0);
