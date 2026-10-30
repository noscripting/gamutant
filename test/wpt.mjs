// gamutant.css's tests, the WPT way: "Test passes if there is a filled green square and no red." Every test is a square
// painted red, with green over it only when gamutant.css's color matches the expected one written in the test (the
// WPT gamut-mapping tables, methods.mjs's gamut boundary, WCAG 2 contrast, Material's palettes (MCU's colors), Color.js, CSS Color
// 6's contrast-color() in JS). The
// match is worked out in CSS: one relative color takes the difference, the alpha clamp turns it into 1 or 0, and that
// is the green's alpha. Writes test/wpt/<name>.html, one reftest per test, each matching
// ref-filled-green-100px-square.html (WPT's own /css/reference/ref-filled-green-100px-square.xht, copied); the tests link
// the sheet as ../../gamutant.css, so another output folder sits two levels under a copy of it.
// Usage: node build.mjs && node test/wpt.mjs [folder=test/wpt] && node test/wpt-check.mjs [folder]
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { toLin, toLch, gam, clip01, inGamut, boundary, wpt, parse, lum8 } from './ref/methods.mjs';
import { winner, rgba } from './contrast-color-check.mjs';
import { layers } from './layers-check.mjs';
import { okhslToOklab, oklabToOkhsl, okhsvToOklab, setBranch, atCorner } from './ref/okhsl.mjs';
import { rec2100 } from './rec2100-check.mjs';
import { resolve } from './vendor/css-color/model.mjs';
import { serialize } from './vendor/css-color/read.mjs';
import { equivalent } from './ref/equal.mjs';
import { spectral } from './vendor/spectral.mjs';
import { edgeSeeker } from './vendor/edge-seeker.mjs';
import { gamut } from './ref/classes.mjs';
const r2 = createRequire(import.meta.url); const cjs = r2('colorjs.io'); const Color = cjs.default ?? cjs;

const WPT = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'wpt'));
const f6 = (x) => +x.toFixed(6), f3 = (x) => +x.toFixed(3), n3 = (i) => String(i).padStart(3, '0');
const enc = (lin) => lin.map((x) => gam(x)); // linear light to encoded channels (sRGB and Display P3 share the curve)
const ONE = 1.5 / 255, TWO = 2.5 / 255; // "within 1 (2) of 255": rounded bytes at most 1 (2) apart
// CSS Color 4's gamut mapping as Color.js 0.7.1 runs it ('css': binary search with local MINDE), encoded channels
const spec4 = (sp, lch) => new Color('oklch', lch).toGamut({ space: sp === 'p3' ? 'p3' : 'srgb', method: 'css' }).to(sp === 'p3' ? 'p3' : 'srgb').coords.map((x) => Math.min(1, Math.max(0, x)));
// the check: a color against expected channels in one relative color; alpha 1 when every channel is within tol
// and alpha against the expected one (a fourth channel, else 1): a transparent black is no opaque black
const near = (from, space, exp, tol) => `color(from ${from} ${space} 0 0 0 / calc(1 + 1000000 * (${f6(tol)} - max(${['r', 'g', 'b'].map((ch, i) =>
  `abs(clamp(0, ${ch}, 1) - ${f6(exp[i])})`).join(', ')}, abs(alpha - ${f6(exp[3] ?? 1)})))))`;
const lchText = ([l, c, h]) => `oklch(${l} ${c} ${h})`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// The square: red, and over it green (rgb(0 128 0), CSS's green) at the check's alpha; --ok is the check. A palette
// or a scale is a square of strips, one check each, on whole pixels so the strips meet without a seam.
const GREEN = 'linear-gradient(color(from var(--ok) srgb 0 0.501961 0 / alpha), color(from var(--ok) srgb 0 0.501961 0 / alpha)), red';
// --ok starts transparent, so a check that doesn't compute (an undefined var(), a part's output missing) paints red
const SHEET = `@property --ok { syntax: '<color>'; inherits: true; initial-value: transparent; }
.sq { display: block; width: 100px; height: 100px; margin: 0; padding: 0; list-style: none; background: ${GREEN}; }
.sq.strips { display: grid; background: none; }
.sq.strips > * { display: block; background: ${GREEN}; }
.sq.s11 { grid-template-columns: repeat(10, 9px) 10px; }
.sq.s9 { grid-template-columns: repeat(8, 11px) 12px; }`;

// --- the tests: { id, name, help, assert, html(), rules? } ----------------------------------------
const tests = [], C4 = 'https://drafts.csswg.org/css-color-4/#css-gamut-mapping';
const fit = (id, name, from, sp, exp, tol, assert, cls = 'fit-screen', method = '') => tests.push({ id, name, help: C4, assert,
  html: () => `<div style="--gamut-target: ${sp}${method ? `; --gamut-method: ${method}` : ''}"><div class="sq ${gamut(cls)}" style="--gamut-in: ${from}; --ok: ${near('var(--gamut-out)', sp, exp, tol)}"></div></div>` });
