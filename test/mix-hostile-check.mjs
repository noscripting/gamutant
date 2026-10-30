// Checks the mix group (.gamut-color-mix, .gamut-color-interpolate, .gamut-alpha, .gamut-device-cmyk and their functions) on hostile inputs, in
// Chrome, WebKit and Firefox (the functions in Chrome, where @function parses): each case one element, its output
// against an expected color with its source, either the spec's value or, where SPEC.md "Not covered" says
// what the part gives instead, that documented value. The cases are a fuzz's findings (2026-10-27):
//   cmyk: components outside 0 to 1 clamp at computed-value time, percentages as numbers (css-color-5 §6, §6.1)
//   mix: a share that is neither a number nor a percentage (none, 40px), or one outside 0 to 100, makes it invalid, the
//        parent's; 40% is 40 where calc() divides a percentage by 1% (Chrome 155, WebKit 26.4), invalid in Firefox 158
//        (css-color-5 §3.2: "Percentages are required to be in the range 0% to 100%", the grammar's
//        <percentage [0,100]>); the function's `none` is an omitted one
//   docs: what SPEC.md says a percentage t or position, an unparsed space, a color brighter than white, and .gamut-alpha
//        past lightness 1 in WebKit give
//   interpolate: a stop within the count without a position makes it invalid (css-values-5 §7.5's grammar), the parent's
// Usage: node test/mix-hostile-check.mjs   (ENGINES= narrows; SHEET= another sheet)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pick, open } from './engines.mjs';
import { gamut } from './ref/classes.mjs';
const cjs = createRequire(import.meta.url)('colorjs.io'), Color = cjs.default ?? cjs;
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');

const cmyk = (c, m, y, k, a) => `--gamut-cmyk-c: ${c}; --gamut-cmyk-m: ${m}; --gamut-cmyk-y: ${y}; --gamut-cmyk-k: ${k};${a === undefined ? '' : ` --gamut-cmyk-alpha: ${a}`}`;
// css-color-5 §6: "clamped to 0/0% or 1/100% at computed-value time"; §6.1: red = 1 - min(1, c * (1 - k) + k)
const num = (v) => (typeof v === 'string' && v.endsWith('%') ? parseFloat(v) / 100 : +v), cl = (v) => Math.min(1, Math.max(0, num(v)));
const naive = (c, m, y, k, a = 1) => `color(srgb ${[c, m, y].map((v) => 1 - Math.min(1, cl(v) * (1 - cl(k)) + cl(k))).join(' ')} / ${cl(a)})`;
const mix3 = (pct) => `--gamut-mix-count: 3; --gamut-mix-1: red; --gamut-mix-2: blue; --gamut-mix-3: lime; --gamut-mix-pct-1: 20;${pct === undefined ? '' : ` --gamut-mix-pct-2: ${pct};`}`;
// red 20, blue and lime omitted, sharing the 80 left: §3.3's stack, red and blue at 20 : 40, then lime at 40 of 100
const MIX3 = 'color-mix(in oklab, color-mix(in oklab, red 33.333333%, blue 66.666667%) 60%, lime 40%)';
const A = 'oklch(0.7 0.2 30)', B = 'oklch(0.5 0.2 250)', mix2 = (p1, p2) => `--gamut-mix-1: ${A}; --gamut-mix-2: ${B}; --gamut-mix-pct-1: ${p1};${p2 === undefined ? '' : ` --gamut-mix-pct-2: ${p2};`}`;
// a color brighter than white mixed in oklab: its lightness taken as 1 (SPEC.md, Not covered)
const HDR = 'color(xyz-d65 1.9 2 2.2)';
const clampL = (s) => { const c = new Color(s).to('oklab'); c.coords[0] = Math.min(1, c.coords[0]); return c; };
const hdrMix = (raw) => { const a = raw ? new Color(HDR).to('oklab') : clampL(HDR), b = new Color('#222').to('oklab'); return `oklab(${a.coords.map((v, i) => (v + b.coords[i]) / 2).join(' ')})`; };
// .gamut-alpha in WebKit: the color through oklch(from … l c h), its lightness clamped to 0 to 1 (SPEC.md, Not covered)
const alphaWebKit = (s, a) => { const c = clampL(s).to('srgb'); return `color(srgb ${c.coords.join(' ')} / ${a})`; };

