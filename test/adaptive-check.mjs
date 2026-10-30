// Checks --gamut-method: adaptive on .gamut-fit-screen (Chrome, WebKit, Firefox) and --gamut-fit-screen() (Chrome), to every
// --gamut-target (srgb, display-p3, rec2020, a98-rgb, prophoto-rgb): Björn Ottosson's gamut_clip_adaptive_L0_L_cusp,
// alpha 0.05 (bottosson.github.io/posts/gamutclipping/), for that gamut. The reference, in Color.js 0.7.1: a color inside
// the gamut is unchanged; L >= 1 is white and L <= 0 black; else, in OKLab at the color's hue, the point where the segment
// from (L0, 0) to (L, C) leaves the gamut (bisected 50 times), L0 = Lcusp + 0.5 sgn(Ld) (e1 - sqrt(e1^2 - 2 k |Ld|)),
// Ld = L - Lcusp, k = 2 (Ld > 0 ? 1 - Lcusp : Lcusp), e1 = k / 2 + |Ld| + alpha C / k, the cusp (the most chroma at that
// hue) found numerically, independent of the sheet's hexagon. Within 2/255 a channel in the target's encoded channels
// (rec2020 by BT.2020's curve, as the engines encode it); the input's alpha kept within 1/255. Random colors out of and
// in each gamut, and the ends.
// The cusp's notches are reported apart (see hexChroma below).
// Usage: node test/adaptive-check.mjs [colors=60]   (SHEET= another sheet, ENGINES= some engines)
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pick, open } from './engines.mjs';
const C0 = createRequire(import.meta.url)('colorjs.io'), Color = C0.default ?? C0;
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const N = +(process.argv[2] ?? 60);
// a target: the space its gamut is tested in (linear light) and the one compared (its encoding)
const TARGETS = { srgb: ['srgb-linear', 'srgb'], 'display-p3': ['p3-linear', 'p3'], rec2020: ['rec2020-linear', '--rec2020-oetf'], 'a98-rgb': ['a98rgb-linear', 'a98rgb'], 'prophoto-rgb': ['prophoto-linear', 'prophoto'] };
const engine = (s) => s.replace(/^color\(rec2020 /, 'color(--rec2020-oetf ');
const lin = (L, a, b, t) => new Color('oklab', [L, a, b]).to(TARGETS[t][0]).coords;
const inside = (L, a, b, t, eps = 1e-7) => lin(L, a, b, t).every((v) => v >= -eps && v <= 1 + eps);
const maxC = (L, a_, b_, t) => { let lo = 0, hi = 1.5; for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; inside(L, m * a_, m * b_, t) ? (lo = m) : (hi = m); } return lo; };
function cusp(a_, b_, t) {
  let best = [0, 0]; for (let L = 0.01; L < 1; L += 0.01) { const c = maxC(L, a_, b_, t); if (c > best[1]) best = [L, c]; }
  let lo = Math.max(0, best[0] - 0.01), hi = Math.min(1, best[0] + 0.01);
  for (let k = 0; k < 60; k++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; maxC(m1, a_, b_, t) < maxC(m2, a_, b_, t) ? (lo = m1) : (hi = m2); }
  return [(lo + hi) / 2, maxC((lo + hi) / 2, a_, b_, t)];
}
// Where a hue's slice of the gamut has a notch (near blue: sRGB 264.05-264.21deg, rec2020 near 245deg), the most
// chroma found from the grey axis (the reference's cusp) is less than the most chroma of the slice (its point on the
// cube's hexagon of edges, Ottosson's cusp and the sheet's): there the two cusps differ and so do the maps. Such colors
// are counted apart and not failed: their hue's hexagon chroma (the most, of the hexagon's points within 0.3deg) is more
// than 0.01 over the reference's. So are prophoto-rgb's hues from 192.5 to 225deg, past the visible, where a hue meets
// its hexagon up to three times (to 206deg), the reference's cusp jumps from one part to another between nearby hues,
// and on its blue-magenta edge the hue turns about 1,000deg a unit of s, more than the sheet's hexagon Newton steps
// resolve (oklch(0.1405 0.4032 212.31): the sheet's cusp at hue 206.4, 13.5/255 off in WebKit, whose prophoto-rgb
// conversion gives negative channels as 0, so its exit can't correct for it).
const hexS = (s) => [Math.min(1, Math.max(0, Math.abs(s - 3) - 1)), Math.min(1, Math.max(0, 2 - Math.abs(s - 2))), Math.min(1, Math.max(0, 2 - Math.abs(s - 4)))];
const HEX = {};
const hexChroma = (h, t) => { const pts = (HEX[t] ??= Array.from({ length: 12000 }, (_, i) => new Color(TARGETS[t][0], hexS(i / 2000)).to('oklch').coords));
  let c = 0; for (const [, pc, ph] of pts) if (Math.abs(((ph - h + 540) % 360) - 180) < 0.3) c = Math.max(c, pc); return c; };
