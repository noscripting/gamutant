// Checks a recipe for text on two backgrounds (a gradient's stops under it), in Chrome, WebKit and Firefox: a
// .gamut-readable-text on the first, its --gamut-text set as --gamut-readable-from on a plain element, and a
// .gamut-readable-text on the second inside it, both with --gamut-readable-to: black over light stops, white over dark.
// For 300 random pairs on one side of mid grey (any two light ones, any two dark ones), at ratios 3, 4.5 and 7, and the
// two pairs the recipe fails on without the ends (white then #cd3f79 at 4.5: text #fdfdfd, 1.02:1 on
// white; black then #757576: #020202, 1.01:1 on black), the text as painted reaches the ratio on both as painted, wherever black (light) or white (dark) does.
// And README's shorter advice: over two light colors (both past WCAG's 0.179 luminance, where the part darkens), the
// part on the darker alone reaches the ratio on both; over two dark ones, on the lighter.
// Pixels, not a canvas: WebKit 26.4's canvas rounds an oklch() fill a byte off its own paint.
// Usage: node test/two-bg-check.mjs   (SHEET= for another sheet, ENGINES= to pick)
import { readFileSync } from 'node:fs';
import { pick, open, need } from './engines.mjs';
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
let s = 9; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
const color = (light) => `oklch(${(light ? 0.55 + r() * 0.45 : r() * 0.45).toFixed(3)} ${(r() * 0.15).toFixed(3)} ${(r() * 360).toFixed(1)})`;
const P = [['#ffffff', '#cd3f79', 4.5, true], ['#000000', '#6a6a6a', 3, false], ['#0a0a2a', '#4a6aa0', 3, false], ['#000000', '#757576', 4.5, false], ['#000000', 'rgb(118 117 117)', 4.5, false],
  ...Array.from({ length: 300 }, (_, k) => { const light = k % 2 === 0; return [color(light), color(light), [3, 4.5, 7][k % 3], light]; })];
// each pair a row of three 4-px squares: A, B, and the text color (the chained part's own --gamut-text as its background)
const html = `<style>body{margin:0} .r{display:flex;height:4px} .r>*,.r b{width:4px;height:4px;display:block}</style>` + P.map(([a, b, ratio, light]) =>
  `<div class=r><i style="background: ${a}"></i><i style="background: ${b}"></i><div class=gamut-readable-text style="--gamut-bg: ${a}; --gamut-ratio: ${ratio}; --gamut-readable-to: ${light ? 'black' : 'white'}"><div style="--gamut-readable-from: var(--gamut-text)"><b class=gamut-readable-text style="--gamut-bg: ${b}; --gamut-ratio: ${ratio}; --gamut-readable-to: ${light ? 'black' : 'white'}; background: var(--gamut-text)"></b></div></div>${[a, b].map((x) => `<div class=gamut-readable-text style="--gamut-bg: ${x}; --gamut-ratio: ${ratio}"><b style="background: var(--gamut-text)"></b></div>`).join('')}</div>`).join('');
const Y = (c) => { const v = c.map((x) => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const ratio = (a, b) => { const [h, l] = [Y(a), Y(b)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05); };
const { PNG } = need('pngjs');
let failed = false;
for (const e of pick(['Chrome', 'WebKit', 'Firefox'])) { const { browser, page } = await open(e); await page.setViewportSize({ width: 100, height: 4 * P.length });
  await page.setContent(`<style>${css}</style>${html}`);
  const img = PNG.sync.read(await page.screenshot({ fullPage: true }));
  const at = (x, y) => { const q = (y * img.width + x) * 4; return [img.data[q], img.data[q + 1], img.data[q + 2]]; };
  let both = 0, reach = 0, worst = 99, one = 0, oneReach = 0; const miss = [];
  P.forEach(([, , R, light], k) => { const a = at(1, 4 * k + 2), b = at(5, 4 * k + 2), t = at(9, 4 * k + 2), end = light ? [0, 0, 0] : [255, 255, 255];
    if (!(ratio(end, a) >= R && ratio(end, b) >= R)) return; reach++;
    const ya = Y(a), yb = Y(b), up = ya > 0.179129 && yb > 0.179129, down = ya < 0.179129 && yb < 0.179129;
    if (up || down) { const t1 = (up ? ya < yb : ya > yb) ? at(13, 4 * k + 2) : at(17, 4 * k + 2); oneReach++;
      if (ratio(t1, a) >= R && ratio(t1, b) >= R) one++; else miss.push(`${P[k].slice(0, 2).join(' / ')} at ${R}, the part on the ${up ? 'darker' : 'lighter'} alone: ${ratio(t1, a).toFixed(2)} and ${ratio(t1, b).toFixed(2)}`); }
    const ra = ratio(t, a), rb = ratio(t, b); worst = Math.min(worst, Math.min(ra, rb) / R);
    if (ra >= R && rb >= R) both++; else miss.push(`${P[k].slice(0, 2).join(' / ')} at ${R}: ${ra.toFixed(2)} on the first, ${rb.toFixed(2)} on the second`); });
  const ok = both === reach && reach >= 200 && one === oneReach && oneReach >= 150; failed ||= !ok;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${e[0]}: ${both} of ${reach} pairs (where the end reads on both) reach their ratio on both; worst ${worst.toFixed(3)} of the ratio; the part on the darker of two light (lighter of two dark) alone, ${one} of ${oneReach}${miss.length ? `\n  ${miss.slice(0, 4).join('\n  ')}` : ''}`);
  await browser.close(); }
process.exit(failed ? 1 : 0);
