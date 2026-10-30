// CSS Color 4 and 5 as code, on doubles: parsing (with the parse-time clamps), conversions (Color.js, the color science;
// only hsl(), hwb() and the polar forms are written here, from CSS Color 4 §7, §8 and §9), powerless and missing components (§4.4), interpolation (§13: analogous components and sets carried
// forward, hue fixups, premultiplied alpha), color-mix() (CSS Color 5 §3, CSS Values 5 §6.1's percentages), relative
// colors (CSS Color 5 §4) and the computed value's form (CSS Color 4 §15 and §16, CSS Color 5 §11). Read against the
// drafts in ../css-color-4.txt (20 October 2026) and ../css-color-5.txt (8 October 2026).
// resolve(css, opts) gives { space, c: [3 numbers or null for missing], alpha (number or null), form } or null when the
// spec makes the value invalid. opts.reading picks between two texts that disagree (README, "Where the text leaves
// it open"); opts.rules turns on an engine's own rules, to explain its answers (oracle.mjs).
import { readFileSync } from 'node:fs';

import Color from 'colorjs.io';

// The color science is Color.js's (each space's transfer function and matrices, XYZ, Lab, Oklab): only what CSS Color
// itself defines is written here. A space's coordinates to and from XYZ D65, through Color.js
const CJ = { srgb: 'srgb', 'srgb-linear': 'srgb-linear', 'display-p3': 'p3', 'display-p3-linear': 'p3-linear', 'a98-rgb': 'a98rgb', 'prophoto-rgb': 'prophoto', rec2020: 'rec2020', 'xyz-d65': 'xyz-d65', 'xyz-d50': 'xyz-d50', lab: 'lab', oklab: 'oklab' };
const cjTo = (space, c) => Color.spaces[CJ[space]].to('xyz-d65', c), cjFrom = (space, x) => Color.spaces['xyz-d65'].to(CJ[space], x).map((v) => v ?? NaN);
// CSS Color 4 §9.3, §10.3: polar coordinates, the hue powerless within the chroma's ε (§4.4.1's table)
const toPolar = (L, a, b, eps) => { let h = (Math.atan2(b, a) * 180) / Math.PI; const C = Math.sqrt(a ** 2 + b ** 2); if (h < 0) h += 360; if (C <= eps) h = NaN; return [L, C, h]; };
const fromPolar = ([L, C, H]) => [L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)];
// an engine's rec2020 with BT.2020's two-part curve (Q28), on Color.js's linear rec2020; the curve's two constants as
// Color.js's own rec2020-oetf space has them (src/spaces/rec2020-oetf.js; ITU-R BT.2020 prints them to 4 places)
const B_A = 1.09929682680944, B_B = 0.018053968510807;
const lin_bt2020 = (RGB) => RGB.map((val) => { const sign = val < 0 ? -1 : 1, abs = Math.abs(val); return abs < B_B * 4.5 ? val / 4.5 : sign * Math.pow((abs + B_A - 1) / B_A, 1 / 0.45); });
const gam_bt2020 = (RGB) => RGB.map((val) => { const sign = val < 0 ? -1 : 1, abs = Math.abs(val); return abs < B_B ? val * 4.5 : sign * (B_A * Math.pow(abs, 0.45) - (B_A - 1)); });
const bt2020To = (c) => Color.spaces['rec2020-linear'].to('xyz-d65', lin_bt2020(c)), bt2020From = (x) => gam_bt2020(Color.spaces['xyz-d65'].to('rec2020-linear', x));
// §7 and §8 (rgbToHsl with the turn for a negative saturation, ε 1e-5 of 1; rgbToHwb with W + B >= 1 - 1e-5)
const hue6 = (r, g, b, d, max) => { let h; switch (max) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; default: h = (r - g) / d + 4; } return h * 60; };
const rgbToHsl = (r, g, b, rules = {}) => { const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min; let [h, s, l] = [NaN, 0, (min + max) / 2];
  if (d !== 0) { s = l === 0 || l === 1 ? 0 : (max - l) / Math.min(l, 1 - l); h = hue6(r, g, b, d, max); }
  if (s < 0 && !rules.noHslTurn) { h += 180; s = Math.abs(s); } if (h >= 360) h -= 360; if (Math.abs(s) <= 1e-5 && !rules.noHueEpsilon) h = NaN; if (s === 0) h = NaN;
  return [h, s * 100, l * 100]; };
const hslToRgb = (h, s, l) => { s /= 100; l /= 100; const f = (n) => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0), f(8), f(4)]; };
const rgbToHwb = (r, g, b, rules = {}) => { const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min; let h = NaN;
  if (d !== 0) { h = hue6(r, g, b, d, max); if (h >= 360) h -= 360; } const w = min, bl = 1 - max; if (w + bl >= 1 - (rules.noHueEpsilon ? 0 : 1e-5)) h = NaN; return [h, w * 100, bl * 100]; };
const hwbToRgb = (h, w, bl) => { w /= 100; bl /= 100; if (w + bl >= 1) { const g = w / (w + bl); return [g, g, g]; } return hslToRgb(h, 100, 50).map((c) => c * (1 - w - bl) + w); };

