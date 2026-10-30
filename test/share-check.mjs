// Checks SPEC.md's FL4 on sharing an element, in Chrome, WebKit and Firefox: every pair of parts that write different
// outputs, on one element, gives each part's outputs exactly as it gives them alone (the same inputs, the computed values
// compared as strings), two input sets a pair, under each target and method an ancestor can set; and a text part
// (.gamut-readable-text, .gamut-contrast-color) reading --gamut-out on the element that writes it gives the text color it
// gives on a child. Parts that write the same output overwrite each other there and aren't paired: one's --gamut-out,
// copied beside it (`--c: var(--gamut-out)`) and read by .gamut-alpha on a child (`--gamut-in: var(--c)`), gives what
// .gamut-alpha gives that color written out (README.md, Classes and functions). A part inside another of its kind takes
// the inputs it doesn't set from it (they inherit), and gives what it gives alone once those are set to `initial`.
// Usage: node test/share-check.mjs   (SHEET= for another sheet, ENGINES= to pick)
import { readFileSync } from 'node:fs';
import { pick, open } from './engines.mjs';
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
const W = {
  'fit-screen': ['--gamut-in: oklch(0.7 0.3 150)', '--gamut-in: oklch(0.4 0.25 300)'],
  'screen-edge': ['--gamut-in: oklch(0.6 0.2 30); --gamut-rel: 0.8', '--gamut-in: oklch(0.8 0.1 200); --gamut-rel: 0.5'],
  'palette-step': ['--gamut-in: #6750a4; --gamut-tone: 40', '--gamut-in: oklch(0.7 0.2 80); --gamut-tone: 90'],
  'color-layers': ['--gamut-layer-1: oklch(0.5 0.2 30 / 0.5); --gamut-layer-2: rgb(10 200 100)', '--gamut-layer-1: rgb(255 0 0 / 0.3); --gamut-layer-2: navy'],
  'color-interpolate': ['--gamut-stops: 2; --gamut-stop-1: red; --gamut-stop-2: blue; --gamut-at-1: 0; --gamut-at-2: 1; --gamut-t: 0.3', '--gamut-stops: 3; --gamut-stop-1: oklch(0.8 0.1 90); --gamut-stop-2: teal; --gamut-stop-3: black; --gamut-at-1: 0; --gamut-at-2: 0.5; --gamut-at-3: 1; --gamut-t: 0.7'],
  'color-mix': ['--gamut-mix-1: red; --gamut-mix-2: blue; --gamut-mix-pct-1: 30', '--gamut-mix-count: 3; --gamut-mix-1: oklch(0.6 0.2 30); --gamut-mix-2: rgb(20 120 220); --gamut-mix-3: gold'],
  alpha: ['--gamut-in: oklch(0.6 0.2 30); --gamut-alpha-value: 0.5', '--gamut-in: rgb(10 200 100); --gamut-alpha-value: 20%'],
  'light-dark': ['color-scheme: dark; --gamut-light: wheat; --gamut-dark: #223', 'color-scheme: light; --gamut-light: oklch(0.9 0.05 90); --gamut-dark: oklch(0.2 0.05 260)'],
  okhsl: ['--gamut-okhsl-h: 30; --gamut-okhsl-s: 0.8; --gamut-okhsl-l: 0.6', '--gamut-okhsl-h: 250; --gamut-okhsl-s: 0.4; --gamut-okhsl-l: 0.3'],
  'okhsl-from': ['--gamut-in: oklch(0.6 0.2 30); --gamut-okhsl-s: 0.5', '--gamut-in: #3399ff; --gamut-okhsl-l: 0.3'],
  okhsv: ['--gamut-okhsv-h: 30; --gamut-okhsv-s: 0.8; --gamut-okhsv-v: 0.6', '--gamut-okhsv-h: 140; --gamut-okhsv-s: 0.3; --gamut-okhsv-v: 0.9'],
  'device-cmyk': ['--gamut-cmyk-c: 0.1; --gamut-cmyk-m: 0.7; --gamut-cmyk-y: 0.2; --gamut-cmyk-k: 0.1', '--gamut-cmyk-c: 0.8; --gamut-cmyk-m: 0.1; --gamut-cmyk-y: 0.5; --gamut-cmyk-k: 0.3'],
  jzazbz: ['--gamut-jzazbz-jz: 0.1; --gamut-jzazbz-az: 0.02; --gamut-jzazbz-bz: -0.01', '--gamut-jzazbz-jz: 0.15; --gamut-jzazbz-az: -0.03; --gamut-jzazbz-bz: 0.04'],
  jzczhz: ['--gamut-jzczhz-jz: 0.1; --gamut-jzczhz-cz: 0.05; --gamut-jzczhz-hz: 30', '--gamut-jzczhz-jz: 0.15; --gamut-jzczhz-cz: 0.08; --gamut-jzczhz-hz: 230'],
  ictcp: ['--gamut-ictcp-i: 0.4; --gamut-ictcp-ct: 0.05; --gamut-ictcp-cp: -0.02', '--gamut-ictcp-i: 0.6; --gamut-ictcp-ct: -0.1; --gamut-ictcp-cp: 0.1'],
  'rec2100-pq': ['--gamut-rec2100-r: 0.5; --gamut-rec2100-g: 0.4; --gamut-rec2100-b: 0.3', '--gamut-rec2100-r: 0.2; --gamut-rec2100-g: 0.6; --gamut-rec2100-b: 0.5'],
  'rec2100-hlg': ['--gamut-rec2100-r: 0.5; --gamut-rec2100-g: 0.4; --gamut-rec2100-b: 0.3', '--gamut-rec2100-r: 0.8; --gamut-rec2100-g: 0.6; --gamut-rec2100-b: 0.2'],
  'rec2100-linear': ['--gamut-rec2100-r: 0.5; --gamut-rec2100-g: 0.4; --gamut-rec2100-b: 0.3', '--gamut-rec2100-r: 2; --gamut-rec2100-g: 0.6; --gamut-rec2100-b: 0.1'],
  'hdr-color': ['--gamut-hdr-1: oklch(0.6 0.15 30); --gamut-hdr-2: color(xyz-d65 3 3 3); --gamut-headroom: 1', '--gamut-hdr-1: teal; --gamut-hdr-2: color(xyz-d65 8 7 9); --gamut-headroom: 0.5'],
};
const O = {   // parts with another output, and how to read it
  'readable-text': [['--gamut-bg: #3399ff', '--gamut-bg: oklch(0.85 0.1 90); --gamut-ratio: 7'], ['--gamut-text']],
  'contrast-color': [['--gamut-bg: wheat; --gamut-try-1: sienna', '--gamut-bg: #767676; --gamut-try-1: #1a1a2e; --gamut-try-2: #f5f5ff; --gamut-contrast-ratio: 4.5'], ['--gamut-text']],
  'fit-gradient': [['--gamut-gradient-from: oklch(0.5 0.16 0); --gamut-gradient-to: oklch(0.5 0.16 180)', '--gamut-gradient-from: oklch(0.8 0.3 140); --gamut-gradient-to: oklch(0.3 0.3 300); --gamut-gradient-ease: ease-in'], ['--gamut-gradient-stops', '--gamut-gradient-space']],
  'color-equal': [['--gamut-equal-a: red; --gamut-equal-b: rgb(255 0 0)', '--gamut-equal-a: oklch(0.6 0.2 30); --gamut-equal-b: blue'], ['child:--gamut-equal']],
  'color-extract': [['--gamut-in: oklch(0.6 0.2 30)', '--gamut-in: #3399ff'], ['child:--gamut-x', 'child:--gamut-y', 'child:--gamut-z', 'child:--gamut-alpha', 'child:--gamut-oklch-l']],
};
const group = (n) => (W[n] ? 'out' : O[n][1][0]);
const cases = [];   // {html, reads: [[sel, prop, againstSel, againstProp]]}
// an eased gradient takes .gradient-ease beside .fit-gradient (its animation is opt-in)
let id = 0; const el = (cls, style, kids = '<i></i>') => { const i = id++, c = cls.split(' ');
  if (c.includes('fit-gradient') && style.includes('--gamut-gradient-ease')) c.push('gradient-ease');
  return [`<div id=e${i} class="${c.map((x) => `gamut-${x}`).join(' ')}" style="${style}">${kids}</div>`, i]; };