// (the WPT values are the mean of the spec's three methods, with room around them)
wpt.srgb.forEach(([s, want, tol], i) => fit(`fit-screen-wpt-srgb-${n3(i + 1)}`, s, lchText(parse(s)), 'srgb', want.map((x) => x / 255), (tol + 0.5) / 255,
  `${s} fitted to sRGB is within ${tol} of 255 of rgb(${want.join(' ')}), as WPT's canvas-srgb-gamut-mapping expects.`));
wpt.p3.forEach(([s, want, tol], i) => fit(`fit-screen-wpt-p3-${n3(i + 1)}`, s, lchText(parse(s)), 'display-p3', want.map((x) => x / 255), (tol + 0.5) / 255,
  `${s} fitted to Display P3 is within ${tol} of 255 of (${want.join(' ')}), as WPT's canvas-display-p3-gamut-mapping expects.`));
const FAR = [[0.75, 0.4, 60], [0.45, 0.3, 75], [0.92, 0.3, 255], [0.7, 0.4, 145], [0.6, 0.35, 30], [0.35, 0.3, 90], [0.5, 0.4, 330], [0.85, 0.4, 195]];
FAR.forEach((lch, i) => fit(`fit-screen-far-${n3(i + 1)}`, lchText(lch), lchText(lch), 'srgb', spec4('srgb', lch), TWO,
  `${lchText(lch)} fitted to sRGB by CSS Color 4's gamut mapping is within 2 of 255 of Color.js's answer.`));
let seed = 20261020; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
for (let n = 0; n < 24;) { const lch = [f3(0.05 + rnd() * 0.9), f3(rnd() * 0.4), f3(rnd() * 360)]; if (inGamut(toLin('srgb', lch))) continue; n++;
  fit(`fit-screen-random-${n3(n)}`, lchText(lch), lchText(lch), 'srgb', spec4('srgb', lch), TWO,
    `${lchText(lch)} fitted to sRGB by CSS Color 4's gamut mapping is within 2 of 255 of Color.js's answer.`); }
// --gamut-method: ray-trace and edge-seeker, CSS Color 4's other two mappers, against Color.js 0.7.1's Ray Trace and
// the spec's EdgeSeeker pseudocode (vendor/edge-seeker.mjs, its table at 400 hues a region), sRGB and Display P3
const ray = (sp, lch) => new Color('oklch', lch).toGamut({ space: sp === 'display-p3' ? 'p3' : 'srgb', method: 'raytrace' }).to(sp === 'display-p3' ? 'p3' : 'srgb').coords.map((x) => Math.min(1, Math.max(0, x)));
FAR.forEach((lch, i) => ['srgb', 'display-p3'].forEach((sp, j) => fit(`fit-screen-ray-trace-${n3(2 * i + j + 1)}`, lchText(lch), lchText(lch), sp, ray(sp, lch), ONE,
  `${lchText(lch)} fitted to ${sp === 'srgb' ? 'sRGB' : 'Display P3'} by CSS Color 4's Ray Trace is within 1 of 255 of Color.js's answer.`, 'fit-screen', 'ray-trace')));
FAR.forEach((lch, i) => ['srgb', 'display-p3'].forEach((sp, j) => fit(`fit-screen-edge-seeker-${n3(2 * i + j + 1)}`, lchText(lch), lchText(lch), sp,
  edgeSeeker(sp === 'srgb' ? 'srgb' : 'p3', lch).map((x) => clip01(gam(x))), ONE,
  `${lchText(lch)} fitted to ${sp === 'srgb' ? 'sRGB' : 'Display P3'} by CSS Color 4's EdgeSeeker is within 1 of 255 of the spec's pseudocode.`, 'fit-screen', 'edge-seeker')));
// .gamut-screen-edge: the gamut's edge at the color's own lightness and hue; to rec2020 too, compared in BT.2020's encoding,
// as the engines encode it
FAR.forEach((lch, i) => fit(`screen-edge-${n3(i + 1)}`, lchText(lch), lchText(lch), 'srgb', enc(boundary('srgb', lch)), ONE,
  `${lchText(lch)} taken to sRGB's edge at its own lightness and hue is within 1 of 255 of the edge.`, 'screen-edge'));
const bt2020 = (lin) => new Color('rec2020-linear', lin).to('--rec2020-oetf').coords;
FAR.forEach((lch, i) => fit(`screen-edge-rec2020-${n3(i + 1)}`, lchText([lch[0], lch[1] * 1.5, lch[2]]), lchText([lch[0], lch[1] * 1.5, lch[2]]), 'rec2020',
  bt2020(boundary('rec2020', [lch[0], lch[1] * 1.5, lch[2]])), ONE,
  `${lchText([lch[0], lch[1] * 1.5, lch[2]])} taken to rec2020's edge at its own lightness and hue is within 1 of 255 of the edge.`, 'screen-edge'));
