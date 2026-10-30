// Checks .gamut-fit-gradient and --gamut-fit-gradient(), mapped gradient stops: 9 stops, each the OkLCh interpolation of --gamut-gradient-from
// and --gamut-gradient-to at t = 0, 1/8 ... 1 with --gamut-gradient-hue's method (css-color-4 §13, premultiplied as §13.4 says), mapped as
// .gamut-fit-screen maps (css-color-4 §14.2.1) to the gamut --gamut-target names on an ancestor. Against Color.js 0.7.1 (range()
// in oklch, then toGamut() with method css), each stop within 2/255 a channel in the target's own channels, alpha within
// 2/255: the pairs posted in csswg-drafts #9449 and random pairs (every hue method, some translucent, some with lightness
// 0 or 1), and 20 from an end near white or black at chroma 0.2 to 0.5, where the search's last steps decide a stop, to
// srgb and display-p3. The class in Chrome, WebKit and Firefox; the function where @function parses, and where
// it doesn't, a declaration before the call keeps its value. ONLY=function checks the function alone.
// Usage: node test/fit-gradient-check.mjs [pairs=60]   (SHEET= for another sheet)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pick, open } from './engines.mjs';
const C0 = createRequire(import.meta.url)('colorjs.io'), Color = C0.default ?? C0;
const sheet = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const N = +(process.argv[2] ?? 60), only = process.env.ONLY;
let seed = 9449; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const HUES = ['shorter', 'longer', 'increasing', 'decreasing'];
const romain = new Color('color(srgb 1 -0.01 0)').to('oklch').toString({ precision: 8 });
const oklch = () => `oklch(${(rnd() < 0.1 ? Math.round(rnd()) : rnd()).toFixed(4)} ${(0.45 * rnd()).toFixed(4)} ${(360 * rnd()).toFixed(2)}${rnd() < 0.1 ? ` / ${rnd().toFixed(2)}` : ''})`;
const PAIRS = [
  ['oklch(50% 0.16 0)', 'oklch(50% 0.16 180)', 'shorter'], // facelessuser
  ['oklch(90% 0.4 250)', 'oklch(40% 0.1 20)', 'shorter'], // Lea Verou's gradients page
  [romain, 'oklch(62.8% 0.2577 29.23)', 'longer'], // romainmenke
  ['oklch(90% 0.36 0)', 'oklch(90% 0.036 0)', 'shorter'], // the issue's opening color toward grey
  ['#ff0000', 'oklch(0.7 0.37 145)', 'shorter'],
  ...Array.from({ length: N }, () => [oklch(), oklch(), HUES[Math.floor(4 * rnd())]]),
  // a mutation run (2026-10-30): one of Firefox's search steps doubled sent this pair's stop 6 2.64/255 off, unseen
  ['oklch(0.98649 0.27673 3.098)', 'oklch(0.77355 0.49638 76.680)', 'shorter'],
  ...Array.from({ length: 20 }, () => [`oklch(${(rnd() < 0.5 ? 0.95 + 0.049 * rnd() : 0.002 + 0.05 * rnd()).toFixed(4)} ${(0.2 + 0.3 * rnd()).toFixed(4)} ${(360 * rnd()).toFixed(2)})`, oklch(), HUES[Math.floor(4 * rnd())]]),
];
const SP = { srgb: 'srgb', 'display-p3': 'p3' }, TARGETS = Object.keys(SP);
const want = ([a, b, hue], t) => { const r = new Color(a).range(new Color(b), { space: 'oklch', hue, premultiplied: true });
  return Array.from({ length: 9 }, (_, k) => { const c = r(k / 8).toGamut({ space: SP[t], method: 'css' }).to(SP[t]); return [...c.coords, c.alpha]; }); };
