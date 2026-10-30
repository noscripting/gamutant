// Checks three small parts in Chrome, WebKit and Firefox, each against an outside oracle:
// - .gamut-light-dark (csswg-drafts #13836): --gamut-out against the engine's own light-dark() of the same two colors written
//   directly on the element, for tokens set on the root and read under every pair of an ancestor's and the element's
//   color-scheme (light, dark, `light dark`, normal, `only dark`), the page preferring light and then dark (headless
//   Firefox ignores the emulated preference: there the element's own light-dark() is still the oracle). Within 1e-6 a
//   channel and alpha, read with Color.js 0.7.1; and its children inherit that pick: --gamut-out read on a child of
//   `only light` and one of `only dark` is the same color. It also counts, as a measure and not a verdict, how many of the same
//   cases a token registered as one light-dark() on the root gets wrong: the failure #13836 reports.
// - .gamut-color-equal (#13157): --gamut-equal, 1 or 0, read on the part's child in every engine, on the element itself and
//   from --gamut-color-equal() in Chrome, against the resolution of 2026-03-31 and 2026-04-27 (CSS Color 4 §12) written
//   in JS on Color.js 0.7.1: in the same color space, components compared, `none` equal only to `none`; in different
//   spaces, a `none` makes them differ; else both in OkLab within 0.00001. hsl(), hwb(), rgb(), hex and named colors are
//   the srgb space; a powerless hue is missing within one space (§12 step 1) but makes no `none` across spaces (WPT's
//   query-style-color.html, which takes oklch(0 0 0) to equal black; csswg-drafts #14472 is open on this). The pairs:
//   §12's 13 examples, WPT query-style-color.html's 24, and random ones (a color against itself, the same color
//   converted to another space, nudged in OkLab by 3e-6 and by 3e-5, with a channel or alpha `none`). A pair the part
//   can't tell apart counts apart, named by the oracle's own rule: a `none` hue at zero chroma (it changes no channel
//   in any space), or the same `none`s in two spaces (CSS reads no color's space). So does a pair where the engine's
//   own OkLab of the two colors (oklab(from …)) gives the part's answer: its conversion, off the spec's by more than
//   0.00001, is the engine's.
// - #11533's recipe, SPEC.md's E4 (color math over two colors, no new CSS): lightness from one color with chroma and
//   hue from another, through .gamut-color-extract and through color-mix() of `none`s, and one color multiplied by another
//   in srgb-linear through .gamut-color-extract: against the formula on the channels the recipe gathers (the engine's own
//   relative colors; for the color .gamut-color-extract reads, CSS Color 4's conversion of the engine's own xyz-d65, as
//   SPEC.md E2 and E3 give it) within 1e-4 of each channel's range, and for pairs with no rgb() (Firefox keeps it in
//   bytes) within 2e-3 of Color.js.
// Usage: node test/small-parts-check.mjs [light-dark|color-equal|recipe ...]   (SHEET= for another sheet, ENGINES= to pick)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pick, open } from './engines.mjs';
import { equivalent, blind, hasNone, SRGB, EPS } from './ref/equal.mjs';
const cjs = createRequire(import.meta.url)('colorjs.io'), Color = cjs.default ?? cjs;
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const only = process.argv.slice(2), want = (k) => !only.length || only.includes(k);
if (only.some((k) => !['light-dark', 'color-equal', 'recipe'].includes(k))) { console.log(`FAIL unknown part: ${only.join(' ')} (light-dark, color-equal, recipe)`); process.exit(1); }
let seed = 2026102713; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pickOne = (xs) => xs[Math.floor(rnd() * xs.length)], f = (x, d = 4) => +x.toFixed(d);
const read = (s) => { try { const c = new Color(s.trim()); return [...c.to('srgb').coords.map((v) => v ?? 0), c.alpha ?? 0]; } catch { return null; } };
const near = (x, y, e) => !!x && !!y && x.every((v, i) => Math.abs(v - y[i]) <= e);

