// Checks CSS Color 4's other two gamut mappers on .gamut-fit-screen, and relative chroma to the wider gamuts, in Chrome, WebKit
// and Firefox (the function forms in Chrome, where @function parses):
// - --gamut-method: ray-trace (§14.2.6) to all five RGB targets, against Color.js 0.7.1's toGamut method 'raytrace' (an
//   input in the gamut, to 2e-5 in linear light, against itself), within 1/255 a channel; --gamut-method: edge-seeker
//   (§14.2.3-4) to srgb, display-p3, rec2020 and a98-rgb against the spec's pseudocode with its table at 400 hues a
//   region (vendor/edge-seeker.mjs), within 1/255; both with the input's alpha kept, lightness 1 or more white and
//   0 or less black, a `none` hue in lch() as 0 in lch() (IN0), chroma 4.5 to 1e9, in the target's encoded channels
//   for srgb and display-p3 and its linear ones for rec2020, a98-rgb and prophoto-rgb (a98-rgb's pure power curve makes
//   float noise near 0 look like bytes); below lightness 2e-4 ray-trace's reference is black (SPEC.md's Not covered);
//   edge-seeker with prophoto-rgb, which §14.2.4 excludes, the css method's output; with no --gamut-target on a P3
//   screen (Chrome, emulated), Display P3's;
// - --gamut-fit-screen(<color>, <gamut>, ray-trace | edge-seeker), and with the method from --gamut-method, against the
//   class within 1e-4 a channel (in linear light for rec2020, a98-rgb and prophoto-rgb);
// - .gamut-screen-edge with --gamut-target rec2020, a98-rgb and prophoto-rgb against the gamut's most chroma at the input's L and
//   h found in doubles (test/ref/methods.mjs edgeMax()), times --gamut-rel 1 and 0.5, the input's chroma ignored, within 1/255 a channel of the target's linear light (not
//   its encoding: a98-rgb's is a pure power, so a channel 5e-5 above 0 in linear light, a chroma 3e-5 past the edge,
//   encodes as 2.9/255); .gamut-palette-step under the same targets: Material's tonal palette, which solves in sRGB, so the
//   same sRGB colors whatever the target (test/ref/hct.mjs), within 1/255; their functions against their classes within 1e-4.
// Usage: node test/mappers-check.mjs [colors=60]   (random colors a target and method; SHEET= another sheet, ENGINES= some engines)
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pick, open } from './engines.mjs';
import { toLin, toLch, gam, clip01, inGamut, edgeExits } from './ref/methods.mjs';
import { edgeSeeker } from './vendor/edge-seeker.mjs';
import { hctOf, tone } from './ref/hct.mjs';
const C0 = createRequire(import.meta.url)('colorjs.io'), Color = C0.default ?? C0;
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const N = +(process.argv[2] ?? 60);
let seed = 10579; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const f = (x, d = 4) => +(+x).toFixed(d);
// a target: its methods.mjs space, Color.js's encoded space (rec2020 as the engines encode it: Q28) and linear space
const T = { srgb: ['srgb', 'srgb', 'srgb-linear'], 'display-p3': ['p3', 'p3', 'p3-linear'], rec2020: ['rec2020', '--rec2020-oetf', 'rec2020-linear'],
  'a98-rgb': ['a98', 'a98rgb', 'a98rgb-linear'], 'prophoto-rgb': ['prophoto', 'prophoto', 'prophoto-linear'] };
