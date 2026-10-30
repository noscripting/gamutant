// CSS Color 4 §14.2.3-4, EdgeSeeker gamut mapping, as the spec's pseudocode says: a lookup table of the cusp (the
// highest-chroma colour of each hue, sampled as HSL (h, 100%, 50%)) and the curvature of the boundary above it (through
// HSL (h, 100%, 75%)), N hue samples a 60deg region, folds removed, wrapped at 0 and 360; then the maximum chroma at
// l and h: a line from black to the cusp below it, an arc from the cusp to white above it. Out: chroma min(c, max), clipped.
// Read against the reference implementation the spec cites (color-js/apps, gamut-mapping/methods/edge-seeker, 2026-10-23):
// the same fold repair, wrap, curvature and arc; it also prunes entries its neighbors interpolate, which the spec leaves open.
// Imported by test/gate-check.mjs (--oracle seeker). Usage: node test/vendor/edge-seeker.mjs (prints the tables' sizes)
import { toLin, toLch, gam, ungam, clip01, inGamut } from '../ref/methods.mjs';
const hsl = (h, s, l) => { h = ((h % 360) + 360) % 360; const f = (n) => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0), f(8), f(4)]; };
const step = (a, b) => (((b - a) % 360) + 360) % 360, fwd = (a, b) => step(a, b) <= 180;
const lerp = (a, b, t) => ({ l: a.l + t * (b.l - a.l), c: a.c + t * (b.c - a.c) });
function unfold(s) {
  const kept = [s[0]]; let i = 1;
  while (i < s.length) {
    if (fwd(s[i - 1].h, s[i].h)) { kept.push(s[i]); i++; continue; }
    let j = i; while (j < s.length - 1 && !fwd(s[j].h, s[j + 1].h)) j++;
    const resume = s[j], first = kept.findIndex((e) => !fwd(e.h, resume.h));
    if (first < 1) throw new Error('fold before the first entry');
    const a = kept[first - 1], b = kept[first], hb = resume.h - 0.0001;
    const span = step(a.h, b.h), t = span ? Math.min(1, Math.max(0, step(a.h, hb) / span)) : 0;
    const bridge = { ...lerp(a, b, t), h: hb };
    kept.length = first;
    const last = kept[kept.length - 1];
    if (fwd(last.h, bridge.h) && step(last.h, bridge.h) !== 0) kept.push(bridge);
    kept.push(resume); i = j + 1;
  }
  return kept;
}
// the destination's own RGB to linear light: sRGB's curve for sRGB and Display P3; BT.2020's for rec2020, as the engines
// encode it (Color.js 0.7.1's --rec2020-oetf); a98-rgb's 563/256 power, sign kept (Color.js 0.7.1's a98rgb)
const A20 = 1.09929682680944, B20 = 0.018053968510807;
const DEC = { srgb: ungam, p3: ungam, a98: (v) => Math.sign(v) * Math.abs(v) ** (563 / 256),
  rec2020: (v) => (Math.abs(v) < B20 * 4.5 ? v / 4.5 : Math.sign(v) * ((Math.abs(v) + A20 - 1) / A20) ** (1 / 0.45)) };
const okOf = (sp, rgb) => { const [l, c, h] = toLch(sp, rgb.map(DEC[sp])); return { l, c, h }; };
function wrap(list) {
  list.sort((x, y) => x.h - y.h);
  const last = list[list.length - 1], first = { ...list[0], h: list[0].h + 360 };
  const end = lerp(last, first, (360 - last.h) / (first.h - last.h));
  return [{ ...end, h: 0 }, ...list, { ...end, h: 360 }];
}
const at = (list, h) => { let k = 0; while (k < list.length - 2 && list[k + 1].h < h) k++;
  const a = list[k], b = list[k + 1], t = b.h === a.h ? 0 : (h - a.h) / (b.h - a.h); return lerp(a, b, t); };
export function curvature(cusp, cp) {
  const x = (1 - cp.l) / (1 - cusp.l), y = cp.c / cusp.c; if (x === y) return 0;
  const m1 = -1 / (y / x), m2 = -1, mid1 = [x / 2, y / 2], mid2 = [0.5, 0.5];
  const cx = (m1 * mid1[0] - m2 * mid2[0] + mid2[1] - mid1[1]) / (m1 - m2), cy = m1 * (cx - mid1[0]) + mid1[1];
  const k = 1 / Math.hypot(cx, cy); return cx < cy ? -k : k;
}
export function lut(sp, N = 400) {
  let cusps = [], curve = [];
  for (let r = 0; r < 6; r++) {
    const rc = [], rv = [];
    for (let j = 0; j < N; j++) { const h = 60 * r + (60 * j) / (N - 1); rc.push(okOf(sp, hsl(h, 1, 0.5))); rv.push(okOf(sp, hsl(h, 1, 0.75))); }
    cusps.push(...unfold(rc).slice(0, -1)); curve.push(...unfold(rv).slice(0, -1));
  }
  cusps = wrap(cusps); curve = wrap(curve);
  return cusps.map((cu) => ({ ...cu, k: curvature(cu, at(curve, cu.h)) }));
}
export const arc = (x, k) => { const t = Math.sqrt(2 - k * k), b = t - k, d = x * (t + k * (1 - x)); return (2 * d) / (b + Math.sqrt(Math.max(0, b * b + 4 * k * d))); };
export function maxChroma(L, l, h) {
  if (l <= 0 || l >= 1) return 0;
  h = ((h % 360) + 360) % 360;
  let k = 0; while (k < L.length - 2 && L[k + 1].h < h) k++;
  const a = L[k], b = L[k + 1], t = b.h === a.h ? 0 : (h - a.h) / (b.h - a.h);
  const cl = a.l + t * (b.l - a.l), cc = a.c + t * (b.c - a.c), cv = a.k + t * (b.k - a.k);
  if (l <= cl) return (l / cl) * cc;
  return cc * arc((1 - l) / (1 - cl), cv);
}
const tables = {};
export const table = (sp, N = 400) => (tables[`${sp}${N}`] ??= lut(sp, N));
// the mapped colour in the target's linear RGB, clipped
export function edgeSeeker(sp, [l, c, h], L = table(sp)) {
  const lin = toLin(sp, [l, c, h]); if (inGamut(lin)) return lin;
  if (l >= 1) return [1, 1, 1]; if (l <= 0) return [0, 0, 0];
  return toLin(sp, [l, Math.min(c, maxChroma(L, l, h)), h]).map(clip01);
}
if (process.argv[1]?.endsWith('edge-seeker.mjs')) for (const sp of ['srgb', 'p3', 'rec2020', 'a98']) {
  const L = table(sp); console.log(`${sp}: ${L.length} entries, curvature ${Math.min(...L.map((e) => e.k)).toFixed(3)} to ${Math.max(...L.map((e) => e.k)).toFixed(3)}`);
}
