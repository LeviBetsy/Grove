import { drawHero, SPRITE_W, SPRITE_H } from './sprite.js';

// ============================================================
//  Utilities
// ============================================================
const $ = (s) => document.querySelector(s);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = (v) => Math.round(v * 10) / 10;
const fmtPct = (v) => (Number.isInteger(round1(v)) ? String(Math.round(v)) : round1(v).toFixed(1));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Potion colours, from empty to full
const STOPS = [
  [0.0, '#3ef2c4'],
  [0.25, '#5fe06f'],
  [0.5, '#f5d547'],
  [0.75, '#ff7ab6'],
  [1.0, '#b07cff'],
];
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function colorAt(f) {
  f = clamp(f, 0, 1);
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, c1] = STOPS[i];
    const [p0, c0] = STOPS[i - 1];
    if (f <= p1) {
      const k = (f - p0) / (p1 - p0);
      const a = hexToRgb(c0), b = hexToRgb(c1);
      return '#' + a.map((v, j) => Math.round(v + (b[j] - v) * k).toString(16).padStart(2, '0')).join('');
    }
  }
  return STOPS[STOPS.length - 1][1];
}

function relTime(iso) {
  const d = new Date(iso);
  const s = (Date.now() - d) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 2 * 86400) return 'yesterday';
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} days ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
const fullDate = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ============================================================
//  API (talks to server.js, which writes data/projects.json)
// ============================================================
async function req(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}
const api = {
  list: () => req('GET', '/api/projects'),
  create: (body) => req('POST', '/api/projects', body), // { name, stages }
  stageProgress: (id, sid, value, note) => req('POST', `/api/projects/${id}/stages/${encodeURIComponent(sid)}/progress`, { value, note }),
  reshape: (id, body) => req('PUT', `/api/projects/${id}/stages`, body),
  addStageTask: (id, sid, name) => req('POST', `/api/projects/${id}/stages/${encodeURIComponent(sid)}/tasks`, { name }),
  toggleStageTask: (id, sid, tid, done) => req('POST', `/api/projects/${id}/stages/${encodeURIComponent(sid)}/tasks/${encodeURIComponent(tid)}`, { done }),
  removeStageTask: (id, sid, tid) => req('DELETE', `/api/projects/${id}/stages/${encodeURIComponent(sid)}/tasks/${encodeURIComponent(tid)}`),
  addSubtask: (id, sid, tid, name) => req('POST', `/api/projects/${id}/stages/${encodeURIComponent(sid)}/tasks/${encodeURIComponent(tid)}/subtasks`, { name }),
  toggleSubtask: (id, sid, tid, uid, done) => req('POST', `/api/projects/${id}/stages/${encodeURIComponent(sid)}/tasks/${encodeURIComponent(tid)}/subtasks/${encodeURIComponent(uid)}`, { done }),
  removeSubtask: (id, sid, tid, uid) => req('DELETE', `/api/projects/${id}/stages/${encodeURIComponent(sid)}/tasks/${encodeURIComponent(tid)}/subtasks/${encodeURIComponent(uid)}`),
  moveStageTask: (id, sid, tid, by) => req('POST', `/api/projects/${id}/stages/${encodeURIComponent(sid)}/tasks/${encodeURIComponent(tid)}/move`, { by }),
  moveSubtask: (id, sid, tid, uid, by) => req('POST', `/api/projects/${id}/stages/${encodeURIComponent(sid)}/tasks/${encodeURIComponent(tid)}/subtasks/${encodeURIComponent(uid)}/move`, { by }),
  renameStageTask: (id, sid, tid, name) => req('PATCH', `/api/projects/${id}/stages/${encodeURIComponent(sid)}/tasks/${encodeURIComponent(tid)}`, { name }),
  renameSubtask: (id, sid, tid, uid, name) => req('PATCH', `/api/projects/${id}/stages/${encodeURIComponent(sid)}/tasks/${encodeURIComponent(tid)}/subtasks/${encodeURIComponent(uid)}`, { name }),
  rename: (id, name) => req('PATCH', `/api/projects/${id}`, { name }),
  remove: (id) => req('DELETE', `/api/projects/${id}`),
  templates: () => req('GET', '/api/templates'),
  startTemplate: (tid, date) => req('POST', `/api/templates/${encodeURIComponent(tid)}/start`, { date }),
  createTemplate: (t) => req('POST', '/api/templates', t),
  updateTemplate: (tid, t) => req('PUT', `/api/templates/${encodeURIComponent(tid)}`, t),
  deleteTemplate: (tid) => req('DELETE', `/api/templates/${encodeURIComponent(tid)}`),
  toggleTask: (id, taskId, done) => req('POST', `/api/projects/${id}/tasks/${taskId}`, { done }),
  complete: (id) => req('POST', `/api/projects/${id}/complete`),
  startClock: (id) => req('POST', `/api/projects/${id}/timer`),
  archive: (id, archived) => req('POST', `/api/projects/${id}/archive`, { archived }),
};

// Local calendar day, e.g. "2026-11-15" (routines are one per day)
function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (key) => { const [, m, d] = key.split('-').map(Number); return `${MONTHS[m - 1]} ${d}`; };
const CHECK_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="#08200f" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ============================================================
//  Forest backdrop
// ============================================================
function pine(x, base, h) {
  const w = h * 0.3;
  let d = `M${x - h * 0.03},${base} h${h * 0.06} v${-h * 0.08} h${-h * 0.06}Z`;
  for (let i = 0; i < 4; i++) {
    const apex = base - h + i * h * 0.19;
    const bot = apex + h * 0.36;
    const hw = w * (0.38 + i * 0.22);
    d += `M${x},${apex} Q${x - hw * 0.35},${bot - h * 0.1} ${x - hw},${bot} L${x + hw},${bot} Q${x + hw * 0.35},${bot - h * 0.1} ${x},${apex}Z`;
  }
  return d;
}

// ---------- Day and night ----------
// One full day is 20 minutes, read off the wall clock so every window (and a reload) agrees.
// The cycle starts at sunrise: the sun crosses the sky for the first half, the moon for the second.
const DAY_MS = 20 * 60 * 1000;
const SKY = {                       // [top, middle, horizon]
  night: ['#07141c', '#0d2a2c', '#174238'],
  dusk:  ['#1c2547', '#6a3f5c', '#e08a5a'],
  day:   ['#3576a8', '#6aa9c2', '#8fc2b0'],
};
const GLOW = { night: [120, 200, 170, 0.14], dusk: [255, 150, 90, 0.32], day: [255, 240, 200, 0.3] };
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mixNum = (a, b, t) => a + (b - a) * t;
const mixHex = (a, b, t) => `rgb(${hexRgb(a).map((v, i) => Math.round(mixNum(v, hexRgb(b)[i], t))).join(',')})`;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function skyAt(ms) {
  const t = (ms % DAY_MS) / DAY_MS;      // 0 sunrise · 0.25 noon · 0.5 sunset · 0.75 midnight
  const sunUp = Math.sin(2 * Math.PI * t); // the sun's height: 1 at noon, -1 at midnight
  // colours: night → dusk around the horizon crossing → day once the sun is up a bit
  const [from, to, k] = sunUp < 0 ? ['dusk', 'night', smooth(0, -0.3, sunUp)] : ['dusk', 'day', smooth(0, 0.4, sunUp)];
  const night = smooth(0.05, -0.25, sunUp);
  const daylight = smooth(-0.1, 0.4, sunUp);
  // a body's spot on its arc: s goes 0 → 1 from rising (left) to setting (right)
  const arc = (s) => [-6 + 112 * s, 78 - 66 * Math.sin(Math.PI * s)];
  const [sx, sy] = t < 0.5 ? arc(t * 2) : [-20, 90];
  const [mx, my] = t >= 0.5 ? arc((t - 0.5) * 2) : [-20, 90];
  const glow = GLOW[from].map((v, i) => mixNum(v, GLOW[to][i], k));
  const pct = (v) => `${v.toFixed(2)}%`;
  return {
    '--sky-top': mixHex(SKY[from][0], SKY[to][0], k),
    '--sky-mid': mixHex(SKY[from][1], SKY[to][1], k),
    '--sky-low': mixHex(SKY[from][2], SKY[to][2], k),
    '--glow': `rgba(${glow.slice(0, 3).map(Math.round).join(',')},${glow[3].toFixed(3)})`,
    '--gx': pct(t < 0.5 ? sx : mx), '--gy': pct(t < 0.5 ? sy : my),
    '--sun-x': pct(sx), '--sun-y': pct(sy), '--moon-x': pct(mx), '--moon-y': pct(my),
    '--night': night.toFixed(3),
    // trees lighten a little by day, but stay dark enough to read the controls in front of them
    '--tree-far': (1 + 0.6 * daylight).toFixed(3),
    '--tree-mid': (1 + 0.5 * daylight).toFixed(3),
    '--tree-near': (1 + 0.25 * daylight).toFixed(3),
  };
}

// Paint the current moment onto every forest backdrop (the page's and the pop-out's copy).
// Only values that changed are written, so midday and midnight cost nothing.
function tickSky() {
  const vars = skyAt(Date.now());
  const forests = [document.querySelector('.forest'), pip?.document.querySelector('.forest')].filter(Boolean);
  for (const el of forests) {
    for (const [k, v] of Object.entries(vars)) if (el.style.getPropertyValue(k) !== v) el.style.setProperty(k, v);
  }
}

function startSky() {
  tickSky();
  setInterval(tickSky, 200);
}

function buildForest() {
  const layers = [
    { el: $('#treesFar'), color: '#143a36', ground: 470, count: 38, h: [150, 280], seed: 11 },
    { el: $('#treesMid'), color: '#0d2926', ground: 520, count: 24, h: [170, 300], seed: 23 },
    { el: $('#treesNear'), color: '#061513', ground: 560, count: 15, h: [190, 330], seed: 37 },
  ];
  for (const L of layers) {
    const rnd = mulberry32(L.seed);
    // rolling ground
    let g = `M0,600 L0,${L.ground}`;
    for (let x = 0; x <= 1600; x += 200) g += ` Q${x + 100},${L.ground - 10 - rnd() * 26} ${x + 200},${L.ground + rnd() * 8}`;
    g += ' L1600,600Z';
    let trees = '';
    for (let i = 0; i < L.count; i++) {
      const x = (i + rnd() * 0.8) * (1640 / L.count) - 20;
      const h = L.h[0] + rnd() * (L.h[1] - L.h[0]);
      trees += pine(x, L.ground + 14, h);
    }
    L.el.innerHTML = `<path d="${g}" fill="${L.color}"/><path d="${trees}" fill="${L.color}"/>`;
  }

  const rnd = mulberry32(5);
  $('#stars').innerHTML = Array.from({ length: 80 }, () =>
    `<i class="star" style="left:${rnd() * 100}%;top:${rnd() * 100}%;--d:${3 + rnd() * 4}s;--delay:${-rnd() * 6}s;opacity:${0.2 + rnd() * 0.6}"></i>`).join('');

  const ff = (r) => `${Math.round((r - 0.5) * 140)}px`;
  $('#fireflies').innerHTML = Array.from({ length: 26 }, () =>
    `<i class="firefly" style="left:${rnd() * 100}%;top:${30 + rnd() * 66}%;--fly:${10 + rnd() * 12}s;--blink:${2 + rnd() * 3}s;--delay:${-rnd() * 12}s;--dx1:${ff(rnd())};--dy1:${ff(rnd())};--dx2:${ff(rnd())};--dy2:${ff(rnd())};--dx3:${ff(rnd())};--dy3:${ff(rnd())}"></i>`).join('');

  // gentle parallax
  const parallax = [[$('#treesFar'), 6], [$('#treesMid'), 12], [$('#treesNear'), 22]];
  window.addEventListener('pointermove', (e) => {
    const k = e.clientX / window.innerWidth - 0.5;
    for (const [el, amt] of parallax) el.style.transform = `translateX(${-k * amt}px)`;
  }, { passive: true });
}

// ============================================================
//  The potion flask + hero
// ============================================================
const SVGNS = 'http://www.w3.org/2000/svg';

class Flask {
  constructor() {
    this.wrap = $('#flaskWrap');
    this.svg = $('#flask');
    this.canvas = $('#hero');
    this.ctx = this.canvas.getContext('2d');
    this.glow = $('#glow');
    this.pctEl = $('#pct');
    this.shown = 0;
    this.target = 0;
    this.facing = 1;
    this.heroKey = '';
    this.walkClock = 0;
    this.stepIndex = 0;
    this.nextBlink = 2;
    this.blinkUntil = 0;
    this.jumpClock = 0;
    this.lastColor = '';
    this.layout();
    new ResizeObserver(() => this.layout()).observe(this.wrap);
    this.last = performance.now();
    requestAnimationFrame((t) => this.tick(t));
  }

