// Checks .gamut-fit-screen and --gamut-fit-screen() on inputs built from currentColor (one of them sh1boot's, csswg-drafts #9449)
// them (bare, relative colors, color-mix()), on elements whose color is set on them or inherited, to sRGB and Display P3:
// each output against Color.js 0.7.1's css method on the input resolved in JS at the element's color, within 2/255; a
// page of them loads within twice the time of the same page with each input written out as its color, plus 1 s (the
// chain doubled in text at each step before, seconds an element; WebKit's page alone runs 250 to 500 ms against
// 45 to 130 written out, 2026-10-30, so 300 ms failed a quiet run); the output follows a change of the element's color.
// Chrome (class and function), WebKit and Firefox (class). Firefox maps no currentColor input (SPEC.md G16): its
// result is printed as the known FAIL and doesn't fail the check, unless it starts to pass.
// Usage: node test/current-color-check.mjs   (SHEET= for another sheet)
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pick, open } from './engines.mjs';
const C0 = createRequire(import.meta.url)('colorjs.io'), Color = C0.default ?? C0;
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const lch = (c) => new Color(c).to('oklch').coords.map((v) => v || 0);
// [input, the element's color, the input resolved at that color]
const CASES = [
  ['currentColor', 'oklch(0.7 0.35 150)', (c) => c],
  ['oklch(from currentColor clamp(.2, l, .8) .3 270deg)', 'oklch(0.95 0.05 90)', (c) => `oklch(${Math.min(0.8, Math.max(0.2, lch(c)[0]))} 0.3 270)`], // sh1boot, #9449
  ['oklch(from currentColor 95% c h)', 'oklch(0.6 0.3 250)', (c) => { const [, C, h] = lch(c); return `oklch(0.95 ${C} ${h})`; }],
  ['oklch(from currentColor l calc(c * 3) h / 0.5)', 'oklch(0.65 0.12 200)', (c) => { const [L, C, h] = lch(c); return `oklch(${L} ${C * 3} ${h} / 0.5)`; }],
  ['color-mix(in oklch, currentColor 60%, oklch(0.6 0.3 30))', 'oklch(0.8 0.3 140)', (c) => Color.mix(c, 'oklch(0.6 0.3 30)', 0.4, { space: 'oklch' }).toString()],
  ['color-mix(in oklab, currentColor, white)', 'color(display-p3 0 1 0)', (c) => Color.mix(c, 'white', 0.5, { space: 'oklab' }).toString()],
  ['currentColor', '#3366cc', (c) => c],
  ['currentColor', 'rgb(255 0 0 / 0.4)', (c) => c],
];
const SP = { srgb: 'srgb', 'display-p3': 'p3' };
const want = (c, t) => { const m = new Color(c).toGamut({ space: SP[t], method: 'css' }).to(SP[t]); return [...m.coords, m.alpha]; };
const off = (s, w, t) => { try { const c = new Color(s).to(SP[t]); return Math.max(...[...c.coords, c.alpha].map((v, k) => Math.abs((v ?? 0) - w[k]))) * 255; } catch { return NaN; } };
const el = (fn, style, inp) => (fn ? `style="${style}background: --gamut-fit-screen(${inp})"` : `class="gamut-fit-screen" style="${style}--gamut-in: ${inp}; background: var(--gamut-out)"`);
// each case twice a target: the color on the element, and inherited from its parent
const page = (fn, out) => ['srgb', 'display-p3'].map((t) => `<div style="--gamut-target: ${t}">${CASES.map(([inp, col, res], i) => {
  const x = out ? new Color(res(col)).toString() : inp;
  return `<i data-t="${t}" data-i="${i}" ${el(fn, `color: ${col}; `, x)}></i><b style="color: ${col}"><i data-t="${t}" data-i="${i}" ${el(fn, '', x)}></i></b>`; }).join('')}</div>`).join('');
