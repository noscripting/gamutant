// .gamut-readable-text on a wide-gamut screen: a background past sRGB is painted as it is, not clipped to sRGB, so its
// contrast is measured on the painted color. In Chrome with a P3 screen (color-gamut emulated by the DevTools protocol):
// for 241 backgrounds (181 inside Display P3, 180 of them random, and past sRGB; 60 inside sRGB) at ratios 3, 4.5 and 7, with and without
// a seed, the text reaches the ratio against the background as painted (its display-p3 channels clamped and rounded to
// 8 bits, WCAG 2's luminance from Display P3's Y row), and sits within 6% of it (the first color that reaches it), or is the seed itself where the seed already reaches it (SPEC T4). On an
// sRGB screen, in Chrome, WebKit and Firefox, the same against the background as that screen paints it (the engine's
// sRGB channels clamped, as all three paint a color past sRGB; measured unclamped until 2026-10-28, 4.08:1 for 4.5), and
// every result for a background inside sRGB is the sheet's before (the sheet BASE= names; without it, not run).
// WebKit and Firefox can't be made a P3 screen headless: there, only the sRGB screen is checked.
// Exits 1 on a fail. Usage: node test/readable-wide-check.mjs   (SHEET=, BASE=, ENGINES=)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pick, open } from './engines.mjs';
import { prefixSheet } from './ref/classes.mjs';

const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
// the sheet before the wide-gamut fix, as BASE= names it (the source repository's run gives it); without one, that comparison is not run
const base = process.env.BASE ? prefixSheet(readFileSync(process.env.BASE, 'utf8')) : null;
const cjs = createRequire(import.meta.url)('colorjs.io'), Color = cjs.default ?? cjs;
let s = 5153; const rnd = () => ((s = (s * 48271) % 2147483647) / 2147483647);
const bgs = [];
while (bgs.length < 180) { const c = new Color('oklch', [0.3 + rnd() * 0.6, 0.05 + rnd() * 0.3, rnd() * 360]);
  if (c.inGamut('p3') && !c.inGamut('srgb')) bgs.push(`color(display-p3 ${c.to('p3').coords.map((x) => x.toFixed(5)).join(' ')})`); }
bgs.push('color(display-p3 0.5568627 0.6823529 0.0823529)'); // a review, 2026-10-28
while (bgs.length < 241) bgs.push(`rgb(${[0, 1, 2].map(() => Math.floor(rnd() * 256)).join(' ')})`);
const seeds = ['', '--gamut-readable-from: #3366cc;', '--gamut-readable-from: #e05a00;'];
const cases = bgs.flatMap((bg, i) => [3, 4.5, 7].map((ratio) => ({ bg, ratio, seed: seeds[i % 3] })));
const body = cases.map((c) => `<p class="gamut-readable-text" style="--gamut-bg: ${c.bg}; --gamut-ratio: ${c.ratio}; ${c.seed} background: var(--gamut-bg); color: color(from var(--gamut-text) srgb r g b); outline-color: color(from var(--gamut-bg) srgb r g b)">Aa</p>`).join('');
const lin = (x) => { x = Math.round(Math.min(1, Math.max(0, x)) * 255) / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const Y = (rgb, row) => rgb.reduce((a, x, k) => a + lin(x) * row[k], 0);
const P3 = [0.2289746, 0.6917385, 0.0792869], SRGB = [0.2126, 0.7152, 0.0722];
// each text color, and the background as the engine converts it to sRGB (outline-color)
const read = () => [...document.querySelectorAll('p')].map((p) => { const s = getComputedStyle(p), f = (v) => v.match(/srgb ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)/)?.slice(1).map(Number) ?? null;
  return { t: f(s.color), bg: f(s.outlineColor) }; });
