// Checks .gamut-okhsl (build.mjs okhslPart()) against okhsl.mjs, ok_color.h's okhsl_to_srgb ported in doubles, in
// Chrome, WebKit and Firefox: the hue circle at every degree, the corners, random h, s, l. A case passes when its sRGB
// bytes are at most 1 apart (1.5/255).
// Usage: node test/okhsl-check.mjs [cases]
import PW from './playwright.mjs'; // its Chrome is Chrome for Testing, never the installed Chrome.app
import { pick } from './engines.mjs';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { okhslToOklab, setBranch, atCorner } from './ref/okhsl.mjs';
const pw = PW;
const r2 = createRequire(import.meta.url); const cjs = r2('colorjs.io'); const Color = cjs.default ?? cjs;
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const N = +(process.argv[2] ?? 2000);
const srgb = (c) => new Color(c.replace(/-?[0-9.]+e[-+]?[0-9]+/g, (m) => (+m).toFixed(12))).to('srgb').coords.map((x) => (Number.isNaN(x) ? 0 : x));
const cases = [];
for (let h = 0; h < 360; h++) cases.push([h, 1, 0.5]);
for (const h of [0, 29.2339, 90, 142.4953, 180, 264.052, 300]) for (const s of [0, 0.5, 0.8, 1]) for (const l of [0, 0.001, 0.25, 0.5, 0.75, 0.999, 1]) cases.push([h, s, l]);
let seed = 8659; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
while (cases.length < N) cases.push([+(rnd() * 360).toFixed(3), +rnd().toFixed(4), +rnd().toFixed(4)]);
const want = cases.map(([h, s, l]) => new Color('oklab', okhslToOklab(h, s, l)).to('srgb').coords);
// at the blue corner a browser's hue lands on either side of ok_color.h's branch test: either branch's answer, counted apart
const corner = cases.map(([h]) => atCorner(Math.cos(h * Math.PI / 180), Math.sin(h * Math.PI / 180)));
const alt = cases.map(([h, s, l], i) => (corner[i] ? ['red', 'green'].map((br) => { setBranch(br); const c = new Color('oklab', okhslToOklab(h, s, l)).to('srgb').coords; setBranch(null); return c; }) : []));
// near black, the chroma itself within 1% of ok_color.h's (its bytes are 0 either way): at l 1e-8 the chroma of the
// lightness floor, 1e-6, came out 17 times too much (a review, 2026-10-29)
// (near white, above the ceiling 0.999999, no engine reads a chroma: 0 at l 0.9999999 from either sheet, 2026-10-29)
const DARK = [[0, 1, 1e-8], [140, 1, 1e-7], [264, 0.5, 3e-7]].map(([h, s, l]) => { const lab = okhslToOklab(h, s, l); return { h, s, l, lab, c: Math.hypot(...lab.slice(1)) }; });
const page = `<!doctype html><style>${css}</style>${cases.map(([h, s, l]) => `<i class="gamut-okhsl" style="--gamut-okhsl-h: ${h}; --gamut-okhsl-s: ${s}; --gamut-okhsl-l: ${l}"></i>`).join('')}${DARK.map((d) => `<b class="gamut-okhsl" style="--gamut-okhsl-h: ${d.h}; --gamut-okhsl-s: ${d.s}; --gamut-okhsl-l: ${d.l}; color: oklch(from var(--gamut-out) l c h)"></b><u style="color: oklch(from oklab(${d.lab.join(' ')}) l c h)"></u>`).join('')}`;
let failed = false;
for (const [name, type, opts] of pick()) {
  const b = await pw[type].launch(opts), p = await b.newPage();
  await p.setContent(page);
  const got = await p.evaluate(() => [...document.querySelectorAll('i')].map((e) => getComputedStyle(e).getPropertyValue('--gamut-out')));
  const dark = await p.evaluate(() => [...document.querySelectorAll('b')].map((e) => getComputedStyle(e).color));
  // the engine's own oklch() of the reference: where it flushes that to black, black is its answer too
  const own = await p.evaluate(() => [...document.querySelectorAll('u')].map((e) => getComputedStyle(e).color));
  const bad = []; let worst = 0, atC = 0, worstAt = '';
  cases.forEach((c, i) => { let g; try { g = srgb(got[i]); } catch { bad.push(`${c}: unreadable ${got[i]}`); return; }
    const offTo = (w) => Math.max(...[0, 1, 2].map((k) => Math.abs(g[k] - w[k]))) * 255, off = offTo(want[i]);
    if (!(off <= 1.5) && alt[i].some((w) => offTo(w) <= 1.5)) { atC++; return; }
    if (off > worst) { worst = off; worstAt = c.join(' '); }
    if (!(off <= 1.5)) bad.push(`okhsl(${c.join(' ')}) -> ${got[i]}, ${off.toFixed(2)}/255 off`);
    // l 1 is white and l 0 black exactly, as okhsl_to_srgb returns them (a review, 2026-10-28: chroma 2.7e-6 at l 1)
    if ((c[2] === 1 || c[2] === 0) && new Color(got[i]).to('oklch').coords[1] > 1e-9) bad.push(`okhsl(${c.join(' ')}) -> ${got[i]}, not ${c[2] ? 'white' : 'black'}`); });
  // (black passes only where the browser flushes the reference itself to black)
  let knownDark = 0;
  DARK.forEach((d, i) => { const [L, C] = dark[i].match(/oklch\((\S+) (\S+)/).slice(1).map(Number), [L0, C0] = own[i].match(/oklch\((\S+) (\S+)/).slice(1).map(Number);
    // known, by name: WebKit 26.4's calc() flushes lightness 1e-7 and 3e-7 to black where its own oklch() keeps a chroma
    // of 2e-7 (2026-10-30; 1e-5 of a byte); Chrome 155 and Firefox 158 keep it
    if (name === 'WebKit' && L === 0 && C === 0 && (d.l === 1e-7 || d.l === 3e-7)) { knownDark++; return; }
    if (!(L === 0 && C === 0 && L0 === 0 && C0 === 0) && !(Math.abs(C - d.c) <= 0.01 * d.c)) bad.push(`okhsl(${d.h} ${d.s} ${d.l}): chroma ${C}, ok_color.h ${d.c.toPrecision(6)}`); });
  failed ||= bad.length > 0;
  console.log(`${name}: ${cases.length - bad.length} of ${cases.length} within 1 of 255 of ok_color.h as written (worst ${worst.toFixed(3)}/255 at okhsl(${worstAt}))${atC ? `, ${atC} at the blue corner on its other branch` : ''}${knownDark ? `; ${knownDark} near-blacks WebKit flushes to black (known)` : ''}${bad.length ? `\n  ${bad.slice(0, 8).join('\n  ')}` : ''}`);
  await b.close();
}
process.exit(failed ? 1 : 0);