let failed = false;
for (const e of pick(['Chrome', 'WebKit', 'Firefox'])) {
  for (const fn of e[0] === 'Chrome' ? [false, true] : [false]) {
    // Firefox 158's known failure (SPEC.md G16): 12 of the 33 right; fewer, or a page that doesn't load, still fails
    const form = fn ? '--gamut-fit-screen()' : '.gamut-fit-screen', known = e[0] === 'Firefox', KNOWN_RIGHT = 12;
    const load = async (out) => { const { browser, page: p } = await open(e), t0 = Date.now(); let ms = Infinity;
      try { await p.setContent(`<!doctype html><style>${css}</style><body>${page(fn, out)}</body>`, { timeout: 60000 }); ms = Date.now() - t0; } catch { /* past 60 s */ }
      return { browser, p, ms }; };
    const { browser, p, ms } = await load(false);
    if (ms === Infinity) { console.log(`${e[0]} ${form}: FAIL: the page did not load in 60 s`); failed = true; await browser.close(); continue; }
    const got = await p.evaluate(() => [...document.querySelectorAll('i')].map((x) => [x.dataset.t, +x.dataset.i, getComputedStyle(x).backgroundColor]));
    const bad = got.filter(([t, i, bg]) => { const [, col, res] = CASES[i]; return !(off(bg, want(res(col), t), t) <= 2); })
      .map(([t, i, bg]) => `${t} ${CASES[i][0]} on ${CASES[i][1]}: ${bg}`);
    // a change of color reaches the output: the first element's color set to the third case's
    const moved = await p.evaluate(() => { const x = document.querySelector('i'), a = getComputedStyle(x).backgroundColor; x.style.color = 'oklch(0.6 0.3 30)'; return [a, getComputedStyle(x).backgroundColor]; });
    if (!(off(moved[1], want('oklch(0.6 0.3 30)', 'srgb'), 'srgb') <= 2)) bad.push(`after color changed: ${moved[1]} (was ${moved[0]})`);
    await browser.close();
    // load times swing from run to run (WebKit's written-out page took 52 to 170 ms on one machine, 2026-10-28): each
    // page loads again, up to three times, while it looks slow, and the fastest of each is compared
    let fast = ms, baseMs = Infinity;
    for (let k = 0; k < 3 && !(k && fast <= 2 * baseMs + 1000); k++) {
      const b = await load(true); baseMs = Math.min(baseMs, b.ms); await b.browser.close();
      if (k && fast > 2 * baseMs + 1000) { const a = await load(false); fast = Math.min(fast, a.ms); await a.browser.close(); } }
    // a machine busier than its cores (another run beside this one) says nothing about load time: the time is printed
    // and not judged (2026-10-29: at load average 34 on 14 cores WebKit took 455 to 561 ms, its bound 402)
    const busy = os.loadavg()[0] > os.cpus().length, base = { ms: baseMs }, slow = !busy && fast > 2 * base.ms + 1000;
    // a baseline that never loaded (past 60 s) judges nothing: that is a failure, not a pass
    if (!Number.isFinite(baseMs) || !Number.isFinite(fast)) bad.push(`the page or its written-out baseline didn't load (${fast} ms, baseline ${baseMs} ms)`);
    const ok = !bad.length && !slow;
    if (known && ok) { console.log(`${e[0]} ${form}: now passes; SPEC.md G16 says it doesn't`); failed = true; continue; }
    const right = got.length + 1 - bad.length;
    // and its load time, 6,953 ms against 27 written out when measured: four times that fails (it swings to twice from
    // run to run: 13,706 ms on 2026-10-29), on a machine not busier than its cores
    const KNOWN_MS = 6953, slowKnown = !busy && fast > 4 * KNOWN_MS;
    failed ||= known ? right < KNOWN_RIGHT || slowKnown : !ok;
    console.log(`${e[0]} ${form}: ${ok ? 'PASS' : known ? (right < KNOWN_RIGHT ? `FAIL (fewer than the known ${KNOWN_RIGHT})` : slowKnown ? `FAIL (slower than four times the known ${KNOWN_MS} ms)` : 'FAIL (known: SPEC.md G16)') : 'FAIL'}: ${got.length + 1 - bad.length} of ${got.length + 1} within 2/255 of Color.js, loaded in ${fast} ms${busy ? ` (not judged: load average ${os.loadavg()[0].toFixed(0)} on ${os.cpus().length} cores)` : ''} (written out ${base.ms} ms; fastest of up to 3)${bad.length ? `\n  ${bad.slice(0, 4).join('\n  ')}` : ''}`);
  }
}
console.log(failed ? 'FAIL' : 'PASS');
process.exit(failed ? 1 : 0);
