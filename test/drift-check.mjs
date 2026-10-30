// Checks what README.md says each --gamut-method keeps of a color, in Chrome, WebKit and Firefox: random colors outside
// each of the five targets (and chosen ones where prophoto-rgb turns the hue), through .gamut-fit-screen, each
// --gamut-out read back as oklch. The default, css, MUST end within deltaEOK 0.02 (CSS Color 4's JND) of a color of the
// input's own lightness and hue. To srgb, display-p3, rec2020 and a98-rgb, in results of chroma 0.05 or more,
// edge-seeker and adaptive MUST keep the hue within 2 degrees and ray-trace within 5; edge-seeker and ray-trace MUST
// keep the lightness within 0.02, and adaptive MUST move it toward the cusp's (the hue's most colorful color, where
// gamut_clip_adaptive_L0_L_cusp aims), never past it. To prophoto-rgb, ray-trace and adaptive MUST each turn some result
// of chroma 0.05 or more by 20 degrees or more, as README.md warns. The 2 and 5 degrees are bounds on these colors with
// room (3,000 colors a target turned 0.93 and 3.29 at worst, 2026-10-30), not proofs: SPEC.md's G20 and G22 tie each
// method to its reference within 1/255. Usage: node test/drift-check.mjs [count=400]  (random colors a target)
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pw, pick } from './engines.mjs';
const C0 = createRequire(import.meta.url)('colorjs.io'), Color = C0.default ?? C0;
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const N = +(process.argv[2] ?? 400);
// the cusp's lightness at a hue: the most saturated color of the hue inside the gamut at L 1 (in linear light, before
// the top is cut), scaled down until its largest channel is 1; Color.js 0.7.1's matrices, as test/ref/okhsl.mjs's exact()
const LIN = { srgb: 'srgb-linear', 'display-p3': 'p3-linear', rec2020: 'rec2020-linear', 'a98-rgb': 'a98rgb-linear' };
const mm = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const lms = (L, a, b) => [L + 0.3963377774 * a + 0.2158037573 * b, L - 0.1055613458 * a - 0.0638541728 * b, L - 0.0894841775 * a - 1.2914855480 * b].map((x) => x ** 3);
const cuspL = (t, h) => {
  const M = mm(Color.Space.get(LIN[t]).M.fromXYZ, Color.Space.get('oklab').M.LMStoXYZ), a = Math.cos(h * Math.PI / 180), b = Math.sin(h * Math.PI / 180);
  const rgb = (S) => { const c = lms(1, S * a, S * b); return M.map((w) => w[0] * c[0] + w[1] * c[1] + w[2] * c[2]); };
  let lo = 0, hi = 0.005; while (rgb(hi).every((x) => x >= 0)) { lo = hi; hi += 0.005; }
  for (let j = 0; j < 60; j++) { const m = (lo + hi) / 2; if (rgb(m).every((x) => x >= 0)) lo = m; else hi = m; }
  return Math.cbrt(1 / Math.max(...rgb(lo)));
};
const TARGETS = { srgb: 'srgb', 'display-p3': 'p3', rec2020: 'rec2020', 'a98-rgb': 'a98rgb', 'prophoto-rgb': 'prophoto' };
const METHODS = ['css', 'edge-seeker', 'ray-trace', 'adaptive'];
// found by a run of 1,610 colors a target (2026-10-30): prophoto-rgb results ray-trace and adaptive turn past 20 degrees
const CHOSEN = { 'prophoto-rgb': [[0.0241, 0.6652, 231.14], [0.2791, 0.7807, 214.44], [0.1788, 0.7169, 230.58], [0.401, 0.7663, 212.09]] };
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const cases = {};
for (const [t, sp] of Object.entries(TARGETS)) {
  const list = [...(CHOSEN[t] ?? [])];
  while (list.length < N) {
    const lch = [0.02 + rnd() * 0.96, rnd() * (t === 'prophoto-rgb' ? 0.9 : 0.5), rnd() * 360];
    if (!new Color('oklch', lch).inGamut(sp, { epsilon: 0 })) list.push(lch);
  }
  cases[t] = list;
}
const fmt = (lch) => `oklch(${lch.map((x) => +x.toFixed(6)).join(' ')})`;
const html = `<!doctype html><style>${css}</style><body>${Object.keys(TARGETS).flatMap((t) => METHODS.map((m) =>
  `<div style="--gamut-target: ${t}; --gamut-method: ${m}">${cases[t].map((c) => `<i class="gamut-fit-screen" style="--gamut-in: ${fmt(c)}; color: oklch(from var(--gamut-out) l c h)"></i>`).join('')}</div>`)).join('')}`;
