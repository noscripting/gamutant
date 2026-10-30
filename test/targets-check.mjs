// Checks .gamut-fit-screen with --gamut-target: rec2020, a98-rgb and prophoto-rgb (CSS Color 4 §14's other RGB destinations), in
// Chrome, WebKit and Firefox: random colors out of each gamut, against Color.js 0.7.1's css method in that space within
// 2/255 a channel of its encoded channels; and colors inside it, against the engine's own conversion of the input within
// 1/255 (Chrome encodes prophoto-rgb without its linear segment below 1/512, so its own conversion is the reference;
// measured by this check's in-gamut cases against Color.js, which encodes the segment). Also .gamut-screen-edge with these
// values: within 1/255 a channel of that gamut's edge, the color's own chroma ignored (#11946's relative chroma,
// methods.mjs edgeMax()) in its linear light (a98-rgb's encoding
// is a pure power: a chroma 3e-5 past the edge encodes 2.9/255 off; test/mappers-check.mjs has its own cases).
// Usage: node test/targets-check.mjs [colors=150]
// FIT_ONLY=1 keeps the existing .gamut-fit-screen cases for a mapping-only sheet.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pw, pick } from './engines.mjs';
import { toLch, toLin, edgeExits } from './ref/methods.mjs';
const C0 = createRequire(import.meta.url)('colorjs.io'), Color = C0.default ?? C0;
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const fitOnly = process.env.FIT_ONLY === '1';
// rec2020 by BT.2020's curve, as all three engines encode it (Q28): Color.js 0.7.1 calls that space --rec2020-oetf, its
// rec2020 being CSS Color 4's gamma 2.4; the gamut is the same, only the encoding compared differs
const N = +(process.argv[2] ?? 150); if (!(N >= 1)) { console.log(`FAIL ${process.argv[2]} cases: at least 1`); process.exit(1); }
const TARGETS = { rec2020: '--rec2020-oetf', 'a98-rgb': 'a98rgb', 'prophoto-rgb': 'prophoto' };
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const r6 = (x) => +x.toFixed(6);
const inputs = Array.from({ length: N }, (_, i) => i % 5 === 4
  ? [r6(0.15 + rnd() * 0.75), r6(rnd() * 0.06), r6(rnd() * 360)]          // a few low-chroma colors, inside every gamut
  : [r6(0.05 + rnd() * 0.9), r6(0.1 + rnd() * 0.9), r6(rnd() * 360)]);   // chroma up to 1, the search's reach
const lin = (sp) => (sp === '--rec2020-oetf' ? 'rec2020-linear' : `${sp}-linear`); // the linear space a target's gamut is tested in
// an engine's color(rec2020 ...) is BT.2020-encoded (Q28): read it as that, not as Color.js 0.7.1's gamma-2.4 rec2020
const engine = (css) => css.replace(/^color\(rec2020 /, 'color(--rec2020-oetf ');
const inGamut = (sp, l, c, h) => new Color('oklch', [l, c, h]).to(lin(sp)).coords.every((v) => v >= -1e-9 && v <= 1 + 1e-9);
const MS = { rec2020: 'rec2020', 'a98-rgb': 'a98', 'prophoto-rgb': 'prophoto' }; // methods.mjs's names
const edge = (g, l, c, h) => edgeExits(MS[g], [l, c, h]); // where the line at l and h leaves the target: the last is the most chroma
const html = `<!doctype html><style>${css}</style><body>${Object.keys(TARGETS).map((g) => `<div style="--gamut-target: ${g}">${inputs.map(([l, c, h], k) => `<i class="gamut-fit-screen" data-g="${g}" data-k="${k}" style="--gamut-in: oklch(${l} ${c} ${h})"></i><b class="gamut-screen-edge" data-g="${g}" data-k="${k}" style="--gamut-in: oklch(${l} ${c} ${h})"></b><s data-g="${g}" data-k="${k}" style="color: color(from oklch(${l} ${c} ${h}) ${g} r g b)"></s>`).join('')}</div>`).join('')}</body>`;
const off = (have, want) => Math.max(...have.map((v, j) => Math.abs(v - want[j]) * 255));
let failed = false;
for (const [name, type, opts] of pick()) {
  const b = await pw[type].launch(opts), p = await b.newPage();
  await p.setContent(html, { timeout: 300000 });
  const got = await p.evaluate(selector => [...document.querySelectorAll(selector)].map((e) => [e.tagName, e.dataset.g, +e.dataset.k, getComputedStyle(e).getPropertyValue('--gamut-out').trim()]), fitOnly ? 'i' : 'i, b');
  const own = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('s')].map((e) => [`${e.dataset.g} ${e.dataset.k}`, getComputedStyle(e).color])));
  await b.close();
  const res = {}, fit = Object.fromEntries(got.filter(([t]) => t === 'I').map(([, g, k, out]) => [`${g} ${k}`, out]));
  for (const [tag, g, k, out] of got) {
    const sp = TARGETS[g], [l, c, h] = inputs[k], key = `${g} ${tag === 'I' ? 'fit-screen' : 'screen-edge'}`, r = (res[key] ??= { n: 0, bad: [], worst: 0 });
    let want;
    if (tag === 'I') want = inGamut(sp, l, c, h) ? new Color(engine(own[`${g} ${k}`])).to(sp).coords : new Color('oklch', [l, c, h]).toGamut({ space: sp, method: 'css' }).to(sp).coords;
    else { const { L, H, exits } = edge(g, l, c, h); want = exits.map((C) => toLin(MS[g], [L, C, H])); }
    let have; try { const o = new Color(engine(out)); have = tag === 'I' ? o.to(sp).coords : toLin(MS[g], o.to('oklch').coords.map((v) => v || 0)); } catch { r.n++; r.bad.push(`oklch(${l} ${c} ${h}): ${out}`); continue; }
    // .gamut-screen-edge: the nearest exit of the line passes; one short of the most chroma is counted apart
    const ds = tag === 'I' ? [off(have, want)] : want.map((w) => off(have, w)), d = Math.min(...ds); if (tag !== 'I' && d <= 1 && ds.at(-1) > 1) r.early = (r.early ?? 0) + 1;
    const tol = tag === 'B' || inGamut(sp, l, c, h) ? 1 : 2; r.n++; r.worst = Math.max(r.worst, d);
    if (!(d <= tol)) r.bad.push(`oklch(${l} ${c} ${h}) ${d.toFixed(1)}/255`);
  }
  for (const [key, r] of Object.entries(res)) { failed ||= r.bad.length > 0;
    console.log(`${name} ${key}: ${r.n - r.bad.length} of ${r.n} ${r.same ? 'the same' : `within 2/255 (1/255 inside the gamut), worst ${r.worst.toFixed(2)}/255`}${r.early ? `, ${r.early} at an earlier exit than the most chroma` : ''}${r.bad.length ? `; off: ${r.bad.slice(0, 3).join(', ')}` : ''}`); }
}
console.log(failed ? 'FAIL' : 'PASS');
process.exit(failed ? 1 : 0);