  layout() {
    const W = this.wrap.clientWidth;
    if (!W || W === this.W) return;
    this.W = W;
    const small = W < 600;
    const TH = small ? 56 : 76;
    const scale = small ? 3 : 4;
    const x0 = 3, y0 = 3, x1 = W - 3, h = TH - 6, R = h / 2;
    const inset = 7;
    const ix = x0 + inset, iy = y0 + inset, ih = h - inset * 2, iR = ih / 2, ir = x1 - inset;
    Object.assign(this, { TH, scale, x0, y0, x1, h, ix, iy, ih, ir });

    const tube = (ax, ay, bx, hh, r, rc) =>
      `M${ax + r},${ay} H${bx - rc} Q${bx},${ay} ${bx},${ay + rc} V${ay + hh - rc} Q${bx},${ay + hh} ${bx - rc},${ay + hh} H${ax + r} A${r},${r} 0 0 1 ${ax + r},${ay} Z`;
    const outer = tube(x0, y0, x1, h, R, 10);
    const inner = tube(ix, iy, ir, ih, iR, 5);

    const stops = STOPS.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
    const ticks = [0.25, 0.5, 0.75].map((q) => {
      const tx = ix + q * (ir - ix);
      return `<line x1="${tx}" x2="${tx}" y1="${iy + ih - 9}" y2="${iy + ih - 2}" stroke="rgba(255,255,255,.4)" stroke-width="2" stroke-linecap="round"/>
              <line x1="${tx}" x2="${tx}" y1="${iy + 2}" y2="${iy + 6}" stroke="rgba(255,255,255,.3)" stroke-width="2" stroke-linecap="round"/>
              <text x="${tx}" y="${TH + 16}" text-anchor="middle" font-size="11" font-weight="700" fill="rgba(200,230,215,.45)" font-family="Nunito, sans-serif">${q * 100}</text>`;
    }).join('');

    this.svg.setAttribute('viewBox', `0 0 ${W} ${TH}`);
    this.svg.setAttribute('height', TH);
    this.svg.innerHTML = `
      <defs>
        <linearGradient id="potionGrad" gradientUnits="userSpaceOnUse" x1="${ix}" x2="${ir}" y1="0" y2="0">${stops}</linearGradient>
        <linearGradient id="shade" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity=".28"/>
          <stop offset=".35" stop-color="#fff" stop-opacity="0"/>
          <stop offset=".7" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="#000" stop-opacity=".32"/>
        </linearGradient>
        <pattern id="swirl" patternUnits="userSpaceOnUse" width="26" height="26">
          <rect width="11" height="26" fill="#fff" opacity=".09"/>
        </pattern>
        <clipPath id="innerClip"><path d="${inner}"/></clipPath>
        <path id="liq" d=""/>
        <clipPath id="liqClip"><use href="#liq"/></clipPath>
      </defs>

      <path d="${outer}" fill="rgba(200,255,230,.07)"/>
      <path d="${inner}" fill="rgba(3,14,13,.62)"/>

      <g clip-path="url(#innerClip)">
        <g clip-path="url(#liqClip)">
          <rect x="${ix - 20}" y="${iy - 5}" width="${ir - ix + 40}" height="${ih + 10}" fill="url(#potionGrad)"/>
          <rect id="swirlRect" x="${ix - 20}" y="${iy - 5}" width="${ir - ix + 40}" height="${ih + 10}" fill="url(#swirl)"/>
          <rect x="${ix - 20}" y="${iy - 5}" width="${ir - ix + 40}" height="${ih + 10}" fill="url(#shade)"/>
          <g id="bubbles"></g>
        </g>
        <path id="meniscus" d="" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="2.5"/>
      </g>

      ${ticks}
      <path d="M${ix + iR * 0.7},${iy + ih * 0.2} H${ir - 18}" stroke="rgba(255,255,255,.38)" stroke-width="${Math.max(3, ih * 0.13)}" stroke-linecap="round"/>
      <path d="M${ix + iR * 0.9},${iy + ih * 0.78} H${ix + iR * 2.2}" stroke="rgba(255,255,255,.16)" stroke-width="3" stroke-linecap="round"/>
      <path d="${outer}" fill="none" stroke="rgba(225,255,240,.65)" stroke-width="2.5"/>
    `;
    this.liq = this.svg.querySelector('#liq');
    this.meniscus = this.svg.querySelector('#meniscus');
    this.swirlPattern = this.svg.querySelector('#swirl');
    this.bubbleG = this.svg.querySelector('#bubbles');

    this.bubbles = Array.from({ length: 18 }, () => {
      const el = document.createElementNS(SVGNS, 'circle');
      el.setAttribute('fill', 'rgba(255,255,255,.35)');
      el.setAttribute('stroke', 'rgba(255,255,255,.7)');
      el.setAttribute('stroke-width', '1');
      this.bubbleG.appendChild(el);
      const b = { el };
      this.respawn(b, true);
      return b;
    });

    // hero canvas (crisp on retina)
    const dpr = window.devicePixelRatio || 1;
    this.heroW = SPRITE_W * scale;
    this.heroH = SPRITE_H * scale;
    this.canvas.width = this.heroW * dpr;
    this.canvas.height = this.heroH * dpr;
    this.canvas.style.width = this.heroW + 'px';
    this.canvas.style.height = this.heroH + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.heroKey = '';

    // hero stands on top of the glass
    this.padTop = this.heroH + 6;
    this.wrap.style.paddingTop = this.padTop + 'px';
    this.wrap.style.paddingBottom = '18px';
    this.heroTop = this.padTop + y0 - this.heroH + scale * 0.5;
    this.glow.style.top = this.padTop + TH * 0.15 + 'px';
    this.glow.style.height = TH * 0.7 + 'px';
  }

  fillX(f) { return this.ix + f * (this.ir - this.ix); }

  respawn(b, anywhere = false) {
    const fx = this.fillX(this.shown / 100);
    const span = Math.max(0, fx - this.ix - 10);
    b.x = this.ix + 6 + Math.random() * span;
    b.y = anywhere ? this.iy + Math.random() * this.ih : this.iy + this.ih + 4;
    b.r = 1.2 + Math.random() * 3;
    b.v = 8 + Math.random() * 22;
    b.p = Math.random() * Math.PI * 2;
    b.hidden = span < 6;
  }

  setTarget(v, { instant = false } = {}) {
    this.target = clamp(v, 0, 100);
    if (instant) this.shown = this.target;
    this.svg.setAttribute('aria-valuenow', round1(this.target));
  }

  // pixel position of the current fill edge, relative to the wrapper
  edgeX() { return this.fillX(this.target / 100); }
  edgeY() { return this.padTop + this.TH / 2; }


  tick(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.liq) { requestAnimationFrame((n) => this.tick(n)); return; } // not laid out yet (hidden)
    const t = now / 1000;

    // ease the shown value toward the target
    const diff = this.target - this.shown;
    const walking = Math.abs(diff) > 0.05;
    if (walking) {
      const speed = Math.max(6, Math.abs(diff) * 1.8);
      const step = Math.sign(diff) * speed * dt;
      this.shown = Math.abs(step) >= Math.abs(diff) ? this.target : this.shown + step;
      this.facing = Math.sign(diff);
    } else {
      this.shown = this.target;
    }
    const f = this.shown / 100;

    // liquid with a wobbling leading edge
    const fx = f >= 0.999 ? this.ir + 30 : this.fillX(f);
    const amp = f <= 0.001 ? 0 : Math.min(5, (fx - this.ix) * 0.4) * (walking ? 1.5 : 1);
    const top = this.iy - 4, bot = this.iy + this.ih + 4;
    let edge = '';
    for (let y = top; y <= bot; y += 3) {
      const x = fx + amp * Math.sin((y / this.ih) * Math.PI * 2.2 + t * 3.2) + amp * 0.4 * Math.sin(t * 1.7 + y * 0.2);
      edge += `${edge ? 'L' : 'M'}${x.toFixed(1)},${y}`;
    }
    this.liq.setAttribute('d', f <= 0.001 ? '' : `M${this.ix - 30},${top} L${edge.slice(1)} L${this.ix - 30},${bot}Z`);
    this.meniscus.setAttribute('d', f <= 0.001 || f >= 0.999 ? '' : edge);
    this.swirlPattern.setAttribute('patternTransform', `rotate(32) translate(${((t * 14) % 26).toFixed(2)} 0)`);

    // bubbles
    for (const b of this.bubbles) {
      b.y -= b.v * dt;
      const x = b.x + Math.sin(t * 2.4 + b.p) * 1.6;
      if (b.y < this.iy - b.r || b.x > fx - 4 || b.hidden) this.respawn(b);
      b.el.setAttribute('cx', x.toFixed(1));
      b.el.setAttribute('cy', b.y.toFixed(1));
      b.el.setAttribute('r', b.hidden ? 0 : b.r.toFixed(1));
    }

    // colour-driven bits
    const color = colorAt(f);
    if (color !== this.lastColor) {
      this.lastColor = color;
      document.documentElement.style.setProperty('--potion', color);
      this.glow.style.background = `linear-gradient(90deg, ${STOPS[0][1]}, ${color})`;
    }
    this.glow.style.left = this.ix + 'px';
    this.glow.style.width = Math.max(0, Math.min(fx, this.ir) - this.ix) + 'px';
    this.pctEl.textContent = fmtPct(walking ? Math.round(this.shown) : this.shown);

    this.updateHero(dt, t, walking);
    requestAnimationFrame((n) => this.tick(n));
  }

  updateHero(dt, t, walking) {
    const s = this.scale;
    let pose = 'idle', bob = 0, flutter = false, jump = 0;

    if (walking) {
      const speedPx = Math.abs(this.target - this.shown) * 1.8 * (this.ir - this.ix) / 100;
      const frameTime = clamp(26 / Math.max(speedPx, 1), 0.06, 0.16);
      this.walkClock += dt;
      if (this.walkClock > frameTime) { this.walkClock = 0; this.stepIndex = (this.stepIndex + 1) % 4; }
      pose = this.stepIndex % 2 === 0 ? 'stride' : 'pass';
      bob = pose === 'stride' ? 1 : 0;
      flutter = pose === 'stride';
      this.jumpClock = 0;
    } else {
      bob = Math.sin(t * 2.6) > 0.3 ? 1 : 0; // breathing
      if (this.target >= 100) {
        // victory hops
        this.jumpClock = (this.jumpClock + dt) % 1.6;
        if (this.jumpClock < 0.5) {
          const k = this.jumpClock / 0.5;
          jump = Math.sin(k * Math.PI) * 18;
          pose = 'jump';
          flutter = true;
          if (this.jumpClock + dt >= 0.5) this.onLand?.();
        }
      }
    }

    if (t > this.nextBlink) { this.blinkUntil = t + 0.13; this.nextBlink = t + 2 + Math.random() * 3.5; }
    const blink = t < this.blinkUntil && !walking;

    const key = `${pose}|${bob}|${blink}|${this.facing}|${flutter}`;
    if (key !== this.heroKey) {
      this.heroKey = key;
      drawHero(this.ctx, s, { pose, bob, blink, facing: this.facing, flutter });
    }

    const cx = clamp(this.fillX(this.shown / 100), this.heroW * 0.3, this.W - this.heroW * 0.3);
    this.canvas.style.transform = `translate(${(cx - this.heroW / 2).toFixed(1)}px, ${(this.heroTop - jump).toFixed(1)}px)`;
  }
}

