// Checks .gamut-color-mix (build.mjs mixPart()) against CSS Color 5 §3.3 in Chrome, WebKit and Firefox: the spec's algorithm
// run in JS (normalized percentages, the stack of two-color mixes, the alpha multiplier) written out as literal nested
// two-color color-mix()es for the same engine to compute; the same steps in doubles in JS (CSS Color 4 §13's
// interpolation written out, Color.js only converting), which no engine computes; and in Firefox, which ships it, its own color-mix()
// of the whole list. Some cases leave --gamut-mix-space unset (oklab). A case passes within 1/255 a channel (bytes at
// most 1 apart: 1.5/255) and 2/255 alpha of both references.
// Also .gamut-device-cmyk against CSS Color 5 §6.1's naive conversion.
// Usage: node test/color-mix-check.mjs [cases]
import PW from './playwright.mjs'; // its Chrome is Chrome for Testing, never the installed Chrome.app
import { pick } from './engines.mjs';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { rgbToHsl, hslToRgb, rgbToHwb, hwbToRgb } from './ref/methods.mjs';
const pw = PW;
const r2 = createRequire(import.meta.url); const cjs = r2('colorjs.io'); const Color = cjs.default ?? cjs;
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const N = +(process.argv[2] ?? 600);
const read = (c) => { const k = new Color(c.replace(/-?[0-9.]+e[-+]?[0-9]+/g, (m) => (+m).toFixed(12))); return [...k.to('srgb').coords.map((x) => (Number.isNaN(x) ? 0 : x)), k.alpha ?? 1]; };
// CSS Color 5 §3.3, with css-values-5's normalize mix percentages (force normalization on)
function spec(colors, pcts, space) {
  const given = pcts.filter((p) => p != null), S = Math.min(100, given.reduce((a, b) => a + b, 0)), O = pcts.length - given.length;
  let ps = pcts.map((p) => (p == null ? (100 - S) / O : p));
  const T = ps.reduce((a, b) => a + b, 0);
  if (T > 0) ps = ps.map((p) => (p * 100) / T);
  // every percentage 0%: alpha 0, the channels an even mix (CSS Color 5 §3.3 since #14013 and #13996); compared by
  // its alpha alone, as an engine without that mix gives transparent black
  if (T === 0) return 'transparent';
  const mult = Math.min(1, T / 100);
  // (the first two colors mixed as they are, as §3.3's first step mixes them: one converted alone first lost a
  // transparent color's channels, and Chrome 155 clamps a lightness below 0 converting, not mixing)
  let expr = colors.length > 1 ? colors[0] : `color-mix(in ${space}, ${colors[0]} 100%, ${colors[0]} 0%)`, P = ps[0];
  for (let k = 1; k < colors.length; k++) {
    const sum = P + ps[k], a = sum > 0 ? P / sum : 0.5, b = sum > 0 ? ps[k] / sum : 0.5;
    expr = `color-mix(in ${space}, ${expr} ${(a * 100).toFixed(6)}%, ${colors[k]} ${(b * 100).toFixed(6)}%)`; P = sum;
  }
  return `color-mix(in ${space}, ${expr} ${(mult * 100).toFixed(6)}%, ${expr} 0%)`;
}
// the same steps in doubles, CSS Color 4 §13 written out, over the engine's own conversion of each color into the space
// (read from a relative color; HSL and HWB by CSS Color 4's sample code from the engine's sRGB), so what differs is the
// mixing: a missing component takes the other color's, the non-hue channels premultiplied by alpha, the hue by the
// case's method, the result carrying the summed percentage; alpha times min(1, T / 100). Chrome drops the hue of a color
// it converts to OkLCh or LCH at chroma up to 0.02 (QUIRKS.md Q14): there its reference does too (counted apart).
const HUE = { oklch: 2, lch: 2, hsl: 0, hwb: 0 };
const FORM = { srgb: ['color(from', 'srgb r g b'], 'srgb-linear': ['color(from', 'srgb-linear r g b'], 'display-p3': ['color(from', 'display-p3 r g b'],
  xyz: ['color(from', 'xyz-d65 x y z'], lab: ['lab(from', 'l a b'], oklab: ['oklab(from', 'l a b'], lch: ['lch(from', 'l c h'], oklch: ['oklch(from', 'l c h'] };
