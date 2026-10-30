// Checks .gamut-readable-text, .gamut-contrast-color and .gamut-color-layers (and the function forms, where @function parses) on hostile
// inputs, each case one element, in Chrome, WebKit and Firefox: a transparent or `/ none` candidate (CSS Color 6 §2:
// composited onto the base, contrast 1), a `none` channel or alpha in a base, a candidate or a layer (CSS Color 4 §4.4:
// a missing component behaves as zero, when the color is rendered or computed with), candidates in slots left unset
// (each set slot is a candidate, no other), a background with a `none` hue, --gamut-ratio as `none` or not a number (C1: `none` or anything but a
// number is no target in .gamut-contrast-color; T1: the default 4.5 in .gamut-readable-text), and an output read on a child through a
// property of the author's own. Each expected value comes from CSS Color 6 §2 in JS (contrast-color-check.mjs's
// winner()), Compositing 1 in JS (layers-check.mjs's layers()) or WCAG 2 as .gamut-readable-text's T1 has it, on the inputs
// with none written as 0. Within 1/255 a channel, 2/255 alpha (channels unread where the expected alpha is 0).
// Usage: node test/contrast-hostile-check.mjs   (ENGINES= to pick engines, SHEET= another sheet)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pick, open } from './engines.mjs';
import { winner } from './contrast-color-check.mjs';
import { layers } from './layers-check.mjs';
import { gamut } from './ref/classes.mjs';
const cjs = createRequire(import.meta.url)('colorjs.io'); const Color = cjs.default ?? cjs;
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');

// a color as srgb channels and alpha, a missing component as 0 (CSS Color 4 §4.4)
const rgba = (s) => { const c = new Color(s).to('srgb'); const a = c.alpha; return [...c.coords.map((x) => (Number.isNaN(x) || x === null ? 0 : x)), Number.isNaN(a) || a === null || a === undefined ? 0 : a]; };
// .gamut-readable-text's T1 for an opaque background at ratio R (contrast-check.mjs's model), as 0..1 channels
const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4), enc = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255;
const readable = (bg, R) => {
  const b = rgba(bg).slice(0, 3).map((v) => Math.round(v * 255) / 255), lb = b.map(lin), Yb = 0.2126 * lb[0] + 0.7152 * lb[1] + 0.0722 * lb[2];
  if (Yb < 0.179129) { const f = Math.min(1, Math.max(0, (R * (Yb + 0.05) - 0.05 - Yb) / (1 - Yb))); return [...lb.map((v) => Math.ceil(enc(v + (1 - v) * f) - 1e-9) / 255), 1]; }
  const k = Math.min(1, Math.max(0, ((Yb + 0.05) / R - 0.05) / Yb)); return [...lb.map((v) => Math.floor(enc(v * k) + 1e-9) / 255), 1];
};
const pickC = (bg, tries, target) => rgba(winner(bg, tries, target)); // CSS Color 6 §2 on a light page (Canvas white)

