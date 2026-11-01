// Builds ../gamutant.css. Usage: node build/build.mjs (npm run build also writes parts/)
// The parts are written in modules/ (core.mjs, the sheet's head and the mappers' wiring; mapping.mjs, palette.mjs,
// contrast.mjs, mix.mjs, spaces.mjs, hdr.mjs, extract.mjs, a group each; common.mjs and oklab.mjs what they share;
// functions.mjs their @function forms), two by hand beside them (contrast.css, .readable-text; scale.css,
// .color-interpolate); registry.mjs lists every part, its file, its function form, credits and checks. This file puts
// them together (sheets()): each group's text folded by the passes, each part's function form read from the folded
// rules, then shipped(): comments dropped, classes prefixed gamut-, nested parts reset, the licence header.
// --plain writes gen/gamutant.plain.css instead, to read: the folding passes skipped and every comment kept, each step
// under the name its part gives it (fit-screen's --gamut--m1 to m11, the halvings). It computes what gamutant.css does:
// 46 of the 48 checks pass on it, constants (52 of its 59 distinct rows matched, the floor is the folded sheet's 60) and
// ends (a timeout in the full run; alone 22 of 22 and 12 of 12) apart (2026-11-01). Not shipped: 955 KB to 793.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { nest, across, share } from './lib/fold.mjs';
import { REGISTRY } from './registry.mjs';
import { noneHue, test } from './modules/common.mjs';
import { contrastColor } from './modules/contrast.mjs';
import { coreParts } from './modules/core.mjs';
import { extractPart } from './modules/extract.mjs';
import { asFunction } from './modules/functions.mjs';
import { hdrColorPart, hdrSpacesPart, rec2100Part } from './modules/hdr.mjs';
import { minde } from './modules/mapping.mjs';
import { layersPart, mixPart, paintPart, stopsPart } from './modules/mix.mjs';
import { cmykPart, okhslFromPart, okhslPart, okhsvPart } from './modules/spaces.mjs';
export * from './registry.mjs';
export * from './modules/mapping.mjs';
export * from './modules/common.mjs';
export * from './modules/oklab.mjs';
export * from './modules/palette.mjs';
export * from './modules/contrast.mjs';
export * from './modules/mix.mjs';
export * from './modules/spaces.mjs';
export * from './modules/hdr.mjs';
export * from './modules/extract.mjs';
export * from './modules/core.mjs';
export * from './modules/functions.mjs';

// The function forms, in the sheet's order: registry.mjs's fn, one a part
export const FUNCTIONS = REGISTRY.filter((p) => p.fn).map(({ part, fn }) => ({ cls: part, ...fn }));