// the spaces: to and from XYZ D65, the categories of their components (§13.3's analogous components), the hue's index
// and the powerless ε (§4.4.1's table)
// §13.3's categories: reds, greens, blues (r and x, g and y, b and z), lightness, colorfulness (C and S), hue, opponent a and b
const RGBLIKE = ['reds', 'greens', 'blues'], XYZLIKE = RGBLIKE;
const rgb = (space) => ({ cats: RGBLIKE, to: (c) => cjTo(space, c), from: (x) => cjFrom(space, x) });
const SPACES = {
  srgb: rgb('srgb'), 'srgb-linear': rgb('srgb-linear'), 'display-p3': rgb('display-p3'), 'display-p3-linear': rgb('display-p3-linear'),
  'a98-rgb': rgb('a98-rgb'), 'prophoto-rgb': rgb('prophoto-rgb'), rec2020: rgb('rec2020'),
  'xyz-d65': { cats: XYZLIKE, to: (c) => c, from: (x) => x },
  'xyz-d50': { cats: XYZLIKE, to: (c) => cjTo('xyz-d50', c), from: (x) => cjFrom('xyz-d50', x) },
  lab: { cats: ['lightness', 'opponent-a', 'opponent-b'], to: (c) => cjTo('lab', c), from: (x) => cjFrom('lab', x) },
  lch: { cats: ['lightness', 'colorfulness', 'hue'], hue: 2, eps: 0.0015, to: (c) => cjTo('lab', fromPolar(c)), from: (x) => toPolar(...cjFrom('lab', x), 0.0015) },
  oklab: { cats: ['lightness', 'opponent-a', 'opponent-b'], to: (c) => cjTo('oklab', c), from: (x) => cjFrom('oklab', x) },
  oklch: { cats: ['lightness', 'colorfulness', 'hue'], hue: 2, eps: 0.000004, to: (c) => cjTo('oklab', fromPolar(c)), from: (x) => toPolar(...cjFrom('oklab', x), 0.000004) },
  hsl: { cats: ['hue', 'colorfulness', 'lightness'], hue: 0, eps: 0.001, to: (c) => SPACES.srgb.to(hslToRgb(...c)), from: (x, rules) => rgbToHsl(...SPACES.srgb.from(x), rules) },
  hwb: { cats: ['hue', null, null], hue: 0, to: (c) => SPACES.srgb.to(hwbToRgb(...c)), from: (x, rules) => rgbToHwb(...SPACES.srgb.from(x), rules) },
};
const ALIAS = { xyz: 'xyz-d65' };
const POLAR = new Set(['lch', 'oklch', 'hsl', 'hwb']);

// a color: { space, c: [v0, v1, v2] (null = missing), alpha (null = missing), legacy (hex, named, rgb(), hsl(), hwb():
// §13.2's legacy sRGB formats), fn (the function it was written in, for its computed form) }
const z = (v) => (v === null ? 0 : v);
// §4.4.1: a conversion's powerless components become missing, and a chroma (saturation) within ε becomes 0
function convert(col, to, rules = {}) {
  if (col.space === to) return { ...col, c: [...col.c] };
  const src = [...col.c], from = SPACES[col.space];
  if (rules.noneHueGrey && from.hue !== undefined && src[from.hue] === null && col.space !== 'hwb') src[1] = 0;
  const bt = rules.rec2020Bt2020, x = bt && col.space === 'rec2020' ? bt2020To(src.map(z)) : from.to(src.map(z));
  const out = bt && to === 'rec2020' ? bt2020From(x) : SPACES[to].from(x, rules), sp = SPACES[to];
  const c = out.map((v) => (Number.isNaN(v) ? null : v));
  // an engine that keeps a powerless hue: the source's own hue where it has one, else the conversion's; or a given one
  if (sp.hue !== undefined && c[sp.hue] === null && rules.forceHue !== undefined) c[sp.hue] = rules.forceHue;
  if (sp.hue !== undefined && c[sp.hue] === null && (rules.keepPowerless || (rules.noHueEpsilon && (to === 'lch' || to === 'oklch') && c[1] > 0)))
    c[sp.hue] = from.hue !== undefined && col.c[from.hue] !== null && rules.keepPowerless ? col.c[from.hue] : rawHue(to, x);
  if (sp.hue !== undefined && c[sp.hue] === null && rules.greyHue180 && (col.space === 'hsl' || col.space === 'hwb') && (to === 'hsl' || to === 'hwb')) c[sp.hue] = 180;
  if (sp.hue !== undefined && c[sp.hue] === null) {
    if (to === 'hwb') { const [, w, b] = c; if (w + b < 100) c[2] = 100 - w; }
    else if (!rules.keepNoise && c[1] > 0 && c[1] <= sp.eps) c[1] = 0;
  }
  if (rules.chromeGrey && (to === 'oklch' || to === 'lch') && c[1] <= 0.02) c[2] = null;
  return { space: to, c, alpha: col.alpha, legacy: false };
}

// the hue a powerless one would have had (for an engine that keeps it)
function rawHue(to, x) {
  if (to === 'lch' || to === 'oklch') { const [, a, b] = cjFrom(to === 'lch' ? 'lab' : 'oklab', x); return norm((Math.atan2(b, a) * 180) / Math.PI); }
  const [r, g, b] = SPACES.srgb.from(x), max = Math.max(r, g, b), d = max - Math.min(r, g, b); return d === 0 ? 0 : norm(hue6(r, g, b, d, max));
}
// §13.3: which components of `to` a missing component of `from` carries into, and the analogous set
function carried(col, to) {
  if (col.space === to) return col.c.map((v) => v === null);
  const fc = SPACES[col.space].cats, tc = SPACES[to].cats, out = [false, false, false];
  const single = new Set(fc.filter((k, i) => k && tc.includes(k)));
  fc.forEach((k, i) => { if (col.c[i] === null && k && tc.includes(k)) out[tc.indexOf(k)] = true; });
  const restFrom = fc.map((k, i) => i).filter((i) => !(fc[i] && single.has(fc[i])));
  const restTo = tc.map((k, i) => i).filter((i) => !(tc[i] && single.has(tc[i])));
  if (restFrom.length && restTo.length && restFrom.every((i) => col.c[i] === null)) restTo.forEach((i) => (out[i] = true));
  return out;
}
export function toSpace(col, to, rules = {}) {
  // Q46: WebKit makes a negative prophoto-rgb or rec2020 component 0 when it converts out of the space
  if (rules.negNaN && col.space !== to && (col.space === 'prophoto-rgb' || col.space === 'rec2020')) col = { ...col, c: col.c.map((v) => (v !== null && v < 0 ? 0 : v)) };
  const keep = rules.noCarry ? [false, false, false] : rules.noAnalogousSet ? carriedSingle(col, to) : carried(col, to);
  if (rules.noHueCarryHwb && to === 'hwb' && col.space !== 'hwb') keep[0] = false;
  if (rules.noCarryRGB && !['lch', 'oklch', 'hsl', 'hwb', 'lab', 'oklab'].includes(col.space)) keep.fill(false);
  const out = convert(col, to, rules);
  keep.forEach((k, i) => { if (k) out.c[i] = null; });
  return out;
}
function carriedSingle(col, to) { if (col.space === to) return col.c.map((v) => v === null);
  const fc = SPACES[col.space].cats, tc = SPACES[to].cats, out = [false, false, false];
  fc.forEach((k, i) => { if (col.c[i] === null && k && tc.includes(k)) out[tc.indexOf(k)] = true; }); return out; }