[['#0000ff', 'pure blue'], ['#0000ee', 'link blue'], ['#00ff00', 'pure green'], ['#ff6600', 'orange'], ['#888888', 'grey'], ['#ffffff', 'white'], ['#000000', 'black']].forEach(([hex, name], i) =>
  fit(`fit-screen-in-gamut-${n3(i + 1)}`, `${hex}, ${name}`, hex, 'srgb', hex.slice(1).match(/../g).map((x) => parseInt(x, 16) / 255), ONE,
    `${hex} is inside sRGB, so fitting it to sRGB leaves it as it is.`));
// readable text: WCAG 2 contrast of the shade against its background, worked out from the computed colors
const Yof = (hex) => lum8(hex.slice(1).match(/../g).map((x) => parseInt(x, 16)));
[...['#ff6600', '#3399ff', '#ffd700', '#22aa55', '#cc3366', '#888888', '#f5f0e6', '#1a1a40', '#6a0dad', '#004d40', '#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#767676'].map((h) => [h, 4.5]),
  ...['#ff6600', '#3399ff', '#22aa55', '#767676'].map((h) => [h, 7]), ...['#cc3366', '#888888'].map((h) => [h, 3])].forEach(([hex, R], i) => {
  const Y = Yof(hex), dark = Y >= 0.179129, reach = dark ? (Y + 0.05) / 0.05 : 1.05 / (Y + 0.05), need = Math.min(R, reach) - 0.0005, Yt = '(0.2126 * r + 0.7152 * g + 0.0722 * b)';
  tests.push({ id: `readable-text-${n3(i + 1)}`, name: `${hex} at ${R}:1`, help: 'https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio',
    assert: reach >= R ? `The text shade of ${hex} has at least ${R}:1 contrast with it (WCAG 2).` : `${R}:1 is out of reach on ${hex}, so the text is ${dark ? 'black' : 'white'}, ${reach.toFixed(2)}:1.`,
    html: () => `<div class="sq gamut-readable-text" style="--gamut-bg: ${hex}; --gamut-ratio: ${R}; --ok: color(from var(--gamut-text) srgb-linear 0 0 0 / calc(1 + 1000000 * ((max(${Yt}, ${f6(Y)}) + 0.05) / (min(${Yt}, ${f6(Y)}) + 0.05) - ${f6(need)})))"></div>` });
});
// palettes: Material 3's tonal palettes, 11 steps as 11 strips (tones 95 to 10), each against material-color-utilities
// 0.4.0's 8-bit colors frozen in test/data/material-palettes.json; sRGB on any screen
const material = JSON.parse(readFileSync(new URL('./data/material-palettes.json', import.meta.url), 'utf8'));
['#ff0000', '#9d8ab1', '#dae150'].forEach((seed, i) => { const l = material.lists.find((x) => x.seed === seed && x.tones.length === 11), id = `palette-step-${n3(i + 1)}`;
  const rules = l.want.map((w, k) => `#${id} > li:nth-child(${k + 1}) { --ok: ${near('var(--gamut-out)', 'srgb', w.map((x) => x / 255), ONE)}; }`).join('\n');
  tests.push({ id, name: `${seed} Material palette`, help: 'https://m3.material.io/styles/color/system/how-the-system-works', rules,
    assert: `Each of the 11 tones from ${seed}${l.rel === 1 ? '' : ` at ${l.rel} of its chroma`} is within 1 of 255 of material-color-utilities 0.4.0's tonal palette.`,
    html: () => `<ol class="sq strips s11" id="${id}" style="--gamut-in: ${seed}; --gamut-chroma-scale: ${l.rel}">${`<li class="gamut-palette-step"></li>`.repeat(11)}</ol>` });
});
// scales: 9 values of t as 9 strips, each against Color.js mixing the same stops in the same space
const scaleOf = (stops, space, t) => { const n = stops.length, seg = Math.min(n - 2, Math.max(0, Math.floor(t * (n - 1)))), lt = Math.max(0, Math.min(1, t * (n - 1) - seg));
  return Color.mix(stops[seg], stops[seg + 1], lt, { space, outputSpace: 'srgb' }).coords; };
const TS = [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1];
[['oklab', ['#e11d48', '#f59e0b', '#16a34a']], ['oklch', ['#2563eb', '#db2777']], ['srgb-linear', ['#000000', '#7c3aed', '#facc15', '#ffffff']]].forEach(([space, stops], i) =>
  tests.push({ id: `color-interpolate-${n3(i + 1)}`, name: `${stops.join(' → ')} in ${space}`, help: 'https://drafts.csswg.org/css-values-5/#interpolate',
    assert: `A color picked between ${stops.join(', ')} in ${space}, at 9 values of t, is within 1 of 255 of Color.js's mix.`,
    html: () => `<div class="sq strips s9" style="--gamut-space: ${space}; --gamut-stops: ${stops.length}; ${stops.map((c, k) => `--gamut-stop-${k + 1}: ${c}; --gamut-at-${k + 1}: ${+(k / (stops.length - 1)).toFixed(6)}`).join('; ')}">${TS.map((t) =>
      `<i class="gamut-color-interpolate" style="--gamut-t: ${t}; --ok: ${near('var(--gamut-out)', 'srgb', scaleOf(stops, space, t), ONE)}"></i>`).join('')}</div>` }));