const turn = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const ten = (x) => +x.toFixed(4);
let failed = false;
for (const [name, type, opts] of pick()) {
  const b = await pw[type].launch(opts), p = await b.newPage();
  let got;
  try { await p.setContent(html, { timeout: 180000 }); got = await p.evaluate(() => [...document.querySelectorAll('div')].map((d) => [...d.children].map((i) => getComputedStyle(i).color))); }
  finally { await b.close(); }
  let k = 0;
  for (const t of Object.keys(TARGETS)) for (const m of METHODS) {
    const row = got[k++], bad = [];
    let far = 0, wL = 0, wH = 0, kept = 0, past20 = 0;
    row.forEach((s, i) => {
      const [L, C, h] = cases[t][i], v = s.match(/^oklch\(([-\d.e]+) ([-\d.e]+) ([-\d.e]+|none)/);
      if (!v) { bad.push(`${fmt(cases[t][i])}: ${s}`); return; }
      const [L2, C2] = [+v[1], +v[2]], h2 = v[3] === 'none' ? 0 : +v[3], dL = Math.abs(L2 - L), dh = turn(h2, h);
      // how far the result is from the nearest color of the input's lightness and hue (OkLab, deltaEOK)
      const off = Math.hypot(dL, dh < 90 ? C2 * Math.sin(dh * Math.PI / 180) : C2);
      far = Math.max(far, off); wL = Math.max(wL, dL);
      if (C2 >= 0.05) { kept++; wH = Math.max(wH, dh); if (dh >= 20) past20++; }
      const f = [];
      if (m === 'css' && off > 0.0205) f.push(`${off.toFixed(4)} from its lightness and hue`);
      if (t !== 'prophoto-rgb') {
        if (C2 >= 0.05 && dh > { 'edge-seeker': 2, 'ray-trace': 5, adaptive: 2 }[m]) f.push(`hue turned ${dh.toFixed(2)} degrees`);
        if ((m === 'edge-seeker' || m === 'ray-trace') && dL > 0.0205) f.push(`lightness moved ${dL.toFixed(4)}`);
        if (m === 'adaptive') { const c = cuspL(t, h); if (Math.abs(L2 - c) > Math.abs(L - c) + 1e-3 || (L2 - c) * (L - c) < -1e-6) f.push(`lightness not toward the cusp's, ${c.toFixed(4)}`); }
      }
      if (f.length) bad.push(`${fmt(cases[t][i])}: ${s}, ${f.join(', ')}`);
    });
    const warned = t === 'prophoto-rgb' && (m === 'ray-trace' || m === 'adaptive');
    const unwarned = warned && !past20 ? '; no result of chroma 0.05 or more turned 20 degrees, which README.md says can happen' : '';
    failed ||= bad.length > 0 || !!unwarned;
    console.log(`${name}: ${t} ${m}: ${row.length - bad.length} of ${row.length}; worst ${ten(far)} from the input's lightness and hue, lightness ${ten(wL)}, hue ${wH.toFixed(2)} degrees in ${kept} results of chroma 0.05 or more${warned ? ` (${past20} past 20)` : ''}${unwarned}${bad.length ? `; off: ${bad.slice(0, 3).join('; ')}` : ''}`);
  }
}
console.log(failed ? 'FAIL' : 'PASS');
process.exit(failed ? 1 : 0);
