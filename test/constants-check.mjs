// Checks the sheet's matrices against their sources: every sum of three products in it (a * r + b * g + c * b, in any
// variables) is a row of a published matrix to the digits it is written with (within a unit of the last, or 1e-12), or that row times a power of 10 (or by 203, the HDR media white): the
// conversions between CSS Color 4's linear spaces (sRGB, Display P3, Rec. 2020, A98 RGB, ProPhoto RGB, XYZ D65 and D50,
// as Color.js 0.7.1 converts), OkLab's four matrices, Jzazbz's and ICtCp's (Color.js 0.7.1's, CSS Color 4's and CSS
// Color HDR's), and Compositing 1's Lum() weights. .gamut-palette-step's rows, which the build works out from CAM16's
// matrix and MCU's viewing conditions, are counted apart: test/material-check.mjs tests them by their colors. A changed
// digit fails here, however little it moves a color (mutation testing, 2026-10-29: a rec2020 coefficient 2% off at
// every place it is written moved colors by 2e-3, inside the color checks' 1/255 and 2/255).
// Usage: node test/constants-check.mjs   (SHEET= another sheet)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const req = createRequire(import.meta.url), C0 = req('colorjs.io'), Color = C0.default ?? C0;
const src = path.join(path.dirname(req.resolve('colorjs.io')), '../src/spaces/');
const [{ M: OK }, { M: JZ }, { M: IC }] = await Promise.all(['oklab.js', 'jzazbz.js', 'ictcp.js'].map((f) => import(pathToFileURL(path.join(src, f)).href)));
const sheet = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
// the references, row by row
const SPACES = ['srgb-linear', 'p3-linear', 'rec2020-linear', 'a98rgb-linear', 'prophoto-linear', 'xyz-d65', 'xyz-d50'];
const REF = [];
for (const a of SPACES) for (const b of SPACES) if (a !== b) { const cols = [0, 1, 2].map((k) => new Color(a, [0, 1, 2].map((j) => +(j === k))).to(b).coords);
  for (let i = 0; i < 3; i++) REF.push([`${a} to ${b}, row ${i + 1}`, cols.map((c) => c[i])]); }
for (const [name, m] of [...Object.entries(OK).map(([k, v]) => [`OkLab ${k}`, v]), ...Object.entries(JZ).map(([k, v]) => [`Jzazbz ${k}`, v]), ...Object.entries(IC).map(([k, v]) => [`ICtCp ${k}`, v])])
  m.forEach((r, i) => REF.push([`${name}, row ${i + 1}`, r]));
REF.push(['Compositing 1 Lum()', [0.3, 0.59, 0.11]]);
// the rows: three products, each a number times a variable (a channel name or a var()), not a call
const N = String.raw`(-?\d*\.?\d+(?:e-?\d+)?)`, V = String.raw`([a-z]\w*(?![\w(])|var\(--[\w-]+\))`;
const ROW = new RegExp(`${N} \\* ${V} ([+-]) ${N} \\* ${V} ([+-]) ${N} \\* ${V}`, 'g');
const owner = (at) => { const before = sheet.slice(0, at), f = before.lastIndexOf('@function'), r = before.lastIndexOf('}\n'); return f > r ? sheet.slice(f, f + 60) : sheet.slice(r, r + 200); };
const rows = new Map();
for (const x of sheet.matchAll(ROW)) {
  const lit = [x[1], x[4], x[7]], v = [+x[1], (x[3] === '-' ? -1 : 1) * x[4], (x[6] === '-' ? -1 : 1) * x[7]], key = v.join(' ');
  if (rows.has(key)) { rows.get(key).n++; continue; }
  // a unit of the last digit written (some are cut, not rounded), or 1e-12 where a double is written whole
  // (a whole number, 0 or 1, is exact: a 0 in a row is no wildcard)
  const tol = lit.map((t) => { const [m, e] = t.split('e'); if (!m.includes('.') && !e) return 1e-12; return Math.max(10 ** (-((m.split('.')[1] ?? '').length) + (+e || 0)) * 1.0001, 1e-12); });
  // (or by 203, CSS Color HDR's media white in cd/m2, either way)
  let hit; for (const [name, w] of REF) for (let k = -6; k <= 6 && !hit; k++) for (const [f, fn] of [[1, ''], [1 / 203, ' / 203'], [203, ' x 203']]) { const s = 10 ** k * f;
    if (!hit && w.every((y, j) => Math.abs(v[j] - s * y) <= tol[j])) hit = `${name}${k ? `, times 1e${k}` : ''}${fn}`; }
  rows.set(key, { n: 1, hit, line: sheet.slice(0, x.index).split('\n').length, palette: /palette-step/.test(owner(x.index)) });
}
const all = [...rows.values()], matched = all.filter((r) => r.hit), palette = all.filter((r) => !r.hit && r.palette), bad = [...rows].filter(([, r]) => !r.hit && !r.palette);
console.log(`${matched.length} of ${all.length} distinct rows (${all.reduce((s, r) => s + r.n, 0)} written) are rows of a published matrix to their digits; ${palette.length} are .gamut-palette-step's own (material-check.mjs)`);
for (const [k, r] of bad) console.log(`  FAIL line ${r.line}: ${k} is no published row`);
// and the rows it found: a sheet that lost its matrices (or none at all) is no pass (60 matched, 7 palette-step's,
// 2026-10-30; a change that writes fewer moves these numbers)
const MATCHED = 60, PALETTE = 7, few = matched.length < MATCHED || palette.length < PALETTE;
if (few) console.log(`  FAIL ${matched.length} matched rows and ${palette.length} of palette-step's, at least ${MATCHED} and ${PALETTE} known`);
console.log(bad.length || few ? 'FAIL' : 'PASS');
process.exit(bad.length || few ? 1 : 0);
