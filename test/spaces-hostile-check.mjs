// Checks the spaces parts (.gamut-okhsl, .gamut-okhsl-from, .gamut-okhsv, .gamut-jzczhz, .rec2100-*, .gamut-hdr-color, .gamut-color-extract) on the inputs
// a hostile-input fuzz (2026-10-27) found mishandled, in Chrome, WebKit and Firefox, the function forms in Chrome:
// - a `none` hue in an oklch() or lch() input converts as 0 (CSS Color 4 §4.4), not as grey (WebKit, QUIRKS.md Q3): the
//   output equals the same part's on that color with hue 0;
// - an input with alpha 0 or none keeps its channels (.gamut-okhsl-from, .gamut-hdr-color): the output equals the opaque color's,
//   with alpha 0;
// - a hue given as an angle (deg, rad, turn) is that angle, as in oklch() (.gamut-okhsl, .gamut-okhsv, .gamut-jzczhz), and `none` is 0;
// - a saturation, lightness or value given as a percentage reads as 0, as O1 and V1 say (.gamut-okhsl, .gamut-okhsv);
// - .gamut-okhsl-from with --gamut-okhsl-l or -s `none` keeps the color's own, as with it unset;
// - .gamut-hdr-color: where a channel is below 0 in either color, eps grows by the most negative (SPEC.md H3), never NaN;
//   one color alone is used at every headroom; a headroom that isn't a number reads as 0;
// - .rec2100-*, .gamut-jzazbz, .gamut-jzczhz and .gamut-ictcp with a channel `none`: that channel 0 (CSS Color 4 §4.4).
// Each case's expected value is its control's in the same engine (the same part on the input written as SPEC.md says it
// means), or §5.1's formula over the engine's own xyz-d65 of the inputs: within 1e-4 a channel (relative above 1).
// Usage: node test/spaces-hostile-check.mjs   (SHEET= another sheet; ENGINES= narrows)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pick, open } from './engines.mjs';
import { gamut } from './ref/classes.mjs';
const req = createRequire(import.meta.url), cjs = req('colorjs.io'), Color = cjs.default ?? cjs;
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');

