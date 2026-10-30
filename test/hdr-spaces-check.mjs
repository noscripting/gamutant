// Checks .gamut-jzazbz, .gamut-jzczhz and .gamut-ictcp (build.mjs hdrSpacesPart()) by round trip through CSS Color HDR's own encoders
// (css-color-hdr-1/jzazbz.js XYZ_to_Jzazbz, ICtCp.js XYZ_to_ICtCp with Yw 203, which run as written; its decoders
// don't): 200 random sRGB colors and HDR colors up to 52 times media white are encoded in JS, decoded by the sheet
// in Chrome, WebKit and Firefox, and must come back to their XYZ within 2e-4 (relative above 1; the PQ inverse
// reads a stored logarithm, not a stored value near 1, which left 4.2e-4 near 10,000 cd/m²), and each one's alpha input
// (unset, 0.5, 0.25) must come back exactly. The encoders are
// first held against Color.js's jzazbz and ictcp.
// Usage: node test/hdr-spaces-check.mjs
import PW from './playwright.mjs'; // its Chrome is Chrome for Testing, never the installed Chrome.app
import { pick } from './engines.mjs';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { gamut } from './ref/classes.mjs';
const req = createRequire(import.meta.url), pw = PW, cjs = req('colorjs.io'), Color = cjs.default ?? cjs;
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');

// the spec's encoders, line for line (Yw defined, as XYZ_to_ICtCp expects)
const Yw = 203, mm = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]), spow = (b, e) => Math.sign(b) * Math.abs(b) ** e;
function XYZ_to_Jzazbz(XYZ) {
  const M = [[0.41478972, 0.579999, 0.0146480], [-0.2015100, 1.120649, 0.0531008], [-0.0166008, 0.264800, 0.6684799]], b = 1.15, g = 0.66;
  const [Xa, Ya, Za] = XYZ.map((v) => v * Yw), Xm = b * Xa - (b - 1) * Za, Ym = g * Ya - (g - 1) * Xa;
  const LMS = mm(M, [Xm, Ym, Za]);
  const M2 = [[0.5, 0.5, 0], [3.524000, -4.066708, 0.542708], [0.199076, 1.096799, -1.295875]];
  const c1 = 3424 / 2 ** 12, c2 = 2413 / 2 ** 7, c3 = 2392 / 2 ** 7, n = 2610 / 2 ** 14, p = (1.7 * 2523) / 2 ** 5, d = -0.56, d0 = 1.6295499532821566e-11;
  const PQLMS = LMS.map((val) => spow((c1 + c2 * spow(val / 10000, n)) / (1 + c3 * spow(val / 10000, n)), p));
  const [Iz, az, bz] = mm(M2, PQLMS);
  return [((1 + d) * Iz) / (1 + d * Iz) - d0, az, bz];
}
function XYZ_to_ICtCp(XYZ) {
  const M = [[0.3592832590121217, 0.6976051147779502, -0.0358915932320290], [-0.1920808463704993, 1.1004767970374321, 0.0753748658519118], [0.0070797844607479, 0.0748396662186362, 0.8433265453898765]];
  const LMS = mm(M, XYZ.map((v) => v * Yw));
  const c1 = 3424 / 4096, c2 = 2413 / 128, c3 = 2392 / 128, m1 = 2610 / 16384, m2 = 2523 / 32;
  const PQLMS = LMS.map((val) => ((c1 + c2 * (val / 10000) ** m1) / (1 + c3 * (val / 10000) ** m1)) ** m2);
  return mm([[2048 / 4096, 2048 / 4096, 0], [6610 / 4096, -13613 / 4096, 7003 / 4096], [17933 / 4096, -17390 / 4096, -543 / 4096]], PQLMS);
}

let seed = 2026102101; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const xyzs = [[0.9504559270516716, 1, 1.0890577507598784], ...Array.from({ length: 200 }, () => new Color('srgb', [rnd(), rnd(), rnd()]).to('xyz-d65').coords),
  ...[2, 5, 20].map((k) => new Color('srgb', [0.9, 0.6, 0.3]).to('xyz-d65').coords.map((v) => v * k)),
  // near PQ's 10,000 cd/m² (49 times media white) and past it in one channel: a hill-climb's worst, 4.2e-4 off while
  // the PQ inverse read a stored value near 1 (2026-10-26)
  ...[30, 45].flatMap((k) => [[0.5, 0.8, 0.2], [0.2, 0.4, 0.9]].map((c) => new Color('srgb', c).to('xyz-d65').coords.map((v) => v * k))),
  [23.908497131597787, 51.951612063394585, 16.0756024738568], [30.10575101057318, 39.46295150923312, 5.5191773234101875]];
