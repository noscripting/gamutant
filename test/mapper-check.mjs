// Checks gamutant.css's mappers (build.mjs mapper() and minde()) in Chrome, WebKit and Firefox.
// .gamut-fit-screen is CSS Color 4's gamut mapping (binary search with local MINDE): every color within 2 of 255 of Color.js
// 0.7.1's css method (its own search stops 0.0001 short, so two answers each within 1 of the spec point can be 2 apart);
// the WPT canvas cases (13 sRGB, 16 P3) within their tolerance; in-gamut inputs within 1
// of 255 of themselves; edge colors; the number front (--gamut-l/c/h). .gamut-screen-edge is #11946's relative chroma: the
// gamut's largest chroma at the color's own lightness and hue times --gamut-rel, the color's own chroma ignored (an
// input inside the gamut goes to the edge too): random colors in and out within 1 of 255 of that chroma found by a scan
// in doubles (methods.mjs edgeExits(): where a line leaves the gamut and comes back, the sheet's halvings may land on an
// earlier exit, which passes and is counted apart), and --gamut-rel: 0.5 within 1 of 255 of half of it. From computed values of --gamut-out, unclipped and unrounded (but WPT's, in bytes as WPT has
// them), and painted pixels for sRGB. Then style time for 1,
// 16, 64, 256 fitted colors changing at once, against the same page without the mapper, under the bench lock (skipped
// with QUICK=1). The 1/255 bars are this sheet's own.
// Usage: node build.mjs && node test/mapper-check.mjs [count=1000]  (random colors a gamut)
// FIT_ONLY=1 checks .gamut-fit-screen alone, including its existing alpha/paint/system cases.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { toLin, toLch, gam, clip01, inGamut, edgeExits, wpt, parse } from './ref/methods.mjs';
import { pw, need, pick, benchLock } from './engines.mjs';
import { gamut } from './ref/classes.mjs';
const { PNG } = need('pngjs');
const N = +(process.argv[2] ?? 1000);
const fitOnly = process.env.FIT_ONLY === '1';
const Color = createRequire(import.meta.url)('colorjs.io').default;
const css4 = (sp, lch) => new Color('oklch', lch).toGamut({ space: sp, method: 'css' }).to(sp).coords.map((x) => clip01(x) * 255);

// --- the sheet: gamutant.css, built by build.mjs ---------------------------------------------------------------------
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');