// [name, class, style, the output property, expected, source, the function call or '']
const C = [];
const cc = (name, st, want, src, fn = '') => C.push([name, 'contrast-color', st, '--gamut-text', want, src, fn]);
// 1. a transparent candidate composited onto the base has contrast 1
cc('transparent candidate loses', '--gamut-bg: wheat; --gamut-try-1: transparent; --gamut-try-2: darkgreen', pickC('wheat', ['transparent', 'darkgreen']), 'CSS Color 6 §2', '--gamut-contrast-color(wheat, none, transparent, darkgreen)');
cc('alpha 0 candidate, target', '--gamut-bg: navy; --gamut-try-1: rgb(0 0 0 / 0); --gamut-contrast-ratio: 4.5', pickC('navy', ['rgb(0 0 0 / 0)'], 4.5), 'CSS Color 6 §2', '--gamut-contrast-color(navy, 4.5, rgb(0 0 0 / 0))');
cc('alpha none candidate, target', '--gamut-bg: navy; --gamut-try-1: rgb(0 0 0 / none); --gamut-contrast-ratio: 4.5', pickC('navy', ['rgb(0 0 0 / 0)'], 4.5), 'CSS Color 6 §2, CSS Color 4 §4.4', '--gamut-contrast-color(navy, 4.5, rgb(0 0 0 / none))');
cc('transparent, the only candidate', '--gamut-bg: wheat; --gamut-try-1: transparent', [0, 0, 0, 0], 'CSS Color 6 §2 (the one candidate)', '--gamut-contrast-color(wheat, none, transparent)');
// 2. a base with alpha none is a base with alpha 0: Canvas
cc('base alpha none', '--gamut-bg: rgb(0 0 128 / none); --gamut-try-1: sienna; --gamut-try-2: gold', pickC('rgb(0 0 128 / 0)', ['sienna', 'gold']), 'CSS Color 6 §2, CSS Color 4 §4.4', '--gamut-contrast-color(rgb(0 0 128 / none), none, sienna, gold)');
cc('base alpha 0', '--gamut-bg: rgb(0 0 128 / 0); --gamut-try-1: sienna; --gamut-try-2: gold', pickC('rgb(0 0 128 / 0)', ['sienna', 'gold']), 'CSS Color 6 §2');
cc('base red none', '--gamut-bg: rgb(none 200 200); --gamut-try-1: rgb(255 120 120); --gamut-try-2: rgb(0 90 90)', pickC('rgb(0 200 200)', ['rgb(255 120 120)', 'rgb(0 90 90)']), 'CSS Color 6 §2, CSS Color 4 §4.4');
// 4. a candidate's none channel is 0, measured and given back
cc('candidate red none', '--gamut-bg: wheat; --gamut-try-1: rgb(none 0 0); --gamut-try-2: darkgreen', pickC('wheat', ['rgb(0 0 0)', 'darkgreen']), 'CSS Color 6 §2, CSS Color 4 §4.4', '--gamut-contrast-color(wheat, none, rgb(none 0 0), darkgreen)');
// 5. slots left unset: the set ones are the candidates, in order
cc('only slot 3', '--gamut-bg: wheat; --gamut-try-3: olive', pickC('wheat', ['olive']), 'CSS Color 6 §2 (the one candidate)');
cc('only slot 2, black base', '--gamut-bg: black; --gamut-try-2: navy', pickC('black', ['navy']), 'CSS Color 6 §2 (the one candidate)');
cc('slots 2 and 4, target', '--gamut-bg: wheat; --gamut-try-2: bisque; --gamut-try-4: sienna; --gamut-try-6: darkgreen; --gamut-contrast-ratio: 4.5', pickC('wheat', ['bisque', 'sienna', 'darkgreen'], 4.5), 'CSS Color 6 §2');
cc('slots 5 and 2, no target', '--gamut-bg: wheat; --gamut-try-5: maroon; --gamut-try-2: darkgreen', pickC('wheat', ['darkgreen', 'maroon']), 'CSS Color 6 §2');
cc('no candidates', '--gamut-bg: wheat', pickC('wheat', []), 'CSS Color 6 §2 (white, black)');
cc('no candidates, dark base, target', '--gamut-bg: #333; --gamut-contrast-ratio: 7', pickC('#333', [], 7), 'CSS Color 6 §2 (white, black)');
// 6. the ratio: none, or not a number, is no target
cc('ratio none', '--gamut-bg: wheat; --gamut-try-1: bisque; --gamut-try-2: sienna; --gamut-contrast-ratio: none', pickC('wheat', ['bisque', 'sienna']), 'C1 (none: no target)', '--gamut-contrast-color(wheat, none, bisque, sienna)');
for (const r of ['4.5px', '"4.5"', '4.5:1']) cc(`ratio ${r}`, `--gamut-bg: wheat; --gamut-try-1: bisque; --gamut-try-2: sienna; --gamut-contrast-ratio: ${r}`, pickC('wheat', ['bisque', 'sienna']), 'C1 (not a number: no target)');
cc('ratio 300% (no target)', '--gamut-bg: white; --gamut-try-1: red; --gamut-try-2: black; --gamut-contrast-ratio: 300%', pickC('white', ['red', 'black']), 'C1 (anything but a number: no target; 3 would pick red)', '--gamut-contrast-color(white, 300%, red, black)');
cc('ratio 4.5 (control)', '--gamut-bg: wheat; --gamut-try-1: bisque; --gamut-try-2: sienna; --gamut-contrast-ratio: 4.5', pickC('wheat', ['bisque', 'sienna'], 4.5), 'CSS Color 6 §2');
for (const [bg, r] of [['black', '4.5:1'], ['black', 'none'], ['#3399ff', '"4.5"'], ['#3399ff', '4.5px']]) {
  C.push([`readable-text ratio ${r} on ${bg}`, 'readable-text', `--gamut-bg: ${bg}; --gamut-ratio: ${r}`, '--gamut-text', readable(bg, 4.5), 'T1 (not a number: the default 4.5), WCAG 2', `--gamut-readable-text(${bg}, ${r})`]);
}
// a background with a `none` hue is painted with hue 0 (CSS Color 4 §4.4): its text is measured on that color
for (const [bg, as] of [['oklch(0.7 0.1 none)', 'oklch(0.7 0.1 0)'], ['oklch(0.45 0.12 none)', 'oklch(0.45 0.12 0)'], ['lch(60% 40 none)', 'lch(60% 40 0)']]) {
  C.push([`readable-text on a none hue, ${bg}`, 'readable-text', `--gamut-bg: ${bg}`, '--gamut-text', readable(as, 4.5), 'CSS Color 4 §4.4, WCAG 2 by T1', `--gamut-readable-text(${bg})`]);
}
C.push(['readable-text ratio 7 (control)', 'readable-text', '--gamut-bg: #3399ff; --gamut-ratio: 7', '--gamut-text', readable('#3399ff', 7), 'WCAG 2 by T1', '--gamut-readable-text(#3399ff, 7)']);
// 3. layers: a none channel or alpha is 0, as the page paints it
const ly = (name, cls, ls, given = ls) => C.push([name, cls, ls.map((c, i) => `--gamut-layer-${i + 1}: ${c}`).join('; '), '--gamut-out', layers(given, cls.split('blend-')[1] ?? 'normal'), 'Compositing 1, CSS Color 4 §4.4', '']);
ly('layer red none', 'color-layers', ['rgb(none 128 0 / 0.5)', 'white'], ['rgb(0 128 0 / 0.5)', 'white']);
ly('layer alpha none', 'color-layers', ['rgb(255 0 0 / none)', 'blue'], ['rgb(255 0 0 / 0)', 'blue']);
ly('bottom layer red none', 'color-layers', ['rgb(0 0 255 / 0.5)', 'rgb(none 200 100)'], ['rgb(0 0 255 / 0.5)', 'rgb(0 200 100)']);
ly('middle layer alpha none', 'color-layers', ['rgb(0 0 255 / 0.5)', 'rgb(255 0 0 / none)', 'white'], ['rgb(0 0 255 / 0.5)', 'rgb(255 0 0 / 0)', 'white']);
ly('bottom layer alpha none', 'color-layers', ['rgb(0 0 255 / 0.5)', 'rgb(0 200 0 / none)'], ['rgb(0 0 255 / 0.5)', 'rgb(0 200 0 / 0)']);
ly('multiply, layer alpha none', 'color-layers blend-multiply', ['rgb(255 0 0 / none)', 'blue'], ['rgb(255 0 0 / 0)', 'blue']);
ly('multiply, layer red none', 'color-layers blend-multiply', ['rgb(none 128 0 / 0.5)', 'white'], ['rgb(0 128 0 / 0.5)', 'white']);
ly('multiply, bottom layer red none', 'color-layers blend-multiply', ['rgb(0 0 255 / 0.5)', 'rgb(none 200 100)'], ['rgb(0 0 255 / 0.5)', 'rgb(0 200 100)']);
ly('multiply, layer red none over a translucent one', 'color-layers blend-multiply', ['rgb(none 128 0 / 0.5)', 'rgb(200 200 255 / 0.4)'], ['rgb(0 128 0 / 0.5)', 'rgb(200 200 255 / 0.4)']);
ly('color, layer blue none over a translucent one', 'color-layers blend-color', ['rgb(220 120 none / 0.6)', 'rgb(40 160 90 / 0.5)'], ['rgb(220 120 0 / 0.6)', 'rgb(40 160 90 / 0.5)']);
ly('hue, bottom layer green none', 'color-layers blend-hue', ['rgb(200 40 40 / 0.7)', 'rgb(50 none 200)'], ['rgb(200 40 40 / 0.7)', 'rgb(50 0 200)']);
// a channel of 1e-12 (a backdrop passes a registered color, which WebKit keeps to 6 decimals: there it is 0): dodge and hue divided by at least 1e-9, and gave 0.001
// for 1 and grey .11 for red .37 (a review, 2026-10-28)
const tiny = (name, cls, ls, zeroed) => C.push([name, cls, ls.map((c, i) => `--gamut-layer-${i + 1}: ${c}`).join('; '), '--gamut-out', (e) => layers(e === 'WebKit' ? zeroed : ls, cls.split('blend-')[1]), 'Compositing 1', '']);
tiny('color-dodge, white over a backdrop of 1e-12', 'color-layers blend-color-dodge', ['white', 'color(srgb 1e-12 1e-12 1e-12)'], ['white', 'black']);
// (and 1e-31, under the 1e-30 floor: dodge's cs = 1 case taken apart, a review, 2026-10-29)
tiny('color-dodge, white over a backdrop of 1e-31', 'color-layers blend-color-dodge', ['white', 'color(srgb 1e-31 1e-31 1e-31)'], ['white', 'black']);
tiny('color-burn, black over a backdrop 1e-12 under white', 'color-layers blend-color-burn', ['black', 'color(srgb 0.999999 0.999999 0.999999)'], ['black', 'color(srgb 0.999999 0.999999 0.999999)']);
// (and 1e-31, under the old 1e-30 floor on SetSat's range: a tenth of its saturation, a review, 2026-10-29)
tiny('hue, a source of red 1e-31 over lime', 'color-layers blend-hue', ['color(srgb 1e-31 0 0)', 'lime'], ['color(srgb 1e-31 0 0)', 'lime']);
tiny('hue, a source of red 1e-12 over blue', 'color-layers blend-hue', ['color(srgb 1e-12 0 0)', 'blue'], ['color(srgb 1e-12 0 0)', 'blue']);
// 7. an output read by the same part on a child, through a property of the author's own on an element in between
const nest = `<div class="gamut-contrast-color" style="--gamut-bg: wheat; --gamut-try-1: sienna; --gamut-try-2: darkgreen; --gamut-contrast-ratio: 4.5"><div style="--mid: var(--gamut-text)"><div class="gamut-contrast-color" style="--gamut-bg: var(--mid); --gamut-try-1: wheat; --gamut-try-2: gold; --gamut-contrast-ratio: none"><b></b></div></div></div>`;
C.push(['output read on a child through --mid', null, nest, '--gamut-text', pickC(winner('wheat', ['sienna', 'darkgreen'], 4.5), ['wheat', 'gold']), 'CSS Color 6 §2', '']);

