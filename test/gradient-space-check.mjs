// .gamut-fit-gradient's --gamut-gradient-space: the target's own RGB space, so a gradient interpolated in it keeps the colors
// between its fitted stops inside the target (its cube is convex in its own channels; in oklab, a CSS gradient's
// default, they leave it: oklch(0.75 0.3 145) to oklch(0.55 0.3 285) by 0.0204 of an sRGB channel, a review,
// 2026-10-28). For each target (none, so the screen's, and srgb, display-p3, rec2020, a98-rgb, prophoto-rgb by
// --gamut-target on an ancestor) the space is the target's name (srgb where display-p3-linear doesn't parse, as the
// mapping falls back), and over 24 pairs (#9449's, the review's, random vivid ones) every color mixed in that space
// between two neighbouring stops, at 2% steps, is within 1e-4 of the target's cube. Chrome, WebKit and Firefox.
// Exits 1 on a fail. Usage: node test/gradient-space-check.mjs   (SHEET=, ENGINES=)
import { readFileSync } from 'node:fs';
import { pick, open } from './engines.mjs';

const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const PAIRS = [['oklch(0.75 0.3 145)', 'oklch(0.55 0.3 285)'], ['oklch(0.7 0.4 30)', 'oklch(0.7 0.4 250)'], ['#ff0000', '#0000ff'],
  ['oklch(0.9 0.3 100)', 'oklch(0.4 0.3 300)'],
  ...Array.from({ length: 20 }, () => [0, 1].map(() => `oklch(${(0.3 + 0.6 * rnd()).toFixed(3)} ${(0.15 + 0.3 * rnd()).toFixed(3)} ${(360 * rnd()).toFixed(1)})`))];
const TARGETS = ['', 'srgb', 'display-p3', 'rec2020', 'a98-rgb', 'prophoto-rgb'];
const body = TARGETS.map((t) => `<div${t ? ` style="--gamut-target: ${t}"` : ''}>${PAIRS.map(([a, b]) => `<i class="gamut-fit-gradient" data-t="${t}" style="--gamut-gradient-from: ${a}; --gamut-gradient-to: ${b}"></i>`).join('')}</div>`).join('') + '<b id="p"></b>';
let fails = 0; const say = (ok, line) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${line}`); };
for (const e of pick(['Chrome', 'WebKit', 'Firefox'])) {
  const { browser, page } = await open(e), name = e[0] ?? e.name;
  await page.setContent(`<style>${css}</style>${body}`);
  const r = await page.evaluate(() => {
    const p3 = CSS.supports('color', 'color(display-p3-linear 1 0 0)'), screenP3 = matchMedia('(color-gamut: p3)').matches;
    const expect = (t) => (!t ? (p3 && screenP3 ? 'display-p3' : 'srgb') : (t === 'srgb' || t === 'display-p3') && !p3 ? 'srgb' : t);
    const p = document.getElementById('p'), chan = (c, sp) => { p.style.color = `color(from ${c} ${sp} r g b)`; return getComputedStyle(p).color.match(/\(\S+ ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)/).slice(1).map(Number); };
    const wrong = [], out = []; let worst = 0;
    for (const el of document.querySelectorAll('.gamut-fit-gradient')) {
      const s = getComputedStyle(el), sp = s.getPropertyValue('--gamut-gradient-space').trim(), want = expect(el.dataset.t);
      if (sp !== want) { wrong.push(`${el.dataset.t || 'screen'}: "${sp}", want ${want}`); continue; }
      const stops = s.getPropertyValue('--gamut-gradient-stops').split(/,(?![^(]*\))/).map((x) => x.trim().replace(/\s+[-\d.]+%$/, ''));
      if (stops.length !== 9 || stops.some((x) => !x)) { wrong.push(`${el.dataset.t || 'screen'}: ${stops.length} stops, want 9`); continue; }
      for (let i = 0; i + 1 < stops.length; i++) for (let k = 1; k < 50; k++) {
        const c = chan(`color-mix(in ${sp}, ${stops[i]}, ${stops[i + 1]} ${2 * k}%)`, sp), x = Math.max(...c.map((v) => Math.max(0, v - 1, -v)));
        if (x > worst) worst = x; if (x > 1e-4 && out.length < 4) out.push(`${el.dataset.t || 'screen'} ${el.style.cssText.slice(0, 80)} stops ${i}-${i + 1} at ${2 * k}%: ${c.map((v) => v.toFixed(5)).join(' ')}`);
      } }
    return { wrong, out, worst, n: document.querySelectorAll('.gamut-fit-gradient').length };
  });
  say(!r.wrong.length, `${name}: --gamut-gradient-space names the target in ${r.n - r.wrong.length} of ${r.n}${r.wrong.length ? `; ${r.wrong.slice(0, 3).join('; ')}` : ''}`);
  say(!r.out.length, `${name}: between the stops, mixed in that space, worst ${r.worst.toExponential(1)} past the target's cube (1e-4 allowed)${r.out.length ? `\n  ${r.out.join('\n  ')}` : ''}`);
  await browser.close();
}
process.exit(fails ? 1 : 0);
