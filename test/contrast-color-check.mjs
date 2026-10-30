// Checks .gamut-contrast-color (build.mjs contrastColor()) against CSS Color 6 §2 as written, in JS: the spec's own examples,
// then random bases, candidate lists and targets (translucent and Display P3 colors included), in Chrome, WebKit and
// Firefox, each on a light page and a dark one (color-scheme), the reference laying a translucent background over that
// engine's own Canvas, read from the page. A case passes when the output is the winning candidate (within 1/255 a
// channel, alpha within 2/255).
// Usage: node test/contrast-color-check.mjs [cases]
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { pw, pick } from './engines.mjs';
import { ungam, spaces } from './ref/methods.mjs';
const cjs = createRequire(import.meta.url)('colorjs.io'); const Color = cjs.default ?? cjs;
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const N = +(process.argv[2] ?? 1500), MAX = 6; // the sheet's candidate slots

// --- CSS Color 6 §2, in JS ---------------------------------------------------------------------------------------
const rgba = (s) => { const c = new Color(s).to('srgb'); return [...c.coords.map((x) => (Number.isNaN(x) ? 0 : x)), c.alpha ?? 1]; };
const [YR, YG, YB] = spaces.srgb.toXYZ[1]; // the Y row of CSS Color 4 §19's lin_sRGB_to_XYZ
const Y = ([r, g, b]) => Math.max(0, YR * ungam(r) + YG * ungam(g) + YB * ungam(b));
const over = (top, under) => [0, 1, 2].map((i) => top[3] * top[i] + (1 - top[3]) * under[i]); // simple alpha compositing, sRGB
const CANVAS = [1, 1, 1, 1]; // the light scheme's Canvas
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
export { rgba };
export function winner(bg, tries, target, canvas = CANVAS) {
  const base = over(rgba(bg), canvas), Yb = Y(base);
  const list = tries.length ? tries : ['white', 'black'];
  const contrast = (c) => ratio(Yb, Y(over(rgba(c), base)));
  if (target != null) {   // a target of 0 is a target (every candidate reaches it), not none
    for (const c of [...list, 'white', 'black']) if (contrast(c) >= target) return c;
    return contrast('white') >= contrast('black') ? 'white' : 'black';
  }
  let best = list[0]; for (const c of list) if (contrast(c) > contrast(best)) best = c;
  return best;
}

// --- cases ------------------------------------------------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
const cases = [];
const spec = ['bisque', 'darkgoldenrod', 'olive', 'sienna', 'darkgreen', 'maroon'];
cases.push({ bg: 'wheat', tries: spec, target: 4.5, want: 'darkgreen' }, { bg: 'wheat', tries: spec, target: 5.8, want: 'maroon' },
  { bg: 'wheat', tries: spec.slice(0, 3), target: 4.5, want: 'black' },
  { bg: 'wheat', tries: ['tan', 'sienna', '#b22222', '#d2691e'], want: '#b22222' },
  // the spec says purple: it reads hsl(300 100% 25%) as rgb(128 0 128), but it is 127.5 0 127.5, a hair darker, so it wins
  { bg: 'hsl(200 50% 80%)', tries: ['hsl(200 83% 23%)', 'purple', 'hsl(300 100% 25%)'], want: 'hsl(300 100% 25%)' },
  { bg: 'color(display-p3 0.38 0.11 0.05)', tries: ['yellow'], target: 11, want: 'yellow' },
  { bg: '#777', tries: [], target: 21 }, { bg: 'white', tries: ['red', 'black'], target: 0, want: 'red' }, { bg: '#767676', tries: [] }, { bg: 'white', tries: [] },
  { bg: 'rgb(0 0 0 / 0.5)', tries: ['#888', 'white'], target: 4.5 }, { bg: 'navy', tries: ['rgb(255 255 255 / 0.3)', 'rgb(255 255 0 / 0.9)'], target: 7 },
  // a base past white (Y 2): white is the darker there and reaches 1.5 (2.05 / 1.05), so it comes before black (a clean
  // room's audit, 2026-10-29: black, white's ratio taken as if white were the lighter)
  { bg: 'color(srgb-linear 2 2 2)', tries: ['color(srgb-linear 2 2 2)'], target: 1.5, want: 'white' }, { bg: 'color(srgb-linear 2 2 2)', tries: [], target: 1.5, want: 'white' });