const q = (s) => s.replaceAll('"', '&quot;'); // a string input in a style attribute
const html = `<!doctype html><style>${css} b, i { display: block; height: 4px }</style>` + C.map(([, cls, st, prop, , , fn]) => `<section>${cls === null ? st.replace('<b>', `<b style="background-color: var(${prop})">`)
  : `<div class="${gamut(cls)}" style="${q(st)}"><b style="background-color: var(${prop})"></b></div>`}${fn ? `<i style="background-color: red; background-color: ${q(fn)}"></i>` : ''}</section>`).join('\n');
const off = (got, want) => { const a = Math.abs(got[3] - want[3]) * 255; if (want[3] < 1e-6) return a / 2; return Math.max(a / 2, ...[0, 1, 2].map((k) => Math.abs(got[k] - want[k]) * 255)); };
const show = (c) => `${c.slice(0, 3).map((x) => +(x * 255).toFixed(1)).join(' ')} / ${+c[3].toFixed(3)}`;
let fails = 0;
for (const e of pick()) {
  const { browser, page } = await open(e);
  await page.setContent(html);
  const got = await page.evaluate(() => [...document.querySelectorAll('section')].map((s) => [getComputedStyle(s.querySelector('b')).backgroundColor, s.querySelector('i') && getComputedStyle(s.querySelector('i')).backgroundColor]));
  const fnOK = await page.evaluate(() => CSS.supports('color', 'red') && !!document.styleSheets[0].cssRules && [...document.styleSheets[0].cssRules].some((r) => r.constructor.name === 'CSSFunctionRule'));
  let n = 0, bad = 0;
  C.forEach(([name, , , , want0, src, fn], i) => {
    const want = typeof want0 === 'function' ? want0(e[0]) : want0;
    const forms = [['class', got[i][0]], ...(fn && fnOK ? [['function', got[i][1]]] : [])];
    for (const [form, v] of forms) {
      n++; let c; try { c = rgba(v); } catch { c = null; }
      const d = c ? off(c, want) : Infinity;
      if (!(d <= 1)) { bad++; console.log(`  FAIL ${e[0]} ${name} (${form}): ${v} (${c ? show(c) : '?'}), want ${show(want)} (${src})`); }
    }
  });
  console.log(`${bad ? 'FAIL' : 'PASS'} ${e[0]}: ${n - bad} of ${n} cases${fnOK ? '' : ' (no @function: classes only)'}`);
  fails += bad; await browser.close();
}
process.exit(fails ? 1 : 0);