// contrast-color(): CSS Color 6's own examples (§2.1, §2.2.1), white or black alone, translucent colors; the winner by
// contrast-color-check.mjs's JS of §2, the check on channels and alpha
const near4 = (from, exp, tol) => `color(from ${from} srgb 0 0 0 / calc(1 + 1000000 * (${f6(tol)} - max(${['r', 'g', 'b', 'alpha'].map((ch, i) =>
  `abs(${ch === 'alpha' ? ch : `clamp(0, ${ch}, 1)`} - ${f6(exp[i])})`).join(', ')}))))`;
const SIX = ['bisque', 'darkgoldenrod', 'olive', 'sienna', 'darkgreen', 'maroon'];
[['wheat', SIX, 4.5], ['wheat', SIX, 5.8], ['wheat', SIX.slice(0, 3), 4.5], ['wheat', ['tan', 'sienna', '#b22222', '#d2691e']],
  ['hsl(200 50% 80%)', ['hsl(200 83% 23%)', 'purple', 'hsl(300 100% 25%)']], ['color(display-p3 0.38 0.11 0.05)', ['yellow'], 11],
  ['#767676', []], ['#777777', [], 21], ['navy', ['rgb(255 255 255 / 0.3)', 'rgb(255 255 0 / 0.9)'], 7], ['rgb(0 0 0 / 0.5)', ['#888888', 'white'], 4.5]].forEach(([bg, tries, target], i) => {
  const w = winner(bg, tries, target), exp = rgba(w);
  tests.push({ id: `contrast-color-${n3(i + 1)}`, name: `contrast-color(${bg}${target ? ` wcag2(${target})` : ''}${tries.map((c) => `, ${c}`).join('')})`,
    help: 'https://drafts.csswg.org/css-color-6/#colorcontrast',
    assert: `The winner is ${w}: ${target ? `the first candidate reaching ${target}:1, then white, then black` : 'the candidate that contrasts most'} (WCAG 2.1), within 1 of 255.`,
    html: () => `<div class="sq gamut-contrast-color" style="--gamut-bg: ${bg};${target ? ` --gamut-contrast-ratio: ${target};` : ''}${tries.map((c, k) => ` --gamut-try-${k + 1}: ${c};`).join('')} --ok: ${near4('var(--gamut-text)', exp, ONE)}"></div>` });
});

// color-layers(): stacks in sRGB, the expected color by layers-check.mjs's Compositing 1 in JS
[[['rgb(255 0 0 / 0.5)', 'rgb(0 0 255)'], 'normal'], [['rgb(255 255 0 / 0.5)', 'rgb(0 255 128 / 0.6)', 'rgb(255 0 0 / 0.4)'], 'normal'],
  [['rgb(255 255 255 / 0)', 'rgb(10 20 30)'], 'normal'], [['rgb(200 100 50)', 'rgb(100 150 200)'], 'multiply'],
  [['rgb(200 100 50 / 0.7)', 'rgb(100 150 200 / 0.8)'], 'screen'], [['rgb(30 200 120)', 'rgb(180 90 240 / 0.5)'], 'overlay'],
  [['rgb(90 160 220 / 0.6)', 'rgb(240 180 40)'], 'soft-light'], [['rgb(250 30 90)', 'rgb(40 200 160)'], 'difference']].forEach(([ls, mode], i) => {
  const exp = layers(ls, mode);
  tests.push({ id: `color-layers-${n3(i + 1)}`, name: `color-layers(${mode === 'normal' ? '' : `${mode}, `}${ls.join(', ')})`,
    help: 'https://drafts.csswg.org/css-color-6/#color-layers',
    assert: `The layers composited source-over${mode === 'normal' ? '' : ` with ${mode}`} (Compositing 1), the first on top, within 1 of 255.`,
    html: () => `<div class="sq gamut-color-layers${mode === 'normal' ? '' : ` gamut-blend-${mode}`}" style="${ls.map((c, k) => `--gamut-layer-${k + 1}: ${c}; `).join('')}--ok: ${near4('var(--gamut-out)', exp, ONE)}"></div>` });
});

// okhsl: ok_color.h's own corners (pure red, green and blue at s = 1) and points between, against okhsl.mjs. At the blue
// corner both of ok_color.h's branch tests hit 1 and the sheet's lands on the green branch (okhsl-check.mjs takes
// either): the reftest expects that branch's color
[[29.2339, 1, 0.5681], [142.4953, 1, 0.8445], [264.052, 1, 0.3666], [250.4331, 0.6171, 0.4204], [90, 0.5, 0.75], [200, 0.9, 0.3], [0, 0, 1], [0, 0, 0]].forEach(([h, s, l], i) => {
  const corner = atCorner(Math.cos(h * Math.PI / 180), Math.sin(h * Math.PI / 180));
  setBranch(corner ? 'green' : null); const exp = new Color('oklab', okhslToOklab(h, s, l)).to('srgb').coords; setBranch(null);
  tests.push({ id: `okhsl-${n3(i + 1)}`, name: `okhsl(${h} ${s} ${l})`, help: 'https://bottosson.github.io/posts/colorpicker/#hsl-2',
    assert: `okhsl(${h} ${s} ${l}) is within 1 of 255 of ok_color.h's okhsl_to_srgb${corner ? ' at the blue corner, on the branch the sheet takes there' : ''}.`,
    html: () => `<div class="sq gamut-okhsl" style="--gamut-okhsl-h: ${h}; --gamut-okhsl-s: ${s}; --gamut-okhsl-l: ${l}; --ok: ${near('var(--gamut-out)', 'srgb', exp, ONE)}"></div>` });
});

