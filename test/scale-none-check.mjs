// Checks .gamut-color-interpolate with none in its stops (CSS Color 4 §13: a missing component borrows from the other color
// of the two being interpolated): each scale's computed --gamut-out against the browser's own two-color color-mix()
// of the segment's stops, both read as computed values and compared in sRGB (a canvas would premultiply the
// translucent case in 8 bits), within 1/255 a channel and 2/255 alpha, in Chrome, WebKit and Firefox.
// Usage: node test/scale-none-check.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pw, pick } from './engines.mjs';
const C0 = createRequire(import.meta.url)('colorjs.io'), Color = C0.default ?? C0;
const srgba = (c) => { const k = new Color(c.replace(/-?[0-9.]+e[-+]?[0-9]+/g, (m) => (+m).toFixed(12))).to('srgb'); return [...k.coords.map((x) => (Number.isNaN(x) ? 0 : x)), Number.isNaN(k.alpha) ? 1 : k.alpha]; };
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const cases = [
  ['oklab', ['oklab(.2 .2 0)', 'oklab(.5 none 0)', 'oklab(.8 -.2 0)'], [0.25, 0.75, 0.6]],
  ['oklch', ['oklch(0.6 0.2 30)', 'oklch(1 0 none)', 'oklch(0.5 0.2 264)'], [0.2, 0.5, 0.75, 0.9]],
  ['oklch', ['oklch(0.7 0.15 none)', 'oklch(0.6 0.2 140)', 'oklch(0.5 0.1 none)', 'oklch(0.4 0.2 300)'], [0.1, 0.4, 0.6, 0.8]],
  ['srgb', ['rgb(255 0 0 / none)', 'rgb(0 0 255 / 0.5)', 'rgb(0 255 0)'], [0.25, 0.75]],
];
const scales = cases.flatMap(([space, stops, ts]) => ts.map((t) => {
  const seg = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1))), local = t * (stops.length - 1) - seg;
  return { space, stops, t, ref: `color-mix(in ${space}, ${stops[seg]}, ${stops[seg + 1]} ${+(local * 100).toFixed(6)}%)` };
}));
const html = `<style>${css} @property --ref { syntax: '<color>'; inherits: false; initial-value: black; }</style>${scales.map((s) =>
  `<i class="gamut-color-interpolate" style="--gamut-space: ${s.space}; --gamut-stops: ${s.stops.length}; ${s.stops.map((c, k) => `--gamut-stop-${k + 1}: ${c}; --gamut-at-${k + 1}: ${+(k / (s.stops.length - 1)).toFixed(6)}`).join('; ')}; --gamut-t: ${s.t}"></i><b style="--ref: ${s.ref}"></b>`).join('')}`;
for (const [n, t, o] of pick()) {
  const b = await pw[t].launch(o), p = await b.newPage();
  await p.setContent(html);
  const got = await p.evaluate(() => { const is = [...document.querySelectorAll('i')], bs = [...document.querySelectorAll('b')];
    return is.map((e, k) => [getComputedStyle(e).getPropertyValue('--gamut-out').trim(), getComputedStyle(bs[k]).getPropertyValue('--ref').trim()]); });
  await b.close();
  let bad = 0;
  got.forEach(([g0, r0], k) => { const g = srgba(g0), r = srgba(r0), s = scales[k];
    const d = Math.max(...[0, 1, 2].map((j) => Math.abs(g[j] - r[j]) * 255), Math.abs(g[3] - r[3]) * 255 / 2);
    if (d > 1) { bad++; console.log(`  ${n} ${s.space} ${s.stops.join(', ')} t=${s.t}: got ${g0} want ${r0}`); } });
  if (bad) process.exitCode = 1;
  console.log(`${n}: ${got.length - bad} of ${got.length} scales with none in their stops match the segment's own color-mix() within 1/255`);
}
