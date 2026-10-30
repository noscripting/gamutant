// The acceptance check for a faster gamutant.css mapper. A candidate is a CSS file; this page gives it elements
//   <i class="m srgb" style="--gamut-in: <any color>; --gamut-target: srgb">
//   <i class="m p3"   style="--gamut-in: <any color>; --gamut-target: display-p3">
// and the candidate must set the registered `--gamut-out` (<color>, inherits: true, registered here too) on `.m`: the
// input at its own OKLCH lightness and hue with the chroma lowered to the target gamut's edge (unchanged when it already
// fits). Precision: every element's --gamut-out, read back and converted in JS, unclipped and unrounded, within 1/255 on each channel of the true
// edge (methods.mjs boundary(), bisected in doubles), in both gamuts, in Chrome, WebKit and Firefox. A color within 2e-5
// of the gamut in linear light fits (the slack boundary() keeps): the right answer is the input itself, clipped. Time: 256 out-of-gamut sRGB
// colors changed at once, style forced, on one page taking turns with gamutant.css and with painting the input (the
// floor): median of 15, as microseconds a color over the floor, under the bench lock.
// --oracle picks the answer key: edge (default: methods.mjs boundary(), the exact constant-L,h edge), css (Color.js
// 0.7.1 toGamut method 'css', CSS Color 4's gamut mapping: clip within deltaEOK 0.02, else the point whose clip is 0.02
// away, clipped), chroma (Color.js toGamut method 'oklch.c', deltaEOK, jnd 0.0001: OKLCH chroma reduced to the edge) or
// raytrace (CSS Color 4 §14.2.6 Ray Trace: Color.js 0.7.1 toGamut method 'raytrace', specs/css-color's install) or seeker (§14.2.4 EdgeSeeker as written,
// its table at 400 hues a region, edge-seeker.mjs). run.mjs runs gamutant.css itself with --oracle css --no-time --engine all.
// --class <modifier> runs the candidate's .gamut-fit-screen.<modifier> (gamutant.css's ray-trace) in place of .gamut-fit-screen.
// Usage: node test/gate-check.mjs <candidate.css> [--quick] [--engine chrome|webkit|firefox|all] [--no-time] [--oracle edge|css|chroma|raytrace|seeker] [--tol n] [--class modifier]
//   exit 0 and a last line PASS when every element in every engine run is within 1/255; else FAIL and the worst cases.
// Optional precision-only batching: GATE_BATCH=1 GATE_RSS_MIB=512 GATE_REPORT=memory.json (RSS requires Chrome).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { XYZ_LMS, LMS_OK, spaces, toLin, toLch, gam, ungam, clip01, inGamut, boundary, wpt } from './ref/methods.mjs';
import { pw, ENGINES, benchLock } from './engines.mjs';
import { batchSize, rendererBudget } from './renderer-budget.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), file = args.find((a) => !a.startsWith('--'));
if (!file) { console.error('usage: node test/gate-check.mjs <candidate.css> [--quick] [--engine chrome|webkit|firefox|all] [--no-time] [--oracle edge|css|chroma|raytrace|seeker] [--tol n]'); process.exit(2); }
const quick = args.includes('--quick'), noTime = args.includes('--no-time');
// Optional bounded precision run for large experimental circuits. Keep the
// existing cases and oracle; parse the sheet once and replace only input nodes.
const batch = batchSize();
if (batch && !noTime) throw Error('GATE_BATCH requires --no-time; timing uses the original full workload');
const engineArg = args.includes('--engine') ? args[args.indexOf('--engine') + 1] : 'both';
const oracle = args.includes('--oracle') ? args[args.indexOf('--oracle') + 1] : 'edge';
// the tolerance in 8-bit steps: 1 by default, 2 against Color.js's css method (its own search stops at 0.0001 and lands
// up to 1 off the exact spec point, so two answers each within 1 of it can be 2 apart)
const tol = args.includes('--tol') ? +args[args.indexOf('--tol') + 1] : oracle === 'css' ? 2 : 1;
if (!(tol > 0)) { console.log(`FAIL --tol ${args[args.indexOf('--tol') + 1]}: not a number above 0`); process.exit(1); }
const { edgeSeeker } = oracle === 'seeker' ? await import('./vendor/edge-seeker.mjs') : {};
const Color = createRequire(import.meta.url)('colorjs.io').default;
// Color.js 0.7.1 also has Ray Trace
const Color7 = Color;
const cj7 = (g, lch) => new Color7('oklch', lch).toGamut({ space: sp(g), method: 'raytrace' }).to(sp(g)).coords.map((x) => Math.min(1, Math.max(0, x)) * 255);
const cjs = (g, lch, opts) => new Color('oklch', lch).toGamut({ space: sp(g), ...opts }).to(sp(g)).coords.map((x) => Math.min(1, Math.max(0, x)) * 255);
const cls = args.includes('--class') ? args[args.indexOf('--class') + 1] : null;
const candidate = readFileSync(file, 'utf8').replaceAll(cls ? `.gamut-fit-screen.${cls}` : '\0', '.m.m').replaceAll('.gamut-fit-screen', '.m'); // a sheet with the mapper's interface runs as is
const baseline = readFileSync(path.join(here, '../gamutant.css'), 'utf8').replaceAll('.gamut-fit-screen', '.m');
const REG = `@property --gamut-out { syntax: '<color>'; inherits: true; initial-value: black; }`;

