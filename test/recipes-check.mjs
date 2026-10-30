// Checks three recipes built from the parts, in Chrome, WebKit and Firefox: each HTML block below, loaded with the sheet. "The background color, as a variable" (csswg-drafts #5292): the item's background is
// Compositing 1's source-over of its layer on the inherited --gamut-bg, before and while hovered; the label's text and
// underline are .gamut-readable-text's search on that background (test/ref/readable.mjs) and reach 4.5:1; the dot is the first
// of its two colors to reach 3:1 against it (CSS Color 6 §2.1.1), and its shadow is that background. "Semantic color
// pairs" (#11199): each note's text, on its painted background, is the search from its painted border color at 4.5:1,
// or 7:1 under prefers-contrast: more, light and dark (the example's two media queries set to match or not). "A background
// that animates": a page's own registered color, transitioned and given to
// --gamut-bg, keeps the text at 4.5:1 on every frame, 21 a transition (each animation paused and set): the block as
// written, and with four more pairs of colors in its place. Colors read as computed (8 bits) and as painted (pixels).
// PASS when every one holds within 1/255 a channel. Usage: node test/recipes-check.mjs   (ENGINES=, SHEET=)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pw, need, pick } from './engines.mjs';
import { search, ratio8 } from './ref/readable.mjs';
const C0 = createRequire(import.meta.url)('colorjs.io'), Color = C0.default ?? C0;
const { PNG } = need('pngjs');
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
// the recipes, as README.md gave them until it became a reference only (2026-10-28, 2026-10-30)
const RECIPES = {
 "The background color, as a variable": "<style>\n  .surface { background: var(--gamut-bg); }\n  .item { --gamut-layer-1: transparent; --gamut-layer-2: var(--gamut-bg); background: var(--gamut-out); display: inline-block; padding: 8px 12px; }\n  .item:hover { --gamut-layer-1: rgb(0 0 0 / 0.12); }\n  .item > * { --gamut-bg: var(--gamut-out); }\n  .label { color: var(--gamut-text); border-bottom: 2px solid var(--gamut-text); }\n  .dot { --gamut-try-1: #cb4b16; --gamut-try-2: #268bd2; --gamut-contrast-ratio: 3; display: inline-block; width: 8px; height: 8px;\n         border-radius: 50%; background: var(--gamut-text); box-shadow: 0 0 0 2px var(--gamut-bg); }\n</style>\n<nav class=\"surface\" style=\"--gamut-bg: #fdf6e3\">\n  <a class=\"item gamut-color-layers\" href=\"#\"><span class=\"label gamut-readable-text\">Home</span> <i class=\"dot gamut-contrast-color\"></i></a>\n</nav>\n",
 "Semantic color pairs": "<style>\n  .note { --bg-l: 0.95; --gamut-bg: oklch(var(--bg-l) 0.03 var(--hue)); --gamut-readable-from: oklch(0.6 0.12 var(--hue));\n          background: var(--gamut-bg); color: var(--gamut-text); border-left: 4px solid var(--gamut-readable-from); }\n  .info { --hue: 250; } .confirm { --hue: 145; } .warn { --hue: 70; } .fail { --hue: 25; }\n  @media (prefers-color-scheme: dark) { .note { --bg-l: 0.3; } }\n  @media (prefers-contrast: more) { .note { --gamut-ratio: 7; } }\n</style>\n<p class=\"note info gamut-readable-text\">Info</p>\n<p class=\"note confirm gamut-readable-text\">Confirm</p>\n<p class=\"note warn gamut-readable-text\">Warn</p>\n<p class=\"note fail gamut-readable-text\">Fail</p>\n",
 "A background that animates": "<style>\n  @property --surface { syntax: '<color>'; inherits: true; initial-value: white; }\n  .button { --surface: #3366cc; --gamut-bg: var(--surface); background: var(--surface); color: var(--gamut-text); transition: --surface 0.3s; }\n  .button:hover { --surface: oklch(from #3366cc calc(l * 0.85) c h); }\n</style>\n<button class=\"button gamut-readable-text\">Save</button>\n"
};
const example = (title) => RECIPES[title];
const page = (html) => `<!doctype html><style>${css} body { margin: 0; padding: 8px; font: 16px/1.5 sans-serif; }</style>${html}`;
// a computed color as 8-bit sRGB, by the browser itself (a canvas fill), so any form it serializes reads the same
const bytes = (p, sel, prop) => p.evaluate(([sel, prop]) => { const e = document.querySelector(sel), v = getComputedStyle(e).getPropertyValue(prop).replace(/\)\s.*$/, ')');
  const c = document.createElement('canvas').getContext('2d'); c.fillStyle = v; c.fillRect(0, 0, 1, 1); return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3); }, [sel, prop]);
const pixel = async (p, sel, dx, dy) => { const box = await p.locator(sel).boundingBox(), img = PNG.sync.read(await p.screenshot());
  const x = Math.round(box.x + (dx < 0 ? box.width + dx : dx)), y = Math.round(box.y + (dy < 0 ? box.height + dy : dy)), q = (y * img.width + x) * 4;
  return [img.data[q], img.data[q + 1], img.data[q + 2]]; };
const near = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i]))) <= 1;
const over = (top, a, base) => base.map((v, i) => Math.round(top[i] * a + v * (1 - a)));
let failed = false;
const report = (n, what, ok, detail) => { failed ||= !ok; console.log(`${n} ${ok ? 'PASS' : 'FAIL'} ${what}: ${detail}`); };