let seed = 20261021; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const f = (x) => +x.toFixed(4);
const color = () => { const k = rnd(), a = rnd() < 0.15 ? ` / ${f(0.2 + 0.8 * rnd())}` : '';
  if (k < 0.6) return `rgb(${[0, 0, 0].map(() => Math.floor(rnd() * 256)).join(' ')}${a})`;
  if (k < 0.85) return `oklch(${f(rnd())} ${f(rnd() * 0.3)} ${f(rnd() * 360)}${a})`;
  return `color(display-p3 ${f(rnd())} ${f(rnd())} ${f(rnd())}${a})`; };
while (cases.length < N) {
  const n = Math.floor(rnd() * (MAX + 1)), tries = Array.from({ length: n }, () => (rnd() < 0.1 && n ? 'white' : color()));
  if (n > 2 && rnd() < 0.2) tries[n - 1] = tries[0]; // a tie: the first wins
  const t = rnd(); cases.push({ bg: color(), tries, target: t < 0.35 ? undefined : t < 0.5 ? 4.5 : t < 0.6 ? 3 : t < 0.7 ? 7 : f(1 + 20 * rnd()) });
}
for (const c of cases) { const w = winner(c.bg, c.tries, c.target); if (c.want && w !== c.want) throw new Error(`oracle: ${JSON.stringify(c)} gave ${w}`); c.want = w; }

// --- the browsers -------------------------------------------------------------------------------------------------
const page = (scheme) => `<!doctype html><style>${css}\n:root { color-scheme: ${scheme}; }</style><b id="canvas" style="background: Canvas"></b>
<div style="--gamut-target: srgb">${cases.map((c) => `<i class="gamut-contrast-color" style="--gamut-bg: ${c.bg};${c.target != null ? ` --gamut-contrast-ratio: ${c.target};` : ''}${c.tries.map((t, k) => ` --gamut-try-${k + 1}: ${t};`).join('')}"></i>`).join('\n')}</div>`;
let failed = false;
for (const [name, type, opts] of pick()) {
  const b = await pw[type].launch(opts), p = await b.newPage();
  for (const scheme of ['light', 'dark']) {
  await p.setContent(page(scheme));
  const got = await p.evaluate(() => [...document.querySelectorAll('i')].map((e) => getComputedStyle(e).getPropertyValue('--gamut-text')));
  const canvas = rgba(await p.evaluate(() => getComputedStyle(document.getElementById('canvas')).backgroundColor));
  const bad = [];
  cases.forEach((c, i) => {
    const want = scheme === 'light' ? c.want : winner(c.bg, c.tries, c.target, canvas);
    let g; try { g = rgba(got[i]); } catch { bad.push(`${i}: unreadable ${got[i]}`); return; }
    const w = rgba(want), off = Math.max(...[0, 1, 2].map((k) => Math.abs(g[k] - w[k]))) * 255, offA = Math.abs(g[3] - w[3]) * 255;
    if (!(off <= 1 && offA <= 2)) bad.push(`${i}: ${c.bg} [${c.tries.join(', ')}] ${c.target ?? 'max'} -> ${got[i]}, want ${want}`);
    // within a byte of the winner is not enough where the winner reaches a ratio: the color given must reach it too
    // (a review, 2026-10-29: #777777 is a byte from #767676 and 4.478 on white, where #767676 is 4.542)
    if (c.target != null) { const base = over(rgba(c.bg), canvas), reach = (x) => ratio(Y(base), Y(over(x, base)));
      if (reach(w) >= c.target && !(reach(g) >= c.target)) bad.push(`${i}: ${c.bg} -> ${got[i]}, ${reach(g).toFixed(4)} under ${c.target} (want ${want})`); }
  });
  failed ||= bad.length > 0;
  const differ = scheme === 'dark' ? cases.filter((c) => winner(c.bg, c.tries, c.target, canvas) !== c.want).length : 0;
  console.log(`${name}, ${scheme} (Canvas ${canvas.slice(0, 3).map((x) => Math.round(x * 255)).join(' ')}): ${cases.length - bad.length} of ${cases.length} pick CSS Color 6's winner${scheme === 'dark' ? ` (${differ} of them win differently than on white Canvas)` : ''}${bad.length ? `\n  ${bad.slice(0, 8).join('\n  ')}` : ''}`);
  }
  await b.close();
}
process.exit(failed ? 1 : 0);
}
