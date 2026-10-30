// Checks .gamut-fit-gradient's --gamut-gradient-ease (csswg-drafts #1332, an easing function between two color stops): stop k of
// the 9 is the OkLCh interpolation of --gamut-gradient-from and --gamut-gradient-to at the eased value E(k/8), clamped to
// 0..1 (a color-mix() can't extrapolate), mapped as .gamut-fit-screen maps to the gamut --gamut-target names. E is evaluated in
// JS from CSS Easing 1's and 2's definitions (cubic-bezier() solved by bisection, steps(), linear(); the keywords as their
// cubic-bezier() values); the colors against Color.js 0.7.1 (range() in oklch, premultiplied, then toGamut() with method
// css), each stop within 2/255 a channel, alpha within 2/255. Cases: the issue's gradients (black to transparent with
// ease-in-out, red to blue with ease-out, the thread's cubic-bezier()s, overshooting ones), every keyword on random pairs,
// steps() and linear(), and no ease (linear, as before), on elements with .gamut-gradient-ease beside the class; a page's own
// animation left on .gamut-fit-gradient alone. The class in Chrome, WebKit and Firefox, to srgb and display-p3.
// Usage: node test/gradient-ease-check.mjs [pairs=30]   (SHEET= for another sheet; ENGINES= narrows)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pick, open } from './engines.mjs';
const C0 = createRequire(import.meta.url)('colorjs.io'), Color = C0.default ?? C0;
const sheet = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const N = +(process.argv[2] ?? 30);

import { easing, KEYWORDS } from './ref/easing.mjs';

let seed = 1332; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const HUES = ['shorter', 'longer', 'increasing', 'decreasing'], NAMES = Object.keys(KEYWORDS);
const oklch = () => `oklch(${rnd().toFixed(4)} ${(0.4 * rnd()).toFixed(4)} ${(360 * rnd()).toFixed(2)}${rnd() < 0.2 ? ` / ${rnd().toFixed(2)}` : ''})`;
const bezier = () => `cubic-bezier(${[rnd(), 2 * rnd() - 0.5, rnd(), 2 * rnd() - 0.5].map((x) => x.toFixed(3)).join(', ')})`;
const CASES = [ // [from, to, hue, ease (null: none set)]
  ['black', 'transparent', 'shorter', 'ease-in-out'], // the issue's opening example
  ['rgb(255, 0, 0)', 'rgb(0, 0, 255)', 'shorter', 'ease-out'], // keithamus, 2025-12-13
  ['black', 'white', 'shorter', 'cubic-bezier(0.470, 0.000, 0.745, 0.715)'], // svgeesus, 2019-04-15
  ['black', 'transparent', 'shorter', 'cubic-bezier(0.48, 0.30, 0.64, 1.00)'], // the thread's fade
  ['rgb(255, 0, 0)', 'rgb(0, 0, 255)', 'shorter', 'cubic-bezier(1, 0, 1, 1)'], // the sharp one the thread worries bands
  ['green', 'blue', 'shorter', 'cubic-bezier(.25, -0.25, .75, 1.25)'], // the thread's overshoot both ends: clamped
  ['oklch(0.7 0.37 145)', 'oklch(0.5 0.3 300)', 'longer', 'cubic-bezier(0.5, -0.5, 0.5, 1.5)'],
  ['red', 'blue', 'shorter', 'steps(4)'], ['red', 'blue', 'shorter', 'steps(3, jump-none)'], ['red', 'blue', 'shorter', 'steps(2, jump-start)'],
  ['oklch(0.9 0.3 100)', 'oklch(0.3 0.2 250)', 'shorter', 'linear(0, 0.25 75%, 1)'],
  ['oklch(0.9 0.3 100)', 'oklch(0.3 0.2 250)', 'shorter', null], ['#ff0000', 'oklch(0.7 0.37 145)', 'shorter', null],
  ...NAMES.flatMap((e) => [['oklch(90% 0.36 0)', 'oklch(40% 0.1 20)', 'shorter', e], ['#0000ff', 'oklch(0.9 0.37 145)', 'increasing', e]]),
  ...Array.from({ length: N }, (_, i) => [oklch(), oklch(), HUES[Math.floor(4 * rnd())], i % 2 ? bezier() : NAMES[Math.floor(5 * rnd())]]),
];
const SP = { srgb: 'srgb', 'display-p3': 'p3' }, TARGETS = Object.keys(SP);
const want = ([a, b, hue, e], t) => { const r = new Color(a).range(new Color(b), { space: 'oklch', hue, premultiplied: true }), E = e ? easing(e) : (x) => x;
  return Array.from({ length: 9 }, (_, k) => { const c = r(Math.min(1, Math.max(0, E(k / 8)))).toGamut({ space: SP[t], method: 'css' }).to(SP[t]); return [...c.coords, c.alpha]; }); };