// --- colors: parse what a browser prints, convert to a target's linear RGB ------------------------------------------
const mul = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
// methods.mjs's matrices, and CSS Color 4 §19's D50 to D65 Bradford adaptation (for lab(), lch() and xyz-d50)
const M = { srgbToXYZ: spaces.srgb.toXYZ, p3ToXYZ: spaces.p3.toXYZ, XYZ_LMS, LMS_OK,
  D50toD65: [[0.955473421488075, -0.02309845494876471, 0.06325924320057072], [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323], [0.012314014864481998, -0.020507649298898964, 1.330365926242124]] };
const num = (t, pct = 1) => (t === 'none' ? 0 : t.endsWith('%') ? (parseFloat(t) / 100) * pct : parseFloat(t));
const xyzToLch = (xyz) => { const [L, a, b] = mul(M.LMS_OK, mul(M.XYZ_LMS, xyz).map(Math.cbrt)); return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360]; };
const D50 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
const labToXYZ65 = ([L, a, b]) => { const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200, e = 216 / 24389, k = 24389 / 27;
  const f = (t) => (t ** 3 > e ? t ** 3 : (116 * t - 16) / k); return mul(M.D50toD65, [f(fx) * D50[0], (L > k * e ? fy ** 3 : L / k), f(fz) * D50[2]]); };
// a printed color as OKLCH, so methods.mjs's toLin() takes it to either gamut
function toOklch(s) {
  s = s.trim(); const m = s.match(/^([a-z-]+)\((.*)\)$/); if (!m) return null;
  const [fn, body] = [m[1], m[2]]; const parts = body.replace(/,/g, ' ').split('/')[0].trim().split(/\s+/);
  if (fn === 'oklch') return [num(parts[0]), num(parts[1], 0.4), num(parts[2])];
  if (fn === 'oklab') { const [L, a, b] = [num(parts[0]), num(parts[1], 0.4), num(parts[2], 0.4)]; return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360]; }
  if (fn === 'rgb' || fn === 'rgba') return xyzToLch(mul(M.srgbToXYZ, parts.slice(0, 3).map((t) => ungam(t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t) / 255))));
  if (fn === 'lab') return xyzToLch(labToXYZ65([num(parts[0], 100), num(parts[1], 125), num(parts[2], 125)]));
  if (fn === 'lch') { const [L, C, H] = [num(parts[0], 100), num(parts[1], 150), num(parts[2])]; return xyzToLch(labToXYZ65([L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)])); }
  if (fn === 'color') {
    const [space, ...c] = parts, v = c.slice(0, 3).map((t) => num(t));
    if (space === 'srgb') return xyzToLch(mul(M.srgbToXYZ, v.map(ungam)));
    if (space === 'srgb-linear') return xyzToLch(mul(M.srgbToXYZ, v));
    if (space === 'display-p3') return xyzToLch(mul(M.p3ToXYZ, v.map(ungam)));
    if (space === 'display-p3-linear') return xyzToLch(mul(M.p3ToXYZ, v));
    if (space === 'xyz' || space === 'xyz-d65') return xyzToLch(v);
    if (space === 'xyz-d50') return xyzToLch(mul(M.D50toD65, v));
  }
  return null;
}
const sp = (g) => (g === 'display-p3' ? 'p3' : 'srgb');
// the answer in the target's encoded channels, times 255, unrounded; the sheet's output the same, unclipped too, so an
// output past the gamut counts as off (clipped, it read as the color the browser would paint)
const f255 = (g, lch) => toLin(sp(g), lch).map((x) => clip01(gam(x)) * 255);
const raw255 = (g, lch) => toLin(sp(g), lch).map((x) => gam(x) * 255);
const fmt = ([l, c, h]) => `oklch(${+l.toFixed(5)} ${+c.toFixed(5)} ${+h.toFixed(3)})`;

