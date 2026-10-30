// Checks the mapping parts (.gamut-fit-screen with both methods, .gamut-screen-edge, .gamut-palette-step, .gamut-fit-gradient, and their
// functions where @function parses) on hostile inputs a fuzz found (2026-10-27), each its minimal case, in Chrome, WebKit
// and Firefox, to an sRGB target unless named:
// - .gamut-fit-screen, --gamut-method: adaptive, an input built from currentColor (SPEC G16, G17);
// - .gamut-fit-gradient with longer hue and an end whose hue is missing or powerless (none, transparent, white, Canvas) (S2);
// - .gamut-palette-step from a grey seed (CAM16 gives a grey a hue and chroma; black has none: Material's grey) (P6);
// - a `none` hue in lch() and carried in from a mix, in .gamut-fit-screen, .gamut-screen-edge and .gamut-palette-step (G1, R1, P6);
// - --gamut-gradient-hue written as color-mix() writes it (`longer hue`, any case), or invalid (shorter) (S1);
// - chroma 4.5 to 1e9 in .gamut-fit-screen, both methods (G6, G17);
// - --gamut-rel: 50% (a percentage, not a number: acts as 1) (R1);
// - --gamut-step on a step and on a list, past 1; --gamut-tone on a list, past 100 (P6, P8).
// References, in Color.js 0.7.1: toGamut({ method: 'css' }) (G6); Ottosson's gamut_clip_adaptive_L0_L_cusp, alpha 0.05,
// as test/adaptive-check.mjs computes it (G17); the edge bisected in doubles (R1); P1's curves; range() in oklch with
// the hue method, premultiplied, then the css method (S2); Material's tonal palette, test/ref/hct.mjs (P6). Each input is read back as the engine resolves it (a child's
// color: var(--gamut-in)). Within 2/255 a channel (fit, gradient), 1.5/255 (edge, palette steps). Exit 1 on a fail.
// Usage: node test/mapping-hostile-check.mjs   (SHEET= another sheet, ENGINES= some engines)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pick, open } from './engines.mjs';
import { hctOf, tone } from './ref/hct.mjs';
import { toLch, boundary } from './ref/methods.mjs';
const C0 = createRequire(import.meta.url)('colorjs.io'), Color = C0.default ?? C0;
const sheet = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const TARGETS = { srgb: ['srgb-linear', 'srgb'], 'a98-rgb': ['a98rgb-linear', 'a98rgb'] };
const parse = (s) => { try { return new Color(s); } catch { return null; } };
const num = (v) => (v == null || Number.isNaN(+v) ? 0 : +v);
const chans = (c, t) => { const x = c.to(TARGETS[t][1]); return [...x.coords, x.alpha].map(num); };
const dist = (a, b) => Math.max(...a.map((v, k) => Math.abs(v - b[k]))) * 255;
const cssFit = (c, t) => chans(c.clone().toGamut({ space: TARGETS[t][1], method: 'css' }), t);
// adaptive, as test/adaptive-check.mjs
const lin = (L, a, b, t) => new Color('oklab', [L, a, b]).to(TARGETS[t][0]).coords;
const inside = (L, a, b, t, eps = 1e-7) => lin(L, a, b, t).every((v) => v >= -eps && v <= 1 + eps);
const maxC = (L, a_, b_, t, hi0 = 1.5) => { let lo = 0, hi = hi0; for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; inside(L, m * a_, m * b_, t) ? (lo = m) : (hi = m); } return lo; };
function cusp(a_, b_, t) {
  let best = [0, 0]; for (let L = 0.01; L < 1; L += 0.01) { const c = maxC(L, a_, b_, t); if (c > best[1]) best = [L, c]; }
  let lo = Math.max(0, best[0] - 0.01), hi = Math.min(1, best[0] + 0.01);
  for (let k = 0; k < 60; k++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; maxC(m1, a_, b_, t) < maxC(m2, a_, b_, t) ? (lo = m1) : (hi = m2); }
  return [(lo + hi) / 2];
}
function adaptFit(col, t) {
  const sp = TARGETS[t][1], alpha = num(col.alpha), [L, a, b] = col.to('oklab').coords.map(num), w = (c) => [...c, alpha];
  if (L >= 1) return w(new Color('white').to(sp).coords);
  if (L <= 0) return w(new Color('black').to(sp).coords);
  if (inside(L, a, b, t, 0)) return chans(col, t);
  const C = Math.max(1e-5, Math.hypot(a, b)), a_ = a / C, b_ = b / C, [Lc] = cusp(a_, b_, t);
  const Ld = L - Lc, k = 2 * (Ld > 0 ? 1 - Lc : Lc), e1 = 0.5 * k + Math.abs(Ld) + 0.05 * C / k;
  const L0 = Lc + 0.5 * Math.sign(Ld) * (e1 - Math.sqrt(e1 * e1 - 2 * k * Math.abs(Ld)));
  let lo = 0, hi = 1; for (let n = 0; n < 60; n++) { const m = (lo + hi) / 2, Lm = L0 * (1 - m) + m * L; inside(Lm, m * C * a_, m * C * b_, t) ? (lo = m) : (hi = m); }
  return w(new Color('oklab', [L0 * (1 - lo) + lo * L, lo * C * a_, lo * C * b_]).to(sp).coords);
}
// a color's oklch, a none hue as 0; the OkLCh color at (L, C, H) in t's channels
const lch = (c) => { const x = c.to('oklch'); return [num(x.coords[0]), num(x.coords[1]), num(x.coords[2]), num(c.alpha)]; };
const rgbOf = (L, C, H, a, t) => [...new Color('oklch', [L, C, H]).to(TARGETS[t][1]).coords, a];
// the edge, bisected in doubles (ref/methods.mjs, sRGB)
const edge = (L, h) => (L >= 1 || L <= 0 ? 0 : toLch('srgb', boundary('srgb', [L, 1, h]))[1]);
// a step of Material's palette from the seed as the engine resolved it (a none channel as 0), at tone T, in sRGB
const stepWant = (ref, T, rel) => { const h = hctOf(ref.to('srgb-linear').coords.map(num)); return [...tone(h.hue, h.chroma * rel, T).map((v) => v / 255), 1]; };
const colorsIn = (text) => { const out = [], re = /\b(rgba?|oklch|oklab|lab|lch|color)\(/g; let m;
  while ((m = re.exec(text))) { let d = 0, j = m.index + m[0].length - 1;
    for (; j < text.length; j++) { if (text[j] === '(') d++; else if (text[j] === ')' && --d === 0) break; }
    out.push(text.slice(m.index, j + 1)); re.lastIndex = j + 1; }
  return out; };

// the cases: html (one element with data-i), how to read it, and the expected values from the inputs as resolved
const ctx = 'color: oklch(0.7 0.35 150); color-scheme: light;';
const ref = (p = '--gamut-in') => `<b style="color: var(${p})"></b>`;
const cases = [];
// known: an engine's documented result in place of the reference (SPEC.md's Not covered)
const fit = (what, inp, { m = 'css', t = 'srgb', fn = false, known } = {}) => cases.push({ what: `${what}: ${fn ? '--gamut-fit-screen()' : '.gamut-fit-screen'} ${m} ${t} ${inp}`, fn, kind: 'one', tol: 2, known,
  html: (i) => `<div style="--gamut-target: ${t}; --gamut-method: ${m}"><div ${fn ? '' : 'class="gamut-fit-screen"'} data-i="${i}" style="${ctx} --gamut-in: ${inp}; background-color: ${fn ? `red; background-color: --gamut-fit-screen(var(--gamut-in), ${t}, ${m})` : 'var(--gamut-out)'}">${ref()}</div></div>`,
  want: ([r]) => [m === 'adaptive' ? adaptFit(r, t) : cssFit(r, t)], t });
const edgeCase = (what, inp, rel, relNum = +rel, fn = false) => cases.push({ what: `${what}: ${fn ? '--gamut-screen-edge()' : '.gamut-screen-edge'} ${inp} rel ${rel}`, fn, kind: 'one', tol: 1.5, t: 'srgb',
  html: (i) => `<div style="--gamut-target: srgb"><div ${fn ? '' : 'class="gamut-screen-edge"'} data-i="${i}" style="${ctx} --gamut-in: ${inp}; --gamut-rel: ${rel}; background-color: ${fn ? 'red; background-color: --gamut-screen-edge(var(--gamut-in), var(--gamut-rel), srgb)' : 'var(--gamut-out)'}">${ref()}</div></div>`,
  want: ([r]) => { const [L, , H, A] = lch(r); return [rgbOf(L, Math.max(0, relNum * edge(L, H)), H, A, 'srgb')]; } }); // #11946: rel x the edge, the input's chroma aside
// a palette of n steps; step: --gamut-step on each step (each), or on the list (list); ts: the steps' t
// tone: --gamut-tone on the list (and the function's fourth argument); ts: the steps' t, or tones: the steps' tones
const palette = (what, inp, n, { step, on = 'each', rel, fn = false, ts, tone: T, tones } = {}) => cases.push({ what: `${what}: ${fn ? '--gamut-palette-step()' : '.gamut-palette-step'} ${inp} ${n} steps${step !== undefined ? ` --gamut-step ${step} on ${on}` : ''}${T !== undefined ? ` --gamut-tone ${T}` : ''}${rel ? ` rel ${rel}` : ''}`, fn, kind: 'steps', tol: 1.5, t: 'srgb',
  html: (i) => `<div data-i="${i}" style="${ctx} --gamut-target: srgb; --gamut-in: ${inp};${rel ? ` --gamut-chroma-scale: ${rel};` : ''}">${ref()}<ul style="${on === 'list' && step !== undefined ? `--gamut-step: ${step};` : ''}${T !== undefined ? ` --gamut-tone: ${T}` : ''}">${`<li ${fn ? '' : 'class="gamut-palette-step"'} style="${on === 'each' && step !== undefined ? `--gamut-step: ${step};` : ''} background-color: ${fn ? `red; background-color: --gamut-palette-step(var(--gamut-in), ${rel ?? 1}${step !== undefined || T !== undefined ? `, ${step ?? 'none'}` : ''}${T !== undefined ? `, ${T}` : ''})` : 'var(--gamut-out)'}"></li>`.repeat(n)}</ul></div>`,
  want: ([r]) => Array.from({ length: n }, (_, k) => stepWant(r, tones ? tones[k] : 95 - 85 * (ts ? ts[k] : n === 1 ? 0 : k / (n - 1)), 1)) });
const gradient = (what, a, b, h, { fn = false, as = h } = {}) => cases.push({ what: `${what}: ${fn ? '--gamut-fit-gradient()' : '.gamut-fit-gradient'} ${a} to ${b}, hue ${h}`, fn, kind: 'stops', tol: 2, t: 'srgb',
  html: (i) => `<div style="--gamut-target: srgb"><div ${fn ? '' : 'class="gamut-fit-gradient"'} data-i="${i}" style="${ctx} --gamut-gradient-from: ${a}; --gamut-gradient-to: ${b}; --gamut-gradient-hue: ${h}; background-image: ${fn ? 'linear-gradient(red, blue); background-image: linear-gradient(to right, --gamut-fit-gradient(var(--gamut-gradient-from), var(--gamut-gradient-to), var(--gamut-gradient-hue)))' : 'linear-gradient(to right, var(--gamut-gradient-stops))'}">${ref('--gamut-gradient-from')}${ref('--gamut-gradient-to')}</div></div>`,
  want: ([ra, rb]) => { const g = ra.range(rb, { space: 'oklch', hue: as, premultiplied: true }); return Array.from({ length: 9 }, (_, k) => cssFit(g(k / 8), 'srgb')); } });

// 1. adaptive and currentColor (the probe's finding 1). WebKit 26.4 gives the registered initial, black (SPEC.md's Not
// covered: the chain, carried as text, is past what WebKit substitutes)
const BLACK = { WebKit: (g) => /^color\(srgb-linear 0 0 0( \/ [\d.]+)?\)$|^rgba?\(0, 0, 0[,)]/.test(g) };
for (const inp of ['currentColor', 'oklch(from currentColor 95% c h)', 'color-mix(in srgb, currentColor, transparent)']) fit('currentColor, adaptive', inp, { m: 'adaptive', known: BLACK });
fit('currentColor, adaptive', 'currentColor', { m: 'adaptive', fn: true });
// 2. longer hue from a missing or powerless hue
for (const [a, b] of [['oklch(0.7 0.3 none)', 'oklch(0.6 0.3 250)'], ['transparent', 'oklch(0.7 0.4 140)'], ['oklch(0.7 0.4 140)', 'transparent'], ['white', 'oklch(0.6 0.4 300)'], ['Canvas', 'oklch(0.6 0.4 300)'], ['oklch(0.7 0.3 10)', 'oklch(0.7 0.3 10)']])
  gradient('longer hue, missing or powerless', a, b, 'longer');
// 3. a grey seed's palette
for (const s of ['grey', 'white', 'rgb(128 128 128)', 'oklch(0.5 0 165)', 'oklch(0.6 0.001 200)']) palette('grey seed', s, 5);
palette('grey seed', 'grey', 5, { fn: true });
// 4. a none hue in lch(), and carried in from a mix
const NONE = ['lch(50 200 none)', 'color-mix(in lch, lch(50 200 none), lch(50 100 none))', 'oklch(0.7 0.3 none)', 'hsl(none 100% 50%)'];
for (const inp of NONE) { fit('none hue', inp); edgeCase('none hue', inp, '1'); edgeCase('none hue', inp, '0.5'); }
fit('none hue', 'lch(50 200 none)', { m: 'adaptive' });
palette('none hue', 'lch(50 200 none)', 5);
// 5. --gamut-gradient-hue as color-mix() writes it; invalid is shorter
for (const [h, as] of [['longer hue', 'longer'], ['LONGER', 'longer'], ['Longer Hue', 'longer'], ['shorter hue', 'shorter'], ['increasing hue', 'increasing'], ['decreasing hue', 'decreasing'], ['sideways', 'shorter'], ['longer longer', 'shorter']])
  gradient('hue keyword', 'oklch(0.7 0.15 30)', 'oklch(0.7 0.15 120)', h, { as });
gradient('hue keyword', 'oklch(0.7 0.15 30)', 'oklch(0.7 0.15 120)', 'longer hue', { as: 'longer', fn: true });
// 6. very large chroma
for (const c of ['4.5', '50', '1000', '1e6', '1e9']) fit('large chroma', `oklch(0.7 ${c} 30)`);
for (const c of ['1000', '1e9']) fit('large chroma', `oklch(0.7 ${c} 30)`, { m: 'adaptive' });
// adaptive to a98-rgb is covered to chroma 4 (SPEC.md's Not covered)
fit('large chroma', 'oklch(0.7 4 30)', { m: 'adaptive', t: 'a98-rgb' });
fit('large chroma', 'oklch(0.7 1e9 30)', { fn: true });
// 7. --gamut-rel and --gamut-chroma-scale: a percentage acts as 1 (R1, P6: a number, not a percentage)
edgeCase('rel percentage', 'oklch(0.7 0.3 250)', '50%', 1);
palette('rel percentage', 'oklch(0.7 0.3 250)', 3, { rel: '50%' });
// 8. --gamut-step: a step's t from 0 (lightest) to 1 (darkest) in place of its place; inherited from the list
palette('--gamut-step', 'oklch(0.6 0.2 250)', 1, { step: '0.6', ts: [0.6] });
palette('--gamut-step', 'oklch(0.6 0.2 250)', 3, { step: '0.25', on: 'list', ts: [0.25, 0.25, 0.25] });
palette('--gamut-step', 'oklch(0.6 0.2 250)', 2, { step: '1.5', ts: [1, 1] });
palette('--gamut-step', 'oklch(0.6 0.2 250)', 1, { step: '0.6', ts: [0.6], fn: true });
// 9. --gamut-tone: every step at that tone, whatever its place or --gamut-step; clamped to 0 to 100
palette('--gamut-tone', 'oklch(0.6 0.2 250)', 3, { tone: '40', tones: [40, 40, 40] });
palette('--gamut-tone', 'oklch(0.6 0.2 250)', 2, { step: '0.8', on: 'list', tone: '72.5', tones: [72.5, 72.5] });
palette('--gamut-tone', 'oklch(0.6 0.2 250)', 2, { tone: '140', tones: [100, 100] });
palette('--gamut-tone', 'oklch(0.6 0.2 250)', 2, { tone: '-5', tones: [0, 0] });
palette('--gamut-tone', 'oklch(0.6 0.2 250)', 1, { tone: '40', tones: [40], fn: true });
// 10. black, a seed of no hue and no chroma: Material's grey
palette('black seed', 'black', 4);

let fail = 0;
for (const e of pick(['Chrome', 'WebKit', 'Firefox'])) {
  const { browser, page } = await open(e);
  await page.setContent(`<!doctype html><style>${sheet}</style><body>${cases.map((c, i) => c.html(i)).join('')}<p id=fn style="--x: --gamut-fit-screen(red)"></p>`, { timeout: 120000 });
  const rows = await page.evaluate(() => [...document.querySelectorAll('[data-i]')].map((x) => ({
    bg: getComputedStyle(x).backgroundColor, img: getComputedStyle(x).backgroundImage,
    refs: [...x.querySelectorAll(':scope > b')].map((b) => getComputedStyle(b).color), lis: [...x.querySelectorAll('li')].map((l) => getComputedStyle(l).backgroundColor) })));
  const hasFn = await page.evaluate(() => [...document.styleSheets[0].cssRules].some(function has(x) { return x.constructor.name === 'CSSFunctionRule' || [...(x.cssRules ?? [])].some(has); }));
  await browser.close();
  let n = 0, skipped = 0; const bad = [];
  cases.forEach((c, i) => {
    if (c.fn && !hasFn) { skipped++; return; }
    const r = rows[i], refs = r.refs.map(parse);
    n++;
    if (refs.some((x) => !x)) return bad.push(`${c.what}: input unread (${r.refs.join(', ')})`);
    const got = c.kind === 'one' ? [r.bg] : c.kind === 'steps' ? r.lis : colorsIn(r.img);
    if (c.known?.[e[0]]) { if (!c.known[e[0]](got[0])) bad.push(`${c.what}: ${got[0]}, where the docs say ${e[0]} gives black: update them`); return; }
    const want = c.want(refs);
    if (got.length !== want.length) return bad.push(`${c.what}: ${got.length} colors, want ${want.length} (${(r.img || r.bg).slice(0, 120)})`);
    let worst = 0, at = 0;
    got.forEach((s, k) => { const g = parse(s), d = g ? dist(chans(g, c.t), want[k]) : Infinity; if (!(d <= worst)) { worst = d; at = k; } });
    if (!(worst <= c.tol)) bad.push(`${c.what}: ${worst.toFixed(2)}/255 off at ${at} (${got[at]}, want ${want[at].map((v) => (v * 255).toFixed(1)).join(' ')})`);
  });
  if (bad.length) fail++;
  console.log(`${e[0]}: ${bad.length ? 'FAIL' : 'PASS'}: ${n - bad.length} of ${n} cases${skipped ? ` (${skipped} function cases skipped: no @function)` : ''}${bad.length ? `\n  ${bad.join('\n  ')}` : ''}`);
}
process.exit(fail ? 1 : 0);