// the encoders against Color.js (absolute XYZ at Yw 203)
const cj = (sp, xyz) => new Color('xyz-abs-d65', xyz.map((v) => v * Yw)).to(sp).coords;
const encOff = Math.max(...xyzs.flatMap((x) => [...XYZ_to_Jzazbz(x).map((v, i) => Math.abs(v - cj('jzazbz', x)[i])), ...XYZ_to_ICtCp(x).map((v, i) => Math.abs(v - cj('ictcp', x)[i]))]));
console.log(`the spec's encoders against Color.js: worst ${encOff.toExponential(1)}`);
const cases = xyzs.flatMap((xyz) => { const [jz, az, bz] = XYZ_to_Jzazbz(xyz), [i, ct, cp] = XYZ_to_ICtCp(xyz);
  return [['jzazbz', { jz, az, bz }, xyz], ['jzczhz', { jz, cz: Math.hypot(az, bz), hz: ((Math.atan2(bz, az) * 180) / Math.PI + 360) % 360 }, xyz], ['ictcp', { i, ct, cp }, xyz]]; })
  // each space's alpha input in turn: unset (1), 0.5 and 0.25, which must come back as they are
  // (by the color's index, not the case's, so each space meets all three)
  .map(([fn, v, xyz], j) => { const k = Math.floor(j / 3) % 3; return [fn, k ? { ...v, alpha: [1, 0.5, 0.25][k] } : v, xyz]; });
// and the first 30 written as percentages, CSS Color HDR's reference ranges (100%: Jz and I 1, az and bz 0.21, Cz 0.26,
// Ct and Cp 0.5; the hue stays a number): the same colors
const RANGE = { jz: 1, az: 0.21, bz: 0.21, cz: 0.26, i: 1, ct: 0.5, cp: 0.5 };
cases.push(...cases.slice(0, 30).map(([fn, v, xyz]) => [fn, Object.fromEntries(Object.entries(v).map(([k, n]) => [k, k in RANGE ? `${(n / RANGE[k]) * 100}%` : n])), xyz]));
const page = `<!doctype html><style>${css}</style>${cases.map(([fn, v]) => `<i class="${gamut(fn)}" style="${Object.entries(v).map(([k, n]) => `--gamut-${fn}-${k}: ${n}`).join('; ')}"></i>`).join('')}`;
let failed = encOff > 1e-6;
for (const [name, type, opts] of pick()) {
  const b = await pw[type].launch(opts), p = await b.newPage();
  await p.setContent(page);
  const got = await p.evaluate(() => [...document.querySelectorAll('i')].map((e) => getComputedStyle(e).getPropertyValue('--gamut-out')));
  const bad = [], worst = {};
  cases.forEach(([fn, v, want], i) => {
    const m = got[i].match(/^color\(xyz-d65 (\S+) (\S+) (\S+?)(?: \/ (\S+))?\)$/), a = v.alpha ?? 1;
    const off = m && +(m[4] ?? 1) === a ? Math.max(...want.map((w, k) => Math.abs(+m[k + 1] - w) / Math.max(1, Math.abs(w)))) : Infinity;
    worst[fn] = Math.max(worst[fn] ?? 0, off);
    if (!(off <= 2e-4)) bad.push(`${fn} ${Object.values(v).map((n) => (typeof n === 'number' ? n.toFixed(6) : n)).join(' ')} -> ${got[i]}, want xyz-d65 ${want.map((w) => w.toFixed(6)).join(' ')}`);
  });
  failed ||= bad.length > 0;
  console.log(`${name}: ${cases.length - bad.length} of ${cases.length} back to their XYZ within 2e-4 (worst ${Object.entries(worst).map(([k, w]) => `${k} ${w.toExponential(1)}`).join(', ')})${bad.length ? `\n  ${bad.slice(0, 6).join('\n  ')}` : ''}`);
  await b.close();
}
process.exit(failed ? 1 : 0);
