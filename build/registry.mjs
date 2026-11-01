// The parts, one row each, in the sheet's order: what each is, where its CSS is written, what it borrows and from whom,
// its function form, and the checks that test it. build.mjs reads the function forms (FUNCTIONS), parts.mjs the extra
// classes a part's selectors pair it with and the credits each part file carries, test/build-check.mjs the checks.
//   part     the class, bare (the sheet ships it as .gamut-<part>, build.mjs CLASS_PREFIX)
//   module   the group it ships in (build.mjs MODULES; core first); file, the file that writes it, from this one's folder
//   more     the classes its selectors pair it with: blend modes, the channels a read takes (read from the sheet)
//   from     [holder, what was taken and changed, SPDX id] for each source it ports (LICENSE-THIRD-PARTY has the notices)
//   fn       its function form, read from its class's own rules as the sheet ships them (modules/functions.mjs
//            asFunction()). An argument names the input it sets, in order, and any may be left off from the end. Each
//            is untyped, read as text as the class reads its input (a typed <color> holds a legacy rgb() in whole bytes:
//            rgb(207.4 0 0) arrives as 207). ` none` makes `none` leave the input unset, so the class's own default
//            applies (an argument can't be skipped: Chrome 155 gives the invalid value for an empty one or `initial`).
//            `container` reads a style query on an ancestor's property from an argument instead; `locals` are inputs
//            the arguments give another way. .fit-screen's own, --gamut-fit-screen(), is written apart (core.mjs).
//   checks   the checks in test/ that test it, besides functions-check.mjs (every function form) and the reftests
import { materialPart } from './modules/palette.mjs';

const OTTOSSON = '2021 Björn Ottosson', COLORJS = '2021 Lea Verou, Chris Lilley';
const OKHSL = [OTTOSSON, "Okhsl and Okhsv ported to CSS from ok_color.h (MIT); Display P3's constants from Isaac Muse's okhsl_p3.py"];
const ADAPTIVE = [OTTOSSON, "Its adaptive method is gamut_clip_adaptive_L0_L_cusp from Björn Ottosson's gamut clipping code (MIT), ported to CSS"];
const MAPPING = [COLORJS, "Its css and ray-trace methods follow Color.js 0.7.1's (MIT), and its targets' constants are computed with it"];
// W3C's notice of changes names its copyright itself
const W3C_CODE = (title, url) => [null, `Includes material derived from ${title} (${url}). Copyright © 2026 World Wide Web Consortium. https://www.w3.org/copyright/software-license-2023/`, 'W3C-20150513'];
const COLOR4 = W3C_CODE('CSS Color Module Level 4', 'https://drafts.csswg.org/css-color-4/'), HDR = W3C_CODE('CSS Color HDR Module Level 1', 'https://drafts.csswg.org/css-color-hdr-1/');
const all = (re) => (sheet) => [...new Set([...sheet.matchAll(re)].map((m) => m[1]))];
const rec2100 = (s) => ({ part: `rec2100-${s}`, module: 'hdr', file: 'modules/hdr.mjs', from: [HDR], fn: { args: ['r', 'g', 'b', 'alpha'].map((c) => `--gamut-rec2100-${c}`) }, checks: ['rec2100-check.mjs'] });
const hdrSpace = (s, c) => ({ part: s, module: 'hdr', file: 'modules/hdr.mjs', from: [HDR], fn: { args: [...c.split(' '), 'alpha'].map((x) => `--gamut-${s}-${x}`) }, checks: ['hdr-spaces-check.mjs'] });