// a case: the element (class and style, or a function call in Chrome) and what it must equal: another element's
// output ('=' id), a value ('v' [x, y, z, alpha] in xyz-d65, or a function of the outputs read)
const cases = [], el = (id, cls, style, fn = null) => cases.push({ id, cls, style, fn });
const same = (id, ref, opts = {}) => (cases.find((c) => c.id === id).want = { ref, ...opts });
const okhslFrom = (c, more = '') => `--gamut-in: ${c};${more}`;
// 1. a none hue (Q3)
for (const [k, c, c0] of [['ok', 'oklch(0.65 0.2 none)', 'oklch(0.65 0.2 0)'], ['lch', 'lch(55 70 none)', 'lch(55 70 0)']]) {
  el(`okhsl-from ${c}`, 'okhsl-from', okhslFrom(c)); el(`okhsl-from ${c0}`, 'okhsl-from', okhslFrom(c0)); same(`okhsl-from ${c}`, `okhsl-from ${c0}`);
  el(`okhsl-from ${c} l 0.8`, 'okhsl-from', okhslFrom(c, ' --gamut-okhsl-l: 0.8')); el(`okhsl-from ${c0} l 0.8`, 'okhsl-from', okhslFrom(c0, ' --gamut-okhsl-l: 0.8'));
  same(`okhsl-from ${c} l 0.8`, `okhsl-from ${c0} l 0.8`);
  el(`hdr-1 ${c}`, 'hdr-color', `--gamut-hdr-1: ${c}; --gamut-hdr-2: white`); el(`hdr-1 ${c0}`, 'hdr-color', `--gamut-hdr-1: ${c0}; --gamut-hdr-2: white`); same(`hdr-1 ${c}`, `hdr-1 ${c0}`);
  el(`hdr-2 ${c}`, 'hdr-color', `--gamut-hdr-1: white; --gamut-hdr-2: ${c}; --gamut-headroom: 1`); el(`hdr-2 ${c0}`, 'hdr-color', `--gamut-hdr-1: white; --gamut-hdr-2: ${c0}; --gamut-headroom: 1`); same(`hdr-2 ${c}`, `hdr-2 ${c0}`);
  el(`extract ${c}`, 'extract', c); el(`extract ${c0}`, 'extract', c0); same(`extract ${c}`, `extract ${c0}`);
  el(`fn okhsl-from ${c}`, null, null, `--gamut-okhsl-from(${c})`); same(`fn okhsl-from ${c}`, `okhsl-from ${c0}`, { chrome: true });
  el(`fn hdr-color ${c}`, null, null, `--gamut-hdr-color(${c}, 0, white, 1, 0)`); same(`fn hdr-color ${c}`, `hdr-1 ${c0}`, { chrome: true });
}
// 3. alpha 0 or none keeps the channels
for (const a of ['0', 'none']) {
  el(`okhsl-from alpha ${a}`, 'okhsl-from', okhslFrom(`rgb(255 51 102 / ${a})`)); same(`okhsl-from alpha ${a}`, 'okhsl-from opaque', { alpha: 0 });
  el(`hdr-color alpha ${a}`, 'hdr-color', `--gamut-hdr-1: rgb(255 51 102 / ${a}); --gamut-hdr-2: rgb(255 51 102 / ${a}); --gamut-headroom: 0.5`); same(`hdr-color alpha ${a}`, 'hdr-color opaque', { alpha: 0 });
}
el('okhsl-from opaque', 'okhsl-from', okhslFrom('rgb(255 51 102)'));
el('hdr-color opaque', 'hdr-color', '--gamut-hdr-1: rgb(255 51 102); --gamut-hdr-2: rgb(255 51 102); --gamut-headroom: 0.5');
// 4, 5. a hue as an angle; none as 0; a percentage as 0
const jz = (h) => `--gamut-jzczhz-jz: 0.1571; --gamut-jzczhz-cz: 0.0944; --gamut-jzczhz-hz: ${h}`;
const okhsl = (h, s = 0.9, l = 0.6) => `--gamut-okhsl-h: ${h}; --gamut-okhsl-s: ${s}; --gamut-okhsl-l: ${l}`;
const okhsv = (h, s = 0.9, v = 0.8) => `--gamut-okhsv-h: ${h}; --gamut-okhsv-s: ${s}; --gamut-okhsv-v: ${v}`;
const deg = (r) => +(r * 180 / Math.PI).toFixed(10);
for (const [part, f, args] of [['jzczhz', jz, (h) => `0.1571, 0.0944, ${h}`], ['okhsl', okhsl, (h) => `${h}, 0.9, 0.6`], ['okhsv', okhsv, (h) => `${h}, 0.9, 0.8`]]) {
  for (const [h, n] of [['69.57deg', 69.57], ['260deg', 260], ['4.538rad', deg(4.538)], ['0.25turn', 90], ['200grad', 180], ['none', 0]]) {
    el(`${part} h ${n}`, part, f(n)); el(`${part} h ${h}`, part, f(h)); same(`${part} h ${h}`, `${part} h ${n}`);
    if (h !== 'none') { el(`fn ${part} h ${h}`, null, null, `--gamut-${part}(${args(h)})`); same(`fn ${part} h ${h}`, `${part} h ${n}`, { chrome: true }); }
  }
}
for (const [part, f, args, pct] of [['okhsl', okhsl, (s, l) => `260, ${s}, ${l}`, [['90%', 0.6, 0, 0.6], [0.9, '60%', 0.9, 0]]], ['okhsv', okhsv, (s, v) => `260, ${s}, ${v}`, [['90%', 0.8, 0, 0.8], [0.9, '80%', 0.9, 0]]]])
  for (const [s, l, s0, l0] of pct) {
    el(`${part} ${s} ${l}`, part, f(260, s, l)); el(`${part} ${s0} ${l0}`, part, f(260, s0, l0)); same(`${part} ${s} ${l}`, `${part} ${s0} ${l0}`, { black: l0 === 0 });
    el(`fn ${part} ${s} ${l}`, null, null, `--gamut-${part}(${args(s, l)})`); same(`fn ${part} ${s} ${l}`, `${part} ${s0} ${l0}`, { chrome: true, black: l0 === 0 });
  }
