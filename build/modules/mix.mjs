// .color-mix (CSS Color 5's color-mix() of up to six colors, and the paint mix, spectral.js 3.0.0), .color-layers
// (Compositing 1's blend modes) and .fit-gradient (gradient stops, each mapped). .color-interpolate is hand-written,
// scale.css.
import { readFileSync } from 'node:fs';
import { SEED, X, registered } from './common.mjs';
import { GUARD_MINDE, W, adaptive, minde } from './mapping.mjs';

// CSS Color 6 §3 color-layers([<blend-mode>,]? <color>#): the first color on top (WPT's reference stacks them so),
// each layer composited source-over onto the ones below with Compositing 1's blend (§5.8, §10.2), in sRGB as the page
// paints. A step: S, the layer, onto B, the layers below. Its two alphas ride in one color's channels (a color of
// alpha 0 loses its channels in a mix, so no number rides with alpha 0); Cs' = (1 - ab) Cs + ab B(Cb, Cs) is a mix
// whose alphas are its weights; then S' (alpha as) mixes with B given alpha ab (1 - as), and the alpha is doubled back.
const LAYERS = 6;
// B(cb, cs) of each separable mode, with cb in r and cs in g, each clamped to 0..1 (the range the modes are defined on;
// colors past sRGB have channels outside it) (Compositing 1 §10.2); color-dodge and color-burn divide
// by at least 1e-30, which keeps their own first cases (cb = 0, cb = 1) exact and the rest past float32's 1e-12
// channels (at 1e-9, dodge of cb 1e-12 under cs 1 gave 0.001 for 1: an audit, 2026-10-28); dodge takes its
// second case, cs = 1, apart: 1 over any cb above 0 (cb 1e-31 under white gave 0.1, an audit, 2026-10-29).
// Burn's needs no such case: 1 - cb, cb a float32 below 1, is 6e-8 at least
const BLEND = {
  multiply: 'r * g',
  screen: 'r + g - r * g',
  overlay: '(1 - clamp(0, sign(r - 0.5), 1)) * g * 2 * r + clamp(0, sign(r - 0.5), 1) * (g + (2 * r - 1) - g * (2 * r - 1))',
  darken: 'min(r, g)',
  lighten: 'max(r, g)',
  'color-dodge': 'clamp(0, sign(r), 1) * min(1, r / max(1e-30, 1 - g) + clamp(0, sign(g - 1) + 1, 1))',
  'color-burn': '1 - min(1, (1 - r) / max(1e-30, g))',
  'hard-light': '(1 - clamp(0, sign(g - 0.5), 1)) * r * 2 * g + clamp(0, sign(g - 0.5), 1) * (r + (2 * g - 1) - r * (2 * g - 1))',
  'soft-light': '(1 - clamp(0, sign(g - 0.5), 1)) * (r - (1 - 2 * g) * r * (1 - r)) + clamp(0, sign(g - 0.5), 1) * (r + (2 * g - 1) * ((1 - clamp(0, sign(r - 0.25), 1)) * ((16 * r - 12) * r + 4) * r + clamp(0, sign(r - 0.25), 1) * sqrt(max(0, r)) - r))',
  difference: 'abs(r - g)',
  exclusion: 'r + g - 2 * r * g',
};
// The non-separable modes (Compositing 1 §10.2), each on whole colors: hue SetLum(SetSat(Cs, Sat(Cb)), Lum(Cb)),
// saturation SetLum(SetSat(Cb, Sat(Cs)), Lum(Cb)), color SetLum(Cs, Lum(Cb)), luminosity SetLum(Cb, Lum(Cs)). A step
// takes a color's three channels and one number, which rides in the alpha as 0.5 + n / 2 (never 0, so the channels
// survive the mix). SetLum's ClipColor is branch-free: C' = L + (C - Lum(C)) f1 f2, f1 = min(1, L / (Lum(C) - min C)),
// f2 = min(1, (1 - L) / (max C - Lum(C))), as §10.2's two ifs (with min and max read once) give.
const NONSEP = { hue: ['S', 'sat', 'B'], saturation: ['B', 'sat', 'S'], color: ['S'], luminosity: ['B', 'lum', 'S'] };
export function layersPart() {
  const v = (n) => `var(--gamut--ly-${n})`;
  const L = (k) => `var(--gamut-layer-${k}, transparent)`;
  // a layer where it is mixed whole, each missing component 0 (CSS Color 4 §4.4): a mix would fill it from the other color
  const zero = (x) => `color(from ${x} srgb calc(r) calc(g) calc(b) / calc(alpha))`;
  // the alphas: as in r, ab in g. ab is the stack below's alpha, carried in channels from the layer below's own pair
  // (as + ab (1 - as)): a registered color's alpha is rounded to 2 or 3 decimals between properties in Firefox (QUIRKS)
  const A = (k) => `color-mix(in srgb, color(from ${L(k)} srgb calc(alpha) none none / none), ${k === LAYERS - 1
    ? `color(from ${L(LAYERS)} srgb none calc(alpha) none / none)` : `color(from ${v(`a${k + 1}`)} srgb none calc(r + g * (1 - r)) none / none)`})`;
  const onto = (S1, B, A1) => `color(from color-mix(in srgb, ${S1}, color-mix(in srgb, color(from ${B} srgb r g b / none), color(from ${A1} srgb none none none / calc(g * (1 - r))))) srgb r g b / calc(2 * alpha))`;
  const normal = (k) => onto(zero(L(k)), v(`r${k + 1}`), v(`a${k}`));
  const c01 = 'clamp(0, r, 1) clamp(0, g, 1) clamp(0, b, 1)';
  // the formulas, as unregistered properties whose tokens the channel keywords of each color(from) resolve
  // (E, as the separable modes' floor: at 1e-9, hue of (1e-12, 0, 0) over blue gave grey .11 for red .37)
  const h = (x) => `var(--gamut--ly-${x})`, E = '1e-30';
  const HELP = {
    lum: '(0.3 * r + 0.59 * g + 0.11 * b)',
    lumc: '(0.3 * clamp(0, r, 1) + 0.59 * clamp(0, g, 1) + 0.11 * clamp(0, b, 1))',
    satc: '(max(clamp(0, r, 1), clamp(0, g, 1), clamp(0, b, 1)) - min(clamp(0, r, 1), clamp(0, g, 1), clamp(0, b, 1)))',
    k: `(min(1, ${h('lum')} / max(${E}, ${h('lum')} - min(r, g, b))) * min(1, (1 - ${h('lum')}) / max(${E}, max(r, g, b) - ${h('lum')})))`,
  };
  // a number from Y joins X's channels by a mix's channels, never its alpha: Firefox rounds a color-mix()'s alpha to 3
  // decimals (QUIRKS). SetLum adds Lum(Y) - Lum(X) to each channel (the sum's own Lum is then the target, which ClipColor
  // reads); SetSat multiplies X's (c - min) / (max - min) by Sat(Y), as a sum of logarithms
  const sum = (P, Q, f = (x) => `calc(2 * ${x})`) => `color(from color-mix(in srgb, ${P}, ${Q}) srgb ${['r', 'g', 'b'].map(f).join(' ')} / 1)`;
  const setLum = (X, Y) => `color(from ${sum(`color(from ${X} srgb ${['r', 'g', 'b'].map((c) => `calc(${c} - ${h('lum')})`).join(' ')} / 1)`,
    `color(from ${Y} srgb ${`calc(${h('lumc')}) `.repeat(3)}/ 1)`)} srgb ${['r', 'g', 'b'].map((c) => `calc(${h('lum')} + (${c} - ${h('lum')}) * ${h('k')})`).join(' ')} / none)`;
  // (the range itself, not floored: Compositing 1's SetSat parts a range of 0 from any above it, and a floor of 1e-30
  // took a source of (1e-31, 0, 0) to a tenth of its saturation, hue over lime 0.66 for 1; an audit,
  // 2026-10-29. A range of 0 divides by 1, each channel then 0; as a max(), not a sum: range + 1 - 1 in 32 bits is 0)
  const range = '(max(r, g, b) - min(r, g, b))';
  const setSat = (X, Y) => sum(`color(from ${X} srgb ${['r', 'g', 'b'].map((c) => `log(max(1e-30, (${c} - min(r, g, b)) / max(${range}, 1 - sign(${range}))))`).join(' ')} / 1)`,
    `color(from ${Y} srgb ${'log(max(1e-30, var(--gamut--ly-satc))) '.repeat(3)}/ 1)`, (x) => `exp(2 * ${x})`);
  const nonsep = (mode, S, B) => {
    const c = { S: `color(from ${S} srgb ${c01} / 1)`, B: `color(from ${B} srgb ${c01} / 1)` }, [x, op, y] = NONSEP[mode];
    if (op === 'lum') return setLum(c[x], y === 'S' ? S : B);
    return setLum(op === 'sat' ? setSat(c[x], y === 'S' ? S : B) : c[x], B);
  };
  const blended = (k, mode) => {
    const S = L(k), B = v(`r${k + 1}`);
    const ch = (c, i) => `color(from color-mix(in srgb, color(from ${B} srgb clamp(0, ${c}, 1) none none / none), color(from ${S} srgb none clamp(0, ${c}, 1) none / none)) srgb ${['', '', ''].map((_, j) => (j === i ? 'calc(var(--gamut--ly-f))' : 'none')).join(' ')} / none)`;
    if (mode !== undefined) return mode ? nonsep(mode, S, B) : `color-mix(in srgb, color-mix(in srgb, ${ch('r', 0)}, ${ch('g', 1)}), ${ch('b', 2)})`;
    const BL = v(`x${k}`); // B(Cb, Cs), the mode's own property
    const Cs1 = `color-mix(in srgb, color-mix(in srgb, color(from ${S} srgb calc(r) calc(g) calc(b) / none), color(from ${v(`a${k}`)} srgb none none none / calc(1 - g))), color-mix(in srgb, ${BL}, color(from ${v(`a${k}`)} srgb none none none / calc(g))))`;
    const S1 = `color-mix(in srgb, color(from ${Cs1} srgb r g b / none), color(from ${v(`a${k}`)} srgb none none none / calc(r)))`;
    return onto(S1, B, v(`a${k}`));
  };
  const below = Array.from({ length: LAYERS - 1 }, (_, i) => LAYERS - 1 - i);
  const regs = [...Array.from({ length: LAYERS }, (_, i) => `r${i + 1}`), ...below.reverse().flatMap((k) => [`a${k}`, `x${k}`])];
  below.reverse();
  const decls = (step, x) => [
    `--gamut--ly-r${LAYERS}: ${zero(L(LAYERS))};`,
    ...below.flatMap((k) => [`--gamut--ly-a${k}: ${A(k)};`, ...(x ? [`--gamut--ly-x${k}: ${blended(k, '')};`] : []), `--gamut--ly-r${k}: ${step(k)};`]),
  ];
  return `/* CSS Color 6's color-layers(); #13254 (does it need an interpolation method), #8431 and
   #11533 (blend modes and maths over two colors, #11533 resolved 2025-01-30 to spec it).
   .color-layers: In: --gamut-layer-1 to --gamut-layer-${LAYERS}, top first (an unset layer is transparent, a none component 0); a class
   blend-<mode> for a blend mode (${[...Object.keys(BLEND), ...Object.keys(NONSEP)].join(', ')}; normal without one, or with blend-normal or any other class). Out: --gamut-out, the layers
   composited source-over with the blend (Compositing 1), in sRGB as the page paints. A color past sRGB keeps its
   channels (the page clips each layer to the screen before stacking it, so a translucent layer over one paints a
   little apart: how is #13254's question); a blend mode reads channels clamped to 0..1. */
${regs.map((n) => `@property --gamut--ly-${n} { syntax: '<color>'; inherits: false; initial-value: transparent; }`).join('\n')}
.color-layers {
  ${decls(normal).join('\n  ')}
  --gamut-out: ${v('r1')};
}
.color-layers:is(${[...Object.keys(BLEND), ...Object.keys(NONSEP)].map((m) => `.blend-${m}`).join(', ')}) {
  ${decls(blended, true).join('\n  ')}
}
${Object.entries(BLEND).map(([m, f]) => `.color-layers.blend-${m} { --gamut--ly-f: ${f}; }`).join('\n')}
.color-layers:is(${Object.keys(NONSEP).map((m) => `.blend-${m}`).join(', ')}) {
  ${Object.entries(HELP).map(([x, f]) => `--gamut--ly-${x}: ${f};`).join('\n  ')}
}
${Object.keys(NONSEP).map((m) => `.color-layers.blend-${m} {\n  ${below.map((k) => `--gamut--ly-x${k}: ${blended(k, m)};`).join('\n  ')}\n}`).join('\n')}`;
}