export const REGISTRY = [
  { part: 'fit-screen', module: 'core', file: 'modules/mapping.mjs', from: [ADAPTIVE, MAPPING],
    checks: ['gate-check.mjs', 'mapper-check.mjs', 'function-check.mjs', 'ends-check.mjs', 'issue-9449-check.mjs', 'current-color-check.mjs', 'ottosson-check.mjs', 'adaptive-check.mjs', 'targets-check.mjs', 'mappers-check.mjs', 'drift-check.mjs'] },
  { part: 'screen-edge', module: 'core', file: 'modules/mapping.mjs', from: [[COLORJS, "Its matrices to rec2020, a98-rgb and prophoto-rgb are Color.js 0.7.1's (MIT)"]],
    fn: { args: ['--gamut-in', '--gamut-rel', '--gamut: var(--gamut-target, screen)'], container: { '--gamut-target': '--gamut' } }, checks: ['mapper-check.mjs', 'targets-check.mjs', 'mappers-check.mjs'] },
  { part: 'palette-step', module: 'core', file: 'modules/palette.mjs', from: [['2021 Google LLC', 'Ported to CSS from material-color-utilities 0.4.0 (Apache-2.0) and changed: TonalPalette.tone(), HctSolver, Cam16', 'Apache-2.0']],
    fn: { args: ['--gamut-in', '--gamut-chroma-scale', '--gamut-step none', '--gamut-tone none'], drop: ['--gamut--mt-yf'], local: () => materialPart().fn }, checks: ['material-check.mjs', 'mappers-check.mjs'] },
  { part: 'alpha', module: 'core', file: 'modules/core.mjs', checks: ['alpha-check.mjs'] },
  { part: 'light-dark', module: 'core', file: 'modules/core.mjs', checks: ['small-parts-check.mjs'] },
  { part: 'color-equal', module: 'core', file: 'modules/core.mjs', fn: { out: '--gamut-equal', args: ['--gamut-equal-a', '--gamut-equal-b'], number: true }, checks: ['small-parts-check.mjs'] },
  { part: 'readable-text', module: 'contrast', file: 'contrast.css',
    fn: { out: '--gamut-text', args: ['--gamut-bg', '--gamut-ratio', '--gamut-readable-from none', '--gamut-readable-to none'] }, checks: ['contrast-check.mjs', 'contrast-seed-check.mjs', 'readable-wide-check.mjs', 'contrast-hostile-check.mjs'] },
  { part: 'contrast-color', module: 'contrast', file: 'modules/contrast.mjs',
    fn: { out: '--gamut-text', args: ['--gamut-bg', '--gamut-contrast-ratio none', ...Array.from({ length: 6 }, (_, i) => `--gamut-try-${i + 1}`)] }, checks: ['contrast-color-check.mjs', 'contrast-hostile-check.mjs'] },
  { part: 'color-mix', module: 'mix', file: 'modules/mix.mjs', more: ['mix-paint'], from: [['2025 Ronald van Wijnen', 'Its paint mix follows spectral.js 3.0.0 (MIT) and carries its tables, cut to 30 samples']],
    fn: { args: ['--gamut-mix-space', ...Array.from({ length: 6 }, (_, i) => [`--gamut-mix-${i + 1}`, `--gamut-mix-pct-${i + 1} none`]).flat()],
      locals: [`--gamut-mix-count: calc(${Array.from({ length: 6 }, (_, i) => `if(style(--gamut-mix-${i + 1}): 1; else: 0)`).join(' + ')});`], container: { '--gamut-mix-space': '--gamut-mix-space' }, hoist: true },
    checks: ['color-mix-check.mjs', 'paint-check.mjs', 'mix-hostile-check.mjs'] },
  { part: 'color-interpolate', module: 'mix', file: 'scale.css', checks: ['scale-check.mjs', 'scale-none-check.mjs', 'stops-check.mjs'] },
  { part: 'color-layers', module: 'mix', file: 'modules/mix.mjs', more: all(/\.gamut-(blend-[a-z-]+)/g), checks: ['layers-check.mjs'] },
  { part: 'fit-gradient', module: 'mix', file: 'modules/mix.mjs', more: ['gradient-ease'], from: [ADAPTIVE, MAPPING], checks: ['fit-gradient-check.mjs', 'gradient-ease-check.mjs', 'gradient-space-check.mjs'] },
  { part: 'okhsl', module: 'spaces', file: 'modules/spaces.mjs', from: [OKHSL], fn: { args: ['--gamut-okhsl-h', '--gamut-okhsl-s', '--gamut-okhsl-l'] }, checks: ['okhsl-check.mjs', 'okhsl-coloraide-check.mjs', 'okhsl-gamuts-check.mjs'] },
  { part: 'okhsl-from', module: 'spaces', file: 'modules/spaces.mjs', from: [OKHSL, COLOR4], fn: { args: ['--gamut-in', '--gamut-okhsl-s none', '--gamut-okhsl-l none'] }, checks: ['okhsl-from-check.mjs', 'okhsl-gamuts-check.mjs'] },
  { part: 'okhsv', module: 'spaces', file: 'modules/spaces.mjs', from: [OKHSL], fn: { args: ['--gamut-okhsv-h', '--gamut-okhsv-s', '--gamut-okhsv-v'] }, checks: ['okhsv-check.mjs', 'okhsl-coloraide-check.mjs', 'okhsl-gamuts-check.mjs'] },
  { part: 'device-cmyk', module: 'spaces', file: 'modules/spaces.mjs', fn: { args: ['c', 'm', 'y', 'k', 'alpha'].map((c) => `--gamut-cmyk-${c}`) }, checks: ['color-mix-check.mjs'] },
  rec2100('pq'), rec2100('hlg'), rec2100('linear'),
  hdrSpace('jzazbz', 'jz az bz'), hdrSpace('jzczhz', 'jz cz hz'), hdrSpace('ictcp', 'i ct cp'),
  { part: 'hdr-color', module: 'hdr', file: 'modules/hdr.mjs', fn: { args: ['--gamut-hdr-1', '--gamut-hdr-h1', '--gamut-hdr-2', '--gamut-hdr-h2', '--gamut-headroom'] }, checks: ['hdr-color-check.mjs'] },   // the draft's pairs, then the screen's headroom
  { part: 'color-extract', module: 'extract', file: 'modules/extract.mjs', more: (sheet) => ['color-extract-read', ...all(/\.gamut-(extract-[a-z0-9-]+)/g)(sheet)], from: [COLOR4], checks: ['extract-check.mjs'] },
];