// §13.4, §13.5: two colors already in the space, progress p of the second
const norm = (h) => ((h % 360) + 360) % 360;
export function interpolate(A, B, p, space, method = 'shorter', rules = {}) {
  const hi = SPACES[space].hue;
  let a = [...A.c], b = [...B.c];
  let aa = A.alpha, ab = B.alpha;
  if (aa === null) aa = ab; if (ab === null) ab = aa;
  // Q71: WebKit skips a longer-hue turn when a hue was missing
  const hueWasMissing = hi !== undefined && (a[hi] === null || b[hi] === null);
  a = a.map((v, i) => (v === null ? b[i] : v)); b = b.map((v, i) => (v === null ? a[i] : v));
  if (hi !== undefined && a[hi] !== null && b[hi] !== null && !(rules.longerMissingNoTurn && method === 'longer' && hueWasMissing)) {
    let h1 = norm(a[hi]), h2 = norm(b[hi]); const d = h2 - h1;
    if (method === 'shorter') { if (d > 180) h1 += 360; else if (d < -180) h2 += 360; }
    else if (method === 'longer') { if (d > 0 && d < 180) h1 += 360; else if (d > -180 && d <= 0) h2 += 360; }
    else if (method === 'increasing') { if (h2 < h1) h2 += 360; }
    else if (method === 'decreasing') { if (h1 < h2) h1 += 360; }
    a[hi] = h1; b[hi] = h2;
  }
  const pre = (c, al) => (al === null ? c : c.map((v, i) => (v === null ? null : i === hi ? v : v * al)));
  const pa = pre(a, aa), pb = pre(b, ab);
  let alpha = aa === null ? null : aa * (1 - p) + ab * p;
  // Q6's negative share pushes the alpha past 1: Firefox clamps it before un-premultiplying
  // (and Q64: every engine does so when an animation's easing overshoots)
  if ((rules.noSumCap || rules.alphaFirst) && alpha !== null) alpha = Math.min(1, Math.max(0, alpha));
  const c = pa.map((v, i) => (v === null ? null : v * (1 - p) + pb[i] * p))
    .map((v, i) => (v === null || alpha === null || alpha === 0 || i === hi ? v : v / alpha));
  if (hi !== undefined && c[hi] !== null) c[hi] = norm(c[hi]);
  if (rules.alphaZeroKeep && alpha === 0) return { space, c: a.map((v, i) => (v === null ? null : v * (1 - p) + b[i] * p)), alpha, legacy: false };
  return { space, c, alpha, legacy: false };
}

// CSS Values 5 §6.1, with forced normalization
function normalize(ps, rules = {}) {
  const sum = ps.filter((p) => p !== null).reduce((s, p) => s + p, 0), S = rules.noSumCap ? sum : Math.min(100, sum), O = ps.length - ps.filter((p) => p !== null).length;
  let out = ps.map((p) => (p === null ? (100 - S) / O : p)); const T = out.reduce((s, p) => s + p, 0);
  if (T > 0) out = out.map((p) => (p * 100) / T);
  return { items: out, leftover: T < 100 ? 100 - T : 0 };
}

// CSS Color 5 §3.3
function mix(m, rules) {
  const space = m.space, { items, leftover } = normalize(m.items.map((it) => it.p), rules);
  const cols = m.items.map((it) => toSpace(resolveColor(it.color, rules), space, rules));
  // WebKit's prophoto-rgb and rec2020 curves give NaN below 0, which a mix reads as missing (Q62)
  if (rules.negNaN && (space === 'prophoto-rgb' || space === 'rec2020')) cols.forEach((c) => { c.c = c.c.map((v) => (v !== null && v < 0 ? null : v)); });
  if (rules.mixInputClampL && ['lab', 'lch', 'oklab', 'oklch'].includes(space)) cols.forEach((c) => { if (c.c[0] !== null) c.c[0] = Math.min(space.startsWith('ok') ? 1 : 100, Math.max(0, c.c[0])); });
  let color;
  if (cols.length === 1) color = cols[0];
  else { let cur = cols[0], P = items[0];
    for (let k = 1; k < cols.length; k++) { const sum = P + items[k]; cur = interpolate(cur, cols[k], sum > 0 ? items[k] / sum : rules.zeroPairFirst ? 0 : 0.5, space, m.hue, rules); P = sum; }
    color = cur; }
  color = { ...color, c: [...color.c], alpha: color.alpha === null ? null : color.alpha * (1 - leftover / 100) };
  // CSS Color 5 §10.1: the mixed color resolves by CSS Color 4 §15, whose Lab-family values clamp L and C (§15.2, §15.3)
  if (!rules.mixNoClamp) clampLC(space, color.c);
  if (rules.zeroAlphaBlack && color.alpha === 0) return { ...toSpace({ space: 'srgb', c: [0, 0, 0], alpha: 0 }, space), alpha: 0 };
  return color;
}

