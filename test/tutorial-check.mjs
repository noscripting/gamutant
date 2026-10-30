// TUTORIAL.md's results, measured: its final page (the green box, its text, the five tints) with the sheet, in Chrome,
// WebKit and Firefox; fails unless every color it paints and the text's contrast ratio are the ones TUTORIAL.md states.
// Usage: node test/tutorial-check.mjs
import { readFileSync } from 'node:fs';
import { pick, open } from './engines.mjs';
import { ratio8 } from './ref/methods.mjs';
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8'), doc = readFileSync(new URL('../TUTORIAL.md', import.meta.url), 'utf8');
const page = `<!doctype html><html lang="en"><meta charset="utf-8"><style>${css}</style><style>
  :root { --gamut-target: srgb; } body { font: 18px/1.5 system-ui, sans-serif; margin: 2rem; }
  .gamut-fit-screen { background: var(--gamut-out); padding: 1.5rem; border-radius: 12px; }
  .gamut-readable-text { color: var(--gamut-text); margin: 0; }
  ul { display: flex; gap: 6px; padding: 0; list-style: none; }
  .gamut-palette-step { flex: 1; height: 48px; border-radius: 6px; background: var(--gamut-out); }
</style><div class="gamut-fit-screen" style="--gamut-in: oklch(0.7 0.3 150)"><p class="gamut-readable-text" style="--gamut-bg: var(--gamut-out)">A green</p></div>
<ul style="--gamut-in: oklch(0.7 0.3 150)"><li class="gamut-palette-step"></li><li class="gamut-palette-step"></li><li class="gamut-palette-step"></li><li class="gamut-palette-step"></li><li class="gamut-palette-step"></li></ul></html>`;
const bytes = (s) => s.match(/[\d.]+/g).slice(0, 3).map((x) => Math.round(+x)), hex = (b) => '#' + b.map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
let bad = 0;
// and Chrome again as a Display P3 screen (its color-gamut emulated): TUTORIAL.md says the colors are the same on every screen
for (const [e, p3] of pick(['Chrome', 'WebKit', 'Firefox']).flatMap((e) => (e[0] === 'Chrome' ? [[e, false], [e, true]] : [[e, false]]))) {
  const { browser, page: p } = await open(e);
  if (p3) await (await p.context().newCDPSession(p)).send('Emulation.setEmulatedMedia', { features: [{ name: 'color-gamut', value: 'p3' }] });
  await p.setContent(page);
  const r = await p.evaluate(() => {
    const c = document.createElement('canvas').getContext('2d');
    // (cleared first, and opaque or it says so: a transparent fill would read the pixel before it)
    const px = (s) => { c.clearRect(0, 0, 1, 1); c.fillStyle = s; c.fillRect(0, 0, 1, 1); const d = [...c.getImageData(0, 0, 1, 1).data]; return d[3] === 255 ? `rgb(${d.slice(0, 3).join(', ')})` : `transparent ${d.join(' ')}`; };
    return { clip: px('oklch(0.7 0.3 150)'), box: px(getComputedStyle(document.querySelector('.gamut-fit-screen')).backgroundColor),
      text: px(getComputedStyle(document.querySelector('.gamut-readable-text')).color), steps: [...document.querySelectorAll('.gamut-palette-step')].map((el) => px(getComputedStyle(el).backgroundColor)) };
  });
  const box = bytes(r.box), text = bytes(r.text), ratio = ratio8(box, text).toFixed(2) + ':1';
  // each value where TUTORIAL.md states it: the clipped green, the box, the text and its ratio, the lightest and the darkest tint
  const said = { clip: /it paints `(#[0-9A-F]{6})`/, box: /the box is `(#[0-9A-F]{6})`/, text: /The text is a dark green, `(#[0-9A-F]{6})`/,
    ratio: /The text is a dark green, `#[0-9A-F]{6}`, at ([\d.]+:1)/, first: /run from `(#[0-9A-F]{6})`/, last: /run from `#[0-9A-F]{6}` to `(#[0-9A-F]{6})`/ };
  const opaque = [r.clip, r.box, r.text, ...r.steps].every((v) => v.startsWith('rgb'));
  const got = { clip: hex(bytes(r.clip)), box: hex(box), text: hex(text), ratio, first: hex(bytes(r.steps[0])), last: hex(bytes(r.steps.at(-1))) };
  const wrong = Object.entries(said).filter(([k, re]) => doc.match(re)?.[1] !== got[k]).map(([k, re]) => `${k} ${got[k]}, TUTORIAL.md ${doc.match(re)?.[1] ?? 'says none'}`);
  if (wrong.length || !opaque) bad++;
  console.log(`${e[0]}${p3 ? ', P3 screen' : ''}: ${wrong.length || !opaque ? `FAIL: ${[...wrong, ...(opaque ? [] : ['a color painted transparent'])].join('; ')}` : 'PASS'} (${Object.values(got).join(' ')})`);
  await browser.close();
}
// TUTORIAL.md: "the sheet does nothing until an element asks for a part by its class": plain elements compute every
// property the same with the sheet as without it
const plain = `<!doctype html><html lang="en"><meta charset="utf-8"><body><h1>Title</h1><p>Text <a href="#">a link</a> <b>bold</b></p>
<ul><li>One</li><li>Two</li></ul><button>Press</button> <input value="typed"><table><tr><td>1</td><td>2</td></tr></table><div style="color: oklch(0.7 0.3 150)">Green</div>`;
for (const e of pick(['Chrome', 'WebKit', 'Firefox'])) {
  const { browser, page: p } = await open(e);
  const all = () => [...document.querySelectorAll('*')].map((x) => { const s = getComputedStyle(x); return [...s].filter((n) => !n.startsWith('--')).map((n) => `${n}: ${s.getPropertyValue(n)}`).join('; '); });
  await p.setContent(plain.replace('<body>', '<style></style><body>')); const without = await p.evaluate(all);
  await p.setContent(plain.replace('<body>', `<style>${css}</style><body>`)); const withSheet = await p.evaluate(all);
  await browser.close();
  const differ = without.map((s, i) => [s.split('; '), (withSheet[i] ?? '').split('; ')]).flatMap(([a, b], i) => a.filter((x, k) => x !== b[k]).map((x) => `element ${i} ${x}`));
  if (differ.length || without.length !== withSheet.length) bad++;
  console.log(`${e[0]}, plain elements: ${differ.length ? `FAIL: ${differ.slice(0, 4).join('; ')}` : 'PASS'} (${without.length} elements, every property but custom ones, with the sheet and without)`);
}
process.exit(bad ? 1 : 0);