const CASES = [
  // device-cmyk: clamped (fixed)
  ['cmyk c -0.5', 'device-cmyk', cmyk(-0.5, 0, 0, 0), naive(-0.5, 0, 0, 0)],
  ['cmyk k -0.5', 'device-cmyk', cmyk(0, 0, 0, -0.5), naive(0, 0, 0, -0.5)],
  ['cmyk c 1.5, k 0.2', 'device-cmyk', cmyk(1.5, 0.3, 0, 0.2), naive(1.5, 0.3, 0, 0.2)],
  ['cmyk k 1.5', 'device-cmyk', cmyk(0.2, 0.4, 0.6, 1.5), naive(0.2, 0.4, 0.6, 1.5)],
  ['cmyk percentages', 'device-cmyk', cmyk('0%', '50%', '100%', '0%'), naive('0%', '50%', '100%', '0%')],
  ['cmyk percentages and numbers', 'device-cmyk', cmyk('20%', 0.5, '75%', '10%', '50%'), naive('20%', 0.5, '75%', '10%', '50%')],
  ['cmyk in range', 'device-cmyk', cmyk(0.1, 0.25, 0.9, 0.3, 0.8), naive(0.1, 0.25, 0.9, 0.3, 0.8)],
  ['fn cmyk c -0.5', null, '', naive(-0.5, 0, 0, 0), '--gamut-device-cmyk(-0.5, 0, 0, 0)'],
  ['fn cmyk k 1.5', null, '', naive(0.2, 0.4, 0.6, 1.5), '--gamut-device-cmyk(0.2, 0.4, 0.6, 1.5)'],
  ['fn cmyk percentages', null, '', naive('0%', '50%', '100%', '0%'), '--gamut-device-cmyk(0%, 50%, 100%, 0%)'],
  // color-mix: a percentage that isn't a number, or outside 0 to 100, makes it invalid (css-color-5 §3.2): the parent's
  ['mix pct-2 unset', 'color-mix', mix3(), MIX3],
  ['mix pct-2 none (invalid)', 'color-mix', mix3('none'), 'teal', null, '--gamut-out: teal'],
  ['mix pct-2 40% (40; Firefox: invalid)', 'color-mix', mix3('40%'), { Firefox: 'teal', else: MIX3 }, null, '--gamut-out: teal'],
  ['mix pct-2 calc(30% + 10%)', 'color-mix', mix3('calc(30% + 10%)'), { Firefox: 'teal', else: MIX3 }, null, '--gamut-out: teal'],
  ['mix pct-2 140% (invalid)', 'color-mix', mix3('140%'), 'teal', null, '--gamut-out: teal'],
  ['mix pct-2 40px (invalid)', 'color-mix', mix3('40px'), 'teal', null, '--gamut-out: teal'],
  ['mix 150 and 50 (invalid)', 'color-mix', mix2(150, 50), 'teal', null, '--gamut-out: teal'],
  ['mix -10 (invalid)', 'color-mix', mix2(-10), 'teal', null, '--gamut-out: teal'],
  ['mix -0.3 (invalid)', 'color-mix', mix2(-0.3), 'teal', null, '--gamut-out: teal'],
  ['mix 100.001 (invalid)', 'color-mix', mix2(100.001), 'teal', null, '--gamut-out: teal'],
  ['mix 0 and 100', 'color-mix', mix2(0, 100), `color-mix(in oklab, ${A} 0%, ${B} 100%)`],
  ['mix 100 and 0', 'color-mix', mix2(100, 0), `color-mix(in oklab, ${A} 100%, ${B} 0%)`],
  ['mix pct-4 none past the count', 'color-mix', `${mix3()} --gamut-mix-pct-4: none; --gamut-mix-pct-5: 150;`, MIX3],
  // a slot left unset takes no part: transparent at 0% filled a component both colors leave missing (a review,
  // 2026-10-28); the output keeps the none. Documented (SPEC.md's Not covered): a color set past the count fills it, as a
  // 0% color in color-mix() does
  ['mix red past the count fills a missing red (documented)', 'color-mix', '--gamut-mix-space: srgb; --gamut-mix-1: color(srgb none .2 .3); --gamut-mix-2: color(srgb none .4 .5); --gamut-mix-3: red', 'color-mix(in srgb, color(srgb none .2 .3), color(srgb none .4 .5)) 100%, red 0%)'.replace(/^/, 'color-mix(in srgb, ')],
  // a transparent first color keeps its channels for the next color's missing ones (a review, 2026-10-28:
  // converted alone first, it gave red 0 for 1)
  ['mix a transparent first color fills a missing red', 'color-mix', '--gamut-mix-space: srgb; --gamut-mix-1: color(srgb 1 0 0 / 0); --gamut-mix-2: color(srgb none 1 0)', 'color(srgb 1 1 0 / 0.5)'],
  ['mix unset slots keep a missing red', 'color-mix', '--gamut-mix-space: srgb; --gamut-mix-1: color(srgb none .2 .3); --gamut-mix-2: color(srgb none .4 .5)', 'color(srgb none .3 .4)'],
  ['mix unset slots keep a missing lightness, oklab', 'color-mix', '--gamut-mix-1: oklab(none 0.1 0.05); --gamut-mix-2: oklab(none -0.1 0.05)', 'oklab(none 0 0.05)'],
  ['mix unset slots keep a missing hue, oklch', 'color-mix', '--gamut-mix-space: oklch; --gamut-mix-count: 3; --gamut-mix-1: oklch(0.5 0.1 none); --gamut-mix-2: oklch(0.7 0.1 none); --gamut-mix-3: oklch(0.6 0.1 none)', 'oklch(0.6 0.1 none)'],
  // documented (SPEC.md's Not covered): a single color of alpha 0 comes out with its channels 0, as color-mix() of it
  // with itself gives (premultiplied)
  ['mix one color of alpha 0 (its channels 0)', 'color-mix', '--gamut-mix-count: 1; --gamut-mix-space: srgb; --gamut-mix-1: color(srgb 1 0 0 / 0)', 'color(srgb 0 0 0 / 0)'],
  ['mix paint 150 (invalid)', 'color-mix mix-paint', mix2(150, 50), 'teal', null, '--gamut-out: teal'],
  ['fn mix 40%', null, '', MIX3, '--gamut-color-mix(oklab, red, 20, blue, 40%, lime)', 'color: teal'],
  ['fn mix 150 and 50 (invalid)', null, '', 'teal', `--gamut-color-mix(oklab, ${A}, 150, ${B}, 50)`, 'color: teal'],
  ['fn mix none omitted', null, '', MIX3, '--gamut-color-mix(oklab, red, 20, blue, none, lime)'],
  // documented: what SPEC.md says these give (Not covered, I5)
  ['interpolate t 40% (transparent)', 'color-interpolate', '--gamut-stop-1: red; --gamut-stop-2: blue; --gamut-at-1: 0; --gamut-at-2: 1; --gamut-t: 40%', 'transparent'],
  ['interpolate at-2 100% (transparent)', 'color-interpolate', '--gamut-stop-1: red; --gamut-stop-2: blue; --gamut-at-1: 0; --gamut-at-2: 100%; --gamut-t: 0.4', 'transparent'],
  ['interpolate space foo (invalid: the parent\'s)', 'color-interpolate', '--gamut-stop-1: red; --gamut-stop-2: blue; --gamut-at-1: 0; --gamut-at-2: 1; --gamut-t: 0.4; --gamut-space: foo', 'teal', null, '--gamut-out: teal'],
  // documented (SPEC.md's Not covered): a component both colors of the segment leave missing is filled from another stop (a clean
  // room's audit, 2026-10-28): from the next, else from the one before
  ['interpolate a red both stops miss, from the next (documented)', 'color-interpolate', '--gamut-stops: 3; --gamut-stop-1: color(srgb none .2 .3); --gamut-at-1: 0; --gamut-stop-2: color(srgb none .4 .5); --gamut-at-2: .5; --gamut-stop-3: red; --gamut-at-3: 1; --gamut-t: .25; --gamut-space: srgb', 'color(srgb 1 .3 .4)'],
  ['interpolate a red both stops miss, from the one before (documented)', 'color-interpolate', '--gamut-stops: 3; --gamut-stop-1: red; --gamut-at-1: 0; --gamut-stop-2: color(srgb none .4 .5); --gamut-at-2: .5; --gamut-stop-3: color(srgb none 0 0); --gamut-at-3: 1; --gamut-t: .75; --gamut-space: srgb', 'color(srgb 1 .2 .25)'],
  ['interpolate t 0.4', 'color-interpolate', '--gamut-stop-1: red; --gamut-stop-2: blue; --gamut-at-1: 0; --gamut-at-2: 1; --gamut-t: 0.4', 'color-mix(in oklab, red, blue 40%)'],
  // css-values-5 §7.5: every stop has a position, so a stop within the count without one makes it invalid: the parent's
  ['interpolate no positions (invalid: the parent\'s)', 'color-interpolate', '--gamut-stop-1: red; --gamut-stop-2: blue; --gamut-t: 0.4', 'teal', null, '--gamut-out: teal'],
  ['interpolate at-2 unset (invalid: the parent\'s)', 'color-interpolate', '--gamut-stops: 3; --gamut-stop-1: red; --gamut-stop-2: blue; --gamut-stop-3: lime; --gamut-at-1: 0; --gamut-at-3: 1; --gamut-t: 0.4', 'teal', null, '--gamut-out: teal'],
  ['interpolate at-3 unset past the count', 'color-interpolate', '--gamut-stops: 2; --gamut-stop-1: red; --gamut-stop-2: blue; --gamut-stop-3: lime; --gamut-at-1: 0; --gamut-at-2: 1; --gamut-t: 0.4', 'color-mix(in oklab, red, blue 40%)'],
  ['mix space "oklch longer" (inherited: the initial, transparent)', 'color-mix', '--gamut-mix-space: oklch longer; --gamut-mix-1: red; --gamut-mix-2: blue', 'transparent'],
  ['mix space "oklch longer" (inherited: the parent\'s)', 'color-mix', '--gamut-mix-space: oklch longer; --gamut-mix-1: red; --gamut-mix-2: blue', 'teal', null, '--gamut-out: teal'],
  // (as the engine's own color-mix() takes it: Chrome 155 keeps the lightness past 1, WebKit 26.4 and Firefox 158 take 1)
  ['mix brighter than white, oklab (as the engine\'s own)', 'color-mix', `--gamut-mix-1: ${HDR}; --gamut-mix-2: #222`, { Chrome: hdrMix(true), else: hdrMix() }],
  ['interpolate brighter than white, oklab (lightness 1)', 'color-interpolate', `--gamut-stop-1: ${HDR}; --gamut-stop-2: #222; --gamut-at-1: 0; --gamut-at-2: 1; --gamut-t: 0.5`, hdrMix()],
  ['alpha srgb-linear 4 2 1', 'alpha', '--gamut-in: color(srgb-linear 4 2 1); --gamut-alpha-value: 0.5', { WebKit: alphaWebKit('color(srgb-linear 4 2 1)', 0.5), else: 'color(from color(srgb-linear 4 2 1) srgb r g b / 0.5)' }],
  ['alpha srgb 3 3 3', 'alpha', '--gamut-in: color(srgb 3 3 3); --gamut-alpha-value: 0.5', { WebKit: alphaWebKit('color(srgb 3 3 3)', 0.5), else: 'color(srgb 3 3 3 / 0.5)' }],
];

