// Checks .gamut-readable-text's seed and range (--gamut-readable-from, --gamut-readable-to; csswg-drafts #5153, #7360,
// #11619's third case) in Chrome, WebKit and Firefox, against the search done in JS on the painted 8-bit colors (WCAG 2,
// as contrast-check.mjs models it): the range from the seed to the end (white or black when no end is given) is the
// seed's linear sRGB channels mixed toward the end's, and its first color that reaches the ratio against the painted
// background is found by 60 halvings of the mix's weight, never by the closed form the sheet uses. The seed when it
// already reaches the ratio; the end with more contrast, the seed or the end, when no color in the range does. With no
// end: white or black, whichever gives the background more contrast, except when both reach the ratio and the seed is
// lighter or darker than the background, then away from it. Each text channel encoded and rounded toward the end's
// luminance (up when the end is lighter), to a whole byte where the result is the seed or the end.
// PASS when every patch paints within 1/255 a channel of the search's color, and every one the search finds reaching
// the ratio paints at least the ratio. Cases: 1,536 random seeds on random backgrounds at ratios 3, 4.5 and 7, each
// with no end, white, black and a random end; csswg-drafts #5153's example and named cases; with no seed, the
// background's own shade as before (contrast-check.mjs). The search: test/ref/readable.mjs. Chrome also calls --gamut-readable-text() with the seed and
// end and compares it with the class, within 1e-4. SHEET= another sheet; ENGINES= to pick.
// Usage: node test/contrast-seed-check.mjs
import { readFileSync } from 'node:fs';
import { pw, need, pick } from './engines.mjs';
import { lum8 } from './ref/methods.mjs';
import { search, ratioY } from './ref/readable.mjs';
const { PNG } = need('pngjs');
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');

let seed = 20261027; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const byte = () => Math.floor(rnd() * 256), rgb = () => [byte(), byte(), byte()];
const css8 = (c) => `rgb(${c.join(' ')})`;
// cases: [bg, seed, end, R, label]; seed or end undefined: not set
const cases = [];
for (const R of [3, 4.5, 7]) for (let i = 0; i < 128; i++) {
  const bg = rgb(), s = rgb();
  cases.push([bg, s, undefined, R, 'seed'], [bg, s, [255, 255, 255], R, 'seed to white'], [bg, s, [0, 0, 0], R, 'seed to black'], [bg, s, rgb(), R, 'range']);
}
const named = { wheat: [245, 222, 179], rebeccapurple: [102, 51, 153], tan: [210, 180, 140], white: [255, 255, 255], black: [0, 0, 0], '#3399ff': [51, 153, 255], '#808080': [128, 128, 128], gold: [255, 215, 0], navy: [0, 0, 128] };
const N = (k) => named[k];
for (const [bg, s, e, R, what] of [
  ['wheat', 'rebeccapurple', 'white', 3, "#5153's example: lighten rebeccapurple on wheat to 3:1 (it already reaches 3)"],
  ['wheat', 'tan', 'black', 4.5, 'darken tan on wheat to 4.5:1'],
  ['wheat', 'tan', 'white', 4.5, 'lighten tan on wheat: nothing in the range reaches, the seed contrasts more than white'],
  ['wheat', 'tan', undefined, 4.5, 'tan on wheat, no end: darker'],
  ['#808080', 'white', undefined, 3, 'white on grey reaches 3: kept'],
  ['#808080', '#3399ff', undefined, 3, 'a seed lighter than the background, both ends reach 3: lighter'],
  ['navy', 'rebeccapurple', undefined, 7, 'rebeccapurple on navy at 7: lighter'],
  ['#3399ff', 'gold', 'navy', 4.5, 'a range from gold to navy on #3399ff'],
  ['#3399ff', undefined, undefined, 4.5, 'no seed: the background\'s own shade'],
  ['wheat', undefined, 'white', 3, 'no seed, the end white on wheat: nothing reaches, white contrasts more than wheat'],
]) cases.push([N(bg), s && N(s), e && N(e), R, what, [bg, s, e]]);

const style = ([bg, s, e, R]) => `--gamut-bg: ${css8(bg)}; --gamut-ratio: ${R}${s ? `; --gamut-readable-from: ${css8(s)}` : ''}${e ? `; --gamut-readable-to: ${css8(e)}` : ''}`;
const page = `<style>${css} body{margin:0} #g{display:grid;grid-template-columns:repeat(64,8px);grid-auto-rows:8px} #g i{background:var(--gamut-bg)} #g i b{display:block;margin:2px;height:4px;background:var(--gamut-text)}</style>
<div id=g>${cases.map((c) => `<i class=gamut-readable-text style="${style(c)}"><b></b></i>`).join('')}</div>`;