const notch = {};
function adaptive(input, t) {
  const sp = TARGETS[t][1], [L, a, b] = new Color(input).to('oklab').coords.map((v) => v || 0);
  if (L >= 1) return new Color('white').to(sp).coords;
  if (L <= 0) return new Color('black').to(sp).coords;
  if (inside(L, a, b, t, 0)) return null; // the engine's own conversion of the input
  const C = Math.max(1e-5, Math.hypot(a, b)), a_ = a / C, b_ = b / C, [Lc, Cc] = cusp(a_, b_, t);
  const h = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
  if (hexChroma(h, t) > Cc + 0.01 || (t === 'prophoto-rgb' && h >= 192.5 && h <= 225)) notch[`${t} ${input}`] = true;
  const Ld = L - Lc, k = 2 * (Ld > 0 ? 1 - Lc : Lc), e1 = 0.5 * k + Math.abs(Ld) + 0.05 * C / k;
  const L0 = Lc + 0.5 * Math.sign(Ld) * (e1 - Math.sqrt(e1 * e1 - 2 * k * Math.abs(Ld)));
  let lo = 0, hi = 1; for (let n = 0; n < 50; n++) { const m = (lo + hi) / 2, Lm = L0 * (1 - m) + m * L; inside(Lm, m * C * a_, m * C * b_, t) ? (lo = m) : (hi = m); }
  return new Color('oklab', [L0 * (1 - lo) + lo * L, lo * C * a_, lo * C * b_]).to(sp).coords;
}
let seed = 9449; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, f = (x, d = 4) => (+x).toFixed(d);
const INS = Array.from({ length: N }, (_, i) => `oklch(${f(0.02 + rnd() * 0.96)} ${f(i % 6 === 5 ? rnd() * 0.08 : rnd() * (i % 3 ? 0.45 : 0.9))} ${f(rnd() * 360, 2)}${i % 10 === 9 ? ` / ${f(0.2 + rnd() * 0.7, 2)}` : ''})`)
  .concat(['oklch(1 0.3 30)', 'oklch(0 0.3 30)', 'oklch(0.99 0.12 182.55)', 'oklch(0.3 0.3 264)', 'color(display-p3 0 1 0)', 'oklch(0.52 1.2 220)', 'oklch(0.7 0.4 200)', 'oklch(0.45 0.5 264.1)', 'oklch(0.3 0.4 200)', 'oklch(0.9 2 30)', 'oklch(0.9 2 150)', 'oklch(0.7 0.8 30)']);
const want = {}; for (const t of Object.keys(TARGETS)) want[t] = INS.map((c) => adaptive(c, t));
// The cusp as the most chroma where a hue meets prophoto-rgb's hexagon three times (192.6 to 206deg): a color at the
// cusp's lightness, chroma 2, exits at the cusp itself (a review, 2026-10-28: the sheet took the first
// meeting, chroma 0.44 at 195deg for 1.47, and its steps carried chroma through alpha, clamped at 1, 198deg)
const hexCusp = (h, t) => { const at = (s) => new Color(TARGETS[t][0], hexS(s)).to('oklch').coords, d = (s) => ((at(s)[2] - h + 540) % 360) - 180;
  let best = null; for (let i = 0; i < 60000; i++) { let lo = i / 10000, hi = (i + 1) / 10000; if (d(lo) * d(hi) > 0 || Math.abs(d(lo) - d(hi)) > 20) continue;
    for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; d(lo) * d(m) <= 0 ? (hi = m) : (lo = m); }
    const [L, C] = at(lo); if (!best || C > best.C) best = { L, C, want: new Color(TARGETS[t][0], hexS(lo)).to(TARGETS[t][1]).coords }; }
  return best; };