// --- cases --------------------------------------------------------------------------------------------------------
let seed = 20261020; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const cases = [];
for (const g of ['srgb', 'display-p3']) {
  const n = quick ? 300 : 1200, k = quick ? 50 : 200; let out = 0, inn = 0;
  while (out < n || inn < k) { const lch = [0.02 + rnd() * 0.96, rnd() * 0.45, rnd() * 360], fits = inGamut(toLin(sp(g), lch));
    if (!fits && out < n) { out++; cases.push({ g, input: fmt(lch), lch: toOklch(fmt(lch)) }); } else if (fits && inn < k) { inn++; cases.push({ g, input: fmt(lch), lch: toOklch(fmt(lch)) }); } }
  for (const [s] of wpt[sp(g)]) cases.push({ g, input: s, lch: toOklch(s.replace(/(\d+)%/, (_, p) => `${p / 100}`)) });
  for (const s of ['oklch(0.452 0.313 264.052)', 'oklch(0.01 0.4 30)', 'oklch(0.995 0.4 200)', 'oklch(0.5 0.5 0)', 'oklch(0.7 0.6 145)', 'oklch(0.3 0.4 300)',
    'color(display-p3 1 0 0)', 'color(display-p3 0 1 0)', 'lab(50 100 -100)', 'oklch(0.6 0.3 none)', 'oklch(0.6 0 none)', 'rgb(255 0 0)', 'oklch(0.98 0.02 110)'])
    cases.push({ g, input: s, lch: toOklch(s) });
}
// each gamut's elements in a wrapper that sets --gamut-target (gamutant.css reads it from an ancestor), and on each element too
const page = (css, list) => `<!doctype html><style>${REG}\n${css}\nbody { margin: 0; } #g > div { display: grid; grid-template-columns: repeat(64, 4px); grid-auto-rows: 4px; }
#g i { background: var(--gamut-out); }</style><div id=g>${['srgb', 'display-p3'].map((g) => `<div style="--gamut-target: ${g}">${list.filter((c) => c.g === g).map((c) =>
  `<i class="m ${sp(c.g)}" style="--gamut-in: ${c.input}; --gamut-target: ${c.g}"></i>`).join('')}</div>`).join('')}</div>`;

