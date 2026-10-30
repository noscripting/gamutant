// Checks contrast.css (.gamut-readable-text) in Chrome, WebKit and Firefox: 4,096 backgrounds (the 16-level sRGB grid) and
// 4,096 random fractional ones (color(srgb …) in doubles, which the paint rounds to 8 bits), each with a patch painted
// var(--gamut-text), at ratios 1.05 (a text a shade off its background: a mix of under 2% toward white or black), 3,
// 4.5 and 7, and with no --gamut-ratio (the default, 4.5). WCAG 2 contrast from the
// painted pixels. PASS when every background whose chosen direction can reach the ratio paints at least the ratio, the
// rest paint black or white, and every patch is the background's own shade as T1 has it: the painted background's
// linear channels mixed toward white by (R (Y + 0.05) - 0.05 - Y) / (1 - Y) below Y = 0.179129, or scaled toward
// black by ((Y + 0.05) / R - 0.05) / Y above, clamped to 0..1, each channel encoded and rounded toward that end, within
// 1/255 (a channel landing on a whole byte can round either way). Also: style time for 256 shades when --gamut-ratio
// changes (a new value every run), under the bench lock. SHEET= another sheet. Usage: node test/contrast-check.mjs
import { readFileSync } from 'node:fs';
import { pw, need, pick, benchLock } from './engines.mjs';
import { lum8 } from './ref/methods.mjs';
const { PNG } = need('pngjs');
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const L = [0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255];
const grid = []; for (const r of L) for (const g of L) for (const b of L) grid.push(`rgb(${r} ${g} ${b})`);
let seed = 20261021; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const frac = Array.from({ length: 4096 }, () => `color(srgb ${rnd()} ${rnd()} ${rnd()})`);
const page = (R, bgs) => `<style>${css} body{margin:0} #g{display:grid;grid-template-columns:repeat(64,8px);grid-auto-rows:8px} #g i{background:var(--gamut-bg)} #g i b{display:block;margin:2px;height:4px;background:var(--gamut-text)}</style>
<div id=g${R === undefined ? '' : ` style="--gamut-ratio: ${R}"`}>${bgs.map((c) => `<i class=gamut-readable-text style="--gamut-bg: ${c}"><b></b></i>`).join('')}</div>`;
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const Y = lum8;
const ratio = (a, b) => { const [h, l] = [Y(a), Y(b)].sort((p, q) => q - p); return (h + 0.05) / (l + 0.05); };
const enc = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255;
// T1's text for a painted background at ratio R, in bytes. 0.179129 is the luminance where black and white give the
// same WCAG 2 contrast: (Y + 0.05) / 0.05 = 1.05 / (Y + 0.05), so Y = sqrt(1.05 * 0.05) - 0.05.
const model = (bg, R) => { const Yb = Y(bg), lb = bg.map(lin);
  if (Yb < 0.179129) { const f = Math.min(1, Math.max(0, (R * (Yb + 0.05) - 0.05 - Yb) / (1 - Yb))); return lb.map((v) => Math.ceil(enc(v + (1 - v) * f) - 1e-9)); }
  const k = Math.min(1, Math.max(0, ((Yb + 0.05) / R - 0.05) / Yb)); return lb.map((v) => Math.floor(enc(v * k) + 1e-9)); };
let failed = false;
for (const [n, t, o] of pick()) {
  const b = await pw[t].launch(o), p = await b.newPage({ viewport: { width: 512, height: 512 } });
  for (const [set, bgs, Rs] of [['grid', grid, [1.05, 3, 4.5, 7, undefined]], ['fractional', frac, [1.05, 3, 4.5, 7]]]) for (const R0 of Rs) {
    const R = R0 ?? 4.5;
    await p.setContent(page(R0, bgs));
    const img = PNG.sync.read(await p.screenshot());
    let fail = 0, reach = 0, min = 99, needless = 0, wrongEnd = 0, shade = 0, worst = 0, ex = '';
    bgs.forEach((c, i) => {
      const x = (i % 64) * 8, y = Math.floor(i / 64) * 8, at = (dx, dy) => { const q = ((y + dy) * img.width + x + dx) * 4; return [img.data[q], img.data[q + 1], img.data[q + 2]]; };
      const bg = at(0, 0), fg = at(4, 4), Yb = Y(bg), dark = Yb >= 0.179129;
      const can = dark ? (Yb + 0.05) / 0.05 >= R : 1.05 / (Yb + 0.05) >= R, r = ratio(bg, fg), end = fg.join() === '0,0,0' || fg.join() === '255,255,255';
      if (can) { reach++; min = Math.min(min, r); if (r < R) fail++; if (end) needless++; } else if (!end) wrongEnd++;
      const want = model(bg, R), d = Math.max(...want.map((v, k) => Math.abs(v - fg[k])));
      if (d > worst) { worst = d; ex = `bg ${bg} text ${fg}, want ${want}`; } if (d > 1) shade++;
    });
    const ok = !fail && !wrongEnd && !shade; failed ||= !ok;
    console.log(`${n} ${set} R=${R0 === undefined ? '4.5 (default)' : R}: ${ok ? 'PASS' : 'FAIL'} reachable ${reach}/4096 all >= R (below: ${fail}, min ${min.toFixed(3)}); unreachable not black/white: ${wrongEnd}; reachable but black/white: ${needless}; off T1's shade: ${shade}/4096 (worst ${worst}/255${shade ? `, ${ex}` : ''})`);
  }
  await p.setContent(`<style>${css} body{margin:0} #g{display:grid;grid-template-columns:repeat(32,4px);grid-auto-rows:4px} #g i{background:var(--gamut-text)}</style>
<div id=g>${Array.from({ length: 256 }, (_, i) => `<i class=gamut-readable-text style="--gamut-bg: rgb(${(i * 37) % 256} ${(i * 91) % 256} ${(i * 53) % 256})"></i>`).join('')}</div>`);
  const release = await benchLock('contrast-check.mjs');
  const ms = await p.evaluate(async () => { const times = [];
    for (let r = 0; r < 11; r++) { await new Promise(requestAnimationFrame); const t0 = performance.now();
      document.documentElement.style.setProperty('--gamut-ratio', String(3 + r * 0.137)); document.body.offsetWidth; times.push(performance.now() - t0); }
    times.sort((a, b) => a - b); return times[5]; });
  release();
  console.log(`${n}: 256 shades recomputed: ${ms.toFixed(2)} ms (median of 11)`);
  await b.close();
}
process.exit(failed ? 1 : 0);
