// Checks .gamut-rec2100-pq, .gamut-rec2100-hlg and .gamut-rec2100-linear (build.mjs rec2100Part()) against CSS Color HDR's sample code
// (css-color-hdr-1/rec2100-pq.js, rec2100-hlg.js, rec2100-linear.js with CSS Color 4's lin_2020_to_XYZ), in Chrome,
// WebKit and Firefox: every channel on a grid of encoded values, the spec's named points (PQ 0.5807 and HLG 0.75 media
// white, PQ 0.34 and HLG 0.38 mid grey, PQ 1 peak), linear values past 1, and alpha. XYZ within 1e-4 of the reference,
// relative above 1 (Chrome converts and stores in 32-bit floats).
// Usage: node test/rec2100-check.mjs
import PW from './playwright.mjs'; // its Chrome is Chrome for Testing, never the installed Chrome.app
import { pick } from './engines.mjs';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const pw = PW;

// the spec's sample code, line for line
const pqDecode = (v) => { const ninv = 2 ** 14 / 2610, minv = 2 ** 5 / 2523, c1 = 3424 / 2 ** 12, c2 = 2413 / 2 ** 7, c3 = 2392 / 2 ** 7;
  const x = (Math.max(v ** minv - c1, 0) / (c2 - c3 * v ** minv)) ** ninv; return (x * 10000) / 203; };
const hlgDecode = (v) => { const a = 0.17883277, b = 0.28466892, c = 0.55991073, scale = 3.7743;
  return v <= 0.5 ? (v ** 2 / 3) * scale : ((Math.exp((v - c) / a) + b) / 12) * scale; };
const LIN2020_XYZ = [[63426534 / 99577255, 20160776 / 139408157, 47086771 / 278816314], [26158966 / 99577255, 472592308 / 697040785, 8267143 / 139408157], [0, 19567812 / 697040785, 295819943 / 278816314]];
const toXYZ = (rgb) => LIN2020_XYZ.map((r) => r[0] * rgb[0] + r[1] * rgb[1] + r[2] * rgb[2]);
export const rec2100 = (space, rgb) => toXYZ(rgb.map(space === 'pq' ? pqDecode : space === 'hlg' ? hlgDecode : (v) => v));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
  const GRID = [0, 0.05, 0.25, 0.38, 0.5, 0.58, 0.75, 0.9, 1];
  const cases = [];
  for (const space of ['pq', 'hlg', 'linear']) {
    for (const r of GRID) for (const g of [0, 0.5, 1]) for (const b of [0.25, 0.75]) cases.push([space, [r, g, b], 1]);
    cases.push([space, [0.5807, 0.5807, 0.5807], 1], [space, [0.75, 0.75, 0.75], 1], [space, [0.34, 0.34, 0.34], 0.5], [space, [0.38, 0.38, 0.38], 0]);
  }
  cases.push(['linear', [9.852, 9.852, 9.852], 1], ['linear', [2, 0.5, 0], 1], ['linear', [49.26, 49.26, 49.26], 1], ['pq', [1, 1, 1], 1]);
  const page = `<!doctype html><style>${css}</style>${cases.map(([s, [r, g, b], a]) => `<i class="gamut-rec2100-${s}" style="--gamut-rec2100-r: ${r}; --gamut-rec2100-g: ${g}; --gamut-rec2100-b: ${b}; --gamut-rec2100-alpha: ${a}"></i>`).join('')}`;
  let failed = false;
  for (const [name, type, opts] of pick()) {
    const b = await pw[type].launch(opts), p = await b.newPage();
    await p.setContent(page);
    const got = await p.evaluate(() => [...document.querySelectorAll('i')].map((e) => getComputedStyle(e).getPropertyValue('--gamut-out')));
    const bad = []; let worst = 0;
    cases.forEach(([s, rgb, a], i) => {
      const m = got[i].match(/^color\(xyz-d65 (\S+) (\S+) (\S+?)(?: \/ (\S+))?\)$/), want = rec2100(s, rgb);
      const off = m ? Math.max(...want.map((w, k) => Math.abs(+m[k + 1] - w) / Math.max(1, Math.abs(w)))) : Infinity;
      const alphaOK = m && Math.abs((m[4] === undefined ? 1 : +m[4]) - a) < 0.01;
      worst = Math.max(worst, off);
      if (!(off <= 1e-4) || !alphaOK) bad.push(`rec2100-${s} ${rgb.join(' ')} / ${a} -> ${got[i]}, want xyz-d65 ${want.map((w) => w.toFixed(6)).join(' ')}`);
    });
    failed ||= bad.length > 0;
    console.log(`${name}: ${cases.length - bad.length} of ${cases.length} within 1e-4 of CSS Color HDR's sample code (worst ${worst.toExponential(1)})${bad.length ? `\n  ${bad.slice(0, 6).join('\n  ')}` : ''}`);
    await b.close();
  }
  process.exit(failed ? 1 : 0);
}
