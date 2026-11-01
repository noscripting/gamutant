// The part files (parts/<part>.css, written by parts.mjs) against gamutant.css, so a part can never drift from the whole:
// 1. text: every rule, registration, keyframes and @function in a part file is the whole sheet's own text, under the
//    same @supports / @container; every rule of the whole that names the part's classes is in its file; every
//    registered name a file reads or sets is registered in it; every function a file calls is defined in it.
// 2. order: every part file on one page, in order, reversed, each twice, and beside the whole sheet, gives the whole
//    sheet's colors on one element of each part, in Chrome, WebKit and Firefox.
// Exits 1 on a fail. Usage: node test/parts-check.mjs [text|order]   (ENGINES= narrows 2)
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { pick, open } from './engines.mjs';
import { PARTS } from '../build/parts.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), dir = path.join(here, '../parts');
const postcss = createRequire(import.meta.url)('postcss');
const whole = readFileSync(path.join(here, '../gamutant.css'), 'utf8');
const files = Object.fromEntries(Object.keys(PARTS).map((p) => [p, readFileSync(path.join(dir, `${p}.css`), 'utf8')]));
const want = process.argv[2];
let fails = 0; const say = (ok, line) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${line}`); };

// 1. text
const extra = readdirSync(dir).filter((f) => f.endsWith('.css') && !(f.slice(0, -4) in PARTS));
if (!want || want === 'text') {
  say(!extra.length, `parts/ holds the ${Object.keys(PARTS).length} part files and nothing else${extra.length ? `: ${extra.join(', ')}` : ''}`);
  // the banner's version is package.json's: on 2026-10-31 all 24 still said 1.0.0, written before 0.0.1 and never rewritten
  const { version } = JSON.parse(readFileSync(path.join(here, '../package.json'), 'utf8'));
  const stale = Object.entries(files).filter(([p, css]) => !css.startsWith(`/*! gamutant.css ${version}, ${p}.css:`)).map(([p]) => p);
  say(!stale.length, `every part file's first line names version ${version}, package.json's${stale.length ? `; not ${stale.length}: ${stale.slice(0, 5).join(', ')} (run node parts.mjs)` : ''}`);
  // each leaf (a rule, @property, @keyframes, @function) as its text and the at-rules around it
  const leaves = (css) => { const out = []; postcss.parse(css).walk((n) => {
    if (n.type === 'decl' || n.type === 'comment' || (n.type === 'atrule' && !['property', 'keyframes', 'function'].includes(n.name) && n.nodes)) return;
    if (n.parent.type === 'atrule' && ['keyframes', 'function'].includes(n.parent.name)) return;
    if (n.type === 'rule' && n.parent.type === 'rule') return;
    const at = []; for (let p = n.parent; p && p.type !== 'root'; p = p.parent) at.unshift(`@${p.name} ${p.params}`);
    // a rule as one piece a selector: the trimmer keeps a shared rule's list cut to the selectors that match
    const texts = n.type === 'rule' ? n.selectors.map((s) => `${s} {${n.nodes.map(String).join(';')}}`) : [n.toString()];
    for (const t of texts) out.push(`${at.join(' / ')} | ${t}`); }); return out; };
  const all = new Set(leaves(whole)), regs = (css) => new Set([...css.matchAll(/@property (--[\w-]+)/g)].map((m) => m[1]));
  const wholeRegs = regs(whole);
  for (const [part, css] of Object.entries(files)) {
    const mine = leaves(css), own = new Set(mine), classes = [part, ...PARTS[part]];
    const foreign = mine.filter((l) => !all.has(l));
    const named = [...all].filter((l) => !l.includes('@function') && classes.some((c) => new RegExp(`\\.gamut-${c}(?![\\w-])`).test(l.split(' | ')[1].split('{')[0])));
    const missing = named.filter((l) => !own.has(l));
    const body = postcss.parse(css), myRegs = regs(css); body.walkAtRules((a) => { if (a.name === 'property' || a.name === 'function') a.remove(); });
    const used = [...new Set([...body.toString().matchAll(/(--gamut[\w-]*)(?=\s*[:,)])/g)].map((m) => m[1]))].filter((n) => wholeRegs.has(n) && !myRegs.has(n));
    const defined = new Set([...css.matchAll(/@function (--[\w-]+)/g)].map((m) => m[1]));
    const called = [...new Set([...css.matchAll(/(--gamut[\w-]*)\(/g)].map((m) => m[1]))].filter((f) => !defined.has(f) && /@function/.test(whole) && whole.includes(`@function ${f}(`));
    const twice = mine.filter((l, i) => l.startsWith(' | @property') && mine.indexOf(l) !== i);
    say(!foreign.length && !missing.length && !used.length && !called.length && !twice.length,
      `${part}.css: ${mine.length} pieces, all the whole's own text; the ${named.length} rules naming .${part}${PARTS[part].length ? ` and its ${PARTS[part].length} modifiers` : ''} all in it${
        foreign.length ? `; not in the whole: ${foreign[0].slice(0, 120)}` : ''}${missing.length ? `; missing ${missing.length}: ${missing[0].slice(0, 120)}` : ''}${
        used.length ? `; reads unregistered ${used.slice(0, 5).join(' ')}` : ''}${called.length ? `; calls undefined ${called.slice(0, 5).join(' ')}` : ''}${twice.length ? '; a registration twice' : ''}`);
  }
}

// 2. order: one element of each part with inputs set, and fit-screen under every method and target
const CASES = {
  'fit-screen': '--gamut-in: oklch(0.75 0.4 60); background: var(--gamut-out)',
  'screen-edge': '--gamut-in: oklch(0.6 0.1 250); --gamut-rel: 0.8; background: var(--gamut-out)',
  'palette-step': '--gamut-in: oklch(0.6 0.2 150); --gamut-step: 300; background: var(--gamut-out)',
  'fit-gradient': '--gamut-gradient-from: oklch(0.7 0.35 30); --gamut-gradient-to: oklch(0.6 0.3 260); background: linear-gradient(var(--gamut-gradient-stops))',
  'readable-text': '--gamut-bg: wheat; --gamut-readable-from: tan; color: var(--gamut-text)',
  'contrast-color': '--gamut-bg: #fdf6e3; --gamut-try-1: #cb4b16; --gamut-try-2: #268bd2; color: var(--gamut-text)',
  'color-layers': '--gamut-layer-1: rgb(0 0 0 / 0.3); --gamut-layer-2: tomato; background: var(--gamut-out)',
  'color-interpolate': '--gamut-stop-1: red; --gamut-stop-2: blue; --gamut-at-1: 0; --gamut-at-2: 1; --gamut-t: 0.3; background: var(--gamut-out)',
  'color-mix': '--gamut-mix-1: red; --gamut-mix-2: blue; --gamut-mix-3: lime; background: var(--gamut-out)',
  alpha: '--gamut-in: red; --gamut-alpha-value: 0.5; background: var(--gamut-out)',
  'device-cmyk': '--gamut-cmyk-c: 0.1; --gamut-cmyk-m: 0.5; --gamut-cmyk-y: 0.9; --gamut-cmyk-k: 0.1; background: var(--gamut-out)',
  'light-dark': '--gamut-light: yellow; --gamut-dark: blue; background: var(--gamut-out)',
  'color-equal': '--gamut-equal-a: red; --gamut-equal-b: color(srgb-linear 0 0 1)',
  okhsl: '--gamut-okhsl-h: 145; --gamut-okhsl-s: 0.9; --gamut-okhsl-l: 0.7; background: var(--gamut-out)',
  'okhsl-from': '--gamut-in: oklch(0.6 0.15 30); --gamut-okhsl-l: 0.8; background: var(--gamut-out)',
  okhsv: '--gamut-okhsv-h: 200; --gamut-okhsv-s: 0.8; --gamut-okhsv-v: 0.9; background: var(--gamut-out)',
  jzazbz: '--gamut-jzazbz-jz: 0.1; --gamut-jzazbz-az: 0.01; --gamut-jzazbz-bz: -0.02; background: var(--gamut-out)',
  jzczhz: '--gamut-jzczhz-jz: 0.1; --gamut-jzczhz-cz: 0.02; --gamut-jzczhz-hz: 250; background: var(--gamut-out)',
  ictcp: '--gamut-ictcp-i: 0.4; --gamut-ictcp-ct: 0.02; --gamut-ictcp-cp: -0.03; background: var(--gamut-out)',
  'rec2100-pq': '--gamut-rec2100-r: 0.5; --gamut-rec2100-g: 0.4; --gamut-rec2100-b: 0.3; background: var(--gamut-out)',
  'rec2100-hlg': '--gamut-rec2100-r: 0.5; --gamut-rec2100-g: 0.4; --gamut-rec2100-b: 0.3; background: var(--gamut-out)',
  'rec2100-linear': '--gamut-rec2100-r: 0.5; --gamut-rec2100-g: 0.4; --gamut-rec2100-b: 0.3; background: var(--gamut-out)',
  'hdr-color': '--gamut-hdr-1: color(display-p3 1 1 0.33); --gamut-hdr-2: color(xyz-d65 18.6 21.5 7.8); --gamut-hdr-h1: 0.5; --gamut-hdr-h2: 4; --gamut-headroom: 2; background: var(--gamut-out)',
  'color-extract': '--gamut-in: oklch(0.7 0.1 250)',
};
const missingCase = Object.keys(PARTS).filter((p) => !CASES[p]);
if (missingCase.length) say(false, `order: no case for ${missingCase.join(', ')}`);
const element = (p) => p === 'color-equal' ? `<div class="gamut-color-equal" style="${CASES[p]}"><i style="display:block;opacity:calc(0.2 + 0.8 * var(--gamut-equal))"></i></div>`
  : p === 'color-extract' ? `<div class="gamut-color-extract" style="${CASES[p]}"><i class="gamut-color-extract-read gamut-extract-lch" style="display:block;background:lch(from red var(--gamut-lch-l) c h)"></i></div>`
  : `<i class="gamut-${p}" style="display:block;${CASES[p]}"></i>`;
const body = [...['css', 'adaptive', 'ray-trace', 'edge-seeker'].flatMap((m) => ['srgb', 'display-p3', 'rec2020'].map((t) =>
  `<div style="--gamut-method: ${m}; --gamut-target: ${t}">${element('fit-screen')}</div>`)), ...Object.keys(PARTS).map(element)].join('');
const read = () => [...document.querySelectorAll('body *')].map((e) => { const s = getComputedStyle(e); return `${s.backgroundColor} ${s.backgroundImage} ${s.color} ${s.opacity}`; });
if (!want || want === 'order') {
  const list = Object.keys(PARTS).map((p) => files[p]);
  const sets = { 'every part in order': list, 'every part reversed': [...list].reverse(), 'every part twice': [...list, ...list],
    'every part, then the whole': [...list, whole], 'the whole, then every part': [whole, ...list] };
  for (const e of pick(['Chrome', 'WebKit', 'Firefox'])) { const { browser, page } = await open(e), name = e[0] ?? e.name;
    const at = async (sheets) => { await page.setContent(`${sheets.map((s) => `<style>${s}</style>`).join('')}${body}`); return page.evaluate(read); };
    const ref = await at([whole]);
    for (const [label, sheets] of Object.entries(sets)) { const got = await at(sheets), diff = got.map((v, i) => [i, v]).filter(([i, v]) => v !== ref[i]);
      say(!diff.length, `${name} ${label}: ${got.length - diff.length} of ${got.length} elements as the whole sheet paints them${diff.length ? ` (element ${diff[0][0]}: ${diff[0][1]} for ${ref[diff[0][0]]})` : ''}`); }
    await browser.close(); }
}

console.log(fails ? `FAIL: ${fails}` : 'PASS'); process.exit(fails ? 1 : 0);