// 6. .gamut-okhsl-from: none keeps the color's own
el('okhsl-from unset', 'okhsl-from', okhslFrom('#ff3366'));
for (const p of ['l', 's']) { el(`okhsl-from ${p} none`, 'okhsl-from', okhslFrom('#ff3366', ` --gamut-okhsl-${p}: none`)); same(`okhsl-from ${p} none`, 'okhsl-from unset'); }
// 7. .gamut-hdr-color: a negative channel, between the headrooms and at each end
const NEG = 'oklch(0.7 0.4 150)';
for (const h of [0, 0.5, 1]) { el(`hdr negative ${h}`, 'hdr-color', `--gamut-hdr-1: ${NEG}; --gamut-hdr-2: white; --gamut-headroom: ${h}`); cases.at(-1).want = { hdr: [NEG, 'white', h] }; }
// 8. defaults and inputs that aren't numbers
for (const h of [0, 2]) {
  el(`hdr only 1 at ${h}`, 'hdr-color', `--gamut-hdr-1: rgb(255 51 102); --gamut-headroom: ${h}`); same(`hdr only 1 at ${h}`, 'hdr-color opaque');
  el(`hdr only 2 at ${h}`, 'hdr-color', `--gamut-hdr-2: rgb(255 51 102); --gamut-headroom: ${h}`); same(`hdr only 2 at ${h}`, 'hdr-color opaque');
}
el('hdr headroom 50%', 'hdr-color', '--gamut-hdr-1: red; --gamut-hdr-2: blue; --gamut-headroom: 50%'); el('hdr headroom 0', 'hdr-color', '--gamut-hdr-1: red; --gamut-hdr-2: blue; --gamut-headroom: 0');
same('hdr headroom 50%', 'hdr headroom 0');
// 9. a channel `none` in the HDR spaces is 0 (CSS Color 4 §4.4: "a missing component behaves as a zero value ... This
// includes rendering the color directly, converting it to another color space"): the output equals the same part's
// with 0 in that channel, the function form too, to 1e-3 of each channel's size (a 0 in I or Jz is near black, where
// 1e-4 a channel would pass the initial black)
const HDR_NONE = [['rec2100-pq', 'rec2100', ['r', 'g', 'b'], [0.3, 0.5, 0.4]], ['rec2100-hlg', 'rec2100', ['r', 'g', 'b'], [0.3, 0.5, 0.4]],
  ['rec2100-linear', 'rec2100', ['r', 'g', 'b'], [0.3, 0.5, 0.4]], ['jzazbz', 'jzazbz', ['jz', 'az', 'bz'], [0.1571, 0.05, 0.08]],
  ['jzczhz', 'jzczhz', ['jz', 'cz', 'hz'], [0.1571, 0.0944, 69.57]], ['ictcp', 'ictcp', ['i', 'ct', 'cp'], [0.4, 0.05, 0.1]]];
for (const [part, pre, chs, vals] of HDR_NONE)
  for (let k = 0; k < 3; k++) {
    const style = (x) => chs.map((c, j) => `--gamut-${pre}-${c}: ${j === k ? x : vals[j]}`).join('; ');
    el(`${part} ${chs[k]} 0`, part, style(0)); el(`${part} ${chs[k]} none`, part, style('none')); same(`${part} ${chs[k]} none`, `${part} ${chs[k]} 0`, { tight: true });
    el(`fn ${part} ${chs[k]} none`, null, null, `--gamut-${part}(${vals.map((v, j) => (j === k ? 'none' : v)).join(', ')})`); same(`fn ${part} ${chs[k]} none`, `${part} ${chs[k]} 0`, { chrome: true, tight: true });
  }

