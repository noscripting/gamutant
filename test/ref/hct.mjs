// Material 3's tonal palette in JavaScript, the reference for .gamut-palette-step: material-color-utilities 0.4.0's
// TonalPalette.fromHueAndChroma(h, c).tone(t) and Hct.fromInt, ported as they run and changed to JavaScript (Copyright 2021 Google LLC, Apache-2.0, LICENSE-THIRD-PARTY):
// CAM16 under MCU's default viewing conditions (ViewingConditions.make()), HctSolver.solveToInt (Newton on J, else a
// bisection of sRGB's cross-section at the tone's Y in 8-bit planes), the tone 99 of a yellow hue averaged from 98
// and 100. The matrices are worked out from CAM16's and MCU's sRGB matrix, as build.mjs's materialPart() does (MCU's
// typed ones to 6e-15). It gives test/data/material-palettes.json's 983 colors byte for byte (node test/ref/hct.mjs).
//   hctOf([r, g, b] linear sRGB 0..1) -> { hue, chroma }   tone(hue, chroma, t) -> [r, g, b] 8-bit sRGB
//   bisectToLimit(y, hue radians) -> [r, g, b] linear 0..100: HctSolver.bisectToLimit, its point on the edge at Y
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const M16 = [[0.401288, 0.650173, -0.051461], [-0.250268, 1.204414, 0.045854], [-0.002079, 0.048952, 0.953127]];
const S2X = [[0.41233895, 0.35762064, 0.18051042], [0.2126, 0.7152, 0.0722], [0.01932141, 0.11916382, 0.95034478]];
const K = S2X[1], WP = [95.047, 100, 108.883];
const labInvf = (ft) => (ft ** 3 > 216 / 24389 ? ft ** 3 : (116 * ft - 16) / (24389 / 27));
export const yFromLstar = (l) => 100 * labInvf((l + 16) / 116);
const La = (200 / Math.PI) * yFromLstar(50) / 100, W = M16.map((r) => r[0] * WP[0] + r[1] * WP[1] + r[2] * WP[2]);
const d = Math.min(1, Math.max(0, 1 - Math.exp((-La - 42) / 92) / 3.6)), rgbD = W.map((w) => d * (100 / w) + 1 - d);
const k4 = (1 / (5 * La + 1)) ** 4, fl = k4 * La + 0.1 * (1 - k4) ** 2 * Math.cbrt(5 * La);
const n = yFromLstar(50) / 100, z = 1.48 + Math.sqrt(n), c = 0.69, nbb = 0.725 / n ** 0.2;
const rgbA = W.map((w, i) => { const f = (fl * rgbD[i] * w / 100) ** 0.42; return 400 * f / (f + 27.13); });
const aw = (2 * rgbA[0] + rgbA[1] + 0.05 * rgbA[2]) * nbb;
const mul = (A, v) => A.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const SD = M16.map((r, i) => [0, 1, 2].map((j) => r.reduce((s, x, k) => s + x * rgbD[i] * fl / 100 * S2X[k][j], 0)));
const inv3 = ([[a, b, cc], [dd, e, f], [g, h, i]]) => { const A = e * i - f * h, B = f * g - dd * i, C = dd * h - e * g, det = a * A + b * B + cc * C;
  return [[A, cc * h - b * i, b * f - cc * e], [B, a * i - cc * g, cc * dd - a * f], [C, b * g - a * h, a * e - b * dd]].map((r) => r.map((x) => x / det)); };
const LIN = inv3(SD);
const adapt = (x) => { const af = Math.abs(x) ** 0.42; return Math.sign(x) * 400 * af / (af + 27.13); };
const unadapt = (x) => Math.sign(x) * Math.max(0, 27.13 * Math.abs(x) / (400 - Math.abs(x))) ** (1 / 0.42);
const delin = (x) => { const v = x / 100; return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055); };
const lin = (x) => { const v = x / 255; return 100 * (v <= 0.040449936 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); };
const toInt = (linrgb) => linrgb.map((x) => Math.min(255, Math.max(0, Math.round(delin(x)))));