// CSS Color 5 §3.3 color-mix() of one color or more (#4711): its own algorithm is a stack of two-color mixes, the
// first two by their share, the result carrying their summed percentage; so nested color-mix()es, each renormalised,
// run it exactly, and the last one, with the raw sum, applies the leftover as the alpha multiplier.
const MIX = 6;
// css-color-5 §3.2: "Percentages are required to be in the range 0% to 100%" (the grammar's <percentage [0,100]>), so a
// color-mix() with one past either end is invalid, and so is one that isn't a percentage. b_k is 1 where color k's
// percentage (40 for 40%) is set and below 0, above 100 or not a number (its declaration invalid: the initial 1), else
// 0; g is 200% where any color within the count has b_k 1, else 0%. The output's last mix takes, at 0%, a color of all
// `none` (which takes the other color's components: the same color) from a color-mix() with g as its percentage,
// written as a literal there by var(): 200% fails <percentage [0,100]>, so --gamut-out is invalid at computed-value
// time and inherits the parent's, as the browser's own invalid color-mix() would (calc() clamps a percentage in
// color-mix(), and no number makes a value invalid: a registered <percentage> is the way through)
const NONE = 'color(srgb none none none / none)';
export const mixGate = (g) => `color-mix(in srgb, ${NONE} var(${g}), ${NONE})`;
export function mixPart() {
  // each percentage read through a registered <number> and a registered <percentage> (40 or 40%): unset, or of the
  // other type, each stays at its initial -1 or -1%, the omitted sentinel; the percentage made a number in a register of
  // its own (t: Firefox 158 can't divide a percentage by 1% there, so only that reading is lost, a percentage invalid)
  const w = (k) => `var(--gamut--mx-w${k})`, p = (k) => `max(var(--gamut--mx-q${k}), var(--gamut--mx-t${k}))`;
  const q = Array.from({ length: MIX }, (_, i) => `--gamut--mx-q${i + 1}`);
  const used = (k) => `clamp(0, var(--gamut-mix-count, 2) - ${k - 1}, 1)`; // 1 for the given colors
  const spec = (k) => `${used(k)} * max(0, ${p(k)})`, omitted = (k) => `${used(k)} * clamp(0, sign(-0.5 - ${p(k)}) + 1, 1)`;
  const S = `min(100, ${Array.from({ length: MIX }, (_, i) => spec(i + 1)).join(' + ')})`, O = `max(1, ${Array.from({ length: MIX }, (_, i) => omitted(i + 1)).join(' + ')})`;
  const steps = [
    ...Array.from({ length: MIX }, (_, i) => [`p${i + 1}`, `${spec(i + 1)} + ${omitted(i + 1)} * (100 - var(--gamut--mx-S)) / var(--gamut--mx-O)`]),
    ['S', S], ['O', O],
    ['T', Array.from({ length: MIX }, (_, i) => `var(--gamut--mx-p${i + 1})`).join(' + ')],
    // forced normalization: every percentage times 100 / total (when the total is above 0)
    ...Array.from({ length: MIX }, (_, i) => [`w${i + 1}`, `var(--gamut--mx-p${i + 1}) * 100 / max(var(--gamut--mx-T), 1e-9)`]),
    // the running sums
    ...Array.from({ length: MIX }, (_, i) => [`P${i + 1}`, Array.from({ length: i + 1 }, (_, j) => w(j + 1)).join(' + ')]),
  ];
  const sp = 'in var(--gamut-mix-space, oklab)';
  // a pair: the stack so far (P_{k-1}) and color k (w_k), their shares of their sum, 0.5 each when both are 0. With
  // color k unset the pair (u_k) is invalid and the stage is the one before (c_k): an unset color takes no part, where
  // transparent at 0% filled the stack's missing components (an audit, 2026-10-28). A color set past the
  // count still does, as a 0% color in color-mix() does: an unregistered pair is never invalid by its percentage alone
  const share = (x, k) => `(${x} + (1 - sign(var(--gamut--mx-P${k})))) / (var(--gamut--mx-P${k}) + 2 * (1 - sign(var(--gamut--mx-P${k}))))`;
  const pair = (prev, k) => `color-mix(${sp}, ${prev} calc(${share(`var(--gamut--mx-P${k - 1})`, k)} * 100%), var(--gamut-mix-${k}) calc(${share(w(k), k)} * 100%))`;
  // the steps stay unregistered, one nested color-mix() in the end: Firefox serializes a registered color's alpha to 2 or 3 decimals
  // (QUIRKS.md Q4), which a chain of registered steps rounded at every step
  const decls = [
    // the first color as it is: converted to the space (its pair with itself at 0%), a transparent one came out
    // transparent black, its channels lost to the premultiplying, and a later color's missing ones took those zeros
    // (color(srgb 1 0 0 / 0) and color(srgb none 1 0) gave red 0 for 1: an audit, 2026-10-28); the last
    // mix converts the result
    '--gamut--mx-c1: var(--gamut-mix-1, transparent);',
    ...Array.from({ length: MIX - 1 }, (_, i) => [`--gamut--mx-u${i + 2}: ${pair(`var(--gamut--mx-c${i + 1})`, i + 2)};`, `--gamut--mx-c${i + 2}: var(--gamut--mx-u${i + 2}, var(--gamut--mx-c${i + 1}));`]).flat(),
  ];
  // the alpha multiplier, 1 - leftover = min(1, total / 100): a last mix of the result with itself at total% and g, the
  // gate, 0% or 200% where a share is bad (the result itself there: another color at 0% would fill its missing
  // components; the total stays a calc(): WebKit 26.4 takes two literal 0% for an invalid color-mix())
  const out = `color-mix(${sp}, var(--gamut--mx-c${MIX}) calc(min(100, var(--gamut--mx-T)) * 1%), var(--gamut--mx-c${MIX}) var(--gamut--mx-g))`;
  // bad: in each type (a number, a percentage over 1%), 1 when set and out of 0..100 or not of that type (invalid: its
  // initial 1); the share is bad when both readings are
  const badN = (k) => `calc(clamp(0, sign(0 - var(--gamut-mix-pct-${k}, 0)), 1) + clamp(0, sign(var(--gamut-mix-pct-${k}, 0) - 100), 1))`;
  // (the percentage reading from its registered number t, never from the input itself: Chrome 155 takes 50px / 1% as
  // a number there; t is -1 when unset or not a percentage, and the number reading tells unset apart: 0 there)
  const badP = (k) => `clamp(0, sign(0 - var(--gamut--mx-t${k})), 1) + clamp(0, sign(var(--gamut--mx-t${k}) - 100), 1)`;
  const gate = `calc(min(1, ${Array.from({ length: MIX }, (_, i) => `${used(i + 1)} * var(--gamut--mx-b${i + 1})`).join(' + ')}) * 200%)`;
  return `/* CSS Color 5's color-mix() of one color or more than two (#4711, #5277). .color-mix:
   In: --gamut-mix-1 to --gamut-mix-${MIX} (colors), --gamut-mix-count (how many, default 2), --gamut-mix-pct-1 to
   -${MIX} (40 or 40%, each optional; one below 0, above 100 or neither a number nor a percentage makes --gamut-out invalid, as
   css-color-5 §3.2 makes color-mix()), --gamut-mix-space (default oklab; a hue method may follow, as in
   oklch longer hue). Out: --gamut-out. CSS Color 5 §3.3: percentages normalized (omitted ones share what is left, all
   scaled to 100), the colors mixed two at a time down the list, the leftover below 100% taken off the alpha. */
${q.map((n) => ['-q', '-t'].map((x) => `@property ${n.replace('-q', x)} { syntax: '<number>'; inherits: false; initial-value: -1; }`).join('\n')).join('\n')}
${q.map((n) => `@property ${n.replace('-q', '-o')} { syntax: '<percentage>'; inherits: false; initial-value: -1%; }`).join('\n')}
${Array.from({ length: MIX }, (_, i) => ['b', 'bn'].map((b) => `@property --gamut--mx-${b}${i + 1} { syntax: '<number>'; inherits: false; initial-value: 1; }`).join('\n')).join('\n')}
@property --gamut--mx-g { syntax: '<percentage>'; inherits: false; initial-value: 0%; }
.color-mix { ${q.map((n, i) => `${n}: var(--gamut-mix-pct-${i + 1}); ${n.replace('-q', '-o')}: var(--gamut-mix-pct-${i + 1}, -1%); ${n.replace('-q', '-t')}: calc(var(${n.replace('-q', '-o')}) / 1%);`).join(' ')} ${Array.from({ length: MIX }, (_, i) => `--gamut--mx-bn${i + 1}: ${badN(i + 1)}; --gamut--mx-b${i + 1}: min(var(--gamut--mx-bn${i + 1}), ${badP(i + 1)});`).join(' ')} --gamut--mx-g: ${gate}; }
${registered('--gamut--mx-', '.color-mix', steps, { ...Object.fromEntries(decls.map((d) => [d.slice(0, d.indexOf(':')), d.slice(d.indexOf(':') + 2, -1)])), '--gamut-out': out })}`;
}