// the colors a computed gradient lists, in order
const colorsIn = (text) => { const out = [], re = /\b(rgba?|oklch|oklab|lab|lch|color)\(/g; let m;
  while ((m = re.exec(text))) { let d = 0, j = m.index + m[0].length - 1;
    for (; j < text.length; j++) { if (text[j] === '(') d++; else if (text[j] === ')' && --d === 0) break; }
    out.push(text.slice(m.index, j + 1)); re.lastIndex = j + 1; }
  return out; };
const off = (s, w, t) => { try { const c = new Color(s).to(SP[t]); return Math.max(...[...c.coords, c.alpha].map((v, k) => Math.abs((Number.isNaN(v) ? 0 : v) - w[k]))) * 255; } catch { return NaN; } };
const row = (style) => `<i style="display:block;height:2px;${style}"></i>`;
const html = (fn) => TARGETS.map((t) => `<div style="--gamut-target: ${t}">${PAIRS.map(([a, b, h]) => (fn
  ? row(`background-image: linear-gradient(to right, --gamut-fit-gradient(${a}, ${b}, ${h}))`)
  : row(`--gamut-gradient-from: ${a}; --gamut-gradient-to: ${b}; --gamut-gradient-hue: ${h}; background-image: linear-gradient(to right, var(--gamut-gradient-stops))`).replace('<i', '<i class="gamut-fit-gradient"'))).join('')}</div>`).join('');
let fail = 0;
for (const e of pick()) {
  for (const fn of only === 'function' ? [true] : [false, true]) {
    const { browser, page } = await open(e);
    await page.setContent(`<style>${sheet}</style>${html(fn)}<b id=fallback style="background-image: linear-gradient(red, blue); background-image: linear-gradient(--gamut-fit-gradient(red, blue))"></b>`, { timeout: 120000 });
    const r = await page.evaluate(() => ({
      fn: [...document.styleSheets[0].cssRules].some(function has(x) { return x.constructor.name === 'CSSFunctionRule' || [...(x.cssRules ?? [])].some(has); }),
      v: [...document.querySelectorAll('i')].map((x) => getComputedStyle(x).backgroundImage),
      fallback: getComputedStyle(document.getElementById('fallback')).backgroundImage }));
    await browser.close();
    const what = `${e[0]} ${fn ? '--gamut-fit-gradient()' : '.gamut-fit-gradient'}`;
    if (fn && !r.fn) {
      const ok = /^linear-gradient\(rgb\(255, 0, 0\), rgb\(0, 0, 255\)\)$/.test(r.fallback);
      if (!ok) fail++;
      console.log(`${what}: ${ok ? 'PRECONDITION_FAILED' : 'FAIL'}: @function doesn't parse; the declaration before the call keeps ${r.fallback}`);
      continue;
    }
    const bad = []; let worst = 0, good = 0;
    r.v.forEach((img, i) => {
      const t = TARGETS[Math.floor(i / PAIRS.length)], p = PAIRS[i % PAIRS.length], stops = colorsIn(img), w = want(p, t);
      if (stops.length !== 9) return bad.push(`${t} ${p.join(' ')}: ${stops.length} stops in ${img.slice(0, 80)}`);
      stops.forEach((s, k) => { const o = off(s, w[k], t); worst = Math.max(worst, o || 0);
        if (o <= 2) good++; else bad.push(`${t} ${p.join(' ')} stop ${k}: ${s}, want ${w[k].map((x) => (x * 255).toFixed(1)).join(' ')} (${o.toFixed(2)}/255)`); });
    });
    if (bad.length) fail++;
    console.log(`${what}: ${bad.length ? 'FAIL' : 'PASS'}: ${good} of ${PAIRS.length * TARGETS.length * 9} stops within 2/255, worst ${worst.toFixed(2)}/255${bad.length ? `\n  ${bad.slice(0, 5).join('\n  ')}` : ''}`);
  }
}
// the function maps its stops by the css method, as the class does, whatever --gamut-method an ancestor sets (left
// out, it took the ancestor's: adaptive gave stops 5.66/255 off, a review, 2026-10-28); where @function parses
for (const e of pick()) {
  const { browser, page } = await open(e), name = e[0] ?? e.name, o = 'oklch(0.75 0.4 60)';
  await page.setContent(`<style>${sheet}</style>${['css', 'adaptive', 'ray-trace', 'edge-seeker'].map((m) => `<div style="--gamut-target: srgb; --gamut-method: ${m}"><i class="gamut-fit-gradient" style="--gamut-gradient-from: ${o}; --gamut-gradient-to: ${o}; background-image: linear-gradient(var(--gamut-gradient-stops))"></i><b style="background-image: linear-gradient(--gamut-fit-gradient(${o}, ${o}, shorter, srgb))"></b></div>`).join('')}`);
  const { r, fn } = await page.evaluate(() => ({ r: [...document.querySelectorAll('div')].map((d) => [getComputedStyle(d.children[0]).backgroundImage, getComputedStyle(d.children[1]).backgroundImage]),
    fn: [...document.styleSheets[0].cssRules].some(function has(x) { return x.constructor.name === 'CSSFunctionRule' || [...(x.cssRules ?? [])].some(has); }) }));
  // whether @function parses, asked of the sheet: a function that gives no gradient where it parses is a failure
  if (!fn) { console.log(`${name} function under --gamut-method: PRECONDITION_FAILED: @function doesn't parse`); await browser.close(); continue; }
  const same = r.filter(([c, f]) => c === f && c !== 'none').length;
  if (same !== r.length) fail++;
  console.log(`${name} function under --gamut-method: ${same === r.length ? 'PASS' : 'FAIL'}: ${same} of ${r.length} methods on an ancestor give the class's stops${same === r.length ? '' : `\n  ${r.map(([c, f]) => `${c.slice(0, 70)} | ${f.slice(0, 70)}`).join('\n  ')}`}`);
  await browser.close();
}
process.exit(fail ? 1 : 0);