// CSS Color 5 §4: the origin converted to the processing space, its missing components carried forward; each argument
// a keyword (a number, or missing), a number, a percentage, none, or calc() over them (missing reads as 0)
// what 1% is in each argument (CSS Color 4's reference ranges)
const PCT = { rgb: [2.55, 2.55, 2.55], hsl: [1, 1, 1], hwb: [1, 1, 1], lab: [1, 1.25, 1.25], lch: [1, 1.5, 1], oklab: [0.01, 0.004, 0.004], oklch: [0.01, 0.004, 1], color: [0.01, 0.01, 0.01] };
const KEYS = { rgb: ['r', 'g', 'b'], hsl: ['h', 's', 'l'], hwb: ['h', 'w', 'b'], lab: ['l', 'a', 'b'], lch: ['l', 'c', 'h'], oklab: ['l', 'a', 'b'], oklch: ['l', 'c', 'h'], color: ['r', 'g', 'b'], xyz: ['x', 'y', 'z'] };
function relative(r, rules) {
  const fn = r.fn, space = fn === 'rgb' ? 'srgb' : fn === 'color' ? r.space : fn;
  const origin = resolveColor(r.origin, rules), o = toSpace(origin, space, { ...rules, keepPowerless: rules.rcsKeepPowerless, noCarry: rules.rcsNoCarry || rules.noCarry });
  if (rules.rcsAlphaNone0 && o.alpha === null) o.alpha = 0;
  // Q65: WebKit and Firefox clamp the origin's lightness when converting it, as for a mix
  if (rules.mixInputClampL && ['lab', 'lch', 'oklab', 'oklch'].includes(space) && o.c[0] !== null) o.c[0] = Math.min(space.startsWith('ok') ? 1 : 100, Math.max(0, o.c[0]));
  const scale = fn === 'rgb' ? 255 : 1;
  const keys = fn === 'color' ? (space.startsWith('xyz') ? KEYS.xyz : KEYS.color) : KEYS[fn];
  const env = { alpha: o.alpha };
  keys.forEach((k, i) => (env[k] = o.c[i] === null ? null : o.c[i] * scale));
  if (rules.rcsNoneZero) for (const k of Object.keys(env)) if (env[k] === null) env[k] = 0;
  const pct = PCT[fn] ?? PCT.color;
  const c = r.args.map((a, i) => { const v = evalArg(a, env, pct[i]); return v === null ? null : v / scale; });
  if (fn === 'hsl' || fn === 'hwb') c.forEach((v, i) => { if (v !== null && i === 0) c[i] = norm(Number.isFinite(v) ? v : 0); });
  if (fn === 'lch' || fn === 'oklch') if (c[2] !== null) c[2] = norm(Number.isFinite(c[2]) ? c[2] : 0);
  if (rules.reading === 'clamp' || rules.rcsClamp) clampLC(fn, c);
  // and a relative color shows it as 0 (Q46)
  if (rules.negNaN && (space === 'prophoto-rgb' || space === 'rec2020')) c.forEach((v, i) => { if (v !== null && v < 0) c[i] = 0; });
  let alpha = r.alpha === undefined ? o.alpha : evalArg(r.alpha, env, 0.01);
  if (alpha !== null) alpha = Math.min(1, Math.max(0, Number.isNaN(alpha) ? 0 : alpha));
  return { space, c, alpha, legacy: false, fn: fn === 'rgb' || fn === 'hsl' || fn === 'hwb' ? fn : undefined };
}
function clampLC(fn, c) { if (fn === 'lab' || fn === 'lch') { if (c[0] !== null) c[0] = Math.min(100, Math.max(0, c[0])); }
  if (fn === 'oklab' || fn === 'oklch') { if (c[0] !== null) c[0] = Math.min(1, Math.max(0, c[0])); }
  if ((fn === 'lch' || fn === 'oklch') && c[1] !== null) c[1] = Math.max(0, c[1]); }
function evalArg(a, env, pctUnit) {
  if (a.kw !== undefined) return env[a.kw];
  if (a.none) return null;
  return evalCalc(a, env, pctUnit);
}
function evalCalc(n, env, pctUnit) {
  if (n.num !== undefined) return n.num;
  if (n.pct !== undefined) return n.pct * pctUnit;
  if (n.kw !== undefined) return env[n.kw] ?? 0;
  if (n.op) { const [x, y] = n.args.map((a) => evalCalc(a, env, pctUnit)); return n.op === '+' ? x + y : n.op === '-' ? x - y : n.op === '*' ? x * y : x / y; }
  if (n.calc) { const v = evalCalc(n.calc, env, pctUnit); return Number.isNaN(v) ? 0 : v; }
  if (n.trig) { const x = evalCalc(n.arg, env, pctUnit); return Math[n.trig](calcType(n.arg) === 'a' ? (x * Math.PI) / 180 : x); }
  throw new Error('bad calc node');
}

// the parser: a small tokenizer for CSS's functional notation
function tokenize(s) {
  const out = []; let i = 0;
  const num = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i;
  // a + or - starts a number unless it follows a value (CSS Syntax: "1 -2" is two numbers, "1 - 2" a subtraction)
  const afterValue = () => { const p = out[out.length - 1]; return p && (p.t === 'num' || p.t === 'pct' || p.t === 'dim' || p.t === 'ident' || p.t === ')'); };
  while (i < s.length) {
    const ch = s[i], rest = s.slice(i);
    if (/\s/.test(ch)) { i++; if (out.length && out[out.length - 1].t !== 'ws') out.push({ t: 'ws' }); continue; }
    if (ch === '(' || ch === ')' || ch === ',' || ch === '/') { out.push({ t: ch }); i++; continue; }
    if (ch === '#') { const m = rest.slice(1).match(/^[0-9a-fA-F]+/); out.push({ t: 'hash', v: m ? m[0] : '' }); i += 1 + (m ? m[0].length : 0); continue; }
    if (ch === '*') { out.push({ t: 'op', v: '*' }); i++; continue; }
    const m = rest.match(num);
    if (m && !((ch === '+' || ch === '-') && afterValue())) {
      let j = i + m[0].length; const v = parseFloat(m[0]);
      if (s[j] === '%') { out.push({ t: 'pct', v }); j++; }
      else { const u = s.slice(j).match(/^[a-z]+/i); if (u) { out.push({ t: 'dim', v, u: u[0].toLowerCase() }); j += u[0].length; } else out.push({ t: 'num', v }); }
      i = j; continue; }
    if (ch === '-' && /^-[a-z]/i.test(rest) && !afterValue()) { const id = rest.match(/^-[a-z][a-z0-9-]*/i)[0]; out.push({ t: 'ident', v: id.toLowerCase() }); i += id.length; continue; }
    if (ch === '+' || ch === '-') { out.push({ t: 'op', v: ch }); i++; continue; }
    const id = rest.match(/^[a-z][a-z0-9-]*/i);
    if (id) { const name = id[0].toLowerCase(); i += id[0].length; if (s[i] === '(') { out.push({ t: 'fn', v: name }); i++; } else out.push({ t: 'ident', v: name }); continue; }
    throw new Error(`can't read ${rest.slice(0, 10)}`);
  }
  return out;
}
// split a function's tokens (to its closing paren) into a tree of groups
function readArgs(toks, i) { const items = []; let depth = 0, cur = []; for (; i < toks.length; i++) { const t = toks[i];
  if (t.t === 'fn' || t.t === '(') depth++;
  if (t.t === ')') { if (depth === 0) { items.push(cur); return { items, end: i }; } depth--; }
  cur.push(t); }
  throw new Error('unclosed'); }