// Cam16.fromXyzInViewingConditions's hue and chroma, from linear sRGB 0..1 (any, past sRGB too)
export function hctOf(rgb) {
  const [rA, gA, bA] = mul(SD, rgb.map((x) => x * 100)).map(adapt);
  const a = (11 * rA - 12 * gA + bA) / 11, b = (rA + gA - 2 * bA) / 9, u = (20 * rA + 20 * gA + 21 * bA) / 20, p2 = (40 * rA + 20 * gA + bA) / 20;
  const deg = Math.atan2(b, a) * 180 / Math.PI, hue = deg < 0 ? deg + 360 : deg >= 360 ? deg - 360 : deg;
  const J = 100 * (p2 * nbb / aw) ** (c * z), hp = hue < 20.14 ? hue + 360 : hue;
  const t = (50000 / 13) * 0.25 * (Math.cos(hp * Math.PI / 180 + 2) + 3.8) * nbb * Math.hypot(a, b) / (u + 0.305);
  return { hue, chroma: t ** 0.9 * (1.64 - 0.29 ** n) ** 0.73 * Math.sqrt(J / 100) };
}
const hueOf = (linrgb) => { const [rA, gA, bA] = mul(SD, linrgb).map(adapt); return Math.atan2((rA + gA - 2 * bA) / 9, (11 * rA - 12 * gA + bA) / 11); };
const sanitize = (x) => (x + Math.PI * 8) % (Math.PI * 2);
const cyclic = (a, b, cc) => sanitize(b - a) < sanitize(cc - a);
function nthVertex(y, i) {
  const A = i % 4 <= 1 ? 0 : 100, B = i % 2 === 0 ? 0 : 100, ok = (x) => x >= 0 && x <= 100;
  if (i < 4) { const r = (y - A * K[1] - B * K[2]) / K[0]; return ok(r) ? [r, A, B] : null; }
  if (i < 8) { const g = (y - B * K[0] - A * K[2]) / K[1]; return ok(g) ? [B, g, A] : null; }
  const b = (y - A * K[0] - B * K[1]) / K[2]; return ok(b) ? [A, B, b] : null;
}
const PLANES = Array.from({ length: 255 }, (_, i) => lin(i + 0.5));
export function bisectToLimit(y, target) {
  let left = null, right = null, lh = 0, rh = 0, uncut = true;
  for (let i = 0; i < 12; i++) { const mid = nthVertex(y, i); if (!mid) continue; const mh = hueOf(mid);
    if (!left) { left = right = mid; lh = rh = mh; continue; }
    if (uncut || cyclic(lh, mh, rh)) { uncut = false; if (cyclic(lh, target, mh)) { right = mid; rh = mh; } else { left = mid; lh = mh; } } }
  lh = hueOf(left);
  for (let axis = 0; axis < 3; axis++) {
    if (left[axis] === right[axis]) continue;
    let lp, rp;
    if (left[axis] < right[axis]) { lp = Math.floor(delin(left[axis]) - 0.5); rp = Math.ceil(delin(right[axis]) - 0.5); }
    else { lp = Math.ceil(delin(left[axis]) - 0.5); rp = Math.floor(delin(right[axis]) - 0.5); }
    for (let i = 0; i < 8 && Math.abs(rp - lp) > 1; i++) {
      const mp = Math.floor((lp + rp) / 2), tt = (PLANES[mp] - left[axis]) / (right[axis] - left[axis]), mid = left.map((v, k) => v + (right[k] - v) * tt), mh = hueOf(mid);
      if (cyclic(lh, target, mh)) { right = mid; rp = mp; } else { left = mid; lh = mh; lp = mp; }
    }
  }
  return left.map((v, k) => (v + right[k]) / 2);
}
function findByJ(h, chroma, y) {
  let j = Math.sqrt(y) * 11; const tInner = 1 / (1.64 - 0.29 ** n) ** 0.73, p1 = 0.25 * (Math.cos(h + 2) + 3.8) * (50000 / 13) * nbb, hs = Math.sin(h), hc = Math.cos(h);
  for (let round = 0; round < 5; round++) {
    const jn = j / 100, alpha = chroma === 0 || j === 0 ? 0 : chroma / Math.sqrt(jn), t = (alpha * tInner) ** (1 / 0.9), p2 = aw * jn ** (1 / c / z) / nbb;
    const gamma = 23 * (p2 + 0.305) * t / (23 * p1 + 11 * t * hc + 108 * t * hs), a = gamma * hc, b = gamma * hs;
    const linrgb = mul(LIN, [460 * p2 + 451 * a + 288 * b, 460 * p2 - 891 * a - 261 * b, 460 * p2 - 220 * a - 6300 * b].map((x) => unadapt(x / 1403)));
    if (linrgb.some((x) => x < 0)) return null;
    const fnj = K[0] * linrgb[0] + K[1] * linrgb[1] + K[2] * linrgb[2]; if (fnj <= 0) return null;
    if (round === 4 || Math.abs(fnj - y) < 0.002) return linrgb.some((x) => x > 100.01) ? null : toInt(linrgb);
    j -= (fnj - y) * j / (2 * fnj);
  }
  return null;
}
function solve(hue, chroma, lstar) {
  const y = yFromLstar(lstar);
  if (chroma < 0.0001 || lstar < 0.0001 || lstar > 99.9999) return toInt([y, y, y]);
  const h = (((hue % 360) + 360) % 360) * Math.PI / 180;
  return findByJ(h, chroma, y) ?? toInt(bisectToLimit(y, h));
}
export function tone(hue, chroma, t) {
  if (t === 99 && hue >= 105 && hue < 125) { const a = solve(hue, chroma, 98), b = solve(hue, chroma, 100); return a.map((v, k) => Math.round((v + b[k]) / 2)); }
  return solve(hue, chroma, t);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { lists, singles } = JSON.parse(readFileSync(new URL('../data/material-palettes.json', import.meta.url), 'utf8'));
  const cases = [...lists.flatMap((l) => l.tones.map((t, i) => ({ ...l, tone: t, want: l.want[i] }))), ...singles];
  const bad = cases.filter((x) => { const s = [1, 3, 5].map((i) => parseInt(x.seed.slice(i, i + 2), 16) / 255).map((v) => lin(v * 255) / 100), h = hctOf(s);
    return tone(h.hue, h.chroma * x.rel, x.tone).join() !== x.want.join(); });
  console.log(`${bad.length ? 'FAIL' : 'PASS'} ${cases.length - bad.length} of ${cases.length} of material-color-utilities' colors byte for byte`);
  process.exit(bad.length ? 1 : 0);
}