for (const [n, t, o] of pick()) {
  const b = await pw[t].launch(o);
  // #5292
  { const p = await b.newPage({ viewport: { width: 400, height: 120 } });
    await p.setContent(page(example('The background color, as a variable')));
    const surface = await bytes(p, '.surface', 'background-color');
    for (const hover of [false, true]) {
      if (hover) await p.hover('.item'); else await p.mouse.move(399, 119);
      const item = await bytes(p, '.item', 'background-color'), want = hover ? over([0, 0, 0], 0.12, surface) : surface;
      const text = await bytes(p, '.label', 'color'), line = await bytes(p, '.label', 'border-bottom-color'), dot = await bytes(p, '.dot', 'background-color'), ring = await bytes(p, '.dot', 'box-shadow');
      const [ink] = search(item, item, undefined, 4.5), tries = [[0xcb, 0x4b, 0x16], [0x26, 0x8b, 0xd2], [255, 255, 255], [0, 0, 0]], first = tries.find((c) => ratio8(c, item) >= 3);
      const painted = await pixel(p, '.item', 2, 2);
      const ok = near(item, want) && near(painted, want) && near(text, ink) && near(line, ink) && ratio8(text, item) >= 4.5 && near(dot, first) && near(ring, item);
      report(n, `#5292 ${hover ? 'hovered' : 'at rest'}`, ok, `surface ${surface}, item ${item} (painted ${painted}, Compositing 1 ${want}), label ${text} / underline ${line} (search ${ink}, ${ratio8(text, item).toFixed(2)}:1), dot ${dot} (first to 3:1 ${first}), its shadow ${ring}`);
    }
    await p.close(); }
  // #11199
  for (const [scheme, contrast] of [['light', 'no-preference'], ['dark', 'no-preference'], ['light', 'more'], ['dark', 'more']]) {
    // the example's media queries, made to match or not here (Firefox 158 takes no emulated scheme or contrast)
    const p = await b.newPage({ viewport: { width: 400, height: 260 } }), on = (yes) => (yes ? '@media all' : '@media not all');
    await p.setContent(page(example('Semantic color pairs').replace('@media (prefers-color-scheme: dark)', on(scheme === 'dark')).replace('@media (prefers-contrast: more)', on(contrast === 'more'))));
    const R = contrast === 'more' ? 7 : 4.5, rows = [];
    for (const k of ['info', 'confirm', 'warn', 'fail']) {
      const bg = await pixel(p, `.${k}`, -2, 2), seed = await pixel(p, `.${k}`, 1, 2), text = await bytes(p, `.${k}`, 'color');
      const [want] = search(bg, seed, undefined, R), ok = near(text, want) && ratio8(text, bg) >= R; failed ||= !ok;
      rows.push(`${ok ? '' : 'FAIL '}${k} ${text} on ${bg} from ${seed} (${ratio8(text, bg).toFixed(2)}:1${ok ? '' : `, search ${want}`})`);
    }
    report(n, `#11199 ${scheme}, prefers-contrast ${contrast}, ${R}:1`, !rows.some((r) => r.startsWith('FAIL')), rows.join('; '));
    await p.close();
  }
  // the animated background: the recipe's pair, then three more in its place
  for (const [from, to] of [[null, null], ['#3399ff', '#1a1a2e'], ['#ffffff', '#1a1a2e'], ['#e05a00', '#00a36c'], ['oklch(0.9 0.05 90)', 'oklch(0.35 0.15 300)']]) {
    const p = await b.newPage({ viewport: { width: 400, height: 120 } }), block = example('A background that animates');
    await p.setContent(page(from ? block.replace(/(\.button \{ --surface: )[^;]+/, `$1${from}`).replace(/(\.button:hover \{ --surface: )[^;]+/, `$1${to}`) : block));
    await p.hover('.button');
    // every frame's background and text as computed, 21 across the transition's own duration, every animation paused
    // there; each made 8-bit sRGB here (a canvas fill reads an oklab() a byte off at a rounding edge in WebKit 26.4:
    // facts/webkit-canvas-oklch.mjs)
    const b8 = (v) => new Color(v).to('srgb').coords.map((x) => Math.round(Math.min(1, Math.max(0, x || 0)) * 255));
    const raw = await p.evaluate(() => { const e = document.querySelector('.button'), a = document.getAnimations(), end = Math.max(0, ...a.map((x) => x.effect.getComputedTiming().endTime));
      a.forEach((x) => x.pause()); const out = [];
      for (let k = 0; k <= 20; k++) { a.forEach((x) => { x.currentTime = end * k / 20; }); const s = getComputedStyle(e); out.push([s.backgroundColor, s.color]); }
      return { n: a.length, out }; });
    const frames = { n: raw.n, out: raw.out.map(([bg, text]) => [b8(bg), b8(text)]) };
    const bad = frames.out.map(([bg, text], k) => { const [want] = search(bg, bg, undefined, 4.5); return near(text, want) && ratio8(text, bg) >= 4.5 ? null : `${k * 5}%: ${text} on ${bg} (${ratio8(text, bg).toFixed(3)}:1, search ${want})`; }).filter(Boolean);
    const worst = Math.min(...frames.out.map(([bg, text]) => ratio8(text, bg)));
    report(n, `animated background ${from ? `${from} to ${to}` : 'as written'}`, frames.n === 1 && !bad.length, `${frames.n} transition, ${frames.out.length - bad.length} of ${frames.out.length} frames at 4.5:1 and the search's text (lowest ${worst.toFixed(3)}:1)${bad.length ? `; ${bad.slice(0, 3).join('; ')}` : ''}`);
    await p.close();
  }
  await b.close();
}
process.exit(failed ? 1 : 0);
