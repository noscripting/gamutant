// Checks .gamut-fit-screen on the colors posted in csswg-drafts #9449 ("Channel clipping breaks author expectations"), sRGB
// and Display P3 targets, in Chrome, WebKit and Firefox: each computed --gamut-out, parsed and converted in JS, against
// Color.js 0.7.1's css method in the target's channels, within 1/255. Then the one color the thread wrote in four
// notations: each against Color.js on the engine's own reading of it, and the outputs of oklch, display-p3 and lab within
// 1/255 of each other. hwb() with a negative blackness is read as written by WebKit and clamped to 0 by Chrome and
// Firefox before the sheet sees it (csswg-drafts #10368, open), so its output joins the three only where it is kept.
// Usage: node test/issue-9449-check.mjs
// The posts' own numbers are noted by each color; where a post's number differs, Color.js 0.7.1 is the key (the thread
// ran earlier versions of the algorithm).
// Optional: GATE_BATCH=1 GATE_RSS_MIB=512 GATE_REPORT=memory.json (RSS requires Chrome).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pw, pick } from './engines.mjs';
import { readFixture } from './renderer-budget.mjs';
const C0 = createRequire(import.meta.url)('colorjs.io'), Color = C0.default ?? C0;
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const INS = [
  // matuzo, comment 211: near-white tints from a site, which clip to saturated colors
  'oklch(99% .12 182.55)', 'oklch(99% .20 9.96)',
  // jamesnw, comment 3: lightness 0 and 100 with chroma, meant to come out black or white
  'lab(0 -67 -125)', 'lab(100 115 -125)', 'lch(0 141.82 241.81)', 'lch(100 169.85 312.61)',
  'oklab(0 -0.4 -0.4)', 'oklab(1 0.287 -0.351)', 'oklch(0 0.5657 225)', 'oklch(1 0.4535 309.26)',
  // eeeps, comment 152: clips to #ff1b43, maps to #ff4050 (sRGB)
  'color(display-p3 1 0.25 0.3)',
  // ccameron-chromium, comment 154: clips to #00ff00, maps to #00fb28 (sRGB; Color.js 0.7.1 gives #00fb29)
  'color(display-p3 0 1 0)',
];
// romainmenke, comment 102: one color in four notations (svgeesus, comment 9: maps to rgb(100% 73.3771% 82.2121%) in
// sRGB with the 2023 algorithm; Color.js 0.7.1 gives #ffc8dc)
const SAME = ['oklch(90% 90% 0deg)', 'color(display-p3 1.406 0.347 0.823)', 'hwb(329.3 10.37% -52.94%)', 'lab(83.87 115.6 1.847)'];
const GAMUTS = { srgb: 'srgb', 'display-p3': 'p3' };
const all = [...INS, ...SAME];
const html = `<!doctype html><style>${css}</style><body>${Object.keys(GAMUTS).map((g) => `<div style="--gamut-target: ${g}">${all.map((c) => `<i class="gamut-fit-screen" data-g="${g}" data-in="${c}" style="--gamut-in: ${c}"></i>`).join('')}</div>`).join('')}${SAME.map((c) => `<b data-in="${c}" style="color: color(from ${c} xyz-d65 x y z)"></b>`).join('')}</body>`;
const to255 = (cs) => cs.map((v) => (v * 255).toFixed(1)).join(' ');
let failed = false;
for (const [name, type, opts] of pick()) {
  const b = await pw[type].launch(opts), p = await b.newPage();
  let got, read;
  try { [got, read] = await readFixture(b, p, name, html, () => [[...document.querySelectorAll('i')].map((e) => [e.dataset.g, e.dataset.in, getComputedStyle(e).getPropertyValue('--gamut-out').trim()]),
    Object.fromEntries([...document.querySelectorAll('b')].map((e) => [e.dataset.in, getComputedStyle(e).color]))]); }
  finally { await b.close(); }
  const bad = [], have = {};
  let off255 = 0;
  for (const [g, input, out] of got) {
    const sp = GAMUTS[g], want = new Color(read[input] ?? input).toGamut({ space: sp, method: 'css' }).to(sp).coords;
    try { have[`${g} ${input}`] = new Color(out).to(sp).coords; } catch { off255++; bad.push(`${g} ${input}: ${out}`); continue; }
    const off = Math.max(...have[`${g} ${input}`].map((v, i) => Math.abs(v - want[i]) * 255));
    if (!(off <= 1)) off255++, bad.push(`${g} ${input}: ${to255(have[`${g} ${input}`])} want ${to255(want)}`);
  }
  const kept = new Color(read[SAME[2]]).deltaEOK(new Color(SAME[0])) < 0.01;
  const group = kept ? SAME : SAME.filter((c) => !c.startsWith('hwb'));
  for (const g of Object.keys(GAMUTS)) {
    const outs = group.map((c) => have[`${g} ${c}`]).filter(Boolean);
    const spread = Math.max(...[0, 1, 2].map((k) => Math.max(...outs.map((o) => o[k])) - Math.min(...outs.map((o) => o[k])))) * 255;
    if (outs.length !== group.length || !(spread <= 1)) bad.push(`${g}: ${group.length} notations of oklch(90% 90% 0deg) ${spread.toFixed(2)}/255 apart`);
  }
  failed ||= bad.length > 0;
  console.log(`${name}: ${got.length - off255} of ${got.length} colors from #9449 within 1/255 of Color.js; oklch(90% 90% 0deg) in ${group.length} notations within 1/255 of each other${kept ? '' : ' (hwb()\'s negative blackness clamped by the engine, #10368)'}${bad.length ? `; off: ${bad.slice(0, 4).join(', ')}` : ''}`);
}
console.log(failed ? 'FAIL' : 'PASS');
process.exit(failed ? 1 : 0);
