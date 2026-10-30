// Checks .gamut-okhsl, .gamut-okhsv and .gamut-okhsl-from under --gamut-target: display-p3 and rec2020 (#8659's P3 and Rec. 2020
// variants) against Ottosson's model run numerically for that gamut (test/ref/okhsl.mjs exact(): the cusp's maximum
// saturation and the gamut's edge found by bisection), in Chrome, WebKit and Firefox, and their functions under the
// same ancestor in Chrome: the hue circle at s 1, corners, random h s l / h s v, and colors of the gamut with their s,
// l, both or neither replaced. Distances are in the target's 8-bit encoding (display-p3; rec2020 by BT.2020's curve,
// as the engines encode it). A case passes within 1.5/255 of the numerical model; within 2 degrees of the gamut's
// blue primary, where ok_color.h's one Halley step from its polynomial falls short for sRGB too (2.8/255 there), within
// the fitted constants' own distance from the model plus 1.5/255. Each case is also held within 1.5/255 of the fitted
// constants run in JS (the chain itself); at the blue corner either branch, as okhsl-check.mjs does.
// BASE=<sheet> also compares every case with no --gamut-target and with srgb against that sheet, value for value.
// Usage: node test/okhsl-gamuts-check.mjs [cases a part and gamut = 150]   (SHEET=, ENGINES=)
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pick, open } from './engines.mjs';
import { GAMUTS, exact, okhslToOklab, oklabToOkhsl, okhsvToOklab, setBranch, atCorner } from './ref/okhsl.mjs';
import { gamut } from './ref/classes.mjs';
import { prefixSheet } from './ref/classes.mjs';
const cjs = createRequire(import.meta.url)('colorjs.io'), Color = cjs.default ?? cjs;
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const base = process.env.BASE && prefixSheet(readFileSync(process.env.BASE, 'utf8'));
const N = +(process.argv[2] ?? 150);
const ENC = { 'display-p3': 'p3', rec2020: '--rec2020-oetf', srgb: 'srgb' }, LIN = { 'display-p3': 'p3-linear', rec2020: 'rec2020-linear' };
let seed = 8659; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const f4 = (x) => +x.toFixed(4);
const blueHue = Object.fromEntries(Object.keys(LIN).map((g) => [g, new Color(LIN[g], [0, 0, 1]).to('oklch').coords[2]]));
const nearBlue = (g, h) => Math.abs(((h - blueHue[g] + 540) % 360) - 180) < 2;

// the cases: [part, inputs, the element's style, the function call, the reference given a constant set or model]
const cases = [];
for (const g of Object.keys(LIN)) {
  const X = exact(g), F = GAMUTS[g];
  const add = (part, inp, style, call, ref, h) => cases.push({ g, part, inp, style, call, h, want: ref(X), fit: ref(F),
    alt: atCorner(Math.cos(h * Math.PI / 180), Math.sin(h * Math.PI / 180), F) ? ['red', 'green'].map((br) => { setBranch(br); const v = ref(F); setBranch(null); return v; }) : [] });
  const hsl = (h, s, l) => add('okhsl', `${h} ${s} ${l}`, `--gamut-okhsl-h: ${h}; --gamut-okhsl-s: ${s}; --gamut-okhsl-l: ${l}`, `--gamut-okhsl(${h}, ${s}, ${l})`, (G) => okhslToOklab(h, s, l, G), h);
  const hsv = (h, s, v) => add('okhsv', `${h} ${s} ${v}`, `--gamut-okhsv-h: ${h}; --gamut-okhsv-s: ${s}; --gamut-okhsv-v: ${v}`, `--gamut-okhsv(${h}, ${s}, ${v})`, (G) => okhsvToOklab(h, s, v, G), h);
  for (let h = 0; h < 360; h += 6) { hsl(h, 1, 0.5); hsv(h, 1, 1); }
  for (const h of [29.2, blueHue[g], f4(blueHue[g] - 1), f4(blueHue[g] + 1), 142.5, 200]) for (const [s, l] of [[1, 0.25], [1, 0.75], [0.8, 0.5], [0.5, 0.9], [1, 0.999], [0, 0.4]]) { hsl(f4(h), s, l); hsv(f4(h), s, l); }
  for (let i = 0; i < N; i++) { hsl(f4(rnd() * 360), f4(rnd()), f4(rnd())); hsv(f4(rnd() * 360), f4(rnd()), f4(rnd())); }
  // .gamut-okhsl-from: a color of the gamut (linear channels drawn, given as oklab()), its s, l, both or neither replaced
  for (let i = 0; i < N; i++) {
    const lab = new Color(LIN[g], [rnd(), rnd(), rnd()].map((x) => x ** 1.5)).to('oklab').coords.map((x) => +x.toFixed(8)), k = rnd();
    const o = k < 0.25 ? {} : k < 0.5 ? { l: f4(rnd()) } : k < 0.75 ? { s: f4(rnd()) } : { l: f4(rnd()), s: f4(rnd()) };
    const c = `oklab(${lab.join(' ')})`, h = (Math.atan2(lab[2], lab[1]) * 180 / Math.PI + 360) % 360;
    add('okhsl-from', `${c} s ${o.s ?? '-'} l ${o.l ?? '-'}`, `--gamut-in: ${c};${o.s != null ? ` --gamut-okhsl-s: ${o.s};` : ''}${o.l != null ? ` --gamut-okhsl-l: ${o.l};` : ''}`,
      `--gamut-okhsl-from(${c}, ${o.s ?? 'none'}, ${o.l ?? 'none'})`, (G) => { const [hh, s, l] = oklabToOkhsl(...lab, G); return okhslToOklab(hh, o.s ?? s, o.l ?? l, G); }, h);
  }
}
const enc = (g, lab) => new Color('oklab', lab).to(ENC[g]).coords;
const read = (g, v) => new Color(v.replace(/-?[0-9.]+e[-+]?[0-9]+/g, (m) => (+m).toFixed(12))).to(ENC[g]).coords;
const off = (a, b) => Math.max(...a.map((x, k) => Math.abs(x - b[k]))) * 255;
for (const c of cases) { c.e = enc(c.g, c.want); c.gap = off(c.e, enc(c.g, c.fit)); }
// the fitted constants' gap from the model near blue, frozen as measured (2026-10-30): a fit that moves past it fails here,
// so the allowance below can't grow with a sheet and a fit wrong together (a review, 2026-10-30)
const GAP_MAX = { 'display-p3': 25.1, rec2020: 35.5 };
const moved = cases.filter((c) => nearBlue(c.g, c.h) && c.gap > (GAP_MAX[c.g] ?? 0));
if (moved.length) { console.log(`FAIL the fitted constants moved from the model near blue: ${moved.slice(0, 3).map((c) => `${c.g} ${c.inp} ${c.gap.toFixed(2)}/255`).join(', ')} (frozen ${JSON.stringify(GAP_MAX)})`); process.exit(1); }