const TOL = 2e-4; // a channel or alpha, in sRGB: the engines keep channels as 32-bit floats and write 6 digits
const read = (s) => { const c = new Color(s.trim()).to('srgb'); return [...c.coords.map((v) => (v == null || Number.isNaN(v) ? 0 : v)), c.alpha ?? 0]; };
let failed = false;
for (const e of pick(['Chrome', 'WebKit', 'Firefox'])) {
  const { page, close } = await open(e);
  await page.setContent(`<!doctype html><style>${css}</style>`);
  const fn = await page.evaluate(() => [...document.styleSheets[0].cssRules].some(function has(x) { return x.constructor.name === 'CSSFunctionRule' || [...(x.cssRules ?? [])].some(has); }));
  const mine = CASES.filter((c) => !c[4] || fn);
  const html = mine.map(([, cls, style, , call, parent], i) => {
    const el = call ? `<b data-i=${i} style="color: red; color: ${call}"></b>` : `<b data-i=${i} class="${gamut(cls)}" style="${style}"></b>`;
    return parent ? `<div style="${parent}">${el}</div>` : el;
  }).join('');
  await page.setContent(`<!doctype html><style>${css}</style><body>${html}<i id=ref></i></body>`);
  const want = mine.map(([, , , w]) => (typeof w === 'string' ? w : w[e[0]] ?? w.else));
  const [got, ref] = await page.evaluate(({ calls, want }) => {
    const r = document.getElementById('ref'), cs = (x) => getComputedStyle(x);
    const got = [...document.querySelectorAll('b')].map((b, i) => (calls[i] ? cs(b).color : cs(b).getPropertyValue('--gamut-out')));
    // (cleared first: a value that doesn't parse leaves it empty, not the last one set)
    const ref = want.map((w) => { r.style.color = ''; r.style.color = w; return r.style.color ? cs(r).color : `unparsed ${w}`; });
    return [got, ref];
  }, { calls: mine.map((c) => !!c[4]), want });
  const bad = [];
  mine.forEach(([name], i) => {
    let g, w; try { g = read(got[i]); w = read(ref[i]); } catch { bad.push(`${name}: ${got[i]} against ${ref[i]}, unreadable`); return; }
    const d = Math.max(...g.map((v, k) => Math.abs(v - w[k]))), nones = (x) => (x.match(/\bnone\b/g) ?? []).length;
    if (!(d <= TOL)) bad.push(`${name}: ${got[i].trim()}, expected ${ref[i]} (off ${d.toExponential(1)})`);
    else if (nones(got[i]) !== nones(ref[i])) bad.push(`${name}: ${got[i].trim()}, expected ${ref[i]} (its missing components)`);
  });
  failed ||= bad.length > 0;
  console.log(`${e[0]}: ${mine.length - bad.length} of ${mine.length} cases${fn ? '' : ' (no @function: the functions skipped)'}${bad.length ? `\n  FAIL ${bad.join('\n  FAIL ')}` : ''}`);
  await close();
}
process.exit(failed ? 1 : 0);