// --- run ----------------------------------------------------------------------------------------------------------
// --engine picks, and ENGINES= in the environment narrows what it picks (ENGINES=Chrome,WebKit)
const only = process.env.ENGINES?.toLowerCase().split(',');
const engines = ENGINES.filter(([n]) => ((engineArg === 'both' && n !== 'Firefox') || engineArg === 'all' || n.toLowerCase() === engineArg) && (!only || only.includes(n.toLowerCase())));
let ok = true;
if (!engines.length) { console.log(`FAIL no engine left: --engine ${engineArg} and ENGINES=${process.env.ENGINES} pick none`); process.exit(1); }
for (const [name, type, opts] of engines) {
  const b = await pw[type].launch(opts), p = await b.newPage();
  try {
  const budget = await rendererBudget(b, name);
  let got;
  if (!batch) {
  await p.setContent(page(candidate, cases));
  got = await p.evaluate(() => [...document.querySelectorAll('#g i')].map((e) => getComputedStyle(e).getPropertyValue('--gamut-out').trim()));
  } else {
    got = []; await p.setContent(page(candidate, []));
    for (let at = 0; at < cases.length; at += batch) {
      got.push(...await p.evaluate(list => {
        const fragment = document.createDocumentFragment();
        for (const c of list) {
          const host = document.createElement('div'), el = document.createElement('i');
          host.style.setProperty('--gamut-target', c.g); el.className = `m ${c.g === 'srgb' ? 'srgb' : 'p3'}`;
          el.style.setProperty('--gamut-in', c.input); el.style.setProperty('--gamut-target', c.g); host.append(el); fragment.append(host);
        }
        document.getElementById('g').replaceChildren(fragment);
        return [...document.querySelectorAll('#g i')].map(e => getComputedStyle(e).getPropertyValue('--gamut-out').trim());
      }, cases.slice(at, at + batch)));
      await budget({ first: at, count: Math.min(batch, cases.length - at) });
    }
  }
  const bad = [];
  cases.forEach((c, i) => { const lin = toLin(sp(c.g), c.lch), fits = lin.every((x) => x >= -2e-5 && x <= 1 + 2e-5);
    const want = oracle === 'css' ? cjs(c.g, c.lch, { method: 'css' }) : oracle === 'chroma' ? cjs(c.g, c.lch, { method: 'oklch.c', deltaEMethod: 'OK', jnd: 0.0001 })
      : fits ? f255(c.g, c.lch) : oracle === 'raytrace' ? cj7(c.g, c.lch)
      : oracle === 'seeker' ? edgeSeeker(sp(c.g), c.lch).map((x) => clip01(gam(x)) * 255)
      : f255(c.g, toLch(sp(c.g), boundary(sp(c.g), c.lch))), o = toOklch(got[i]);
    const have = o ? raw255(c.g, o) : null, off = have ? Math.max(...have.map((v, k) => Math.abs(v - want[k]))) : 255;
    if (off > tol) bad.push({ off, c, got: got[i], have, want }); });
  bad.sort((a, b) => b.off - a.off);
  console.log(`${name} precision (${oracle}): ${cases.length - bad.length} of ${cases.length} within ${tol}/255 of the answer${bad.length ? ` (${bad.filter((x) => x.c.g === 'srgb').length} sRGB, ${bad.filter((x) => x.c.g !== 'srgb').length} P3 off)` : ''}`);
  for (const x of bad.slice(0, 6)) console.log(`  ${x.c.g} ${x.c.input}: got ${x.got} = [${x.have.map((v) => v.toFixed(2))}], want [${x.want.map((v) => v.toFixed(2))}] (off ${x.off.toFixed(2)}/255)`);
  if (bad.length) ok = false;
  if (!noTime) {
    const release = await benchLock('gate.mjs');
    const pool = cases.filter((c) => c.g === 'srgb' && c.input.startsWith('oklch(') && !inGamut(toLin('srgb', c.lch))).map((c) => c.input);
    const list = pool.slice(0, 256).map((input) => ({ g: 'srgb', input }));
    const variants = [['floor', `.m { --gamut-out: var(--gamut-in); }`], ['gamutant.css', baseline], ['candidate', candidate]], t = { floor: [], 'gamutant.css': [], candidate: [] };
    for (let round = 0; round < (quick ? 2 : 3); round++) for (const [label, css] of variants) {
      await p.setContent(page(css, list));
      t[label].push(...await p.evaluate(async ([pool, round]) => {
        const els = [...document.querySelectorAll('#g i')], out = [];
        for (let r = 0; r < 7; r++) {
          await new Promise(requestAnimationFrame);
          const t0 = performance.now();
          els.forEach((e, i) => { const c = pool[(i * 7 + (round * 7 + r) * 13 + 1) % pool.length]; e.style.setProperty('--gamut-in', c); });
          document.body.offsetWidth;
          if (r >= 2) out.push(performance.now() - t0);
        }
        return out;
      }, [pool, round]));
    }
    const med = (a) => { a.sort((x, y) => x - y); return a[a.length >> 1]; };
    const [f, base, cand] = ['floor', 'gamutant.css', 'candidate'].map((k) => med(t[k]));
    const us = (ms) => (((ms - f) * 1000) / 256).toFixed(1);
    console.log(`${name} time: candidate ${us(cand)} us a color, gamutant.css ${us(base)} us (${((cand - f) / (base - f)).toFixed(2)}x), floor ${f.toFixed(2)} ms for 256`);
    release();
  }
  } finally { await b.close(); }
}
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