const strip = (ts) => { while (ts.length && ts[0].t === 'ws') ts.shift(); while (ts.length && ts[ts.length - 1].t === 'ws') ts.pop(); return ts; };
// split top-level tokens on a separator type
function splitTop(ts, sep) { const out = [[]]; let d = 0; for (const t of ts) { if (t.t === 'fn' || t.t === '(') d++; if (t.t === ')') d--; if (d === 0 && t.t === sep) out.push([]); else out[out.length - 1].push(t); } return out.map(strip); }

// CSS Color 4's named colors (its §6.1 table)
const NAMED = {"aliceblue":"f0f8ff","antiquewhite":"faebd7","aqua":"00ffff","aquamarine":"7fffd4","azure":"f0ffff","beige":"f5f5dc","bisque":"ffe4c4","black":"000000","blanchedalmond":"ffebcd","blue":"0000ff","blueviolet":"8a2be2","brown":"a52a2a","burlywood":"deb887","cadetblue":"5f9ea0","chartreuse":"7fff00","chocolate":"d2691e","coral":"ff7f50","cornflowerblue":"6495ed","cornsilk":"fff8dc","crimson":"dc143c","cyan":"00ffff","darkblue":"00008b","darkcyan":"008b8b","darkgoldenrod":"b8860b","darkgray":"a9a9a9","darkgreen":"006400","darkgrey":"a9a9a9","darkkhaki":"bdb76b","darkmagenta":"8b008b","darkolivegreen":"556b2f","darkorange":"ff8c00","darkorchid":"9932cc","darkred":"8b0000","darksalmon":"e9967a","darkseagreen":"8fbc8f","darkslateblue":"483d8b","darkslategray":"2f4f4f","darkslategrey":"2f4f4f","darkturquoise":"00ced1","darkviolet":"9400d3","deeppink":"ff1493","deepskyblue":"00bfff","dimgray":"696969","dimgrey":"696969","dodgerblue":"1e90ff","firebrick":"b22222","floralwhite":"fffaf0","forestgreen":"228b22","fuchsia":"ff00ff","gainsboro":"dcdcdc","ghostwhite":"f8f8ff","gold":"ffd700","goldenrod":"daa520","gray":"808080","green":"008000","greenyellow":"adff2f","grey":"808080","honeydew":"f0fff0","hotpink":"ff69b4","indianred":"cd5c5c","indigo":"4b0082","ivory":"fffff0","khaki":"f0e68c","lavender":"e6e6fa","lavenderblush":"fff0f5","lawngreen":"7cfc00","lemonchiffon":"fffacd","lightblue":"add8e6","lightcoral":"f08080","lightcyan":"e0ffff","lightgoldenrodyellow":"fafad2","lightgray":"d3d3d3","lightgreen":"90ee90","lightgrey":"d3d3d3","lightpink":"ffb6c1","lightsalmon":"ffa07a","lightseagreen":"20b2aa","lightskyblue":"87cefa","lightslategray":"778899","lightslategrey":"778899","lightsteelblue":"b0c4de","lightyellow":"ffffe0","lime":"00ff00","limegreen":"32cd32","linen":"faf0e6","magenta":"ff00ff","maroon":"800000","mediumaquamarine":"66cdaa","mediumblue":"0000cd","mediumorchid":"ba55d3","mediumpurple":"9370db","mediumseagreen":"3cb371","mediumslateblue":"7b68ee","mediumspringgreen":"00fa9a","mediumturquoise":"48d1cc","mediumvioletred":"c71585","midnightblue":"191970","mintcream":"f5fffa","mistyrose":"ffe4e1","moccasin":"ffe4b5","navajowhite":"ffdead","navy":"000080","oldlace":"fdf5e6","olive":"808000","olivedrab":"6b8e23","orange":"ffa500","orangered":"ff4500","orchid":"da70d6","palegoldenrod":"eee8aa","palegreen":"98fb98","paleturquoise":"afeeee","palevioletred":"db7093","papayawhip":"ffefd5","peachpuff":"ffdab9","peru":"cd853f","pink":"ffc0cb","plum":"dda0dd","powderblue":"b0e0e6","purple":"800080","rebeccapurple":"663399","red":"ff0000","rosybrown":"bc8f8f","royalblue":"4169e1","saddlebrown":"8b4513","salmon":"fa8072","sandybrown":"f4a460","seagreen":"2e8b57","seashell":"fff5ee","sienna":"a0522d","silver":"c0c0c0","skyblue":"87ceeb","slateblue":"6a5acd","slategray":"708090","slategrey":"708090","snow":"fffafa","springgreen":"00ff7f","steelblue":"4682b4","tan":"d2b48c","teal":"008080","thistle":"d8bfd8","tomato":"ff6347","turquoise":"40e0d0","violet":"ee82ee","wheat":"f5deb3","white":"ffffff","whitesmoke":"f5f5f5","yellow":"ffff00","yellowgreen":"9acd32"};
export const NAMED_COLORS = NAMED;