// csswg-drafts #8715: colors mixed as paints mix, not as light (blue and yellow give green). spectral.js 3.0.0's
// Kubelka-Munk mix: a color's linear r, g, b split into seven weights (white, cyan, magenta, yellow, red, green, blue),
// its reflectance at each sample their sum over seven base curves; each sample's K/S, (1 - R)^2 / 2R, averaged over the
// colors weighted by concentration (factor squared times luminance); back to a reflectance, 1 + K/S - sqrt(K/S^2 + 2 K/S),
// written as 1 / (1 + K/S + sqrt(…)), which keeps its digits in 32 bits; to linear sRGB by the colour matching
// functions. paint.json holds the curves at 30 samples and the weights back (cut from
// spectral.js's 38, within 3e-5 of it). Three samples ride in a color's channels and the color's concentration in its
// alpha, so one premultiplied color-mix() of the two colors is the K/S average: a mix's alpha isn't read again (Firefox
// keeps it to 3 decimals, QUIRKS.md Q77), which is why paint mixes two colors, not up to 6 (a third would mix the
// rounded alpha of the first two). The 10 groups' linear sRGB are summed by color-mix() at 1/k each, their weights
// times 10. One unregistered expression, every step in channels; the percentages are .color-mix's registered p1, p2, T.
// The class: .mix-paint beside .color-mix on the same element, a compound selector, so no branch on a value is needed
// (WebKit 26.4 and Firefox 158 have no if()). The function: --gamut-color-mix(paint, …) reads its argument, from the
// same text under @container style(--gamut-mix-space: paint), which asFunction() turns into an if() (form 'function').
export function paintPart(form = 'class') {
  const { A, W } = JSON.parse(readFileSync(new URL('../paint.json', import.meta.url), 'utf8')), S = A[0].length, G = Math.ceil(S / 3);
  const num = (x) => String(+x.toPrecision(12)).replace(/^(-?)0\./, '$1.');
  const sum = (ts) => ts.join(' + ').replace(/\+ -/g, '- ');
  const T = ['min(r,g,b)', 'min(g,b)', 'min(r,b)', 'min(r,g)', 'max(0,r - max(g,b))', 'max(0,g - max(r,b))', 'max(0,b - max(r,g))'];
  const R = (q) => (q < S ? `calc(max(1e-16,${sum(T.map((t, a) => `${t}*${num(A[a][q])}`))}))` : '0');
  const ks = (c) => `calc(pow(1 - ${c},2)/2/${c})`, km = (c) => `calc(1/(1 + ${c} + sqrt(${c}*${c} + 2*${c})))`;
  // color k's reflectances at group j's samples, then their K/S, its concentration in alpha: (p_k / 100)^2 times luminance
  const P = (k, j) => `color(from color(from var(--gamut-mix-${k}, transparent) srgb-linear ${R(3 * j)} ${R(3 * j + 1)} ${R(3 * j + 2)} / calc(max(1e-16,.212639*r + .715169*g + .0721923*b)*pow(var(--gamut--mx-p${k})/100,2))) srgb-linear ${ks('r')} ${ks('g')} ${ks('b')} / alpha)`;
  const row = (c, j) => `calc(${sum([0, 1, 2].filter((q) => 3 * j + q < S).map((q) => `${'rgb'[q]}*${num(W[c][3 * j + q] * G)}`))})`;
  const Q = (j) => `color(from color(from color-mix(in srgb-linear,${P(1, j)},${P(2, j)}) srgb-linear ${km('r')} ${km('g')} ${km('b')}) srgb-linear ${row(0, j)} ${row(1, j)} ${row(2, j)} / 1)`;
  let out = Q(0); for (let j = 1; j < G; j++) out = `color-mix(in srgb-linear,${out},${Q(j)} calc(100%/${j + 1}))`;
  const rule = `--gamut-out: color-mix(in srgb-linear, color(from ${out} srgb-linear r g b / calc(min(100, var(--gamut--mx-T)) / 100 * clamp(0, 3 - var(--gamut-mix-count, 2), 1))) 100%, ${mixGate('--gamut--mx-g')} 0%);`;
  if (form === 'function') return `@container style(--gamut-mix-space: paint) { .color-mix { ${rule} } }`;
  return `/* Colors mixed as paints (Kubelka-Munk), csswg-drafts #8715: .color-mix.mix-paint mixes --gamut-mix-1
   and --gamut-mix-2 by --gamut-mix-pct-1 and -2 (normalized as color-mix() normalizes
   them, a total under 100 off the alpha) as spectral.js 3.0.0's mix() does: each color opaque, read in linear sRGB;
   --gamut-out in srgb-linear, unclamped. A --gamut-mix-count above 2 gives transparent; a percentage .color-mix
   rejects makes it invalid, as there. */
.color-mix.mix-paint { ${rule} }`;
}