const wrap = (g, inner) => `<div${g ? ` style="--gamut-target: ${g}"` : ''}>${inner}</div>`;
const page = (sheet, fn) => `<!doctype html><style>${sheet}</style>${[...Object.keys(LIN), 'srgb', null].map((g) => wrap(g, cases.filter((c) => !g || !LIN[g] || c.g === g)
  .map((c) => `<i class="${gamut(c.part)}" style="${c.style}"></i>${fn ? `<b style="color: ${c.call}"></b>` : ''}`).join(''))).join('')}`;
let failed = false;
for (const e of pick()) {
  const { browser, page: p } = await open(e);
  await p.setContent(page(css, e[0] === 'Chrome'), { timeout: 120000 });
  const got = await p.evaluate(() => [...document.querySelectorAll('div')].map((d) => [[...d.querySelectorAll('i')].map((x) => getComputedStyle(x).getPropertyValue('--gamut-out')), [...d.querySelectorAll('b')].map((x) => getComputedStyle(x).color)]));
  for (const [form, k] of e[0] === 'Chrome' ? [['class', 0], ['function', 1]] : [['class', 0]]) {
    const res = {};
    Object.keys(LIN).forEach((g, gi) => cases.filter((c) => c.g === g).forEach((c, i) => {
      const r = (res[`${g} ${c.part}`] ??= { n: 0, bad: [], worst: 0, worstAt: '', port: 0, corner: 0 });
      r.n++; let v; try { v = read(g, got[gi][k][i]); } catch { r.bad.push(`${c.inp}: unreadable ${got[gi][k][i]}`); return; }
      const d = off(v, c.e), allowed = 1.5 + (nearBlue(g, c.h) ? c.gap : 0), dp = off(v, enc(g, c.fit));
      const portOk = dp <= 1.5 || c.alt.some((w) => off(v, enc(g, w)) <= 1.5);
      if (dp > 1.5 && portOk) r.corner++;
      r.port = Math.max(r.port, portOk ? Math.min(dp, ...c.alt.map((w) => off(v, enc(g, w)))) : dp);
      if (d > r.worst) { r.worst = d; r.worstAt = c.inp; }
      if (!(d <= allowed) || !portOk) r.bad.push(`${c.part}(${c.inp}) -> ${got[gi][k][i]}: ${d.toFixed(2)}/255 off the model (allowed ${allowed.toFixed(2)}), ${dp.toFixed(2)} off the fitted constants`);
    }));
    for (const [key, r] of Object.entries(res)) {
      failed ||= r.bad.length > 0;
      console.log(`${e[0]} ${form} ${key}: ${r.n - r.bad.length} of ${r.n} within the numerical model's bound (worst ${r.worst.toFixed(2)}/255 at ${r.worstAt}); fitted constants in JS: worst ${r.port.toFixed(2)}/255${r.corner ? `, ${r.corner} at the blue corner on the other branch` : ''}${r.bad.length ? `\n  ${r.bad.slice(0, 5).join('\n  ')}` : ''}`);
    }
  }
  // sRGB: under srgb and with no target, the same as BASE value for value
  if (base) {
    const q = await browser.newPage(); await q.setContent(page(base, false), { timeout: 120000 });
    const was = await q.evaluate(() => [...document.querySelectorAll('div')].map((d) => [...d.querySelectorAll('i')].map((x) => getComputedStyle(x).getPropertyValue('--gamut-out'))));
    const now = got.map((x) => x[0]), n = was.length - 2;
    let same = 0, all = 0; const bad = [];
    for (const d of [n, n + 1]) was[d].forEach((v, i) => { all++; if (v === now[d][i]) same++; else bad.push(`${v} | ${now[d][i]}`); });
    failed ||= same < all;
    console.log(`${e[0]} sRGB (srgb and no target): ${same} of ${all} the same as ${process.env.BASE}${bad.length ? `\n  ${bad.slice(0, 4).join('\n  ')}` : ''}`);
  }
  await browser.close();
}
process.exit(failed ? 1 : 0);