const RD = ['x', 'y', 'z', 'alpha'];
const page = `<!doctype html><meta charset=utf-8><style>${css}
@property --r { syntax: '<color>'; inherits: false; initial-value: transparent; }
@property --own { syntax: '<color>'; inherits: false; initial-value: transparent; }
${RD.map((n) => `@property --rd-${n} { syntax: '<number>'; inherits: false; initial-value: -12345; }`).join('\n')}
.gamut-color-extract-read { ${RD.map((n) => `--rd-${n}: var(--gamut-${n});`).join(' ')} }</style><body>
${cases.map((c, i) => (c.cls === 'extract' ? `<div class="gamut-color-extract" style="--gamut-in: ${c.style}"><i id=c${i} class="gamut-color-extract-read"></i></div>`
    : c.fn ? `<i id=c${i} style="--r: ${c.fn}"></i>` : `<i id=c${i} class="${gamut(c.cls)}" style="${c.style}"></i>`)).join('\n')}
${[NEG, 'white'].map((c, i) => `<b id=own${i} style="--own: color(from ${c} xyz-d65 x y z / alpha)"></b>`).join('')}`;
const xyzOf = (s) => { if (!s) return null; try { const c = new Color(s); return [...c.to('xyz-d65').coords.map((v) => (Number.isNaN(v) ? 0 : v)), c.alpha ?? 1]; } catch { return null; } };
const off = (a, b) => (a && b ? Math.max(...[0, 1, 2].map((k) => Math.abs(a[k] - b[k]) / Math.max(1, Math.abs(b[k])))) : Infinity);
const show = (v) => (v ? `${v.slice(0, 3).map((x) => +x.toFixed(6)).join(' ')} / ${+(+v[3]).toFixed(4)}` : 'invalid');
// §5.1 over the engine's own xyz-d65: per channel pow(a + eps, 1 - w) pow(b + eps, w) - eps in cd/m², eps 0.001 plus
// the most negative of the two (SPEC.md H3)
const hdr = (a, b, w) => [0, 1, 2].map((k) => { const e = 0.001 + Math.max(0, -203 * Math.min(a[k], b[k]));
  return ((a[k] * 203 + e) ** (1 - w) * (b[k] * 203 + e) ** w - e) / 203; }).concat(1);
let failed = false;
for (const e of pick(['Chrome', 'WebKit', 'Firefox'])) {
  const { page: p, close } = await open(e);
  await p.setContent(page, { timeout: 120000 });
  const got = await p.evaluate((n) => Array.from({ length: n }, (_, i) => { const s = getComputedStyle(document.getElementById(`c${i}`));
    return { out: s.getPropertyValue('--gamut-out').trim(), r: s.getPropertyValue('--r').trim(), rd: ['x', 'y', 'z', 'alpha'].map((k) => +s.getPropertyValue(`--rd-${k}`)) }; }), cases.length);
  const own = await p.evaluate(() => [0, 1].map((i) => getComputedStyle(document.getElementById(`own${i}`)).getPropertyValue('--own').trim()));
  await close();
  const val = (i) => (cases[i].cls === 'extract' ? (got[i].rd.includes(-12345) ? null : got[i].rd) : xyzOf(cases[i].fn ? got[i].r : got[i].out));
  const bad = []; let n = 0;
  cases.forEach((c, i) => {
    if (!c.want || (c.want.chrome && e[0] !== 'Chrome') || (c.fn && e[0] !== 'Chrome')) return;
    n++;
    const g = val(i); let want;
    if (c.want.ref) { want = val(cases.findIndex((x) => x.id === c.want.ref)); if (want && c.want.alpha !== undefined) want = [...want.slice(0, 3), c.want.alpha]; }
    else if (c.want.v) want = c.want.v;
    else { const [a, b] = own.map(xyzOf), [, , h] = c.want.hdr; want = hdr(a, b, Math.min(1, Math.max(0, h))); }
    // a control that came out black opaque, the output's initial value, was invalid: it proves nothing (an HDR one,
    // transparent black too: its first step's initial value)
    // (at any alpha: a transparent black is an initial value too, a review, 2026-10-30)
    const dead = c.want.ref && !c.want.black && want && want.slice(0, 3).every((v) => v === 0);
    const ok = !dead && g && want && g.slice(0, 3).every(Number.isFinite) && (c.want.tight ? [0, 1, 2].every((k) => Math.abs(g[k] - want[k]) <= 1e-3 * Math.max(Math.abs(want[k]), 1e-6)) : off(g, want) <= 1e-4) && Math.abs(g[3] - want[3]) <= 1 / 255;
    if (!ok) bad.push(`${c.id}: ${show(g)}${g ? '' : ` (${c.fn ? got[i].r : got[i].out})`}, want ${show(want)}${dead ? ` (its control ${c.want.ref} gave the initial black)` : ''}`);
  });
  console.log(`${e[0]}: ${n - bad.length} of ${n} cases${bad.length ? '' : ' pass'}`);
  for (const b of bad) console.log(`  FAIL ${b}`);
  failed ||= bad.length > 0;
}
process.exit(failed ? 1 : 0);
