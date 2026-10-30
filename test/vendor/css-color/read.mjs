// An engine's serialized color, read and compared with the spec's computed value (oracle.mjs, anim.mjs).

// an engine's serialized color, read: { form, c (rgb() and color(srgb ...) as 0..1), alpha }, null missing, NaN for calc(NaN)
export function readSerialized(s) {
  s = s.trim(); let m;
  if ((m = s.match(/^rgba?\((.*)\)$/))) { const p = m[1].split(',').map((x) => parseFloat(x)); return { form: 'rgb', c: p.slice(0, 3).map((v) => v / 255), alpha: p.length > 3 ? p[3] : 1 }; }
  if ((m = s.match(/^(color\(([a-z0-9-]+)|lab|lch|oklab|oklch|hsl|hwb)\(?\s*(.*)\)$/))) {
    const form = m[2] ? `color(${m[2]})` : m[1];
    const [main, al] = m[3].split('/'), vals = main.trim().replace(/calc\(NaN\)/g, 'NaN').split(/\s+/).map((v) => (v === 'none' ? null : parseFloat(v)));
    return { form, c: vals, alpha: al === undefined ? 1 : al.trim() === 'none' ? null : parseFloat(al) };
  }
  return { form: '?', c: [NaN, NaN, NaN], alpha: NaN, raw: s };
}
// The spec's computed value written as CSS serializes it (CSS Color 4 §16): rgb()/rgba() with whole numbers for a
// legacy color, the function or color() with its numbers otherwise, `none` for a missing component, the alpha after
// a slash and left out at 1 (a channel's byte rounded with 1e-9 added, so 50% is 128 and not 127.4999…'s 127)
const num = (v) => (v === null ? 'none' : String(+(+v).toFixed(6)));
export function serialize(w) {
  // a legacy channel to a byte, half up (CSS Color 4: "Values must be rounded towards +∞, not truncated."); the 1e-9 only
  // keeps 0.5 * 255 from landing a float's width below a half
  if (w.form === 'rgb') { const c = w.c.map((v) => Math.round(Math.min(1, Math.max(0, v ?? 0)) * 255 + 1e-9)); return w.alpha === 1 ? `rgb(${c.join(', ')})` : `rgba(${c.join(', ')}, ${num(w.alpha ?? 0)})`; }
  const a = w.alpha === null ? ' / none' : w.alpha === 1 ? '' : ` / ${num(w.alpha)}`;
  if (w.form.startsWith('color(')) return `color(${w.form.slice(6, -1)} ${w.c.map(num).join(' ')}${a})`;
  if (w.form === 'hsl' || w.form === 'hwb') return `${w.form}(${num(w.c[0])} ${[w.c[1], w.c[2]].map((v) => (v === null ? 'none' : num(v) + '%')).join(' ')}${a})`;
  return `${w.form}(${w.c.map(num).join(' ')}${a})`;
}
// WPT's fuzzy color comparison, as css/support/color-testcommon.js's set_up_fuzzy_color_test(): every number within
// epsilon (0.01, its default), and the text without the numbers equal (function, space, `none`, separators). Nothing
// else: no tolerance of our own.
export const EPSILON = 0.01;
const nums = (s) => s.split(/( |\(|,)/).map((e) => parseFloat(e)).filter((v) => !Number.isNaN(v)), text = (s) => s.replace(/[0-9.]/g, '');
const wptMatch = (got, expected, eps = EPSILON) => { const a = nums(got), b = nums(expected); return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps) && text(got) === text(expected); };
// 'ok' when WPT's comparison passes; else 'form' (the text differs) or 'value' (a number does), or 'validity'
export function compare(want, got) {
  if (want === null) return got === null ? 'ok' : 'validity';
  if (got === null) return 'validity';
  const exp = serialize(want);
  if (wptMatch(got.trim(), exp)) return 'ok';
  // the same color with a number in exponent notation, csswg-drafts #8538's reading of how numbers serialize (README)
  const plain = got.trim().replace(/-?\d+(\.\d+)?e[-+]\d+/g, (m) => String(+(+m).toFixed(6)));
  if (plain !== got.trim() && wptMatch(plain, exp)) return 'exponent';
  return text(got.trim()) !== text(exp) ? 'form' : 'value';
}

// the engines' known rules, by QUIRKS.md number; SERIAL is the older serialization of `none` (Q50 and its kin)
export const SERIAL = { legacyNone: true, mixHslNone: true, relHslNone: true };
export const RULES = [
  ['Q50', SERIAL], ['Q39', { rcsNoneZero: true }], ['Q38', { noAnalogousSet: true }], ['Q40', { noHueEpsilon: true, keepNoise: true }],
  ['Q14', { chromeGrey: true }], ['Q35', { noHslTurn: true }], ['Q37', { noCarryRGB: true }], ['Q36', { alphaZeroKeep: true }],
  ['Q13 (relative colors)', { rcsKeepPowerless: true }], ['Q3', { noneHueGrey: true }], ['Q41', { noHueCarryHwb: true }], ['Q42', { greyHue180: true }],
  ['Q2', { rcsAlphaNone0: true }], ['Q6', { noSumCap: true }], ['Q28', { rec2020Bt2020: true }], ['Q5', { zeroAlphaBlack: true }],
  ['a legacy color kept to 8 bits (Q27, a trap), in Firefox', { rgbRound: true }], ['spec: a legacy hwb() clamped below 0', { hwbClamp: 'low' }],
  ['Q65', { mixInputClampL: true }], ['Q13 (any conversion)', { keepPowerless: true }],
  ['Q72', { hwbClamp: 'high' }], ['Q72 + spec: a legacy hwb() clamped below 0', { hwbClamp: 'both' }], ['spec: a legacy hsl() clamped to 0 to 100', { hslClamp: true }], ['Q4', { ffAlpha: true }], ['Q4, nested', { ffAlpha: true, ff8: true }], ['Q71', { longerMissingNoTurn: true }], ['Q76', { halfDown: true }], ['Q46 + Q62', { negNaN: true }], ['Q63', { zeroPairFirst: true }], ['Q39', { rcsNoCarry: true }], ['spec: a legacy color past sRGB clamped before use', { legacyClamp: true }], ['spec: CSS Color 5 §4.1 against CSS Color 4 §15.2', { reading: 'clamp' }],
];