// each case against the background as a screen paints it: its channels clamped and rounded to 8 bits, Y by that space's
// row; on an sRGB screen the engine's own conversion to sRGB (Chrome's is up to a byte off CSS Color 4's sample code,
// as Color.js has it: color(display-p3 0.49495 0.89576 0.25943) is 0.315401 0.907872 there, 0.315709 0.907835 here)
const judge = (got, space, row) => { const bad = [];
  cases.forEach((c, i) => { const t = got[i].t; if (!t) { bad.push(`${c.bg} ${c.ratio}: no text`); return; }
    // (the text too as that screen paints it: on a P3 screen its display-p3 channels rounded to 8 bits, a review,
    // 2026-10-28: by its sRGB bytes color(display-p3 .5569 .6824 .0824)'s text reached 4.5, painted 4.47)
    const yb = Y(space === 'srgb' ? got[i].bg : new Color(c.bg).to(space).coords, row), yt = space === 'srgb' ? Y(t, SRGB) : Y(new Color('srgb', t).to(space).coords, row), r = (Math.max(yb, yt) + 0.05) / (Math.min(yb, yt) + 0.05);
    const reachable = Math.max((yb + 0.05) / 0.05, 1.05 / (yb + 0.05)) >= c.ratio;
    // a seed that already reaches the ratio is the text itself (SPEC T4); else the first color that reaches it
    const seed = c.seed && new Color(c.seed.match(/#\w+/)[0]).to('srgb').coords, ys = seed && Y(seed, SRGB), rs = seed && (Math.max(yb, ys) + 0.05) / (Math.min(yb, ys) + 0.05);
    if (seed && rs >= c.ratio) { if (t.some((x, k) => Math.round(x * 255) !== Math.round(seed[k] * 255))) bad.push(`${c.bg} ratio ${c.ratio}: the seed reaches ${rs.toFixed(3)}, text ${t.map((x) => Math.round(x * 255)).join(' ')} is not it`); return; }
    if (reachable && !(r >= c.ratio && r <= c.ratio * 1.06)) bad.push(`${c.bg} ratio ${c.ratio}${c.seed ? ' seeded' : ''}: ${r.toFixed(3)}`);
    // a ratio no color reaches: white or black, whichever has more contrast (a review, 2026-10-29: these went unchecked)
    const best = Math.max((yb + 0.05) / 0.05, 1.05 / (yb + 0.05));
    if (!reachable && !c.seed && !(r >= best * 0.995)) bad.push(`${c.bg} ratio ${c.ratio}, out of reach: ${r.toFixed(3)} for the better of white and black, ${best.toFixed(3)}`);
    // seeded and out of reach: the seed or T6's end (white below 0.179129, black above), whichever contrasts more (T5)
    const rEnd = yb < 0.179129 ? 1.05 / (yb + 0.05) : (yb + 0.05) / 0.05;
    if (!reachable && c.seed && !(r >= Math.max(rs, rEnd) * 0.995)) bad.push(`${c.bg} ratio ${c.ratio} seeded, out of reach: ${r.toFixed(3)}, the better of the seed and the end ${Math.max(rs, rEnd).toFixed(3)}`); });
  return bad; };
let fails = 0; const say = (ok, line) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${line}`); };
for (const e of pick(['Chrome', 'WebKit', 'Firefox'])) {
  const { browser, page } = await open(e), name = e[0] ?? e.name;
  const at = async (sheet) => { await page.setContent(`<style>${sheet}</style>${body}`); return page.evaluate(read); };
  const was = base && await at(base), now = await at(css), inside = cases.map((c, i) => i).filter((i) => new Color(cases[i].bg).inGamut('srgb'));
  const same = was && inside.filter((i) => JSON.stringify(now[i].t) === JSON.stringify(was[i].t)).length, srgbBad = judge(now, 'srgb', SRGB);
  if (was) say(same === inside.length, `${name}, sRGB screen: ${same} of ${inside.length} results on a background inside sRGB as the sheet's before`);
  else console.log(`${name}, sRGB screen: the results against the sheet before not run (BASE= names that sheet)`);
  say(!srgbBad.length, `${name}, sRGB screen: ${cases.length - srgbBad.length} of ${cases.length} reach their ratio within 6%, or where none can the better of white and black, on the background as painted${srgbBad.length ? `\n  ${srgbBad.slice(0, 6).join('\n  ')}` : ''}`);
  if (/chrom/i.test(String(e))) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'color-gamut', value: 'p3' }] });
    const bad = judge(await at(css), 'p3', P3);
    say(!bad.length, `${name}, P3 screen: ${cases.length - bad.length} of ${cases.length} reach their ratio within 6%, or where none can the better of white and black, on the painted background${bad.length ? `\n  ${bad.slice(0, 6).join('\n  ')}` : ''}`);
  }
  await browser.close();
}
process.exit(fails ? 1 : 0);