// okhsv: ok_color.h's corners at s = 1 and v = 1, and points between, against okhsl.mjs, the blue corner on the
// branch the sheet takes there, as okhsl's
[[29.2339, 1, 1], [142.4953, 1, 1], [264.052, 1, 1], [90, 0.5, 0.75], [200, 0.9, 0.3], [300, 0.3, 0.6], [0, 0, 1], [0, 1, 0]].forEach(([h, s, v], i) => {
  const corner = atCorner(Math.cos(h * Math.PI / 180), Math.sin(h * Math.PI / 180));
  setBranch(corner ? 'green' : null); const exp = new Color('oklab', okhsvToOklab(h, s, v)).to('srgb').coords; setBranch(null);
  tests.push({ id: `okhsv-${n3(i + 1)}`, name: `okhsv(${h} ${s} ${v})`, help: 'https://bottosson.github.io/posts/colorpicker/#hsv-2',
    assert: `okhsv(${h} ${s} ${v}) is within 1 of 255 of ok_color.h's okhsv_to_srgb${corner ? ' at the blue corner, on the branch the sheet takes there' : ''}.`,
    html: () => `<div class="sq gamut-okhsv" style="--gamut-okhsv-h: ${h}; --gamut-okhsv-s: ${s}; --gamut-okhsv-v: ${v}; --ok: ${near('var(--gamut-out)', 'srgb', exp, ONE)}"></div>` });
});