// ---- .gamut-light-dark
const TOKENS = [['yellow', 'blue'], ['oklch(0.92 0.08 95)', 'oklch(0.32 0.12 265 / 0.8)'], ['color(display-p3 1 0.5 0)', '#123456'], ['hsl(10 80% 60%)', 'lab(20 30 -40)']];
const SCHEMES = [null, 'light', 'dark', 'light dark', 'normal', 'only dark'];
const ldCases = TOKENS.flatMap(([l, d]) => ['light', 'dark'].flatMap((root) => SCHEMES.flatMap((p) => SCHEMES.map((e) => ({ l, d, root, p, e })))));
const ldPage = `<style>@property --tok { syntax: '<color>'; inherits: true; initial-value: black; }</style>${ldCases.map((c) =>
  `<section style="color-scheme: ${c.root}; --gamut-light: ${c.l}; --gamut-dark: ${c.d}; --tok: light-dark(${c.l}, ${c.d})"><div${c.p ? ` style="color-scheme: ${c.p}"` : ''}><i class="gamut-light-dark" style="${c.e ? `color-scheme: ${c.e}; ` : ''}background-color: light-dark(${c.l}, ${c.d}); color: var(--tok)"><b style="color-scheme: only light; background-color: var(--gamut-out)"></b><b style="color-scheme: only dark; background-color: var(--gamut-out)"></b></i></div></section>`).join('')}`;

// ---- .gamut-color-equal: the oracle is test/ref/equal.mjs
// the pairs
const SPEC = [['red', 'rgb(255, 0, 0)'], ['red', 'color(srgb 1 0 0)'], ['#ff000080', 'rgb(255 0 0 / 50%)'], ['hsl(0 0% 50%)', 'hsl(200 0% 50%)'],
  ['white', 'hwb(120 100% 0%)'], ['oklch(50% 0 40)', 'oklch(50% 0 200)'], ['lch(50% 0.001 30)', 'lch(50% 0.001 200)'], ['lch(50% 30 0)', 'lch(50% 30 360)'],
  ['rgb(none 128 0)', 'rgb(0 128 0)'], ['oklch(50% 0 none)', 'oklab(50% 0 0)'], ['red', 'color(srgb-linear 1 0 0)'], ['color(display-p3 1 1 1)', 'white'],
  ['lab(50% 0 0)', 'oklab(0.5 0 0)']];
const WPT = [...['black', '#000', '#000f', 'rgb(0 0 0)', 'rgb(calc(5 - 5) 0 0)', 'rgb(clamp(-1, pi, 0) 0 0)', 'rgba(0, 0, 0, 1)', 'rgb(-10 0 0)',
  'rgb(from black r g b)', 'hwb(0 0 100)', 'hsl(0 0 0)', 'color(srgb 0 0 0)', 'color(srgb-linear 0 0 0)', 'color(display-p3 0 0 0)',
  'color(xyz-d65 0 0 0)', 'lab(0 0 0)', 'oklch(0 0 0)', 'oklab(from black l a b)'], ...['hwb(none 0 100)', 'hsl(none 0 0)', 'color(srgb none 0 0)',
  'color(srgb-linear 0 none 0)', 'oklch(0 0 none)', 'oklab(0 none none)']].map((c) => [c, 'black']);
