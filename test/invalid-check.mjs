// Checks what SPEC.md's FL5 says a part gives for an input it can't read (`foo`, `10px`, `#zzz`), in Chrome, WebKit and Firefox:
// one case an input, under a parent whose --gamut-out and --gamut-text are teal. Each gives the parent's output, a
// transparent one, or exactly what the same part gives with that input's default in its place (a number its table's
// default, a background or seed black, a tone 0), the computed values compared as strings. And each input set to a
// CSS-wide keyword (initial, unset, inherit with nothing to inherit, revert, revert-layer) gives what the same element
// gives with that declaration left out, each first in a list of its own (a part may read its position).
// Usage: node test/invalid-check.mjs   (SHEET= for another sheet, ENGINES= to pick)
import { readFileSync } from 'node:fs';
import { pick, open } from './engines.mjs';
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const P = 'parent', T = 'transparent';
// [part, its inputs with one unreadable, what it gives: P, T, or the inputs whose output it is]
const CASES = [
  ['fit-screen', '--gamut-in: foo', P],
  ['screen-edge', '--gamut-in: foo', P],
  ['screen-edge', '--gamut-in: red; --gamut-rel: foo', '--gamut-in: red; --gamut-rel: 1'],
  ['palette-step', '--gamut-in: foo; --gamut-tone: 40', '--gamut-in: black; --gamut-tone: 40'],
  ['palette-step', '--gamut-in: red; --gamut-tone: foo', '--gamut-in: red; --gamut-tone: 0'],
  ['color-mix', '--gamut-mix-1: foo; --gamut-mix-2: blue', P],
  ['color-mix', '--gamut-mix-1: red; --gamut-mix-2: blue; --gamut-mix-pct-1: foo', P],
  ['color-layers', '--gamut-layer-1: foo; --gamut-layer-2: blue', T],
  // an unreadable layer under a readable one counts as transparent: the stack is the readable one's (a review, 2026-10-30)
  ['color-layers', '--gamut-layer-1: red; --gamut-layer-2: foo', '--gamut-layer-1: red; --gamut-layer-2: transparent'],
  // in the middle, it ends the stack there: the layers below it go too (a review, 2026-10-30)
  ['color-layers', '--gamut-layer-1: rgb(255 0 0 / 0.5); --gamut-layer-2: foo; --gamut-layer-3: green', '--gamut-layer-1: rgb(255 0 0 / 0.5)'],
  ['color-interpolate', '--gamut-stops: 2; --gamut-stop-1: foo; --gamut-stop-2: blue; --gamut-at-1: 0; --gamut-at-2: 1; --gamut-t: 0.5', T],
  ['color-interpolate', '--gamut-stops: 2; --gamut-stop-1: red; --gamut-stop-2: blue; --gamut-at-1: 0; --gamut-at-2: 1; --gamut-t: foo', T],
  ['color-interpolate', '--gamut-space: foo; --gamut-stops: 2; --gamut-stop-1: red; --gamut-stop-2: blue; --gamut-at-1: 0; --gamut-at-2: 1; --gamut-t: 0.5', P],
  ['color-interpolate', '--gamut-stops: 2; --gamut-stop-1: red; --gamut-stop-2: blue; --gamut-at-1: 0; --gamut-at-2: foo; --gamut-t: 0.5', T],
  ['alpha', '--gamut-in: foo; --gamut-alpha-value: 0.5', P],
  ['alpha', '--gamut-in: red; --gamut-alpha-value: foo', P],
  ['light-dark', '--gamut-light: foo; --gamut-dark: blue', T],
  ['okhsl', '--gamut-okhsl-h: foo; --gamut-okhsl-s: 0.5; --gamut-okhsl-l: 0.5', '--gamut-okhsl-h: 0; --gamut-okhsl-s: 0.5; --gamut-okhsl-l: 0.5'],
  ['okhsl-from', '--gamut-in: foo', P],
  ['okhsv', '--gamut-okhsv-h: 30; --gamut-okhsv-s: foo; --gamut-okhsv-v: 0.5', '--gamut-okhsv-h: 30; --gamut-okhsv-s: 0; --gamut-okhsv-v: 0.5'],
  ['device-cmyk', '--gamut-cmyk-c: foo; --gamut-cmyk-m: 0.2; --gamut-cmyk-y: 0.2; --gamut-cmyk-k: 0.2', P],
  ...['pq', 'hlg', 'linear'].map((s) => [`rec2100-${s}`, '--gamut-rec2100-r: foo; --gamut-rec2100-g: 0.4; --gamut-rec2100-b: 0.3', T]),
  ['jzazbz', '--gamut-jzazbz-jz: foo; --gamut-jzazbz-az: 0.01; --gamut-jzazbz-bz: 0', '--gamut-jzazbz-jz: 0; --gamut-jzazbz-az: 0.01; --gamut-jzazbz-bz: 0'],
  ['jzczhz', '--gamut-jzczhz-jz: 0.1; --gamut-jzczhz-cz: foo; --gamut-jzczhz-hz: 30', '--gamut-jzczhz-jz: 0.1; --gamut-jzczhz-cz: 0; --gamut-jzczhz-hz: 30'],
  ['ictcp', '--gamut-ictcp-i: foo; --gamut-ictcp-ct: 0.05; --gamut-ictcp-cp: 0', '--gamut-ictcp-i: 0; --gamut-ictcp-ct: 0.05; --gamut-ictcp-cp: 0'],
  ['hdr-color', '--gamut-hdr-1: foo; --gamut-hdr-2: blue; --gamut-headroom: 1', P],
  ['hdr-color', '--gamut-hdr-1: red; --gamut-hdr-2: blue; --gamut-headroom: foo', '--gamut-hdr-1: red; --gamut-hdr-2: blue; --gamut-headroom: 0'],
  // a color's own headroom: the first color, not the input's default
  ['hdr-color', '--gamut-hdr-1: red; --gamut-hdr-2: white; --gamut-hdr-h1: foo; --gamut-hdr-h2: 1; --gamut-headroom: 1', '--gamut-hdr-1: red; --gamut-hdr-2: white; --gamut-hdr-h1: 0; --gamut-hdr-h2: 1; --gamut-headroom: 0'],
  ['hdr-color', '--gamut-hdr-1: red; --gamut-hdr-2: white; --gamut-hdr-h1: 0; --gamut-hdr-h2: foo; --gamut-headroom: 0.5', '--gamut-hdr-1: red; --gamut-hdr-2: white; --gamut-hdr-h1: 0; --gamut-hdr-h2: 1; --gamut-headroom: 0'],
  ['readable-text', '--gamut-bg: foo', '--gamut-bg: black'],
  ['contrast-color', '--gamut-bg: foo; --gamut-try-1: red', '--gamut-bg: black; --gamut-try-1: red'],
];
// each case with three unreadable values: a word, a length and a broken hex, which must give the same
const VALUES = ['foo', '10px', '#zzz'];
const ALL = CASES.flatMap(([p, bad, want]) => VALUES.map((x) => [p, bad.replace(/\bfoo\b/, x), want, x]));
const out = (part) => (/readable-text|contrast-color/.test(part) ? '--gamut-text' : '--gamut-out');
const KW = ['initial', 'unset', 'inherit', 'revert', 'revert-layer'];
const KEYED = CASES.flatMap(([p, bad]) => KW.map((k) => [p, bad.replace(/\bfoo\b/, k), bad.split('; ').filter((d) => !/\bfoo\b/.test(d)).join('; ')]));
const html = `<div style="--gamut-out: teal; --gamut-text: teal"><b></b>${ALL.map(([p, bad, want]) => `<i class="gamut-${p}" style="${bad}"></i><i class="gamut-${p}" style="${want === P || want === T ? bad : want}"></i>`).join('')}${KEYED.map(([p, a, b]) => `<ul><li class="gamut-${p}" style="${a}"></li></ul><ul><li class="gamut-${p}" style="${b}"></li></ul>`).join('')}</div>`;
let fail = 0;
for (const e of pick(['Chrome', 'WebKit', 'Firefox'])) { const { browser, page } = await open(e);
  await page.setContent(`<style>${css}</style>${html}`);
  const v = await page.evaluate(([props, kprops]) => { const els = [...document.querySelectorAll('i')], b = getComputedStyle(document.querySelector('b'));
    return { parent: [b.getPropertyValue('--gamut-out').trim(), b.getPropertyValue('--gamut-text').trim()], got: els.map((x, i) => getComputedStyle(x).getPropertyValue(props[i >> 1]).trim()),
      keyed: [...document.querySelectorAll('li')].map((x, i) => getComputedStyle(x).getPropertyValue(kprops[i >> 1]).trim()) }; }, [ALL.map(([p]) => out(p)), KEYED.map(([p]) => out(p))]);
  await browser.close();
  const bad = ALL.flatMap(([p, s, want, x], k) => { const got = v.got[2 * k], ref = v.got[2 * k + 1];
    const clear = (x) => /^(transparent|rgba\(0, 0, 0, 0\))$|\/ 0\)$/.test(x), parent = v.parent[out(p) === '--gamut-text' ? 1 : 0];
    // the default's own output must be one the part computed: neither the parent's nor transparent
    const ok = want === P ? got === parent : want === T ? clear(got) : got === ref && ref !== parent && !clear(ref);
    return ok ? [] : [`.gamut-${p} {${s.split('; ').find((d) => d.includes(x))}}: ${got}, want ${want === P ? `the parent's ${v.parent[0]}` : want === T ? 'transparent' : `${ref} (${want})`}`]; });
  if (bad.length) fail++;
  console.log(`${bad.length ? 'FAIL' : 'PASS'} ${e[0]}: ${ALL.length - bad.length} of ${ALL.length} unreadable inputs (${CASES.length}, each as ${VALUES.join(', ')}) give what FL5 says${bad.length ? `\n  ${bad.join('\n  ')}` : ''}`);
  const kbad = KEYED.map(([p, a], k) => (v.keyed[2 * k] === v.keyed[2 * k + 1] ? null : `.gamut-${p} {${a}}: ${v.keyed[2 * k]}, left out ${v.keyed[2 * k + 1]}`)).filter(Boolean);
  if (kbad.length) fail++;
  console.log(`${kbad.length ? 'FAIL' : 'PASS'} ${e[0]}: ${KEYED.length - kbad.length} of ${KEYED.length} inputs set to a CSS-wide keyword (${KW.join(', ')}) give what the input left out gives${kbad.length ? `\n  ${kbad.join('\n  ')}` : ''}`); }
process.exit(fail ? 1 : 0);
