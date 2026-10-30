// .gamut-okhsl and .gamut-okhsv under --gamut-target: display-p3 against ColorAide's own conversions run with the Okhsl P3 constants
// Isaac Muse published for csswg-drafts #8659 (frozen in test/data/okhsl-p3-coloraide.json):
// each result within 1/255 a channel of ColorAide's display-p3, in Chrome, WebKit and Firefox, and the functions in Chrome.
// Within 2 degrees of the P3 blue primary's hue, where the two branch tests meet and one Halley step from the polynomial
// falls short, ColorAide's answer can be far from Okhsl's own model (24/255 at 264.05, s 1, l 0.38284): there a result
// passes within 1/255 of either ColorAide or the model run numerically (test/ref/okhsl.mjs exact()).
// Exits 1 on a fail. Usage: node test/okhsl-coloraide-check.mjs   (SHEET= another sheet, ENGINES= narrows)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pick, open } from './engines.mjs';
import { exact, okhslToOklab, okhsvToOklab } from './ref/okhsl.mjs';
import { gamut } from './ref/classes.mjs';

const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const { cases } = JSON.parse(readFileSync(new URL('./data/okhsl-p3-coloraide.json', import.meta.url), 'utf8'));
const v = { okhsl: ['s', 'l'], okhsv: ['s', 'v'] };
const cjs = createRequire(import.meta.url)('colorjs.io'), Color = cjs.default ?? cjs, X = exact('display-p3');
const blue = new Color('p3-linear', [0, 0, 1]).to('oklch').coords[2], nearBlue = (h) => Math.abs(((h - blue + 540) % 360) - 180) < 2;
for (const c of cases) if (nearBlue(c.h)) c.model = new Color('oklab', (c.part === 'okhsl' ? okhslToOklab : okhsvToOklab)(c.h, c.s, c.x, X)).to('p3').coords;
const cls = (c) => `<i class="${gamut(c.part)}" style="display:block;--gamut-${c.part}-h:${c.h};--gamut-${c.part}-${v[c.part][0]}:${c.s};--gamut-${c.part}-${v[c.part][1]}:${c.x};color:color(from var(--gamut-out) display-p3 r g b)"></i>`;
const fn = (c) => `<i style="display:block;color:color(from --gamut-${c.part}(${c.h}, ${c.s}, ${c.x}) display-p3 r g b)"></i>`;
let fails = 0;
for (const e of pick(['Chrome', 'WebKit', 'Firefox'])) {
  const { browser, page } = await open(e), name = e[0] ?? e.name, chrome = /chrom/i.test(String(e));
  for (const [label, el] of [['class', cls], ...(chrome ? [['function', fn]] : [])]) {
    await page.setContent(`<style>${css}</style><div style="--gamut-target: display-p3">${cases.map(el).join('')}</div>`);
    const got = await page.evaluate(() => [...document.querySelectorAll('i')].map((i) => { const m = getComputedStyle(i).color.match(/display-p3 ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)/); return m ? m.slice(1).map(Number) : null; }));
    let worst = 0; const bad = [];
    let corner = 0;
    cases.forEach((c, i) => { const g = got[i], off = (w) => (g ? Math.max(...g.map((x, k) => Math.abs(x - w[k]) * 255)) : Infinity);
      let d = off(c.p3); if (c.model && !(d <= 1) && off(c.model) <= 1) { d = off(c.model); corner++; } worst = Math.max(worst, d);
      if (!(d <= 1)) bad.push(`${c.part} ${c.h} ${c.s} ${c.x}: ${g ? g.map((x) => (x * 255).toFixed(2)).join(' ') : 'none'}, ColorAide ${c.p3.map((x) => (x * 255).toFixed(2)).join(' ')}`); });
    if (bad.length) fails++;
    console.log(`${name} ${label}: ${bad.length ? 'FAIL' : 'PASS'} ${cases.length - bad.length} of ${cases.length} within 1/255 of ColorAide (worst ${worst.toFixed(3)}/255${corner ? `; ${corner} at the blue corner by the model` : ''})${bad.length ? `\n  ${bad.slice(0, 5).join('\n  ')}` : ''}`);
  }
  await browser.close();
}
process.exit(fails ? 1 : 0);
