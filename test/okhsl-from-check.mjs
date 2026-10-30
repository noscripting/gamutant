// Checks .gamut-okhsl-from (build.mjs okhslFromPart()) against okhsl.mjs (ok_color.h in doubles), both ways, in Chrome,
// WebKit and Firefox: random colors (sRGB and some Display P3, some translucent), with l, s, both or neither replaced.
// A case passes when its sRGB bytes are at most 1 apart (1.5/255) and its alpha is kept; colors past sRGB or given s
// above 1 (Okhsl extrapolates there, and past its pole the reference's own s turns negative) are reported apart.
// Usage: node test/okhsl-from-check.mjs [cases]
import PW from './playwright.mjs'; // its Chrome is Chrome for Testing, never the installed Chrome.app
import { pick } from './engines.mjs';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { okhslToOklab, oklabToOkhsl } from './ref/okhsl.mjs';
const pw = PW;
const r2 = createRequire(import.meta.url); const cjs = r2('colorjs.io'); const Color = cjs.default ?? cjs;
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const N = +(process.argv[2] ?? 1000);
const read = (c) => { const k = new Color(c.replace(/-?[0-9.]+e[-+]?[0-9]+/g, (m) => (+m).toFixed(12))); return [...k.to('srgb').coords, k.alpha ?? 1]; };
let seed = 10110; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const cases = [];
for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#336699', '#ff3366', '#808080', '#ffffff', '#000000', '#ffcc00', '#7c3aed']) for (const o of [{}, { l: 0.9 }, { s: 0.5 }, { l: 0.3, s: 1 }]) cases.push({ c: hex, ...o });
// white and black at s 1: okhsl_to_srgb's own white and black, chroma under 1e-6 (a review, 2026-10-28: white
// at s 1 kept chroma 2.8e-6 in Chrome)
const ENDS = [{ c: 'white', s: 1, end: true }, { c: 'black', s: 1, end: true }, { c: '#ffffff', l: 1, s: 1, end: true }];
cases.push(...ENDS);
while (cases.length < N) {
  const a = rnd() < 0.1 ? ` / ${(0.2 + 0.8 * rnd()).toFixed(3)}` : '';
  const c = rnd() < 0.85 ? `rgb(${[0, 0, 0].map(() => Math.floor(rnd() * 256)).join(' ')}${a})` : `color(display-p3 ${[0, 0, 0].map(() => rnd().toFixed(4)).join(' ')}${a})`;
  const k = rnd(); cases.push({ c, ...(k < 0.3 ? {} : k < 0.55 ? { l: +rnd().toFixed(4) } : k < 0.8 ? { s: +rnd().toFixed(4) } : { l: +rnd().toFixed(4), s: +rnd().toFixed(4) }) });
}
for (const t of cases) {
  const col = new Color(t.c), [h, s, l] = oklabToOkhsl(...col.to('oklab').coords);
  t.want = [...new Color('oklab', okhslToOklab(h, t.s ?? s, t.l ?? l)).to('srgb').coords, col.alpha ?? 1];
  t.past = !col.inGamut('srgb', { epsilon: 1e-6 }) || (t.s ?? s) > 1.000001;
}
const page = `<!doctype html><style>${css}</style>${cases.map((t) => `<i class="gamut-okhsl-from" style="--gamut-in: ${t.c};${t.l != null ? ` --gamut-okhsl-l: ${t.l};` : ''}${t.s != null ? ` --gamut-okhsl-s: ${t.s};` : ''}${t.end ? ' color: oklch(from var(--gamut-out) l c h);' : ''}"></i>`).join('')}`;
let failed = false;
for (const [name, type, opts] of pick()) {
  const b = await pw[type].launch(opts), p = await b.newPage();
  await p.setContent(page);
  const got = await p.evaluate(() => [...document.querySelectorAll('i')].map((e) => getComputedStyle(e).getPropertyValue('--gamut-out')));
  // (the ends' chroma as the engine's own oklch() gives it: --gamut-out serializes 6 digits, 1e-6 of noise)
  const lch = await p.evaluate(() => [...document.querySelectorAll('i')].map((e) => getComputedStyle(e).color));
  const bad = []; let worst = 0, past = 0, pastWorst = 0;
  cases.forEach((t, i) => { let g; try { g = read(got[i]); } catch { bad.push(`${t.c}: unreadable ${got[i]}`); return; }
    const off = Math.max(...[0, 1, 2].map((k) => Math.abs(g[k] - t.want[k]))) * 255, offA = Math.abs(g[3] - t.want[3]) * 255;
    if (t.end && !(+lch[i].match(/oklch\(\S+ (\S+)/)?.[1] <= 1e-6)) bad.push(`${t.c} s ${t.s}: ${lch[i]}, not ${t.c === 'black' ? 'black' : 'white'}`);
    // past sRGB the channels extrapolate apart from the reference, but alpha doesn't
    if (t.past) { past++; pastWorst = Math.max(pastWorst, off); if (!(offA <= 2)) bad.push(`${t.c}: alpha ${g[3]}, want ${t.want[3]}`); return; }
    worst = Math.max(worst, off);
    if (!(off <= 1.5 && offA <= 2)) bad.push(`${t.c} l ${t.l ?? '-'} s ${t.s ?? '-'} -> ${got[i]}, want ${t.want.map((x) => x.toFixed(4)).join(' ')} (${off.toFixed(2)}/255)`); });
  failed ||= bad.length > 0;
  console.log(`${name}: ${cases.length - past - bad.length} of ${cases.length - past} within 1 of 255 of ok_color.h (worst ${worst.toFixed(3)}/255); ${past} past sRGB (a color past sRGB or s above 1: Okhsl extrapolates, and past its pole even the reference turns its s negative), worst ${pastWorst.toFixed(2)}/255${bad.length ? `\n  ${bad.slice(0, 8).join('\n  ')}` : ''}`);
  await b.close();
}
process.exit(failed ? 1 : 0);