const nums = (str) => { const m = str.match(/\(([^)]*)\)/)[1].replace(/^(srgb-linear|srgb|display-p3|xyz-d65|xyz)\s+/, '').split(/[\s/]+/).filter(Boolean);
  return m.map((v) => (v === 'none' ? NaN : parseFloat(v))); };
function interpolate([a0, aa0], [b0, ab0], p, hi, method) {
  const a = a0.map((v, i) => (Number.isNaN(v) ? b0[i] : v)), b = b0.map((v, i) => (Number.isNaN(v) ? a0[i] : v));
  let aa = Number.isNaN(aa0) ? ab0 : aa0, ab = Number.isNaN(ab0) ? aa0 : ab0; aa = Number.isNaN(aa) ? 1 : aa; ab = Number.isNaN(ab) ? 1 : ab;
  if (hi >= 0 && !Number.isNaN(a[hi])) { a[hi] = ((a[hi] % 360) + 360) % 360; b[hi] = ((b[hi] % 360) + 360) % 360; const d = b[hi] - a[hi];
    if (method === 'longer') { if (d > 0 && d < 180) a[hi] += 360; else if (d > -180 && d <= 0) b[hi] += 360; }
    else if (d > 180) a[hi] += 360; else if (d < -180) b[hi] += 360; }
  const alpha = aa * (1 - p) + ab * p;
  return [a.map((v, i) => { if (Number.isNaN(v)) return NaN; if (i === hi) return v * (1 - p) + b[i] * p;
    const m = v * aa * (1 - p) + b[i] * ab * p; return alpha ? m / alpha : m; }), alpha];
}
// variants that model what an engine does apart from the spec: chromeGrey (QUIRKS.md Q14), firefoxHsl (Firefox doesn't
// turn the hue 180° for a negative hsl saturation; only the sample code says to, an open point in specs/css-color/README.md,
// "Where the text leaves it open"), firefoxAlpha (Q4: each color's and each step's alpha serialized as Firefox does, 2
// decimals where they give the same 8-bit value, otherwise 3)
const ffAlpha = (a) => { const two = Math.round(a * 100) / 100; return Math.round(two * 255) === Math.round(a * 255) ? two : Math.round(a * 1000) / 1000; };
// chromeNeg: Chrome 155's color-mix() keeps a lightness below 0 in lab, lch, oklab and oklch, where its relative colors
// (the conversions read here) give 0: such a color's channels from Color.js instead
function doubles(c, conv, chromeGrey, firefoxHsl = false, firefoxAlpha = false, chromeNeg = false, viaSrgb = false) {
  const given = c.ps.filter((p) => p != null), S = Math.min(100, given.reduce((a, b) => a + b, 0)), O = c.ps.length - given.length;
  let ps = c.ps.map((p) => (p == null ? (100 - S) / O : p));
  const T = ps.reduce((a, b) => a + b, 0);
  if (T === 0) return null; // alpha 0: no channels to compare
  ps = ps.map((p) => (p * 100) / T);
  const [sp, hue] = c.sp.split(' '), hi = HUE[sp] ?? -1;
  const inSpace = (col) => { let [v, al, rgb] = conv[`${col}|${sp}`]; v = [...v];
    if (chromeNeg && HUE[sp] !== 0 && sp in { lab: 1, lch: 1, oklab: 1, oklch: 1 }) { const k = new Color(col).to(sp).coords; if (k[0] < 0) v = k.map((x) => (Number.isNaN(x) ? 0 : x)); }
    if (firefoxHsl && sp === 'hsl') v = rgbToHsl(...rgb, false);
    if (firefoxAlpha) al = ffAlpha(al);
    if (chromeGrey && (sp === 'oklch' || sp === 'lch') && v[1] <= 0.02) v[2] = NaN; return [v, al]; };
  let r = inSpace(c.cs[0]), P = ps[0];
  for (let k = 1; k < c.cs.length; k++) { const sum = P + ps[k]; r = interpolate(r, inSpace(c.cs[k]), sum > 0 ? ps[k] / sum : 0.5, hi, hue ?? 'shorter'); P = sum;
    if (firefoxAlpha) r[1] = ffAlpha(r[1]);
    // a step's result goes on as it is, in the interpolation space (CSS Color 5 §3.3 pushes "the resulting color"); the
    // engines' nested color-mix() takes it through sRGB instead, counted apart below where that differs
    if (sp === 'hsl' && viaSrgb) r = [rgbToHsl(...hslToRgb(...r[0].map((x) => (Number.isNaN(x) ? 0 : x))), !firefoxHsl), r[1]]; }
  let [v, al] = r; v = v.map((x) => (Number.isNaN(x) ? 0 : x));
  const out = sp === 'hsl' ? new Color('srgb', hslToRgb(...v)) : sp === 'hwb' ? new Color('srgb', hwbToRgb(...v))
    : new Color({ xyz: 'xyz-d65', 'display-p3': 'p3' }[sp] ?? sp, v);
  return [...out.to('srgb').coords, al * Math.min(1, T / 100)];
}
// each color in each space, as the engine converts it: [channels, alpha]
async function conversions(p) {
  const pairs = [...new Set(cases.flatMap((c) => c.cs.map((col) => `${col}|${c.sp.split(' ')[0]}`)))];
  const got = await p.evaluate(([pairs, FORM]) => { const d = document.createElement('i'); document.body.append(d);
    return pairs.map((k) => { const [col, sp] = k.split('|'), f = FORM[sp === 'hsl' || sp === 'hwb' ? 'srgb' : sp];
      d.style.setProperty('--probe', `${f[0]} ${col} ${f[1]} / alpha)`); return getComputedStyle(d).getPropertyValue('--probe'); }); }, [pairs, FORM]);
  return Object.fromEntries(pairs.map((k, i) => { const sp = k.split('|')[1], n = nums(got[i]), al = n.length > 3 ? n[3] : 1, ch = n.slice(0, 3);
    return [k, [sp === 'hsl' ? rgbToHsl(...ch) : sp === 'hwb' ? rgbToHwb(...ch) : ch, al, ch]]; }));
}
let seed = 4711; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const SPACES = ['oklab', 'srgb', 'srgb-linear', 'lab', 'oklch', 'oklch longer hue', 'lch', 'hsl', 'display-p3', 'xyz'];
const color = () => { const a = rnd() < 0.25 ? ` / ${(rnd()).toFixed(3)}` : ''; return rnd() < 0.8 ? `rgb(${[0, 0, 0].map(() => Math.floor(rnd() * 256)).join(' ')}${a})` : `oklch(${rnd().toFixed(3)} ${(rnd() * 0.3).toFixed(3)} ${(rnd() * 360).toFixed(1)}${a})`; };
const cases = [
  { cs: ['red'], ps: [null], sp: 'oklab' }, { cs: ['red'], ps: [40], sp: 'oklab' }, { cs: ['red', 'blue', 'green'], ps: [null, null, null], sp: 'oklab' },
  { cs: ['peru', 'palegoldenrod'], ps: [40, null], sp: 'lch' }, { cs: ['purple', 'plum'], ps: [30, 30], sp: 'lch' }, { cs: ['red', 'blue', 'lime'], ps: [0, 0, 0], sp: 'srgb' },
  { cs: ['red', 'blue', 'lime', 'gold'], ps: [70, 70, null, null], sp: 'oklch' },
];
while (cases.length < N) { const n = 1 + Math.floor(rnd() * 6); cases.push({ cs: Array.from({ length: n }, color), ps: Array.from({ length: n }, () => (rnd() < 0.4 ? null : Math.round(rnd() * 100))), sp: SPACES[Math.floor(rnd() * SPACES.length)], unset: rnd() < 0.1 }); }
for (const c of cases) if (c.unset) c.sp = 'oklab'; // left unset: the default
const vars = (c) => `--gamut-mix-count: ${c.cs.length};${c.unset ? '' : ` --gamut-mix-space: ${c.sp};`} ${c.cs.map((x, k) => `--gamut-mix-${k + 1}: ${x};${c.ps[k] != null ? ` --gamut-mix-pct-${k + 1}: ${c.ps[k]};` : ''}`).join(' ')}`;
const native = (c) => `color-mix(in ${c.sp}, ${c.cs.map((x, k) => `${x}${c.ps[k] != null ? ` ${c.ps[k]}%` : ''}`).join(', ')})`;
const cmyk = Array.from({ length: 64 }, () => [rnd(), rnd(), rnd(), rnd(), rnd() < 0.2 ? rnd() : 1].map((x) => +x.toFixed(4)));
const naive = ([c, m, y, k, a]) => [1 - Math.min(1, c * (1 - k) + k), 1 - Math.min(1, m * (1 - k) + k), 1 - Math.min(1, y * (1 - k) + k), a];
const page = `<!doctype html><style>${css}\n@property --want { syntax: '<color>'; inherits: false; initial-value: black; } @property --nat { syntax: '<color>'; inherits: false; initial-value: black; } @property --probe { syntax: '<color>'; inherits: false; initial-value: black; }</style>
${cases.map((c) => `<i class="gamut-color-mix" style="${vars(c)}; --want: ${spec(c.cs, c.ps, c.sp)}; --nat: ${native(c)}"></i>`).join('')}
${cmyk.map(([c, m, y, k, a]) => `<b class="gamut-device-cmyk" style="--gamut-cmyk-c: ${c}; --gamut-cmyk-m: ${m}; --gamut-cmyk-y: ${y}; --gamut-cmyk-k: ${k}; --gamut-cmyk-alpha: ${a}"></b>`).join('')}`;
let failed = false;
for (const [name, type, opts] of pick()) {
  const b = await pw[type].launch(opts), p = await b.newPage();
  await p.setContent(page);
  const got = await p.evaluate(() => [...document.querySelectorAll('i')].map((e) => { const s = getComputedStyle(e); return [s.getPropertyValue('--gamut-out'), s.getPropertyValue('--want'), s.getPropertyValue('--nat')]; }));
  const gotC = await p.evaluate(() => [...document.querySelectorAll('b')].map((e) => getComputedStyle(e).getPropertyValue('--gamut-out')));
  const conv = await conversions(p);
  const off = (g, w) => (w[3] < 1e-6 && g[3] < 1e-6 ? 0 : Math.max(...[0, 1, 2].map((k) => Math.abs(g[k] - w[k]))) * 255), bad = [], badN = [], badD = []; let nat = 0, worstD = 0, q14 = 0, ffHsl = 0, q4 = 0, neg = 0, via = 0;
  cases.forEach((c, i) => { const [o, w, n] = got[i].map((x) => { try { return read(x); } catch { return null; } });
    if (!o || !w || off(o, w) > 1.5 || Math.abs(o[3] - w[3]) * 255 > 2) bad.push(`${i} ${native(c)} -> ${got[i][0]}, want ${got[i][1]}`);
    const d = doubles(c, conv, false), ok = (x) => off(o, x) <= 1.5 && Math.abs(o[3] - x[3]) * 255 <= 2;
    if (d && o) { worstD = Math.max(worstD, off(o, d));
      if (!ok(d)) { const dc = name === 'Chrome' ? doubles(c, conv, true) : null, df = name === 'Firefox' ? [doubles(c, conv, false, true), doubles(c, conv, false, false, true), doubles(c, conv, false, true, true), doubles(c, conv, false, true, false, false, true)] : [];
        const dn = name === 'Chrome' ? doubles(c, conv, false, false, false, true) : null;
        const dv = doubles(c, conv, false, false, false, false, true);
        if (dv && ok(dv)) via++; else if (dc && ok(dc)) q14++; else if (dn && ok(dn)) neg++; else if (df[0] && ok(df[0])) ffHsl++; else if (df[1] && ok(df[1])) q4++; else if (df[2] && ok(df[2])) { ffHsl++; q4++; } else if (df[3] && ok(df[3])) { ffHsl++; via++; } else badD.push(`${i} ${native(c)} -> ${got[i][0]}, in doubles ${d.map((x) => x.toFixed(4))}`); } }
    if (name === 'Firefox' && n && got[i][2] !== got[i][0]) { nat++; if (off(o, n) > 1.5 || Math.abs(o[3] - n[3]) * 255 > 2) badN.push(`${i} ${native(c)} -> ${got[i][0]}, Firefox's own ${got[i][2]}`); } });
  const badC = cmyk.filter((v, i) => { const g = read(gotC[i]), w = naive(v); return Math.max(...[0, 1, 2].map((k) => Math.abs(g[k] - w[k]))) * 255 > 0.5 || Math.abs(g[3] - w[3]) * 255 > 1; });
  // the engines' own known differences, as many as measured on the 600 cases (2026-10-29): more fails (Chrome 155:
  // 4 greys' hues dropped, QUIRKS.md Q14, and 1 lightness below 0 kept; Firefox 158: 4 hsl turns)
  const KNOWN = { Chrome: { q14: 4, neg: 1, via: 0 }, WebKit: { via: 0 }, Firefox: { ffHsl: 4, q4: 0, via: 1 } }[name] ?? {}, counts = { q14, neg, ffHsl, q4, via };
  // (scaled to another number of cases, never dropped)
  const allowed = (k) => Math.ceil((KNOWN[k] ?? 0) * cases.length / 600), over = Object.entries(counts).filter(([k, v]) => v > allowed(k));
  if (over.length) badD.push(`known differences past their count: ${over.map(([k, v]) => `${k} ${v} for ${allowed(k)}`).join(', ')}`);
  failed ||= bad.length + badC.length + badD.length > 0; // Firefox's own color-mix() parting from the spec (an omitted color's negative share: open in specs/css-color/README.md, "Where the text leaves it open") is reported, not held against the sheet
  console.log(`${name}: ${cases.length - bad.length} of ${cases.length} mixes match CSS Color 5 §3.3 as nested color-mix(), ${cases.length - badD.length} of ${cases.length} as computed in doubles${via ? ` (${via} in hsl with a step's result taken through sRGB, as nested color-mix() takes it)` : ''}${q14 ? ` (${q14} with a grey's hue dropped, as Chrome's color-mix() does, Q14)` : ''}${neg ? ` (${neg} with a lightness below 0 kept, as Chrome's color-mix() keeps it)` : ''}${ffHsl ? ` (${ffHsl} in hsl with no 180° turn for a negative saturation, as Firefox's does)` : ''}${q4 ? ` (${q4} with each step's alpha kept to 8 bits, as Firefox keeps it, Q4)` : ''} (worst ${worstD.toFixed(2)}/255${badD.length ? `; off: ${badD.slice(0, 8).join(' | ')}` : ''})${name === 'Firefox' ? `; ${cases.length - badN.length} of ${cases.length} match Firefox's own color-mix() (it doesn't cap the given percentages at 100% before sharing the rest, so an omitted one can get a negative share: its bug)` : ''}; device-cmyk ${cmyk.length - badC.length} of ${cmyk.length}${bad.length ? `\n  ${bad.slice(0, 8).join('\n  ')}` : ''}`);
  await b.close();
}
process.exit(failed ? 1 : 0);
