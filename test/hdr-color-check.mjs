// Checks .gamut-hdr-color (build.mjs hdrColorPart()) against CSS Color HDR §5.1, in Chrome, WebKit and Firefox: the draft's
// three worked examples within their printed digits (its absolute XYZ, given as xyz-d65 over 203 where a color is in a
// space no engine parses), then random pairs (sRGB, Display P3, HDR xyz-d65, translucent, some headrooms left to their
// defaults) against §5.1 in doubles (its +0.001 offset and 203 cd/m² scale) over the engine's own xyz-d65 of each
// color: within 1e-4 a channel (relative above 1) and 1/255 alpha (Firefox serializes a registered color's alpha to 2 or
// 3 decimals, QUIRKS.md Q4).
// Usage: node test/hdr-color-check.mjs [pairs=300]
import PW from './playwright.mjs'; // its Chrome is Chrome for Testing, never the installed Chrome.app
import { pick } from './engines.mjs';
import { readFileSync } from 'node:fs';
const pw = PW;
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const N = +(process.argv[2] ?? 300);
const xyz = (a) => `color(xyz-d65 ${a.map((v) => v / 203).join(' ')})`;
// CSS Color HDR §5.1's examples: c1, c2, H1, H2, H and the printed result in absolute XYZ
const EXAMPLES = [
  [xyz([173.156, 195.260, 178.003]), xyz([342.883, 389.315, 334.467]), 0, 2, 1, [243.664, 275.713, 244.000], 0.001],
  ['color(display-p3 1 1 0.33)', xyz([3776.1434, 4362.407, 1577.913]), 0.5, 4, 2, [611.911, 724.180, 157.650], 0.002],
  [xyz([63.6, 96.53, 8.558]), xyz([2521, 2508, 112.2]), 0, 4, 2.3, [527.68, 628.20, 37.59], 0.01],
];
let seed = 20261022; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const q = (x) => +x.toFixed(4);
const color = () => { const a = rnd() < 0.3 ? ` / ${q(rnd())}` : '', k = rnd();
  if (k < 0.4) return `rgb(${[0, 0, 0].map(() => Math.floor(rnd() * 256)).join(' ')}${a})`;
  if (k < 0.7) return `color(display-p3 ${q(rnd())} ${q(rnd())} ${q(rnd())}${a})`;
  const Y = q(rnd() * 10); return `color(xyz-d65 ${q(Y * (0.5 + rnd() * 0.6))} ${Y} ${q(Y * (0.3 + rnd() * 0.9))}${a})`; };
const cases = Array.from({ length: N }, () => {
  let h1 = q(rnd() * 4), h2 = q(rnd() * 4); if (h1 === h2) h2 += 0.5;
  const c = { c1: color(), c2: color(), h1, h2, h: q(-1 + rnd() * 6) };
  if (rnd() < 0.1) delete c.h1; if (rnd() < 0.1) delete c.h2; if (rnd() < 0.1) delete c.h;
  if ((c.h1 ?? 0) === (c.h2 ?? 1)) c.h2 = (c.h1 ?? 0) + 1;
  return c; });
// a headroom not a number reads as 0, with the first color's headroom above the second's too (a review,
// 2026-10-29: the weight took its initial 0 there, the first color, for the second)
cases.push(...['none', '1px', 'foo'].flatMap((h) => [{ c1: 'black', c2: 'white', h1: 1, h2: 0, h }, { c1: 'black', c2: 'white', h1: 0, h2: 1, h }]));
const style = (c) => `--gamut-hdr-1: ${c.c1}; --gamut-hdr-2: ${c.c2};${c.h1 !== undefined ? ` --gamut-hdr-h1: ${c.h1};` : ''}${c.h2 !== undefined ? ` --gamut-hdr-h2: ${c.h2};` : ''}${c.h !== undefined ? ` --gamut-headroom: ${c.h};` : ''}`;
const html = `<!doctype html><style>${css}</style>${EXAMPLES.map(([a, b, h1, h2, h]) => `<i class="gamut-hdr-color ex" style="${style({ c1: a, c2: b, h1, h2, h })}"></i>`).join('')}${cases.map((c) => `<i class="gamut-hdr-color" style="${style(c)}"></i>`).join('')}<b></b>`;
const parse = (s) => { const m = s.match(/color\(xyz(?:-d65)? ([^ ]+) ([^ ]+) ([^ )/]+)(?: \/ ([^)]+))?\)/); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null; };
let failed = false;
for (const [name, type, opts] of pick()) {
  const b = await pw[type].launch(opts), p = await b.newPage();
  await p.setContent(html);
  const got = await p.evaluate(() => [...document.querySelectorAll('i')].map((e) => getComputedStyle(e).getPropertyValue('--gamut-out').trim()));
  // the engine's own xyz-d65 of each input color
  const own = await p.evaluate((cs) => { const e = document.querySelector('b');
    return cs.map((c) => { e.style.color = `color(from ${c} xyz-d65 x y z / alpha)`; return getComputedStyle(e).color; }); }, [...new Set(cases.flatMap((c) => [c.c1, c.c2]))]);
  await b.close();
  const ownOf = Object.fromEntries([...new Set(cases.flatMap((c) => [c.c1, c.c2]))].map((c, i) => [c, parse(own[i])]));
  const exBad = [];
  EXAMPLES.forEach(([, , , , , want, tol], i) => { const g = parse(got[i]); const d = g ? Math.max(...want.map((v, k) => Math.abs(g[k] * 203 - v))) : Infinity;
    if (!(d <= tol)) exBad.push(`example ${i + 1}: ${g ? g.slice(0, 3).map((v) => (v * 203).toFixed(3)).join(' ') : got[i]}, want ${want.join(' ')}`); });
  const bad = []; let worst = 0;
  cases.forEach((c, i) => {
    const a = ownOf[c.c1], bb = ownOf[c.c2], h1 = c.h1 ?? 0, h2 = c.h2 ?? 1, h = typeof c.h === 'number' ? c.h : 0;
    const w = Math.min(1, Math.max(0, (h - h1) / (h2 - h1)));
    const want = [0, 1, 2].map((k) => (Math.pow(a[k] * 203 + 0.001, 1 - w) * Math.pow(bb[k] * 203 + 0.001, w) - 0.001) / 203);
    const al = (x) => +(x.match(/\/ ([\d.]+)\)$/)?.[1] ?? 1); // the alpha as written: Firefox prints a computed one rounded
    want.push(al(c.c1) * (1 - w) + al(c.c2) * w);
    const g = parse(got[EXAMPLES.length + i]);
    const d = g ? Math.max(...[0, 1, 2].map((k) => Math.abs(g[k] - want[k]) / Math.max(1, Math.abs(want[k])))) : Infinity, dA = g ? Math.abs(g[3] - want[3]) : Infinity;
    worst = Math.max(worst, d);
    if (!(d <= 1e-4 && dA <= 1 / 255)) bad.push(`${c.c1} at ${h1}, ${c.c2} at ${h2}, headroom ${h}: ${got[EXAMPLES.length + i]}, want ${want.map((v) => v.toFixed(6)).join(' ')}`);
  });
  failed ||= exBad.length + bad.length > 0;
  console.log(`${name}: the draft's examples ${3 - exBad.length} of 3; random ${cases.length - bad.length} of ${cases.length} within 1e-4 of §5.1, worst ${worst.toExponential(1)}${[...exBad, ...bad].length ? `\n  ${[...exBad, ...bad].slice(0, 5).join('\n  ')}` : ''}`);
}
console.log(failed ? 'FAIL' : 'PASS');
process.exit(failed ? 1 : 0);
