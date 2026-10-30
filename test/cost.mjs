// The time a part takes a distinct input, for two sheets side by side: N
// elements whose inputs all change at once, style forced by reading the output, trimmed mean over 20 frames, per element.
// Usage: node test/cost.mjs <a.css> <b.css> <part>   (part: okhsl-from, okhsl-from-l, fit-screen,
// fit-screen-ray-trace, fit-screen-edge-seeker, fit-screen-ray-trace-rec2020, fit-screen-ray-trace-prophoto,
// fit-screen-edge-seeker-a98, screen-edge, palette-step, screen-edge-rec2020, screen-edge-prophoto, okhsl, okhsv,
// jzczhz, hdr-color, color-mix, color-mix-paint (the elements with .gamut-mix-paint),
// color-interpolate, fit-gradient, device-cmyk, readable-text, readable-text-from, readable-text-range, contrast-color,
// color-layers, color-layers-multiply, fit-gradient-ease (one easing), fit-gradient-eases (a cubic-bezier() each), both with .gamut-gradient-ease,
// light-dark, color-equal; ENGINES= narrows; N=256; STYLO_THREADS= Firefox's style threads)
import { readFileSync } from 'node:fs';
import { pick, open, benchLock } from './engines.mjs';
import { gamut } from './ref/classes.mjs';
const [a, b, part] = process.argv.slice(2), N = +(process.env.N ?? 256);
const PARTS = {
  'okhsl-from': ['okhsl-from', (r) => `--gamut-in: oklch(${(0.2 + r() * 0.7).toFixed(4)} ${(r() * 0.2).toFixed(4)} ${(r() * 360).toFixed(2)}); --gamut-okhsl-s: ${r().toFixed(4)}`, '--gamut-out'],
  'okhsl-from-l': ['okhsl-from', (r) => `--gamut-in: oklch(${(0.2 + r() * 0.7).toFixed(4)} ${(r() * 0.2).toFixed(4)} ${(r() * 360).toFixed(2)}); --gamut-okhsl-l: ${r().toFixed(4)}`, '--gamut-out'],
  'fit-screen': ['fit-screen', (r) => `--gamut-in: oklch(${(0.1 + r() * 0.8).toFixed(4)} ${(r() * 0.4).toFixed(4)} ${(r() * 360).toFixed(2)})`, '--gamut-out'],
  // a palette step (Material's tonal palette): each element its own seed and --gamut-step
  'palette-step': ['palette-step', (r) => `--gamut-in: oklch(${(0.3 + r() * 0.6).toFixed(4)} ${(r() * 0.3).toFixed(4)} ${(r() * 360).toFixed(2)}); --gamut-step: ${r().toFixed(4)}`, '--gamut-out'],
  'screen-edge': ['screen-edge', (r) => `--gamut-in: oklch(${(0.1 + r() * 0.8).toFixed(4)} ${(r() * 0.4).toFixed(4)} ${(r() * 360).toFixed(2)}); --gamut-rel: 0.8`, '--gamut-out'],
  // the elements in a wrapper whose style the part reads from its parent (--gamut-method, --gamut-target)
  'fit-screen-ray-trace': ['fit-screen', (r) => `--gamut-in: oklch(${(0.1 + r() * 0.8).toFixed(4)} ${(r() * 0.4).toFixed(4)} ${(r() * 360).toFixed(2)})`, '--gamut-out', '--gamut-method: ray-trace'],
  'fit-screen-edge-seeker': ['fit-screen', (r) => `--gamut-in: oklch(${(0.1 + r() * 0.8).toFixed(4)} ${(r() * 0.4).toFixed(4)} ${(r() * 360).toFixed(2)})`, '--gamut-out', '--gamut-method: edge-seeker'],
  // the two methods to the wider targets (before 2026-10-27, the css method ran there)
  'fit-screen-ray-trace-rec2020': ['fit-screen', (r) => `--gamut-in: oklch(${(0.1 + r() * 0.8).toFixed(4)} ${(r() * 0.6).toFixed(4)} ${(r() * 360).toFixed(2)})`, '--gamut-out', '--gamut-method: ray-trace; --gamut-target: rec2020'],
  'fit-screen-ray-trace-prophoto': ['fit-screen', (r) => `--gamut-in: oklch(${(0.1 + r() * 0.8).toFixed(4)} ${(r() * 1.2).toFixed(4)} ${(r() * 360).toFixed(2)})`, '--gamut-out', '--gamut-method: ray-trace; --gamut-target: prophoto-rgb'],
  'fit-screen-edge-seeker-a98': ['fit-screen', (r) => `--gamut-in: oklch(${(0.1 + r() * 0.8).toFixed(4)} ${(r() * 0.6).toFixed(4)} ${(r() * 360).toFixed(2)})`, '--gamut-out', '--gamut-method: edge-seeker; --gamut-target: a98-rgb'],
  'screen-edge-rec2020': ['screen-edge', (r) => `--gamut-in: oklch(${(0.1 + r() * 0.8).toFixed(4)} ${(r() * 0.4).toFixed(4)} ${(r() * 360).toFixed(2)}); --gamut-rel: 0.8`, '--gamut-out', '--gamut-target: rec2020'],
  'screen-edge-prophoto': ['screen-edge', (r) => `--gamut-in: oklch(${(0.1 + r() * 0.8).toFixed(4)} ${(r() * 0.4).toFixed(4)} ${(r() * 360).toFixed(2)}); --gamut-rel: 0.8`, '--gamut-out', '--gamut-target: prophoto-rgb'],
  okhsl: ['okhsl', (r) => `--gamut-okhsl-h: ${(r() * 360).toFixed(2)}; --gamut-okhsl-s: ${r().toFixed(4)}; --gamut-okhsl-l: ${r().toFixed(4)}`, '--gamut-out'],
  'color-mix': ['color-mix', (r) => `--gamut-mix-count: 3; --gamut-mix-1: oklch(${(r()).toFixed(4)} ${(r() * 0.3).toFixed(4)} ${(r() * 360).toFixed(2)}); --gamut-mix-2: rgb(${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)}); --gamut-mix-3: oklch(${(r()).toFixed(4)} ${(r() * 0.3).toFixed(4)} ${(r() * 360).toFixed(2)}); --gamut-mix-pct-1: ${(r() * 100).toFixed(0)}`, '--gamut-out'],
  'color-mix-paint': ['color-mix mix-paint', (r) => `--gamut-mix-1: rgb(${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)}); --gamut-mix-2: rgb(${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)}); --gamut-mix-pct-1: ${(r() * 100).toFixed(0)}`, '--gamut-out'],
  'color-interpolate': ['color-interpolate', (r) => `--gamut-stops: 3; --gamut-stop-1: oklch(${(r()).toFixed(4)} ${(r() * 0.3).toFixed(4)} ${(r() * 360).toFixed(2)}); --gamut-stop-2: oklch(${(r()).toFixed(4)} ${(r() * 0.3).toFixed(4)} ${(r() * 360).toFixed(2)}); --gamut-stop-3: oklch(${(r()).toFixed(4)} ${(r() * 0.3).toFixed(4)} ${(r() * 360).toFixed(2)}); --gamut-at-1: 0; --gamut-at-2: 0.5; --gamut-at-3: 1; --gamut-t: ${r().toFixed(4)}`, '--gamut-out'],
  'fit-gradient': ['fit-gradient', (r) => `--gamut-gradient-from: oklch(${(0.1 + r() * 0.8).toFixed(4)} ${(r() * 0.4).toFixed(4)} ${(r() * 360).toFixed(2)}); --gamut-gradient-to: oklch(${(0.1 + r() * 0.8).toFixed(4)} ${(r() * 0.4).toFixed(4)} ${(r() * 360).toFixed(2)})`, '--gamut-gradient-stops'],
  'fit-gradient-ease': ['fit-gradient gradient-ease', (r) => `--gamut-gradient-from: oklch(${(0.1 + r() * 0.8).toFixed(4)} ${(r() * 0.4).toFixed(4)} ${(r() * 360).toFixed(2)}); --gamut-gradient-to: oklch(${(0.1 + r() * 0.8).toFixed(4)} ${(r() * 0.4).toFixed(4)} ${(r() * 360).toFixed(2)}); --gamut-gradient-ease: ease-in-out`, '--gamut-gradient-stops'],
  'fit-gradient-eases': ['fit-gradient gradient-ease', (r) => `--gamut-gradient-from: oklch(${(0.1 + r() * 0.8).toFixed(4)} ${(r() * 0.4).toFixed(4)} ${(r() * 360).toFixed(2)}); --gamut-gradient-to: oklch(${(0.1 + r() * 0.8).toFixed(4)} ${(r() * 0.4).toFixed(4)} ${(r() * 360).toFixed(2)}); --gamut-gradient-ease: cubic-bezier(${r().toFixed(3)}, ${r().toFixed(3)}, ${r().toFixed(3)}, ${r().toFixed(3)})`, '--gamut-gradient-stops'],
  'device-cmyk': ['device-cmyk', (r) => `--gamut-cmyk-c: ${r().toFixed(4)}; --gamut-cmyk-m: ${r().toFixed(4)}; --gamut-cmyk-y: ${r().toFixed(4)}; --gamut-cmyk-k: ${r().toFixed(4)}`, '--gamut-out'],
  'readable-text': ['readable-text', (r) => `--gamut-bg: rgb(${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)}); --gamut-ratio: 4.5`, '--gamut-text'],
  'readable-text-from': ['readable-text', (r) => `--gamut-bg: rgb(${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)}); --gamut-readable-from: rgb(${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)}); --gamut-ratio: 4.5`, '--gamut-text'],
  'readable-text-range': ['readable-text', (r) => `--gamut-bg: rgb(${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)}); --gamut-readable-from: rgb(${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)}); --gamut-readable-to: rgb(${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)}); --gamut-ratio: 4.5`, '--gamut-text'],
  'contrast-color': ['contrast-color', (r) => `--gamut-bg: rgb(${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)}); --gamut-try-1: oklch(${(r()).toFixed(4)} ${(r() * 0.3).toFixed(4)} ${(r() * 360).toFixed(2)}); --gamut-try-2: oklch(${(r()).toFixed(4)} ${(r() * 0.3).toFixed(4)} ${(r() * 360).toFixed(2)}); --gamut-try-3: oklch(${(r()).toFixed(4)} ${(r() * 0.3).toFixed(4)} ${(r() * 360).toFixed(2)}); --gamut-contrast-ratio: 4.5`, '--gamut-text'],
  'color-layers': ['color-layers', (r) => `--gamut-layer-1: oklch(${(r()).toFixed(4)} ${(r() * 0.3).toFixed(4)} ${(r() * 360).toFixed(2)} / ${(r()).toFixed(3)}); --gamut-layer-2: rgb(${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)})`, '--gamut-out'],
  'color-layers-multiply': ['color-layers blend-multiply', (r) => `--gamut-layer-1: oklch(${(r()).toFixed(4)} ${(r() * 0.3).toFixed(4)} ${(r() * 360).toFixed(2)} / ${(r()).toFixed(3)}); --gamut-layer-2: rgb(${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)})`, '--gamut-out'],
  okhsv: ['okhsv', (r) => `--gamut-okhsv-h: ${(r() * 360).toFixed(2)}; --gamut-okhsv-s: ${r().toFixed(4)}; --gamut-okhsv-v: ${r().toFixed(4)}`, '--gamut-out'],
  jzczhz: ['jzczhz', (r) => `--gamut-jzczhz-jz: ${(0.05 + r() * 0.15).toFixed(4)}; --gamut-jzczhz-cz: ${(r() * 0.1).toFixed(4)}; --gamut-jzczhz-hz: ${(r() * 360).toFixed(2)}`, '--gamut-out'],
  'light-dark': ['light-dark', (r) => `color-scheme: ${r() < 0.5 ? 'light' : 'dark'}; --gamut-light: oklch(${(0.6 + r() * 0.35).toFixed(4)} ${(r() * 0.2).toFixed(4)} ${(r() * 360).toFixed(2)}); --gamut-dark: oklch(${(0.1 + r() * 0.35).toFixed(4)} ${(r() * 0.2).toFixed(4)} ${(r() * 360).toFixed(2)})`, '--gamut-out'],
  // its output on the child, where it is read
  'color-equal': ['color-equal', (r) => `--gamut-equal-a: oklch(${(0.1 + r() * 0.8).toFixed(4)} ${(r() * 0.3).toFixed(4)} ${(r() * 360).toFixed(2)}); --gamut-equal-b: rgb(${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)} ${(r() * 255).toFixed(1)})`, '--gamut-equal', '', true],
  'hdr-color': ['hdr-color', (r) => `--gamut-hdr-1: oklch(${(0.2 + r() * 0.7).toFixed(4)} ${(r() * 0.2).toFixed(4)} ${(r() * 360).toFixed(2)}); --gamut-hdr-2: color(xyz-d65 ${(r() * 20).toFixed(3)} ${(r() * 20).toFixed(3)} ${(r() * 20).toFixed(3)}); --gamut-headroom: ${(r() * 2).toFixed(3)}`, '--gamut-out'],
};
const [cls, gen, prop, parent = '', child = false] = PARTS[part];
await benchLock();
// STYLO_THREADS=1: Firefox styles on one thread (layout.css.stylo-threads), as Chrome and WebKit do; by default it styles
// many elements in parallel, so its time over N is wall time, not one element's cost
for (const e of pick(['Chrome', 'WebKit', 'Firefox'])) { const { browser, page } = await open(e, e[0] === 'Firefox' && process.env.STYLO_THREADS ? { firefoxUserPrefs: { 'layout.css.stylo-threads': +process.env.STYLO_THREADS } } : {}), row = [];
  for (const path of [a, b]) {
    await page.setContent(`<style>${readFileSync(path, 'utf8')}</style><div style="${parent}">${`<i class="${gamut(cls)}">${child ? '<b></b>' : ''}</i>`.repeat(N)}</div>`, { timeout: 300000 });
    const ms = await page.evaluate(async ([gen, prop, child]) => { const f = new Function('r', `return \`${gen}\``), els = [...document.querySelectorAll('i')], out = []; let s = 5;
      const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let t = 0; t < 24; t++) { await new Promise(requestAnimationFrame); const v = els.map(() => f(r));
        const t0 = performance.now(); els.forEach((x, i) => x.setAttribute('style', v[i])); els.forEach((x) => getComputedStyle(child ? x.firstElementChild : x).getPropertyValue(prop)); if (t >= 4) out.push(performance.now() - t0); }
      out.sort((x, y) => x - y); const m = out.slice(2, -2); return m.reduce((x, y) => x + y, 0) / m.length; }, [gen.toString().replace(/^\(r\) => `|`$/g, ''), prop, child]);
    row.push(`${(ms * 1000 / N).toFixed(0)} µs`);
  }
  console.log(`${e[0]} ${part}: ${row.join(' -> ')}`); await browser.close(); }