export function sheets({ mapping = minde } = {}) {
  const { parts, m } = coreParts({ mapping });
  const src = (f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
  const head = (name, what) => `/* ${name}: ${what}. */`;
  // each generated part goes through the folding passes: a registered color with one reader nested in it (counted
  // over the whole sheet), an expression two rules write written once for both, then one a rule writes more than once
  // written once, under the part's own prefix so two parts' names never meet on one element; contrast.css and scale.css stay as written
  // .readable-text's background through noneHue() (WebKit greys a `none` hue where the sheet reads the color, and paints
  // it with hue 0, QUIRKS.md Q3: oklch(0.7 0.1 none) got text at 4.33:1 for 4.5); contrast.css reads --gamut--rt-bg
  const rtn = noneHue('var(--gamut-bg)', '--gamut--rtn-');
  const rtBg = `${rtn.props}\n@property --gamut--rt-bg { syntax: '<color>'; inherits: false; initial-value: transparent; }\n.readable-text { ${rtn.decls.join(' ')} --gamut--rt-bg: ${rtn.pick('srgb', 'r g b')}; }`;
  const hand = [src('contrast.css'), src('scale.css'), rtBg], fold = PLAIN ? (css) => css : (css, prefix) => share(across(nest(css, whole).css, { prefix }).css, { prefix }).css
    .replaceAll('--_s-', '--gamut--s-').replaceAll('--_x-', '--gamut--x-');   // the passes' names, into gamut's stem
  // each folded chunk named, so its shared names (--gamut--s-<name>_N, --gamut--x-<name>_N) are its own: a chunk added
  // or moved renames no other's; the hand-written ones and the heads go as written
  const modules = {
    contrast: [head('contrast', '.readable-text and .contrast-color'), src('contrast.css'), ['cc', contrastColor()], rtBg],
    mix: [head('mix', '.color-mix, .color-interpolate, .color-layers and .fit-gradient'), ['mx', mixPart()], src('scale.css'), ['ly', layersPart()], ['fg', stopsPart(m)]],
    spaces: [head('spaces', '.okhsl, .okhsl-from, .okhsv and .device-cmyk'), ['ol', okhslPart()], ['of', okhslFromPart()], ['ov', okhsvPart()], ['cm', cmykPart()]],
    hdr: [head('hdr', '.rec2100-pq, .rec2100-hlg, .rec2100-linear, .jzazbz, .jzczhz, .ictcp and .hdr-color'), ['rc', rec2100Part()], ['hs', hdrSpacesPart()], ['hc', hdrColorPart()]],
    extract: [head('extract', '.color-extract'), ['ex', extractPart()]],
  };
  const text = (t) => (Array.isArray(t) ? t[1] : t);
  const whole = [parts.join('\n'), ...Object.values(modules).flat(1).map(text)].join('\n');
  const built = { core: [fold(parts.join('\n'), 'k_')], ...Object.fromEntries(Object.entries(modules).map(([k, m]) => [k, m.map((t) => (Array.isArray(t) ? fold(t[1], `${t[0]}_`) : t))])) };
  // each function after the part that holds its class, generated from the whole sheet as it ships
  const paint = paintPart(), postcss = createRequire(import.meta.url)('postcss'), all = [...Object.values(built).flat(), paintPart('function')].join('\n');
  const at = (cls, t) => { let has = false; postcss.parse(t).walkRules((r) => { has ||= r.selectors.some((s) => s.trim() === `.${cls}`); }); return has; };
  for (const f of FUNCTIONS) {
    const [k, j] = Object.entries(built).flatMap(([k, m]) => m.map((t, j) => [k, j, t])).find(([, , t]) => at(f.cls, t));
    const l = f.local?.();
    built[k][j] += `\n${asFunction(all, l ? { ...f, pre: l.pre, locals: [...(f.locals ?? []), ...l.locals] } : f)}`;
  }
  // paint after the mix it overrides and after color-mix's function, whose paint branch is the same text (gzip finds it
  // within its 32 kB window); as written, since the passes have nothing in it to share
  built.mix[1] += `\n${paint}`;
  return { core: built.core[0], modules: Object.fromEntries(MODULES.map((k) => [k, built[k]])) };
}

// The parts are grouped the way Color.js 0.7.1's source does (its Color class with gamut mapping, then contrast,
// interpolation, the spaces, the HDR spaces), and go out as one file, gamutant.css, as Color.js ships one package.
// The groups are kept apart in sheets() for the checks that load one with the core.
export const MODULES = ['contrast', 'mix', 'spaces', 'hdr', 'extract'];
export function sheet(options) { const { core, modules } = sheets(options);
  return [core, ...MODULES.map((k) => modules[k].join('\n'))].join('\n'); }

// The shipped sheet: a usage note and the licence, then rules only (the notes stay here and in contrast.css and scale.css)
// Every class the sheet defines ships as gamut-<name> (.gamut-fit-screen, .gamut-blend-multiply, .gamut-extract-oklch), so
// a page's own classes (an .alpha utility) never meet the sheet's; the sources keep the bare names, and the custom
// properties (--gamut-) and functions (--gamut-fit-screen()) already carry the stem
export const CLASS_PREFIX = 'gamut-';
const PLAIN = process.argv.includes('--plain');   // node build.mjs --plain (above)
export function shipped(css = sheet()) {
  const req = createRequire(import.meta.url), postcss = req('postcss'), selectorParser = req('postcss-selector-parser');
  const root = postcss.parse(css);
  if (!PLAIN) root.walkComments((comment) => comment.remove());
  const prefix = selectorParser((sel) => { sel.walkClasses((c) => { c.value = CLASS_PREFIX + c.value; }); });
  root.walkRules((r) => { if (r.parent?.type === 'atrule' && r.parent.name === 'keyframes') return; r.selector = prefix.processSync(r.selector); });
  // A part nested in itself: an internal property set only under a container or media query (a target's matrices, a
  // method's registers) inherits into the nested part, which reads it where its own conditions set none (an
  // audit, 2026-10-29: an sRGB .screen-edge inside a rec2020 one kept --gamut--clip: rec2020, red 1.19). Each part
  // resets those on itself first, before any rule, the unregistered and inherited ones only: `initial` is the
  // guaranteed-invalid value, so each var() takes its fallback as on a part not nested
  const reg = new Map(); root.walkAtRules('property', (a) => { let inh = 'true'; a.walkDecls('inherits', (d) => { inh = d.value.trim(); }); reg.set(a.params.trim(), inh); });
  const where = (r) => { for (let a = r.parent; a && a.type !== 'root'; a = a.parent) { if (a.type === 'atrule' && a.name === 'function') return null; if (a.type === 'atrule' && (a.name === 'container' || a.name === 'media')) return 'cond'; } return 'base'; };
  const classes = new Set(); root.walkRules((r) => { const m = r.selector.match(/^\.(gamut-[a-z0-9-]+)$/); if (m) classes.add(m[1]); });
  const resets = [];
  for (const cls of classes) {
    const re = new RegExp(`\\.${cls}(?![\\w-])`), seen = { base: new Set(), cond: new Set() };
    root.walkRules((r) => { const w = re.test(r.selector) && where(r); if (w) r.walkDecls((d) => { if (d.prop.startsWith('--gamut--')) seen[w].add(d.prop); }); });
    const leak = [...seen.cond].filter((x) => !seen.base.has(x) && reg.get(x) !== 'false');
    if (leak.length) resets.push(postcss.rule({ selector: `.${cls}`, nodes: leak.map((x) => postcss.decl({ prop: x, value: 'initial' })) }));
  }
  root.prepend(...resets);
  return `/* gamutant.css
SPDX-License-Identifier: MIT AND Apache-2.0 AND W3C-20150513
Copyright (c) 2026 gamutant contributors
Copyright (c) 2021 Björn Ottosson
Copyright (c) 2025 Ronald van Wijnen
Copyright (c) 2021 Google LLC
Copyright (c) 2021 Lea Verou, Chris Lilley
Copyright (c) 2026 World Wide Web Consortium
The licenses are in LICENSE and LICENSE-THIRD-PARTY.

Add a part's class to an element and set its custom properties (README.md lists the parts):

<div class="gamut-fit-screen"
     style="--gamut-in: oklch(0.75 0.4 60); background: var(--gamut-out)"></div>
*/\n${root.toString().replace(/\n\s*\n/g, '\n').trim()}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (PLAIN) { const css = shipped(), to = new URL('../gen/gamutant.plain.css', import.meta.url); mkdirSync(new URL('.', to), { recursive: true }); writeFileSync(to, css); console.log(`gen/gamutant.plain.css ${css.length}`); process.exit(0); }
  const css = shipped(); writeFileSync(new URL('../gamutant.css', import.meta.url), css); console.log(`gamutant.css ${css.length}`);
  // the function forms' arguments, for test/functions-check.mjs (data, so the check runs where this file can't)
  writeFileSync(new URL('../test/data/functions.json', import.meta.url), JSON.stringify(FUNCTIONS.map(({ cls, args, out, container, number }) => ({ cls, args, out, container, number })), null, 1) + '\n');
}
