// The resolution of csswg-drafts #13157 (2026-03-31 and 2026-04-27), CSS Color 4 §12, in JS on Color.js 0.7.1: whether
// two colors are equivalent colors. In one color space their components compare (a powerless one missing, §12 step
// 1), `none` equal only to `none`, within 1e-5 of each component's range; in two spaces a `none` makes them differ;
// else both in OkLab within 0.00001. hsl(), hwb(), rgb(), hex and named colors are the srgb space, compared as R, G and
// B, where a `none` written in one notation can't line up with the other's (WPT's query-style-color.html); a powerless
// hue makes no `none` across spaces (WPT takes oklch(0 0 0) to equal black; #14472 is open on this).
// Usage: import { equivalent, blind } from './ref/equal.mjs'
import { createRequire } from 'node:module';
const cjs = createRequire(import.meta.url)('colorjs.io'), Color = cjs.default ?? cjs;
export const SRGB = new Set(['srgb', 'hsl', 'hwb']), EPS = 1e-5;
const RANGE = { lab: [100, 125, 125], lch: [100, 150, 360], oklab: [1, 0.4, 0.4], oklch: [1, 0.4, 360], hsl: [360, 100, 100], hwb: [360, 100, 100] };
const HUE = { lch: 2, oklch: 2, hsl: 0, hwb: 0 };
// CSS Color 4 §4.4.1 and each space's powerless ε: the hue that is powerless, with its colorfulness set to 0
const powerless = (id, c) => { c = [...c]; const h = HUE[id];
  if ((id === 'lch' && c[1] !== null && c[1] <= 0.0015) || (id === 'oklch' && c[1] !== null && c[1] <= 0.000004)) { c[2] = 'p'; if (c[1] > 0) c[1] = 0; }
  if (id === 'hsl' && c[1] !== null && c[1] <= 0.001) { c[0] = 'p'; if (c[1] > 0) c[1] = 0; }
  if (id === 'hwb' && c[1] !== null && c[2] !== null && c[1] + c[2] >= 99.999) c[0] = 'p';
  return { c, h }; };
export const hasNone = (x) => x.coords.some((v) => v === null) || x.alpha === null;
export function equivalent(s1, s2) {
  const a = new Color(s1), b = new Color(s2), ia = a.space.id, ib = b.space.id, sp = (id) => (SRGB.has(id) ? 'srgb' : id);
  if (sp(ia) === sp(ib)) {
    // hsl() and hwb() are srgb for §12 (two of one notation compared in srgb's components), save where a `none`
    // lines up only in their own
    if (ia === ib && (!['hsl', 'hwb'].includes(ia) || hasNone(a) || hasNone(b))) { // §12 step 2, in the color's own components, a powerless one missing
      const pa = powerless(ia, a.coords), pb = powerless(ib, b.coords), r = RANGE[ia] ?? [1, 1, 1];
      const same = (x, y, k) => { const mx = x === null || x === 'p', my = y === null || y === 'p'; if (mx || my) return mx && my;
        const d = Math.abs(x - y), dh = d % 360; return (k === pa.h ? Math.min(dh, 360 - dh) : d) <= EPS * r[k]; };
      return pa.c.every((x, k) => same(x, pb.c[k], k)) && (a.alpha === null || b.alpha === null ? a.alpha === b.alpha : Math.abs(a.alpha - b.alpha) <= EPS);
    }
    // hsl(), hwb() and rgb() against each other: srgb's components, which a `none` in one notation can't line up with
    if (hasNone(a) || hasNone(b)) return false;
    return [...a.to('srgb').coords, a.alpha].every((v, k) => Math.abs(v - [...b.to('srgb').coords, b.alpha][k]) <= EPS);
  }
  if (hasNone(a) || hasNone(b)) return false; // step 3
  const oa = [...a.to('oklab').coords, a.alpha], ob = [...b.to('oklab').coords, b.alpha];
  return oa.every((v, k) => Math.abs(v - ob[k]) <= EPS); // step 4
}
// what the part can't read: a `none` hue where the colorfulness is 0, which changes no channel in any space; and the
// same `none`s in two spaces, which CSS can't tell from one space (the oracle on the colors with those nones as 0,
// compared as one space would compare them)
const zeroHueNone = (s) => { const x = new Color(s), id = x.space.id, h = HUE[id]; if (h === undefined || x.coords[h] !== null) return false;
  return id === 'hwb' ? (x.coords[1] ?? 0) + (x.coords[2] ?? 0) >= 99.999 : (x.coords[1] ?? 0) === 0; };
const noneSlots = (s) => { const x = new Color(s); return x.coords.map((v) => v === null).join() + (x.alpha === null); };
export function blind(s1, s2) {
  if (zeroHueNone(s1) || zeroHueNone(s2)) return 'a none hue at zero chroma';
  const a = new Color(s1), b = new Color(s2);
  if (a.space.id !== b.space.id && hasNone(a) && hasNone(b) && noneSlots(s1) === noneSlots(s2)) return 'the same nones in two spaces';
  return null;
}