const engine = (s) => s.replace(/^color\(rec2020 /, 'color(--rec2020-oetf ');
const read = (s, t) => { try { const c = new Color(engine(s)); return [...c.to(T[t][1]).coords.map((v) => v || 0), c.alpha ?? 1]; } catch { return null; } };
const enc = (t, lch) => new Color('oklch', lch).to(T[t][1]).coords;
// a target's linear light to its encoded channels: sRGB's curve for srgb and display-p3 (methods.mjs), Color.js for the rest
const encLin = (t, lin) => (T[t][0] === 'srgb' || T[t][0] === 'p3' ? lin.map(gam) : new Color(T[t][2], lin).to(T[t][1]).coords);
// the linear light of a target, from oklch or a printed color (edge and palette cases)
const linOf = (t, lch) => toLin(T[t][0], lch), readLin = (s, t) => { try { return toLin(T[t][0], lchOf(engine(s))); } catch { return null; } };

// --- 1. the two methods, to srgb and display-p3 -------------------------------------------------------------------
const MAP = [];
const lchOf = (s) => { const c = new Color(s).to('oklch'); return [c.coords[0] || 0, c.coords[1] || 0, c.coords[2] || 0]; };
// within 2e-5 of the gamut in linear light counts as inside, as the sheet takes it (float noise); the draft's method
// would move such a color instead (sRGB's blue corner, edge-seeker: 21/255)
const fits = (sp, lch) => toLin(sp, lch).every((x) => x >= -2e-5 && x <= 1 + 2e-5);
// the answer in the target's encoded channels, 0 to 1, with alpha; in its linear light for rec2020, a98-rgb and
// prophoto-rgb (a98-rgb's encoding is a pure power: a channel 4e-5 above 0 in linear light encodes as 2.5/255, so the
// encoded channels near 0 judge float noise)
const LINEAR = new Set(['rec2020', 'a98-rgb', 'prophoto-rgb']);
const wantIn = (m, t, input) => { const w = want(m, t, input); if (!LINEAR.has(t)) return w;
  return [...new Color(T[t][1], w.slice(0, 3)).to(T[t][2]).coords, w[3]]; };
const readIn = (s, t) => { if (!LINEAR.has(t)) return read(s, t); try { const c = new Color(engine(s)); return [...c.to(T[t][2]).coords.map((v) => v || 0), c.alpha ?? 1]; } catch { return null; } };
function want(m, t, input) {
  const c = new Color(input), a = c.alpha ?? 1, lch = lchOf(input), sp = T[t][0];
  if (lch[0] >= 1) return [1, 1, 1, a]; if (lch[0] <= 0) return [0, 0, 0, a];
  if (fits(sp, lch)) return [...encLin(t, toLin(sp, lch)).map(clip01), a];
  // below L 2e-4 the ray's direction in linear light is within 10 of the 1e-12 under which Color.js (and the spec's code,
  // test/ref/methods.mjs) treats a channel as parallel to its faces, and the ray exits at a far face (oklch(0.0001 0.3 30)
  // comes out pure red; 66 to 96 of 216 hues and chromas at L 7e-5 to 9e-5): there the reference is black, what any
  // color at that lightness paints
  if (m === 'ray-trace' && lch[0] < 2e-4) return [0, 0, 0, a];
  if (m === 'ray-trace') return [...new Color('oklch', lch).toGamut({ space: T[t][1], method: 'raytrace' }).to(T[t][1]).coords.map(clip01), a];
  return [...encLin(t, edgeSeeker(sp, lch)).map(clip01), a];
}
const METHOD_TARGETS = { 'ray-trace': ['srgb', 'display-p3', 'rec2020', 'a98-rgb', 'prophoto-rgb'], 'edge-seeker': ['srgb', 'display-p3', 'rec2020', 'a98-rgb'] };
for (const m of ['ray-trace', 'edge-seeker']) for (const t of METHOD_TARGETS[m]) {
  let out = 0, inn = 0;
  while (out < N || inn < N / 6) {
    const lch = [0.02 + rnd() * 0.96, rnd() * ({ 'prophoto-rgb': 1.6, rec2020: 0.6, 'a98-rgb': 0.6 }[t] ?? 0.45), rnd() * 360], ok = inGamut(toLin(T[t][0], lch)), s = `oklch(${lch.map((x) => f(x, 5)).join(' ')})`;
    if (!ok && out < N) { out++; MAP.push({ m, t, input: s }); } else if (ok && inn < N / 6) { inn++; MAP.push({ m, t, input: s }); }
  }
  // the ends, alpha, a none hue in lch() (WebKit greys it: IN0), chroma past the cap, and WPT's own sRGB and P3 inputs
  for (const s of ['oklch(1 0.3 30)', 'oklch(0 0.3 30)', 'oklch(1.2 0.1 200)', 'oklch(0.7 0.4 30 / 0.5)', 'color(display-p3 1 0 0 / 0.25)', 'lch(50 200 none)',
    'oklch(0.7 4.5 30)', 'oklch(0.7 1000 30)', 'oklch(0.7 1e9 30)', 'oklch(0.5 1e9 264)', 'oklch(0.452 0.313 264.052)', 'oklch(0.98 0.4 110)', 'oklch(0.03 0.3 140)', 'oklch(0.0001 0.3 30)', 'oklch(0.00008 1 250)', 'oklch(0.9999 0.3 200)',
    'rgb(255 0 0)', 'oklch(0.6 0 none)', 'color(display-p3 0 1 0)', 'oklch(90% 0.3 240)', 'oklch(40% 0.35 210)', 'oklch(0.7 0.8 30)', 'oklch(0.9 2 30)', 'oklch(0.9 2 150)'])
    MAP.push({ m, t, input: s });
}
// edge-seeker to prophoto-rgb: the method steps aside (§14.2.4: "not, for example, ProPhoto RGB"), the css method's output
const ASIDE = [];
for (let i = 0; i < 24; i++) ASIDE.push({ m: 'edge-seeker', t: 'prophoto-rgb', input: `oklch(${f(0.1 + rnd() * 0.8)} ${f(rnd() * 0.9)} ${f(rnd() * 360, 2)})` });

// --- 2. .gamut-screen-edge and .gamut-palette-step to the wider gamuts ----------------------------------------------------------
const edge = (sp, lch) => edgeExits(sp, lch, 2); // { L, H, exits }: the last exit is the most chroma; 2: past prophoto-rgb's 1.49
const EDGE = [];
for (const t of ['rec2020', 'a98-rgb', 'prophoto-rgb']) for (let i = 0; i < N; i++) {
  const lch = [0.03 + rnd() * 0.94, rnd() * (i % 4 ? (t === 'prophoto-rgb' ? 1.6 : 0.6) : 0.15), rnd() * 360].map((x) => f(x, 5)), rel = i % 3 === 2 ? 0.5 : 1;
  const { L, H, exits } = edge(T[t][0], lch);
  EDGE.push({ t, input: `oklch(${lch.join(' ')})`, rel, wants: exits.map((C) => linOf(t, [L, rel * C, H])) });
}
// an estimate that landed just past the edge, before the last clip (prophoto-rgb L 0.96 h 95: blue -0.017 encoded, a
// review, 2026-10-28); every output is also held inside the gamut, to 1e-4 in linear light
for (const [t, lch] of [['prophoto-rgb', [0.96, 0.1, 95]], ['rec2020', [0.96, 0.1, 95]], ['a98-rgb', [0.97, 0.1, 100]]]) {
  const { L, H, exits } = edge(T[t][0], lch);
  EDGE.push({ t, input: `oklch(${lch.join(' ')})`, rel: 1, wants: exits.map((C) => linOf(t, [L, C, H])) });
}
const SEEDS = ['oklch(0.637 0.237 25.331)', 'oklch(0.723 0.219 149.579)', 'oklch(0.623 0.214 259.815)', 'oklch(0.795 0.184 86.047)', 'oklch(0.715 0.143 215.221)', 'oklch(0.667 0.295 322.15)'];
const STEPS = 6, PAL = [];
for (const t of ['rec2020', 'a98-rgb', 'prophoto-rgb']) for (const s of SEEDS) {
  const h = hctOf(new Color(s).to('srgb-linear').coords);
  PAL.push({ t, input: s, want: Array.from({ length: STEPS }, (_, k) => tone(h.hue, h.chroma, 95 - 85 * (k / (STEPS - 1))).map((v) => v / 255)) });
}

// --- the page --------------------------------------------------------------------------------------------------------
const html = `<!doctype html><style>${css}</style><body>
${MAP.map((c, i) => `<div style="--gamut-target: ${c.t}; --gamut-method: ${c.m}"><i class="gamut-fit-screen" data-k="map" data-i="${i}" style="--gamut-in: ${c.input}"></i></div>`).join('')}
${ASIDE.map((c, i) => `<div style="--gamut-target: ${c.t}; --gamut-method: ${c.m}"><i class="gamut-fit-screen" data-k="aside" data-i="${i}" style="--gamut-in: ${c.input}"></i></div><div style="--gamut-target: ${c.t}"><i class="gamut-fit-screen" data-k="css" data-i="${i}" style="--gamut-in: ${c.input}"></i></div>`).join('')}
${EDGE.map((c, i) => `<div style="--gamut-target: ${c.t}"><i class="gamut-screen-edge" data-k="edge" data-i="${i}" style="--gamut-in: ${c.input}; --gamut-rel: ${c.rel}"></i></div>`).join('')}
${PAL.map((c, i) => `<ol style="--gamut-target: ${c.t}; --gamut-in: ${c.input}">${`<li class="gamut-palette-step" data-k="pal" data-i="${i}"></li>`.repeat(STEPS)}</ol>`).join('')}
</body>`;
// function forms beside their classes: the gamut and method as arguments, or read from the element
const fhtml = `<!doctype html><style>${css}</style><body>
${MAP.map((c, i) => `<div style="--gamut-target: ${c.t}; --gamut-method: ${c.m}"><i class="gamut-fit-screen" data-i="${i}" style="--gamut-in: ${c.input}"></i><b style="background: ${i % 2 ? `--gamut-fit-screen(${c.input}, ${c.t}, ${c.m})` : `--gamut-fit-screen(${c.input})`}"></b></div>`).join('')}
${EDGE.map((c, i) => `<div style="--gamut-target: ${c.t}"><i class="gamut-screen-edge" data-i="e${i}" style="--gamut-in: ${c.input}; --gamut-rel: ${c.rel}"></i><b style="background: --gamut-screen-edge(${c.input}, ${c.rel}, ${c.t})"></b></div>`).join('')}
${PAL.map((c, i) => `<ol style="--gamut-target: ${c.t}; --gamut-in: ${c.input}">${Array.from({ length: STEPS }, (_, k) => { const x = f(k / (STEPS - 1), 6);
  return `<li class="gamut-palette-step" data-i="p${i}" style="--gamut-step: ${x}"></li><li style="background: --gamut-palette-step(${c.input}, 1, ${x})"></li>`; }).join('')}</ol>`).join('')}
</body>`;

const dist = (a, b) => Math.max(...a.map((v, k) => Math.abs(v - b[k]))) * 255;
let failed = false;
const report = (label, n, bad, worst) => { failed ||= bad.length > 0;
  console.log(`  ${label}: ${n - bad.length} of ${n}${worst !== undefined ? ` (worst ${worst.toFixed(2)}/255)` : ''}${bad.length ? `; off: ${bad.slice(0, 4).join(' | ')}` : ''}`); };
for (const e of pick(['Chrome', 'WebKit', 'Firefox'])) {
  const { browser, page } = await open(e);
  await page.setContent(html, { timeout: 300000 });
  const got = await page.evaluate(() => [...document.querySelectorAll('[data-k]')].map((x) => [x.dataset.k, +x.dataset.i, getComputedStyle(x).getPropertyValue('--gamut-out').trim()]));
  console.log(e[0]);
  // the methods
  for (const m of ['ray-trace', 'edge-seeker']) for (const t of METHOD_TARGETS[m]) {
    const bad = []; let n = 0, worst = 0;
    for (const [k, i, s] of got) { if (k !== 'map' || MAP[i].m !== m || MAP[i].t !== t) continue; n++;
      const have = readIn(s, t), w = wantIn(m, t, MAP[i].input), d = have ? Math.max(dist(have.slice(0, 3), w.slice(0, 3)), Math.abs(have[3] - w[3]) * 255) : Infinity;
      worst = Math.max(worst, d); if (!(d <= 1)) bad.push(`${MAP[i].input}: ${s} want ${w.map((v) => f(v * 255, 1)).join(' ')}`); }
    report(`.gamut-fit-screen ${m} ${t}`, n, bad, worst);
  }
  const css0 = Object.fromEntries(got.filter(([k]) => k === 'css').map(([, i, s]) => [i, s]));
  { const bad = []; let n = 0;
    for (const [k, i, s] of got) { if (k !== 'aside') continue; n++; if (s !== css0[i]) bad.push(`${ASIDE[i].t} ${ASIDE[i].input}: ${s} vs css ${css0[i]}`); }
    report('.gamut-fit-screen edge-seeker to prophoto-rgb: the css method\'s output', n, bad); }
  for (const t of ['rec2020', 'a98-rgb', 'prophoto-rgb']) {
    // the nearest of the line's exits passes; one short of the most chroma is counted apart (methods.mjs edgeExits())
    const bad = []; let n = 0, worst = 0, early = 0;
    for (const [k, i, s] of got) { if (k !== 'edge' || EDGE[i].t !== t) continue; n++; const have = readLin(s, t), ds = EDGE[i].wants.map((w) => (have ? dist(have, w) : Infinity)), d = Math.min(...ds);
      if (d <= 1 && ds.at(-1) > 1) early++;
      worst = Math.max(worst, d); if (!(d <= 1)) bad.push(`${EDGE[i].input} rel ${EDGE[i].rel}: ${s} (${d.toFixed(2)})`);
      else if (have.some((x) => x < -1e-4 || x > 1 + 1e-4)) bad.push(`${EDGE[i].input} rel ${EDGE[i].rel}: ${s} (outside the gamut)`); }
    report(`.gamut-screen-edge ${t}${early ? ` (${early} at an earlier exit than the most chroma)` : ''}`, n, bad, worst);
    const pbad = []; let pn = 0, pworst = 0; const seen = {};
    for (const [k, i, s] of got) { if (k !== 'pal' || PAL[i].t !== t) continue; const j = (seen[i] = (seen[i] ?? -1) + 1), w = PAL[i].want[j]; pn++;
      const have = read(s, 'srgb'), d = have ? dist(have.slice(0, 3), w) : Infinity;
      pworst = Math.max(pworst, d); if (!(d <= 1)) pbad.push(`${PAL[i].input} step ${j}: ${s} (${d.toFixed(2)})`); }
    report(`.gamut-palette-step ${t}`, pn, pbad, pworst);
  }
  // nested in another of its kind under rec2020, a98-rgb or prophoto-rgb, each method's and target's own answer: an
  // internal set only under a container query inherited into the nested part (a review, 2026-10-29: an
  // sRGB .gamut-screen-edge in a rec2020 one kept --gamut--clip: rec2020, red 1.19)
  { const NEST = ['oklch(0.7 0.1 30)', 'oklch(0.5 0.3 250)', 'oklch(0.85 0.25 140)'], kinds = [['screen-edge', null], ...['css', 'ray-trace', 'edge-seeker', 'adaptive'].map((m) => ['fit-screen', m])];
    const one = (k, m, c, t) => `<div style="--gamut-target: ${t};${m ? ` --gamut-method: ${m};` : ''}"><i class="gamut-${k}" style="--gamut-in: ${c}; --gamut-rel: 1"></i></div>`;
    const html = kinds.flatMap(([k, m]) => NEST.flatMap((c) => [one(k, m, c, 'srgb'), ...['rec2020', 'a98-rgb', 'prophoto-rgb'].map((t) => `<div style="--gamut-target: ${t};${m ? ` --gamut-method: ${m};` : ''}"><b class="gamut-${k}" style="--gamut-in: oklch(0.6 0.4 200); --gamut-rel: 1">${one(k, m, c, 'srgb')}</b></div>`)])).join('');
    await page.setContent(`<!doctype html><style>${css}</style><body>${html}</body>`);
    const got = await page.evaluate(() => [...document.querySelectorAll('i')].map((x) => getComputedStyle(x).getPropertyValue('--gamut-out').trim()));
    const bad = []; let n = 0;
    for (let i = 0; i < got.length; i += 4) for (let j = 1; j < 4; j++) { n++; const a = read(got[i], 'srgb'), b = read(got[i + j], 'srgb');
      if (!(a && b && dist(a.slice(0, 3), b.slice(0, 3)) <= 0.01)) bad.push(`${got[i]} alone, ${got[i + j]} nested`); }
    report('nested in its kind under another target, as alone', n, bad); }
  if (e[0] === 'Chrome') {
    // no --gamut-target, on a P3 screen: the Display P3 cases' answers
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'color-gamut', value: 'p3' }] });
    const P3 = MAP.map((c, i) => [c, i]).filter(([c]) => c.t === 'display-p3');
    await page.setContent(`<!doctype html><style>${css}</style><body>${P3.map(([c, i]) => `<div style="--gamut-method: ${c.m}"><i class="gamut-fit-screen" data-i="${i}" style="--gamut-in: ${c.input}"></i></div>`).join('')}`, { timeout: 300000 });
    const p3 = await page.evaluate(() => [...document.querySelectorAll('i')].map((x) => [+x.dataset.i, getComputedStyle(x).getPropertyValue('--gamut-out').trim()]));
    // no --gamut-target on a P3 screen is --gamut-target: display-p3 exactly, every method, class and function: the
    // screen's own copy of the Display P3 tables against the target's (mutation testing, 2026-10-29: a 2% change to the
    // screen's edge-seeker table moved 1 to 2/255, inside the 1/255 the Display P3 cases below allow)
    { const SW = []; for (let h = 0; h < 360; h += 4) for (const l of [0.45, 0.7, 0.88]) SW.push(`oklch(${l} 0.4 ${h})`);
      const ms = ['css', 'ray-trace', 'edge-seeker', 'adaptive'], cell = (c) => `<i class="gamut-fit-screen" style="--gamut-in: ${c}"></i><b style="background: --gamut-fit-screen(${c})"></b>`;
      await page.setContent(`<!doctype html><style>${css}</style><body>${ms.map((m) => `<div style="--gamut-method: ${m}">${SW.map(cell).join('')}</div><div style="--gamut-method: ${m}; --gamut-target: display-p3">${SW.map(cell).join('')}</div>`).join('')}</body>`, { timeout: 300000 });
      const v = await page.evaluate(() => [...document.body.children].map((d) => [...d.children].map((x) => (x.localName === 'i' ? getComputedStyle(x).getPropertyValue('--gamut-out').trim() : getComputedStyle(x).backgroundColor))));
      ms.forEach((m, k) => { for (const [form, off] of [['.gamut-fit-screen', 0], ['--gamut-fit-screen()', 1]]) { const bad = []; let n = 0;
        for (let i = off; i < v[2 * k].length; i += 2) { n++; const a = read(v[2 * k][i], 'display-p3'), b = read(v[2 * k + 1][i], 'display-p3');
          if (!(a && b && dist(a.slice(0, 3), b.slice(0, 3)) <= 255e-5)) bad.push(`${SW[(i - off) / 2]}: ${v[2 * k][i]} vs ${v[2 * k + 1][i]}`); }
        report(`${form} ${m}, no --gamut-target on a P3 screen (emulated) as --gamut-target: display-p3, within 1e-5`, n, bad); } }); }
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    for (const m of ['ray-trace', 'edge-seeker']) { const bad = []; let n = 0;
      for (const [i, s] of p3) { if (MAP[i].m !== m) continue; n++; const have = read(s, 'display-p3'), w = want(m, 'display-p3', MAP[i].input);
        if (!(have && dist(have.slice(0, 3), w.slice(0, 3)) <= 1)) bad.push(`${MAP[i].input}: ${s}`); }
      report(`.gamut-fit-screen ${m}, no --gamut-target, P3 screen (emulated)`, n, bad); }
    await page.setContent(fhtml, { timeout: 300000 });
    const pairs = await page.evaluate(() => [...document.querySelectorAll('[data-i]')].map((x) => [x.dataset.i, getComputedStyle(x).getPropertyValue('--gamut-out').trim(), getComputedStyle(x.nextElementSibling).backgroundColor]));
    const bad = { fit: [], edge: [], pal: [] }, n = { fit: 0, edge: 0, pal: 0 }; let worst = 0;
    for (const [i, cls, fn] of pairs) {
      const key = i[0] === 'e' ? 'edge' : i[0] === 'p' ? 'pal' : 'fit', t = key === 'fit' ? MAP[+i].t : key === 'edge' ? EDGE[+i.slice(1)].t : PAL[+i.slice(1)].t;
      n[key]++; const a = readIn(cls, t), b = readIn(fn, t), d = a && b ? dist(a, b) / 255 : Infinity; worst = Math.max(worst, d);
      if (!(d <= 1e-4)) bad[key].push(`${key === 'fit' ? `${MAP[+i].m} ${MAP[+i].input}` : i}: ${cls} vs ${fn}`);
    }
    for (const k of ['fit', 'edge', 'pal']) report(`${{ fit: '--gamut-fit-screen() ray-trace, edge-seeker', edge: '--gamut-screen-edge() rec2020, a98-rgb, prophoto-rgb', pal: '--gamut-palette-step() rec2020, a98-rgb, prophoto-rgb' }[k]} against the class within 1e-4`, n[k], bad[k]);
  }
  await browser.close();
}
console.log(failed ? 'FAIL' : 'PASS');
process.exit(failed ? 1 : 0);