const CUSPS = [195, 198].map((h) => { const c = hexCusp(h, 'prophoto-rgb'); return { input: `oklch(${c.L.toFixed(9)} 2 ${h})`, want: c.want }; });
// the class reads --gamut-method and --gamut-target from the parent; the function reads them from the element (every
// other color), or takes them as arguments where the element's own say otherwise
const html = (fn) => `<!doctype html><style>${css}</style><body>${Object.keys(TARGETS).map((t) => `<div style="--gamut-target: ${t}; --gamut-method: adaptive">${INS.map((c, i) => `${fn
  ? `<i data-t="${t}" data-i="${i}" style="${i % 2 ? `--gamut-target: srgb; --gamut-method: css; background: --gamut-fit-screen(${c}, ${t}, adaptive)` : `background: --gamut-fit-screen(${c})`}"></i>`
  : `<i class="gamut-fit-screen" data-t="${t}" data-i="${i}" style="--gamut-in: ${c}; background: var(--gamut-out)"></i>`}<s data-t="${t}" data-i="${i}" style="background: color(from ${c} ${t} r g b / alpha)"></s>`).join('')}</div>`).join('')}
<div style="--gamut-target: prophoto-rgb; --gamut-method: adaptive">${CUSPS.map((c) => (fn ? `<u style="background: --gamut-fit-screen(${c.input})"></u>` : `<u class="gamut-fit-screen" style="--gamut-in: ${c.input}; background: var(--gamut-out)"></u>`)).join('')}</div></body>`;
let failed = false;
for (const eng of pick(['Chrome', 'WebKit', 'Firefox'])) {
  for (const fn of eng[0] === 'Chrome' ? [false, true] : [false]) {
    const { browser, page } = await open(eng);
    await page.setContent(html(fn), { timeout: 300000 });
    const got = await page.evaluate(() => [...document.querySelectorAll('i, s')].map((e) => [e.tagName, e.dataset.t, +e.dataset.i, getComputedStyle(e).backgroundColor]));
    const cusps = await page.evaluate(() => [...document.querySelectorAll('u')].map((e) => getComputedStyle(e).backgroundColor));
    await browser.close();
    const offC = CUSPS.map((c, k) => { const have = new Color(cusps[k]).to('prophoto').coords, d = Math.max(...have.map((v, j) => Math.abs((v ?? 0) - c.want[j]))) * 255;
      return d <= 2 ? null : `${c.input}: ${cusps[k]} want ${c.want.map((v) => (v * 255).toFixed(1)).join(' ')} (${d.toFixed(1)}/255)`; }).filter(Boolean);
    failed ||= offC.length > 0;
    console.log(`${eng[0]} ${fn ? 'function' : 'class'} prophoto-rgb at the cusp, 192.6 to 206deg: ${CUSPS.length - offC.length} of ${CUSPS.length} within 2/255${offC.length ? `; off: ${offC.join(' | ')}` : ''}`);
    const own = Object.fromEntries(got.filter(([tag]) => tag === 'S').map(([, t, i, bg]) => [`${t} ${i}`, bg]));
    const res = {};
    for (const [tag, t, i, bg] of got) {
      if (tag !== 'I') continue;
      const r = (res[t] ??= { n: 0, bad: [], worst: 0, notch: [], more: [] }), sp = TARGETS[t][1], alpha = new Color(INS[i]).alpha;
      const w = want[t][i] ?? new Color(engine(own[`${t} ${i}`])).to(sp).coords;
      let have, a; try { const c = new Color(engine(bg)); have = c.to(sp).coords; a = c.alpha; } catch { r.n++; r.bad.push(`${INS[i]}: ${bg}`); continue; }
      const d = Math.max(...have.map((v, k) => Math.abs((v ?? 0) - w[k]))) * 255, da = Math.abs(a - alpha) * 255;
      // the method moves a color along the segment to its anchor: never to more chroma than its own, notches included
      // (to prophoto-rgb oklch(0.3 0.4 200) came out at chroma 1, a review, 2026-10-28)
      const cOut = new Color(engine(bg)).to('oklch').coords[1], cIn = new Color(INS[i]).to('oklch').coords[1];
      // (by more than 0.01, half OKLab's 0.02 noticeable difference: Chrome 155 gives a near-black 0.005 more to prophoto-rgb)
      if (want[t][i] !== null && cOut > cIn + 0.01) r.more.push(`${INS[i]}: chroma ${cOut.toFixed(4)}`);
      // a notch excuses the channels only: alpha and finite channels still hold there
      if (notch[`${t} ${INS[i]}`]) { if (!(da <= 1) || !have.every((v) => Number.isFinite(v ?? 0))) r.bad.push(`${INS[i]}: ${bg}, alpha or channels lost in a notch`); r.notch.push(`${INS[i]} ${d.toFixed(1)}/255`); continue; }
      r.n++; r.worst = Math.max(r.worst, d);
      if (!(d <= 2 && da <= 1)) r.bad.push(`${INS[i]}: ${bg} want ${w.map((v) => (v * 255).toFixed(1)).join(' ')}`);
    }
    for (const [t, r] of Object.entries(res)) {
      failed ||= r.bad.length > 0 || r.more.length > 0;
      if (r.more.length) console.log(`FAIL ${eng[0]} ${fn ? 'function' : 'class'} ${t}: more chroma than the input: ${r.more.join(', ')}`);
      console.log(`${eng[0]} ${fn ? 'function' : 'class'} ${t}: ${r.n - r.bad.length} of ${r.n} within 2/255 (worst ${r.worst.toFixed(2)})${r.notch.length ? `; in a notch, apart: ${r.notch.join(', ')}` : ''}${r.bad.length ? `; off: ${r.bad.slice(0, 3).join(' | ')}` : ''}`);
    }
  }
}
console.log(failed ? 'FAIL' : 'PASS');
process.exit(failed ? 1 : 0);