// a component value: number, percentage, angle, none, keyword, or calc()
function readValue(ts, allowKw) {
  ts = strip([...ts]);
  if (ts.length === 1) { const t = ts[0];
    if (t.t === 'num') return { num: t.v };
    if (t.t === 'pct') return { pct: t.v };
    if (t.t === 'dim') { const f = { deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360 }[t.u]; if (f === undefined) throw new Error('unit'); return { num: t.v * f, angle: true }; }
    if (t.t === 'ident' && t.v === 'none') return { none: true };
    if (t.t === 'ident' && allowKw && allowKw.includes(t.v)) return { kw: t.v };
    if (t.t === 'ident' && ['infinity', '-infinity', 'nan', 'pi', 'e'].includes(t.v)) throw new Error('constant outside calc');
  }
  if (ts[0]?.t === 'fn' && ts[0].v === 'calc') { const { items, end } = readArgs(ts, 1); if (end !== ts.length - 1) throw new Error('trailing');
    const calc = readCalc(strip(items[0]), allowKw), ty = calcType(calc); return { calc, angle: ty === 'a' || undefined, pctType: ty === 'p' }; }
  throw new Error('bad value');
}
// calc's sum: products of values, + and - between (with whitespace), * and / between
function readCalc(ts, allowKw) {
  const terms = []; let cur = [], d = 0;
  for (let i = 0; i < ts.length; i++) { const t = ts[i]; if (t.t === 'fn' || t.t === '(') d++; if (t.t === ')') d--;
    if (d === 0 && t.t === 'op' && (t.v === '+' || t.v === '-') && ts[i - 1]?.t === 'ws' && ts[i + 1]?.t === 'ws') { terms.push(strip(cur), t.v); cur = []; } else cur.push(t); }
  terms.push(strip(cur));
  let node = readProduct(terms[0], allowKw);
  for (let i = 1; i < terms.length; i += 2) node = { op: terms[i], args: [node, readProduct(terms[i + 1], allowKw)] };
  return node;
}
function readProduct(ts, allowKw) {
  const parts = []; let cur = [], d = 0;
  for (const t of ts) { if (t.t === 'fn' || t.t === '(') d++; if (t.t === ')') d--; if (d === 0 && (t.t === '/' || (t.t === 'op' && t.v === '*'))) { parts.push(strip(cur), t.t === '/' ? '/' : '*'); cur = []; } else cur.push(t); }
  parts.push(strip(cur));
  let node = readAtom(parts[0], allowKw);
  for (let i = 1; i < parts.length; i += 2) node = { op: parts[i], args: [node, readAtom(parts[i + 1], allowKw)] };
  return node;
}
function readAtom(ts, allowKw) {
  ts = strip([...ts]);
  if (ts.length === 1) { const t = ts[0];
    if (t.t === 'num') return { num: t.v }; if (t.t === 'pct') return { pct: t.v };
    if (t.t === 'dim') { const f = { deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360 }[t.u]; if (f === undefined) throw new Error('unit'); return { num: t.v * f, angle: true }; }
    if (t.t === 'ident') { const k = { infinity: Infinity, '-infinity': -Infinity, nan: NaN, pi: Math.PI, e: Math.E }[t.v]; if (k !== undefined) return { num: k }; if (allowKw && allowKw.includes(t.v)) return { kw: t.v }; } }
  if (ts[0]?.t === '(' ) { const { items } = readArgs(ts, 1); return readCalc(strip(items[0]), allowKw); }
  if (ts[0]?.t === 'fn' && ts[0].v === 'calc') { const { items } = readArgs(ts, 1); return readCalc(strip(items[0]), allowKw); }
  // CSS Values 4 §10.4: sin(), cos(), tan() of an angle, or of a number of radians
  if (ts[0]?.t === 'fn' && ['sin', 'cos', 'tan'].includes(ts[0].v)) { const { items } = readArgs(ts, 1); return { trig: ts[0].v, arg: readCalc(strip(items[0]), allowKw) }; }
  throw new Error('bad calc term');
}
// CSS Values 4 §10.9's type checking, for a color component: number (n), percentage (p) or angle (a); + and - take one
// type (a percentage does not resolve against a number in a color function), * a number on one side, / on the right
function calcType(n) {
  if (n.trig) { calcType(n.arg); return 'n'; }
  if (n.num !== undefined) return n.angle ? 'a' : 'n';
  if (n.pct !== undefined) return 'p';
  if (n.kw !== undefined) return 'n';
  if (n.op) { const [x, y] = n.args.map(calcType);
    if (n.op === '+' || n.op === '-') { if (x !== y) throw new Error('calc types'); return x; }
    if (n.op === '*') { if (x !== 'n' && y !== 'n') throw new Error('calc types'); return x === 'n' ? y : x; }
    if (y !== 'n') throw new Error('calc types'); return x; }
  throw new Error('bad calc node');
}
const words = (ts) => splitTop(ts, 'ws').filter((g) => g.length);