// Color.js reads no relative color or calc(): the WPT colors it can't parse are compared as the black they compute to
const ORACLE_AS = { 'rgb(calc(5 - 5) 0 0)': 'rgb(0 0 0)', 'rgb(clamp(-1, pi, 0) 0 0)': 'rgb(0 0 0)', 'rgb(from black r g b)': 'color(srgb 0 0 0)', 'oklab(from black l a b)': 'oklab(0 0 0)', 'rgb(-10 0 0)': 'rgb(0 0 0)' };
const KINDS = {
  hex: () => `#${Array.from({ length: 3 }, () => Math.floor(rnd() * 256).toString(16).padStart(2, '0')).join('')}`,
  rgb: () => `rgb(${f(rnd() * 255, 2)} ${f(rnd() * 255, 2)} ${f(rnd() * 255, 2)})`,
  hsl: () => `hsl(${f(rnd() * 360, 2)} ${f(5 + rnd() * 90, 2)}% ${f(5 + rnd() * 90, 2)}%)`,
  hwb: () => `hwb(${f(rnd() * 360, 2)} ${f(rnd() * 45, 2)}% ${f(rnd() * 45, 2)}%)`,
  lab: () => `lab(${f(5 + rnd() * 90)} ${f(rnd() * 120 - 60)} ${f(rnd() * 120 - 60)})`,
  lch: () => `lch(${f(5 + rnd() * 90)} ${f(5 + rnd() * 80)} ${f(rnd() * 360)})`,
  oklab: () => `oklab(${f(0.05 + rnd() * 0.9)} ${f(rnd() * 0.5 - 0.25)} ${f(rnd() * 0.5 - 0.25)})`,
  oklch: () => `oklch(${f(0.05 + rnd() * 0.9)} ${f(0.02 + rnd() * 0.3)} ${f(rnd() * 360)})`,
  ...Object.fromEntries(['display-p3', 'rec2020', 'srgb-linear', 'xyz-d65', 'srgb'].map((s) => [s, () => `color(${s} ${f(0.05 + rnd() * 0.9)} ${f(0.05 + rnd() * 0.9)} ${f(0.05 + rnd() * 0.9)})`])),
};
const CJS = { 'display-p3': 'p3', 'xyz-d65': 'xyz-d65', rec2020: 'rec2020', 'srgb-linear': 'srgb-linear', srgb: 'srgb', lab: 'lab', lch: 'lch', oklab: 'oklab', oklch: 'oklch', hsl: 'hsl', hwb: 'hwb' };
// a color written in the CSS of one space, from Color.js's coordinates, 10 significant digits
const write = (c, kind) => { const x = c.to(CJS[kind]), v = x.coords.map((n) => (n === null || Number.isNaN(n) ? 'none' : +n.toPrecision(10))), a = c.alpha === 1 ? '' : ` / ${c.alpha === null ? 'none' : +c.alpha.toPrecision(10)}`;
  if (['lab', 'lch', 'oklab', 'oklch'].includes(kind)) return `${kind}(${v.join(' ')}${a})`;
  if (kind === 'hsl' || kind === 'hwb') return `${kind}(${v[0]} ${v[1]}% ${v[2]}%${a})`;
  return `color(${kind} ${v.join(' ')}${a})`; };