// --- the colors -------------------------------------------------------------------------------------------------
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const sps = { srgb: 'srgb', p3: 'display-p3' };
const fmt = (lch) => `oklch(${lch.map((x) => +x.toFixed(6)).join(' ')})`;
let cases = [];
for (const sp of Object.keys(sps)) {
  for (const [s, want, tol] of wpt[sp]) cases.push({ sp, kind: 'wpt', lch: parse(s), want, tol });
  let out = 0, inside = 0;
  while (out < N || inside < N / 10) {
    const lch = [0.02 + rnd() * 0.96, rnd() * 0.4, rnd() * 360], ok = inGamut(toLin(sp, lch));
    if (ok && inside < N / 10) { inside++; cases.push({ sp, kind: 'in', lch }); }
    if (!ok && out < N) { out++; cases.push({ sp, kind: 'out', lch }); }
  }
  for (const lch of [[0, 0, 0], [1, 0, 0], [0.999, 0.3, 100], [0.001, 0.3, 260], [0.5, 0, 0], [0.5, 0.0001, 33], [0.98, 0.4, 0], [0.05, 0.4, 140]])
    cases.push({ sp, kind: 'edge', lch });
  // The number front (--gamut-l/c/h, no --gamut-in); .gamut-screen-edge, at the edge and at --gamut-rel: 0.5 of it.
  for (let i = 0; i < 30; i++) {
    const lch = [0.05 + rnd() * 0.9, rnd() * 0.4, rnd() * 360];
    cases.push({ sp, kind: 'num', lch, style: `--gamut-l: ${+lch[0].toFixed(6)}; --gamut-c: ${+lch[1].toFixed(6)}; --gamut-h: ${+lch[2].toFixed(6)}` });
    const r = [0.05 + rnd() * 0.9, rnd() * 0.4, rnd() * 360];
    cases.push({ sp, kind: 'rel', cls: 'screen-edge', lch: r, style: `--gamut-in: ${fmt(r)}; --gamut-rel: 0.5`, rel: 0.5 });
  }
  // a review's cases (2026-10-21): just under 1 still pulls an edge color in (red at 0.995); a color 5e-5 out by black
  // is searched, not kept (oklch(0.02 0.05 180))
  const red = toLch(sp, [1, 0, 0]);
  cases.push({ sp, kind: 'rel', cls: 'screen-edge', lch: red, style: `--gamut-in: ${fmt(red)}; --gamut-rel: 0.995`, rel: 0.995 });
  cases.push({ sp, kind: 'edge', lch: [0.02, 0.05, 180] }, { sp, kind: 'edge-out', cls: 'screen-edge', lch: [0.02, 0.05, 180] });
  // near black, the edge's own chroma within 1% of the most (a review, 2026-10-28: at L 0.001 h 0 the
  // halvings' last bracket gave 0.0000886 for 0.000405, under a byte apart)
  for (const L of [0.001, 0.01, 0.05, 0.1]) for (const h of [0, 120, 264]) cases.push({ sp, kind: 'edge-dark', cls: 'screen-edge', lch: [L, 0.0002 + L / 100, h] });
  let e = 0;
  while (e < N / 5) { const lch = [0.02 + rnd() * 0.96, rnd() * 0.4, rnd() * 360]; if (!inGamut(toLin(sp, lch))) { e++; cases.push({ sp, kind: 'edge-out', cls: 'screen-edge', lch }); } }
  // inside the gamut, a grey and a vivid one among them: the edge all the same (#11946 sets the chroma, it doesn't cap it)
  let n = 0;
  while (n < N / 10) { const lch = [0.05 + rnd() * 0.9, rnd() * 0.1, rnd() * 360]; if (inGamut(toLin(sp, lch))) { n++; cases.push({ sp, kind: 'edge-in', cls: 'screen-edge', lch }); } }
  for (const lch of [[0.6, 0, 0], [0.6, 0, 120], [0.45, 0.0001, 140], [0.45, 0.0002, 140], toLch(sp, [0, 0, 1]), toLch(sp, [0, 1, 0])]) cases.push({ sp, kind: 'edge-in', cls: 'screen-edge', lch });
  for (const [hex, L] of [['#808080', 0.59987], ['#ffffff', 1], ['#333333', 0.32109]]) cases.push({ sp, kind: 'edge-in', cls: 'screen-edge', lch: [L, 1e-5, 0], style: `--gamut-in: ${hex}` });
}
if (fitOnly) cases = cases.filter(c => c.cls !== 'screen-edge');
const bytes = (sp, lch) => toLin(sp, lch).map((x) => Math.round(clip01(gam(x)) * 255));
// answers in encoded channels times 255, unrounded, and the sheet's output unclipped too, so one past the gamut counts as
// off (WPT's cases stay in bytes, as WPT compares its canvas)
// .gamut-screen-edge's answers: rel times each chroma where the line at L and h leaves the gamut (methods.mjs, a scan to 0.6),
// in bytes; the last is the most
const edgeTargets = (c) => { const { L, H, exits } = edgeExits(c.sp, c.lch, 0.6); return exits.map((x) => flt(c.sp, [L, (c.rel ?? 1) * x, H])); };
const flt = (sp, lch) => toLin(sp, lch).map((x) => clip01(gam(x)) * 255), raw = (sp, lch) => toLin(sp, lch).map((x) => gam(x) * 255);
const boundaryBytes = (c) => boundary(c.sp, c.lch).map((x) => clip01(gam(x)) * 255);
const SIDE = 4, COLS = 100;
const page = (list, mapped = true) => `<!doctype html><style>${css}
body { margin: 0; } #g > div { display: grid; grid-template-columns: repeat(${COLS}, ${SIDE}px); grid-auto-rows: ${SIDE}px; }
#g i { background: ${mapped ? 'var(--gamut-out)' : 'var(--gamut-in)'}; }</style><div id=g>${Object.keys(sps).map((sp) =>
  `<div style="--gamut-target: ${sps[sp]}">${list.filter((c) => c.sp === sp).map((c) =>
  `<i class="${mapped ? gamut(c.cls ?? 'fit-screen') : ''}" style="${c.style ?? `--gamut-in: ${fmt(c.lch)}`}"></i>`).join('')}</div>`).join('')}</div>`;

