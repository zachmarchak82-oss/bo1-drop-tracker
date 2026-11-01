'use strict';
// Reads the Black Ops 1 round counter from a cropped screenshot.
// Input: pixel buffer (RGBA, or BGRA when bgra is true), width, height.
// The round shows as red tally marks (low rounds) on a light background, then as dark red numerals.
// This file only looks at pixels it is given. It never touches the game.

function otsu(hist, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t; }
  }
  return thr;
}

function chans(px, i, bgra) {
  return bgra ? [px[i + 2], px[i + 1], px[i]] : [px[i], px[i + 1], px[i + 2]];
}

// Dark red text: green is far below red. Works on dark and on bright textured backgrounds.
function inkDigits(px, w, h, bgra) {
  const n = w * h, q = new Uint8Array(n), hist = new Uint32Array(256);
  for (let p = 0; p < n; p++) {
    const [r, g] = chans(px, p * 4, bgra);
    const f = (r - g) / (r + g + 8);
    let v = Math.round((f + 0.2) / 1.2 * 255);
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    q[p] = v; hist[v]++;
  }
  const t = otsu(hist, n), ink = new Uint8Array(n);
  for (let p = 0; p < n; p++) ink[p] = q[p] > t ? 1 : 0;
  return ink;
}

// Tally marks: dark strokes on a light paper background.
function inkDark(px, w, h, bgra) {
  const n = w * h, l = new Uint8Array(n), hist = new Uint32Array(256);
  for (let p = 0; p < n; p++) {
    const [r, g, b] = chans(px, p * 4, bgra);
    const v = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    l[p] = v; hist[v]++;
  }
  const t = otsu(hist, n), ink = new Uint8Array(n);
  for (let p = 0; p < n; p++) ink[p] = l[p] <= t ? 1 : 0;
  return ink;
}

function medianLuma(px, w, h, bgra) {
  const hist = new Uint32Array(256);
  const n = w * h;
  for (let p = 0; p < n; p += 3) {
    const [r, g, b] = chans(px, p * 4, bgra);
    hist[Math.round(0.299 * r + 0.587 * g + 0.114 * b)]++;
  }
  let tot = 0;
  for (let i = 0; i < 256; i++) tot += hist[i];
  let acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= tot / 2) return i; }
  return 0;
}

function label(ink, w, h) {
  const lab = new Int32Array(w * h), comps = [];
  const stack = [];
  for (let s = 0; s < w * h; s++) {
    if (!ink[s] || lab[s]) continue;
    const id = comps.length + 1;
    const c = { id, x0: w, y0: h, x1: 0, y1: 0, area: 0 };
    lab[s] = id; stack.push(s);
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p - x) / w;
      c.area++;
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const np = ny * w + nx;
        if (ink[np] && !lab[np]) { lab[np] = id; stack.push(np); }
      }
    }
    comps.push(c);
  }
  return { lab, comps };
}

// Count tally marks: a crossed bundle is 5, a lone stroke is 1.
function readTally(px, w, h, bgra) {
  const ink = inkDark(px, w, h, bgra);
  // Drop full-height dark columns (crop edges, bars) so they cannot be mistaken for strokes.
  for (let x = 0; x < w; x++) {
    let run = 0, best = 0;
    for (let y = 0; y < h; y++) { if (ink[y * w + x]) { run++; if (run > best) best = run; } else run = 0; }
    if (best >= 0.95 * h) for (let y = 0; y < h; y++) ink[y * w + x] = 0;
  }
  const { comps } = label(ink, w, h);
  const real = comps.filter((c) => c.area > 0.002 * w * h);
  if (!real.length) return { value: 0, conf: 0 };
  const maxH = Math.max(...real.map((c) => c.y1 - c.y0 + 1));
  const marks = real.filter((c) => (c.y1 - c.y0 + 1) >= 0.45 * maxH);
  let total = 0, conf = 1;
  marks.forEach((c) => {
    const cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1, ratio = cw / ch;
    if (ratio < 0.3) total += 1;
    else if (ratio >= 0.6) total += 5;
    else { total += 1; conf = Math.min(conf, 0.5); }
  });
  if (total > 20) return { value: 0, conf: 0 };
  return { value: total, conf };
}

// Black text on white, ready for a digit OCR. Returns a BGRA bitmap.
function digitsBitmap(px, w, h, bgra) {
  let ink = inkDigits(px, w, h, bgra);
  const { lab, comps } = label(ink, w, h);
  const minArea = Math.max(8, 0.0015 * w * h);
  const keep = new Uint8Array(comps.length + 1);
  comps.forEach((c) => { if (c.area >= minArea) keep[c.id] = 1; });
  const scale = h >= 100 ? 1 : Math.ceil(100 / h), pad = 20;
  const W = w * scale + pad * 2, H = h * scale + pad * 2;
  const out = Buffer.alloc(W * H * 4, 255);
  for (let y = 0; y < h * scale; y++) for (let x = 0; x < w * scale; x++) {
    const sp = Math.floor(y / scale) * w + Math.floor(x / scale);
    if (ink[sp] && keep[lab[sp]]) {
      const o = ((y + pad) * W + x + pad) * 4;
      out[o] = out[o + 1] = out[o + 2] = 0;
    }
  }
  return { data: out, width: W, height: H };
}

// 'tally' when the crop is a light paper background, otherwise 'digits'.
function classify(px, w, h, bgra) {
  return medianLuma(px, w, h, bgra) > 140 ? 'tally' : 'digits';
}

module.exports = { classify, readTally, digitsBitmap };
