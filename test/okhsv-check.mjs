// Checks .gamut-okhsv (build.mjs okhsvPart()) against okhsl.mjs's okhsvToOklab, ok_color.h's okhsv_to_srgb ported in doubles,
// in Chrome, WebKit and Firefox: the hue circle at every degree, the corners, random h, s, v. A case passes when its sRGB
// bytes are at most 1 apart (1.5/255), as .gamut-okhsl's. At the blue corner a browser's hue lands on either side of
// ok_color.h's branch tests: any branch's answer passes there, counted apart, as in okhsl-check.mjs.
// Usage: node test/okhsv-check.mjs [cases]
import PW from './playwright.mjs'; // its Chrome is Chrome for Testing, never the installed Chrome.app
import { pick } from './engines.mjs';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { okhsvToOklab, setBranch, atCorner } from './ref/okhsl.mjs';
const pw = PW;
const cjs = createRequire(import.meta.url)('colorjs.io'), Color = cjs.default ?? cjs;
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const N = +(process.argv[2] ?? 2000);
const srgb = (c) => new Color(c.replace(/-?[0-9.]+e[-+]?[0-9]+/g, (m) => (+m).toFixed(12))).to('srgb').coords.map((x) => (Number.isNaN(x) ? 0 : x));
const cases = [];
for (let h = 0; h < 360; h++) cases.push([h, 1, 1]);
for (const h of [0, 29.2339, 90, 142.4953, 180, 264.052, 300]) for (const s of [0, 0.5, 0.8, 1]) for (const v of [0, 0.001, 0.25, 0.5, 0.75, 0.999, 1]) cases.push([h, s, v]);
let seed = 8659; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
while (cases.length < N) cases.push([+(rnd() * 360).toFixed(3), +rnd().toFixed(4), +rnd().toFixed(4)]);
const want = cases.map((c) => new Color('oklab', okhsvToOklab(...c)).to('srgb').coords);
const corner = cases.map(([h]) => atCorner(Math.cos(h * Math.PI / 180), Math.sin(h * Math.PI / 180)));
const alt = cases.map((c, i) => (corner[i] ? ['red', 'green', 'blue'].map((br) => { setBranch(br); const x = new Color('oklab', okhsvToOklab(...c)).to('srgb').coords; setBranch(null); return x; }) : []));
const page = `<!doctype html><style>${css}</style>${cases.map(([h, s, v]) => `<i class="gamut-okhsv" style="--gamut-okhsv-h: ${h}; --gamut-okhsv-s: ${s}; --gamut-okhsv-v: ${v}"></i>`).join('')}`;
let failed = false;
for (const [name, type, opts] of pick()) {
  const b = await pw[type].launch(opts), p = await b.newPage();
  await p.setContent(page);
  const got = await p.evaluate(() => [...document.querySelectorAll('i')].map((e) => getComputedStyle(e).getPropertyValue('--gamut-out')));
  const bad = []; let worst = 0, atC = 0, worstAt = '';
  cases.forEach((c, i) => { let g; try { g = srgb(got[i]); } catch { bad.push(`${c}: unreadable ${got[i]}`); return; }
    const offTo = (w) => Math.max(...[0, 1, 2].map((k) => Math.abs(g[k] - w[k]))) * 255, off = offTo(want[i]);
    if (!(off <= 1.5) && alt[i].some((w) => offTo(w) <= 1.5)) { atC++; return; }
    if (off > worst) { worst = off; worstAt = c.join(' '); }
    if (!(off <= 1.5)) bad.push(`okhsv(${c.join(' ')}) -> ${got[i]}, ${off.toFixed(2)}/255 off`); });
  failed ||= bad.length > 0;
  console.log(`${name}: ${cases.length - bad.length} of ${cases.length} within 1 of 255 of ok_color.h as written (worst ${worst.toFixed(3)}/255 at okhsv(${worstAt}))${atC ? `, ${atC} at the blue corner on its other branch` : ''}${bad.length ? `\n  ${bad.slice(0, 8).join('\n  ')}` : ''}`);
  await b.close();
}
process.exit(failed ? 1 : 0);
