// Cross-engine fuzz of the parts: the same random and hostile inputs (seeded) in Chrome, WebKit and Firefox, each output
// read as sRGB (extended) and alpha; prints, per part, how many cases the engines agree on within 2/255 and the worst
// disagreements. Not a check: it compares the engines with each other, not with a reference, and exits 0.
// UNCLIPPED=1 compares the channels as computed, outside sRGB too,
// where a paint clips them. Usage: node test/fuzz-engines.mjs [cases per part=300]
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { open, pick } from './engines.mjs';
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8'), N = +(process.argv[2] ?? 300);
const dir = mkdtempSync(path.join(tmpdir(), 'gamutant-fuzz-'));   // its page and results
let s = 4242; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647), f = (x, d = 4) => +x.toFixed(d), pickOne = (a) => a[Math.floor(rnd() * a.length)];
const hostile = ['none', '0', '1', '-1', '1e-7', '1e9', '0.5'];
const color = () => { const k = rnd(), a = rnd() < 0.2 ? ` / ${pickOne(['0', '0.5', 'none', f(rnd(), 3)])}` : '';
  if (k < 0.25) return `rgb(${[0, 0, 0].map(() => Math.floor(rnd() * 256)).join(' ')}${a})`;
  if (k < 0.5) return `oklch(${f(rnd())} ${f(rnd() * (rnd() < 0.2 ? 2 : 0.4))} ${rnd() < 0.1 ? 'none' : f(rnd() * 360, 2)}${a})`;
  if (k < 0.65) return `color(display-p3 ${f(rnd())} ${f(rnd())} ${f(rnd())}${a})`;
  if (k < 0.75) return `lab(${f(rnd() * 100, 2)} ${f(rnd() * 200 - 100, 2)} ${f(rnd() * 200 - 100, 2)}${a})`;
  if (k < 0.85) return `hsl(${rnd() < 0.1 ? 'none' : f(rnd() * 360, 1)} ${f(rnd() * 100, 1)}% ${f(rnd() * 100, 1)}%${a})`;
  if (k < 0.92) return `color(rec2020 ${f(rnd())} ${f(rnd())} ${f(rnd())}${a})`;
  return pickOne(['white', 'black', 'transparent', 'red', 'lime', 'blue', 'yellow', 'magenta', 'cyan', 'grey', 'rebeccapurple']); };
