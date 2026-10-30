// Checks .gamut-color-interpolate's stop positions against css-values-5 §7.1.2 and §7.2.4, in Chrome, WebKit and Firefox: a stop with
// two positions (--gamut-at-k and --gamut-to-k) is two stops of the same color, and a position less than the one before
// it is set to that one (fixup). Random scales of 2 to 8 stops (opaque sRGB, translucent and Display P3 colors), some positions out of order, some stops
// with two, in 9
// spaces (oklch longer hue among them): --gamut-out against the browser's own two-color color-mix() of the segment the
// model finds, computed values in sRGB within 1/255 a channel and 2/255 alpha. Usage: node test/stops-check.mjs [scales=300]
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pw, pick } from './engines.mjs';
const C0 = createRequire(import.meta.url)('colorjs.io'), Color = C0.default ?? C0;
const srgba = (c) => { const k = new Color(c.replace(/-?[0-9.]+e[-+]?[0-9]+/g, (m) => (+m).toFixed(12))).to('srgb'); return [...k.coords.map((x) => (Number.isNaN(x) ? 0 : x)), Number.isNaN(k.alpha) ? 1 : k.alpha]; };
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const N = +(process.argv[2] ?? 300); if (!(N >= 1)) { console.log(`FAIL ${process.argv[2]} cases: at least 1`); process.exit(1); }
const SPACES = ['oklab', 'oklch', 'srgb', 'srgb-linear', 'lab', 'lch', 'hsl', 'display-p3', 'oklch longer hue'];
let seed = 20261022; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const r3 = (x) => +x.toFixed(3);
// the model: each stop is one or two (position, color) pairs, each position at least the one before. Where one color
// shows alone (before the first stop, after the last), the sheet mixes it 0% toward its neighbor (the next stop; the
// one before, after the last), so a component missing from it takes the neighbor's: the reference does the same. In a
// stop's own stretch it is two stops of one color (§7.1.2): the color mixed with itself by the stretch's fraction,
// which turns a full circle of hue with `longer hue` (CSS Color 4 §13.5.2). (Chrome drops the hue of a color it converts to OkLCh or LCH at chroma up to 0.02.)
function segment(stops, t) {
  const n = stops.length, flat = [];
  stops.forEach((s, k) => {
    const prev = flat.length ? flat[flat.length - 1][0] : -Infinity;
    const at = Math.max(prev, s.at); flat.push([at, k]);
    if (s.to !== undefined) flat.push([Math.max(at, s.to), k]);
  });
  const c = (k) => stops[k].c;
  let i = -1; flat.forEach(([p], j) => { if (p <= t) i = j; }); // equal positions: the later stop
  if (i < 0) return [c(0), c(1), 0];
  const k = flat[i][1];
  if (flat[i + 1]?.[1] === k) { const f = (t - flat[i][0]) / Math.max(1e-12, flat[i + 1][0] - flat[i][0]); return [c(k), c(k), Math.min(1, f)]; }
  if (k === n - 1) return [c(n - 2), c(n - 1), 1];
  return [c(k), c(flat[i + 1][1]), (t - flat[i][0]) / (flat[i + 1][0] - flat[i][0])];
}
const cases = [];
for (let q = 0; q < N; q++) {
  const n = 2 + Math.floor(rnd() * 7), space = SPACES[q % SPACES.length];
  let pos = -0.1;
  const stops = Array.from({ length: n }, () => {
    // opaque sRGB, translucent, or Display P3 (often past sRGB)
    const k = rnd(), a = k > 0.5 && k < 0.75 ? ` / ${r3(0.1 + rnd() * 0.9)}` : '';
    const c = k >= 0.75 ? `color(display-p3 ${r3(rnd())} ${r3(rnd())} ${r3(rnd())})` : `rgb(${[0, 0, 0].map(() => Math.floor(rnd() * 256)).join(' ')}${a})`;
    pos += rnd() < 0.25 ? -rnd() * 0.3 : rnd() * 0.35; // a quarter step back: the fixup moves them up
    const s = { c, at: r3(pos) };
    if (rnd() < 0.4) { s.to = r3(pos + (rnd() < 0.2 ? -0.1 : rnd() * 0.3)); pos = Math.max(pos, s.to); }
    rnd(); // (a stop here once had no position; css-values-5 §7.5 gives every stop one, and test/scale-check.mjs checks one
    // without as invalid)
    return s;
  });
  const ts = Array.from({ length: 3 }, () => r3(-0.15 + rnd() * 1.3));
  // and one t inside a stop's own stretch, between its two positions
  const two = stops.findIndex((s) => s.to !== undefined && s.at !== undefined && s.to > s.at);
  if (two >= 0) ts.push(r3((stops[two].at + stops[two].to) / 2));
  for (const t of ts) { const [a, b, p] = segment(stops, t); cases.push({ space, stops, t, ref: `color-mix(in ${space}, ${a}, ${b} ${(p * 100).toFixed(4)}%)` }); }
}
const style = (c) => `--gamut-space: ${c.space}; --gamut-stops: ${c.stops.length}; --gamut-t: ${c.t}; ${c.stops.map((s, k) => `--gamut-stop-${k + 1}: ${s.c};${s.at !== undefined ? ` --gamut-at-${k + 1}: ${s.at};` : ''}${s.to !== undefined ? ` --gamut-to-${k + 1}: ${s.to};` : ''}`).join(' ')}`;
const html = `<style>${css} @property --ref { syntax: '<color>'; inherits: false; initial-value: black; }</style>${cases.map((c) => `<i class="gamut-color-interpolate" style="${style(c)}"></i><b style="--ref: ${c.ref}"></b>`).join('')}`;
let failed = false;
for (const [name, type, opts] of pick()) {
  const b = await pw[type].launch(opts), p = await b.newPage();
  await p.setContent(html, { timeout: 300000 });
  // the computed values compared in sRGB floats (a canvas keeps a translucent color premultiplied in 8 bits: at alpha
  // 37/255 a channel reads back in steps of about 7)
  const got = await p.evaluate(() => { const px = (c) => c.trim();
    const is = [...document.querySelectorAll('i')], bs = [...document.querySelectorAll('b')];
    return is.map((e, k) => [px(getComputedStyle(e).getPropertyValue('--gamut-out')), px(getComputedStyle(bs[k]).getPropertyValue('--ref'))]); });
  await b.close();
  const bad = [];
  let worst = 0, fixed = 0, flat = 0;
  got.forEach(([g0, r0], k) => { const g = srgba(g0), r = srgba(r0);
    const d = r[3] < 1e-6 && g[3] < 1e-6 ? 0 : Math.max(...[0, 1, 2].map((j) => Math.abs(g[j] - r[j]) * 255), Math.abs(g[3] - r[3]) * 255 / 2); worst = Math.max(worst, +d.toFixed(2));
    const c = cases[k]; if (c.stops.some((s, j) => j && s.at !== undefined && c.stops.slice(0, j).some((u) => (u.to ?? u.at ?? -1) > s.at))) fixed++;
    if (c.stops.some((s) => s.to !== undefined)) flat++;
    if (d > 1) bad.push(`${c.space} t=${c.t} [${c.stops.map((s) => `${s.c} ${s.at ?? '-'}${s.to !== undefined ? ` ${s.to}` : ''}`).join(', ')}]: ${g0} want ${r0}`); });
  failed ||= bad.length > 0;
  console.log(`${name}: ${got.length - bad.length} of ${got.length} within 1/255 of the segment's own color-mix() (${fixed} with a position moved up, ${flat} with a stop at two positions), worst ${worst}/255${bad.length ? `\n  ${bad.slice(0, 5).join('\n  ')}` : ''}`);
}
console.log(failed ? 'FAIL' : 'PASS');
process.exit(failed ? 1 : 0);
