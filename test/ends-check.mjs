// Checks .gamut-fit-screen at the ends of lightness, with chroma: CSS Color 4 §14.2.2 returns white for L >= 1 and black for
// L <= 0 before any search, and just inside them maps as usual. sRGB and Display P3 targets, in Chrome, WebKit and
// Firefox: each computed --gamut-out, parsed and converted in JS, against Color.js 0.7.1's css method in the target's
// channels, within 1/255. Then, with no --gamut-target, the screen's gamut as the target. Usage: node test/ends-check.mjs
// Optional: GATE_BATCH=1 GATE_RSS_MIB=512 GATE_REPORT=memory.json (RSS requires Chrome).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pw, pick } from './engines.mjs';
import { readFixture } from './renderer-budget.mjs';
const C0 = createRequire(import.meta.url)('colorjs.io'), Color = C0.default ?? C0;
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const INS = ['oklch(1 0.2 150)', 'oklch(1 0.1 300)', 'oklch(1 0.37 30)', 'oklch(1.2 0.2 150)', 'oklch(0 0.2 150)', 'oklch(0 0.3 264)', 'oklch(-0.1 0.2 30)',
  'oklch(0.999 0.2 150)', 'oklch(0.001 0.2 150)', 'oklch(0.995 0.4 359)', 'oklch(0.005 0.3 264)'];
const GAMUTS = { srgb: 'srgb', 'display-p3': 'p3' };
const html = `<!doctype html><style>${css}</style><body>${Object.keys(GAMUTS).map((g) => `<div style="--gamut-target: ${g}">${INS.map((c) => `<i class="gamut-fit-screen" data-g="${g}" data-in="${c}" style="--gamut-in: ${c}"></i>`).join('')}</div>`).join('')}</body>`;
let failed = false;
for (const [name, type, opts] of pick()) {
  const b = await pw[type].launch(opts), p = await b.newPage();
  let got;
  try { got = await readFixture(b, p, name, html, () => [...document.querySelectorAll('i')].map((e) => [e.dataset.g, e.dataset.in, getComputedStyle(e).getPropertyValue('--gamut-out').trim()])); }
  finally { await b.close(); }
  const bad = [];
  for (const [g, input, out] of got) {
    const sp = GAMUTS[g], want = new Color(input).toGamut({ space: sp, method: 'css' }).to(sp).coords;
    let have; try { have = new Color(out).to(sp).coords; } catch { bad.push(`${g} ${input}: ${out}`); continue; }
    const off = Math.max(...have.map((v, i) => Math.abs(v - want[i]) * 255));
    if (!(off <= 1)) bad.push(`${g} ${input}: ${have.map((v) => (v * 255).toFixed(1)).join(' ')} want ${want.map((v) => (v * 255).toFixed(1)).join(' ')}`);
  }
  failed ||= bad.length > 0;
  console.log(`${name}: ${got.length - bad.length} of ${got.length} colors at lightness 1, 0 and just inside within 1/255 of Color.js${bad.length ? `; off: ${bad.slice(0, 4).join(', ')}` : ''}`);
}
// with no --gamut-target (or one the sheet doesn't name), the target is the screen's: Display P3 where (color-gamut: p3) matches (Chrome, which can
// emulate a P3 screen), sRGB elsewhere (every headless screen)
{ const ins = ['oklch(0.7 0.3 150)', 'oklch(0.6 0.3 30)', 'oklch(0.5 0.3 264)', 'oklch(0.65 0.237 150)'];
  // and with a value the sheet doesn't name, which means the screen's too
  const page = `<!doctype html><style>${css}</style><body>${['', 'screen', 'cmyk'].map((g) => `<div${g ? ` style="--gamut-target: ${g}"` : ''}>${ins.map((c) => `<i class="gamut-fit-screen" data-in="${c}" style="--gamut-in: ${c}"></i>`).join('')}</div>`).join('')}</body>`;
  for (const [name, type, opts, p3] of pick().flatMap((e) => (e[0] === 'Chrome' ? [[...e, false], [...e, true]] : [[...e, false]]))) {
    const b = await pw[type].launch(opts), p = await b.newPage();
    if (p3) await (await p.context().newCDPSession(p)).send('Emulation.setEmulatedMedia', { features: [{ name: 'color-gamut', value: 'p3' }] });
    let got;
    try { got = await readFixture(b, p, name, page, () => [...document.querySelectorAll('i')].map((e) => [e.dataset.in, getComputedStyle(e).getPropertyValue('--gamut-out').trim()])); }
    finally { await b.close(); }
    const sp = p3 ? 'p3' : 'srgb', bad = got.filter(([i, o]) => { const w = new Color(i).toGamut({ space: sp, method: 'css' }).to(sp).coords, h = new Color(o).to(sp).coords; return !(Math.max(...h.map((v, k) => Math.abs(v - w[k]) * 255)) <= 1); });
    failed ||= bad.length > 0;
    console.log(`${name}, ${p3 ? 'P3 screen (emulated)' : 'sRGB screen'}: ${got.length - bad.length} of ${got.length} colors with no --gamut-target, or screen or cmyk, mapped to the screen's gamut within 1/255${bad.length ? `; off: ${bad.map(([i]) => i).join(', ')}` : ''}`);
  }
}
console.log(failed ? 'FAIL' : 'PASS');
process.exit(failed ? 1 : 0);