// ============================================================
//  Effects
// ============================================================
function floater(text, x, y, color) {
  const el = document.createElement('div');
  el.className = 'floater';
  el.textContent = text;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.color = color;
  $('#floatLayer').appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

function sparks(x, y, n = 14) {
  const layer = $('#floatLayer');
  for (let i = 0; i < n; i++) {
    const el = document.createElement('i');
    el.className = 'spark';
    const a = Math.random() * Math.PI * 2;
    const d = 30 + Math.random() * 50;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.background = STOPS[Math.floor(Math.random() * STOPS.length)][1];
    el.style.setProperty('--sx', `${Math.cos(a) * d}px`);
    el.style.setProperty('--sy', `${Math.sin(a) * d - 20}px`);
    layer.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }
}

// ============================================================
//  App state + rendering
// ============================================================
const state = { projects: [], templates: [], activeId: null };
const active = () => state.projects.find((p) => p.id === state.activeId) || null;
const liveProjects = () => state.projects.filter((p) => !p.archived);
const archivedProjects = () => state.projects.filter((p) => p.archived);
// ← → keys: journeys that aren't archived (they act on the selected stage)
const canFill = (p = active()) => isJourney(p) && !p.archived;
let flask;

function replaceProject(p) {
  const i = state.projects.findIndex((x) => x.id === p.id);
  if (i >= 0) state.projects[i] = p; else state.projects.push(p);
}

function renderTabs() {
  const n = archivedProjects().length;
  $('#archiveCount').textContent = n ? n : '';
  $('#tabs').innerHTML = liveProjects().map((p) => {
    const w = Math.max(p.progress, 0.0001);
    const worth = worthOf(p) !== 100 ? ` · worth ${fmtPct(worthOf(p))}% of the Grove` : '';
    return `<button class="tab ${p.id === state.activeId ? 'active' : ''}" data-id="${p.id}" title="${esc(p.name)} — ${fmtPct(p.progress)}%${worth}">
      <span class="tab-name">${esc(p.name)}</span>
      <span class="tab-bar"><i style="width:${p.progress}%;background-size:${(100 / w) * 100}% 100%"></i></span>
    </button>`;
  }).join('');
  $('#tabs .active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  renderWidget();
  renderGrove();
}

function setActive(id, { animate = true } = {}) {
  groveOpen = false;
  $('#project').classList.remove('grove-mode');
  $('#grovePanel').hidden = true;
  state.activeId = id;
  if (id) history.replaceState(null, '', '#' + id);
  else history.replaceState(null, '', location.pathname);
  const p = active();
  $('#empty').hidden = !!p;
  $('#project').hidden = !p;
  $('#trail').hidden = !p;
  $('#plantBtn').setAttribute('aria-pressed', String(!p));
  if (p) plantReturnId = null;
  renderTabs();
  if (!p) { renderPlantView(); $('#emptyName').focus(); return; }
  $('#pname').textContent = p.name;
  document.title = `${p.name} · Grove`;
  flask.layout();
  if (animate) { flask.shown = 0; flask.facing = 1; }
  flask.setTarget(p.progress, { instant: !animate });
  renderProjectChrome();
  renderTrail();
}

// Everything on the project view that depends on the project's kind / state
function renderProjectChrome() {
  const p = active();
  if (!p) return;
  $('#archivedBadge').hidden = !p.archived;
  const ab = $('#archiveToggleBtn');
  ab.title = p.archived ? 'Restore from archive' : 'Archive';
  ab.setAttribute('aria-label', ab.title);
  $('#taskPanel').hidden = !p.tasks;
  $('#legPanel').hidden = !isJourney(p);
  $('#editStagesBtn').hidden = !isJourney(p) || !!p.archived;
  renderRace(p);
  renderTasks(p);
  renderLegs(p);
  renderFinish(p);
}

function renderTasks(p) {
  if (!p.tasks) return;
  const n = p.tasks.length;
  $('#tasks').innerHTML = p.tasks.map((t, i) => `
    <button class="task ${t.done ? 'done' : ''}" data-task="${t.id}" aria-pressed="${t.done}" ${p.archived ? 'disabled' : ''}
            style="--c:${colorAt((i + 0.5) / n)}">
      <span class="check">${CHECK_SVG}</span>
      <span class="task-name">${esc(t.name)}</span>
      <span class="task-pct">+${fmtPct(t.percent)}%</span>
    </button>`).join('');
  const total = round1(p.tasks.reduce((s, t) => s + t.percent, 0));
  const left = p.tasks.filter((t) => !t.done).length;
  $('#taskHint').textContent = p.archived ? ''
    : left === 0 ? 'Every task is done.'
    : `Tick tasks off as you do them · ${left} left · they add up to ${fmtPct(Math.min(total, 100))}%${total < 100 ? ', finishing them all fills the rest' : ''}`;
}

// ---------- racing the clock (routines with a time limit) ----------
// The server decides the result (timer.result: null → 'beat' | 'missed'); this only shows it.
const pad2 = (n) => String(n).padStart(2, '0');
function clockText(ms, roundUp = false) {
  const s = (roundUp ? Math.ceil : Math.round)(Math.max(0, Math.abs(ms)) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${m}:${pad2(s % 60)}`;
}
const timeLeft = (tm) => Date.parse(tm.endsAt) - Date.now();
const finishGap = (tm) => clockText(Date.parse(tm.endsAt) - Date.parse(tm.finishedAt));
const raceState = (tm) => tm.result || (tm.startedAt ? 'running' : 'ready');
// Short label for menus and stats, e.g. "🏆 Beat the clock"
function raceLabel(p) {
  const tm = p.tasks && p.timer;
  if (!tm) return '';
  return { beat: '🏆 Beat the clock', missed: '⌛ Missed the clock', running: '⏱ Racing the clock', ready: `⏱ ${tm.minutes} min` }[raceState(tm)];
}

// " · Grove worth 55% (down from 100%) · next drop in 4 min" for a day running late
function lateWorthText(p) {
  const was = baseWorth(p), now = worthOf(p);
  let s = now < was ? ` · 🍂 Grove worth ${fmtPct(now)}% (down from ${fmtPct(was)}%)` : '';
  if (stillWithering(p)) {
    const next = Math.ceil(lateSteps(p) * LATE_STEP_MIN - lateMinutes(p));
    s += ` · next drop in ${plural(Math.max(1, next), 'min')}`;
  }
  return s;
}

// A late, unfinished routine loses worth as time passes, so redraw the Grove (and its race strip) now and then
setInterval(() => {
  if (!state.projects.some(stillWithering) && !(groveSeen && groveState().total !== groveSeen.total)) return;
  renderTabs();
  const p = active();
  if (p && p.timer && p.timer.result === 'missed') renderRace(p);
}, 30000);

let raceTick = null;   // interval updating the countdown
let raceSettling = false;

function renderRace(p) {
  clearInterval(raceTick);
  raceTick = null;
  const el = $('#race');
  const tm = p.tasks && p.timer;
  el.hidden = !tm;
  if (!tm) return;
  const phase = raceState(tm);
  el.className = `race ${phase}`;
  const text = (title, sub) => `<span class="race-text"><b>${title}</b><small>${sub}</small></span>`;
  if (phase === 'beat') {
    el.innerHTML = `<span class="race-icon" aria-hidden="true">🏆</span>` +
      text('You beat the clock', `Every task done with ${finishGap(tm)} to spare of ${tm.minutes} minutes`);
  } else if (phase === 'missed') {
    el.innerHTML = `<span class="race-icon" aria-hidden="true">⌛</span>` +
      text('The clock ran out', (tm.finishedAt ? `Every task done, ${finishGap(tm)} after the ${tm.minutes} minutes`
        : `${tm.minutes} minutes weren't enough today. You can still tick the rest off`) + lateWorthText(p));
  } else if (phase === 'ready') {
    el.innerHTML = `<span class="race-icon" aria-hidden="true">⏱</span>` +
      text(`Race the clock · ${tm.minutes} min`, 'Tick every task before time runs out. The clock starts when you press Start or tick your first task') +
      (p.archived ? '' : `<button type="button" class="btn btn-gold" data-action="start-clock">Start the clock</button>`);
  } else {
    el.innerHTML = `<span class="race-time" id="raceTime"></span>` +
      text('Racing the clock', 'Tick every task before it runs out') +
      `<span class="race-bar"><i id="raceBar"></i></span>`;
    const id = p.id;
    const update = () => {
      const left = timeLeft(tm);
      $('#raceTime').textContent = clockText(left, true);
      $('#raceBar').style.width = `${clamp(left / (tm.minutes * 60000), 0, 1) * 100}%`;
      el.classList.toggle('urgent', left < Math.min(60000, tm.minutes * 6000)); // last minute (or last 10%)
      if (left <= 0) { clearInterval(raceTick); raceTick = null; settleClock(id); }
    };
    update();
    if (timeLeft(tm) > 0) raceTick = setInterval(update, 250);
  }
}

// Time's up on screen: fetch the server's verdict (it settles expired races on every request)
function settleClock(id) {
  if (raceSettling) return;
  raceSettling = true;
  queue = queue.then(async () => {
    try {
      const fresh = (await api.list()).find((x) => x.id === id);
      if (!fresh) return;
      applyUpdate(fresh);
      if (fresh.timer?.result === 'missed') toast(`⌛ Time's up on “${fresh.name}”`);
      else if (!fresh.timer?.result && state.activeId === id) setTimeout(() => renderRace(active()), 1000); // try again shortly
    } catch (e) { toast(e.message); }
    finally { raceSettling = false; }
  });
}

function startClock() {
  const p = active();
  if (!p || !p.timer) return;
  const id = p.id;
  queue = queue.then(async () => {
    try {
      applyUpdate(await api.startClock(id));
      toast(`⏱ Go! ${p.timer.minutes} minutes on the clock`);
    } catch (e) { toast(e.message); }
  });
}

function renderFinish(p) {
  const el = $('#finish');
  if (p.archived) {
    const when = p.archivedAt ? new Date(p.archivedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
    el.innerHTML = `<p>Archived${when ? ` on ${when}` : ''}. Restore it to make changes.</p>
      <button class="btn btn-ghost" data-action="restore">↺ Restore</button>`;
  } else if (p.tasks && p.tasks.every((t) => t.done) && p.progress < 100) {
    el.innerHTML = `<button class="btn btn-gold btn-big btn-glow" data-action="complete">✨ All tasks done — fill the potion</button>`;
  } else if (p.progress >= 100) {
    el.innerHTML = `<p>The potion is full. Nicely done.</p>
      <button class="btn btn-moss btn-big" data-action="archive">Archive ${esc(p.name)}</button>`;
  } else {
    el.innerHTML = '';
  }
}

function renderTrail() {
  const p = active();
  if (!p) return;
  renderLog(p);
}

function renderLog(p) {
  $('#log').innerHTML = [...p.history].reverse().map((h) => {
    let cls = 'zero', delta = '·';
    if (h.kind === 'start') delta = '🌱';
    else if (h.kind === 'timer') delta = '⏱';
    else if (h.delta > 0) { cls = 'up'; delta = `+${fmtPct(h.delta)}`; }
    else if (h.delta < 0) { cls = 'down'; delta = `−${fmtPct(-h.delta)}`; }
    const title = h.kind === 'start' ? esc(h.note || 'Tracker planted')
      : h.kind === 'timer' ? `<b>${esc(h.note)}</b>`
      : h.kind === 'reshape' ? `Stages reshaped · now <b>${fmtPct(h.value)}%</b>`
      : `Reached <b>${fmtPct(h.value)}%</b>` +
        (h.stage ? ` <span class="leg-tag">${esc(h.stageName)} → ${fmtPct(h.stageTo)}%</span>` : '');
    const note = h.note && !['start', 'reshape', 'timer'].includes(h.kind) ? ` <span class="n">— ${esc(h.note)}</span>` : '';
    return `<li><span class="delta ${cls}">${delta}</span><span class="what">${title}${note}</span><time datetime="${h.at}" title="${fullDate(h.at)}">${relTime(h.at)}</time></li>`;
  }).join('');
}

// ============================================================
//  Actions
// ============================================================
let queue = Promise.resolve(); // keep progress writes in order

// floating "+5%", sparkles, and a toast when the potion fills
function celebrate(prev, next, name) {
  const delta = round1(next - prev);
  const color = colorAt(next / 100);
  if (delta !== 0) floater(`${delta > 0 ? '+' : '−'}${fmtPct(Math.abs(delta))}%`, flask.edgeX(), flask.padTop - flask.heroH - 4, color);
  if (delta > 0) sparks(flask.edgeX(), flask.edgeY());
  if (next >= 100 && prev < 100) {
    setTimeout(() => toast(`✨ ${name} complete — the potion is brewed!`), 900);
    sparks(flask.edgeX(), flask.edgeY(), 40);
  }
}

// Apply a server response for the active project and animate the change
function applyUpdate(updated) {
  const prev = flask.target;
  replaceProject(updated);
  renderTabs();
  if (state.activeId !== updated.id) return;
  flask.setTarget(updated.progress);
  celebrate(prev, updated.progress, updated.name);
  renderProjectChrome();
  renderTrail();
}

function toggleTask(taskId) {
  const p = active();
  if (!p || p.archived) return;
  const task = p.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const id = p.id, done = !task.done;
  queue = queue.then(async () => {
    try {
      const before = state.projects.find((x) => x.id === id);
      const wasStarted = !!before?.timer?.startedAt, wasBeat = before?.timer?.result === 'beat', prev = before?.progress ?? 0;
      const updated = await api.toggleTask(id, taskId, done);
      applyUpdate(updated);
      const tm = updated.timer;
      if (tm?.result === 'beat' && !wasBeat) {
        // after the "potion is brewed" toast when this tick also filled it
        setTimeout(() => toast(`🏆 You beat the clock with ${finishGap(tm)} to spare!`), updated.progress >= 100 && prev < 100 ? 3600 : 0);
      } else if (tm?.startedAt && !wasStarted) {
        toast(`⏱ The clock is running: ${tm.minutes} minutes`);
      }
    } catch (e) { toast(e.message); }
  });
}

function completeTasks() {
  const p = active();
  if (!p) return;
  const id = p.id;
  queue = queue.then(async () => {
    try { applyUpdate(await api.complete(id)); }
    catch (e) { toast(e.message); }
  });
}

async function setArchived(archived) {
  const p = active();
  if (!p) return;
  await queue;
  try {
    const updated = await api.archive(p.id, archived);
    replaceProject(updated);
    if (archived) {
      // move on to the next live tracker (or the empty state)
      const next = liveProjects()[0];
      setActive(next ? next.id : null);
      toast(`📦 Archived “${updated.name}”`);
    } else {
      renderTabs();
      renderProjectChrome();
      renderTrail();
      toast(`↺ Restored “${updated.name}”`);
    }
  } catch (e) { toast(e.message); }
}

async function startRoutine(templateId, { planted = false } = {}) {
  closeMenus();
  try {
    const p = await api.startTemplate(templateId, todayKey());
    const isNew = !state.projects.some((x) => x.id === p.id);
    replaceProject(p);
    setActive(p.id);
    toast(planted ? `☀ Planted a new routine. “${p.name}” has begun`
      : isNew ? `☀ Started “${p.name}”` : `Opened “${p.name}”`);
  } catch (e) { toast(e.message); }
}

// ---------- journeys: one potion filled by named stages, each with its own share ----------
const isJourney = (p) => !!p && Array.isArray(p.stages);
// same formula as server.js: each stage's progress weighted by its share
const journeyProgress = (p) => round1(Math.min(100, p.stages.reduce((s, st) => s + (st.share * st.progress) / 100, 0)));

// ---------- the Grove: one master bar that every journey and routine fills ----------
// Never stored: it's worked out from the trackers every time, so every fill, untick, undo, reshape
// and delete moves it (and can take tokens back). Archived trackers still count.
// worth = how much of the Grove bar a tracker fills when it's full (missing = 100; 300 = three tokens).
const baseWorth = (p) => (p && Number.isFinite(p.worth) ? p.worth : 100);
// A timed routine day that missed its clock is worth less: one step down the moment the clock runs out,
// then another every 15 minutes, in five even steps down to 10% at an hour late (or its own worth, if
// that's already below 10%). Lateness is measured to when the last task was ticked (timer.finishedAt),
// or to now while unfinished.
const LATE_STEP_MIN = 15, LATE_STEPS = 5, LATE_FLOOR = 10;
const missedClock = (p) => !!(p && p.tasks && p.timer && p.timer.result === 'missed' && p.timer.endsAt);
const lateMinutes = (p) => {
  if (!missedClock(p)) return 0;
  const end = p.timer.finishedAt ? Date.parse(p.timer.finishedAt) : Date.now();
  return Math.max(0, (end - Date.parse(p.timer.endsAt)) / 60000);
};
const lateSteps = (p) => (missedClock(p) ? Math.min(LATE_STEPS, Math.floor(lateMinutes(p) / LATE_STEP_MIN) + 1) : 0);
const worthOf = (p) => {
  const w = baseWorth(p);
  const steps = lateSteps(p);
  if (!steps) return w;
  const floor = Math.min(w, LATE_FLOOR);
  return round1(w - ((w - floor) * steps) / LATE_STEPS);
};
// Still running late and not yet at the floor, so its worth will drop again
const stillWithering = (p) => missedClock(p) && !p.timer.finishedAt && lateSteps(p) < LATE_STEPS && baseWorth(p) > LATE_FLOOR;
const groveOf = (total) => {
  const t = round1(Math.max(0, total));
  const tokens = Math.floor(t / 100);
  return { total: t, tokens, bar: round1(t - tokens * 100) };
};
const groveTotal = (projects = state.projects) => projects.reduce((s, p) => s + (p.progress * worthOf(p)) / 100, 0);
const groveState = () => groveOf(groveTotal());
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
let groveOpen = false;
let groveReturnId = null; // the tracker to go back to when the Grove view closes
let groveSeen = null;     // the Grove as last drawn, to spot tokens sprouting or withering
let groveWrap = null;

// A Grove token: a little pixel tree on a gold-rimmed coin
const TOKEN_SVG = (() => {
  const rows = ['....G....', '...GGG...', '..GGLGG..', '...GGG...', '..GGGLG..', '.GGLGGGG.', '..GGGGG..', '.GGGGLGG.', 'GGGGGGGGG', '....T....', '....T....'];
  const col = { G: '#4fae63', L: '#9be7a0', T: '#b07a4f' };
  const px = rows.flatMap((r, y) => [...r].map((c, x) => (col[c] ? `<rect x="${x + 3.5}" y="${y + 2.5}" width="1.02" height="1.02" fill="${col[c]}"/>` : ''))).join('');
  return `<svg viewBox="0 0 16 16" width="42" height="42" shape-rendering="crispEdges" aria-hidden="true"><circle cx="8" cy="8" r="7.4" fill="#0e2a21" stroke="#f5d36b" stroke-width="1.1" shape-rendering="geometricPrecision"/>${px}</svg>`;
})();

// Topbar badge, token toasts, and the Grove view when it's open. Runs on every renderTabs().
function renderGrove() {
  const g = groveState();
  $('#groveBar').style.cssText = legFillStyle(g.bar);
  $('#groveTokenCount').innerHTML = g.tokens ? `<span aria-hidden="true">🌳</span> ${g.tokens}` : '';
  const btn = $('#groveBtn');
  btn.title = `Your Grove: ${fmtPct(g.bar)}% · ${fmtPct(round1(100 - g.bar))}% to the next token · ${plural(g.tokens, 'token')}`;
  btn.setAttribute('aria-pressed', String(groveOpen));

  const before = groveSeen;
  groveSeen = g;
  const gained = before ? g.tokens - before.tokens : 0;
  if (gained > 0) {
    // after a "potion is brewed" toast, if this change also filled a tracker
    setTimeout(() => toast(gained === 1 ? `🌳 A Grove token sprouted! You have ${g.tokens}` : `🌳 ${gained} Grove tokens sprouted! You have ${g.tokens}`), 2700);
    btn.classList.remove('sprout');
    void btn.offsetWidth; // restart the animation
    btn.classList.add('sprout');
  } else if (gained < 0) {
    toast(gained === -1 ? `🍂 A Grove token withered. You have ${g.tokens}` : `🍂 ${-gained} Grove tokens withered. You have ${g.tokens}`);
  }

  if (!groveOpen) return;
  clearTimeout(groveWrap);
  if (gained > 0) {
    // fill to the brim, then loop back round
    flask.setTarget(100);
    groveWrap = setTimeout(() => { flask.shown = 0; flask.setTarget(groveState().bar); }, 1400);
  } else {
    if (gained < 0) flask.shown = 100;
    flask.setTarget(g.bar);
  }
  renderGrovePanel(g);
  renderGroveTrail();
}

function openGrove() {
  closeMenus();
  if (!groveOpen) groveReturnId = state.activeId || plantReturnId;
  groveOpen = true;
  state.activeId = null;
  plantReturnId = null;
  history.replaceState(null, '', '#grove');
  $('#empty').hidden = true;
  $('#project').hidden = false;
  $('#trail').hidden = false;
  $('#project').classList.add('grove-mode');
  $('#grovePanel').hidden = false;
  $('#plantBtn').setAttribute('aria-pressed', 'false');
  $('#pname').textContent = 'Grove';
  document.title = 'Grove';
  flask.layout();
  flask.shown = 0;
  flask.facing = 1;
  groveSeen = null; // no token toasts for just opening it
  renderTabs();
}

function leaveGrove() {
  const back = state.projects.find((p) => p.id === groveReturnId && !p.archived) || liveProjects()[0];
  setActive(back ? back.id : null);
}

function renderGrovePanel(g) {
  $('#groveSum').innerHTML = g.tokens
    ? `<b>${plural(g.tokens, 'Grove token')}</b> grown · ${fmtPct(round1(100 - g.bar))}% to the next`
    : `No Grove tokens yet. Fill the bar to 100% to grow your first tree.`;
  const MAX_SHOWN = 40;
  $('#groveTokens').innerHTML = Array.from({ length: Math.min(g.tokens, MAX_SHOWN) },
    (_, i) => `<span class="token" style="--i:${i}" title="Grove token ${i + 1}">${TOKEN_SVG}</span>`).join('') +
    (g.tokens > MAX_SHOWN ? `<span class="token-more">×${g.tokens}</span>` : '');
}

// Every tracker's history merged in time order. Each entry moves the Grove by delta × worth / 100.
function groveTimeline() {
  const events = [];
  for (const p of state.projects) {
    const w = worthOf(p);
    for (const h of p.history || []) if (h.delta) events.push({ at: h.at, p, h, change: (h.delta * w) / 100 });
  }
  events.sort((a, b) => a.at.localeCompare(b.at));
  let total = 0;
  for (const e of events) { e.before = round1(total); total += e.change; e.after = round1(Math.max(0, total)); }
  return events;
}

function renderGroveTrail() {
  const events = groveTimeline();
  const items = [];
  for (const e of events.slice(-200).reverse()) {
    const whenTxt = `<time datetime="${e.at}" title="${fullDate(e.at)}">${relTime(e.at)}</time>`;
    const was = Math.floor(e.before / 100), now = Math.floor(e.after / 100);
    if (now > was) items.push(`<li><span class="delta up">🌳</span><span class="what"><b>A Grove token sprouted</b> · ${plural(now, 'token')} in all</span>${whenTxt}</li>`);
    if (now < was) items.push(`<li><span class="delta down">🍂</span><span class="what"><b>A Grove token withered</b> · ${plural(now, 'token')} in all</span>${whenTxt}</li>`);
    const c = round1(e.change);
    const cls = c > 0 ? 'up' : c < 0 ? 'down' : 'zero';
    const delta = c > 0 ? `+${fmtPct(c)}` : c < 0 ? `−${fmtPct(-c)}` : '·';
    const w = worthOf(e.p);
    const tag = `${esc(e.p.name)} ${e.h.delta > 0 ? '+' : '−'}${fmtPct(Math.abs(e.h.delta))}%${w !== 100 ? ` × ${fmtPct(w)}%` : ''}`;
    const note = e.h.note && !['reshape', 'timer'].includes(e.h.kind) ? ` <span class="n">— ${esc(e.h.note)}</span>` : '';
    items.push(`<li><span class="delta ${cls}">${delta}</span><span class="what">Grove <b>${fmtPct(e.after % 100 === 0 && e.after > 0 ? 100 : round1(e.after % 100))}%</b> <span class="leg-tag">${tag}</span>${note}</span>${whenTxt}</li>`);
  }
  $('#log').innerHTML = items.join('') || `<li><span class="delta zero">🌱</span><span class="what">Nothing has grown yet. Fill a journey or tick a routine.</span><time></time></li>`;
}

const POTION_GRADIENT = `linear-gradient(90deg, ${STOPS.map(([o, c]) => `${c} ${o * 100}%`).join(', ')})`;
const legFillStyle = (v) => `width:${v}%;background-image:${POTION_GRADIENT};background-size:${10000 / Math.max(v, 0.01)}% 100%`;
const stagePick = new Map(); // journey id → selected stage id (this session only)
let pendingStageWrites = 0;

function selectedStage(p) {
  if (!isJourney(p)) return null;
  return p.stages.find((s) => s.id === stagePick.get(p.id)) || p.stages.find((s) => s.progress < 100) || p.stages[0];
}

function selectStage(p, id) {
  stagePick.set(p.id, id);
  renderLegs(p);
}

function moveStage(dir) {
  const p = active();
  const st = selectedStage(p);
  if (!st) return;
  const i = clamp(p.stages.indexOf(st) + dir, 0, p.stages.length - 1);
  selectStage(p, p.stages[i].id);
  $('#legs .leg.selected')?.scrollIntoView({ block: 'nearest' });
}

// A stage with tasks fills from them (each task = an equal slice of its bar), not by hand
const stageHasTasks = (s) => !!(s && s.tasks && s.tasks.length);
const PLUS_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const UP_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const DOWN_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const X_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
let addingTaskFor = null; // "<journey id>/<stage id>" while that stage's "new task" box is open
let addingSubFor = null;  // "<journey id>/<stage id>/<task id>" while a task's "smaller task" box is open
let editingTask = null;   // "<journey id>/<stage id>/<task id>[/<smaller task id>]" while that name's ✎ box is open
let legsRendering = false; // the ✎ box losing focus to a re-render isn't the user leaving it
const expandedTasks = new Set(); // "<journey id>/<stage id>/<task id>" of tasks showing their smaller tasks (collapsed by default)
const expandedStages = new Set(); // "<journey id>/<stage id>" of stages showing their tasks (collapsed by default)
const CHEVRON_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function renderLegs(p) {
  if (!isJourney(p)) return;
  const sel = selectedStage(p);
  const box = $('#legs');
  // keep the "new task" boxes focused (and anything half-typed) across re-renders;
  // data-for is the task id for a smaller-task box, "" for the stage's own box
  const drafts = new Map([...box.querySelectorAll('.stask-input')].map((i) => [i.dataset.for, i.value]));
  const focusedFor = document.activeElement?.classList.contains('stask-input') ? document.activeElement.dataset.for : null;
  // same for an open ✎ box
  const oldEdit = box.querySelector('.stask-edit-input');
  const editDraft = oldEdit?.dataset.key === editingTask ? oldEdit.value : null;
  const editFocused = !!oldEdit && document.activeElement === oldEdit;
  box.classList.toggle('locked', !!p.archived);
  legsRendering = true;
  box.innerHTML = p.stages.map((s) => {
    const n = s.tasks?.length || 0;
    const done = n ? s.tasks.filter((t) => t.done).length : 0;
    const isSel = s.id === sel?.id;
    const open = isSel && n > 0 && expandedStages.has(`${p.id}/${s.id}`);
    return `<div class="leg ${isSel ? 'selected' : ''} ${s.progress >= 100 ? 'done' : ''} ${n ? 'has-tasks' : ''} ${open ? 'open' : ''}" data-stage="${esc(s.id)}"
                 ${n ? `aria-expanded="${open}" title="${open ? 'Hide' : 'Show'} its tasks"` : ''}>
      <span class="leg-label"><b title="${esc(s.name)}">${esc(s.name)}</b><small>${fmtPct(s.share)}% of the journey${n ? ` · ${done}/${n} tasks <span class="leg-chev">${CHEVRON_SVG}</span>` : ''}</small></span>
      <span class="leg-bar" role="slider" aria-label="${esc(s.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s.progress}"><i style="${legFillStyle(s.progress)}"></i></span>
      ${p.archived ? '<span></span>' : `<button type="button" class="leg-add" title="Add a task to ${esc(s.name)}" aria-label="Add a task to ${esc(s.name)}">${PLUS_SVG}</button>`}
      <b class="leg-pct">${fmtPct(s.progress)}%</b>
    </div>` + (isSel ? stageTasksHtml(p, s) : '');
  }).join('');
  box.querySelectorAll('.stask-input').forEach((i) => {
    i.value = drafts.get(i.dataset.for) || '';
    growTaskInput(i);
    if (i.dataset.for === focusedFor) i.focus();
  });
  const edit = box.querySelector('.stask-edit-input');
  if (edit && editDraft !== null) {
    edit.value = editDraft;
    if (editFocused) edit.focus();
  }
  if (edit) growTaskInput(edit);
  legsRendering = false;
}

// The "new task" box grows downward as the text wraps, so long tasks stay readable while typing.
function growTaskInput(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
}

// The selected stage's tasks, one per line under its row. Each task is worth 100% ÷ (number of tasks)
// of the bar; a task with smaller tasks splits its slice between them and ticks itself when they're done.
function stageTasksHtml(p, s) {
  const n = s.tasks?.length || 0;
  const key = `${p.id}/${s.id}`;
  const adding = addingTaskFor === key && !p.archived;
  if (!adding && !(n && expandedStages.has(key))) return ''; // collapsed (the default) or nothing to show
  const ro = !!p.archived;
  const slice = n ? 100 / n : 0;
  const icon = (attr, svg, label, danger) =>
    `<button type="button" class="stask-icon ${danger ? 'danger' : ''}" ${attr} title="${label}" aria-label="${label}">${svg}</button>`;
  // up/down arrows; the first item's ↑ and the last item's ↓ keep their space but stay hidden
  const moves = (i, count, name) =>
    (i > 0 ? icon('data-move="-1"', UP_SVG, `Move ${esc(name)} up`) : '<span class="stask-icon-gap"></span>') +
    (i < count - 1 ? icon('data-move="1"', DOWN_SVG, `Move ${esc(name)} down`) : '<span class="stask-icon-gap"></span>');
  const newBox = (forId, ph, label) =>
    `<form class="stask-add"><textarea class="stask-input" data-for="${esc(forId)}" rows="1" placeholder="${ph}" aria-label="${esc(label)}"></textarea></form>`;
  // the ✎ box that replaces a task's (or smaller task's) line while it's being renamed
  const editKey = (tid, uid) => `${key}/${tid}${uid ? `/${uid}` : ''}`;
  const editBox = (tid, uid, name) =>
    `<form class="stask-add stask-edit"><textarea class="stask-edit-input" data-key="${esc(editKey(tid, uid))}" data-tid="${esc(tid)}" data-uid="${esc(uid || '')}"
       rows="1" aria-label="Rename ${esc(name)}" title="Enter to save, Esc to cancel">${esc(name)}</textarea></form>`;

  const items = (s.tasks || []).map((t, i) => {
    const m = t.subtasks?.length || 0;
    const subsDone = m ? t.subtasks.filter((u) => u.done).length : 0;
    const addingSub = addingSubFor === `${key}/${t.id}` && !ro;
    const open = addingSub || (m > 0 && expandedTasks.has(`${key}/${t.id}`));
    const subs = open ? `<ul class="ssubs">
      ${(t.subtasks || []).map((u, j) => editingTask === editKey(t.id, u.id) && !ro
        ? `<li class="stask-line sub new" data-sub="${esc(u.id)}">${editBox(t.id, u.id, u.name)}</li>`
        : `<li class="stask-line sub ${u.done ? 'done' : ''}" data-sub="${esc(u.id)}">
          <button type="button" class="stask-toggle" aria-pressed="${u.done}" ${ro ? 'disabled' : ''}>
            <span class="check">${CHECK_SVG}</span><span class="stask-name">${esc(u.name)}</span><span class="stask-pct">+${fmtPct(round1(slice / m))}%</span>
          </button>
          ${ro ? '' : `<span class="stask-actions">${moves(j, m, u.name)}${icon('data-edit', PEN_SVG, `Rename ${esc(u.name)}`)}${icon('data-remove-sub', X_SVG, `Remove ${esc(u.name)}`, true)}</span>`}
        </li>`).join('')}
      ${addingSub ? `<li class="stask-line sub new">${newBox(t.id, 'Smaller task… press Enter', `New smaller task for ${t.name}`)}</li>` : ''}
    </ul>` : '';
    const line = editingTask === editKey(t.id) && !ro
      ? `<div class="stask-line new">${editBox(t.id, '', t.name)}</div>`
      : `<div class="stask-line ${t.done ? 'done' : ''}">
        <button type="button" class="stask-toggle ${m ? 'auto' : ''} ${open ? 'open' : ''}"
                ${m ? `aria-expanded="${open}" title="${open ? 'Hide' : 'Show'} smaller tasks. It ticks itself when they're all done"`
                    : `aria-pressed="${!!t.done}" ${ro ? 'disabled' : ''}`}>
          <span class="check">${CHECK_SVG}</span><span class="stask-name">${esc(t.name)}</span>
          ${m ? `<span class="stask-count">${subsDone}/${m}</span><span class="stask-chev">${CHEVRON_SVG}</span>` : ''}<span class="stask-pct">+${fmtPct(round1(slice))}%</span>
        </button>
        ${ro ? '' : `<span class="stask-actions">${moves(i, n, t.name)}${icon('data-edit', PEN_SVG, `Rename ${esc(t.name)}`)}${icon('data-add-sub', PLUS_SVG, `Add a smaller task to ${esc(t.name)}`)}${icon('data-remove-task', X_SVG, `Remove ${esc(t.name)}`, true)}</span>`}
      </div>`;
    return `<li class="stask" data-task="${esc(t.id)}" style="--c:${colorAt((i + 0.5) / n)}">
      ${line}
      ${subs}
    </li>`;
  }).join('');
  return `<ul class="stasks" data-stage="${esc(s.id)}">${items}
    ${adding ? `<li class="stask-line new">${newBox('', 'New task… press Enter', `New task for ${s.name}`)}</li>` : ''}
  </ul>`;
}

const focusTaskInput = (forId = '') => $(`#legs .stask-input[data-for="${CSS.escape(forId)}"]`)?.focus();

// Clicking a stage row: an unselected stage gets selected and shows its tasks;
// clicking the selected stage again collapses or expands them.
function pickStage(p, sid) {
  const key = `${p.id}/${sid}`;
  if (stageHasTasks(p.stages.find((s) => s.id === sid))) {
    if (selectedStage(p)?.id !== sid || !expandedStages.has(key)) expandedStages.add(key);
    else {
      expandedStages.delete(key);
      if (addingTaskFor === key) addingTaskFor = null; // collapsing also closes its "new task" box
    }
  }
  selectStage(p, sid);
}

function openTaskInput(p, sid) {
  stagePick.set(p.id, sid);
  addingTaskFor = `${p.id}/${sid}`;
  expandedStages.add(addingTaskFor);
  renderLegs(p);
  focusTaskInput();
}

// Show or hide a task's smaller tasks
function toggleExpanded(p, sid, tid) {
  const key = `${p.id}/${sid}/${tid}`;
  if (expandedTasks.has(key)) {
    expandedTasks.delete(key);
    if (addingSubFor === key) addingSubFor = null; // collapsing also closes its "smaller task" box
  } else {
    expandedTasks.add(key);
  }
  renderLegs(p);
}

function openSubInput(p, sid, tid) {
  addingSubFor = `${p.id}/${sid}/${tid}`;
  expandedTasks.add(addingSubFor); // stay open once the first smaller task is added
  renderLegs(p);
  focusTaskInput(tid);
}

// ✎ on a task or smaller task: swap its line for an edit box holding the name
function openTaskEdit(p, sid, tid, uid) {
  editingTask = `${p.id}/${sid}/${tid}${uid ? `/${uid}` : ''}`;
  renderLegs(p);
  const el = $('#legs .stask-edit-input');
  if (!el) return;
  el.focus();
  el.select();
}

// Clicking elsewhere blurs the ✎ box on press; wait until that click has landed before
// re-rendering, so it isn't swallowed (e.g. ✎ on another task).
let pointerHeld = false;
window.addEventListener('pointerdown', () => { pointerHeld = true; }, true);
window.addEventListener('pointerup', () => { pointerHeld = false; }, true);
window.addEventListener('pointercancel', () => { pointerHeld = false; }, true);
const afterPointer = (fn) => (pointerHeld ? window.addEventListener('pointerup', () => setTimeout(fn), { once: true }) : fn());

// Close the ✎ box; save the new name unless cancelled or unchanged. Optimistic, rolled back on error.
function finishTaskEdit(input, save) {
  const key = input.dataset.key;
  if (editingTask !== key) return; // already closed (Enter, then the blur that follows)
  editingTask = null;
  const p = active();
  const sid = input.closest('.stasks')?.dataset.stage;
  const { tid, uid } = input.dataset;
  const task = p?.stages?.find((s) => s.id === sid)?.tasks?.find((t) => t.id === tid);
  const item = uid ? task?.subtasks?.find((u) => u.id === uid) : task;
  const name = input.value.replace(/\s+/g, ' ').trim();
  if (!save || !item || !name || name === item.name) { if (isJourney(p)) renderLegs(p); return; }
  const old = item.name;
  item.name = name;
  renderLegs(p);
  queue = queue.then(async () => {
    try {
      applyUpdate(await (uid ? api.renameSubtask(p.id, sid, tid, uid, name) : api.renameStageTask(p.id, sid, tid, name)));
    } catch (e) {
      item.name = old;
      if (active() === p) renderLegs(p);
      toast(e.message);
    }
  });
}

function addSubtask(input) {
  const p = active();
  const st = selectedStage(p);
  const task = st?.tasks?.find((t) => t.id === input.dataset.for);
  const name = input.value.trim();
  if (!task || !name) return;
  if (!task.subtasks?.length && task.done &&
      !confirm(`“${task.name}” is ticked. Once it has smaller tasks, it ticks itself when they're all done, so it will be unticked for now. Add it?`)) return;
  input.value = '';
  stageTaskWrite(() => api.addSubtask(p.id, st.id, task.id, name), st.id);
}

function toggleSubtask(sid, tid, uid) {
  const p = active();
  const sub = p?.stages?.find((s) => s.id === sid)?.tasks?.find((t) => t.id === tid)?.subtasks?.find((u) => u.id === uid);
  if (!sub) return;
  stageTaskWrite(() => api.toggleSubtask(p.id, sid, tid, uid, !sub.done), sid);
}

// Move a task (or a smaller task, when uid is given) one place up (-1) or down (1); the order is saved
function moveTask(sid, tid, uid, by) {
  const p = active();
  if (!p) return;
  stageTaskWrite(() => (uid ? api.moveSubtask(p.id, sid, tid, uid, by) : api.moveStageTask(p.id, sid, tid, by)), sid);
}

function removeSubtask(sid, tid, uid) {
  const p = active();
  if (p) stageTaskWrite(() => api.removeSubtask(p.id, sid, tid, uid), sid);
}

// Run a stage-task request on the write queue and animate the result
function stageTaskWrite(call, sid) {
  const id = state.activeId;
  queue = queue.then(async () => {
    const before = state.projects.find((x) => x.id === id)?.stages?.find((s) => s.id === sid)?.progress ?? 0;
    try {
      const updated = await call();
      applyUpdate(updated);
      const st = updated.stages?.find((s) => s.id === sid);
      if (st && st.progress >= 100 && before < 100 && updated.progress < 100) toast(`🏁 “${st.name}” is done`);
    } catch (e) { toast(e.message); }
  });
}

function addStageTask(input) {
  const p = active();
  const st = selectedStage(p);
  const name = input.value.trim();
  if (!st || !name) return;
  if (!stageHasTasks(st) && st.progress > 0 &&
      !confirm(`“${st.name}” is at ${fmtPct(st.progress)}%. Once it has tasks, its bar fills from them instead, so it starts again at 0 of 1 done. Add the task?`)) return;
  input.value = '';
  stageTaskWrite(() => api.addStageTask(p.id, st.id, name), st.id);
}

function toggleStageTask(sid, tid) {
  const p = active();
  const task = p?.stages?.find((s) => s.id === sid)?.tasks?.find((t) => t.id === tid);
  if (!task) return;
  stageTaskWrite(() => api.toggleStageTask(p.id, sid, tid, !task.done), sid);
}

function removeStageTask(sid, tid) {
  const p = active();
  if (!p) return;
  stageTaskWrite(() => api.removeStageTask(p.id, sid, tid), sid);
}

// Fill one stage. Optimistic: the bars and potion move first, then the server confirms.
function commitStage(value, stageId) {
  const p = active();
  if (!isJourney(p) || p.archived) return;
  const st = stageId ? p.stages.find((s) => s.id === stageId) : selectedStage(p);
  if (!st) return;
  if (stageHasTasks(st)) { toast(`“${st.name}” fills up from its tasks. Tick them off instead.`); return; }
  const to = round1(clamp(value, 0, 100));
  if (to === st.progress) { renderLegs(p); return; }

  const prev = p.progress;
  const wasDone = st.progress >= 100;
  st.progress = to;
  p.progress = journeyProgress(p);
  flask.setTarget(p.progress);
  celebrate(prev, p.progress, p.name);
  if (to >= 100 && !wasDone && p.progress < 100) toast(`🏁 “${st.name}” is done`);
  renderProjectChrome();
  renderTabs();

  const id = p.id, sid = st.id;
  pendingStageWrites++;
  queue = queue.then(async () => {
    try {
      const updated = await api.stageProgress(id, sid, to, '');
      // only take the server's copy once every queued write is in, so quick clicks don't flicker back
      if (--pendingStageWrites === 0) {
        replaceProject(updated);
        if (state.activeId === id) { renderProjectChrome(); renderTrail(); }
        renderTabs();
      }
    } catch (e) {
      pendingStageWrites--;
      toast(`Couldn't save: ${e.message}`);
      try {
        const fresh = (await api.list()).find((x) => x.id === id);
        if (fresh) {
          replaceProject(fresh);
          if (state.activeId === id) { flask.setTarget(fresh.progress); renderProjectChrome(); renderTrail(); }
          renderTabs();
        }
      } catch { /* the toast already says it failed */ }
    }
  });
}

// ← → go to the journey's selected stage
function nudge(step) {
  const st = selectedStage(active());
  if (st) commitStage(st.progress + step);
}

// ---------- editor sheet: plants or tends a routine (templates.json) or a journey's stages ----------
const PEN_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
const EDITORS = {
  routine: {
    row: 'task', rowsLabel: 'Tasks', rowsHint: 'how much of the potion each one fills',
    namePh: 'e.g. Morning', rowPh: 'e.g. Brush teeth', pctPh: '10', pctLabel: 'Percent of the potion', exact: false,
    newEyebrow: 'New routine', newTitle: 'Plant a daily routine', newSave: 'Plant routine',
    newNote: 'Each day you start it, you get a fresh copy to tick off.',
    editEyebrow: 'Tend a routine', editSave: 'Save routine',
    editNote: "Task changes apply from the next day you start it. A new Grove worth counts for today too.",
    worthWhat: 'Each day you finish it',
  },
  journey: {
    row: 'stage', rowsLabel: 'Stages', rowsHint: "each one's share of the whole journey",
    namePh: 'e.g. Thesis', rowPh: 'e.g. Chapter 1 · Introduction', pctPh: '25', pctLabel: 'Share of the journey', exact: true,
    newEyebrow: 'New journey', newTitle: 'Plant a journey', newSave: 'Plant journey',
    newNote: "Each stage gets its own bar to fill. Together they fill the journey's potion.",
    editEyebrow: 'Reshape a journey', editSave: 'Save stages',
    editNote: 'Stages you keep keep their progress and tasks. A removed stage takes them with it.',
    worthWhat: 'Finishing it',
  },
};
const sheet = { mode: 'routine', editingId: null, saving: false }; // editingId is null while planting
const sheetCfg = () => EDITORS[sheet.mode];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

function rowHtml(r = { name: '', percent: '' }) {
  const c = sheetCfg();
  return `<li class="te-row"${r.id ? ` data-id="${esc(r.id)}"` : ''}>
    <i class="te-dot"></i>
    <input class="te-name" type="text" maxlength="60" placeholder="${esc(c.rowPh)}" value="${esc(r.name)}" aria-label="${cap(c.row)} name" />
    <span class="te-pct"><input type="number" min="0.5" max="100" step="0.5" placeholder="${c.pctPh}" value="${esc(r.percent)}" aria-label="${c.pctLabel}" /><i>%</i></span>
    <button type="button" class="icon-btn te-remove" title="Remove ${c.row}" aria-label="Remove ${c.row}">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
    </button>
  </li>`;
}

function readRows() {
  return [...$('#sheetRows').children].map((row, i) => {
    const name = row.querySelector('.te-name').value.trim().replace(/\s+/g, ' ');
    const raw = row.querySelector('.te-pct input').value.trim();
    return { row, i, id: row.dataset.id, name, raw, percent: raw === '' ? NaN : Number(raw) };
  });
}

const rowsTotal = (rows) =>
  round1(rows.reduce((s, r) => s + (Number.isFinite(r.percent) && r.percent > 0 ? r.percent : 0), 0));

// Live total under the rows. Routines: over 100% is an error. Journeys: anything but exactly 100% blocks saving.
function updateSheetTotal() {
  const c = sheetCfg();
  const rows = readRows();
  rows.forEach((r) => r.row.style.setProperty('--c', colorAt((r.i + 0.5) / rows.length)));
  const total = rowsTotal(rows);
  const over = total > 100;
  const short = c.exact && total > 0 && total < 100;
  const box = $('#sheetTotal');
  box.classList.toggle('over', over);
  box.classList.toggle('short', short);
  box.querySelector('.te-meter > i').style.cssText = legFillStyle(Math.min(total, 100));
  const left = fmtPct(round1(100 - total));
  const extra = fmtPct(round1(total - 100));
  $('#sheetSum').textContent = c.exact
    ? (over ? `Your stages add up to ${fmtPct(total)}%. That's ${extra}% too much: a journey's stages must add up to exactly 100%.`
      : total === 0 ? 'Give each stage a share of the journey. Together they must make exactly 100%.'
      : total === 100 ? 'Adds up to exactly 100%.'
      : `Adds up to ${fmtPct(total)}%. Share out ${left}% more: a journey's stages must add up to exactly 100%.`)
    : (over ? `Your tasks add up to ${fmtPct(total)}%. That's ${extra}% more than the potion holds, so trim them to 100% or less.`
      : total === 0 ? 'Give each task a share of the potion.'
      : total === 100 ? 'Adds up to exactly 100%.'
      : `Adds up to ${fmtPct(total)}%. Finishing every task fills the rest.`);
  $('#sheetSave').disabled = over || (c.exact && total !== 100);
  updateWorthHint();
}

function setSheetError(msg) { $('#sheetError').textContent = msg; }

// The Grove worth box: empty means 100. Returns the number, or NaN when it's out of range.
function readWorth() {
  const raw = $('#sheetWorth').value.trim();
  const n = raw === '' ? 100 : Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? round1(n) : NaN;
}

function updateWorthHint() {
  const w = readWorth();
  const what = sheetCfg().worthWhat;
  $('#sheetWorthHint').textContent = Number.isNaN(w) ? '· a number from 0 to 1000%'
    : w === 0 ? "· it won't grow the Grove"
    : `· ${what.toLowerCase()} fills ${fmtPct(w)}% of the Grove bar${w >= 100 ? ` (${fmtPct(round1(w / 100))} ${w === 100 ? 'token' : 'tokens'})` : ''}`;
}

// mode: 'routine' | 'journey'. item: the template / journey being tended, or null to plant a new one.
function openSheet(mode, { item = null, name = '' } = {}) {
  closeMenus();
  sheet.mode = mode;
  sheet.editingId = item ? item.id : null;
  const c = sheetCfg();
  $('#sheetEyebrow').textContent = item ? c.editEyebrow : c.newEyebrow;
  $('#sheetTitle').textContent = item ? item.name : c.newTitle;
  $('#sheetName').value = item ? item.name : name;
  $('#sheetName').placeholder = c.namePh;
  $('#sheetRowsLabel').innerHTML = `${c.rowsLabel} <small>· ${esc(c.rowsHint)}</small>`;
  $('#sheetAddRow').textContent = `+ Add ${c.row}`;
  $('#sheetSplit').hidden = !c.exact;
  const rows = !item ? [undefined, undefined, undefined]
    : mode === 'journey' ? item.stages.map((s) => ({ id: s.id, name: s.name, percent: s.share }))
    : item.tasks;
  $('#sheetRows').innerHTML = rows.map((r) => rowHtml(r)).join('');
  $('#sheetSave').textContent = item ? c.editSave : c.newSave;
  $('#sheetDelete').hidden = !(item && mode === 'routine');
  $('#sheetClockField').hidden = mode !== 'routine';
  $('#sheetMinutes').value = (mode === 'routine' && item?.minutes) || '';
  $('#sheetWorth').value = item ? worthOf(item) : 100;
  $('#sheetNote').textContent = item ? c.editNote : c.newNote;
  setSheetError('');
  updateSheetTotal();
  $('#sheet').showModal();
  ($('#sheetName').value ? $('#sheetRows .te-name') : $('#sheetName')).focus();
}

function addRow(focus = true) {
  $('#sheetRows').insertAdjacentHTML('beforeend', rowHtml());
  updateSheetTotal();
  const row = $('#sheetRows').lastElementChild;
  row.scrollIntoView({ block: 'nearest' });
  if (focus) row.querySelector('.te-name').focus();
}

// Share 100% evenly across the named rows (or all rows if none are named yet); the last row takes the rounding
function splitEvenly() {
  const rows = readRows();
  const named = rows.filter((r) => r.name);
  const targets = named.length ? named : rows;
  const n = targets.length;
  if (!n) return;
  const base = Math.floor(1000 / n) / 10;
  targets.forEach((r, i) => { r.row.querySelector('.te-pct input').value = i === n - 1 ? round1(100 - base * (n - 1)) : base; });
  setSheetError('');
  updateSheetTotal();
}

async function saveSheet() {
  if (sheet.saving) return;
  const c = sheetCfg();
  const name = $('#sheetName').value.trim();
  const rows = readRows();
  rows.forEach((r) => r.row.classList.remove('invalid'));
  const filled = rows.filter((r) => r.name || r.raw); // blank rows are ignored
  const bad = (r, msg) => { r.row.classList.add('invalid'); setSheetError(msg); r.row.querySelector(r.name ? '.te-pct input' : '.te-name').focus(); };

  if (!name) { setSheetError(`Give your ${sheet.mode} a name.`); $('#sheetName').focus(); return; }
  if (!filled.length) { setSheetError(`Add at least one ${c.row}.`); $('#sheetRows .te-name')?.focus(); return; }
  for (const r of filled) {
    if (!r.name) return bad(r, `${cap(c.row)} ${r.i + 1} needs a name.`);
    if (!(r.percent > 0 && r.percent <= 100)) return bad(r, `“${r.name}” needs a ${c.exact ? 'share' : 'percent'} above 0 and up to 100.`);
  }
  const total = rowsTotal(filled);
  if (c.exact && total !== 100) { setSheetError(`Your stages add up to ${fmtPct(total)}%. Make them exactly 100% before saving.`); return; }
  if (total > 100) { setSheetError('Trim your tasks to 100% or less before saving.'); return; }
  const rawMinutes = $('#sheetMinutes').value.trim();
  const minutes = rawMinutes === '' ? null : Number(rawMinutes);
  if (sheet.mode === 'routine' && minutes !== null && !(Number.isInteger(minutes) && minutes >= 0 && minutes <= 720)) {
    setSheetError('The time limit should be whole minutes, from 1 to 720. Leave it empty for no timer.');
    $('#sheetMinutes').focus();
    return;
  }

  const worth = readWorth();
  if (Number.isNaN(worth)) {
    setSheetError('Grove worth should be a number from 0 to 1000%.');
    $('#sheetWorth').focus();
    return;
  }

  // reshaping a journey: dropping a stage drops its progress, so check first
  if (sheet.mode === 'journey' && sheet.editingId) {
    const p = state.projects.find((x) => x.id === sheet.editingId);
    const kept = new Set(filled.map((r) => r.id).filter(Boolean));
    const lost = (p?.stages || []).filter((s) => !kept.has(s.id) && s.progress > 0);
    if (lost.length && !confirm(`Remove ${lost.map((s) => `“${s.name}” (${fmtPct(s.progress)}% done)`).join(', ')}? That progress goes with it.`)) return;
  }
  setSheetError('');

  sheet.saving = true;
  $('#sheetSave').disabled = true;
  try {
    if (sheet.mode === 'routine') {
      const body = { name, minutes: minutes || null, worth, tasks: filled.map((r) => ({ name: r.name, percent: r.percent })) };
      if (sheet.editingId) {
        const t = await api.updateTemplate(sheet.editingId, { ...body, date: todayKey() }); // today's day takes the new worth
        await refreshTemplates();
        const today = (await api.list()).find((p) => p.templateId === t.id && p.date === todayKey());
        if (today) {
          replaceProject(today);
          renderTabs();
          if (state.activeId === today.id) { renderProjectChrome(); renderTrail(); }
        }
        $('#sheet').close();
        toast(`🌿 Saved the “${t.name}” routine`);
      } else {
        const t = await api.createTemplate(body);
        await refreshTemplates();
        $('#sheet').close();
        $('#emptyName').value = '';
        setPlantKind('journey');
        await startRoutine(t.id, { planted: true });
      }
    } else if (sheet.editingId) {
      await queue; // let any stage fills land first
      const updated = await api.reshape(sheet.editingId, { name, worth, stages: filled.map((r) => ({ id: r.id, name: r.name, share: r.percent })) });
      $('#sheet').close();
      applyUpdate(updated);
      if (state.activeId === updated.id) { $('#pname').textContent = updated.name; document.title = `${updated.name} · Grove`; }
      toast('🧭 Stages saved');
    } else {
      const p = await api.create({ name, kind: 'journey', worth, stages: filled.map((r) => ({ name: r.name, share: r.percent })) });
      $('#sheet').close();
      $('#emptyName').value = '';
      setPlantKind('journey');
      state.projects.push(p);
      setActive(p.id);
      toast(`🧭 Planted “${p.name}”`);
    }
  } catch (e) {
    setSheetError(e.message);
  } finally {
    sheet.saving = false;
    updateSheetTotal();
  }
}

async function deleteRoutine() {
  const t = state.templates.find((x) => x.id === sheet.editingId);
  if (sheet.mode !== 'routine' || !t) return;
  if (!confirm(`Delete the “${t.name}” routine? Days you've already started stay in your trackers and archive.`)) return;
  try {
    await api.deleteTemplate(t.id);
    await refreshTemplates();
    $('#sheet').close();
    toast(`Removed the “${t.name}” routine`);
  } catch (e) { setSheetError(e.message); }
}

// Keyboard flow: Enter moves name → percent → next row (adding one at the end); ⌘/Ctrl+Enter saves
function onSheetKeydown(e) {
  if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
  e.preventDefault();
  if (e.metaKey || e.ctrlKey) { saveSheet(); return; }
  const t = e.target;
  if (t.id === 'sheetName') { $('#sheetRows .te-name')?.focus(); return; }
  if (t.id === 'sheetMinutes' || t.id === 'sheetWorth') { saveSheet(); return; }
  const row = t.closest('.te-row');
  if (!row) return;
  if (t.classList.contains('te-name')) { row.querySelector('.te-pct input').focus(); return; }
  const next = row.nextElementSibling;
  if (next) next.querySelector('.te-name').focus(); else addRow();
}

// ---------- plant view: pick a journey or routine, then name it ----------
// Shown when nothing is planted, or from ＋ Plant (then "Back" returns to the tracker you were on).
const PLANT_KINDS = {
  journey: { ph: 'thesis', label: 'New journey name', btn: 'Plant journey…' },
  routine: { ph: 'morning', label: 'New routine name', btn: 'Plant routine…' },
};
let plantKind = 'journey';
let plantReturnId = null;

function setPlantKind(kind) {
  plantKind = kind;
  const k = PLANT_KINDS[kind];
  document.querySelectorAll('.kind-cards [data-kind]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
  $('#emptyName').placeholder = k.ph;
  $('#emptyName').setAttribute('aria-label', k.label);
  $('#emptyForm [type="submit"]').textContent = k.btn;
}

function openPlantView() {
  closeMenus();
  if (groveOpen) { plantReturnId = groveReturnId; setActive(null); return; }
  if (!active()) { $('#emptyName').focus(); return; }
  plantReturnId = state.activeId;
  setActive(null);
}

function renderPlantView() {
  $('#plantEyebrow').textContent = state.projects.length ? 'Plant something new' : 'Welcome, wanderer';
  const back = state.projects.find((p) => p.id === plantReturnId && !p.archived);
  $('#plantBack').hidden = !back;
  if (back) $('#plantBack').textContent = `← Back to ${back.name}`;
}

function leavePlantView() {
  const back = state.projects.find((p) => p.id === plantReturnId);
  if (back) setActive(back.id);
}

function plant(input) {
  // routines and journeys need rows, so they open the editor; the input clears once they're planted
  openSheet(plantKind, { name: input.value.trim() });
}

// ---------- menus ----------
async function refreshTemplates() {
  try { state.templates = await api.templates(); }
  catch (e) { state.templates = []; toast(e.message); }
}

function routineItems() {
  const today = todayKey();
  return state.templates.map((t) => {
    const inst = state.projects.find((p) => p.templateId === t.id && p.date === today);
    const total = round1(t.tasks.reduce((s, k) => s + k.percent, 0));
    const race = inst?.timer?.result ? `${raceLabel(inst).split(' ')[0]} ` : ''; // 🏆 / ⌛ once today's race is decided
    const action = !inst ? `Start ${dayLabel(today)}`
      : inst.archived ? `${race}Done today ✓`
      : `${race}Open · ${fmtPct(inst.progress)}%`;
    return `<div class="menu-row">
      <button class="menu-item" data-template="${esc(t.id)}">
        <span class="mi-main"><b>${esc(t.name)}</b><small>${t.tasks.length} tasks · ${fmtPct(total)}%${t.minutes ? ` · ⏱ ${t.minutes} min` : ''}${worthOf(t) !== 100 ? ` · 🌳 ${fmtPct(worthOf(t))}%` : ''}</small></span>
        <span class="mi-action ${inst ? 'open' : ''}">${action}</span>
      </button>
      <button class="icon-btn mi-edit" data-edit-template="${esc(t.id)}" title="Edit routine" aria-label="Edit the ${esc(t.name)} routine">${PEN_SVG}</button>
    </div>`;
  }).join('');
}

function renderRoutinesMenu() {
  $('#routinesMenu').innerHTML = `<h3>Daily routines</h3>` +
    (routineItems() || `<p class="empty-note">No routines yet.</p>`) +
    `<button class="menu-item menu-add" data-new-routine>＋ New routine</button>`;
}

function renderArchiveMenu() {
  const list = archivedProjects().sort((a, b) => (b.archivedAt || '').localeCompare(a.archivedAt || ''));
  $('#archiveMenu').innerHTML = `<h3>Archive</h3>` + (list.map((p) => `
    <button class="menu-item" data-project="${p.id}">
      <span class="mi-main"><b>${esc(p.name)}</b><small>${[p.archivedAt && 'Archived ' + relTime(p.archivedAt), raceLabel(p)].filter(Boolean).join(' · ')}</small></span>
      <span class="mini-bar"><i style="width:${p.progress}%"></i></span>
    </button>`).join('') || `<p class="empty-note">Nothing archived yet. Full potions can be archived from their page.</p>`);
}


function closeMenus() {
  for (const [btn, menu] of [['#routinesBtn', '#routinesMenu'], ['#archiveBtn', '#archiveMenu']]) {
    $(menu).hidden = true;
    $(btn).setAttribute('aria-expanded', 'false');
  }
}

async function toggleMenu(btnSel, menuSel, render) {
  const open = $(menuSel).hidden;
  closeMenus();
  if (!open) return;
  if (menuSel === '#routinesMenu') await refreshTemplates(); // pick up edits to templates.json
  render();
  $(menuSel).hidden = false;
  $(btnSel).setAttribute('aria-expanded', 'true');
}

function startRename() {
  const el = $('#pname');
  const p = active();
  if (!p || el.isContentEditable) return;
  el.contentEditable = 'true';
  el.focus();
  document.getSelection().selectAllChildren(el);
  const finish = async (save) => {
    el.removeEventListener('keydown', onKey);
    el.removeEventListener('blur', onBlur);
    el.contentEditable = 'false';
    const name = el.textContent.trim();
    if (!save || !name || name === p.name) { el.textContent = p.name; return; }
    try {
      const updated = await api.rename(p.id, name);
      replaceProject(updated);
      el.textContent = updated.name;
      document.title = `${updated.name} · Grove`;
      renderTabs();
    } catch (e) { el.textContent = p.name; toast(e.message); }
  };
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  const onBlur = () => finish(true);
  el.addEventListener('keydown', onKey);
  el.addEventListener('blur', onBlur);
}

async function deleteProject() {
  const p = active();
  if (!p) return;
  const gave = round1((p.progress * worthOf(p)) / 100);
  const withered = groveState().tokens - groveOf(groveTotal() - (p.progress * worthOf(p)) / 100).tokens;
  const grove = gave > 0
    ? ` It gave your Grove ${fmtPct(gave)}%, which goes with it${withered > 0 ? ` (${plural(withered, 'Grove token')} would wither)` : ''}. Archiving keeps it instead.`
    : '';
  if (!confirm(`Delete “${p.name}” and its whole history? This can't be undone.${grove}`)) return;
  try {
    await api.remove(p.id);
    const live = liveProjects();
    const i = live.indexOf(p);
    state.projects.splice(state.projects.indexOf(p), 1);
    const rest = liveProjects();
    const next = rest[Math.min(Math.max(i, 0), rest.length - 1)];
    setActive(next ? next.id : null);
    toast(`Removed “${p.name}”`);
  } catch (e) { toast(e.message); }
}

// ============================================================
//  Pop-out widget (Chrome Document Picture-in-Picture)
//  A small always-on-top window showing one tracker. It follows the
//  selected tab unless a tracker is pinned from inside the widget.
// ============================================================
const PIN_KEY = 'grove.widgetPin';
let pip = null;
let pinnedId = (() => { try { return localStorage.getItem(PIN_KEY); } catch { return null; } })();

function setPin(id) {
  pinnedId = id || null;
  try { id ? localStorage.setItem(PIN_KEY, id) : localStorage.removeItem(PIN_KEY); } catch { /* per-browser nicety only */ }
}

function widgetProject() {
  if (pinnedId) {
    const p = state.projects.find((x) => x.id === pinnedId);
    if (p) return p;
    setPin(null); // pinned tracker was deleted: go back to following the selection
  }
  // while planting, keep showing the tracker you came from
  return active() || state.projects.find((x) => x.id === plantReturnId) || null;
}

const WIDGET_SIZE = { width: 400, height: 200 };
const MINI_SCALE = 2; // half the size of the main wanderer
let widget = null;    // element refs + animation state while the pop-out is open

// Build the widget once per window: a copy of the forest backdrop plus the card
function buildWidget(doc) {
  const forest = doc.importNode($('.forest'), true); // already drawn by buildForest()
  forest.querySelectorAll('.trees').forEach((el) => { el.style.transform = ''; });
  doc.body.append(forest);

  const card = doc.createElement('div');
  card.className = 'w-card';
  card.innerHTML = `
    <div class="w-head"><span class="w-name"></span><b class="w-pct"></b></div>
    <div class="w-ctl">
      <button data-w="prev" title="Previous tracker" aria-label="Previous tracker">‹</button>
      <button data-w="pin">📌</button>
      <button data-w="next" title="Next tracker" aria-label="Next tracker">›</button>
    </div>
    <p class="w-empty" hidden>Nothing planted yet</p>
    <div class="w-track">
      <canvas class="w-hero"></canvas>
      <div class="w-bar"><i></i></div>
    </div>`;
  doc.body.append(card);
  const q = (s) => card.querySelector(s);

  const fill = q('.w-bar > i');
  fill.style.backgroundImage = `linear-gradient(90deg, ${STOPS.map(([o, c]) => `${c} ${o * 100}%`).join(', ')})`;

  const canvas = q('.w-hero');
  const dpr = pip.devicePixelRatio || 1;
  const heroW = SPRITE_W * MINI_SCALE, heroH = SPRITE_H * MINI_SCALE;
  canvas.width = heroW * dpr;
  canvas.height = heroH * dpr;
  canvas.style.width = heroW + 'px';
  canvas.style.height = heroH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;

  widget = {
    card, fill, canvas, ctx, heroW,
    name: q('.w-name'), pct: q('.w-pct'), pinBtn: q('[data-w="pin"]'), empty: q('.w-empty'), track: q('.w-track'),
    id: null, shown: 0, target: 0, facing: 1, last: performance.now(),
    walkClock: 0, step: 0, hopAt: performance.now() / 1000 + 1.5, hopClock: -1,
    nextBlink: 2, blinkUntil: 0, heroKey: '', color: '', pctText: '',
  };
  pip.requestAnimationFrame(tickWidget);
}

// Sync the widget with state (called from renderTabs after every change)
function renderWidget() {
  if (!pip || !widget) return;
  const W = widget;
  const p = widgetProject();
  W.empty.hidden = !!p;
  W.card.classList.toggle('none', !p);
  if (!p) { W.id = null; pip.document.title = 'Grove'; return; }
  if (p.id !== W.id) { W.id = p.id; W.shown = 0; W.facing = 1; } // walk in from the start, like the main flask
  W.target = clamp(p.progress, 0, 100);
  W.name.textContent = p.name;
  W.name.title = p.name;
  pip.document.title = `${p.name} · ${fmtPct(p.progress)}%`;
  const pinned = !!pinnedId;
  W.pinBtn.classList.toggle('on', pinned);
  W.pinBtn.setAttribute('aria-pressed', String(pinned));
  W.pinBtn.title = pinned ? `Pinned to ${p.name}. Click to follow the selected tab again` : 'Pin this tracker';
  W.pinBtn.setAttribute('aria-label', W.pinBtn.title);
}

// Animation loop, driven by the PiP window so it keeps running while the Grove tab is in the background
function tickWidget(now) {
  if (!pip || !widget) return;
  const W = widget;
  const dt = Math.min(0.05, (now - W.last) / 1000);
  W.last = now;
  const t = now / 1000;

  // ease toward the target, same feel as the main flask
  const diff = W.target - W.shown;
  const walking = Math.abs(diff) > 0.05;
  if (walking) {
    const step = Math.sign(diff) * Math.max(6, Math.abs(diff) * 1.8) * dt;
    W.shown = Math.abs(step) >= Math.abs(diff) ? W.target : W.shown + step;
    W.facing = Math.sign(diff);
  } else {
    W.shown = W.target;
  }
  const f = W.shown / 100;

  W.fill.style.width = `${W.shown}%`;
  W.fill.style.backgroundSize = `${10000 / Math.max(W.shown, 0.01)}% 100%`; // gradient spans the full bar
  const color = colorAt(f);
  if (color !== W.color) {
    W.color = color;
    pip.document.documentElement.style.setProperty('--potion', color);
    W.pct.style.color = color;
  }
  const txt = fmtPct(walking ? Math.round(W.shown) : W.shown) + '%';
  if (txt !== W.pctText) { W.pctText = txt; W.pct.textContent = txt; }

  // wanderer: walks while the potion moves, otherwise breathes and hops now and then
  let pose = 'idle', bob = 0, flutter = false, jump = 0;
  if (walking) {
    W.walkClock += dt;
    if (W.walkClock > 0.1) { W.walkClock = 0; W.step = (W.step + 1) % 4; }
    pose = W.step % 2 === 0 ? 'stride' : 'pass';
    bob = pose === 'stride' ? 1 : 0;
    flutter = pose === 'stride';
    W.hopClock = -1;
  } else {
    bob = Math.sin(t * 2.6) > 0.3 ? 1 : 0;
    const full = W.target >= 100;
    if (W.hopClock < 0 && t > W.hopAt) {
      W.hopClock = 0;
      if (!full && Math.random() < 0.35) W.facing = -W.facing; // look around
    }
    if (W.hopClock >= 0) {
      W.hopClock += dt;
      const dur = full ? 0.5 : 0.42;
      if (W.hopClock >= dur) {
        W.hopClock = -1;
        W.hopAt = t + (full ? 1.1 : 2.5 + Math.random() * 3); // victory hops are quicker
      } else {
        jump = Math.sin((W.hopClock / dur) * Math.PI) * (full ? 14 : 8);
        pose = 'jump';
        flutter = true;
      }
    }
  }
  if (t > W.nextBlink) { W.blinkUntil = t + 0.13; W.nextBlink = t + 2 + Math.random() * 3.5; }
  const blink = t < W.blinkUntil && !walking;

  const key = `${pose}|${bob}|${blink}|${W.facing}|${flutter}`;
  if (key !== W.heroKey) {
    W.heroKey = key;
    drawHero(W.ctx, MINI_SCALE, { pose, bob, blink, facing: W.facing, flutter });
  }
  const tw = W.track.clientWidth;
  const cx = clamp(f * tw, W.heroW * 0.3, tw - W.heroW * 0.3);
  W.canvas.style.transform = `translate(${(cx - W.heroW / 2).toFixed(1)}px, ${(-jump).toFixed(1)}px)`;

  pip.requestAnimationFrame(tickWidget);
}

function onWidgetClick(e) {
  const btn = e.target.closest('[data-w]');
  if (!btn) return;
  const cmd = btn.dataset.w;
  const cur = widgetProject();
  if (cmd === 'pin') {
    setPin(pinnedId ? null : cur?.id);
  } else {
    const live = liveProjects();
    if (!live.length) return;
    const i = live.findIndex((x) => x.id === cur?.id);
    const step = cmd === 'next' ? 1 : -1;
    const j = i < 0 ? 0 : (i + step + live.length) % live.length;
    setPin(live[j].id);
  }
  renderWidget();
}

function syncPopOutBtn() {
  const b = $('#popOutBtn');
  b.setAttribute('aria-pressed', String(!!pip));
  b.classList.toggle('on', !!pip);
}

async function toggleWidget() {
  if (pip) { pip.close(); return; }
  if (!('documentPictureInPicture' in window)) {
    toast("This browser can't float a widget. Open Grove in Chrome to use it.");
    return;
  }
  try {
    pip = await documentPictureInPicture.requestWindow(WIDGET_SIZE);
  } catch (e) {
    toast(`Couldn't pop out the widget: ${e.message}`);
    return;
  }
  const doc = pip.document;
  // same stylesheets as the main page (fonts + style.css); wait so the forest doesn't flash unstyled
  const loads = [...document.querySelectorAll('link[rel="stylesheet"]')].map((link) => {
    const l = doc.createElement('link');
    l.rel = 'stylesheet';
    l.href = link.href;
    doc.head.append(l);
    return new Promise((r) => { l.onload = l.onerror = r; setTimeout(r, 1500); });
  });
  await Promise.all(loads);
  if (!pip) return; // closed while loading
  doc.body.className = 'pip';
  buildWidget(doc);
  doc.addEventListener('click', onWidgetClick);
  pip.addEventListener('pagehide', () => { pip = null; widget = null; syncPopOutBtn(); });
  syncPopOutBtn();
  renderWidget();
}

// ============================================================
//  Wiring
// ============================================================
function wire() {
  $('#popOutBtn').addEventListener('click', toggleWidget);
  $('#groveBtn').addEventListener('click', () => (groveOpen ? leaveGrove() : openGrove()));
  $('#plantBtn').addEventListener('click', openPlantView);
  $('#plantBack').addEventListener('click', leavePlantView);
  $('#emptyForm').addEventListener('submit', (e) => { e.preventDefault(); plant($('#emptyName')); });
  $('.kind-cards').addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind]');
    if (!b) return;
    setPlantKind(b.dataset.kind);
    $('#emptyName').focus();
  });

  // routine editor
  const dlg = $('#sheet');
  $('#sheetForm').addEventListener('submit', (e) => { e.preventDefault(); saveSheet(); });
  $('#sheetForm').addEventListener('keydown', onSheetKeydown);
  $('#sheetForm').addEventListener('input', () => { setSheetError(''); updateSheetTotal(); });
  $('#sheetAddRow').addEventListener('click', () => addRow());
  $('#sheetSplit').addEventListener('click', splitEvenly);
  $('#sheetDelete').addEventListener('click', deleteRoutine);
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  $('#sheetRows').addEventListener('click', (e) => {
    const row = e.target.closest('.te-remove')?.closest('.te-row');
    if (!row) return;
    if ($('#sheetRows').children.length > 1) row.remove();
    else { row.querySelectorAll('input').forEach((i) => { i.value = ''; }); delete row.dataset.id; } // keep one row to type into
    updateSheetTotal();
  });
  $('#editStagesBtn').addEventListener('click', () => { const p = active(); if (isJourney(p)) openSheet('journey', { item: p }); });

  // journey stages: click a row to pick it, drag its bar to fill it
  const legs = $('#legs');
  let legDrag = null; // { id, bar, row, v } while dragging a stage bar
  const previewLeg = (x) => {
    const r = legDrag.bar.getBoundingClientRect();
    legDrag.v = clamp(Math.round(((x - r.left) / r.width) * 100), 0, 100);
    legDrag.bar.firstElementChild.style.cssText = legFillStyle(legDrag.v);
    legDrag.row.querySelector('.leg-pct').textContent = `${legDrag.v}%`;
  };
  legs.addEventListener('pointerdown', (e) => {
    const p = active();
    const row = e.target.closest('.leg');
    if (!isJourney(p) || !row || e.target.closest('.leg-add')) return; // ＋ is handled on click
    const bar = e.target.closest('.leg-bar');
    const stage = p.stages.find((s) => s.id === row.dataset.stage);
    // anything but dragging a hand-filled bar picks the stage (and opens/closes its tasks);
    // archived journeys can still be browsed this way
    if (p.archived || !bar || stageHasTasks(stage)) { pickStage(p, row.dataset.stage); return; }
    e.preventDefault();
    stagePick.set(p.id, row.dataset.stage);
    legs.querySelectorAll('.leg').forEach((el) => el.classList.toggle('selected', el === row));
    bar.setPointerCapture(e.pointerId);
    legDrag = { id: row.dataset.stage, bar, row, v: 0 };
    previewLeg(e.clientX);
  });
  legs.addEventListener('pointermove', (e) => { if (legDrag) previewLeg(e.clientX); });
  legs.addEventListener('pointerup', () => {
    if (!legDrag) return;
    const { id, v } = legDrag;
    legDrag = null;
    commitStage(v, id);
  });
  legs.addEventListener('pointercancel', () => { if (legDrag) { legDrag = null; renderLegs(active()); } });

  // stage tasks: ＋ opens the "new task" box, chips tick/untick, × removes
  legs.addEventListener('click', (e) => {
    const p = active();
    if (!isJourney(p)) return;
    // expanding a task works on archived journeys too (read-only browsing)
    const auto = e.target.closest('.stask-toggle.auto');
    if (auto) { toggleExpanded(p, auto.closest('.stasks').dataset.stage, auto.closest('.stask').dataset.task); return; }
    if (p.archived) return;
    const add = e.target.closest('.leg-add');
    if (add) { openTaskInput(p, add.closest('.leg').dataset.stage); return; }
    const sid = e.target.closest('.stasks')?.dataset.stage;
    const tid = e.target.closest('.stask')?.dataset.task;
    if (!sid || !tid) return;
    const uid = e.target.closest('[data-sub]')?.dataset.sub;
    const move = e.target.closest('[data-move]');
    if (move) moveTask(sid, tid, uid, Number(move.dataset.move));
    else if (e.target.closest('[data-edit]')) openTaskEdit(p, sid, tid, uid);
    else if (e.target.closest('[data-add-sub]')) openSubInput(p, sid, tid);
    else if (e.target.closest('[data-remove-sub]')) removeSubtask(sid, tid, uid);
    else if (e.target.closest('[data-remove-task]')) removeStageTask(sid, tid);
    else if (e.target.closest('.stask-toggle')) {
      if (uid) toggleSubtask(sid, tid, uid); else toggleStageTask(sid, tid);
    }
  });
  legs.addEventListener('submit', (e) => {
    if (!e.target.matches('.stask-add')) return;
    e.preventDefault();
    const edit = e.target.querySelector('.stask-edit-input');
    if (edit) { finishTaskEdit(edit, true); return; }
    const input = e.target.querySelector('.stask-input');
    if (input.dataset.for) addSubtask(input); else addStageTask(input);
  });
  legs.addEventListener('input', (e) => { if (e.target.matches('.stask-input, .stask-edit-input')) growTaskInput(e.target); });
  legs.addEventListener('focusout', (e) => {
    if (!e.target.matches('.stask-edit-input') || legsRendering) return;
    const input = e.target;
    afterPointer(() => finishTaskEdit(input, true)); // clicking away saves, like the tracker name
  });
  legs.addEventListener('keydown', (e) => {
    if (e.target.matches('.stask-edit-input')) {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finishTaskEdit(e.target, true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishTaskEdit(e.target, false); }
      return;
    }
    if (!e.target.matches('.stask-input')) return;
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); e.target.form.requestSubmit(); return; }
    if (e.key !== 'Escape') return;
    if (e.target.dataset.for) addingSubFor = null; else addingTaskFor = null;
    renderLegs(active());
  });
  $('#tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab && tab.dataset.id !== state.activeId) setActive(tab.dataset.id);
  });
  $('.scroll-cue').addEventListener('click', (e) => { e.preventDefault(); $('#trail').scrollIntoView({ behavior: 'smooth' }); });
  $('#renameBtn').addEventListener('click', startRename);
  $('#pname').addEventListener('dblclick', startRename);
  $('#deleteBtn').addEventListener('click', deleteProject);
  $('#archiveToggleBtn').addEventListener('click', () => setArchived(!active()?.archived));

  // routines: tasks, finish buttons, menus
  $('#tasks').addEventListener('click', (e) => {
    const b = e.target.closest('.task');
    if (b && !b.disabled) toggleTask(b.dataset.task);
  });
  $('#race').addEventListener('click', (e) => { if (e.target.closest('[data-action="start-clock"]')) startClock(); });
  $('#finish').addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'complete') completeTasks();
    if (action === 'archive') setArchived(true);
    if (action === 'restore') setArchived(false);
  });
  $('#routinesBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu('#routinesBtn', '#routinesMenu', renderRoutinesMenu); });
  $('#archiveBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu('#archiveBtn', '#archiveMenu', renderArchiveMenu); });
  $('#routinesMenu').addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit-template]');
    if (edit) { openSheet('routine', { item: state.templates.find((t) => t.id === edit.dataset.editTemplate) }); return; }
    if (e.target.closest('[data-new-routine]')) { openSheet('routine'); return; }
    const b = e.target.closest('[data-template]');
    if (b) startRoutine(b.dataset.template);
  });
  $('#archiveMenu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-project]');
    if (b) { closeMenus(); setActive(b.dataset.project); }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap')) closeMenus(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const menuOpen = !$('#routinesMenu').hidden || !$('#archiveMenu').hidden;
    closeMenus();
    // Escape in the plant view goes back to the tracker you came from (the dialog handles its own Escape)
    if (menuOpen || $('#sheet').open) return;
    if (groveOpen) leaveGrove();
    else if (!active()) leavePlantView();
  });

  // keyboard: ← → nudge (the selected stage on a journey), Shift for 5; ↑ ↓ pick a stage
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.matches?.('input, textarea, [contenteditable="true"]') || !canFill() || $('#sheet').open) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      nudge((e.shiftKey ? 5 : 1) * (e.key === 'ArrowRight' ? 1 : -1));
    } else if (isJourney(active()) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      moveStage(e.key === 'ArrowDown' ? 1 : -1);
    }
  });

  // keep relative times fresh
  setInterval(() => {
    if (active()) renderLog(active()); else if (groveOpen) renderGroveTrail();
  }, 60000);
  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (id === 'grove') { if (!groveOpen) openGrove(); return; }
    if (id && id !== state.activeId && state.projects.some((p) => p.id === id)) setActive(id);
  });
}

async function init() {
  buildForest();
  startSky();
  flask = new Flask();
  flask.onLand = () => sparks(flask.fillX(1) - 10, flask.padTop - 8, 8);
  wire();
  setPlantKind('journey');
  try {
    state.projects = await api.list();
  } catch (e) {
    toast(`Couldn't load trackers: ${e.message}`);
  }
  await refreshTemplates();
  const fromHash = location.hash.slice(1);
  if (fromHash === 'grove') { openGrove(); return; }
  const first = state.projects.find((p) => p.id === fromHash) || liveProjects()[0];
  setActive(first ? first.id : null);
}

init();