let failed = false;
for (const [n, t, o] of pick()) {
  const b = await pw[t].launch(o), p = await b.newPage({ viewport: { width: 512, height: 8 * Math.ceil(cases.length / 64) } });
  await p.setContent(page);
  const img = PNG.sync.read(await p.screenshot());
  const groups = {};
  cases.forEach((c, i) => {
    const x = (i % 64) * 8, y = Math.floor(i / 64) * 8, at = (dx, dy) => { const q = ((y + dy) * img.width + x + dx) * 4; return [img.data[q], img.data[q + 1], img.data[q + 2]]; };
    const bg = at(0, 0), fg = at(4, 4), [want, reached] = search(bg, c[1] ?? bg, c[2], c[3]);
    const d = Math.max(...want.map((v, k) => Math.abs(v - fg[k]))), r = ratioY(lum8(fg), lum8(bg));
    const g = (groups[c.length > 5 ? 'named' : `${c[4]} R=${c[3]}`] ??= { n: 0, off: 0, short: 0, reach: 0, worst: 0, ex: [] });
    g.n++; if (reached) g.reach++;
    if (d > 1) { g.off++; g.ex.push(`bg ${bg} seed ${c[1] ?? '-'} end ${c[2] ?? '-'} R ${c[3]}: ${fg}, want ${want}`); }
    if (reached && r < c[3]) { g.short++; g.ex.push(`bg ${bg} seed ${c[1] ?? '-'} end ${c[2] ?? '-'} R ${c[3]}: ${fg} at ${r.toFixed(4)}`); }
    g.worst = Math.max(g.worst, d);
    if (c.length > 5) console.log(`${n} ${d <= 1 && !(reached && r < c[3]) ? 'PASS' : 'FAIL'} ${c[4]}: ${c[5].map((v) => v ?? '-').join(' / ')} -> ${fg} (${r.toFixed(2)}:1), the search ${want}`);
  });
  const all = Object.values(groups).reduce((a, g) => ({ n: a.n + g.n, reach: a.reach + g.reach, off: a.off + g.off, short: a.short + g.short, worst: Math.max(a.worst, g.worst) }), { n: 0, reach: 0, off: 0, short: 0, worst: 0 });
  console.log(`${n} all: ${!all.off && !all.short ? 'PASS' : 'FAIL'} ${all.n - all.off} of ${all.n} within 1/255 of the search (worst ${all.worst}/255); ${all.reach - all.short} of ${all.reach} the search makes reach the ratio reach it painted`);
  for (const [k, g] of Object.entries(groups)) {
    const ok = !g.off && !g.short; failed ||= !ok;
    if (k !== 'named') console.log(`${n} ${k}: ${ok ? 'PASS' : 'FAIL'} ${g.n} cases, ${g.reach} reach; off the search by more than 1/255: ${g.off}; reaching below the ratio: ${g.short}; worst ${g.worst}/255${g.ex.length ? `; e.g. ${g.ex.slice(0, 2).join('; ')}` : ''}`);
    else if (!ok) console.log(`${n} named: FAIL`);
  }
  if (n === 'Chrome') { // the function form against the class
    const fc = cases.filter((c, i) => i % 7 === 0 && c[1]);
    await p.setContent(`<style>${css} @property --f { syntax: '<color>'; inherits: false; initial-value: transparent; }</style>${fc.map((c) => `<i class=gamut-readable-text style="${style(c)}; --f: --gamut-readable-text(${css8(c[0])}, ${c[3]}, ${css8(c[1])}, ${c[2] ? css8(c[2]) : 'none'})"></i>`).join('')}`);
    const diff = await p.evaluate(() => [...document.querySelectorAll('i')].map((e) => { const s = getComputedStyle(e), v = (n) => s.getPropertyValue(n).match(/-?[\d.e+-]+/g)?.map(Number) ?? [];
      const a = v('--gamut-text'), f = v('--f'); return a.length && f.length === a.length ? Math.max(...a.map((x, i) => Math.abs(x - f[i]))) : Infinity; }));
    const bad = diff.filter((d) => !(d <= 1e-4)).length; failed ||= bad > 0;
    console.log(`${n} --gamut-readable-text(bg, ratio, seed, end): ${bad ? 'FAIL' : 'PASS'} ${diff.length - bad} of ${diff.length} within 1e-4 of the class`);
  }
  await b.close();
}
process.exit(failed ? 1 : 0);