const all = { ...Object.fromEntries(Object.entries(W).map(([k, v]) => [k, [v, ['--gamut-out']]])), ...O };
const names = Object.keys(all);
let html = ''; const pairs = [], chains = [], copies = [], nested = [];
const CTX = ['', ...['display-p3', 'rec2020', 'a98-rgb', 'prophoto-rgb'].map((g) => `--gamut-target: ${g}`), ...['ray-trace', 'edge-seeker', 'adaptive'].flatMap((m) => [`--gamut-method: ${m}`, `--gamut-method: ${m}; --gamut-target: rec2020`])];
for (const ctx of CTX) {
html += `<section style="${ctx}">`;
for (const [ai, a] of names.entries()) for (const b of names.slice(ai + 1)) { if (group(a) === group(b)) continue;
  for (let k = 0; k < 2; k++) { const style = `${all[a][0][k]}; ${all[b][0][k]}`;
    const kid = [a, b].includes('color-extract') ? '<i class="gamut-color-extract-read gamut-extract-oklch"></i>' : undefined;
    const [h1, i1] = el(a, style, kid), [h2, i2] = el(b, style, kid), [h3, i3] = el(`${a} ${b}`, style, kid); html += h1 + h2 + h3;
    pairs.push({ ctx, a, b, k, alone: { [a]: i1, [b]: i2 }, both: i3 }); } }
// a text part reading a writer's --gamut-out: on the same element, and on a child
for (const w of Object.keys(W)) for (const t of ['readable-text', 'contrast-color']) for (let k = 0; k < 2; k++) {
  const tin = t === 'readable-text' ? '--gamut-bg: var(--gamut-out)' : '--gamut-bg: var(--gamut-out); --gamut-try-1: #1a1a2e; --gamut-try-2: #f5f5ff; --gamut-contrast-ratio: 4.5';
  const [h1, i1] = el(`${w} ${t}`, `${W[w][k]}; ${tin}`);
  const ic = id++; const [h2, i2] = el(w, W[w][k], `<p id=e${ic} class="gamut-${t}" style="${tin}"></p>`); html += h1 + h2;
  chains.push({ ctx, w, t, k, same: i1, child: ic }); }
for (const w of Object.keys(W)) for (let k = 0; k < 2; k++) {
  const ic = id++; const [h1, i1] = el(w, `${W[w][k]}; --c: var(--gamut-out)`, `<p id=e${ic} class="gamut-alpha" style="--gamut-in: var(--c); --gamut-alpha-value: 0.5"></p>`);
  const [h2, i2] = el('alpha', '--gamut-alpha-value: 0.5', ''); html += h1 + h2;
  copies.push({ ctx, w, k, writer: i1, child: ic, written: i2 }); }
for (const w of ['color-layers', 'color-mix']) for (let k = 0; k < 2; k++) {
  const outer = w === 'color-layers' ? '--gamut-layer-1: rgb(255 0 0 / 0.4); --gamut-layer-2: gold; --gamut-layer-3: navy' : '--gamut-mix-count: 3; --gamut-mix-1: red; --gamut-mix-2: blue; --gamut-mix-3: gold; --gamut-mix-pct-1: 20';
  const names = (st) => st.split(';').map((d) => d.split(':')[0].trim()), unset = names(outer).filter((n) => !names(W[w][k]).includes(n)).map((n) => `${n}: initial`).join('; ');
  const ic = id++, ik = id++; const [h1] = el(w, outer, `<p id=e${ic} class="gamut-${w}${w === 'color-layers' ? ' gamut-blend-multiply' : ''}" style="${W[w][k]}"></p><p id=e${ik} class="gamut-${w}${w === 'color-layers' ? ' gamut-blend-multiply' : ''}" style="${W[w][k]}; ${unset}"></p>`);
  const [h2, i2] = el(`${w}${w === 'color-layers' ? ' blend-multiply' : ''}`, W[w][k], ''); html += h1 + h2;
  nested.push({ ctx, w, k, kept: ic, unset: ik, alone: i2 }); }
html += '</section>'; }
let failed = false;
for (const e of pick(['Chrome', 'WebKit', 'Firefox'])) { const { browser, page: p } = await open(e); await p.setContent(`<style>${css}</style>${html}`);
  const r = await p.evaluate(({ pairs, chains, copies, nested, all }) => { const read = (i, prop) => { let n = document.getElementById(`e${i}`); if (prop.startsWith('child:')) { n = n.firstElementChild; prop = prop.slice(6); } return getComputedStyle(n).getPropertyValue(prop).trim(); };
    const bad = [], seen = new Set(); let n = 0;
    for (const { ctx, a, b, k, alone, both } of pairs) for (const x of [a, b]) for (const prop of all[x][1]) { n++; const v1 = read(alone[x], prop), v2 = read(both, prop);
      if (v1 !== v2) bad.push(`[${ctx}] ${a} + ${b} #${k}: ${x}'s ${prop} ${v1 || '(empty)'} alone, ${v2 || '(empty)'} shared`); if (!v1 || /^(transparent|rgba\(0, 0, 0, 0\))$|\/ 0\)$/.test(v1)) seen.add(`${x} ${prop} #${k}: ${v1 || 'empty'} alone`); }
    const badC = []; for (const { ctx, w, t, k, same, child } of chains) { const v1 = read(child, '--gamut-text'), v2 = read(same, '--gamut-text'), out = read(same, '--gamut-out');
      if (v1 !== v2) badC.push(`[${ctx}] ${w} -> ${t} #${k}: ${v1} on a child, ${v2} on the same element (out ${out})`); }
    for (const { ctx, w, k, writer, child, written } of copies) { const out = read(writer, '--gamut-out'); document.getElementById(`e${written}`).style.setProperty('--gamut-in', out);
      const v1 = read(child, '--gamut-out'), v2 = read(written, '--gamut-out'); if (v1 !== v2 || !v1) badC.push(`[${ctx}] ${w} #${k} copied to --c, then .gamut-alpha on a child: ${v1 || '(empty)'}, written out ${v2 || '(empty)'} (out ${out})`); }
    for (const { ctx, w, k, kept, unset, alone } of nested) { const v0 = read(alone, '--gamut-out'), v1 = read(kept, '--gamut-out'), v2 = read(unset, '--gamut-out');
      if (v2 !== v0) badC.push(`[${ctx}] ${w} #${k} inside another, its inputs unset with initial: ${v2}, alone ${v0}`);
      if (v1 === v0) badC.push(`[${ctx}] ${w} #${k} inside another took none of its inputs: ${v1}, as alone`); }
    return { n, bad, badC, seen: [...seen], chains: chains.length, copies: copies.length + nested.length }; }, { pairs, chains, copies, nested, all });
  console.log(`${r.bad.length + r.badC.length ? 'FAIL ' : ''}${e[0]}: ${r.n - r.bad.length} of ${r.n} outputs the same shared as alone; ${r.chains + r.copies - r.badC.length} of ${r.chains + r.copies} read by another part (a text part on the element and on a child; .gamut-alpha on a child, through a copy; a part inside its kind, with initial) as it reads the color itself`);
  for (const l of [...r.bad, ...r.badC].slice(0, 30)) console.log('  ' + l);
  if (r.seen.length) { console.log(`  FAIL no output alone, so nothing to compare: ${r.seen.join(' | ')}`); failed = true; }
  failed ||= r.bad.length + r.badC.length > 0; await browser.close(); }
process.exit(failed ? 1 : 0);
