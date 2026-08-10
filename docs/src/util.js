/* ONE BULLET — util.js
   벡터 · 기하 · 충돌 · 드로잉 헬퍼
   (모든 도탄 판정은 여기의 ray/segment 함수만 사용한다) */

const C = {
  BG:       '#0B0F14',
  CONCRETE: '#242B35',
  CONCRETE2:'#1A2028',
  IVORY:    '#EEF2F3',
  GOLD:     '#FFC247',
  CYAN:     '#35E0E6',
  RED:      '#FF4D5A',
  ORANGE:   '#FF9A3C',
};

const TAU = Math.PI * 2;

const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp  = (a, b, t) => a + (b - a) * t;
const rnd   = (a = 1, b = 0) => b + Math.random() * (a - b);
const rndi  = (a, b) => Math.floor(rnd(a, b));
const dist  = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const dist2 = (ax, ay, bx, by) => (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
const angTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);

/** 각도 차이를 -PI..PI 로 정규화 */
function angDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

function norm(x, y) {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

/* ---------------------------------------------------------------- 기하 */

/** 광선(p, 정규화된 d) 과 선분(a,b) 의 교차 거리 t. 없으면 null */
function rayVsSeg(px, py, dx, dy, ax, ay, bx, by) {
  const ex = bx - ax, ey = by - ay;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-9) return null;          // 평행
  const t = ((ax - px) * ey - (ay - py) * ex) / den;
  const u = ((ax - px) * dy - (ay - py) * dx) / den;
  if (t > 1e-6 && u >= 0 && u <= 1) return t;
  return null;
}

/** 광선과 원(cx,cy,r) 의 최초 교차 거리. 없으면 null */
function rayVsCircle(px, py, dx, dy, cx, cy, r) {
  const ox = px - cx, oy = py - cy;
  const b = ox * dx + oy * dy;
  const c = ox * ox + oy * oy - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 1e-6) t = -b + s;
  if (t < 1e-6) return null;
  return t;
}

/** 선분 위에서 점 p 에 가장 가까운 지점 */
function closestOnSeg(px, py, ax, ay, bx, by) {
  const ex = bx - ax, ey = by - ay;
  const len2 = ex * ex + ey * ey || 1;
  let t = ((px - ax) * ex + (py - ay) * ey) / len2;
  t = clamp(t, 0, 1);
  return { x: ax + ex * t, y: ay + ey * t, t };
}

/** 입사 방향 d 를 선분 법선으로 반사 */
function reflect(dx, dy, ax, ay, bx, by) {
  let nx = -(by - ay), ny = (bx - ax);
  const l = Math.hypot(nx, ny) || 1;
  nx /= l; ny /= l;
  const dot = dx * nx + dy * ny;
  return { x: dx - 2 * dot * nx, y: dy - 2 * dot * ny, nx: dot > 0 ? -nx : nx, ny: dot > 0 ? -ny : ny };
}

function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/** 원을 폴리곤 밖으로 밀어낸다. 이동했으면 true */
function pushCircleOutOfPoly(c, r, poly) {
  let best = null, bestD = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const p = closestOnSeg(c.x, c.y, poly[j][0], poly[j][1], poly[i][0], poly[i][1]);
    const d = dist(c.x, c.y, p.x, p.y);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (!best) return false;
  const inside = pointInPoly(c.x, c.y, poly);
  if (!inside && bestD >= r) return false;
  let nx = c.x - best.x, ny = c.y - best.y;
  let l = Math.hypot(nx, ny);
  if (l < 1e-6) { nx = 0; ny = -1; l = 1; }
  nx /= l; ny /= l;
  if (inside) { c.x = best.x + nx * -1 * r; c.y = best.y + ny * -1 * r; }
  else        { c.x = best.x + nx * r;      c.y = best.y + ny * r; }
  return true;
}

function rectPoly(x, y, w, h) {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

/* ---------------------------------------------------------------- 드로잉 */

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function drawPoly(ctx, poly, fill, stroke, lw = 2) {
  ctx.beginPath();
  ctx.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
  ctx.closePath();
  if (fill)   { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

function circle(ctx, x, y, r, fill, stroke, lw = 2) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  if (fill)   { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

function line(ctx, ax, ay, bx, by, color, lw = 2, dash = null) {
  ctx.save();
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke();
  ctx.restore();
}

function text(ctx, str, x, y, {
  size = 16, color = C.IVORY, align = 'left', baseline = 'alphabetic',
  weight = 700, family = '"Helvetica Neue", Arial, sans-serif', alpha = 1, spacing = 0,
} = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.textAlign = spacing ? 'left' : align;
  ctx.textBaseline = baseline;
  ctx.fillStyle = color;
  if (spacing) {
    const chars = String(str).split('');
    let total = 0;
    for (const ch of chars) total += ctx.measureText(ch).width + spacing;
    total -= spacing;
    let cx = align === 'center' ? x - total / 2 : (align === 'right' ? x - total : x);
    for (const ch of chars) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + spacing; }
  } else {
    ctx.fillText(str, x, y);
  }
  ctx.restore();
}

/** 0..1 진행도를 부드럽게 */
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIn  = t => t * t * t;