// alpha: CSS Color 5 §4.10's alpha() as the spec model computes it, painted (channels clamped, a missing alpha as 0)
[['red', '0.5'], ['oklch(0.7 0.15 30 / 0.4)', 'calc(alpha * 0.5)'], ['color(display-p3 0.2 0.6 0.3)', '80%'], ['#33669980', undefined],
  ['lab(50 20 -30)', 'none'], ['oklch(0.6 0.1 none)', '0.7'], ['hsl(200 60% 40%)', '1.5'], ['color(rec2020 0.3 0.5 0.4 / 0.5)', 'calc(alpha + 0.3)']].forEach(([o, a], i) => {
  // a rec2020 color painted as all three engines encode rec2020, by BT.2020's curve (Q28): this test is alpha()'s, and
  // Color.js 0.7.1's rec2020 is the draft's gamma 2.4 (its --rec2020-oetf is BT.2020's)
  const w = resolve(`alpha(from ${o}${a === undefined ? '' : ` / ${a}`})`), c = new Color(serialize({ ...w, c: w.c.map((v) => v ?? 0), alpha: 1 }).replace(/^color\(rec2020 /, 'color(--rec2020-oetf ')).to('srgb').coords;
  const exp = [...c.map((v) => Math.min(1, Math.max(0, v))), w.alpha ?? 0];
  tests.push({ id: `alpha-${n3(i + 1)}`, name: `alpha(from ${o}${a === undefined ? '' : ` / ${a}`})`, help: 'https://drafts.csswg.org/css-color-5/#relative-alpha',
    assert: `alpha(from ${o}${a === undefined ? '' : ` / ${a}`}) paints the origin's color with the alpha CSS Color 5 §4.10 gives, within 1 of 255.`,
    html: () => `<div class="sq gamut-alpha" style="--gamut-in: ${o};${a === undefined ? '' : ` --gamut-alpha-value: ${a};`} --ok: ${near4('var(--gamut-out)', exp, ONE)}"></div>` });
});

// light-dark: a token's two colors set on a surface of one color-scheme, picked on an element of another (#13836); the
// engine's own light-dark() of the same two colors on that element is the reference, written as the expected color
[['light', 'dark', 'yellow', 'blue'], ['dark', 'light', 'oklch(0.9 0.1 95)', 'oklch(0.3 0.12 265)'], ['light', 'only dark', '#336699', 'color(display-p3 0.9 0.4 0.1)'],
  ['dark', 'normal', 'lab(80 -20 30)', 'hsl(250 60% 25%)']].forEach(([root, own, l, d], i) => {
  const pick = own === 'light' || own === 'normal' ? l : d, exp = [...new Color(pick).to('srgb').coords.map((v) => Math.min(1, Math.max(0, v))), 1];
  tests.push({ id: `light-dark-${n3(i + 1)}`, name: `light-dark(${l}, ${d}) under color-scheme: ${own}`, help: 'https://github.com/w3c/csswg-drafts/issues/13836',
    assert: `A token of ${l} and ${d} set under color-scheme: ${root} gives ${pick} on an element with color-scheme: ${own}, as light-dark() written there does.`,
    html: () => `<div style="color-scheme: ${root}; --gamut-light: ${l}; --gamut-dark: ${d}"><div class="sq gamut-light-dark" style="color-scheme: ${own}; --ok: ${near4('var(--gamut-out)', exp, ONE)}"></div></div>` });
});

// color-equal: CSS Color 4 §12's examples, each pair 1 or 0 as the resolution of #13157 gives it (test/ref/equal.mjs),
// but the one the part can't read (a none hue at zero chroma); read on the part's child. A none in a color() space
// other than srgb is left out: Firefox doesn't carry it into srgb (QUIRKS.md Q37), test/small-parts-check.mjs counts it
[['red', 'rgb(255, 0, 0)'], ['red', 'color(srgb 1 0 0)'], ['#ff000080', 'rgb(255 0 0 / 50%)'], ['hsl(0 0% 50%)', 'hsl(200 0% 50%)'], ['white', 'hwb(120 100% 0%)'],
  ['oklch(50% 0 40)', 'oklch(50% 0 200)'], ['lch(50% 0.001 30)', 'lch(50% 0.001 200)'], ['lch(50% 30 0)', 'lch(50% 30 360)'], ['rgb(none 128 0)', 'rgb(0 128 0)'],
  ['red', 'color(srgb-linear 1 0 0)'], ['lab(50% 0 0)', 'oklab(0.5 0 0)'], ['color(srgb 0.2 none 0.5)', 'color(srgb 0.2 0 0.5)'], ['oklab(0.6 0.1 none)', 'oklab(0.6 0.1 none)']].forEach(([a, b], i) => {
  const e = equivalent(a, b) ? 1 : 0;
  tests.push({ id: `color-equal-${n3(i + 1)}`, name: `${a} and ${b}`, help: 'https://github.com/w3c/csswg-drafts/issues/13157',
    assert: `${a} and ${b} are ${e ? '' : 'not '}equivalent colors (CSS Color 4 §12), and --gamut-equal is ${e}.`,
    html: () => `<div class="gamut-color-equal" style="--gamut-equal-a: ${a}; --gamut-equal-b: ${b}"><i class="sq" style="--ok: color(srgb 0 0 0 / calc(1 - 1000000 * abs(var(--gamut-equal) - ${e})))"></i></div>` });
});

// okhsl-from: a color's own Okhsl with l or s replaced, against okhsl.mjs both ways (pure blue at its corner, a grey)
[['#ff3366', 0.9], ['#336699', undefined, 0.5], ['#0000ff', 0.3, 1], ['#808080', undefined, 0.5], ['#ffcc00', 0.4, 0.8], ['rgb(124 58 237 / 0.5)', 0.7]].forEach(([c, l, s], i) => {
  const col = new Color(c), [h, s0, l0] = oklabToOkhsl(...col.to('oklab').coords), exp = [...new Color('oklab', okhslToOklab(h, s ?? s0, l ?? l0)).to('srgb').coords, col.alpha];   // its alpha kept
  tests.push({ id: `okhsl-from-${n3(i + 1)}`, name: `okhsl(from ${c} h ${s ?? 's'} ${l ?? 'l'})`, help: 'https://github.com/w3c/csswg-drafts/issues/10110',
    assert: `${c} at its own Okhsl hue with ${l != null ? `l ${l}` : 'its own l'} and ${s != null ? `s ${s}` : 'its own s'} is within 1 of 255 of ok_color.h's conversions both ways.`,
    html: () => `<div class="sq gamut-okhsl-from" style="--gamut-in: ${c};${l != null ? ` --gamut-okhsl-l: ${l};` : ''}${s != null ? ` --gamut-okhsl-s: ${s};` : ''} --ok: ${near('var(--gamut-out)', 'srgb', exp, ONE)}"></div>` });
});

// color-mix: CSS Color 5 §3.3's own examples and more than two colors (the stack of two-color mixes, in sRGB values);
// device-cmyk: §6.1
[[['red', 'blue', 'lime'], [null, null, null], 'srgb', [1 / 3, 1 / 3, 1 / 3, 1]], [['red', 'blue', 'lime'], [70, 70, null], 'srgb', [0.5, 0, 0.5, 1]],
  [['red', 'blue', 'lime', 'black'], [10, 20, 30, 20], 'srgb', [0.125, 0.375, 0.25, 0.8]], [['red'], [40], 'srgb', [1, 0, 0, 0.4]]].forEach(([cs, ps, sp, exp], i) => {
  tests.push({ id: `color-mix-${n3(i + 1)}`, name: `color-mix(in ${sp}, ${cs.map((c, k) => `${c}${ps[k] != null ? ` ${ps[k]}%` : ''}`).join(', ')})`, help: 'https://drafts.csswg.org/css-color-5/#color-mix-result',
    assert: `The mix of ${cs.join(', ')} is ${exp.join(' ')}, as CSS Color 5 §3.3 normalizes and mixes them.`,
    html: () => `<div class="sq gamut-color-mix" style="--gamut-mix-count: ${cs.length}; --gamut-mix-space: ${sp}; ${cs.map((c, k) => `--gamut-mix-${k + 1}: ${c};${ps[k] != null ? ` --gamut-mix-pct-${k + 1}: ${ps[k]};` : ''}`).join(' ')} --ok: ${near4('var(--gamut-out)', exp, ONE)}"></div>` });
});
// paint: csswg-drafts #8715's colors mixed as paints, .gamut-mix-paint beside .gamut-color-mix, against spectral.js 3.0.0's mix()
[['#002185', '#fcd200', 50], ['#0000ff', '#ffff00', 50], ['#ff0000', '#ffffff', 25], ['#ff2702', '#0000ff', 60], ['#000000', '#fcd200', 80]].forEach(([a, b, p], i) => {
  const exp = spectral.mix([new spectral.Color(a), 100 - p], [new spectral.Color(b), p]).lRGB.map((x) => clip01(gam(x)));
  tests.push({ id: `color-mix-paint-${n3(i + 1)}`, name: `${a} and ${b} ${p}% mixed as paint`, help: 'https://github.com/w3c/csswg-drafts/issues/8715',
    assert: `${a} and ${b} at ${p}% mixed as paint are within 1 of 255 of spectral.js 3.0.0's mix(), ${exp.map((v) => +(v * 255).toFixed(2)).join(' ')}.`,
    html: () => `<div class="sq gamut-color-mix gamut-mix-paint" style="--gamut-mix-1: ${a}; --gamut-mix-2: ${b}; --gamut-mix-pct-2: ${p}; --ok: ${near('var(--gamut-out)', 'srgb', exp, ONE)}"></div>` });
});
[[0, 0, 0, 0], [1, 0, 0, 0], [0, 0.5, 1, 0], [0.2, 0.4, 0.6, 0.5]].forEach(([c, m, y, k], i) => {
  const exp = [c, m, y].map((v) => 1 - Math.min(1, v * (1 - k) + k));
  tests.push({ id: `device-cmyk-${n3(i + 1)}`, name: `device-cmyk(${c} ${m} ${y} ${k})`, help: 'https://drafts.csswg.org/css-color-5/#cmyk-rgb',
    assert: `device-cmyk(${c} ${m} ${y} ${k}) is rgb(${exp.map((v) => +(v * 255).toFixed(2)).join(' ')}), CSS Color 5 §6.1's naive conversion.`,
    html: () => `<div class="sq gamut-device-cmyk" style="--gamut-cmyk-c: ${c}; --gamut-cmyk-m: ${m}; --gamut-cmyk-y: ${y}; --gamut-cmyk-k: ${k}; --ok: ${near('var(--gamut-out)', 'srgb', exp, ONE)}"></div>` });
});

// rec2100-pq, -hlg, -linear: the spec's named points and a color, against its sample code, in sRGB (all in its gamut)
[['pq', [0.5807, 0.5807, 0.5807], 'media white'], ['hlg', [0.75, 0.75, 0.75], 'media white'], ['linear', [1, 1, 1], 'media white'],
  ['pq', [0.34, 0.34, 0.34], 'mid grey'], ['hlg', [0.38, 0.38, 0.38], 'mid grey'], ['pq', [0.55, 0.5, 0.4], 'a tan'], ['hlg', [0.7, 0.6, 0.35], 'a tan']].forEach(([sp, rgb, what], i) => {
  const exp = new Color('xyz-d65', rec2100(sp, rgb)).to('srgb').coords;
  tests.push({ id: `rec2100-${n3(i + 1)}`, name: `color(rec2100-${sp} ${rgb.join(' ')})`, help: 'https://drafts.csswg.org/css-color-hdr-1/#predefined-HDR',
    assert: `color(rec2100-${sp} ${rgb.join(' ')}), ${what}, is rgb(${exp.map((v) => +(v * 255).toFixed(2)).join(' ')}), as CSS Color HDR's sample code decodes it.`,
    html: () => `<div class="sq gamut-rec2100-${sp}" style="--gamut-rec2100-r: ${rgb[0]}; --gamut-rec2100-g: ${rgb[1]}; --gamut-rec2100-b: ${rgb[2]}; --ok: ${near('var(--gamut-out)', 'srgb', exp, ONE)}"></div>` });
});

// jzazbz(), jzczhz(), ictcp(): media white and a color, encoded by the spec's own encoders (hdr-spaces-check.mjs)
[['jzazbz', { jz: 0.22206524953574297, az: -0.0001606249262307291, bz: -0.00011703399768703271 }, [1, 1, 1], 'media white'],
  ['ictcp', { i: 0.5806888810416109, ct: 0, cp: 0 }, [1, 1, 1], 'media white'],
  ['jzazbz', { jz: 0.1571, az: 0.032972, bz: 0.0885 }, null, 'an orange'], ['jzczhz', { jz: 0.1571, cz: 0.094443, hz: 69.5665 }, null, 'an orange'],
  ['ictcp', { i: 0.478336, ct: 0.072547, cp: 0.081182 }, null, 'a pink']].forEach(([fn, v, srgb, what], i) => {
  const exp = srgb ?? new Color(fn === 'ictcp' ? 'ictcp' : 'jzazbz', fn === 'jzczhz' ? [v.jz, v.cz * Math.cos((v.hz * Math.PI) / 180), v.cz * Math.sin((v.hz * Math.PI) / 180)] : Object.values(v)).to('xyz-abs-d65').to('srgb').coords;
  const args = Object.values(v).join(' ');
  tests.push({ id: `hdr-spaces-${n3(i + 1)}`, name: `${fn}(${args})`, help: 'https://drafts.csswg.org/css-color-hdr-1/#DI-HDR',
    assert: `${fn}(${args}), ${what}, is rgb(${exp.map((x) => +(x * 255).toFixed(2)).join(' ')}), decoded to XYZ relative to media white at 203 cd/m².`,
    html: () => `<div class="sq ${gamut(fn)}" style="${Object.entries(v).map(([k, n]) => `--gamut-${fn}-${k}: ${n}`).join('; ')}; --ok: ${near('var(--gamut-out)', 'srgb', exp, ONE)}"></div>` });
});

// color-extract(): a channel as a number, checked in CSS against the value Color.js gives (within 1e-4 of its range)
[['#ff3366', 'oklch', 'l', 1], ['#ff3366', 'oklch', 'h', 360], ['rgb(30 144 255 / 0.4)', 'srgb', 'g', 1], ['color(display-p3 0.2 0.8 0.3)', 'hsl', 's', 100],
  ['lab(60 40 -30)', 'lab', 'b', 250]].forEach(([c, sp, ch, range], i) => {
  const col = new Color(c);
  const idx = ({ oklch: ['l', 'c', 'h'], srgb: ['r', 'g', 'b'], hsl: ['h', 's', 'l'], lab: ['l', 'a', 'b'] })[sp].indexOf(ch), w = col.to(sp).coords[idx];
  tests.push({ id: `color-extract-${n3(i + 1)}`, name: `color-extract(${sp} ${ch} from ${c})`, help: 'https://github.com/w3c/csswg-drafts/issues/6937',
    assert: `The ${sp} ${ch} of ${c}, taken out as a number, is ${+w.toFixed(4)}.`,
    html: () => `<div class="gamut-color-extract" style="--gamut-in: ${c}"><i class="sq gamut-color-extract-read gamut-extract-${sp}" style="--ok: color(srgb 0 0 0 / calc(1 + 1000000 * (${range * 1e-4} - abs(var(--gamut-${sp}-${ch}) - ${f6(w)}))))"></i></div>` });
});

// --- the WPT reftests: one file a test, all matching the filled green square -----------------------------------
rmSync(WPT, { recursive: true, force: true }); mkdirSync(WPT, { recursive: true });
const PASS_TEXT = '<p>Test passes if there is a filled green square and <strong>no red</strong>.</p>';
writeFileSync(path.join(WPT, 'ref-filled-green-100px-square.html'), `<!DOCTYPE html>
<meta charset="utf-8">
<title>CSS Reftest Reference</title>
<!-- a copy of web-platform-tests' /css/reference/ref-filled-green-100px-square.xht -->
<style>div { width: 100px; height: 100px; background-color: green; }</style>
${PASS_TEXT}
<div></div>
`);
for (const t of tests) writeFileSync(path.join(WPT, `${t.id}.html`), `<!DOCTYPE html>
<meta charset="utf-8">
<title>Color: ${esc(t.name)}</title>
<link rel="help" href="${t.help}">
<link rel="match" href="ref-filled-green-100px-square.html">
<meta name="assert" content="${esc(t.assert)}">
<link rel="stylesheet" href="../../gamutant.css">
<style>
${SHEET}${t.rules ? `\n${t.rules}` : ''}
</style>
${PASS_TEXT}
${t.html()}
`);
// every test on one page, each in its own frame as it is, for a browser no script drives (Safari on an iPad): a test
// passes when its square is green with no red
writeFileSync(path.join(WPT, 'index.html'), `<!DOCTYPE html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>gamutant.css reftests</title>
<style>body { margin: 16px; font: 14px/1.4 system-ui, sans-serif; background: #fff; color: #111; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
figure { margin: 0; } iframe { width: 150px; height: 200px; border: 1px solid #ccc; display: block; }
figcaption { font-size: 11px; color: #555; overflow-wrap: anywhere; }</style>
<h1>gamutant.css: ${tests.length} reftests</h1>
<p>Each frame is one test. It passes when its square is green with no red. Scroll to the end so every frame loads.</p>
<div class="grid">${tests.map((t) => `<figure><iframe src="${t.id}.html" loading="lazy" scrolling="no"></iframe><figcaption>${t.id}</figcaption></figure>`).join('')}</div>
`);
console.log(`${tests.length} reftests in ${WPT}/, and index.html with every one`);