const withNone = (s, k) => { const m = s.match(/^([a-z-]+)\((.*)\)$/), t = m[2].split(/\s+/), off = m[1] === 'color' ? 1 : 0; t[off + k] = 'none'; return `${m[1]}(${t.join(' ')})`; };
const random = [];
for (let i = 0; i < 30; i++) {
  const kind = pickOne(Object.keys(KINDS)), wk = kind === 'hex' || kind === 'rgb' ? 'srgb' : kind, s = KINDS[kind](), alpha = rnd() < 0.25 ? f(0.1 + rnd() * 0.8, 3) : 1;
  const c = new Color(s); c.alpha = alpha;
  // the other color is written in another of §12's spaces (hsl and hwb only for colors inside sRGB, which they clamp to)
  const sp = (k) => (SRGB.has(k) ? 'srgb' : k), inSrgb = c.inGamut('srgb', { epsilon: 0 });
  const other = pickOne(Object.keys(CJS).filter((k) => sp(k) !== sp(wk) && (inSrgb || !['hsl', 'hwb'].includes(k)) && !(['lab', 'lch'].includes(k) && c.to('lab').coords[0] < 0.01)));
  const at = alpha === 1 ? s : write(c, wk);
  const nudge = (d) => { const o = c.to('oklab'); o.coords[0] += d; return write(o, other); };
  random.push([at, at], [at, write(c, other)], [at, nudge(3e-6)], [at, nudge(3e-5)]);
  const plain = kind === 'hex' ? write(new Color(s), 'srgb') : s, slot = Math.floor(rnd() * 3), nn = withNone(plain, slot);
  random.push([nn, plain.replace(/^([a-z-]+\()(.*)\)$/, (m, h, body) => { const t = body.split(/\s+/), off = h === 'color(' ? 1 : 0; t[off + slot] = '0'; return `${h}${t.join(' ')})`; })], [nn, nn], [nn, write(new Color(s), other)]);
  if (rnd() < 0.3) random.push([nn, write(new Color(nn).to(CJS[other]), wk === 'srgb' && kind !== 'hex' && kind !== 'rgb' ? 'srgb' : wk)]);
  if (i % 5 === 0) random.push([plain.replace(/\)$/, ' / none)'), plain]);
}
// and a few the rest leave out: alpha 0, and the same `none` in two spaces
// (two transparent colors of one hue: a review, 2026-10-28, found them called equal, premultiplied away)
const EXTRA = [['transparent', 'rgb(0 0 0 / 0)'], ['transparent', 'rgb(255 0 0 / 0)'], ['rgb(255 0 0 / 0)', 'rgb(128 0 0 / 0)'], ['oklch(0.7 0.1 30 / 0)', 'oklch(0.5 0.1 30 / 0)'],
  ['color(display-p3 1 0 0 / 0)', 'color(display-p3 0.5 0 0 / 0)'], ['hsl(120 50% 50% / 0)', 'hsl(120 50% 30% / 0)'], ['rgb(none 0 0 / 0)', 'rgb(0 0 0 / 0)'], ['rgb(255 0 0 / 0.000001)', 'rgb(128 0 0 / 0.000001)'],
  // alpha 0.000015 apart, across spaces: §12's bound is 0.00001 (a review, 2026-10-28, found them equal)
  ['color(srgb 1 0 0 / .5)', 'color(srgb-linear 1 0 0 / .500015)'], ['color(srgb 1 0 0 / .5)', 'color(srgb-linear 1 0 0 / .500007)'], ['oklch(0.7 0.1 30 / 0)', 'oklab(0.7 0.0866 0.05 / 0)'],
  // and in one space, at that bound
  ['color(srgb 1 0 0 / .5)', 'color(srgb 1 0 0 / .500015)'], ['color(srgb 1 0 0 / .5)', 'color(srgb 1 0 0 / .500007)'], ['oklch(0.7 0.1 30 / .5)', 'oklch(0.7 0.1 30 / .500015)'],
  // a missing alpha and alpha 0.314, the fills' own (a review, 2026-10-28, found them equal)
  ['color(srgb 1 0 0 / none)', 'color(srgb 1 0 0 / .314)'], ['color(srgb 1 0 0 / none)', 'color(srgb 1 0 0 / none)'], ['color(srgb 1 0 0 / none)', 'color(srgb 1 0 0 / 0)'],
  // two hsl() of one black, hues apart: srgb's components for §12, equal (a review, 2026-10-29)
  ['hsl(0 100% 0%)', 'hsl(120 100% 0%)'], ['hwb(0 0% 100%)', 'hwb(200 0% 100%)'],
  ['lab(50 none 20)', ((c) => `oklab(${+c[0].toPrecision(10)} none ${+c[2].toPrecision(10)})`)(new Color('lab(50 0 20)').to('oklab').coords)]];
const pairs = [...SPEC.map((p) => [...p, '§12']), ...EXTRA.map((p) => [...p, 'extra']), ...WPT.map((p) => [...p, 'WPT']), ...random.map((p) => [...p, 'random'])];
const truth = pairs.map(([a, b]) => equivalent(ORACLE_AS[a] ?? a, ORACLE_AS[b] ?? b)), why = pairs.map(([a, b]) => blind(ORACLE_AS[a] ?? a, ORACLE_AS[b] ?? b));
const eqPage = `<style>@property --gamut-t-n { syntax: '<number>'; inherits: false; initial-value: -1; }</style>${pairs.map(([a, b]) =>
  `<div class="gamut-color-equal" style="--gamut-equal-a: ${a}; --gamut-equal-b: ${b}"><i></i><b style="--gamut-t-n: --gamut-color-equal(${a}, ${b})"></b><u style="color: oklab(from ${a} l a b / alpha)"></u><u style="color: oklab(from ${b} l a b / alpha)"></u></div>`).join('')}`;

