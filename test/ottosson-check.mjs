// Checks .gamut-fit-screen's adaptive method to sRGB against its source, Björn Ottosson's gamut_clip_adaptive_L0_L_cusp
// (alpha 0.05, test/ref/ottosson.mjs), in Chrome, WebKit and Firefox: 600 random colors past sRGB within 1/255 a channel,
// encoded; and sRGB's blue corner (263.9° to 264.2°, lightness 0.3 to 0.6, chroma 0.35 and 0.5), where the sheet finds the
// cusp on the cube by Newton steps and his code by a polynomial fit, within 5/255 (3.5 measured, 2026-10-30).
// Usage: node test/ottosson-check.mjs   (SHEET= for another sheet, ENGINES= to pick)
import { readFileSync } from 'node:fs';
import { pick, open } from './engines.mjs';
import { ottosson, lab2lin } from './ref/ottosson.mjs';
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const enc = (x) => { x = Math.min(1, Math.max(0, x)); return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055); };
const dec = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const past = (lab) => lab2lin(lab).some((x) => x < -1e-4 || x > 1 + 1e-4), at = (L, C, h) => [L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180)];
let s = 3; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
const random = []; while (random.length < 600) { const L = 0.05 + r() * 0.9, C = r() * 0.4, h = r() * 360; if (past(at(L, C, h))) random.push({ L, C, h, tol: 1 }); }
const corner = []; for (let h = 263.9; h <= 264.2001; h += 0.01) for (const L of [0.3, 0.4, 0.45, 0.5, 0.6]) for (const C of [0.35, 0.5]) if (past(at(L, C, h))) corner.push({ L, C, h, tol: 5 });
const cases = [...random, ...corner], want = cases.map((c) => ottosson(at(c.L, c.C, c.h)).map(enc));
const html = `<div style="--gamut-target: srgb; --gamut-method: adaptive">${cases.map((c) => `<i class="gamut-fit-screen" style="--gamut-in: oklch(${c.L} ${c.C} ${c.h}); color: color(from var(--gamut-out) srgb r g b)"></i>`).join('')}</div>`;
let failed = false;
for (const e of pick(['Chrome', 'WebKit', 'Firefox'])) { const { browser, page } = await open(e); await page.setContent(`<style>${css}</style>${html}`);
  const got = await page.evaluate(() => [...document.querySelectorAll('i')].map((x) => getComputedStyle(x).color.match(/[-\d.e]+/g).slice(0, 3).map(Number)));
  await browser.close();
  const d = got.map((g, i) => Math.max(...g.map((v, k) => Math.abs(enc(dec(v)) - want[i][k]))));
  const bad = cases.flatMap((c, i) => (d[i] <= c.tol ? [] : [`oklch(${c.L.toFixed(3)} ${c.C.toFixed(3)} ${c.h.toFixed(2)}): ${d[i].toFixed(2)}/255`]));
  const worst = (from, to) => Math.max(...d.slice(from, to)); failed ||= bad.length > 0;
  console.log(`${bad.length ? 'FAIL' : 'PASS'} ${e[0]}: ${random.length} random colors past sRGB within 1/255 of Ottosson's code (worst ${worst(0, random.length).toFixed(2)}), ${corner.length} at sRGB's blue corner within 5/255 (worst ${worst(random.length).toFixed(2)})${bad.length ? `\n  ${bad.slice(0, 6).join('\n  ')}` : ''}`); }
process.exit(failed ? 1 : 0);