const targets = ['srgb', 'display-p3', 'rec2020', 'a98-rgb', 'prophoto-rgb'], methods = ['css', 'ray-trace', 'edge-seeker', 'adaptive'];
const PARTS = {
  'fit-screen': () => ({ parent: `--gamut-target: ${pickOne(targets)}; --gamut-method: ${pickOne(methods)}`, own: `--gamut-in: ${color()}` }),
  'screen-edge': () => ({ parent: `--gamut-target: ${pickOne(targets)}`, own: `--gamut-in: ${color()}; --gamut-rel: ${pickOne(['1', '0.5', '0.8', '0', '1.2', f(rnd(), 3)])}` }),
  'palette-step': () => ({ parent: `--gamut-in: ${color()}`, own: `--gamut-tone: ${pickOne([f(rnd() * 100, 1), 99, 50, 2, 98])}; --gamut-chroma-scale: ${pickOne(['1', '0.5', '2'])}` }),
  'readable-text': () => ({ own: `--gamut-bg: ${color()}; --gamut-ratio: ${pickOne(['4.5', '3', '7', '1.5', '21'])}${rnd() < 0.3 ? `; --gamut-readable-from: ${color()}` : ''}${rnd() < 0.2 ? `; --gamut-readable-to: ${color()}` : ''}`, prop: '--gamut-text' }),
  'contrast-color': () => ({ own: `--gamut-bg: ${color()}; --gamut-try-1: ${color()}; --gamut-try-2: ${color()}${rnd() < 0.6 ? `; --gamut-contrast-ratio: ${pickOne(['4.5', '3', '7'])}` : ''}`, prop: '--gamut-text' }),
  'color-mix': () => ({ own: `--gamut-mix-space: ${pickOne(['oklab', 'srgb', 'oklch', 'lab', 'hsl', 'oklch longer hue', 'srgb-linear', 'xyz'])}; --gamut-mix-count: ${pickOne([2, 3])}; --gamut-mix-1: ${color()}; --gamut-mix-2: ${color()}; --gamut-mix-3: ${color()}${rnd() < 0.5 ? `; --gamut-mix-pct-1: ${Math.floor(rnd() * 100)}` : ''}` }),
  'color-interpolate': () => ({ own: `--gamut-space: ${pickOne(['oklab', 'srgb', 'oklch'])}; --gamut-stops: 3; --gamut-stop-1: ${color()}; --gamut-stop-2: ${color()}; --gamut-stop-3: ${color()}; --gamut-at-1: 0; --gamut-at-2: ${f(rnd(), 2)}; --gamut-at-3: 1; --gamut-t: ${f(rnd() * 1.2 - 0.1, 3)}` }),
  'color-layers': () => ({ own: `--gamut-layer-1: ${color()}; --gamut-layer-2: ${color()}; --gamut-layer-3: ${color()}`, cls: rnd() < 0.6 ? ` gamut-blend-${pickOne(['multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'])}` : '' }),
  alpha: () => ({ own: `--gamut-in: ${color()}; --gamut-alpha-value: ${pickOne(['0.5', '0', '1', 'calc(alpha / 2)', '0.25'])}` }),
  okhsl: () => ({ parent: `--gamut-target: ${pickOne(['srgb', 'display-p3', 'rec2020'])}`, own: `--gamut-okhsl-h: ${f(rnd() * 360, 2)}; --gamut-okhsl-s: ${f(rnd(), 3)}; --gamut-okhsl-l: ${f(rnd(), 3)}` }),
  okhsv: () => ({ parent: `--gamut-target: ${pickOne(['srgb', 'display-p3', 'rec2020'])}`, own: `--gamut-okhsv-h: ${f(rnd() * 360, 2)}; --gamut-okhsv-s: ${f(rnd(), 3)}; --gamut-okhsv-v: ${f(rnd(), 3)}` }),
  'okhsl-from': () => ({ own: `--gamut-in: ${color()}${rnd() < 0.6 ? `; --gamut-okhsl-s: ${f(rnd(), 3)}` : ''}${rnd() < 0.6 ? `; --gamut-okhsl-l: ${f(rnd(), 3)}` : ''}` }),
  'hdr-color': () => ({ own: `--gamut-hdr-1: ${color()}; --gamut-hdr-2: ${color()}; --gamut-hdr-h1: 0; --gamut-hdr-h2: ${pickOne([1, 2, 3])}; --gamut-headroom: ${f(rnd() * 3, 2)}` }),
  'device-cmyk': () => ({ own: `--gamut-cmyk-c: ${f(rnd(), 3)}; --gamut-cmyk-m: ${f(rnd(), 3)}; --gamut-cmyk-y: ${f(rnd(), 3)}; --gamut-cmyk-k: ${f(rnd(), 3)}` }),
};
const cases = Object.entries(PARTS).flatMap(([part, gen]) => Array.from({ length: N }, () => ({ part, ...gen() })));
const html = `<!doctype html><style>${css}</style><body>${cases.map((c, i) => `<div style="${c.parent ?? ''}"><i data-i="${i}" class="gamut-${c.part}${c.cls ?? ''}" style="${c.own}; color: color(from var(${c.prop ?? '--gamut-out'}) srgb r g b / alpha)"></i></div>`).join('')}</body>`;
writeFileSync(path.join(dir, 'page.html'), html);
const res = {};
for (const e of pick(['Chrome', 'WebKit', 'Firefox'])) { const { browser, page } = await open(e); const name = e[0] ?? e.name;
  await page.setContent(html, { timeout: 300000 });
  res[name] = await page.evaluate(() => [...document.querySelectorAll('i')].map((i) => getComputedStyle(i).color));
  await browser.close(); }
const parse = (s) => { const m = s.match(/srgb ([-\d.e+]+) ([-\d.e+]+) ([-\d.e+]+)(?: \/ ([-\d.e+]+))?/); if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  const r = s.match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/); return r ? [r[1] / 255, r[2] / 255, r[3] / 255, r[4] === undefined ? 1 : +r[4]] : null; };
const engines = Object.keys(res), out = {};
cases.forEach((c, i) => { const vals = engines.map((e) => parse(res[e][i]));
  let worst = 0, pair = ''; for (let a = 0; a < vals.length; a++) for (let b = a + 1; b < vals.length; b++) { const x = vals[a], y = vals[b];
    // alpha 0 on both: channels don't paint, so painted they compare by alpha only (as computed, every channel counts)
    const clip = process.env.UNCLIPPED ? (v) => v : (v) => Math.min(1, Math.max(0, v));
    const d = !x || !y ? Infinity : x[3] < 1e-6 && y[3] < 1e-6 && !process.env.UNCLIPPED ? 0 : Math.max(...[0, 1, 2].map((k) => Math.abs(clip(x[k]) - clip(y[k])) * 255), Math.abs(x[3] - y[3]) * 255);
    if (d > worst) { worst = d; pair = `${engines[a]}/${engines[b]}`; } }
  const o = (out[c.part] ??= { n: 0, bad: [] }); o.n++; if (worst > 2) o.bad.push({ worst, pair, c, vals: engines.map((e) => res[e][i]) }); });
for (const [p, o] of Object.entries(out)) { o.bad.sort((a, b) => b.worst - a.worst);
  console.log(`${p}: ${o.n - o.bad.length} of ${o.n} agree within 2/255 ${process.env.UNCLIPPED ? 'as computed' : 'painted'}${o.bad.length ? `; worst ${o.bad[0].worst.toFixed(1)} (${o.bad[0].pair})` : ''}`); }
writeFileSync(path.join(dir, 'out.json'), JSON.stringify(out, null, 1));