// ---- #11533's recipe
const R = Array.from({ length: 24 }, () => [KINDS[pickOne(['oklch', 'lab', 'display-p3', 'hsl', 'rgb'])](), KINDS[pickOne(['oklch', 'lch', 'rgb', 'display-p3'])]()]);
const rPage = R.map(([a, b]) => `<div class="gamut-color-extract" style="--gamut-in: ${a}; --accent: ${b}"><i class="gamut-color-extract-read gamut-extract-lch gamut-extract-srgb-linear" style="background-color: lch(from var(--accent) var(--gamut-lch-l) c h); color: color(from var(--accent) srgb-linear calc(r * var(--gamut-srgb-linear-r)) calc(g * var(--gamut-srgb-linear-g)) calc(b * var(--gamut-srgb-linear-b)))"></i><s style="background-color: color-mix(in lch, lch(from ${a} l none none), lch(from ${b} none c h))"></s><u style="background-color: lch(from ${a} l c h); color: color(from ${a} xyz-d65 x y z)"></u><u style="background-color: lch(from ${b} l c h); color: color(from ${b} srgb-linear r g b)"></u></div>`).join('');
// the recipe's formula on the channels it gathers: the engine's own (its relative colors) of the color a relative color
// reads, and for the one .gamut-color-extract reads, CSS Color 4's conversion (Color.js) of the engine's own xyz-d65, as
// .gamut-color-extract computes it (SPEC.md E2, E3); numbers as the engine prints them, to 6 digits
const coords = (s) => { const m = s.match(/\(([^)]*)\)/)[1].replace(/^[a-z][\w-]* /, '').split('/')[0].trim().split(/\s+/).map(Number); return m; };
const rWant = R.map(([a, b]) => { const l = new Color(a).to('lch'), m = new Color(b).to('lch'); return [[...new Color('lch', [l.coords[0], m.coords[1], m.coords[2]]).to('srgb').coords, 1]]; });
const close4 = (x, y, r) => x.every((v, k) => Math.abs(v - y[k]) <= 1e-4 * r[k] || (k === 2 && r[k] === 360 && Math.abs(Math.abs(v - y[k]) - 360) <= 1e-4 * 360));
let failed = false;
for (const e of pick()) {
  const lines = [];
  if (want('light-dark')) {
    let ok = 0, bad = [], token = 0;
    for (const pref of ['light', 'dark']) {
      const { page, close } = await open(e); await page.emulateMedia({ colorScheme: pref });
      await page.setContent(`<style>${css}</style>${ldPage}`);
      const got = await page.evaluate(() => [...document.querySelectorAll('i')].map((x) => { const s = getComputedStyle(x); return [s.getPropertyValue('--gamut-out'), s.backgroundColor, s.color, [...x.children].map((b) => getComputedStyle(b).backgroundColor)]; }));
      got.forEach(([out, bg, tok, kids], i) => { const c = ldCases[i], at = `prefers ${pref}, root ${c.root}, parent ${c.p}, element ${c.e}`;
        if (!near(read(out), read(bg), 1e-6)) bad.push(`${at}: --gamut-out ${out}, light-dark() ${bg}`);
        // its children inherit the pick: a child of the other scheme reads the same color
        else if (kids.some((k) => !near(read(k), read(bg), 1e-6))) bad.push(`${at}: --gamut-out ${out} read on a light child and a dark one: ${kids.join(', ')}`); else ok++;
        if (!near(read(tok), read(bg), 1e-6)) token++; });
      await close();
    }
    failed ||= bad.length > 0;
    lines.push(`.gamut-light-dark: ${bad.length ? 'FAIL' : 'PASS'}: --gamut-out is the element's own light-dark(), and the same read on a light child and a dark one, in ${ok} of ${ok + bad.length} cases; one registered token holding light-dark() on the root misses ${token} of them (#13836)${bad.length ? `\n  ${bad.slice(0, 5).join('\n  ')}` : ''}`);
  }
  if (want('color-equal')) {
    const { page, close } = await open(e);
    await page.setContent(`<style>${css}</style>${eqPage}`);
    const got = await page.evaluate(() => [...document.querySelectorAll('.gamut-color-equal')].map((d) => { const g = (x, p) => getComputedStyle(x).getPropertyValue(p).trim();
      return [g(d.children[0], '--gamut-equal'), g(d, '--gamut-equal'), g(d.children[1], '--gamut-t-n'), getComputedStyle(d.children[2]).color, getComputedStyle(d.children[3]).color]; }));
    const chrome = e[0] === 'Chrome', tally = { ok: 0, blind: {}, engine: 0 }, bad = [];
    got.forEach(([child, own, fn, oa, ob], i) => {
      const [a, b, src] = pairs[i], t = truth[i], v = child === '1';
      // the engine's own OkLab of the two colors, compared at step 4
      const own4 = (() => { const x = new Color(oa), y = new Color(ob); return [...x.coords, x.alpha].every((n, k) => Math.abs((n ?? 0) - ([...y.coords, y.alpha][k] ?? 0)) <= EPS); })();
      const forms = chrome ? [['on its child', child], ['on itself', own], ['from --gamut-color-equal()', fn]] : [['on its child', child]];
      const wrong = forms.filter(([, x]) => (x === '1') !== t);
      if (!wrong.length) { tally.ok++; return; }
      // a result neither 0 nor 1 (unset, the function's -1, a fraction) is never one a quirk explains
      const odd = forms.filter(([, x]) => x !== '0' && x !== '1');
      if (odd.length) { bad.push(`${src} ${a} | ${b}: --gamut-equal ${odd.map(([w, x]) => `${x || '(unset)'} ${w}`).join(', ')}, neither 0 nor 1`); return; }
      // Firefox carries a missing r, g or b (x, y, z) into srgb only from srgb itself (QUIRKS.md Q37)
      const q37 = e[0] === 'Firefox' && [a, b].some((x) => /^color\((?!srgb )[\w-]+ [^)]*none/.test(x));
      if (q37 && forms.every(([, x]) => x === '1')) { tally.blind['QUIRKS.md Q37 (Firefox)'] = (tally.blind['QUIRKS.md Q37 (Firefox)'] ?? 0) + 1; return; }
      if (why[i] && forms.every(([, x]) => x === forms[0][1])) { tally.blind[why[i]] = (tally.blind[why[i]] ?? 0) + 1; return; }
      if (!hasNone(new Color(ORACLE_AS[a] ?? a)) && !hasNone(new Color(ORACLE_AS[b] ?? b)) && own4 === v && forms.every(([, x]) => x === forms[0][1])) { tally.engine++; if (process.env.APART) console.log(`  apart: ${a} | ${b}: rule ${t ? 1 : 0}, part ${child}; the engine's OkLab ${oa} | ${ob}`); return; }
      bad.push(`${src} ${a} | ${b}: the rule says ${t ? 1 : 0}, the part ${wrong.map(([w, x]) => `${x || '(unset)'} ${w}`).join(', ')}`);
    });
    // the engines' own differences, as many as measured (278 pairs, 2026-10-30): more fails, as in color-mix-check
    const KNOWN = { Chrome: { engine: 43 }, WebKit: { engine: 11 }, Firefox: { engine: 12, q37: 9 } }[e[0]] ?? {};
    if (tally.engine > (KNOWN.engine ?? 0)) bad.push(`${tally.engine} where the engine's own OkLab gives the part's answer, ${KNOWN.engine ?? 0} known`);
    if ((tally.blind['QUIRKS.md Q37 (Firefox)'] ?? 0) > (KNOWN.q37 ?? 0)) bad.push(`${tally.blind['QUIRKS.md Q37 (Firefox)']} of QUIRKS.md Q37, ${KNOWN.q37 ?? 0} known`);
    failed ||= bad.length > 0;
    const apart = [...Object.entries(tally.blind).map(([k, n]) => `${n} ${k}`), ...(tally.engine ? [`${tally.engine} where the engine's own OkLab gives the part's answer`] : [])];
    lines.push(`.gamut-color-equal: ${bad.length ? 'FAIL' : 'PASS'}: --gamut-equal is the rule's in ${tally.ok} of ${pairs.length} pairs${chrome ? ' (on its child, on itself and from the function)' : ' (on its child)'}${apart.length ? `; apart: ${apart.join(', ')}` : ''}${bad.length ? `\n  ${bad.slice(0, +(process.env.SHOW ?? 8)).join('\n  ')}` : ''}`);
    // nested: an instance that is the child of another keeps its own result where if() parses (on itself), and its own
    // children get its result, not the parent's (a review, 2026-10-29: `> *` gave it its parent's)
    await page.setContent(`<style>${css}</style>${[['red', 'red', 'red', 'blue'], ['red', 'blue', 'red', 'red']].map(([a, b, c, d]) => `<div class="gamut-color-equal" style="--gamut-equal-a: ${a}; --gamut-equal-b: ${b}"><div class="gamut-color-equal nest" style="--gamut-equal-a: ${c}; --gamut-equal-b: ${d}"><i class="leaf"></i></div></div>`).join('')}`);
    const nest = await page.evaluate(() => [...document.querySelectorAll('.nest')].map((n) => [getComputedStyle(n).getPropertyValue('--gamut-equal').trim(), getComputedStyle(n.firstChild).getPropertyValue('--gamut-equal').trim()]));
    const nestBad = nest.flatMap(([own, leaf], k) => { const w = k ? '1' : '0'; return [...(chrome && own !== w ? [`nested ${k} on itself: ${own}, want ${w}`] : []), ...(leaf !== w ? [`nested ${k} on its child: ${leaf}, want ${w}`] : [])]; });
    failed ||= nestBad.length > 0;
    lines.push(`.gamut-color-equal nested in another: ${nestBad.length ? `FAIL: ${nestBad.join('; ')}` : `PASS: its own result${chrome ? ' on itself and' : ''} on its child, 2 of 2`}`);
    await close();
  }
  if (want('recipe')) {
    const { page, close } = await open(e);
    await page.setContent(`<style>${css}</style>${rPage}`);
    const got = await page.evaluate(() => [...document.querySelectorAll('.gamut-color-extract')].map((d) => [...d.children].flatMap((x) => [getComputedStyle(x).backgroundColor, getComputedStyle(x).color])));
    const bad = [], LCH = [100, 150, 360];
    got.forEach(([pickX, mult, mix, , la, xyza, lb, linb], i) => {
      const A = coords(la), B = coords(lb), want1 = [A[0], B[1], B[2]], y = coords(linb), X = new Color('xyz-d65', coords(xyza));
      const wantX = [X.to('lch').coords[0], B[1], B[2]], want2 = X.to('srgb-linear').coords.map((v, k) => v * y[k]);
      if (!close4(coords(pickX), wantX, LCH)) bad.push(`lightness of ${R[i][0]}, chroma and hue of ${R[i][1]}, .gamut-color-extract: ${pickX}, want lch(${wantX.join(' ')})`);
      if (!close4(coords(mix), want1, LCH)) bad.push(`lightness of ${R[i][0]}, chroma and hue of ${R[i][1]}, color-mix(): ${mix}, want lch(${want1.join(' ')})`);
      if (!close4(coords(mult), want2, [1, 1, 1])) bad.push(`${R[i][1]} times ${R[i][0]} in srgb-linear: ${mult}, want ${want2.join(' ')}`);
      // and against Color.js where the engine reads the colors as written (Firefox keeps rgb() as 8-bit)
      if (!near(read(pickX), rWant[i][0], 2e-3) && !(R[i][0] + R[i][1]).includes('rgb(')) bad.push(`lightness of ${R[i][0]}, chroma and hue of ${R[i][1]}: ${pickX}, Color.js ${rWant[i][0]}`);
    });
    failed ||= bad.length > 0;
    lines.push(`#11533 recipe: ${bad.length ? 'FAIL' : 'PASS'}: ${3 * R.length - bad.length} of ${3 * R.length} colors are the formula on the channels gathered within 1e-4 of each channel's range (a lightness from one color, chroma and hue from another, by .gamut-color-extract and by color-mix(); a product in srgb-linear), and, for pairs with no rgb() (Firefox keeps it in bytes), within 2e-3 of Color.js${bad.length ? `\n  ${bad.slice(0, 5).join('\n  ')}` : ''}`);
    await close();
  }
  console.log(`${e[0]}:\n  ${lines.join('\n  ')}`);
}
process.exit(failed ? 1 : 0);
