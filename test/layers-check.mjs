// Checks .gamut-color-layers (build.mjs layersPart()) two ways, in Chrome, WebKit and Firefox:
// - against Compositing 1 in JS (source-over, §10.2's 15 blend modes, separable and not, in sRGB, first layer on top): WPT's own
//   color-layers-no-blend-mode cases, then random stacks (translucent and Display P3 colors) in every mode; within
//   1/255 a channel (bytes at most 1 apart: 1.5/255; premultiplied where the stack's alpha is under 0.15), 2/255 alpha;
// - against the browser's own paint: the same layers stacked as boxes with mix-blend-mode in an isolated group (what
//   WPT's reference does for normal), screenshot pixel against pixel, within 3/255 (WPT's fuzz), stacks inside sRGB
//   only (the page clips each layer before stacking it; the sheet keeps the channels, as the spec's maths does). The
//   browser keeps the stack in bytes between layers, and color-dodge and color-burn magnify that rounding (one dodge
//   over a backdrop of 21.52/255 paints 137 where the exact value is 140.7): a square off the paint but within 3/255
//   of Compositing 1 with bytes between layers is counted apart.
// Usage: node test/layers-check.mjs [cases]
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { pw, need, pick } from './engines.mjs';
import { gamut } from './ref/classes.mjs';
const r2 = createRequire(import.meta.url); const cjs = r2('colorjs.io'); const Color = cjs.default ?? cjs;

// --- Compositing 1, in JS ---------------------------------------------------------------------------------------
const rgba = (s) => { const c = new Color(s).to('srgb'); return [...c.coords.map((x) => (Number.isNaN(x) ? 0 : x)), c.alpha ?? 1]; };
const hard = (cb, cs) => (cs <= 0.5 ? cb * 2 * cs : cb + (2 * cs - 1) - cb * (2 * cs - 1));
export const BLEND = {
  normal: (cb, cs) => cs,
  multiply: (cb, cs) => cb * cs,
  screen: (cb, cs) => cb + cs - cb * cs,
  overlay: (cb, cs) => hard(cs, cb),
  darken: (cb, cs) => Math.min(cb, cs),
  lighten: (cb, cs) => Math.max(cb, cs),
  'color-dodge': (cb, cs) => (cb === 0 ? 0 : cs === 1 ? 1 : Math.min(1, cb / (1 - cs))),
  'color-burn': (cb, cs) => (cb === 1 ? 1 : cs === 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs)),
  'hard-light': hard,
  'soft-light': (cb, cs) => (cs <= 0.5 ? cb - (1 - 2 * cs) * cb * (1 - cb) : cb + (2 * cs - 1) * ((cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb)) - cb)),
  difference: (cb, cs) => Math.abs(cb - cs),
  exclusion: (cb, cs) => cb + cs - 2 * cb * cs,
};
// §10.2's non-separable modes, on whole colors, as written there (ClipColor reads min and max once)
const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const clipColor = (c) => { const l = lum(c), n = Math.min(...c), x = Math.max(...c);
  if (n < 0) c = c.map((v) => l + ((v - l) * l) / (l - n));
  if (x > 1) c = c.map((v) => l + ((v - l) * (1 - l)) / (x - l));
  return c; };
