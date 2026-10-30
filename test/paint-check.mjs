// Checks .gamut-color-mix.gamut-mix-paint (build.mjs paintPart()), csswg-drafts #8715's pigment mixing, against
// spectral.js 3.0.0's mix() (Kubelka-Munk over 38 reflectance samples, its own tables): pairs of sRGB colors in hex,
// rgb(), named and color(srgb) syntax, spectral.js's own examples and the primaries against each other at 0 to 100%,
// random pairs and percentages (given, omitted, summing under and over 100), one color alone; each color's factor is its
// percentage normalized as color-mix() normalizes it (CSS Color 5 §3.3), a total under 100 taken off the alpha. A mix
// passes within 1e-4 a channel of spectral.js's linear RGB, and its sRGB bytes (spectral.js's rounding) within 1. A --gamut-mix-count above 2 gives transparent. In Chrome the same
// cases through --gamut-color-mix(paint, …). Each case's element has both classes.
// Usage: node test/paint-check.mjs [random pairs, default 160]   (ENGINES= narrows; SHEET= another sheet)
import { readFileSync } from 'node:fs';
import { pick, open } from './engines.mjs';
import { spectral } from './vendor/spectral.mjs';

const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const N = +(process.argv[2] ?? 160);
let seed = 8715; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const byte = () => Math.floor(rnd() * 256), hex = (c) => '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('');
// a color as the page writes it (any sRGB syntax) and as spectral.js reads it (hex)
const NAMED = { blue: [0, 0, 255], yellow: [255, 255, 0], red: [255, 0, 0], lime: [0, 255, 0], white: [255, 255, 255], black: [0, 0, 0], cyan: [0, 255, 255], magenta: [255, 0, 255], gray: [128, 128, 128] };
const write = (c) => { const k = Math.floor(rnd() * 3); return k === 0 ? hex(c) : k === 1 ? `rgb(${c.join(' ')})` : `color(srgb ${c.map((x) => +(x / 255).toFixed(10)).join(' ')})`; };
const cases = [];
const named = Object.entries(NAMED), own = [[[0, 33, 133], '#002185'], [[252, 210, 0], '#fcd200'], [[255, 39, 2], '#ff2702']];
const pal = [...named.map(([n, c]) => [c, n]), ...own];
for (let i = 0; i < pal.length; i++) for (let j = i + 1; j < pal.length; j++) for (const t of [0, 25, 50, 75, 100]) cases.push({ cs: [pal[i], pal[j]], ps: [null, t] });
for (let i = 0; i < N; i++) {
  const a = [byte(), byte(), byte()], b = [byte(), byte(), byte()], form = Math.floor(rnd() * 4);
  const ps = form === 0 ? [null, null] : form === 1 ? [Math.round(rnd() * 100), null] : form === 2 ? [Math.round(rnd() * 60), Math.round(rnd() * 60)] : [Math.round(50 + rnd() * 50), Math.round(50 + rnd() * 50)];
  cases.push({ cs: [[a, write(a)], [b, write(b)]], ps });
}
for (const [c, n] of pal) cases.push({ cs: [[c, n]], ps: [null] }, { cs: [[c, n]], ps: [40] });
cases.push({ cs: [[[0, 0, 255], 'blue'], [[255, 255, 0], 'yellow'], [[255, 0, 0], 'red']], ps: [null, null, null], three: true });
// CSS Color 5 §3.3's percentages: omitted ones share what the given leave, all scaled to 100; the factors and the alpha
function want(c) {
  const given = c.ps.filter((p) => p != null), S = Math.min(100, given.reduce((x, y) => x + y, 0)), O = c.ps.length - given.length;
  const ps = c.ps.map((p) => (p == null ? (100 - S) / O : p)), T = ps.reduce((x, y) => x + y, 0);
  if (c.three || T === 0) return { alpha: 0 };
  const m = spectral.mix(...c.cs.map(([rgb], k) => [new spectral.Color(hex(rgb)), ps[k] / T]));
  return { lrgb: m.lRGB, srgb: m.sRGB, alpha: Math.min(1, T / 100) };
}
const vars = (c) => `--gamut-mix-count: ${c.cs.length}; ${c.cs.map(([, w], k) => `--gamut-mix-${k + 1}: ${w};${c.ps[k] != null ? ` --gamut-mix-pct-${k + 1}: ${c.ps[k]};` : ''}`).join(' ')}`;
const call = (c) => `--gamut-color-mix(paint, ${c.cs.map(([, w], k) => `${w}, ${c.ps[k] ?? 'none'}`).join(', ')})`;
const compand = (x) => (x > 0.0031308 ? 1.055 * x ** (1 / 2.4) - 0.055 : x * 12.92);
const page = `<!doctype html><style>${css}\n@property --fn { syntax: '<color>'; inherits: false; initial-value: black; }</style>
<div>${cases.map((c) => `<i class="gamut-color-mix gamut-mix-paint" style="${vars(c)}"></i><b style="--fn: ${call(c)}"></b>`).join('')}</div>`;

let failed = false;
for (const e of pick()) {
  const { page: p, close } = await open(e);
  await p.setContent(page, { timeout: 120000 });
  const got = await p.evaluate(() => [...document.querySelectorAll('i')].map((x, k) => [getComputedStyle(x).getPropertyValue('--gamut-out'), getComputedStyle(document.querySelectorAll('b')[k]).getPropertyValue('--fn')]));
  const fn = await p.evaluate(() => CSS.supports('at-rule(@function)'));
  for (const [form, col] of [['class', 0], ...(fn ? [['function', 1]] : [])]) {
    const bad = []; let worst = 0, bytes = 0;
    cases.forEach((c, k) => {
      const w = want(c), s = got[k][col], m = /color\(srgb-linear ([-\d.e+]+) ([-\d.e+]+) ([-\d.e+]+)(?: \/ ([-\d.e+]+))?\)/.exec(s);
      if (!m) { bad.push(`${vars(c)} -> ${s || '(nothing)'}`); return; }
      const v = m.slice(1, 4).map(Number), a = m[4] == null ? 1 : +m[4];
      if (Math.abs(a - w.alpha) > 1e-4) { bad.push(`${vars(c)} -> ${s}, alpha ${w.alpha}`); return; }
      if (!w.lrgb) return;
      const d = Math.max(...v.map((x, j) => Math.abs(x - w.lrgb[j]))), off = v.some((x, j) => Math.abs(Math.round(compand(x) * 255) - w.srgb[j]) > 1);
      worst = Math.max(worst, d); if (off) bytes++;
      if (d > 1e-4 || off) bad.push(`${vars(c)} -> ${s}, spectral.js ${w.lrgb.map((x) => x.toFixed(6)).join(' ')}`);
    });
    failed ||= bad.length > 0;
    console.log(`${e[0]} ${form}: ${cases.length - bad.length} of ${cases.length} paint mixes within 1e-4 of spectral.js 3.0.0's mix() (worst ${worst.toExponential(2)} a channel in linear sRGB; ${bytes} with an sRGB byte off by more than 1)${bad.length ? `\n  ${bad.slice(0, 6).join('\n  ')}` : ''}`);
  }
  if (!fn) console.log(`${e[0]} function: no @function; not run`);
  await close();
}
const blue = spectral.mix([new spectral.Color('#002185'), 0.5], [new spectral.Color('#fcd200'), 0.5]);
console.log(`spectral.js: #002185 and #fcd200 at 50% each mix to ${blue.toString()}`);
process.exit(failed ? 1 : 0);