const colorsIn = (text) => { const out = [], re = /\b(rgba?|oklch|oklab|lab|lch|color)\(/g; let m;
  while ((m = re.exec(text))) { let d = 0, j = m.index + m[0].length - 1;
    for (; j < text.length; j++) { if (text[j] === '(') d++; else if (text[j] === ')' && --d === 0) break; }
    out.push(text.slice(m.index, j + 1)); re.lastIndex = j + 1; }
  return out; };
const off = (s, w, t) => { try { const c = new Color(s).to(SP[t]); return Math.max(...[...c.coords, c.alpha].map((v, k) => Math.abs((Number.isNaN(v) ? 0 : v) - w[k]))) * 255; } catch { return NaN; } };
const html = TARGETS.map((t) => `<div style="--gamut-target: ${t}">${CASES.map(([a, b, h, e]) => `<i class="gamut-fit-gradient gamut-gradient-ease" style="display:block;height:2px;--gamut-gradient-from: ${a}; --gamut-gradient-to: ${b}; --gamut-gradient-hue: ${h};${e ? ` --gamut-gradient-ease: ${e};` : ''} background-image: linear-gradient(to right, var(--gamut-gradient-stops))"></i>`).join('')}</div>`).join('');
let fail = 0;
// and under a page's reset of animations, the reduced-motion one, unlayered and !important: the same stops (the
// samplers' animation is !important in the sheet's layer; a review, 2026-10-29, found the reset sent eight to the end)
// and the same reset in a layer of the page's own, its layers named before the sheet with gamutant first;
// named after gamutant instead, an earlier layer's !important wins and an eased gradient's stops go to the end color,
// which is counted, not held against the sheet; a gradient with no easing runs no animation, so its
// stops hold there too, and under animation: none
const RESET = '* { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; animation-delay: -1ms !important; }';
const RESETS = [['', '', ''], [', under a reset of animations', '', `<style>${RESET}</style>`],
  [', under a reset in a layer after gamutant', '<style>@layer gamutant, reset;</style>', `<style>@layer reset { ${RESET} }</style>`],
  [', under a reset in a layer before gamutant (counted)', '<style>@layer reset, gamutant;</style>', `<style>@layer reset { ${RESET} }</style>`],
  [', under animation: none in a layer before gamutant (counted)', '<style>@layer reset, gamutant;</style>', '<style>@layer reset { * { animation: none !important; } }</style>'],
  // the sheet imported into a layer of the page's own (@import … layer(vendor)): that layer takes gamutant's place
  [', the sheet in a page\'s layer named before the reset\'s', '<style>@layer vendor, reset;</style>', `<style>@layer reset { ${RESET} }</style>`, 'vendor'],
  [', the sheet in a page\'s layer named after the reset\'s (counted)', '<style>@layer reset, vendor;</style>', `<style>@layer reset { ${RESET} }</style>`, 'vendor']];
for (const e of pick()) for (const [reset, pre, post, wrap] of RESETS) {
  const { browser, page } = await open(e);
  await page.setContent(`${pre}<style>${wrap ? `@layer ${wrap} { ${sheet} }` : sheet}</style>${post}${html}`, { timeout: 120000 });
  const v = await page.evaluate(() => [...document.querySelectorAll('i')].map((x) => getComputedStyle(x).backgroundImage));
  await browser.close();
  const bad = [], plain = []; let worst = 0, good = 0;
  v.forEach((img, i) => {
    const t = TARGETS[Math.floor(i / CASES.length)], p = CASES[i % CASES.length], stops = colorsIn(img), w = want(p, t);
    if (stops.length !== 9) return (p[3] ? bad : plain).push(`${t} ${p.join(' ')}: ${stops.length} stops in ${img.slice(0, 80)}`);
    stops.forEach((s, k) => { const o = off(s, w[k], t); worst = Math.max(worst, o || 0);
      if (o <= 2) good++; else (p[3] ? bad : plain).push(`${t} ${p.join(' | ')} stop ${k}: ${s}, want ${w[k].map((x) => (x * 255).toFixed(1)).join(' ')} (${o.toFixed(2)}/255)`); });
  });
  const counted = reset.endsWith('(counted)'), eased = CASES.filter((p) => p[3]).length * TARGETS.length * 9;
  if (counted) { console.log(`${e[0]} .gamut-fit-gradient${reset}: ${plain.length ? 'FAIL' : 'PASS'}: ${eased - bad.length} of ${eased} eased stops within 2/255, ${CASES.length * TARGETS.length * 9 - eased - plain.length} of ${CASES.length * TARGETS.length * 9 - eased} with no easing${plain.length ? `\n  ${plain.slice(0, 6).join('\n  ')}` : ''}`);
    if (plain.length) fail++; continue; }
  bad.push(...plain); if (bad.length) fail++;
  console.log(`${e[0]} .gamut-fit-gradient with --gamut-gradient-ease${reset}: ${bad.length ? 'FAIL' : 'PASS'}: ${good} of ${CASES.length * TARGETS.length * 9} stops within 2/255, worst ${worst.toFixed(2)}/255${bad.length ? ` (${bad.length} off)\n  ${bad.slice(0, 5).join('\n  ')}` : ''}`);
}
// and a page's own animation on the element: .gamut-fit-gradient alone leaves it, eased or not, with linear stops; beside
// .gamut-gradient-ease the easing takes it, from an !important rule too (one more specific than the sheet's), and from one in a layer named after gamutant;
// an !important one in the style attribute, or in a layer named before gamutant, keeps it and the easing is lost (README
// says so). Each element's animation-name and its fourth stop.
const EARLY = '<style>@layer early { .early { animation: rise 1s paused !important } }</style>';
const OWN = `<style>@keyframes rise { to { opacity: 1 } } .mine { animation: rise 1s paused; display: block; height: 2px;
  --gamut-gradient-from: oklch(0.5 0.16 0); --gamut-gradient-to: oklch(0.5 0.16 180); background-image: linear-gradient(var(--gamut-gradient-stops)) }
  i#strong.strong { animation: rise 1s paused !important } @layer late { .late { animation: rise 1s paused !important } }</style>
<i class="gamut-fit-gradient mine"></i><i class="gamut-fit-gradient mine" style="--gamut-gradient-ease: ease-in"></i>
<i class="gamut-fit-gradient gamut-gradient-ease mine" style="--gamut-gradient-ease: ease-in"></i><i class="gamut-fit-gradient gamut-gradient-ease mine"></i>
<i id="strong" class="gamut-fit-gradient gamut-gradient-ease mine strong" style="--gamut-gradient-ease: ease-in"></i><i class="gamut-fit-gradient gamut-gradient-ease mine late" style="--gamut-gradient-ease: ease-in"></i>
<i class="gamut-fit-gradient gamut-gradient-ease mine" style="--gamut-gradient-ease: ease-in; animation: rise 1s paused !important"></i><i class="gamut-fit-gradient gamut-gradient-ease mine early" style="--gamut-gradient-ease: ease-in"></i>`;
for (const e of pick()) {
  const { browser, page } = await open(e);
  await page.setContent(`${EARLY}<style>${sheet}</style>${OWN}`);
  const got = await page.evaluate(() => [...document.querySelectorAll('i')].map((x) => [getComputedStyle(x).animationName.split(',')[0], getComputedStyle(x).backgroundImage]));
  await browser.close();
  const fourth = (img) => colorsIn(img)[3] ?? '', lin = fourth(got[0][1]);
  const eased = (j) => got[j][0] === 'gamut-q0' && fourth(got[j][1]) !== lin, lost = (j) => got[j][0] === 'rise' && fourth(got[j][1]) === lin;
  const ok = got[0][0] === 'rise' && got[1][0] === 'rise' && eased(2) && got[3][0] === 'none' && fourth(got[1][1]) === lin && fourth(got[3][1]) === lin
    && eased(4) && eased(5) && lost(6) && lost(7);
  if (!ok) fail++;
  console.log(`${e[0]} a page's own animation on the element: ${ok ? 'PASS' : 'FAIL'}: ${got.map(([n]) => n).join(', ')} (.gamut-fit-gradient alone, alone with an ease, beside .gamut-gradient-ease with an ease, without one; then with an ease and the page's own !important animation in a rule more specific than the sheet's, a layer named after gamutant, the style attribute, a layer named before); the ease read only beside the class, the last two keeping theirs`);
}
process.exit(fail ? 1 : 0);
