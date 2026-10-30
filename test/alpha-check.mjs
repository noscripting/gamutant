// Checks .gamut-alpha (build.mjs alphaPart()) against CSS Color 5 §4.10's alpha() as the spec model computes it
// (specs/css-color/model.mjs; npm install --prefix specs/css-color), in Chrome, WebKit and Firefox: 20 origins, every
// kind of color and past sRGB, missing components included, by 10 alphas (unset, numbers, a percentage, past 0 and 1,
// calc() of the origin's alpha, none). A case passes when the part's color, read in the spec's own space (Color.js
// 0.7.1), has every number and its alpha within set_up_fuzzy_color_test's 0.01 of the spec's, a missing component or
// alpha as 0 as it paints. A case off the spec that is what the engine's own relative color gives for that origin
// (color(from <origin> srgb r g b / <alpha>), QUIRKS.md Q3 in WebKit) is counted apart. The form the engine writes it in
// (#13994, open) is counted, not judged.
// Usage: node test/alpha-check.mjs
import PW from './playwright.mjs'; // its Chrome is Chrome for Testing, never the installed Chrome.app
import { pick } from './engines.mjs';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from './vendor/css-color/model.mjs';
import { serialize, compare, EPSILON } from './vendor/css-color/read.mjs';
const pw = PW;
const cjs = createRequire(import.meta.url)('colorjs.io'), Color = cjs.default ?? cjs;
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const ORIGINS = ['red', '#336699', '#33669980', 'rgb(20% 40% 60% / 0.3)', 'hsl(200 60% 40%)', 'hwb(120 10% 20% / 0.6)', 'lab(50 20 -30)',
  'lch(70 40 120 / 0.8)', 'oklab(0.6 -0.1 0.05)', 'oklch(0.7 0.15 30 / 0.4)', 'oklch(0.6 0.1 none)', 'lch(60 30 none)', 'hsl(none 50% 50%)', 'lab(40 none 20)', 'oklch(0.65 0.3 150)',
  'color(display-p3 1 0 0)', 'color(rec2020 0 1 0 / 0.5)', 'color(xyz-d65 0.3 0.2 0.6)', 'color(srgb-linear 0.2 0.5 0.9)',
  'color(prophoto-rgb 0.4 0.6 0.2)', 'transparent', 'color(srgb 1 0.5 none / none)'];
const ALPHAS = [undefined, '0.5', '80%', '0', '1', '1.5', '-0.2', 'calc(alpha * 0.5)', 'calc(alpha + 0.3)', 'none'];
const cases = ORIGINS.flatMap((o) => ALPHAS.map((a) => [o, a]));
const want = cases.map(([o, a]) => resolve(`alpha(from ${o}${a === undefined ? '' : ` / ${a}`})`));
// the spec's form's space for Color.js, and its numbers as CSS writes them (lab's L 0..100, oklab's 0..1)
const SPACE = { 'color(srgb)': 'srgb', 'color(srgb-linear)': 'srgb-linear', 'color(display-p3)': 'p3', 'color(rec2020)': 'rec2020', 'color(xyz-d65)': 'xyz-d65',
  'color(prophoto-rgb)': 'prophoto', lab: 'lab', lch: 'lch', oklab: 'oklab', oklch: 'oklch' };
const page = `<!doctype html><style>${css}</style>${cases.map(([o, a]) => `<i class="gamut-alpha" style="--gamut-in: ${o};${a === undefined ? '' : ` --gamut-alpha-value: ${a}`}"></i>`).join('')}`;
let failed = false;
for (const [name, type, opts] of pick()) {
  const b = await pw[type].launch(opts), p = await b.newPage();
  await p.setContent(page);
  const [native, got] = await p.evaluate(() => [CSS.supports('color', 'alpha(from red / 0.5)'), [...document.querySelectorAll('i')].map((e) => getComputedStyle(e).getPropertyValue('--gamut-out'))]);
  // the engine's own relative color of each origin, for a case that only follows it
  const own = await p.evaluate((cs) => cs.map(([o, a]) => { const d = document.createElement('div'); d.style.color = `color(from ${o} srgb r g b / ${a ?? 'alpha'})`; document.body.append(d); const r = getComputedStyle(d).color; d.remove(); return r; }), cases);
  const bad = [], forms = {}; let follows = 0;
  cases.forEach(([o, a], i) => {
    const w = want[i], sp = SPACE[w.form];
    let g; try { g = new Color(got[i].trim()).to(sp); } catch { bad.push(`${o} / ${a}: unreadable ${got[i]}`); return; }
    const mine = [...g.coords.map((v) => (Number.isNaN(v) || v === null ? 0 : v)), g.alpha ?? 0], spec = [...w.c.map((v) => v ?? 0), w.alpha ?? 0];
    const near = (x, y) => x.every((v, k) => Math.abs(v - y[k]) <= EPSILON), srgb = (s) => { const c = new Color(s.trim()); return [...c.to('srgb').coords.map((v) => (Number.isNaN(v) || v === null ? 0 : v)), c.alpha ?? 0]; };
    // following the engine's own relative color is known only where it is known: WebKit's lch() none hue
    if (!near(mine, spec) && near(srgb(got[i]), srgb(own[i]))) { if (name === 'WebKit' && /^lch\(.*\bnone\b/.test(o)) { follows++; return; }
      bad.push(`alpha(from ${o}${a === undefined ? '' : ` / ${a}`}) -> ${got[i].trim()}, as the engine's own relative color gives it, where no known difference explains it`); return; }
    if (!near(mine, spec)) bad.push(`alpha(from ${o}${a === undefined ? '' : ` / ${a}`}) -> ${got[i].trim()}, the spec's ${serialize(w)} (read as ${serialize({ form: w.form, c: mine.slice(0, 3), alpha: mine[3] })})`);
    const f = compare(w, got[i]) === 'ok' ? 'the spec\'s' : got[i].trim().replace(/\(.*/, '(');
    forms[f] = (forms[f] ?? 0) + 1;
  });
  // the known part of it: WebKit 26.4's own relative color greys 10 origins with an lch()
  // none hue; more, or any elsewhere, fails
  const KNOWN = { WebKit: 10 }[name] ?? 0;
  if (follows > KNOWN) bad.push(`${follows} as the engine's own relative color gives them, where ${KNOWN} are known`);
  failed ||= bad.length > 0;
  console.log(`${name} (${native ? 'its own alpha()' : 'the relative color'}): ${cases.length - bad.length - follows} of ${cases.length} the spec's color and alpha${follows ? `, ${follows} as the engine's own relative color gives that origin` : ''}; written as ${Object.entries(forms).map(([f, n]) => `${f} ${n}`).join(', ')}${bad.length ? `\n  ${bad.slice(0, +(process.env.SHOW ?? 8)).join('\n  ')}` : ''}`);
  await b.close();
}
process.exit(failed ? 1 : 0);
