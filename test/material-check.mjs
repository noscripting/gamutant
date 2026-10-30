// .gamut-palette-step against Material 3's tonal palette (material-color-utilities 0.4.0, its
// answers frozen in test/data/material-palettes.json): a list's steps at tones 95 (first) to
// 10 (last), and single steps at a --gamut-tone, each from an sRGB seed's HCT hue and chroma (times --gamut-chroma-scale),
// within 1/255 a channel of MCU's 8-bit color, in Chrome, WebKit and Firefox. Exits 1 on a fail.
// Usage: node test/material-check.mjs   (SHEET= another sheet, ENGINES= narrows)
import { readFileSync } from 'node:fs';
import { pick, open } from './engines.mjs';
import { hctOf, tone } from './ref/hct.mjs';

const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const { lists, singles } = JSON.parse(readFileSync(new URL('./data/material-palettes.json', import.meta.url), 'utf8'));
// tone 99 of a yellow hue, 105 to 125 degrees, is MCU's tones 98 and 100 averaged (the frozen file has none): from
// test/ref/hct.mjs, beside two outside it (#80c040 at 134, #4caf50 at 146). A review,
// 2026-10-28: #ffff00 gave #fffee1 for MCU's #ffffd6.
const lin = (h) => [1, 3, 5].map((i) => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
for (const [seed, rel] of [['#ffff00', 1], ['#ffff00', 0.5], ['#f0e68c', 1], ['#cddc39', 1], ['#a8d020', 1], ['#80c040', 1], ['#4caf50', 1],
  // the range's edges (HCT hue 103.57, 105.01, 105.71, 124.30, 125.13, 126.92): the flag read the hue 2 degrees off
  ['#ffe800', 1], ['#ffec00', 1], ['#ffee00', 1], ['#caff00', 1], ['#c6ff00', 1], ['#bdff00', 1]]) {
  const h = hctOf(lin(seed));
  singles.push({ seed, rel, tone: 99, want: tone(h.hue, h.chroma * rel, 99) });
}
// tone 99 of every hue: sRGB holds most reds to purples there only beside its magenta corner, #fffbff
// (src/tone99.json); seeds at HSL hues 0 to 350, saturations 100% and 40%, chroma times 1, 0.5 and 0.05 (whose
// Newton holds); the sheet was up to 30/255 off at 18 of 36 hues (2026-10-28)
const hsl = (hh, sat) => { const f = (n) => { const k = (n + hh / 30) % 12; return 0.5 - sat * 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0), f(8), f(4)]; };
const hex = (c) => `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
for (let hh = 0; hh < 360; hh += 10) for (const [sat, rel] of [[1, 1], [0.4, 1], [1, 0.5], [1, 0.05]]) {
  const seed = hex(hsl(hh, sat)), h = hctOf(lin(seed));
  singles.push({ seed, rel, tone: 99, want: tone(h.hue, h.chroma * rel, 99) });
}
// each step paints its result as an sRGB color, read back unrounded
const step = (extra = '') => `<i class="gamut-palette-step" style="display:block;${extra}color:color(from var(--gamut-out) srgb r g b)"></i>`;
const wrap = (c, inner) => `<div style="--gamut-target: srgb; --gamut-in: ${c.seed}; --gamut-chroma-scale: ${c.rel}">${inner}</div>`;
const body = [...lists.map((l) => wrap(l, l.tones.map(() => step()).join(''))), ...singles.map((c) => wrap(c, step(`--gamut-tone: ${c.tone};`)))].join('');
const want = [...lists.flatMap((l) => l.want.map((w, i) => ({ ...l, tone: l.tones[i], want: w, kind: `step ${i + 1} of ${l.tones.length}` }))), ...singles.map((c) => ({ ...c, kind: 'tone' }))];
let fails = 0;
for (const e of pick(['Chrome', 'WebKit', 'Firefox'])) {
  const { browser, page } = await open(e), name = e[0] ?? e.name;
  await page.setContent(`<style>${css}</style>${body}`);
  const got = await page.evaluate(() => [...document.querySelectorAll('.gamut-palette-step')].map((el) => {
    const m = getComputedStyle(el).color.match(/color\(srgb ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)/); return m ? m.slice(1, 4).map(Number) : null; }));
  let worst = 0, bad = [];
  // (a byte off is within 1/255: a yellow's tone 99 is on the 8-bit grid, #d4ff00 at rel 0.05 read back as 254.002 for
  // 254 against 253: its tone 98, 251.51, rounds up where MCU's rounds down, and the average takes the byte)
  want.forEach((c, i) => { const g = got[i], d = g ? Math.max(...g.map((v, k) => Math.abs(v * 255 - c.want[k]))) : Infinity;
    worst = Math.max(worst, d); if (!(d <= 1.005)) bad.push(`${c.seed} rel ${c.rel} ${c.kind} tone ${c.tone.toFixed(1)}: ${g ? g.map((v) => (v * 255).toFixed(1)).join(' ') : 'no color'}, want ${c.want.join(' ')}`); });
  if (bad.length) fails++;
  console.log(`${name}: ${bad.length ? 'FAIL' : 'PASS'} ${want.length - bad.length} of ${want.length} within 1/255 of material-color-utilities (worst ${Number.isFinite(worst) ? worst.toFixed(2) : 'none'}/255)${bad.length ? `\n  ${bad.slice(0, 6).join('\n  ')}` : ''}`);
  await browser.close();
}
process.exit(fails ? 1 : 0);