// Mapped gradient stops (#9449: authors write linear-gradient(in oklch, A, B) and the browser clips the colors between).
// .fit-gradient: the oklch interpolation of --gamut-gradient-from and --gamut-gradient-to at t = 0, 1/8 ... 1 (CSS Color 4 §12, by color-mix()),
// each mapped by .fit-screen's own chain (minde()), renamed per stop: 9 chains on one element, each with its own
// registers. --gamut-gradient-stops lists the 9 results, for linear-gradient(to right, var(--gamut-gradient-stops)).
const STOPS = 9;
export function stopsPart(m = minde()) {
  const z = (k) => `--gamut--z${k}`;
  const own = (t, k) => t.replace(/--gamut--(m\d+|e|o|f\d+|g|src|n)(?![\w-])/g, `${z(k)}$1`).replace(/--gamut--lin(?![\w-])/g, '--gamut--glin').replaceAll(SEED, `var(${z(k)}in)`);
  const ks = [...Array(STOPS).keys()], list = (f) => ks.map(f).join(', ');
  // #1332, an easing between the two: stop k mixes at E(k/8), a paused animation of a registered number from 0 to 1 at
  // time k/8 of 1s with --gamut-gradient-ease as its timing function, so the browser evaluates any <easing-function>
  // exactly (all three engines). The shorthand holds the input in every entry: with none
  // set it is invalid at computed-value time, no animation runs, and each stays at its initial k/8 (linear). Clamped to
  // 0..1: a color-mix() can't extrapolate an overshoot. Color hints between the stops, to bend each piece toward E,
  // were tried and dropped: Chrome 155 and Firefox 158 then interpolate in sRGB
  const pct = (k) => `${(100 * k) / (STOPS - 1)}%`, q = (k) => `--gamut--q${k}`;
  const mix = (k, from, to, hue) => `color-mix(in oklch${hue ? ` ${hue}` : ''}, ${from}, ${to} calc(clamp(0, var(${q(k)}), 1) * 100%))`;
  const reg = (n) => `@property ${n} { syntax: '<color>'; inherits: false; initial-value: black; }`;
  // --gamut-gradient-hue as a keyword (any case) or as color-mix() writes it (`longer hue`): a mix with each reading,
  // registered so that the one that doesn't parse is its initial value, a color all of whose components are missing,
  // which a mix of the two fills from the other; neither (an invalid value): shorter, a mix weighted 0%. Written with
  // initial-value before inherits, so nest() (registered colors of one reader only) leaves them registered
  const none = (n) => `@property ${n} { syntax: '<color>'; initial-value: oklch(none none none / none); inherits: false; }`;
  const word = (k) => `--gamut--z${k}w`, phrase = (k) => `--gamut--z${k}p`;
  // the ends: a missing or powerless hue filled from the other end's (CSS Color 4 §12.4 does the same in the mix):
  // WebKit 26.4 goes round no hue with `longer` from a missing one (QUIRKS.md Q71) but does from two equal ones; registered,
  // so each is worked out once, not in each of the 27 mixes that read it (fit-gradient 3,104 -> 2,921 µs in Chrome 155)
  const ends = ['color-mix(in oklch, var(--gamut-gradient-from) 100%, var(--gamut-gradient-to) 0%)', 'color-mix(in oklch, var(--gamut-gradient-to) 100%, var(--gamut-gradient-from) 0%)'];
  const regs = ks.flatMap((k) => [z(k), ...m.regs.map((n) => own(n, k))]);
  // and --gamut-gradient-space, the target's own RGB space: a gradient interpolated in it stays inside the target
  // between its stops, as its cube is convex there (in oklab the colors between two fitted stops left sRGB by up to
  // 0.0204 of a channel, a test's oklch(0.75 0.3 145) to oklch(0.55 0.3 285), Chrome 155 and WebKit 26.4)
  const target = (sel) => `${sel} { --gamut--glin: srgb-linear; --gamut-gradient-space: srgb; }
@supports (color: color(display-p3-linear 1 0 0)) {
@media (color-gamut: p3) { ${sel} { --gamut--glin: display-p3-linear; --gamut-gradient-space: display-p3; } }
${['srgb', 'display-p3'].map((g) => `@container style(--gamut-target: ${g}) { ${sel} { --gamut--glin: ${g}-linear; --gamut-gradient-space: ${g}; } }`).join('\n')}
}
${['rec2020', 'a98-rgb', 'prophoto-rgb'].map((g) => `@container style(--gamut-target: ${g}) { ${sel} { --gamut--glin: ${g}; --gamut-gradient-space: ${g}; } }`).join('\n')}`;
  return `/* Mapped gradient stops; #9449 (its authors' linear-gradient(in oklch, A, B), whose colors between A and B the
   browser clips). .fit-gradient: In: --gamut-gradient-from, --gamut-gradient-to (colors), --gamut-gradient-hue (shorter, longer, increasing or
   decreasing; default shorter); the target from --gamut-target on an ancestor, as .fit-screen. Out: --gamut-gradient-stops, 9
   colors for linear-gradient(in var(--gamut-gradient-space) to right, var(--gamut-gradient-stops)): the oklch
   interpolation of the two at t = 0, 1/8 ... 1, each mapped as .fit-screen maps; --gamut-gradient-space, the target's RGB
   space. Where a browser lacks the mapping, the 9 colors unmapped.
   --gamut-fit-gradient(<from>, <to>, <hue>?, <gamut>?): the same list from --gamut-fit-screen(), where @function parses,
   by the css method as the class's stops (left out, the method was the ancestor's --gamut-method: an audit,
   2026-10-28, adaptive there gave stops 5.66/255 off the class's).
 */
${regs.map(reg).join('\n')}
${ks.map((k) => `@property ${q(k)} { syntax: '<number>'; inherits: false; initial-value: ${k / (STOPS - 1)}; }
@keyframes gamut-q${k} { from { ${q(k)}: 0; } to { ${q(k)}: 1; } }`).join('\n')}
${ks.flatMap((k) => [word(k), phrase(k)]).map(none).join('\n')}
${['--gamut--ga', '--gamut--gb'].map(none).join('\n')}
.fit-gradient {
  --gamut--ga: ${ends[0]};
  --gamut--gb: ${ends[1]};
  ${ks.map((k) => [`${word(k)}: ${mix(k, 'var(--gamut--ga)', 'var(--gamut--gb)', 'var(--gamut-gradient-hue, shorter) hue')};`, `${phrase(k)}: ${mix(k, 'var(--gamut--ga)', 'var(--gamut--gb)', 'var(--gamut-gradient-hue)')};`,
    `${z(k)}in: color-mix(in oklch, color-mix(in oklch, var(${word(k)}), var(${phrase(k)})) 100%, ${mix(k, 'var(--gamut--ga)', 'var(--gamut--gb)')} 0%);`].join('\n  ')).join('\n  ')}
  --gamut-gradient-stops: ${list((k) => `var(${z(k)}in)`)};
  --gamut-gradient-space: srgb;
}
/* the samplers' animation, a shorthand with --gamut-gradient-ease in each entry: with none set (or one that isn't an
   easing) it is invalid at computed-value time, no animation runs, and each sampler stays at its initial k/8, linear,
   whatever a page does to animations. In a layer of its own and !important: a page's own reset of animations (the
   reduced-motion * { animation-duration: 0.01ms !important }), unlayered or in a layer named after gamutant, loses to it,
   where it sent eight stops of an eased gradient to the end color (a review, 2026-10-29). Only beside .gradient-ease:
   on .fit-gradient alone a page's own animation on the element ran as none, eased or not (an audit, 2026-10-30) */
@layer gamutant {
.fit-gradient.gradient-ease {
  animation: ${list((k) => `gamut-q${k} 1s var(--gamut-gradient-ease) ${-k / (STOPS - 1)}s 1 normal both paused`)} !important;
}
}
@supports ${GUARD_MINDE} {
.fit-gradient {
  ${ks.map((k) => [`${z(k)}src: oklch(from var(${z(k)}in) l min(c, 4) h / none);`, ...m.decls.map((d) => own(d, k)), `${z(k)}: ${own(m.out, k)};`].join('\n  ')).join('\n  ')}
  --gamut-gradient-stops: ${list((k) => `var(${z(k)})`)};
}
@supports (-moz-orient: inline) { .fit-gradient {
  ${ks.map((k) => [m.fused.map((n) => `${own(n, k)}: initial;`).join(' '), ...m.ff.map((d) => own(d, k)), `${z(k)}: ${own(m.outFirefox, k)};`].join('\n  ')).join('\n  ')}
} }
${target('.fit-gradient')}
}
/* the hue method's two readings and shorter, in a function: a typed result that doesn't parse is guaranteed-invalid, so
   var() takes its fallback */
@function --gamut--gradient-try(--a, --b, --p, --h) returns <color> { result: color-mix(in oklch var(--h), var(--a), var(--b) var(--p)); }
@function --gamut--gradient-mix(--a, --b, --p, --h) returns <color> {
  --gamut--x: --gamut--gradient-try(var(--a), var(--b), var(--p), var(--h) hue);
  --gamut--y: --gamut--gradient-try(var(--a), var(--b), var(--p), var(--h));
  result: var(--gamut--x, var(--gamut--y, color-mix(in oklch, var(--a), var(--b) var(--p))));
}
@function --gamut-fit-gradient(--gamut-gradient-from, --gamut-gradient-to, --gamut-gradient-hue: shorter, --gamut: var(--gamut-target, screen)) {
  result: ${list((k) => `--gamut-fit-screen(--gamut--gradient-mix(var(--gamut-gradient-from), var(--gamut-gradient-to), ${pct(k)}, var(--gamut-gradient-hue)), var(--gamut), css)`)};
}`;
}