const setLum = (c, l) => { const d = l - lum(c); return clipColor(c.map((v) => v + d)); };
const sat = (c) => Math.max(...c) - Math.min(...c);
const setSat = (c, s) => { const mx = Math.max(...c), mn = Math.min(...c); return c.map((v) => (mx > mn ? ((v - mn) * s) / (mx - mn) : 0)); };
export const NONSEP = {
  hue: (cb, cs) => setLum(setSat(cs, sat(cb)), lum(cb)),
  saturation: (cb, cs) => setLum(setSat(cb, sat(cs)), lum(cb)),
  color: (cb, cs) => setLum(cs, lum(cb)),
  luminosity: (cb, cs) => setLum(cb, lum(cs)),
};
// bytes: the backdrop held as 8-bit premultiplied between steps, as browsers paint a stack of boxes
export function layers(colors, mode = 'normal', bytes = false) {
  let b = [0, 0, 0, 0];
  for (const c of [...colors].reverse()) {
    const s = rgba(c), as = s[3], ab = b[3], ao = as + ab * (1 - as);
    const c01 = (x) => (mode === 'normal' ? x : Math.min(1, Math.max(0, x))); // the modes read 0..1
    const whole = NONSEP[mode]?.(b.slice(0, 3).map(c01), s.slice(0, 3).map(c01));
    b = [0, 1, 2].map((i) => { const cs1 = (1 - ab) * s[i] + ab * (whole ? whole[i] : BLEND[mode](c01(b[i]), c01(s[i]))); return ao ? (as * cs1 + ab * (1 - as) * b[i]) / ao : 0; });
    b.push(ao);
    if (bytes) { const a = Math.round(ao * 255) / 255; b = [...b.slice(0, 3).map((x) => (a ? Math.round(x * ao * 255) / 255 / a : 0)), a]; }
  }
  return b;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
  const N = +(process.argv[2] ?? 600), MAX = 6;
  // WebKit paints these modes off Compositing 1's formulas (by up to 20/255; saturation 4.7 and luminosity 5.8 on one
  // pair of opaque boxes, where Chrome and Firefox are within 0.5): its paint is not held against the sheet
  const WEBKIT_PAINT = ['color-burn', 'color-dodge', 'soft-light', 'saturation', 'luminosity'];
  // held apart only up to WebKit's measured worst a mode, in /255 (this check's 502 stacks, 2026-10-22: dodge 55, burn 56,
  // soft-light 29, luminosity 4; one pair of boxes: saturation 4.7, luminosity 5.8; WebKit's own paint, measured by this
  // check: which space mix-blend-mode blends in is open, specs/css-color/README.md, "Where the text leaves it open"): past it, a fail
  const WEBKIT_CAP = { 'color-dodge': 55, 'color-burn': 56, 'soft-light': 29, saturation: 5, luminosity: 6 };
  const MAGNIFY = ['color-dodge', 'color-burn']; // the modes whose division magnifies the paint's 8-bit layers
  // WPT's color-layers-no-blend-mode.html, its colors (currentcolor left out: Chrome keeps it unresolved in registered
  // colors, a known trap of the sheet)
  const opaque = ['red', 'blue', 'green', 'purple', 'orange', 'color(display-p3 1 0.5 0)', 'canvas', 'color-mix(in lab, red, blue)'];
  const semi = ['rgb(from yellow r g b / 0.5)', 'rgba(0, 255, 128, 0.6)', 'color-mix(in lab, purple, rgba(0,0,0,0.5))', 'hsla(0, 100%, 20%, 0.4)'];
  const cases = [];
  for (const o of opaque) cases.push({ ls: [o, ...semi], mode: 'normal' });
  for (let i = 0; i < semi.length; i++) {
    const a = semi.slice(0, semi.length - i), u = semi.slice(0, i), f = semi.slice(i + 1);
    cases.push({ ls: a, mode: 'normal' });
    for (const o of opaque) { cases.push({ ls: [...a, o], mode: 'normal' }); if (f.length) cases.push({ ls: [...u, o, ...f], mode: 'normal' }); }
    if (f.length) cases.push({ ls: [...u, ...f], mode: 'normal' });
  }
  const wptCount = cases.length;
  let seed = 20261021; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const q = (x) => +x.toFixed(4);
  const color = (gamut) => { const a = rnd() < 0.5 ? ` / ${q(rnd())}` : '';
    if (gamut || rnd() < 0.8) return `rgb(${[0, 0, 0].map(() => Math.floor(rnd() * 256)).join(' ')}${a})`;
    return `color(display-p3 ${q(rnd())} ${q(rnd())} ${q(rnd())}${a})`; };
  const modes = [...Object.keys(BLEND), ...Object.keys(NONSEP)];
  while (cases.length < N) { const n = 1 + Math.floor(rnd() * MAX), mode = modes[cases.length % modes.length], inG = rnd() < 0.5;
    cases.push({ ls: Array.from({ length: n }, () => color(inG)), mode, paint: inG }); }
  // thin stacks: layers of alpha 0.001 to 0.1 among opaque and translucent ones, every mode (each thin alpha read back
  // between layers lost its digits in Firefox, 2026-10-26: up to 26/255 off before the alphas rode in channels)
  // (color(srgb), whose alpha reads back whole: rgb() reads back as rgba() with 2 decimals; not held to the paint, which
  // keeps a layer this thin in 8 bits)
  const thin = () => `color(srgb ${[0, 0, 0].map(() => q(rnd())).join(' ')} / ${[q(0.001 + rnd() * 0.1), 1, q(rnd())][Math.floor(rnd() * 3)]})`;
  for (let i = 0; i < 160; i++) cases.push({ ls: Array.from({ length: 2 + Math.floor(rnd() * (MAX - 1)) }, thin), mode: modes[i % modes.length], thin: true });
  // the worst stacks a hill-climb found against Compositing 1 before the alphas rode in channels (Firefox, 2026-10-26:
  // 10.2, 4.8 and 1.5 /255 off); thin, but painted whole, as the climb held them
  for (const [mode, ls] of [
    ['color-burn', ['color(srgb 0.6128 0.1208 0.9735 / 0.9223)', 'color(srgb 0.1305 0.1431 0.3489 / 0.9862)', 'color(srgb 0.5376 1 0.5677 / 1)', 'color(srgb 0.1629 0.7402 0.6785 / 0.0571)']],
    ['saturation', ['color(srgb 0.4859 0.2014 0.6093 / 0.0211)', 'color(srgb 0.004 0.2714 0.7394 / 0.9882)', 'color(srgb 0.2583 0.299 0.1164 / 0.5875)', 'color(srgb 0.1815 0.9431 0.7757 / 0.9817)', 'color(srgb 0.1449 0 0.486 / 0.9467)']],
    ['color', ['color(srgb 0.4939 0.9857 0 / 1)', 'color(srgb 0.8692 0.8319 0.2253 / 1)', 'color(srgb 0.8761 0.8141 0.418 / 0.6346)']],
  ]) cases.push({ ls, mode, thin: true });
  // every other normal stack carries blend-normal, which composites with no blend as no class does
  const cls = (c, i) => `color-layers${c.mode === 'normal' ? (i % 2 ? ' blend-normal' : '') : ` blend-${c.mode}`}`;
  const vars = (c) => c.ls.map((l, k) => `--gamut-layer-${k + 1}: ${l}`).join('; ');
  const page = `<!doctype html><style>${css}\nbody { margin: 0; background: white; }
#g { display: grid; grid-template-columns: repeat(40, 10px); } #g > i { height: 10px; background: var(--gamut-out); }
.ref { position: relative; isolation: isolate; height: 10px; } .ref > b { position: absolute; inset: 0; }</style>
<div id=g>${cases.map((c, i) => `<i class="${gamut(cls(c, i))}" style="${vars(c)}"></i>`).join('')}</div>
<div id=r style="display: grid; grid-template-columns: repeat(40, 10px)">${cases.map((c) => `<i class="ref">${c.ls.map((l) => `<b style="background: ${l}; mix-blend-mode: ${c.mode}"></b>`).reverse().join('')}</i>`).join('')}</div>`;
  let failed = false;
  for (const [name, type, opts] of pick()) {
    const b = await pw[type].launch(opts), p = await b.newPage({ viewport: { width: 400, height: 2000 } });
    await p.setContent(page);
    // the engine's own value of each layer color (Color.js reads neither color-mix() nor canvas), then Compositing 1
    const uniq = [...new Set(cases.flatMap((c) => c.ls))];
    const res = Object.fromEntries(await p.evaluate((u) => { const d = document.createElement('div'); document.body.append(d);
      return u.map((c) => { d.style.setProperty('--gamut-layer-1', c); d.style.color = 'var(--gamut-layer-1)'; return [c, /^color\(srgb /.test(c) ? c : getComputedStyle(d).color]; }); }, uniq)); // color(srgb) as written: Firefox reads back its alpha to 3 decimals
    for (const c of cases) { c.want = layers(c.ls.map((l) => res[l]), c.mode); c.want8 = layers(c.ls.map((l) => res[l]), c.mode, true); }
    const got = await p.evaluate(() => [...document.querySelectorAll('#g > i')].map((e) => getComputedStyle(e).getPropertyValue('--gamut-out')));
    const bad = [], badW = [];
    cases.forEach((c, i) => {
      let g; try { g = rgba(got[i]); } catch { bad.push(`${i}: unreadable ${got[i]}`); return; }
      // under alpha 0.15, premultiplied: Firefox rounds a mix's alpha to 3 decimals and divides by it, 0.0005 / alpha a
      // channel at most (QUIRKS Q77)
      const w = c.want, off = Math.max(...[0, 1, 2].map((k) => (w[3] >= 0.15 ? Math.abs(g[k] - w[k]) : Math.abs(g[k] * g[3] - w[k] * w[3])))) * 255, offA = Math.abs(g[3] - w[3]) * 255;
      if (!(off <= 1.5 && offA <= 2)) (i < wptCount ? badW : bad).push(`${i} ${c.mode}: [${c.ls.join(', ')}] -> ${got[i]}, want ${w.map((x) => x.toFixed(4)).join(' ')}`);
    });
    // paint: each square's middle pixel, ours against the stacked boxes
    const { PNG } = need('pngjs');
    const shot = PNG.sync.read(await p.screenshot({ fullPage: true }));
    const px = (x, y) => { const o = (y * shot.width + x) * 4; return [shot.data[o], shot.data[o + 1], shot.data[o + 2]]; };
    const rows = Math.ceil(cases.length / 40), badP = [], known = [], bytes = [], worstK = {}; let painted = 0;
    const white = (w) => [0, 1, 2].map((k) => (w[k] * w[3] + 1 - w[3]) * 255); // over the white page
    const inSrgb = (l) => rgba(res[l]).slice(0, 3).every((x) => x >= -1e-6 && x <= 1 + 1e-6);
    cases.forEach((c, i) => { if (c.thin || !c.ls.every(inSrgb)) return; painted++;
      const x = (i % 40) * 10 + 5, y = Math.floor(i / 40) * 10 + 5, a = px(x, y), r = px(x, y + rows * 10);
      const d = Math.max(...[0, 1, 2].map((k) => Math.abs(a[k] - r[k]))), w8 = white(c.want8), d8 = Math.max(...[0, 1, 2].map((k) => Math.abs(w8[k] - r[k])));
      // where color-dodge or color-burn magnify the browser's 8-bit layers: its paint is Compositing 1 with bytes between steps
      if (d > 3) { const k = name === 'WebKit' && WEBKIT_PAINT.includes(c.mode) && d <= WEBKIT_CAP[c.mode]; if (k) (worstK[c.mode] = Math.max(worstK[c.mode] ?? 0, d));
        (k ? known : MAGNIFY.includes(c.mode) && d8 <= 3 ? bytes : badP).push(`${i} ${c.mode}: ${a} vs ${r}`); } });
    if (Object.keys(worstK).length) console.log(`  WebKit's own paint, worst off a mode: ${JSON.stringify(worstK)}`);
    failed ||= bad.length + badW.length + badP.length > 0;
    console.log(`${name}: WPT's ${wptCount - badW.length} of ${wptCount}, random ${cases.length - wptCount - bad.length} of ${cases.length - wptCount} match Compositing 1 (${(() => { const ns = cases.filter((c) => NONSEP[c.mode]).length, nb = bad.filter((x) => NONSEP[x.split(' ')[1].replace(':', '')]).length; return `${ns - nb} of ${ns} in ${Object.keys(NONSEP).join(', ')}`; })()}); paint ${painted - badP.length - known.length - bytes.length} of ${painted} within 3/255 of the browser's own${bytes.length ? `, ${bytes.length} more within 3/255 of Compositing 1 with bytes between layers (its paint's own rounding, magnified by ${[...new Set(bytes.map((x) => x.split(' ')[1].replace(':', '')))].join(' and ')})` : ''}${known.length ? ` (${known.length} more where WebKit paints ${WEBKIT_PAINT.join(', ')} off Compositing 1, off the sRGB reference as measured, within its worst: L3 FAIL in WebKit)` : ''}${[...badW, ...bad, ...badP].length ? `\n  ${[...badW, ...bad, ...badP].slice(0, 8).join('\n  ')}` : ''}`);
    await b.close();
  }
  process.exit(failed ? 1 : 0);
}