// --- run ---------------------------------------------------------------------------------------------------------
// a computed --gamut-out as OKLCH: oklch() as printed, or the linear RGB a clip ends in (srgb-linear, display-p3-linear)
const parseOklch = (s) => { const num = (x) => (x === 'none' ? 0 : parseFloat(x) / (x.endsWith('%') ? 100 : 1));
  let m = s.match(/oklch\(\s*([^)]+)\)/); if (m) return m[1].split(/[\s/]+/).slice(0, 3).map(num);
  m = s.match(/color\(\s*(srgb-linear|display-p3-linear)\s+([^)]+)\)/); if (!m) return null;
  return toLch(m[1] === 'srgb-linear' ? 'srgb' : 'p3', m[2].split(/[\s/]+/).slice(0, 3).map(num)); };
let failed = false;
for (const [name, type, opts] of pick()) {
  const b = await pw[type].launch(opts);
  const p = await b.newPage({ viewport: { width: COLS * SIDE, height: Math.ceil(cases.length / COLS) * SIDE } });
  await p.setContent(page(cases));
  const computed = await p.evaluate(() => [...document.querySelectorAll('#g i')].map((e) => getComputedStyle(e).getPropertyValue('--gamut-out').trim()));
  // a screenshot under load can show a cell from another frame: this check failed so in Chrome in 2 of 5 fresh copies
  // of the repo (2026-10-29 and 30, 6 of 1,000 cells, their computed colors right), so a cell whose paint misses its
  // computed color is read again from up to 2 more screenshots, and the closest counts; a paint bug misses in all three
  const want = (i) => { const got = parseOklch(computed[i]); return cases[i].sp === 'srgb' && got?.every(Number.isFinite) ? bytes('srgb', got) : null; };
  const at = (img, i) => { const o = ((Math.floor(i / COLS) * SIDE + 2) * img.width + (i % COLS) * SIDE + 2) * 4; return [img.data[o], img.data[o + 1], img.data[o + 2]]; };
  const offAt = (img, i) => Math.max(...at(img, i).map((v, j) => Math.abs(v - want(i)[j])));
  const shots = [PNG.sync.read(await p.screenshot({ fullPage: true }))];
  const best = (i) => shots.reduce((b, img) => (offAt(img, i) < offAt(b, i) ? img : b));
  while (shots.length < 3 && cases.some((c, i) => want(i) && offAt(best(i), i) > 1)) shots.push(PNG.sync.read(await p.screenshot({ fullPage: true })));
  const px = (i) => at(best(i), i);
  const tally = {}; const bad = [];
  cases.forEach((c, i) => {
    const got = parseOklch(computed[i]);
    const key = `${c.sp} ${c.kind}`; const t = (tally[key] ??= { n: 0, fail: 0, max: 0, pxmax: 0 }); t.n++;
    if (!got || got.some((x) => !Number.isFinite(x))) { t.fail++; bad.push([key, fmt(c.lch), computed[i]]); return; }
    const mine = c.kind === 'wpt' ? bytes(c.sp, got) : raw(c.sp, got), paint = bytes(c.sp, got);
    // what each should be: WPT's value; .gamut-screen-edge's target or boundary; a color in the gamut itself;
    // else Color.js's css method
    const fits = inGamut(toLin(c.sp, c.lch));
    const off = (w) => Math.max(...mine.map((v, j) => Math.abs(v - w[j])));
    let target = c.kind === 'wpt' ? c.want : c.target ? flt(c.sp, c.target) : fits ? flt(c.sp, c.lch) : css4(c.sp === 'p3' ? 'p3' : 'srgb', c.lch);
    if (c.cls === 'screen-edge') { const ts = edgeTargets(c), k = ts.reduce((b, w, j) => (off(w) < off(ts[b]) ? j : b), ts.length - 1);
      target = ts[k]; if (k < ts.length - 1 && off(ts.at(-1)) > 1) t.early = (t.early ?? 0) + 1; }
    if (c.kind === 'edge-dark') { const most = Math.max(...edgeExits(c.sp, c.lch, 0.6).exits), dc = Math.abs(got[1] - most) / most;
      t.max = Math.max(t.max, dc * 100); if (dc > 0.01) { t.fail++; bad.push([key, fmt(c.lch), computed[i], `chroma ${got[1]} want ${most} (${(dc * 100).toFixed(1)}%)`]); } return; }
    const d = off(target);
    const limit = c.kind === 'wpt' ? c.tol : c.cls || fits ? 1 : 2;
    t.max = Math.max(t.max, d); if (d > limit) { t.fail++; bad.push([key, fmt(c.lch), computed[i], `got ${mine.map((v) => +v.toFixed(2))} want ${target.map((v) => +v.toFixed(2))} (${d.toFixed(2)})`]); }
    if (c.sp === 'srgb') { const q = px(i), e = Math.max(...q.map((v, j) => Math.abs(v - paint[j]))); t.pxmax = Math.max(t.pxmax, e);
      if (e > 1) { t.fail++; bad.push([key, fmt(c.lch), computed[i], `painted ${q} against computed ${paint.map((v) => +v.toFixed(1))} (${e} of 255)`]); } }
  });
  console.log(`\n${name}`);
  for (const [k, t] of Object.entries(tally)) console.log(`  ${k.padEnd(14)} ${String(t.n).padStart(5)} colors, ${t.fail} fail, max off ${+t.max.toFixed(2)} of 255${k.startsWith('srgb') ? `, painted vs computed max ${t.pxmax}` : ''}${t.early ? `, ${t.early} at an earlier exit than the most chroma` : ''}`);
  for (const x of bad.slice(0, 6)) console.log('   ', x.join(' | '));
  if (bad.length) failed = true;

  // Alpha: a translucent input keeps its alpha (as the spec does), and its color is the opaque input's, alpha 0 included
  const ALPHA = [['oklch(0.7 0.4 30', 0.5], ['rgb(0 0 0', 0.4], ['oklch(0.6 0.1 200', 0.25], ['color(display-p3 1 0 0', 0.8], ['oklch(0.75 0.4 60', 0.05], ['oklch(0.7 0.3 150', 0], ['color(display-p3 0 1 1', 0]];
  await p.setContent(`<style>${css}</style><div style="--gamut-target: srgb">${(fitOnly ? ['fit-screen'] : ['fit-screen', 'screen-edge']).map((cls) => ALPHA.map(([c, a]) =>
    `<i class="${gamut(cls)}" style="--gamut-in: ${c} / ${a})"></i><i class="${gamut(cls)}" style="--gamut-in: ${c})"></i>`).join('')).join('')}</div>`);
  const pairsA = await p.evaluate(() => [...document.querySelectorAll('i')].map((e) => getComputedStyle(e).getPropertyValue('--gamut-out').trim()));
  const alphaOf = (v) => { const m = v.match(/\/\s*([\d.e-]+)\s*\)$/); return m ? +m[1] : 1; };
  const aBad = [];
  for (let i = 0; i < pairsA.length; i += 2) { const want = ALPHA[(i / 2) % ALPHA.length][1], cls = i / 2 < ALPHA.length ? 'fit-screen' : 'screen-edge';
    const sameColor = pairsA[i].replace(/\s*\/\s*[\d.e-]+\s*\)$/, ')') === pairsA[i + 1].replace(/\s*\/\s*[\d.e-]+\s*\)$/, ')');
    if (Math.abs(alphaOf(pairsA[i]) - want) > 0.5 / 255 || !sameColor) aBad.push(`${cls} ${ALPHA[(i / 2) % ALPHA.length][0]} / ${want}): ${pairsA[i]} vs ${pairsA[i + 1]}`); }
  console.log(`  alpha: ${pairsA.length / 2 - aBad.length} of ${pairsA.length / 2} translucent inputs keep their alpha and the opaque input's color`);
  for (const x of aBad) console.log('    ' + x);
  if (aBad.length) failed = true;

  // System colors and currentColor as inputs (in gamut, so unchanged): --gamut-out against the same color painted.
  // Pure blue and #0000ee are in gamut past the first exit of their constant-L,h line; Highlight is translucent and keeps
  // its alpha. currentColor is printed, not judged: Chrome keeps it
  // unresolved through registered colors and paints another color (WebKit is right).
  const sys = ['Canvas', 'CanvasText', 'AccentColor', 'LinkText', 'Highlight', 'blue', '#0000ee', 'lime', 'currentColor'];
  await p.setContent(`<style>${css}</style>${sys.map((c) => `<i class="gamut-fit-screen" style="color: rebeccapurple; --gamut-in: ${c}"></i><b style="color: rebeccapurple; background: ${c}"></b>`).join('')}`);
  const pairs = await p.evaluate(() => { const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const px = (c) => { cv.fillStyle = '#000'; cv.fillRect(0, 0, 1, 1); cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); return [...cv.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
    return [...document.querySelectorAll('i')].map((e) => [px(getComputedStyle(e).getPropertyValue('--gamut-out')), px(getComputedStyle(e.nextSibling).backgroundColor)]); });
  const sysOff = pairs.map(([a, b2]) => Math.max(...a.map((v, j) => Math.abs(v - b2[j]))));
  console.log(`  system colors and currentColor in: ${sys.map((c, i) => `${c} ${sysOff[i]}`).join(', ')} (of 255 off the color itself)`);
  if (sysOff.slice(0, -1).some((d) => d > 1)) failed = true;

  // Style time: n mapped colors changing at once (each to another color), against the same page without the mapper.
  const release = process.env.QUICK ? () => {} : await benchLock('mapper.mjs');
  for (const mapped of [true, false]) {
    const line = [];
    for (const n of (process.env.QUICK ? [] : [1, 16, 64, 256])) {
      const list = cases.filter((c) => c.sp === 'srgb' && c.kind === 'out').slice(0, n);
      await p.setContent(page(list, mapped));
      const ms = await p.evaluate(async ([n, salt]) => {
        const els = [...document.querySelectorAll('#g i')], times = [];
        for (let r = 0; r < 9; r++) {
          await new Promise(requestAnimationFrame);
          const t0 = performance.now();
          els.forEach((e, i) => e.style.setProperty('--gamut-in', `oklch(${0.3 + ((i * 7 + r * 13) % 50) / 100} ${0.1 + ((i * 3 + r) % 30) / 100} ${(i * 37 + r * 91 + salt) % 360})`));
          document.body.offsetWidth; getComputedStyle(els[els.length - 1]).getPropertyValue('--gamut-out');
          times.push(performance.now() - t0);
        }
        times.sort((a, b) => a - b); return times[4];
      }, [n, 5]);
      line.push(`${n}: ${ms.toFixed(2)} ms`);
    }
    console.log(`  style time, ${mapped ? 'mapped' : 'unmapped'} (median of 9): ${line.join(', ')}`);
  }
  release();
  await b.close();
}
console.log(failed ? '\nFAIL' : '\nPASS');
process.exit(failed ? 1 : 0);