// rules that act while parsing (an engine's), set by parse(s, rules)
let PARSE = {};
// parse a <color> into a tree: { kind: 'abs', ... } | { kind: 'mix', ... } | { kind: 'rel', ... }
export function parse(s, rules = {}) { PARSE = rules; const ts = tokenize(s.trim()); const { node, end } = parseColor(ts, 0); if (end !== ts.length) throw new Error('trailing'); return node; }
function parseColor(ts, i) {
  while (ts[i]?.t === 'ws') i++;
  const t = ts[i];
  if (!t) throw new Error('empty');
  if (t.t === 'hash') { const h = t.v; if (![3, 4, 6, 8].includes(h.length)) throw new Error('hex');
    const full = h.length <= 4 ? [...h].map((c) => c + c).join('') : h, n = full.match(/../g).map((x) => parseInt(x, 16));
    return { node: { kind: 'abs', space: 'srgb', c: n.slice(0, 3).map((v) => v / 255), alpha: n.length === 4 ? n[3] / 255 : 1, legacy: true, fn: 'rgb' }, end: i + 1 }; }
  if (t.t === 'ident') {
    if (t.v === 'transparent') return { node: { kind: 'abs', space: 'srgb', c: [0, 0, 0], alpha: 0, legacy: true, fn: 'rgb' }, end: i + 1 };
    const hex = NAMED[t.v]; if (!hex) throw new Error(`unknown ${t.v}`);
    return { node: { kind: 'abs', space: 'srgb', c: hex.match(/../g).map((x) => parseInt(x, 16) / 255), alpha: 1, legacy: true, fn: 'rgb' }, end: i + 1 }; }
  if (t.t !== 'fn') throw new Error('not a color');
  const { items, end } = readArgs(ts, i + 1), body = strip(items[0]);
  const fn = t.v === 'rgba' ? 'rgb' : t.v === 'hsla' ? 'hsl' : t.v;
  if (fn === 'color-mix') return { node: parseMix(body), end: end + 1 };
  // CSS Color 5 §4.1's alpha(from <color> / <alpha>): the origin's components unchanged, `none` included
  if (fn === 'alpha') { const slash = splitTop(body, '/'), head = strip([...slash[0]]); if (head[0]?.t !== 'ident' || head[0].v !== 'from') throw new Error('alpha() from');
    const { node: origin, end: e2 } = parseColor(strip(head.slice(1)), 0); if (e2 !== strip(head.slice(1)).length) throw new Error('alpha() origin');
    return { node: { kind: 'alpha', origin, alpha: slash.length > 1 ? readValue(slash[1], ['alpha']) : undefined }, end: end + 1 }; }
  if (['rgb', 'hsl', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color'].includes(fn)) return { node: parseFn(fn, body), end: end + 1 };
  throw new Error(`function ${fn}`);
}
function parseMix(body) {
  const groups = splitTop(body, ',');
  let space = 'oklab', hue, first = 0;
  const g0 = words(groups[0]);
  if (g0[0]?.length === 1 && g0[0][0].t === 'ident' && g0[0][0].v === 'in') {
    space = ALIAS[g0[1]?.[0]?.v] ?? g0[1]?.[0]?.v; if (!SPACES[space]) throw new Error('mix space');
    if (g0.length === 4) { if (!POLAR.has(space) || g0[3][0].v !== 'hue' || !['shorter', 'longer', 'increasing', 'decreasing'].includes(g0[2][0].v)) throw new Error('hue method'); hue = g0[2][0].v; }
    else if (g0.length !== 2) throw new Error('mix method');
    first = 1; }
  const items = groups.slice(first).map((g) => {
    if (!g.length) throw new Error('empty item');
    // a percentage before or after the color
    const ws = words(g); let p = null, colTs;
    const isP = (w) => w.length === 1 && w[0].t === 'pct';
    if (isP(ws[0])) { p = ws[0][0].v; colTs = ws.slice(1).flat(); } else if (isP(ws[ws.length - 1])) { p = ws[ws.length - 1][0].v; colTs = strip(g.slice(0, g.lastIndexOf(ws[ws.length - 1][0]))); } else colTs = g;
    if (p !== null && (p < 0 || p > 100)) throw new Error('mix pct range');
    const { node, end } = parseColor(strip([...colTs]), 0); if (end !== strip([...colTs]).length) throw new Error('item trailing');
    return { color: node, p }; });
  if (!items.length) throw new Error('no items');
  return { kind: 'mix', space, hue, items };
}
function parseFn(fn, body) {
  let toks = body, origin = null, space;
  // relative: from <color>
  if (toks[0]?.t === 'ident' && toks[0].v === 'from') {
    let j = 1; while (toks[j]?.t === 'ws') j++;
    const { node, end } = parseColor(toks, j); origin = node; toks = strip(toks.slice(end));
  }
  if (fn === 'color') { const w0 = toks[0]; if (w0?.t !== 'ident') throw new Error('color() space'); space = ALIAS[w0.v] ?? w0.v; if (!SPACES[space] || POLAR.has(space) || ['lab', 'oklab'].includes(space)) throw new Error('color() space'); toks = strip(toks.slice(1)); }
  const keys = origin ? (fn === 'color' ? (space.startsWith('xyz') ? KEYS.xyz : KEYS.color) : KEYS[fn]).concat(['alpha']) : null;
  // legacy comma syntax (rgb, hsl only, never relative)
  const commas = splitTop(toks, ',');
  if (commas.length > 1) {
    if (origin || !(fn === 'rgb' || fn === 'hsl') || !(commas.length === 3 || commas.length === 4)) throw new Error('comma syntax');
    const vals = commas.map((g) => readValue(g, null)); if (vals.some((v) => v.none)) throw new Error('none in legacy');
    if (fn === 'rgb') { const kinds = vals.slice(0, 3).map((v) => (v.pct !== undefined ? 'p' : v.num !== undefined && !v.angle ? 'n' : v.calc ? 'c' : 'x')); if (kinds.includes('x') || (kinds.includes('p') && kinds.includes('n'))) throw new Error('rgb legacy types'); }
    if (fn === 'hsl') { if (vals[0].pct !== undefined) throw new Error('hsl hue %'); if (vals.slice(1, 3).some((v) => v.pct === undefined && !v.calc)) throw new Error('hsl legacy %'); }
    return absolute(fn, vals.slice(0, 3), vals[3], true);
  }
  // modern: three values, then / alpha
  const slash = splitTop(toks, '/'); if (slash.length > 2) throw new Error('slashes');
  const ws = words(slash[0]); if (ws.length !== 3) throw new Error('three components');
  const vals = ws.map((w) => readValue(w, keys)), alpha = slash.length === 2 ? readValue(slash[1], keys) : undefined;
  if (slash.length === 2 && !slash[1].length) throw new Error('empty alpha');
  // types: hue a number or angle; others number or percentage
  const hueAt = fn === 'hsl' || fn === 'hwb' ? 0 : fn === 'lch' || fn === 'oklch' ? 2 : -1;
  vals.forEach((v, i) => { if (v.angle && i !== hueAt) throw new Error('angle'); if ((v.pct !== undefined || v.pctType) && i === hueAt) throw new Error('hue %'); });
  if (alpha?.angle) throw new Error('alpha angle');
  if (origin) return { kind: 'rel', fn, space, origin, args: vals, alpha };
  return absolute(fn, vals, alpha, false, space);
}
// an absolute color, with the parse-time clamps (CSS Color 4 §5.1, §7, §9) and calc() resolved
function absolute(fn, vals, alphaV, legacySyntax, space) {
  const num = (v, unit) => (v.none ? null : v.pct !== undefined ? v.pct * unit : v.calc ? censor(evalCalc(v.calc, {}, unit)) : v.num);
  const hue = (v) => { if (v.none) return null; const h = num(v, 1); return Number.isFinite(h) ? norm(h) : 0; };
  let c, sp = fn, legacy = false;
  if (fn === 'rgb') { c = vals.map((v) => num(v, 2.55)).map((x) => (x === null ? null : (PARSE.rgbRound ? Math.round : (v) => v)(Math.min(255, Math.max(0, x))) / 255)); sp = 'srgb'; legacy = true; }
  else if (fn === 'hsl') { c = [hue(vals[0]), num(vals[1], 1), num(vals[2], 1)]; if (c[1] !== null && c[1] < 0) c[1] = 0; if (PARSE.hslClamp) [1, 2].forEach((i) => { if (c[i] !== null) c[i] = Math.min(100, Math.max(0, c[i])); }); legacy = true; }
  else if (fn === 'hwb') { c = [hue(vals[0]), num(vals[1], 1), num(vals[2], 1)]; [1, 2].forEach((i) => { if (c[i] !== null && PARSE.hwbClamp) c[i] = Math.min(PARSE.hwbClamp === 'low' ? Infinity : 100, PARSE.hwbClamp === 'high' ? c[i] : Math.max(0, c[i])); }); legacy = true; }
  else if (fn === 'lab') { c = [num(vals[0], 1), num(vals[1], 1.25), num(vals[2], 1.25)]; if (c[0] !== null) c[0] = Math.min(100, Math.max(0, c[0])); }
  else if (fn === 'lch') { c = [num(vals[0], 1), num(vals[1], 1.5), hue(vals[2])]; if (c[0] !== null) c[0] = Math.min(100, Math.max(0, c[0])); if (c[1] !== null) c[1] = Math.max(0, c[1]); }
  else if (fn === 'oklab') { c = [num(vals[0], 0.01), num(vals[1], 0.004), num(vals[2], 0.004)]; if (c[0] !== null) c[0] = Math.min(1, Math.max(0, c[0])); }
  else if (fn === 'oklch') { c = [num(vals[0], 0.01), num(vals[1], 0.004), hue(vals[2])]; if (c[0] !== null) c[0] = Math.min(1, Math.max(0, c[0])); if (c[1] !== null) c[1] = Math.max(0, c[1]); }
  else if (fn === 'color') { c = vals.map((v) => num(v, 0.01)); sp = space; }
  let alpha = alphaV === undefined ? 1 : alphaV.none ? null : num(alphaV, 0.01);
  if (alpha !== null) alpha = Math.min(1, Math.max(0, alpha));
  return { kind: 'abs', space: sp, c, alpha, legacy, fn: fn === 'rgb' || fn === 'hsl' || fn === 'hwb' ? fn : undefined };
}
const censor = (v) => (Number.isNaN(v) ? 0 : v);

// resolve a parsed tree to a color
// CSS Color 4 §15.1 makes a legacy color's computed value "the corresponding sRGB color", unclamped, and §16.2
// serializes it within [0, 255]: an hsl() lightness past 0% or 100% stays past sRGB until it is serialized. Chrome and
// Firefox clamp the color itself (rules.legacyClamp)
function legacyClamp(n) {
  if (!n.legacy || n.space === 'srgb' || n.c.some((v) => v === null)) return n;
  const rgb = (n.space === 'hsl' ? hslToRgb : hwbToRgb)(...n.c);
  if (rgb.every((v) => v >= 0 && v <= 1)) return n;
  return { ...n, space: 'srgb', c: rgb.map((v) => Math.min(1, Math.max(0, v))) };
}
export function resolveColor(n, rules = {}) {
  const r = resolveColor0(n, rules);
  // Q4: Firefox keeps every color's alpha, a nested one's too, to 8 bits
  return rules.ff8 && r.alpha !== null ? { ...r, alpha: Math.round(r.alpha * 255) / 255 } : r;
}
function resolveColor0(n, rules) {
  if (n.kind === 'abs') return rules.legacyClamp ? legacyClamp(n) : n;
  if (n.kind === 'alpha') { const o = resolveColor(n.origin, rules), c = ['hsl', 'hwb'].includes(o.space) || o.legacy ? toSpace(o, 'srgb', rules) : o;
    let a = n.alpha === undefined ? o.alpha : evalArg(n.alpha, { alpha: o.alpha }, 0.01); if (a !== null) a = Math.min(1, Math.max(0, a));
    return { ...c, c: [...c.c], alpha: a, legacy: false }; }
  if (n.kind === 'mix') return { ...mix(n, rules), mixed: n.space };
  return { ...relative(n, rules), rel: n.fn };
}

// the computed value's form (CSS Color 4 §16, CSS Color 5 §11): which function, in which space, its numbers
export const ffAlpha = (a) => { const two = Math.round(a * 100) / 100; return Math.round(two * 255) === Math.round(a * 255) ? two : Math.round(a * 1000) / 1000; };
export function computed(n, rules = {}) {
  const out = computedRaw(n, rules);
  // Q76: WebKit rounds a legacy color's byte that lands on .5 down
  if (rules.halfDown && out.form === 'rgb') out.c = out.c.map((v) => Math.ceil(v * 255 - 0.5 - 1e-9) / 255);
  if (rules.ffAlpha && out.alpha !== null) out.alpha = ffAlpha(out.alpha);
  return out;
}
function computedRaw(n, rules) {
  const col = resolveColor(n, rules);
  const anyMissing = col.c.some((v) => v === null) || col.alpha === null;
  if (n.kind === 'abs' && col.legacy) {
    if (anyMissing && !rules.legacyNone) {
      if (n.fn === 'rgb') return { form: 'color(srgb)', c: col.c, alpha: col.alpha };
      return { form: n.fn, c: col.c, alpha: col.alpha };
    }
    const rgb = col.space === 'srgb' ? col.c.map(z) : n.fn === 'hsl' ? hslToRgb(...col.c.map(z)) : hwbToRgb(...col.c.map(z));
    return { form: 'rgb', c: rgb.map((v) => Math.min(1, Math.max(0, v))), alpha: z(col.alpha) };
  }
  if (n.kind === 'mix' && (n.space === 'hsl' || n.space === 'hwb')) {
    if (anyMissing && !rules.mixHslNone) return { form: n.space, c: col.c, alpha: col.alpha };
    return { form: 'color(srgb)', c: (n.space === 'hsl' ? hslToRgb : hwbToRgb)(...col.c.map(z)), alpha: col.alpha };
  }
  if (n.kind === 'rel' && (n.fn === 'hsl' || n.fn === 'hwb' || n.fn === 'rgb')) {
    if (anyMissing && n.fn !== 'rgb' && !rules.relHslNone) return { form: n.fn, c: col.c, alpha: col.alpha };
    const rgb = n.fn === 'rgb' ? col.c : (n.fn === 'hsl' ? hslToRgb : hwbToRgb)(...col.c.map(z));
    return { form: 'color(srgb)', c: rgb, alpha: col.alpha };
  }
  const sp = col.space;
  if (['lab', 'lch', 'oklab', 'oklch'].includes(sp)) return { form: sp, c: col.c, alpha: col.alpha };
  return { form: `color(${sp})`, c: col.c, alpha: col.alpha };
}
export function resolve(css, rules = {}) { let n; try { n = parse(css); } catch { return null; } return computed(n, rules); }
