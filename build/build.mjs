// Builds ../gamutant.css: the mapper (.fit-screen), palette steps (.palette-step), contrast.css (.readable-text),
// scale.css (.color-interpolate) and the other parts. Usage: node build/build.mjs (npm run build also writes parts/)
// --plain writes gen/gamutant.plain.css instead, to read: the folding passes skipped and every comment kept, each step
// under the name its part gives it (fit-screen's --gamut--m1 to m11, the halvings). It computes what gamutant.css does:
// 46 of the 48 checks pass on it, constants (52 of its 59 distinct rows matched, the floor is the folded sheet's 60) and
// ends (a timeout in the full run; alone 22 of 22 and 12 of 12) apart (2026-11-01). Not shipped: 955 KB to 793.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { nest, across, share } from './lib/fold.mjs';
import { steps as stepGraph, REGISTERED } from './lib/steps.mjs';
import { allocate } from './lib/lanes.mjs';
import { OKHSL_GAMUTS } from './okhsl-fit.mjs';

// Two searches. .fit-screen maps a color with CSS Color 4's gamut mapping (minde() below: binary search with local
// MINDE, the answer Color.js 0.7.1's 'css' method gives). .screen-edge (with --gamut-rel) needs the
// gamut's edge itself (how much chroma fits at a lightness and hue): mapper() below. Separate classes, so .fit-screen
// never pays for the edge (a dormant chain gated by an unset var() still cost Chrome 20 us a color to substitute). The two answers differ: MINDE stops
// where the color is a just-noticeable difference (deltaEOK 0.02) from its clip and clips it, so it stays more vivid
// (Ray Trace and EdgeSeeker land within a few of 255 of the edge).

// The edge: the gamut boundary at the color's own L and h, by 6 chroma halvings and one secant step.
// A test converts the point to the target's linear RGB (channels unclamped); its alpha is min(r, g, b, 1 - max(r, g, b)),
// which the alpha clamp leaves above 0 in gamut and at 0 out, and the next point steps up or down by sign(alpha). After 6
// tests the edge is in [lo, lo + 1/128]. Each channel's crossing there is a secant between the two ends: -log(its
// distance to the nearest face) at lo and log(how far out it is) at the top, mixed half and half in linear RGB, give
// log(out / distance) / 2 a channel, and the earliest crossing is t = 1 / (1 + exp(2 max(r, g, b))) of the bracket (the
// trial's log secant). Out: the input's own l and h through a color-mix() whose `none` channels take them, chroma
// k x edge, the input's own chroma ignored: #11946's relative chroma, "for a lightness of 80% and a hue of 20, I want a
// color with the maximum chroma possible in the P3 gamut" (its opening post; postcss-oklch-relative-chroma), RC = k.
// Linear RGB, not the gamut's gamma encoding: there the secant needs 8 tests. test/mapper-check.mjs and test/ref/methods.mjs check it.
const TESTS = 6, W = (k) => 0.5 / 2 ** (k + 1); // test k steps by W(k): 0.25, 0.125 ... 0.0078125
// rec2020, a98-rgb and prophoto-rgb have no linear form CSS parses, so for them (--gamut--lin: srgb-linear) a test reads
// the target's linear channels from srgb-linear's by its matrix, set as text (secRows() below: --gamut--dist, the same
// distance as 0.5 - max(|R - 0.5|, |G - 0.5|, |B - 0.5|), which names each row once, and --gamut--sec-r, -g, -b, the rows,
// for the secant); unset, the text as before. Not the encoded channels: WebKit 26.4 converts to rec2020 and prophoto-rgb
// with negative channels as 0 (oklch(0.22198 0.1 92.79) to prophoto-rgb 0.096078 0.07467 0), and the next step reads the
// point back from that clipped color (relative chroma to rec2020 came out up to 16/255 off)
const X = Object.fromEntries(['r', 'g', 'b'].map((x) => [x, `var(--gamut--sec-${x}, ${x})`]));
const DIST = 'var(--gamut--dist, min(r, g, b, 1 - max(r, g, b)))';
const test = (from, flag = DIST) => `color(from ${from} var(--gamut--lin) r g b / ${flag})`;
// What the mapper needs, as one @supports test: relative colors with none, srgb-linear, min/max in alpha, sign(),
// log(), exp() in channels, a color-mix() in a linear space; an engine without one of them keeps the input. P3 also
// needs display-p3-linear: without it the target stays sRGB.
export const GUARD = `(color: color(from oklch(from red l c h / none) srgb-linear calc(-1 * log(max(0.000000000001, min(r, 1 - r)))) calc(sign(g)) b / min(r, g, b, 1 - max(r, g, b)))) and (color: color(from color-mix(in srgb-linear, oklch(0.5 0.1 30 / none), oklch(none none none / 0.5)) srgb-linear 0 0 0 / calc(1 / (1 + exp(2 * max(r, g, b))))))`;
export const SEED = 'var(--gamut-in, oklch(var(--gamut-l, 0.5) var(--gamut-c, 0) var(--gamut-h, 0)))';
// The input as the mappers read it, registered once (--gamut--in0): a `none` hue as 0 in the input's own space. WebKit
// 26.4 converts a `none` hue in lch() or oklch() as grey (QUIRKS.md Q3), lightness included (lch(50 200 none) as
// oklch(0.569 0 0)), unless a relative color in that same space reads it first, and an lch() hop greys an oklch() none
// hue as an oklch() hop greys an lch() one; hsl() and hwb() convert right. So two readings mixed in OKLab: through oklch
// at alpha 1, or 0 where it came out grey (chroma 1e-6 or less), and through lch at alpha 1e-6, its chroma capped at 400
// (oklch(0.7 1e9 30) comes back from the lch hop with lightness 0): it weighs 1e-6 of the first where both are right,
// and all where the first is grey; lightness rounded to 1e-6, so that 0 and 1 (CSS Color 4 §14.2.2's black and white)
// stay exact. Kept as oklch, as the mappers read it. (Three readings with flags weighing 0 or 1, exact, made a currentColor page load in
// 580 ms in WebKit, over the load bound its checks hold, 2 x 110 + 300 ms; this, 470 ms.) share() would take an `lch(from X …
// / 1)` inside `oklch(from X … / 1)`: the lch hop has no `/ 1`.
const GREY = 'clamp(0, sign(c - 0.000001), 1)';
export const IN0 = `oklch(from color-mix(in oklab, oklab(from oklch(from ${SEED} l c h / ${GREY}) l a b / alpha), oklab(from lch(from ${SEED} l min(c, 400) h) l a b / 0.000001)) round(l, 0.000001) c h / 1)`;
// .screen-edge's input: the input's l and h; its chroma counts only to tell a grey (#11946's chroma is relative, so a
// grey's hue picks the edge). A grey's hue is 0 (CSS Color 4 §4.4.1: a hue a conversion leaves powerless is missing,
// which behaves as 0), or the hue written where the input is an oklch() of chroma 0 (§4.4.1: a powerless component
// manually specified acts as normal). Grey is a chroma of 1e-4 or less in IN0, not the spec's 4e-6: Chrome 155 and
// Firefox 158 convert white to chroma 5e-5.
// IN0 loses a written grey's hue (Chrome reads oklch(0.6 0 120) as hue 315), so that hue is read from the input as
// given, where its own oklch() chroma is exactly 0. The two hues, each 0 where it doesn't apply, are summed as
// lightnesses (h / 360, below 1) in a 50% oklch mix and read back times 720. Registered (--gamut--se): as --gamut--src's
// text, read three times, it took Chrome from 92 to 110 µs a color.
const EDGE_SRC = `oklch(from color-mix(in oklch, oklch(from var(--gamut--in0) l c none / none), oklch(from color-mix(in oklch, oklch(from var(--gamut--in0) calc(h * clamp(0, sign(c - 0.0001), 1) / 360) none none / 1), oklch(from ${SEED} calc(h * (1 - sign(c)) / 360) none none / 1)) none none calc(l * 720) / 1)) l c h / none)`;
// Below lightness EDGE_L the edge is searched at EDGE_L and scaled to the input's own: in OKLab a ray from black in
// linear light is a ray from black, so under every target's lowest primary (prophoto-rgb's blue, L 0.217) the gamut is
// a cone and the edge's chroma is L times its chroma at L 1, exactly. Searched at its own lightness, a near-black edge
// fell inside the halvings' last bracket, 0.0078 wide: at L 0.001 h 0 in sRGB 0.0000886 for 0.000405 (an
// audit, 2026-10-28)
const EDGE_L = 0.15;
const STEPS = 24; // palette steps the fallback numbers without sibling-index() (README.md: 24)
export function mapper() {
  // The first point is chroma W0 at the input's own l and h, by a mix, not back through the linear test color: for a
  // vivid input (oklch(0.52 1.2 220)) that round trip moved the hue, and the whole search ran at it, up to 4.9/255 off (a
  // search, 2026-10-26). Along some hues the line leaves the gamut and comes back (pure blue, #0000ff, is in gamut at chroma
  // 0.313 with a first exit at 0.265): the halvings land on one crossing, test/mapper-check.mjs measures which.
  // The search spans chroma 0 to 0.5, the most sRGB, Display P3, rec2020 (0.464) and a98-rgb have; prophoto-rgb's edge
  // reaches 1.49, so there its steps are 3 times as wide (--gamut--w0 to w5, and --gamut--sw: 3, by which the bracket's
  // low end rides in alpha, which stops at 1); unset, the same text as before.
  const Wv = (k) => `var(--gamut--w${k}, ${W(k)})`, SW = 'var(--gamut--sw, 1)';
  let expr = `color-mix(in oklch, oklch(from var(--gamut--src) l none h / none), oklch(none ${Wv(0)} none / 1))`;
  for (let k = 0; k < TESTS; k++) {
    const last = k === TESTS - 1, lo = `c + (sign(alpha) - 1) * ${Wv(k)}`;
    // (lo / sw written out: share() takes a parenthesized lo here and calc(lo) above as one expression, and
    // leaves `calcvar(...)`)
    expr = `oklch(from ${test(expr)} ${last ? 'none' : 'l'} calc(${last ? lo : `c + (sign(alpha) - 0.5) * ${Wv(k)}`}) ${last ? `none / calc(c / ${SW} + (sign(alpha) - 1) * ${W(k)} + 0.5)` : 'h'})`;
  }
  // The register keeps the input's own hue and lightness: a conversion that drops a near-grey point's hue (oklch(0.984
  // 0.0078 h) came back with hue 0 in Safari) would put the secant's two ends at the wrong hue, and Firefox's round trips
  // through srgb-linear moved the lightness of a point far past sRGB (oklch(0.297419 0.31 238.33) to 0.295837, which put
  // its prophoto-rgb edge 1.15/255 off).
  expr = `color-mix(in oklch, ${expr}, oklch(from var(--gamut--src) l none h / none))`;
  const w = W(TESTS - 1), floor = (e) => `max(0.000000000001, ${e})`;
  const low = `color(from var(--gamut--p) var(--gamut--lin) ${['r', 'g', 'b'].map((x) => `calc(-1 * log(${floor(`min(${X[x]}, 1 - ${X[x]})`)}))`).join(' ')})`;
  const high = `color(from oklch(from var(--gamut--p) l calc(c + ${Wv(TESTS - 1)}) h) var(--gamut--lin) ${['r', 'g', 'b'].map((x) => `log(${floor(`-1 * ${X[x]}, ${X[x]} - 1`)})`).join(' ')})`;
  const mix = `color-mix(in var(--gamut--lin), ${low}, ${high})`;
  // Out, carried in alpha: the register's alpha holds lo / sw + 0.5, the secant adds w t / sw, a color-mix() brings the
  // input's own l and h, and out comes chroma k x edge.
  const edge = `color(from ${mix} var(--gamut--lin) 0 0 0 / calc(alpha + ${w} / (1 + exp(2 * max(r, g, b)))))`;
  // (the input's own lightness from --gamut--se, and the edge scaled to it below EDGE_L: see .screen-edge's input)
  const out = `oklch(from color-mix(in oklch, var(--gamut--se), oklch(from ${edge} none none none / alpha)) l calc((alpha - 0.5) * ${SW} * var(--gamut--k) * l / max(l, ${EDGE_L})) h / 1)`;
  // Out for Firefox, carried in channels: Firefox serializes a registered color's alpha and a color-mix()'s to 2 or 3 decimals
  // (0.632812 comes back 0.63), which put 448 of 2,855 colors up to 28/255 off. Only the secant's fraction t rides in
  // alpha (rounded, it moves the edge by w / 255 at most); a color-mix() of none channels gathers the bracket's low end
  // as c and t as alpha in one color, which takes k (c + w t); a last mix sets it as the chroma of the input's l and h.
  // (A mix whose colors both have a none alpha zeroes the channels, so one of them never does.)
  const t = `oklch(from color(from ${mix} var(--gamut--lin) 0 0 0 / calc(1 / (1 + exp(2 * max(r, g, b))))) none none none / alpha)`;
  const gather = `color-mix(in oklch, oklch(from var(--gamut--p) none c none / none), ${t})`;
  const fit = `oklch(from ${gather} none calc(var(--gamut--k) * (c + ${Wv(TESTS - 1)} * alpha)) none / none)`;
  const outFirefox = `oklch(from color-mix(in oklch, oklch(from var(--gamut--se) l none h / 1), ${fit}) l calc(c * l / max(l, ${EDGE_L})) h / 1)`;
  return { p: expr, out, outFirefox };
}

// .screen-edge whole, as gamutant.css writes it: the input (--gamut--in0, --gamut--se,
// --gamut--src, --gamut--k), the search point, and out clipped to the target and keeping the input's alpha (palette steps
// are made colors: opaque). edge.css once took mapper() alone and painted black after --gamut--se came in (a review,
// 2026-10-31).
export function screenEdge() {
  const { p, out, outFirefox } = mapper();
  // the edge clipped to the target last, in its own channels (an estimate can land just past it: prophoto-rgb at L 0.96
  // h 95 gave blue -0.017 encoded, an audit, 2026-10-28); a point inside is itself
  const edgeClip = (x) => `oklch(from color(from ${x} var(--gamut--clip, var(--gamut--lin)) clamp(0, r, 1) clamp(0, g, 1) clamp(0, b, 1)) l c h / 1)`;
  const alphaIn = (x) => `oklch(from color-mix(in oklch, ${x.replace(/ \/ 1\)$/, ' / none)')}, oklch(from ${SEED} none none none / calc(0.5 + alpha / 2))) l c h / calc(2 * alpha - 1))`;
  return { src: [`--gamut--in0: ${IN0};`, `--gamut--se: ${EDGE_SRC};`, `--gamut--src: oklch(from var(--gamut--se) max(l, ${EDGE_L}) c h / none);`, '--gamut--k: var(--gamut-rel, 1);'],
    p, out: alphaIn(edgeClip(out)), outFirefox: alphaIn(edgeClip(outFirefox)) };
}

// The spec's mapper (.fit-screen): CSS Color 4 §14.2.1, binary search with local MINDE. The test at a point p: its clip
// in the target's linear RGB and its negation in OKLab (1 - l, -a, -b), mixed half and half in OKLab, hold half the
// OKLab difference (l offset by 0.5), so deltaEOK(p, clip(p)) < 0.02 is hypot(l - 0.5, c) < 0.01 (in gamut it is 0: the
// in-gamut test is the same test). Both chains search as the spec does, over [0, the input's chroma], stopping where
// Color.js returns (E within 0.0001 under 0.02). 11 halvings, a twelfth test whose distance is kept, the
// bracket's other end tested, and a secant on E between them aimed at 0.01995: Color.js returns the first midpoint whose
// E is within 0.0001 below 0.02, so its answer lies in that band, and the middle of it agrees best (4 of 400,000
// out-of-gamut colors more than 2/255 off Color.js, worst 4/255, each a Color.js early return somewhere in a band wider
// than the bracket; 6 halvings aimed at 0.02 were 34, worst 10; test/ends-check.mjs holds the ends). Chrome and WebKit
// (one fused chain): the point's chroma rides in the difference's alpha (the negation has alpha c, the clip none, so
// both mix at alpha c and the difference is unweighted), and the next point is that chroma plus or minus the step at the
// input's l and h, one color-mix() a test. Firefox rounds that alpha, so there the test is a flag in alpha (0.25 or
// 0.75, which rounding keeps on its side of 0.5) mixed into the point, and the answer leaves in channels. Out: chroma
// min(c, c*) at the input's l and h (0 at l >= 1 or l <= 0: white, black), clipped.
// Returns the registers, the declarations, the output, Firefox's declarations and output, the fused chain's
// registers (Firefox sets them to initial: it doesn't use them), and c* (where the search stops, as 2 * alpha - 1).
export function minde(N = 12) {
  // the input is tested too, as the spec's first step: within a JND of its clip (in gamut: 0), the input's chroma stands
  // and the output is its clip. A stricter test (0.0001) missed colors at the edge, and Firefox's in-gamut ones by its
  // precision (a fuzz of 30,000 colors a target, 2026-10-26). Without the test, a search that
  // stopped early still gave the input back below chroma 0.5 (E stays under 0.00088 there), but ProPhoto's edge bends:
  // oklch(0.329 0.955 195) is inside it and fails tests on the way up (a fuzz against Color.js, 2026-10-26)
  // S doubles W's [0, 0.5] to [0, 1]: both chains search t there, a fraction of the input's chroma. 11 halvings: Color.js sometimes needs 11 midpoints to reach its band; with 10 a
  // search (2026-10-26) left sRGB at 2.0/255, with 9 four targets over 2/255
  const S = 2, w = S * W(N - 1), LIN = 'var(--gamut--lin)', M = (k) => `var(--gamut--m${k})`, F = (k) => `var(--gamut--f${k})`;
  const clip = (p, a) => `color(from ${p} ${LIN} clamp(0, r, 1) clamp(0, g, 1) clamp(0, b, 1) / ${a})`;
  // Chrome and WebKit search t, a fraction of the input's own chroma, as the spec's bracket [0, the input's chroma]: a
  // point is the input at chroma c_in * t with t in its alpha (at())
  const half = (p, carry) => `color-mix(in oklab, ${clip(p, carry ? 'none' : '1')}, oklch(from ${p} calc(1 - l) c calc(h + 180) / ${carry ? 'alpha' : '1'}))`;
  const at = (t) => `oklch(from color-mix(in oklch, var(--gamut--src), ${t}) l calc(c * alpha) h / alpha)`;
  const M0 = `oklch(from var(--gamut--src) l calc(c * 0.5) h / 0.5)`;
  // A test names its point once, so that a step names the last once: an input that stays unresolved (currentColor; a
  // registered color keeps it so) carries the chain as text, which then grows by a step a step instead of doubling
  //. The point's clip, in OKLab, scaled by u / t in lightness and 1 / t^2 in a and b,
  // mixed half and half with the input's own (1 - l) u, -a, -b: the mix premultiplies by alpha (t, and 1), so its
  // numerators are u (l_clip + 1 - l), a_clip / t - a and b_clip / t - b over its alpha (t + 1) / 2, and t is 2 alpha - 1:
  // E = deltaEOK(point, clip) = hypot(dl, t da, t db) (u = 2^-12, the least t, keeps the scaled lightness under 1)
  const u = 2 ** -12;
  const test = (p) => `color-mix(in oklab, oklab(from ${clip(p, 'alpha')} calc(l / alpha / ${1 / u}) calc(a / (alpha * alpha)) calc(b / (alpha * alpha)) / alpha), oklab(from var(--gamut--n) calc(l / ${1 / u}) a b / 1))`;
  const E = `hypot(${2 / u} * alpha * l - 1, (4 * alpha - 2) * alpha * c)`;
  // the step's direction: up below the spec's band (JND - E < 0.0001), down above it, 0 in it, where (0.01995 - E) x
  // 20000 rounds to 0 (a ramp toward its middle in place of a stop cost 23 ProPhoto misses up to 48/255, a search, 2026-10-26)
  const step = `sign(round(to-zero, 399 - 20000 * ${E}))`;
  const fused = ['--gamut--n', ...Array.from({ length: N - 1 }, (_, k) => `--gamut--m${k + 1}`), '--gamut--e', '--gamut--o'];
  // the input's own side of every test, once; scaled by u in each (WebKit keeps a registered color to 6 decimals)
  const decls = [`--gamut--n: oklab(from var(--gamut--src) calc(1 - l) calc(-1 * a) calc(-1 * b) / 1);`];
  for (let k = 0; k < N - 1; k++) {
    // a register is t (alpha) alone. A point whose E lands in the spec's band is where Color.js returns: its step is 0,
    // so the next test sees the same point and stops too
    decls.push(`--gamut--m${k + 1}: oklch(from ${test(k ? at(M(k)) : M0)} none none none / calc(2 * alpha - 1 + ${S * W(k) / 2} * ${step}));`);
  }
  // the twelfth test keeps E / 2 as l and t as alpha; the other end of the bracket is tested; c* by a secant
  decls.push(`--gamut--e: oklch(from ${test(at(M(N - 1)))} calc(${E} / 2) none none / calc(2 * alpha - 1));`);
  decls.push(`--gamut--o: ${at(`oklch(from var(--gamut--e) none none none / calc(alpha + ${w} * sign(0.01 - l)))`)};`);
  // the input's own test rides in the hue: 180 in gamut, 0 (or 90 at the edge) out
  const inFlag = `oklch(from ${test('oklch(from var(--gamut--src) l c h / 1)')} none none calc(90 - 90 * sign(${E} / 2 - 0.01)) / none)`;
  const both = `color-mix(in oklch, color-mix(in oklch, var(--gamut--e), oklch(from ${test('var(--gamut--o)')} none calc(${E} / 2) none / none)), ${inFlag})`;
  // c* rides as 0.5 + c* / 2: alpha stops at 1, and c* reaches 1
  // (an input in gamut packs as alpha 1, read back as its own chroma)
  const cstar = `oklch(from ${both} none none none / calc(max((alpha + ${w} * clamp(-1, (0.009975 - l) / max(0.000001, abs(c - l)), 1) * (1 - clamp(0, sign(l - 0.00995), 1) * clamp(0, sign(0.01 - l), 1))) / 2 + 0.5, clamp(0, (h - 170) / 10, 1))))`;
  // the input's alpha comes back last: the chain re-reads the input with alpha none (alpha carries the search), so the
  // mapped color leaves with alpha none and a color-mix() of none channels gives it the input's (the spec keeps it). The
  // alpha rides as 0.5 + alpha / 2 and is unpacked after: Chrome mixes to alpha 0 as transparent black, dropping the color
  const alphaIn = alphaLin;
  const out = alphaIn(clip(`oklch(from color-mix(in oklch, var(--gamut--src), ${cstar}) l calc(c * clamp(0, 2 * alpha - 1, 1) * max(0, sign(l * (1 - l)))) h / 1)`, 'none'));
  // Firefox's chain (alpha rounds there: QUIRKS.md Q4): a register is oklch(c_in / 4, t, h), t the fraction of the
  // input's chroma in the chroma channel; a point is the input at chroma c * l * 4. The step's direction rides in alpha
  // as 0.75 (up), 0.5 (in the band: stop) or 0.25 (down), which rounding keeps apart.
  const cand = (X) => `color-mix(in oklch, oklch(from var(--gamut--src) l none h / 1), oklch(from ${X} none calc(c * l * 4) none / none))`;
  const ff = [`--gamut--f0: oklch(from var(--gamut--src) calc(c / 4) 0.5 h / none);`];
  const dir = '((sign(alpha - 0.625) + sign(alpha - 0.375)) / 2)';
  for (let k = 0; k < N; k++) {
    const flag = `oklch(from ${half(cand(F(k)))} none none none / calc(0.5 - 0.125 * (sign(hypot(l - 0.5, c) - 0.00995) + sign(hypot(l - 0.5, c) - 0.01))))`;
    const step = k === N - 1 ? `c + (${dir} - 1) * abs(${dir}) * ${S * W(k) / 2}` : `c + ${dir} * ${S * W(k) / 2}`;
    ff.push(`--gamut--f${k + 1}: oklch(from color-mix(in oklch, ${F(k)}, ${flag}) l calc(${step}) h / none);`);
  }
  const lo = F(N), hi = `oklch(from ${lo} l calc(c + ${w}) h / none)`;
  const Elo = `oklab(from ${half(cand(lo))} calc(2 * hypot(l - 0.5, a, b)) none none / 1)`;
  const Ehi = `oklab(from ${half(cand(hi))} none calc(2 * hypot(l - 0.5, a, b)) none / 1)`;
  const G = `color-mix(in oklab, color-mix(in oklab, ${Elo}, ${Ehi}), oklab(from ${lo} none none calc(hypot(a, b)) / 1))`;
  // t* by the secant, kept where lo stopped in the band
  const cs = `oklab(from ${G} 0.5 calc(b + ${w} * clamp(0, (0.01995 - l) / max(0.000001, a - l), 1) * (1 - clamp(0, sign(l - 0.0199), 1) * clamp(0, sign(0.02 - l), 1))) 0 / 1)`;
  // (written hypot - k: Firefox 158 gets sign(k - hypot(...)) wrong, +1 where hypot > k; sign(hypot(...) - k) right)
  // Firefox keeps the input's own test as a flag in alpha, as its search does: the gather (alpha 1) mixed with the flag
  // (0.75 in gamut, 0.25 out) leaves alpha 0.875 or 0.625 (two none alphas would zero the channels)
  const inFlagFirefox = `oklch(from ${half('var(--gamut--src)')} none none none / calc(0.5 - 0.25 * sign(hypot(l - 0.5, c) - 0.01)))`;
  ff.push(`--gamut--g: ${inFlagFirefox};`); // its own register: one more level of nesting in the output and Firefox drops it
  // the input's chroma rides in the chroma channel (lightness stops at 1, chroma doesn't), t* in lightness (at most 1)
  const fit = `oklch(from color-mix(in oklch, color-mix(in oklch, oklch(from var(--gamut--src) none c none / 1), oklch(from ${cs} c none none / none)), var(--gamut--g)) none calc(c * max(min(1, l), clamp(0, sign(alpha - 0.75), 1))) none / none)`;
  const outFirefox = alphaIn(clip(`oklch(from color-mix(in oklch, oklch(from var(--gamut--src) l none h / 1), ${fit}) l calc(c * max(0, sign(l * (1 - l)))) h / 1)`, 'none'));
  const regs = [...fused, ...Array.from({ length: N + 1 }, (_, k) => `--gamut--f${k}`), '--gamut--g'];
  return { regs, decls, out, ff, outFirefox, fused, cstar };
}
// the input's alpha on a mapped color whose alpha is none: it rides as 0.5 + alpha / 2 and is unpacked after (Chrome mixes
// to alpha 0 as transparent black, dropping the color)
const alphaLin = (x, S = 'var(--gamut--lin)') => `color(from color-mix(in ${S}, ${x}, color(from ${SEED} ${S} none none none / calc(0.5 + alpha / 2))) ${S} r g b / calc(2 * alpha - 1))`;

// The cusp of a hue (its color of most chroma) on the target's cube: on the hexagon of the cube's edges ((1, u, 0) and so
// on in linear light, position s in [0, 6)), the s whose OKLCH hue is the color's. s starts from knots by hue
// (seekStart(), seeker/start.mjs's knots: on the cyan-blue edge on a square-root scale, below the hue's peak there), then
// Newton steps, the slope from a second point at s + 0.001. The hues meet in one color-mix() (the point's as hue, the
// second's / 360 as l, the color's as 0.25 + h / 720 as c, from t, which keeps the hue from being powerless). s rides in
// a linear channel (Firefox rounds alpha through registers and color-mix(), so alpha only crosses from one space to
// another inside nested relative colors). EdgeSeeker's cusp and curve point (light 0.75 on the
// hexagon a + (1 - a) times that) are found this way.
const n9 = (x) => +x.toPrecision(9);
export function seekStart(K, hp, digits = 9) {
  const u0 = K[0].h, terms = [], n9 = (x) => +x.toPrecision(digits);
  for (let i = 0; i < K.length - 1; i++) {
    const a = K[i], b = K[i + 1], ds = n9(b.s - a.s), ua = n9(a.h - u0), ub = n9(b.h - u0);
    if (!ds) continue;
    if (ub - ua < 1e-9) terms.push(`${ds} * clamp(0, (h - ${ua}) * 100000, 1)`);
    else if (hp !== undefined && Math.floor(a.s) === 3 && Math.sqrt(Math.max(0, hp - a.h)) - Math.sqrt(Math.max(0, hp - b.h)) > 1e-6) { const z = (x) => Math.sqrt(Math.max(0, hp - x)), za = n9(z(a.h)), zb = n9(z(b.h));
      terms.push(`${ds} * clamp(0, (${za} - sqrt(max(0, ${n9(hp - u0)} - h))) / ${n9(za - zb)}, 1)`); }
    else terms.push(`${ds} * clamp(0, (h - ${ua}) / ${n9(ub - ua)}, 1)`);
  }
  return { expr: terms.join(' + '), h0: n9(u0) };
}
export function hexagon(t, A, LIN = 'var(--gamut--lin)', D = 0.001, P = null) {
  // the hexagon is written for s in [-1, 7], no mod()
  const hex = (s, light) => [`clamp(0, abs(${s} - 3) - 1, 1)`, `clamp(0, 2 - abs(${s} - 2), 1) + clamp(0, ${s} - 6, 1)`, `clamp(0, 2 - abs(${s} - 4), 1) + clamp(0, -1 * ${s}, 1)`]
    .map((e) => (light === 0.5 ? `calc(${e})` : typeof A === 'string' ? `calc(${A} + (1 - ${A}) * (${e}))` : `calc(${A} + ${n9(1 - A)} * (${e}))`))
    // P: each channel to the power P, so s runs along an edge in (about) linear light where LIN is encoded (EdgeSeeker to
    // a98-rgb: in its pure power curve the hue doesn't move near a corner, and Newton from there overshot, 21/255)
    .map((e) => (P ? `pow(${e}, ${P})` : e));
  const E = (st, light, d = 0) => `color(from ${st} ${LIN} ${hex(d ? `(r + ${d})` : 'r', light).join(' ')} / 1)`;
  // the color's hue minus the point's, and the second point's minus the point's
  const e1 = '(mod(h - (c - 0.25) * 720 + 540, 360) - 180)', de = '(mod(l * 360 - h + 540, 360) - 180)';
  // a Newton step: the two points' hues and the color's in one color, the step (within +-3) in a relative color's
  // alpha, read into a linear channel beside s
  const step = (st, light) => {
    const z = `color-mix(in oklch, color-mix(in oklch, oklch(from ${E(st, light)} none none h / 1), oklch(from ${E(st, light, D)} calc(h / 360) none none / none)), ${t})`;
    const ds = `oklch(from ${z} none none none / calc(0.5 - clamp(-3, ${D} * ${e1} / ${de}, 3) / 8))`;
    return `color(from color-mix(in ${LIN}, color(from ${st} ${LIN} r none none / 1), color(from ${ds} ${LIN} none calc(alpha) none / none)) ${LIN} calc(r + 8 * g - 4) 0 0 / 1)`;
  };
  // s's start from a target's knots (--gamut--ad-s, the knots' first hue --gamut--ad-h0 subtracted from the hue first)
  const start = (src, k0, kh) => `color(from oklch(from oklch(from ${src} 0.5 0.1 calc(h - ${kh})) 0.5 0.1 h / calc((${k0} + 1) / 8)) ${LIN} calc(8 * alpha - 1) 0 0 / 1)`;
  return { E, step, start };
}
// A target's knots for the cusp's start (seeker/start.mjs's knots(sp, 0.5, 2), any space): two a region, equally spaced in
// s, with their hues (Color.js 0.7.1); the cyan-blue edge stops where its hue, rising to a peak, reaches blue's own (the
// part past the peak folds back: sRGB 264.208 to 264.052, rec2020 245.284 to 245.067, prophoto-rgb 206.03 to 197.61),
// and the peak's hue gives that edge its square-root scale. The hexagon is the one CSS writes: in linear light where
// CSS Color 4 has a linear form (sRGB, Display P3), else in the encoded channels (rec2020 by BT.2020's curve, as the
// engines encode it). Returns the custom properties adaptive() reads, with the transfer's exponent g (1 in linear light).
export const ADAPTIVE_TARGETS = { srgb: 'srgb-linear', 'display-p3': 'p3-linear', rec2020: '--rec2020-oetf', 'a98-rgb': 'a98rgb', 'prophoto-rgb': 'prophoto' };
export function adaptiveConstants(target, p = 1) {
  const C0 = createRequire(import.meta.url)('colorjs.io'), Color = C0.default ?? C0, space = ADAPTIVE_TARGETS[target];
  const hex = (s) => [Math.min(1, Math.max(0, Math.abs(s - 3) - 1)), Math.min(1, Math.max(0, 2 - Math.abs(s - 2))), Math.min(1, Math.max(0, 2 - Math.abs(s - 4)))].map((e) => e ** p);
  const at = (s) => new Color(space, hex(((s % 6) + 6) % 6)).to('oklch').coords[2];
  let hp = -1, top = 3; for (let s = 3.5; s <= 4; s += 1e-5) { const h = at(s); if (h > hp) { hp = h; top = s; } }
  // the cyan-blue edge's hue past its peak: down to blue's (sRGB), or below it and back up (prophoto-rgb: from 206.0
  // at s 3.49 to 192.6 at 3.65, then 197.6 at blue). The knots follow each hue's last pass, the most chroma: the edge
  // to s4, where it first reaches the dip's hue, then from the dip (prophoto-rgb's first pass, chroma 0.44 at 195 for
  // its third's 1.47, an audit, 2026-10-28)
  // (a dip under 0.01 degrees, Display P3's and a98-rgb's last 1e-5 before blue, is none)
  const hb = at(4); let hd = hb, sd = 4; for (let s = top; s < 4; s += 1e-5) { const h = at(s); if (h < hd) { hd = h; sd = s; } }
  if (hd > hb - 0.01) { hd = hb; sd = 4; }
  let s4 = top;
  if (!(at(top) <= hd)) { let lo = 3, hi = top; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (at(m) < hd) lo = m; else hi = m; } s4 = lo; }
  // two knots a region; prophoto-rgb's hues bend more along its edges: 8 (with 2 or 4, 6 and 4 of 68 of its colors in
  // test/adaptive-check.mjs were off, by up to 234/255; with 8, none outside 192.5-225deg, where the check sets them apart)
  const K = [], M = target === 'prophoto-rgb' ? 8 : 2;
  for (let r = 0; r < 6; r++) {
    const end = r === 3 ? s4 : r + 1;
    for (let j = 0; j < M; j++) { const s = r + ((end - r) * j) / M; K.push({ s, h: at(s) }); }
    if (r === 3) K.push({ s: s4, h: at(s4) });
    if (r === 3 && sd < 4) for (let j = 0; j < M; j++) { const s = sd + ((4 - sd) * j) / M; K.push({ s, h: j ? at(s) : at(s4) }); }
  }
  K.push({ s: 6, h: at(0) + 360 });
  for (let i = 1; i < K.length; i++) if (K[i].h < K[i - 1].h - 1) K[i].h += 360;
  // 6 digits: the start only needs to land near s (9 digits: the same results, 1.6 KB more)
  const c = seekStart(K, hp, 6);
  return { s: c.expr, h0: c.h0, g: { rec2020: 2.222222, 'a98-rgb': 2.199219, 'prophoto-rgb': 1.8 }[target] ?? 1, p };
}

// --gamut-method: adaptive. Björn Ottosson's gamut_clip_adaptive_L0_L_cusp (alpha 0.05, bottosson.github.io/posts/gamutclipping/,
// his published code), for any RGB target: in OKLab at the color's own hue, the point where the segment from (L0, 0) to
// the color (L, C) leaves the gamut. L0 = Lcusp + k Ld / (e1 + sqrt(e1^2 - 2 k |Ld|)) (his 0.5 sgn(Ld) (e1 - sqrt(...))
// without the cancellation: Chrome computes each operation in 32 bits), Ld = L - Lcusp, k = 2 (Ld > 0 ? 1 - Lcusp :
// Lcusp), e1 = k / 2 + |Ld| + alpha C / k. His find_cusp and find_gamut_intersection are fits to sRGB; here the cusp is
// found on the target's own hexagon (hexagon() above), and the exit as he finds it: the triangle black, cusp, white
// first (the line from black to the cusp is the gamut's lower edge in any RGB space, as a ray from black in OKLab is one in
// linear light: there it is exact), then two Newton steps on H = max(cbrt(max(r, g, b)) - 1, -min(r, g, b)) in linear
// light, positive outside, 0 on the edge (his are Halley steps on sRGB's own matrix), the slope from a second point
// 0.001 further. Only hue is kept: lightness moves toward L0 and chroma drops. Every number rides in channels; alpha carries them only inside nested relative colors (Firefox rounds
// it through registers and color-mix()). The segment's point at chroma tau is (L0 + tau q, tau), q = (L - L0) / C,
// held as oklab(L0, tau, q). In gamut (its clip within deltaEOK 0.0005), the color; L >= 1 white, L <= 0 black (CSS Color
// 4 §14.2.2's ends); else the exit, clipped. test/adaptive-check.mjs measures it against the exit bisected in Color.js
// at a cusp found numerically, to all five targets: worst 1.67/255 (2026-10-27).
export function adaptive(LIN = 'var(--gamut--lin)', ALPHA = 0.05, EPS = 0.001) {
  const v = (x) => `var(--gamut--ad-${x})`, regs = [], decls = [];
  const R = (x, e) => { regs.push(`--gamut--ad-${x}`); decls.push(`--gamut--ad-${x}: ${e};`); };
  // the hexagon's channels to the power --gamut--ad-p (a98-rgb's 256 / 563, as EdgeSeeker's: in its encoded channels
  // the cusp's hue was 4.9 degrees off at 30, oklch(0.9 2 30) 3.8/255 off: an audit, 2026-10-28)
  cusp(R, LIN, 'var(--gamut--ad-p, 1)');
  // (L, C, Lcusp) as OKLab channels -> (L0, C, L)
  const G1 = `color-mix(in oklab, oklab(from var(--gamut--src) l calc(hypot(a, b)) none / 1), oklab(from ${v('c')} none none l / none))`;
  const Ld = '(l - b)', k = '(2 * (b + clamp(0, sign(l - b), 1) * (1 - 2 * b)))', e1 = `(0.5 * ${k} + abs(${Ld}) + ${ALPHA} * a / ${k})`;
  R('a', `oklab(from ${G1} calc(b + ${k} * ${Ld} / (${e1} + sqrt(max(0, ${e1} * ${e1} - 2 * ${k} * abs(${Ld}))))) a l / 1)`);
  // the triangle's exit: (Lcusp, Ccusp, q) -> d1 = Lcusp / Ccusp - q, d2 = (1 - Lcusp) / Ccusp + q; with L0, the lower
  // edge at tau = L0 / d1, the upper at (1 - L0) / d2 (a side the segment runs away from has d <= 0), the nearer
  const q = 'calc((b - l) / a)';
  const D = `oklab(from color-mix(in oklab, oklab(from ${v('c')} l calc(hypot(a, b)) none / 1), oklab(from ${v('a')} none none ${q} / none)) none calc(l / a - b) calc((1 - l) / a + b) / none)`;
  // capped by the color's own chroma C (in alpha as C / (1 + C)): the exit lies on the segment, never past the color (to
  // prophoto-rgb, oklch(0.3 0.4 200)'s triangle gave 1.13 and the steps went to 1, an audit, 2026-10-28)
  const tau = `oklab(from color-mix(in oklab, oklab(from ${v('a')} l none none / calc(a / (1 + a))), ${D}) none calc(min(l / max(0.000001, a), (1 - l) / max(0.000001, b), alpha / max(0.000001, 1 - alpha))) none / none)`;
  // L0 and q, which the steps keep: read from --gamut--ad-a, not from the step before
  const LQ = `oklab(from ${v('a')} l none ${q} / 1)`;
  R('p0', `color-mix(in oklab, ${LQ}, ${tau})`);
  // the point at chroma tau + d, at the color's own hue
  // (the source's operand carries its chroma C as alpha C / (1 + C), so a point's alpha is (1 + C / (1 + C)) / 2: a step
  // reads C back from it; the output's alpha is set apart)
  const point = (P, d = '') => `color-mix(in oklch, oklch(from oklab(from ${P} calc(l + (a${d}) * b) calc(a${d}) 0) l c none / 1), oklch(from var(--gamut--src) none none h / calc(c / (1 + c))))`;
  // in linear light (rec2020, a98-rgb and prophoto-rgb are tested in their encoded channels: --gamut--ad-g, the
  // transfer's exponent, takes them to linear light first, where H is smooth)
  const H = `calc(max(pow(max(r, g, b, 0.000001), ${v('g')} / 3) - 1, -1 * sign(min(r, g, b)) * pow(abs(min(r, g, b)), ${v('g')})))`;
  // A step whose slope isn't positive halves tau instead: near prophoto-rgb's yellow cusp the triangle's tau lands past
  // a channel's peak along the segment, where H falls with tau, and Newton went to 0 (an audit, 2026-10-29:
  // oklch(0.99 1 104), blue 42.7/255 off, 1.9 now; a model of 300 colors at L 0.95 to 0.999 and hues 90 to 120: 6 off,
  // up to 213/255 before, up to 58 now). A third step left 2 off, up to 3.4, but each step names the one before twice:
  // with currentColor, 32 colors loaded in 4.4 s for 2.1 in Chrome, 12.6 for 5.3 in Firefox, and WebKit's black became a
  // grey; not taken
  for (const i of [1, 2]) {
    const P = v(`p${i - 1}`);
    // H at tau and at tau + EPS, and tau (the point's chroma, through alpha inside one nested color), as one color's
    // linear channels; tau - EPS H / (H' - H) back as OKLab a. A step names the step before twice, not four times: an
    // input that stays unresolved (currentColor) carries the chain as text, 4 times longer a step that way, and WebKit
    // 26.4 gave black past about 200 KB (p2 was 792 KB; now 2 times a step)
    const hs = `color-mix(in ${LIN}, color(from oklch(from ${point(P)} l c h / calc(c / 4)) ${LIN} ${H} none calc(4 * alpha) / none), color(from ${point(P, ` + ${EPS}`)} ${LIN} none ${H} none / alpha))`;
    const Cin = '((2 * alpha - 1) / max(0.000001, 2 - 2 * alpha))';   // C back from the point's alpha, the step's cap
    // (tau over 4 in alpha here and in hs, which clamps at 1: to prophoto-rgb the exit's chroma is up to 1.5, and
    // oklch(0.2547 2 198) came out at chroma 1, an audit, 2026-10-28; the source's chroma is at most 4)
    const up = 'clamp(0, sign(g - r), 1)';
    R(`p${i}`, `color-mix(in oklab, ${LQ}, oklab(from color(from ${hs} ${LIN} 0 0 0 / calc(min(${up} * (b - ${EPS} * r / max(0.0000001, g - r)) + (1 - ${up}) * b / 2, ${Cin}) / 4)) none calc(4 * alpha) none / none))`);
  }
  // In gamut: the clip within deltaEOK 0.0005 of the color (their half difference, the clip mixed with the color's
  // negation, under 0.00025), not a test of the channels: WebKit 26.4 converts to rec2020 and prophoto-rgb with
  // negative channels as 0 (oklch(0.4337 0.4275 351.45) to rec2020 0.603378 0 0.334493; Chrome and Firefox -0.250308),
  // and Chrome converts oklch(1 0 30) to srgb-linear 0.999706 1.00012 1.00016. The flag, out of gamut, rides in alpha,
  // 0 or 1, and weighs the exit against the clipped color. (Firefox 158 negates a hypot() by its arguments: there
  // 1 - sign(hypot(...) - k) and sign(k - hypot(...)) are +1 where hypot > k, so the flag is never subtracted from.)
  // L >= 1 is white and L <= 0 black as the clamped color.
  const src = 'oklch(from var(--gamut--src) clamp(0, l, 1) calc(c * clamp(0, sign(l * (1 - l)), 1)) h)', cl = 'clamp(0, r, 1) clamp(0, g, 1) clamp(0, b, 1)';
  const out = `oklab(from color-mix(in oklab, color(from ${src} ${LIN} ${cl} / 1), oklch(from ${src} calc(1 - l) c calc(h + 180) / 1)) none none none / calc(clamp(0, sign(hypot(l - 0.5, a, b) - 0.00025), 1)))`;
  const mapped = `color-mix(in ${LIN}, color-mix(in ${LIN}, color(from ${src} ${LIN} ${cl} / none), color(from ${out} ${LIN} none none none / calc(1 - alpha))), color-mix(in ${LIN}, color(from ${point(v('p2'))} ${LIN} ${cl} / none), color(from ${out} ${LIN} none none none / alpha)))`;
  return { regs, decls, out: alphaLin(`color(from ${mapped} ${LIN} r g b / none)`) };
}
// The hue's cusp on the target's hexagon of edges (hexagon() above), as adaptive() and edgeSeeker() both find it:
// --gamut--ad-t (the color's hue as 0.25 + h / 720), s from the target's knots (--gamut--ad-s, --gamut--ad-h0), two
// Newton steps, and the cusp --gamut--ad-c. One set of registers for both methods.
function cusp(R, LIN, P = null) {
  const v = (x) => `var(--gamut--ad-${x})`, { E, step, start } = hexagon(v('t'), 0, LIN, 0.001, P);
  R('t', 'oklch(from var(--gamut--src) none calc(0.25 + h / 720) none / none)');
  R('s0', start('var(--gamut--src)', v('s'), v('h0')));
  for (let i = 1; i <= 2; i++) R(`s${i}`, step(v(`s${i - 1}`), 0.5));
  R('c', `oklch(from ${E(v('s2'), 0.5)} l c h / 1)`);
}

// --gamut-method: ray-trace. CSS Color 4 §14.2.5-6, Ray Trace, in "the linear-light form of destination", for any RGB
// destination: sRGB and Display P3 in their own linear spaces; rec2020, a98-rgb and prophoto-rgb, which have no linear
// form CSS parses (in their encoded channels the rays landed up to 81/255 off), with srgb-linear carrying the points and
// the target's linear channels read from it by its matrix where a face is tested (secRows(): --gamut--sec-r, -g, -b and
// --gamut--dist, as .screen-edge reads them; unset, the channels themselves). A ray's points are affine in either, and
// the anchor's grey is (L^3, L^3, L^3) in both (each target's white is srgb-linear's 1 1 1), so only the face tests take
// the matrix; the far point is --gamut--rk (2; 4 there, past the target cube's diameter in srgb-linear, prophoto-rgb's
// 3.55) along the ray, and the last clip is in --gamut--clip (the target itself: a clip in encoded channels clips as one
// in linear light would). A ray from
// the color's grey at its own lightness through the color to where it leaves the cube, the exit corrected to the color's
// OkLCh lightness and hue, four rays, the anchor moved to a corrected point strictly inside after rays 1 and 2, the last
// exit clipped; in gamut (to 2e-5 in linear light), the color; L >= 1 white, L <= 0 black. A ray from the achromatic
// anchor is one relative color (L^3 in alpha); a ray from a moved anchor takes its faces' exits as differences of logs
// in two color-mix()es, and the exit as the anchor A and a far point F mixed with weights in alpha (Firefox: channel by
// channel, no alpha weights); the anchors are held as chroma; inside margin 1e-5, above the registers' 6 digits (within
// 1/255 of the spec's 1e-6). Its input's chroma is capped at 100, not 4: the ray's direction still moves past 4 (Color.js
// 0.7.1, 'raytrace': chroma 4 is up to 1.86/255 from chroma 1e6, 10 0.44/255, 100 0.03/255).
// Returns its registers, the
// declarations, Firefox's, its input and the output.
export const RAY_CAP = 100;
export function rayTrace(LIN = 'var(--gamut--lin)') {
  const regs = [], decls = [], ff = [], xs = ['r', 'g', 'b'], r = (n) => `--gamut--ray-${n}`, v = (n) => `var(${r(n)})`;
  const R = (n, e) => { regs.push(r(n)); decls.push(`${r(n)}: ${e};`); };
  const SX = X, inside = `sign(max(0, ${DIST} - 0.00001))`, XS = `${X.r}, ${X.g}, ${X.b}`, K = 'var(--gamut--rk, 2)';
  const CLIP = 'var(--gamut--clip, var(--gamut--lin))';
  // every channel of the achromatic anchor is the same (alpha), so the largest 1 / T over the six faces is
  // max((max(r, g, b) - alpha) / (1 - alpha), (alpha - min(r, g, b)) / alpha), in the target's linear channels
  const U = `max((max(${XS}) - alpha) / (1 - alpha), (alpha - min(${XS})) / alpha)`;
  const grey = (P) => `color(from oklch(from ${P} l c h / calc(l * l * l)) ${LIN} ${xs.map((x) => `calc(alpha + (${x} - alpha) / ${U})`).join(' ')} / 1)`;
  const correct = (X) => `color-mix(in oklch, ${v('lh')}, oklch(from ${X} none c none / 1))`;
  const general = (A, P, k) => {
    R(`al${k}`, `color(from ${A} ${LIN} r g b / 1)`);
    const AL = v(`al${k}`), D = v(`d${k}`);
    R(`d${k}`, `color-mix(in ${LIN}, color(from ${P} ${LIN} r g b / 1), color(from ${AL} ${LIN} calc(-1 * r) calc(-1 * g) calc(-1 * b) / 1))`);
    const ld = (neg) => `color(from ${D} ${LIN} ${xs.map((x) => `calc(log(hypot(r, g, b)) - log(max(0.000000000001, ${neg}${SX[x]})))`).join(' ')} / 1)`;
    const la = (up) => `color(from ${AL} ${LIN} ${xs.map((x) => (up ? `log(1 - ${SX[x]})` : `log(${SX[x]})`)).join(' ')} / 1)`;
    const mu = `color-mix(in ${LIN}, ${la(true)}, ${ld('')})`, ml = `color-mix(in ${LIN}, ${la(false)}, ${ld('-1 * ')})`;
    R(`s${k}`, `color-mix(in ${LIN}, color(from ${mu} ${LIN} calc(min(r, g, b)) none none / 1), color(from ${ml} ${LIN} none calc(min(r, g, b)) none / none))`);
    const S = v(`s${k}`), sw = `calc(exp(2 * min(r, g)) / ${K})`;
    const F = `color(from color-mix(in ${LIN}, ${AL}, color(from ${D} ${LIN} ${xs.map((x) => `calc(${K} * ${x} / hypot(r, g, b))`).join(' ')} / 1)) ${LIN} calc(2 * r) calc(2 * g) calc(2 * b) / 1)`;
    const X = `color-mix(in ${LIN}, color-mix(in ${LIN}, color(from ${AL} ${LIN} r g b / none), color(from ${S} ${LIN} none none none / calc(1 - ${sw}))), color-mix(in ${LIN}, color(from ${F} ${LIN} r g b / none), color(from ${S} ${LIN} none none none / ${sw})))`;
    // Firefox rounds those weights (alpha through color-mix()), so there each channel is A + s (F - A) from a color
    // holding that channel of A, of F and s, the three gathered by none mixes
    regs.push(r(`f${k}`)); ff.push(`${r(`f${k}`)}: ${F};`);
    const slot = (i, e) => ['none', 'none', 'none'].map((n, j) => (j === i ? e : n)).join(' ');
    const ch = xs.map((x, i) => `color(from color-mix(in ${LIN}, color-mix(in ${LIN}, color(from ${AL} ${LIN} ${x} none none / 1), color(from ${v(`f${k}`)} ${LIN} none ${x} none / none)), color(from ${S} ${LIN} none none ${sw} / none)) ${LIN} ${slot(i, 'calc(r + b * (g - r))')} / ${i ? 'none' : 1})`);
    return [X, `color-mix(in ${LIN}, color-mix(in ${LIN}, ${ch[0]}, ${ch[1]}), ${ch[2]})`];
  };
  // Below lightness 0.015 the input is its grey: within 0.01/255 in linear light of Color.js 0.7.1's raytrace to sRGB,
  // Display P3, rec2020 and a98-rgb (every color there is that dark), where WebKit 26.4's rays from so dark an anchor
  // ran parallel to a face and exited at a primary (oklch(0.008 0.1 260) came out full blue, 42 of 252 colors at L
  // 0.006 to 0.02 more than 0.05 off: an audit, 2026-10-31)
  const src = `--gamut--src: oklch(from var(--gamut--in0) clamp(0, l, 1) calc(min(c, ${RAY_CAP}) * clamp(0, sign(l * (1 - l)), 1) * sign(max(0, l - 0.015))) h / none);`;
  R('lh', 'oklch(from var(--gamut--src) l none h / none)');
  R('x0', grey('var(--gamut--src)'));
  R('p1', correct(v('x0')));
  R('x1', grey(v('p1')));
  R('a1', `color-mix(in oklch, ${v('lh')}, oklch(from color(from ${v('p1')} ${LIN} r g b / ${inside}) none calc(c * alpha) none / 1))`);
  R('p2', correct(v('x1')));
  const [x2, x2ff] = general(v('a1'), v('p2'), 2);
  R('x2', x2); ff.push(`${r('x2')}: ${x2ff};`);
  const q = `color-mix(in oklch, oklch(from ${v('a1')} c none none / none), oklch(from color(from ${v('p2')} ${LIN} r g b / calc(0.25 + 0.5 * ${inside})) none c none / alpha))`;
  R('a2', `color-mix(in oklch, ${v('lh')}, oklch(from ${q} none calc(l + (c - l) * max(0, sign(alpha - 0.5))) none / 1))`);
  R('p3', correct(v('x2')));
  const [x3, x3ff] = general(v('a2'), v('p3'), 3);
  R('x3', x3); ff.push(`${r('x3')}: ${x3ff};`);
  // in gamut (within 2e-5 in linear light, as .fit-screen), or achromatic, the input; else the last intersection; both
  // clipped. An achromatic input counts as in gamut by its chroma, carried in alpha: at L = 1 Chrome converts white a hair
  // past 1, and its ray from the anchor through itself has no length (oklch(1 0.2 120) came out #ecff00, a review, 2026-10-27)
  const fits = `max(alpha, sign(max(0, ${DIST} + 0.00002)))`, cl = 'clamp(0, r, 1) clamp(0, g, 1) clamp(0, b, 1)';
  const sc = 'oklch(from var(--gamut--src) l c h / calc(1 - sign(c)))';
  // the flag from the linear channels; the clip, and the output, in --gamut--clip (out of srgb-linear and back, a channel
  // clipped to 0 came back 4e-5 off, 2.5/255 in a98-rgb's power curve)
  const flag = (a) => `color(from ${sc} ${LIN} r g b / ${a})`;
  const mapped = `color-mix(in ${CLIP}, color(from ${flag(fits)} ${CLIP} ${cl} / alpha), color-mix(in ${CLIP}, color(from ${v('x3')} ${CLIP} ${cl} / none), color(from ${flag(`calc(1 - ${fits})`)} ${CLIP} none none none / alpha)))`;
  return { regs, decls, ff, src, out: alphaLin(`color(from ${mapped} ${CLIP} r g b / none)`, CLIP) };
}

// --gamut-method: edge-seeker. CSS Color 4 §14.2.3-4, EdgeSeeker, without its table: the table holds, by hue, the cusp
// (the color of most chroma, sampled on HSL (h, 100%, 50%): the cube's hexagon of edges) and a curvature from the HSL
// (h, 100%, 75%) point; here both are found where they are. The cusp is adaptive()'s (cusp() above: its registers and
// knots). The curve point is on the 75% hexagon in linear light (a + (1 - a) times the hexagon, a = the 50% grey's
// linear value), the s whose OKLCH hue is the color's, two Newton steps from the cusp's s (from knots of its own, three
// a region, and one step, as an earlier version did: the same answers, 645 bytes more gzipped; one step from the cusp's
// s: 0.72/255 from the spec's, two: 0.19). Then the spec's curvature from the two points, the line from black to the cusp below it and the arc
// to white above it (the smaller of the two at any L), chroma min(c, that), clipped; in gamut, the color. Every number
// rides in channels (Firefox rounds alpha). To sRGB and Display P3 in linear light; to rec2020 and a98-rgb in their
// encoded channels, as adaptive() runs (the hexagons are the same edges there: each transfer keeps 0 and 1), the 75%
// point's grey --gamut--es-a, 0.5 encoded (the spec samples HSL in the destination's own RGB); in gamut tested in
// --gamut--fl (srgb-linear there, the target read by its matrix: WebKit 26.4 converts to rec2020 with negative
// channels as 0). Not to prophoto-rgb: §14.2.4 builds its table "for an RGB destination color space with
// non-imaginary primaries (not, for example, ProPhoto RGB)".
export const A75 = ((x) => ((x + 0.055) / 1.055) ** 2.4)(0.5);
// EdgeSeeker's hexagon power and 75% grey by target: a98-rgb's edges run in its linear light (its encoding is a pure
// power, 563/256), so the 75% point's grey there is 0.5 ^ (563/256) in that parameter; rec2020's in its encoded channels
// (BT.2020's curve has a linear toe), its grey 0.5
const ES_P = 'var(--gamut--es-p, 1)';
export const ES_ENC = { rec2020: { p: 1, a: 0.5 }, 'a98-rgb': { p: n9(256 / 563), a: n9(0.5 ** (563 / 256)) } };
export function edgeSeeker(LIN = 'var(--gamut--lin)') {
  const regs = [], decls = [], R = (n, e) => { regs.push(n); decls.push(`${n}: ${e};`); };
  cusp((x, e) => R(`--gamut--ad-${x}`, e), LIN, ES_P);
  const { E, step, start } = hexagon('var(--gamut--ad-t)', `var(--gamut--es-a, ${n9(A75)})`, LIN, 0.001, ES_P);
  R('--gamut--es-s1', step('var(--gamut--ad-s2)', 0.75));
  R('--gamut--es-s2', step('var(--gamut--es-s1)', 0.75));
  R('--gamut--es-v', `oklch(from ${E('var(--gamut--es-s2)', 0.75)} l c h / 1)`);
  // the curvature (spec: the circle through (0, 0), (x, y), (1, 1)), x = (1 - vL) / (1 - cL), y = vC / cC: their logs
  // halved by one OKLab mix (a and b), then the cusp's l and c beside k: --gamut--es-k is (cL, cC, k) as OKLab channels
  const K = 'color-mix(in oklab, oklab(from var(--gamut--ad-c) none calc(-1 * log(1 - l)) calc(-1 * log(hypot(a, b))) / 1), oklab(from var(--gamut--es-v) none calc(log(1 - l)) calc(log(hypot(a, b))) / none))';
  // the centre is on cx + cy = 1, so k = sqrt(2) v / sqrt(1 + v^2), v = (x - y) / (x^2 + y^2 - x - y): the spec's curvature
  // to 4e-12, and 0 when x = y as the spec says
  const vv = '((exp(2 * a) - exp(2 * b)) / (exp(4 * a) + exp(4 * b) - exp(2 * a) - exp(2 * b)))';
  R('--gamut--es-k', `color-mix(in oklab, oklab(from var(--gamut--ad-c) l calc(hypot(a, b)) none / 1), oklab(from ${K} none none calc(1.41421356 * ${vv} / sqrt(1 + ${vv} * ${vv})) / none))`);
  // the largest chroma at the color's L, cC min(L / cL, arc(x)), the arc at x = (1 - L) / (1 - cL) clamped to [0, 1]
  // (below the cusp, 1: the line wins), in stages of three numbers: (cL, L, k) -> arc and L / cL; with cC -> the chroma
  const Ain = 'color-mix(in oklab, oklab(from var(--gamut--es-k) l none b / 1), oklab(from var(--gamut--src) none l none / none))';
  const k = 'b', t = `sqrt(2 - ${k} * ${k})`, bb = `(${t} - ${k})`, xx = 'clamp(0, (1 - a) / (1 - l), 1)';
  const d = `(${xx} * (${t} + ${k} * (1 - ${xx})))`, arc = `(2 * ${d} / (${bb} + sqrt(max(0, ${bb} * ${bb} + 4 * ${k} * ${d}))))`;
  const Bin = `color-mix(in oklab, oklab(from var(--gamut--es-k) a none none / 1), oklab(from ${Ain} none calc(${arc}) calc(a / l) / none))`;
  R('--gamut--es-m', `oklab(from ${Bin} none calc(l * min(a, b)) none / 1)`);
  // chroma min(c, that) at the color's own l and h; in gamut (within 2e-5 in linear light), the input; both clipped
  const C = 'color-mix(in oklab, oklab(from var(--gamut--src) calc(hypot(a, b)) none none / 1), oklab(from var(--gamut--es-m) none a none / none))';
  const mapped = `color-mix(in oklch, oklch(from var(--gamut--src) l none h / 1), oklch(from oklab(from ${C} none calc(min(l, a)) 0 / none) none c none / none))`;
  const FL = `var(--gamut--fl, ${LIN})`, fits = `sign(max(0, ${DIST} + 0.00002))`, cl = 'clamp(0, r, 1) clamp(0, g, 1) clamp(0, b, 1)';
  const flag = (a) => `color(from var(--gamut--src) ${FL} r g b / ${a})`;
  const out = `color-mix(in ${LIN}, color(from ${flag(fits)} ${LIN} ${cl} / alpha), color-mix(in ${LIN}, color(from ${mapped} ${LIN} ${cl} / none), color(from ${flag(`calc(1 - ${fits})`)} ${LIN} none none none / alpha)))`;
  const src = '--gamut--src: oklch(from var(--gamut--in0) clamp(0, l, 1) calc(min(c, 4) * clamp(0, sign(l * (1 - l)), 1)) h / none);';
  return { regs, decls, ff: [], src, out: alphaLin(`color(from ${out} ${LIN} r g b / none)`) };
}
// The secant's matrix for .screen-edge to rec2020, a98-rgb and prophoto-rgb (mapper()): a target's
// linear channels from srgb-linear's, each row a calc() of r, g and b (Color.js 0.7.1's matrices, ProPhoto's through
// Bradford), 9 digits
export function secRows(target) {
  const v = secVals(target);
  return `--gamut--dist: ${v.dist}; ${['r', 'g', 'b'].map((x) => `--gamut--sec-${x}: ${v[x]};`).join(' ')}`;
}
// the same as values: { dist, r, g, b }
export function secVals(target) {
  const C0 = createRequire(import.meta.url)('colorjs.io'), Color = C0.default ?? C0;
  const lin = { rec2020: 'rec2020-linear', 'a98-rgb': 'a98rgb-linear', 'prophoto-rgb': 'prophoto-linear' }[target];
  const cols = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((e) => new Color('srgb-linear', e).to(lin).coords);
  const rows = [0, 1, 2].map((i) => cols.map((c, j) => [+c[i].toPrecision(9), 'rgb'[j]]).filter(([k]) => Math.abs(k) > 1e-12)
    .map(([k, ch], j) => `${j ? (k < 0 ? ' - ' : ' + ') : k < 0 ? '-' : ''}${k === 1 ? '' : `${Math.abs(k)} * `}${ch}`).join(''));
  return { dist: `calc(0.5 - max(${rows.map((e) => `abs(${e} - 0.5)`).join(', ')}))`, ...Object.fromEntries(rows.map((e, i) => ['rgb'[i], `calc(${e})`])) };
}
// Ray Trace's far point past the target cube's diameter in srgb-linear (rec2020 2.83, a98-rgb 2.33, prophoto-rgb 3.55)
export const RAY_FAR = 4;
// What materialPart() needs beyond the mapper's: atan2() as a number, mod() and pow() in channels
export const GUARD_MATERIAL = '(color: color(from red srgb-linear calc(atan2(g, r) / 1rad) calc(mod(pow(r, .42), 1)) b))';
// What adaptive() needs beyond minde(): mod(), pow() and sqrt() in channels
export const GUARD_ADAPTIVE = '(color: oklch(from red calc(mod(h + 540, 360) - 180) calc(pow(c, 1 / 3)) h / calc(sqrt(alpha))))';
// What minde() needs: relative colors with none, a color-mix() of none channels, hypot(), sign(), clamp(), abs()
export const GUARD_MINDE = `(color: color-mix(in oklch, oklch(0.5 none 30 / none), oklch(from color-mix(in oklab, color(from red srgb-linear clamp(0, r, 1) g b / none), oklch(from red calc(1 - l) c calc(h + 180) / c)) none calc(alpha + clamp(-1, abs(sign(0.01 - hypot(l - 0.5, c))), 1)) none / 1)))`;

const PARTS = ['contrast.css', 'scale.css']; // the hand-written parts, inlined from this folder

// Palette steps (.palette-step): Material 3's tonal palette, material-color-utilities 0.4.0's
// TonalPalette.tone(t) = Hct.from(hue, chroma, t): the sRGB color of the seed's CAM16 hue h, CIELAB L* t and CAM16 chroma
// C (times --gamut-chroma-scale), or, where sRGB can't hold C there, the most chroma sRGB holds at that hue and tone
// (hct/hct_solver.js). The viewing conditions are MCU's defaults (ViewingConditions.make()), worked out here from
// CAM16's matrix and MCU's sRGB matrix (its SCALED_DISCOUNT_FROM_LINRGB to 4e-16). In CSS: the seed's adapted
// responses (signed, so a seed past sRGB has a hue and chroma), then (u, v, h) with (u, v) = Q (cos h, sin h),
// Q = 23 p1 / (C t_inner)^(10/9), whose own terms cancel MCU's eHue; HctSolver.findResultByJ's Newton on J from its
// first guess, carried as q = (J / 100)^(1 / c z); P, the color there. P stands where it is in sRGB (MCU: 0 to 100.01
// of 100) and its Y is within 1% of the tone's. Elsewhere the answer is on sRGB's surface at the tone's Y, where MCU
// bisects the polygon's edges: here a ray from grey (Y, Y, Y) in the plane of that Y, along U cos psi + V sin psi (U, V:
// the plane's directions whose CAM16 a, b are cos psi, sin psi near grey), leaves the cube where
// 1 / max(d / (100 - Y), -d / Y) says, and psi starts at h and takes Newton steps on the hue difference, its slope a
// difference over 0.001 rad. Each step's numbers ride in srgb-linear channels of a registered color, three a color (h
// and psi in two, the third one value at a time). Steps: 3 on J and 3 on psi pass test/material-check.mjs in all three
// engines (2 on J: 930 of 983; 2 on psi: 975 of 983 in a JavaScript model, 2026-10-27); each step on psi costs Chrome
// about 120 us a step, on J 46. MCU's grey (chroma under 1e-4, tone 0 or 100) is grey.
export function materialPart() {
  // (NB 3: next to sRGB's red corner, where the hue turns fast along the G = 0 edge, three angle steps leave up to 4.2/255
  // (#fe0003 at tone 53, blue 7 for MCU's 3; 7 of 601 saturated seeds over 1/255, an audit, 2026-10-29); a
  // fourth made 601 of 601 at 18% (WebKit) to 30% (Chrome) more time a step, so the limit is written down instead)
  const NJ = 3, NB = 3;
  const M16 = [[0.401288, 0.650173, -0.051461], [-0.250268, 1.204414, 0.045854], [-0.002079, 0.048952, 0.953127]];
  const S2X = [[0.41233895, 0.35762064, 0.18051042], [0.2126, 0.7152, 0.0722], [0.01932141, 0.11916382, 0.95034478]];
  const K = S2X[1], wp = [95.047, 100, 108.883];
  const yFromL = (l) => { const f = (l + 16) / 116; return 100 * (f ** 3 > 216 / 24389 ? f ** 3 : l / (24389 / 27)); };
  const La = (200 / Math.PI) * yFromL(50) / 100, W = M16.map((r) => r[0] * wp[0] + r[1] * wp[1] + r[2] * wp[2]);
  const d = Math.min(1, Math.max(0, 1 - Math.exp((-La - 42) / 92) / 3.6)), rgbD = W.map((w) => d * (100 / w) + 1 - d);
  const k4 = (1 / (5 * La + 1)) ** 4, fl = k4 * La + 0.1 * (1 - k4) ** 2 * Math.cbrt(5 * La);
  const n = yFromL(50) / 100, cz = 0.69 * (1.48 + Math.sqrt(n)), nbb = 0.725 / n ** 0.2;
  const rgbA = W.map((w, i) => { const f = (fl * rgbD[i] * w / 100) ** 0.42; return 400 * f / (f + 27.13); });
  const AWN = (2 * rgbA[0] + rgbA[1] + 0.05 * rgbA[2]), P1K = (50000 / 13) * nbb, K73 = (1.64 - 0.29 ** n) ** 0.73;
  const mul = (A, v) => A.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  const SD = M16.map((r, i) => [0, 1, 2].map((j) => r.reduce((s, x, k) => s + x * rgbD[i] * fl / 100 * S2X[k][j], 0)));
  const [[a0, b0, c0], [d0, e0, f0], [g0, h0, i0]] = SD, A = e0 * i0 - f0 * h0, B = f0 * g0 - d0 * i0, C = d0 * h0 - e0 * g0, det = a0 * A + b0 * B + c0 * C;
  const LIN = [[A, c0 * h0 - b0 * i0, b0 * f0 - c0 * e0], [B, a0 * i0 - c0 * g0, c0 * d0 - a0 * f0], [C, b0 * g0 - a0 * h0, a0 * e0 - b0 * d0]].map((r) => r.map((x) => x / det));
  // the plane of Y: E1, E2 orthonormal and orthogonal to K; U, V the directions whose a, b (CAM16's opponent axes of
  // SD's responses, linear near grey) are (1, 0) and (0, 1)
  const nk = Math.hypot(...K), kh = K.map((x) => x / nk), unit = (v) => v.map((x) => x / Math.hypot(...v));
  const E1 = unit([1 - kh[0] * kh[0], -kh[0] * kh[1], -kh[0] * kh[2]]), E2 = [kh[1] * E1[2] - kh[2] * E1[1], kh[2] * E1[0] - kh[0] * E1[2], kh[0] * E1[1] - kh[1] * E1[0]];
  const OPP = [[1, -12 / 11, 1 / 11], [1 / 9, 1 / 9, -2 / 9]], L = OPP.map((r) => [E1, E2].map((e) => r.reduce((s, x, i) => s + x * mul(SD, e)[i], 0)));
  const dl = L[0][0] * L[1][1] - L[0][1] * L[1][0];
  // (scaled by 1/1000, so a ray's length, a register's channel, stays over 0.01 at tone 0.1: WebKit keeps 6 decimals)
  const U = [0, 1, 2].map((i) => (E1[i] * L[1][1] - E2[i] * L[1][0]) / dl / 1000), V = [0, 1, 2].map((i) => (E2[i] * L[0][0] - E1[i] * L[0][1]) / dl / 1000);
  const SG = SD.map((r) => r[0] + r[1] + r[2]), SU = mul(SD, U), SV = mul(SD, V), KL = [0, 1, 2].map((i) => K.reduce((s, k, j) => s + k * LIN[j][i], 0));
  const num = (x) => Number(x.toPrecision(7)).toString().replace(/^(-?)0\./, '$1.');
  const sum = (terms) => terms.join(' + ').replace(/\+ -/g, '- '), lin = (cs, vars) => sum(cs.map((c, i) => `${num(c)} * ${vars[i]}`));
  const pm = (x) => `${x < 0 ? '-' : '+'} ${num(Math.abs(x))}`;
  const pre = '--gamut--mt-', R = (x) => `var(${pre}${x})`, regs = [], nums = [], decls = [];
  const reg = (name, value) => { regs.push(pre + name); decls.push(`${pre}${name}: ${value};`); };
  const val = (name, value) => { nums.push(pre + name); decls.push(`${pre}${name}: ${value};`); };
  // the tone: --gamut-tone, else 95 at the first step to 10 at the last; Y its CIELAB Y (0 to 100)
  val('tone', 'clamp(0, var(--gamut-tone, calc(95 - 85 * var(--gamut--step-t))), 100)');
  // MCU's TonalPalette.tone(): tone 99 of a yellow hue (105 to 125 degrees) is tones 98 and 100 averaged in 8-bit sRGB;
  // tone 100 is white, so the step solves tone 98 and averages it with white (yt 1). The hue is known as a number only
  // on the list, the seed's element, which sets --gamut--mt-yf; its flag reaches the step by a style query
  // (--gamut--mt-yellow). An audit, 2026-10-28: #ffff00 at tone 99 gave #fffee1 for MCU's #ffffd6.
  val('yt', `calc(clamp(0, 1 - abs(${R('tone')} - 99) * 1000000, 1) * var(--gamut--mt-yellow))`);
  val('te', `calc(${R('tone')} - ${R('yt')})`);
  // tone 99 (but a yellow's, solved at 98): 1 there
  val('t99', `clamp(0, 1 - abs(${R('te')} - 99) * 1000000, 1)`);
  const T = R('te'), Y = R('y'), above = `clamp(0, sign(${T} - 8), 1)`;
  val('y', `calc(${above} * 100 * pow((${T} + 16) / 116, 3) + (1 - ${above}) * ${T} * ${num(2700 / 24389)})`);
  val('q0', `pow(.11 * sqrt(${Y}), ${num(1 / cz)})`); // MCU's first guess, J = 11 sqrt(Y)
  val('iy0', `calc(1 / ${Y})`); val('iy1', `calc(1 / (100 - ${Y}))`);
  const x = (i) => `(${lin(SD[i].map((v) => v * 100), ['r', 'g', 'b'])})`;
  const ad = (e) => `calc(400 * sign(${e}) / (1 + 27.13 * pow(abs(${e}), -.42)))`;
  reg('s1', `color(from var(--gamut--in0) srgb-linear ${[0, 1, 2].map((i) => ad(x(i))).join(' ')})`);
  // a and b times 11; Q / hypot(a, b) = 23 (u + .305) / (rel^(10/9) (a^2 + b^2) (p2 nbb / aw)^(5 c z / 9))
  const a = '(11 * r - 12 * g + b)', b = '(r + g - 2 * b) * 11 / 9';
  const kq = `${num(23 * 11)} * ((20 * r + 20 * g + 21 * b) / 20 + .305) / max(1e-30, pow(var(--gamut--rel), ${num(10 / 9)}) * (${a} * ${a} + ${b} * ${b}) * pow(max(0, (40 * r + 20 * g + b) / ${num(20 * AWN)}), ${num(5 * cz / 9)}))`;
  reg('s2', `color(from ${R('s1')} srgb-linear calc(${kq} * ${a}) calc(${kq} * ${b}) calc(atan2(${b}, ${a}) / 1rad))`);
  // grey where MCU's solveToInt is: chroma under 1e-4 (Q past this times eHue), no hue (u = v = 0), tone 0 or 100
  const QC = 23 * P1K * 0.25 / (1e-4 / K73) ** (10 / 9);
  const grey = `min(1, clamp(0, sign(hypot(r, g) - ${num(QC)} * (cos(b + 2) + 3.8)), 1) + clamp(0, sign(1e-20 - abs(r) - abs(g)), 1) + clamp(0, sign(${T} - 99.9999), 1) + clamp(0, sign(.0001 - ${T}), 1))`;
  const WT = [[451, 288], [-891, -261], [-220, -6300]].map(([p, q]) => [p / 1403, q / 1403]);
  const G = (q) => `${num(23 * AWN)} * (${q} + ${num(0.305 / AWN)}) / max(1e-9, (r * r + g * g) * pow(${q}, ${num(5 * cz / 9)}) + 11 * r + 108 * g)`;
  const X = (q, i) => `${num(460 * AWN / 1403)} * ${q} + (${G(q)}) * (${lin(WT[i], ['r', 'g'])})`;
  const inv = (e) => `pow(max(0, 27.13 / (400 / (${e}) - 1)), ${num(1 / 0.42)})`;
  const F = (q) => sum([0, 1, 2].map((i) => `${num(KL[i])} * ${inv(X(q, i))}`));
  const newton = (q) => `${q} * pow(.5 + ${Y} / (2 * max(1e-9, ${F(q)})), ${num(1 / cz)})`;
  // the first step goes far negative for grey, so P fails and the edge's ray, of length 0, gives grey
  let prev = R('gf');
  reg('gf', `color(from ${R('s2')} srgb-linear r g calc(${grey}))`);
  for (let k = 1; k <= NJ; k++) { reg(`j${k}`, `color(from ${prev} srgb-linear r g calc(${k === 1 ? `${newton(R('q0'))} - 1000000 * b` : newton('b')}))`); prev = R(`j${k}`); }
  reg('pi', `color(from ${prev} srgb-linear ${[0, 1, 2].map((i) => `calc(1000 * ${inv(X('b', i))})`).join(' ')})`);
  reg('p', `color(from ${R('pi')} srgb-linear ${LIN.map((row) => `calc(${lin(row.map((v) => v / 100000), ['r', 'g', 'b'])})`).join(' ')})`);
  // P stands where it is in sRGB and its Y is within 1% of the tone's (a failed search gives neither)
  const w = `clamp(0, sign(min(r, g, b) + .00001), 1) * clamp(0, sign(1.0001 - max(r, g, b)), 1) * clamp(0, sign(${Y} / 10000 - abs(${lin(K, ['r', 'g', 'b'])} - ${Y} / 100)), 1)`;
  reg('pw', `color(from ${R('p')} srgb-linear r g b / calc(${w}))`);
  const D = (i, p) => `${num(U[i])} * cos(${p}) ${pm(V[i])} * sin(${p})`;
  const mu = (p) => `1 / max(max(${[0, 1, 2].map((i) => D(i, p)).join(', ')}) * ${R('iy1')}, -1 * min(${[0, 1, 2].map((i) => D(i, p)).join(', ')}) * ${R('iy0')})`;
  const adb = (i, p) => `1 / (1 + 27.13 * pow(${num(SG[i])} * ${Y} + (${num(SU[i])} * cos(${p}) ${pm(SV[i])} * sin(${p})) * b, -.42))`;
  // the hue difference, in (-pi, pi]: atan2 of the edge point's b and a (the 400 of the responses cancels)
  // the edge point's a and b need its responses less the third (CAM16's a and b take none of a common part): two
  // numbers, x 1000000 (WebKit keeps 6 decimals), beside h; the hue difference to h, in (-pi, pi], from them
  const diffs = (p) => { const [r, g, bb] = [0, 1, 2].map((i) => adb(i, p)); return `calc(1000000 * (${r} - ${bb})) calc(1000000 * (${g} - ${bb}))`; };
  const res = `calc(mod(atan2((g + b) * 11 / 9, 11 * g - 12 * b) / 1rad - r + ${num(3 * Math.PI)}, ${num(2 * Math.PI)}) - ${num(Math.PI)})`;
  // At tone 99 sRGB's slice is a small triangle, and along its magenta-to-yellow edge the hue runs from 285.70 round
  // through red to 113.85 degrees within a hair of the magenta corner: the ray's correction steps can't follow it (it
  // was up to 30/255 off at 18 of 36 hues, hsl 30: 251 255 225 for MCU's 255 251 255). There, from 255 round to 113.85
  // degrees (Z), the ray's angle psi is MCU's own point's (HctSolver.bisectToLimit, within 0.8 of a byte of the edge at
  // the hue; tone99.json), a step function of the hue, held; elsewhere it solves.
  const T99 = JSON.parse(readFileSync(new URL('./tone99.json', import.meta.url), 'utf8')), Z0 = 255;
  const dot = (u, w) => u[0] * w[0] + u[1] * w[1] + u[2] * w[2], uv = [[dot(U, E1), dot(V, E1)], [dot(U, E2), dot(V, E2)]];
  const psiOf = (pt) => { const dv = pt.map((x) => (x - T99.y) / 100), q = [dot(dv, E1), dot(dv, E2)]; return Math.atan2(uv[0][0] * q[1] - uv[1][0] * q[0], q[0] * uv[1][1] - uv[0][1] * q[1]); };
  // Z's pieces: the one holding Z0, those after it, and the first (hue 0)
  const P99 = T99.pieces, from = P99.findLastIndex(([h]) => h <= Z0), zp = [[Z0, P99[from][1]], ...P99.slice(from + 1)];
  const psis = []; for (const [, pt] of zp) { let a = psiOf(pt); const last = psis[psis.length - 1]; if (last !== undefined) a += 2 * Math.PI * Math.round((last - a) / (2 * Math.PI)); psis.push(a); }
  const step = (h) => `clamp(0, sign(g - ${num(h)}) + 1, 1)`;
  // psi from hue 0 (P99[0], Z's last piece) up, then each of Z's pieces past Z0
  const p0 = psiOf(P99[0][1]), psi99 = sum([num(p0), `${num(psis[0] - p0)} * ${step(Z0)}`, ...zp.slice(1).map(([h], i) => `${num(psis[i + 1] - psis[i])} * ${step(h)}`)]);
  // (h, its degrees 0 to 360, 1 in Z at tone 99), then (h, psi, -): a held psi is the piece's plus 16 turns (32 pi, the
  // same ray), so each step tells it by psi past 50 and leaves it
  const inZ = `(1 - clamp(0, sign(g - ${num(P99[1][0])}) + 1, 1) * clamp(0, sign(${Z0} - g), 1))`;
  reg('hd', `color(from color(from ${R('s2')} srgb-linear b calc(mod(b * ${num(180 / Math.PI)} + 360, 360)) 0) srgb-linear r g calc(${R('t99')} * ${inZ}))`);
  reg('st0', `color(from ${R('hd')} srgb-linear r calc(r + b * (${psi99} + ${num(32 * Math.PI)} - r)) 0)`);
  let state = R('st0'); // (h, psi, -)
  for (let k = 0; k < NB; k++) {
    reg(`ma${k}`, `color(from ${state} srgb-linear r g calc(${mu('g')}))`);
    reg(`da${k}`, `color(from ${R(`ma${k}`)} srgb-linear r ${diffs('g')})`);
    reg(`mb${k}`, `color(from ${state} srgb-linear r g calc(${mu('g + .001')}))`);
    reg(`db${k}`, `color(from ${R(`mb${k}`)} srgb-linear r ${diffs('g + .001')})`);
    // (r_a, psi, r_b), then psi less r_a .001 / (r_b - r_a)
    const both = `color-mix(in srgb-linear, color(from ${R(`da${k}`)} srgb-linear ${res} none none), color-mix(in srgb-linear, color(from ${R(`ma${k}`)} srgb-linear none g none), color(from ${R(`db${k}`)} srgb-linear none none ${res})))`;
    // after the last step, the first channel says which answer: 1 P, 2 grey, else the edge (a mix averages: 2w and 4 grey)
    const first = k < NB - 1 ? `color(from ${R(`ma${k}`)} srgb-linear r none none)` : `color-mix(in srgb-linear, color(from ${R('pw')} srgb-linear calc(2 * alpha) none none), color(from ${R('gf')} srgb-linear calc(4 * b) none none))`;
    state = `color-mix(in srgb-linear, ${first}, color(from ${both} srgb-linear none calc(g - clamp(0, sign(50 - g), 1) * clamp(-1, r * .001 / (b - r), 1)) none))`;
    if (k < NB - 1) { reg(`st${k + 1}`, state); state = R(`st${k + 1}`); } // read twice
  }
  reg('mf', `color(from ${state} srgb-linear r g calc(clamp(0, 2 - r, 1) * ${mu('g')}))`);
  // out: P or the edge point, the other at alpha 0 in a premultiplied mix
  const edge = `color(from ${R('mf')} srgb-linear ${[0, 1, 2].map((i) => `calc(${Y} / 100 + (${D(i, 'g')}) * b / 100)`).join(' ')} / calc(1 - clamp(0, 1 - abs(r - 1), 1)))`;
  const out0 = `color(from color-mix(in srgb-linear, ${R('pw')}, ${edge}) srgb-linear clamp(0, r, 1) clamp(0, g, 1) clamp(0, b, 1) / 1)`;
  const avg = (c) => `calc(${c} + ${R('yt')} * (round((round(${c} * 255) + 255) / 2) / 255 - ${c}))`;
  const out = `color(from color(from ${out0} srgb ${avg('r')} ${avg('g')} ${avg('b')} / 1) srgb-linear r g b / 1)`;
  // the list's flag: the seed's CAM16 hue (its adapted responses, as s1 and s2 take them, read in srgb-linear: in srgb
  // the responses were encoded, and hues 103.4 to 105 and 125 to 127 came out yellow) in [105, 125) degrees
  const seed = 'var(--gamut-in, oklch(var(--gamut-l, 0.5) var(--gamut-c, 0) var(--gamut-h, 0)))';
  const hueR = `atan2((r + g - 2 * b) * 11 / 9, 11 * r - 12 * g + b) / 1rad`;
  const yf = (c) => `color(from color(from ${c} srgb-linear ${[0, 1, 2].map((i) => ad(x(i))).join(' ')}) srgb-linear calc(clamp(0, sign(${hueR} - ${num(105 * Math.PI / 180)}) + 1, 1) * clamp(0, sign(${num(125 * Math.PI / 180)} - ${hueR}), 1)) 0 0)`;
  const parent = `--gamut--mt-yf: ${yf(seed)};`;
  // the function has no list to read: it computes the flag itself, a typed result its if() compares (Chrome 155)
  const fn = { pre: `@function --gamut--palette-step-yf(--c) returns <color> { result: ${yf('var(--c)')}; }`,
    locals: [`--gamut--mt-yellow: if(style(--gamut--mt-yf: color(srgb-linear 1 0 0)): 1; else: 0);`, `--gamut--mt-yf: --gamut--palette-step-yf(${seed});`] };
  return { regs, nums, decls, out, parent, fn };
}

// CSS Color 6 §2 contrast-color(<base> tbd-bg wcag2(<target>)?, <candidate>#), base as background. Numbers ride in
// xyz-d65 channels (a mix fills one color's none channels from the other's, exactly, in the mix's own space); a
// candidate is picked by alpha: its leaf has its own alpha when it wins, 0 otherwise, and a tree of color-mix()es keeps
// the one leaf. Chrome substitutes and re-parses each declaration holding a var() on every element, and a calc()
// operation costs about 0.4 us, so every test is written once and short.
export function contrastColor() {
  const CC = 6; // candidates: 6 is the spec's largest example; each slot costs about 28 us in Chrome, used or not
  const v = (n) => `var(--gamut--cc-${n})`;
  // slot k: the first set candidate from k up, else the last set below k, so the set ones are the candidates, in order,
  // each at least once and no other; with none set, white then black
  const t = (k) => [...Array.from({ length: CC - k + 1 }, (_, i) => k + i), ...Array.from({ length: k - 1 }, (_, i) => k - 1 - i)]
    .reduceRight((d, j) => `var(--gamut-try-${j}, ${d})`, k === 1 ? 'white' : 'black');
  const T = (k) => v(k > CC ? 'wb' : `c${k}`);
  // an input once in srgb, each missing component 0 (CSS Color 4 §4.4): a mix would fill it from the other color
  const zero = (x) => `color(from ${x} srgb calc(r) calc(g) calc(b) / calc(alpha))`;
  // ln(Y + 0.05), Y the color's CIE luminance as the browser converts it (below 0 counts as 0, as Color.js)
  const lnY = 'calc(log(max(0, y) + 0.05))';
  // simple alpha compositing of a color over the opaque base, in sRGB: their mix, the base given the color's 1 - alpha
  const over = (top) => `color-mix(in srgb, ${top}, color-mix(in srgb, ${v('b')}, color(from ${top} srgb none none none / calc(1 - alpha))))`;
  // the target in x of --gamut--cc-t (none or anything not a number, a percentage too: invalid, its initial's x 0, no target)
  const tm = 'clamp(0, sign(x), 1)', lnT = 'log(max(0.000001, x))';
  const ge = (a, b) => `clamp(0, sign(${a} - ${b}) + 1, 1)`;
  const pass = ge('x', 'z'); // in a state mixed with a candidate: x its stored log contrast ratio, z the bar
  const lw = Math.log(1.05), lk = Math.log(0.05);
  // white when its ratio reaches the smaller of the target and black's: white passes, or neither does and white is ahead
  // (its ratio |ln 1.05 - y|: over a base past white, Y above 1, white is the darker; taken as ln 1.05 - y, black won
  // where white reached the target, an audit, 2026-10-29)
  const W = ge(`abs(${lw} - y)`, `min(${lnT}, y - ${lk})`);
  const regs = ['b', 'lb', 't', 'wb', ...Array.from({ length: CC }, (_, i) => `c${i + 1}`), ...Array.from({ length: CC }, (_, i) => `d${i + 1}`), ...Array.from({ length: CC + 1 }, (_, i) => `s${i}`)];
  const m = (k) => `color(from color-mix(in xyz-d65, ${k > 1 ? m(k - 1) : 'color(xyz-d65 none none -1 / none)'}, ${v(`d${k}`)}) xyz-d65 none none calc(max(z, x)) / none)`;
  const mixS = (k) => `color-mix(in xyz-d65, ${v(`s${k - 1}`)}, ${k > CC ? 'color(xyz-d65 1000 none none / 1)' : v(`d${k}`)})`;
  const decls = [
    // the base over Canvas, alpha none (so a mix takes the other color's)
    `--gamut--cc-b: color(from color-mix(in srgb, ${zero('var(--gamut-bg, Canvas)')}, color-mix(in srgb, color(from Canvas srgb r g b / none), color(from var(--gamut-bg, Canvas) srgb none none none / calc(1 - alpha)))) srgb r g b / none);`,
    // (pow(R, 1): R for a number; pow() takes numbers only, so 300% is no target as none is, where xyz-d65 alone would
    // take it as 3, an audit, 2026-10-28; Chrome 155 and WebKit 26.4)
    // (and at least 1, which every ratio is: a target of 0 is a target every candidate reaches, not none, a review,
    // 2026-10-29)
    `--gamut--cc-t: color(xyz-d65 max(1, pow(var(--gamut-contrast-ratio, none), 1)) none none / none);`,
    ...Array.from({ length: CC }, (_, i) => `--gamut--cc-c${i + 1}: ${zero(t(i + 1))};`),
    `--gamut--cc-lb: color(from ${v('b')} xyz-d65 none ${lnY} -1 / none);`,
    // after the candidates, white if it passes, else black if it passes, else whichever contrasts more (white on a tie)
    `--gamut--cc-wb: color(from color(from color-mix(in xyz-d65, ${v('lb')}, ${v('t')}) xyz-d65 none none none / calc(${W})) srgb alpha alpha alpha / 1);`,
    // a candidate: the log of its contrast ratio, |ln(Y + 0.05) of it over the base - the base's|, in x; its own alpha.
    // Stored once and only compared as stored, so the greatest is one of them to the bit (registers keep 32-bit floats)
    ...Array.from({ length: CC }, (_, i) => `--gamut--cc-d${i + 1}: color(from color-mix(in xyz-d65, color-mix(in xyz-d65, color(from ${over(T(i + 1))} xyz-d65 ${lnY} none none / none), color(from ${T(i + 1)} xyz-d65 none none none / max(0.000000001, alpha))), ${v('lb')}) xyz-d65 calc(abs(x - y)) none none / alpha);`),
    // the bar: the target's log (the greatest, in z, in one declaration), or without a target the greatest; once a
    // candidate reaches it, it rises out of reach
    `--gamut--cc-s0: color(from color-mix(in xyz-d65, ${m(CC)}, ${v('t')}) xyz-d65 none none calc(${tm} * ${lnT} + (1 - ${tm}) * z) / none);`,
    ...Array.from({ length: CC + 1 }, (_, i) => `--gamut--cc-s${i + 1}: color(from ${mixS(i + 1)} xyz-d65 none none calc(z + 1000000 * ${pass}) / none);`).slice(0, CC),
  ];
  // the white-or-black slot reaches any target bar (x = 1000) and never one already risen (1000000)
  const leaf = (k) => `color-mix(in srgb, color(from ${T(k)} srgb r g b / none), color(from color(from ${mixS(k)} xyz-d65 none none none / calc(${pass} * alpha)) srgb none none none / alpha))`;
  // a node doubles the alpha back: one side at most is not transparent
  const node = (a, b) => `color(from color-mix(in srgb, ${a}, ${b}) srgb r g b / calc(2 * alpha))`;
  const tree = (ks) => (ks.length === 1 ? leaf(ks[0]) : node(tree(ks.slice(0, ks.length >> 1)), tree(ks.slice(ks.length >> 1))));
  const out = tree(Array.from({ length: CC + 1 }, (_, i) => i + 1));
  return `/* CSS Color 6's contrast-color() with candidates and a WCAG 2.2 target; #11534 (your own light and dark colors, resolved 2025-01-30 to extend
   contrast-color() later), #11619 (pick from a set), #7358 (translucent colors composited first, resolved 2022-08-02).
   .contrast-color: In: --gamut-bg, the base, a background (default Canvas); --gamut-try-1 to --gamut-try-${CC}, the
   candidates, slots left unset skipped (without any: white, black); --gamut-contrast-ratio, the WCAG 2.1 ratio to reach (aa 4.5,
   aa large 3, aaa 7; none, 0 or below, or anything not a number: no target). A none component counts as 0.
   Out: --gamut-text, the winning candidate as given. With a target, the first candidate that reaches it, then white,
   then black, else whichever of the two contrasts more (white on a tie); without one, the candidate that contrasts
   most (the first on a tie). Translucent colors are composited first: the base over Canvas, each candidate over the
   base (in sRGB, as the page paints). Luminance as the browser converts to xyz-d65. */
${regs.map((n) => `@property --gamut--cc-${n} { syntax: '<color>'; inherits: false; initial-value: ${n === 't' ? 'color(xyz-d65 none none none / none)' : 'transparent'}; }`).join('\n')}
.contrast-color {
  ${decls.join('\n  ')}
  --gamut-text: ${out};
}`;
}

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

// An input color whose hue is `none` (oklch(0.65 0.2 none), lch(55 70 none)) converts as grey in WebKit (QUIRKS.md Q3),
// but a relative color in its own space reads the none as 0, as CSS Color 4 §4.4 has it. Which space is the input's
// own, CSS can't tell, and an lch() hop greys an oklch() none hue in WebKit as an oklch() hop greys an lch() one
// (2026-10-27), so three readings: the input as given, oklch(from … l c h) and lch(from … l c h). Registers (prefix):
// g, the three chromas in one color as oklch's l (clamped to 1), c and h; h, the hop of more chroma; x and o, flags
// whose alpha is 1 for the input and for the hop. The hop wins only where the input, as converted, is grey (chroma
// under 0.001) and the hop's chroma exceeds that by 0.001, which a greyed none hue alone does (an HDR input, whose hops
// clamp its lightness, never does; a none hue of chroma under 0.001 stays grey). Elsewhere, every color in Chrome and
// Firefox included, pick() is the input itself, exactly: as text (a registered color reaches var() at 6 digits in
// WebKit), premultiplied by alpha 1 and unpremultiplied by powers of two; its alpha 1/2, which no reader takes.
const noneHue = (src, prefix) => {
  const A = `oklch(from ${src} l c h / 1)`, B = `lch(from ${src} l c h)`; // (B not `/ 1`: share() then took it inside A as okvar(…))
  const r = (n) => `var(${prefix}${n})`, flag = (a) => `oklch(from ${r('g')} none none none / calc(${a}))`;
  const aWins = 'clamp(0, sign(c - h) + 1, 1)', hop = 'clamp(0, sign(0.001 - l), 1) * clamp(0, sign(max(c, h) - l - 0.001), 1)';
  const w = (space, kw, c, f) => `color-mix(in ${space}, color(from ${c} ${space} ${kw} / none) 100%, ${f} 0%)`;
  return {
    props: ['g', 'h', 'x', 'o'].map((n) => `@property ${prefix}${n} { syntax: '<color>'; inherits: false; initial-value: transparent; }`).join('\n'),
    decls: [`${prefix}g: color-mix(in oklch, color-mix(in oklch, oklch(from color(from ${src} xyz-d65 x y z) c none none / none), oklch(from ${A} none c none / none)), oklch(from ${B} none none c / none));`,
      `${prefix}h: color-mix(in xyz-d65, ${w('xyz-d65', 'x y z', A, flag(aWins))}, ${w('xyz-d65', 'x y z', B, flag(`1 - ${aWins}`))});`,
      `${prefix}x: ${flag(`1 - ${hop}`)};`, `${prefix}o: ${flag(hop)};`],
    pick: (space, kw) => `color-mix(in ${space}, ${w(space, kw, src, r('x'))}, ${w(space, kw, r('h'), r('o'))})`,
  };
};
// A hue input as oklch()'s: a number of degrees or an angle (deg, rad, grad, turn); none, or anything else, 0. Two
// registers, a number and an angle, each its type's initial where the input is the other.
const hueRegs = (prefix, input) => ({
  props: `@property ${prefix}hn { syntax: '<number>'; inherits: false; initial-value: 0; }\n@property ${prefix}ha { syntax: '<angle>'; inherits: false; initial-value: 0deg; }`,
  decls: `${prefix}hn: var(${input}, 0); ${prefix}ha: var(${input}, 0deg);`,
  angle: `(var(${prefix}hn) * 1deg + var(${prefix}ha))`,
});
// Number inputs as registered <number>s, so one that isn't a number (none, 90%, a unit) reads as its initial (0), the
// same in every step that reads it, whatever the step graph inlines
const numRegs = (prefix, inputs) => ({
  props: inputs.map(([n]) => `@property ${prefix}${n} { syntax: '<number>'; inherits: false; initial-value: 0; }`).join('\n'),
  decls: inputs.map(([n, input, def]) => `${prefix}${n}: var(${input}, ${def});`).join(' '),
});

const OK_RGB = [[4.0767416621, -3.3077115913, 0.2309699292], [-1.2684380046, 2.6097574011, -0.3413193965], [-0.0041960863, -0.7034186147, 1.7076147010]];
// The constants ok_color.h fits to sRGB (its matrix to linear sRGB, compute_max_saturation's branch lines and
// polynomials), for #8659's Display P3 and Rec. 2020 variants: the parts read them by name, as unregistered custom
// properties (substituted as text, every digit), ok_color.h's own on the classes and okhsl-fit.mjs's under
// @container style(--gamut-target: display-p3 | rec2020). get_ST_mid stays ok_color.h's for all three.
const OK_SETS = { srgb: { rgb: OK_RGB, rt: [[-1.88170328, -0.80936493], [1.81444104, -1.19445276]],
  k: [[1.19086277, 1.76576728, 0.59662641, 0.75515197, 0.56771245], [0.73956515, -0.45954404, 0.08285427, 0.12541070, 0.14503204], [1.35733652, -0.00915799, -1.15130210, -0.50559606, 0.00692167]] }, ...OKHSL_GAMUTS };
const OKN = { rgb: (i, j) => `--gamut--oc${3 * i + j}`, rt: (i, j) => `--gamut--oc${9 + 2 * i + j}`, k: (i, j) => `--gamut--oc${13 + 5 * i + j}` };
const OKC = Object.fromEntries(Object.entries(OKN).map(([x, f]) => [x, OK_SETS.srgb[x].map((r, i) => r.map((_, j) => `var(${f(i, j)})`))]));
const okConsts = (set) => Object.entries(OKN).flatMap(([x, f]) => set[x].flatMap((r, i) => r.map((v, j) => `${f(i, j)}: ${v};`))).join(' ');
const OK_LIT = new Map(Object.entries(OKN).flatMap(([x, f]) => OK_SETS.srgb[x].flatMap((r, i) => r.map((v, j) => [`var(${f(i, j)})`, `${v}`]))));
const okLit = (e) => e.replace(/var\(--gamut--oc\d+\)/g, (m) => OK_LIT.get(m));
const OK_CLASSES = '.okhsl, .okhsv, .okhsl-from';
const okGamuts = () => `${OK_CLASSES} { ${okConsts(OK_SETS.srgb)} }
${Object.keys(OKHSL_GAMUTS).map((g) => `@container style(--gamut-target: ${g}) { ${OK_CLASSES} { ${okConsts(OK_SETS[g])} } }`).join('\n')}`;
const okSel = (x) => `clamp(0, sign(${x}), 1)`; // 1 when x > 0
const okDot = (w, x, y, z) => `${w[0]} * ${x} + ${w[1]} * ${y} + ${w[2]} * ${z}`;
const okSafe = (d) => `(max(abs(${d}), 1e-30) * (sign(${d}) + 1 - abs(sign(${d}))))`; // never 0
// ok_color.h's find_cusp for the hue's unit vector (steps a and b), as steps of registered <number>s: Okhsl and Okhsv
// share it. Gives kl, km, ks (the hue's LMS directions), Lc and Cc (the cusp)
function okCusp(n) {
  const RGB = OKC.rgb, sel = okSel, dot = okDot, safe = okSafe, [KR, KG, KB] = OKC.k, T = OKC.rt;
  const poly = (k) => `(${k[0]} + ${k[1]} * ${n('a')} + ${k[2]} * ${n('b')} + ${k[3]} * ${n('a')} * ${n('a')} + ${k[4]} * ${n('a')} * ${n('b')})`;
  const pick = (r, g, b) => `(${n('R')} * ${r} + ${n('G')} * ${g} + (1 - ${n('R')} - ${n('G')}) * ${b})`;
  return [
    // compute_max_saturation: which of r, g, b reaches zero first; a polynomial; one Halley step
    // at the blue corner (both tests within 1e-4 of 1) the green branch, as ok_color.h takes it (okhsl.mjs maxSaturation)
    ['Rt', `${T[0][0]} * ${n('a')} + ${T[0][1]} * ${n('b')}`], ['Gt', `${T[1][0]} * ${n('a')} + ${T[1][1]} * ${n('b')}`],
    ['corner', `${sel(`0.0001 - abs(${n('Rt')} - 1)`)} * ${sel(`0.0001 - abs(${n('Gt')} - 1)`)}`],
    ['R', `(1 - ${n('corner')}) * ${sel(`${n('Rt')} - 1`)}`],
    ['G', `(1 - ${n('R')}) * max(${n('corner')}, ${sel(`${n('Gt')} - 1`)})`],
    ['S0', pick(poly(KR), poly(KG), poly(KB))],
    ['wl', pick(RGB[0][0], RGB[1][0], RGB[2][0])], ['wm', pick(RGB[0][1], RGB[1][1], RGB[2][1])], ['ws', pick(RGB[0][2], RGB[1][2], RGB[2][2])],
    ['kl', `0.3963377774 * ${n('a')} + 0.2158037573 * ${n('b')}`], ['km', `-0.1055613458 * ${n('a')} - 0.0638541728 * ${n('b')}`],
    ['ks', `-0.0894841775 * ${n('a')} - 1.2914855480 * ${n('b')}`],
    ['l1', `1 + ${n('S0')} * ${n('kl')}`], ['m1', `1 + ${n('S0')} * ${n('km')}`], ['s1', `1 + ${n('S0')} * ${n('ks')}`],
    ['f', `${n('wl')} * pow(${n('l1')}, 3) + ${n('wm')} * pow(${n('m1')}, 3) + ${n('ws')} * pow(${n('s1')}, 3)`],
    ['f1', `3 * (${n('wl')} * ${n('kl')} * ${n('l1')} * ${n('l1')} + ${n('wm')} * ${n('km')} * ${n('m1')} * ${n('m1')} + ${n('ws')} * ${n('ks')} * ${n('s1')} * ${n('s1')})`],
    ['f2', `6 * (${n('wl')} * ${n('kl')} * ${n('kl')} * ${n('l1')} + ${n('wm')} * ${n('km')} * ${n('km')} * ${n('m1')} + ${n('ws')} * ${n('ks')} * ${n('ks')} * ${n('s1')})`],
    ['S', `${n('S0')} - ${n('f')} * ${n('f1')} / ${safe(`${n('f1')} * ${n('f1')} - 0.5 * ${n('f')} * ${n('f2')}`)}`],
    // find_cusp: the cube of each LMS at L = 1, chroma S
    ['cl', `pow(1 + ${n('S')} * ${n('kl')}, 3)`], ['cm', `pow(1 + ${n('S')} * ${n('km')}, 3)`], ['cs', `pow(1 + ${n('S')} * ${n('ks')}, 3)`],
    ['Lc', `pow(1 / max(${dot(RGB[0], n('cl'), n('cm'), n('cs'))}, ${dot(RGB[1], n('cl'), n('cm'), n('cs'))}, ${dot(RGB[2], n('cl'), n('cm'), n('cs'))}), 1 / 3)`],
    ['Cc', `${n('Lc')} * ${n('S')}`],
  ];
}

// Okhsl (#8659, #10110) from three numbers: ok_color.h's okhsl_to_srgb as registered <number>s, one
// step a property (each computed once; a step's NaN or infinity is censored before the next selects with it), out as
// oklab(). Branches become sums weighted by 0-or-1 selectors.
export function okhslPart() {
  const n = (x) => `var(--gamut--ok-${x})`;
  const RGB = OKC.rgb, sel = okSel, dot = okDot, safe = okSafe;
  const H = hueRegs('--gamut--ok-', '--gamut-okhsl-h'), I = numRegs('--gamut--ok-', [['sn', '--gamut-okhsl-s', 0], ['ln', '--gamut-okhsl-l', 0.5]]);
  const steps = [
    ['a', `cos(${H.angle})`], ['b', `sin(${H.angle})`],
    ['s', n('sn')],
    ['L', `calc((pow(clamp(0, ${n('ln')}, 1), 2) + 0.206 * clamp(0, ${n('ln')}, 1)) / (1.1708737864077670 * (clamp(0, ${n('ln')}, 1) + 0.03)))`],
    ['Lg', `clamp(0.000001, ${n('L')}, 0.999999)`],
    ...okCusp(n),
    // find_gamut_intersection along constant L: below the cusp the triangle; above it the triangle and one Halley step
    ['t0', `${n('Cc')} * (${n('Lg')} - 1) / ${safe(`${n('Lc')} - 1`)}`],
    ['vl', `${n('Lg')} + ${n('t0')} * ${n('kl')}`], ['vm', `${n('Lg')} + ${n('t0')} * ${n('km')}`], ['vs', `${n('Lg')} + ${n('t0')} * ${n('ks')}`],
    ...['r', 'g', 'bb'].flatMap((c, i) => {
      const w = RGB[i], e = `${dot(w, `pow(${n('vl')}, 3)`, `pow(${n('vm')}, 3)`, `pow(${n('vs')}, 3)`)} - 1`;
      const e1 = `3 * (${dot(w, `${n('kl')} * ${n('vl')} * ${n('vl')}`, `${n('km')} * ${n('vm')} * ${n('vm')}`, `${n('ks')} * ${n('vs')} * ${n('vs')}`)})`;
      const e2 = `6 * (${dot(w, `${n('kl')} * ${n('kl')} * ${n('vl')}`, `${n('km')} * ${n('km')} * ${n('vm')}`, `${n('ks')} * ${n('ks')} * ${n('vs')}`)})`;
      return [[`e${c}`, e], [`u${c}`, `(${e1}) / ${safe(`(${e1}) * (${e1}) - 0.5 * ${n(`e${c}`)} * (${e2})`)}`],
        [`t${c}`, `clamp(0, sign(${n(`u${c}`)}) + 1, 1) * -1 * ${n(`e${c}`)} * ${n(`u${c}`)} + (1 - clamp(0, sign(${n(`u${c}`)}) + 1, 1)) * 1e30`]];
    }),
    ['low', `clamp(0, sign(${n('Lc')} - ${n('Lg')}) + 1, 1)`],
    ['Cmax', `${n('low')} * ${n('Cc')} * ${n('Lg')} / ${n('Lc')} + (1 - ${n('low')}) * (${n('t0')} + min(${n('tr')}, ${n('tg')}, ${n('tbb')}))`],
    // get_Cs
    ['k', `${n('Cmax')} / min(${n('Lg')} * ${n('Cc')} / ${n('Lc')}, (1 - ${n('Lg')}) * ${n('Cc')} / (1 - ${n('Lc')}))`],
    ['Sm', `0.11516993 + 1 / (7.44778970 + 4.15901240 * ${n('b')} + ${n('a')} * (-2.19557347 + 1.75198401 * ${n('b')} + ${n('a')} * (-2.13704948 - 10.02301043 * ${n('b')} + ${n('a')} * (-4.24894561 + 5.38770819 * ${n('b')} + 4.69891013 * ${n('a')}))))`],
    ['Tm', `0.11239642 + 1 / (1.61320320 - 0.68124379 * ${n('b')} + ${n('a')} * (0.40370612 + 0.90148123 * ${n('b')} + ${n('a')} * (-0.27087943 + 0.61223990 * ${n('b')} + ${n('a')} * (0.00299215 - 0.45399568 * ${n('b')} - 0.14661872 * ${n('a')}))))`],
    ['Cmid', `0.9 * ${n('k')} * pow(1 / (1 / pow(${n('Lg')} * ${n('Sm')}, 4) + 1 / pow((1 - ${n('Lg')}) * ${n('Tm')}, 4)), 0.25)`],
    ['C0', `sqrt(1 / (1 / pow(0.4 * ${n('Lg')}, 2) + 1 / pow(0.8 * (1 - ${n('Lg')}), 2)))`],
    // s below 0.8: from 0 to C_mid; above: from C_mid to C_max
    ['C1', `1.25 * ${n('s')} * 0.8 * ${n('C0')} / (1 - (1 - 0.8 * ${n('C0')} / ${n('Cmid')}) * 1.25 * ${n('s')})`],
    ['k1', `0.3125 * ${n('Cmid')} * ${n('Cmid')} / ${n('C0')}`],
    ['C2', `${n('Cmid')} + 5 * (${n('s')} - 0.8) * ${n('k1')} / (1 - (1 - ${n('k1')} / (${n('Cmax')} - ${n('Cmid')})) * 5 * (${n('s')} - 0.8))`],
    // (okhsl_to_srgb's l = 1 is white and l = 0 black; Lg kept l = 1 at 0.999999, 2.7e-6 chroma in Chrome 155. Below
    // Lg's 1e-6 the chroma scales by L / Lg: C_0, C_mid and C_max are each L times a constant there, so this is
    // okhsl_to_srgb's own; at l 1e-8 the chroma of L 1e-6 came out 17 times too much, an audit, 2026-10-29;
    // and above its 0.999999 by (1 - L) / (1 - Lg), each linear in 1 - L there: at l 0.9999999, 5.1e-7 for 4.4e-8)
    ['C', `(${sel(`0.8 - ${n('s')}`)} * ${n('C1')} + (1 - ${sel(`0.8 - ${n('s')}`)}) * ${n('C2')}) * clamp(0, sign(${n('ln')} * (1 - ${n('ln')})), 1) * min(1, ${n('L')} / ${n('Lg')}, (1 - ${n('L')}) / (1 - ${n('Lg')}))`],
  ];
  return `/* Okhsl, hue, saturation and lightness over Oklab; #8659 (add Okhsl) and
   #10110 (a future-proof way to change lightness: in Okhsl, l = 1 is white and s = 1 the sRGB edge at any l).
   .okhsl: In: --gamut-okhsl-h (degrees or an angle, oklch()'s hue), --gamut-okhsl-s and --gamut-okhsl-l (0 to 1;
   none, a percentage or a unit reads as 0). Out: --gamut-out, as oklab(). ok_color.h's okhsl_to_srgb step by step. */
${H.props}
${I.props}
.okhsl { ${H.decls} ${I.decls} }
${registered('--gamut--ok-', '.okhsl', steps, { '--gamut-out': `oklab(${n('L')} calc(${n('C')} * ${n('a')}) calc(${n('C')} * ${n('b')}))` })}`;
}

// a part's steps as registered <number>s and its outputs (raw, as written) on one class: the step graph (lib/steps.mjs)
// writes a step read once, and cheap enough, where it is read, one register fewer
function registered(prefix, cls, list, outs) {
  // the step graph keeps or inlines each step as it would with ok_color.h's sRGB constants written out (a dry run on them), so
  // the gamut constants' names change no choice and the sRGB results stay as they were
  const run = (lit, storage) => {
    const props = [], g = stepGraph({ prefix, as: REGISTERED, sel: () => cls, weigh: (e) => e.length + 100, storage,
      keep: (x, e) => { props.push(`@property ${prefix}${x} { syntax: '<number>'; inherits: false; initial-value: 0; }`); return `${prefix}${x}: calc(${e});`; } });
    for (const [x, e] of list) g.step(x, lit(e));
    g.out(cls, Object.keys(outs), Object.values(outs).map(lit), true);
    return { ...g.emit(), props };
  };
  const kept = new Set(run(okLit).report.match(/kept: ([^;]*);/)[1].split(' '));
  const { rules, props } = run((e) => e, Object.fromEntries(list.map(([x]) => [x, kept.has(x) ? 'keep' : 'inline'])));
  return `${props.join('\n')}\n${rules.join('\n')}`;
}


// Okhsv (#8659 names it with Okhsl) from three numbers: ok_color.h's okhsv_to_srgb as registered <number>s, on
// .okhsl's cusp (its green branch at the blue corner), out as oklab()
export function okhsvPart() {
  const n = (x) => `var(--gamut--ov-${x})`;
  const RGB = OKC.rgb, dot = okDot;
  const toeInv = (x) => `(pow(${x}, 2) + 0.206 * ${x}) / (1.1708737864077670 * (${x} + 0.03))`;
  const H = hueRegs('--gamut--ov-', '--gamut-okhsv-h'), I = numRegs('--gamut--ov-', [['sn', '--gamut-okhsv-s', 0], ['vn', '--gamut-okhsv-v', 1]]);
  const steps = [
    ['a', `cos(${H.angle})`], ['b', `sin(${H.angle})`],
    ['s', `clamp(0, ${n('sn')}, 1)`], ['v', `clamp(0, ${n('vn')}, 1)`],
    ...okCusp(n),
    // L and C as if the gamut were a triangle, at v = 1 (S_0 = 0.5)
    ['Tm', `${n('Cc')} / (1 - ${n('Lc')})`], ['k', `1 - 0.5 * ${n('Lc')} / ${n('Cc')}`],
    ['d', `0.5 + ${n('Tm')} - ${n('Tm')} * ${n('k')} * ${n('s')}`],
    ['Lv', `1 - ${n('s')} * 0.5 / ${n('d')}`], ['Cv', `${n('s')} * ${n('Tm')} * 0.5 / ${n('d')}`],
    // the toe and the triangle's curved top: L_vt, C_vt, and L = toe_inv(v L_v); ok_color.h's C * L_new / L written as
    // C_v * L_new / L_v, the same number without dividing by v, which is 0 at black
    ['Lvt', toeInv(n('Lv'))], ['Cvt', `${n('Cv')} * ${n('Lvt')} / ${n('Lv')}`],
    ['L', toeInv(`${n('v')} * ${n('Lv')}`)], ['C', `${n('Cv')} * ${n('L')} / ${n('Lv')}`],
    ['ql', `pow(${n('Lvt')} + ${n('Cvt')} * ${n('kl')}, 3)`], ['qm', `pow(${n('Lvt')} + ${n('Cvt')} * ${n('km')}, 3)`], ['qs', `pow(${n('Lvt')} + ${n('Cvt')} * ${n('ks')}, 3)`],
    ['sc', `pow(1 / max(${dot(RGB[0], n('ql'), n('qm'), n('qs'))}, ${dot(RGB[1], n('ql'), n('qm'), n('qs'))}, ${dot(RGB[2], n('ql'), n('qm'), n('qs'))}, 0), 1 / 3)`],
  ];
  return `/* Okhsv, hue, saturation and value over Oklab; #8659 (add Okhsl) names it beside Okhsl.
   .okhsv: In: --gamut-okhsv-h (degrees or an angle, oklch()'s hue), --gamut-okhsv-s and --gamut-okhsv-v (0 to 1;
   none, a percentage or a unit reads as 0). Out: --gamut-out, as oklab(). ok_color.h's okhsv_to_srgb step by step. */
${H.props}
${I.props}
.okhsv { ${H.decls} ${I.decls} }
${registered('--gamut--ov-', '.okhsv', steps, { '--gamut-out': `oklab(calc(${n('L')} * ${n('sc')}) calc(${n('C')} * ${n('sc')} * ${n('a')}) calc(${n('C')} * ${n('sc')} * ${n('b')}))` })}
${okGamuts()}`;
}

// A color's own Okhsl (okhsl(from <color> h s l), #10110's case), its s and l replaceable, back to a color. The
// color's numbers live only in color channels, three to a color: each step is a relative color in xyz-d65 (three
// unbounded channels) over a mix of the channels it reads, gathered by none from the registers that hold them. The hue
// rides as its cosine and sine and ok_color.h's three k (each a channel), so no step needs more than three numbers or
// any trigonometry; its sums over r, g, b and l, m, s become steps of their own (a Halley step: per LMS component, then
// per channel, then the least), and its branch picks two steps. Chrome re-parses each var() declaration on every
// element and the cost follows their length, so the steps are short and their registers --gamut--o-*.
export function okhslFromPart() {
  const RGB = OKC.rgb, T = OKC.rt;
  const XYZ_LMS = [[0.8190224379967030, 0.3619062600528904, -0.1288737815209879], [0.0329836539323885, 0.9292868615863434, 0.0361446663506424], [0.0481771893596242, 0.2642395317527308, 0.6335478284694309]];
  const LMS_OK = [[0.2104542683093140, 0.7936177747023054, -0.0040720430116193], [1.9779985324311684, -2.4285922420485799, 0.4505937096174110], [0.0259040424655478, 0.7827717124575296, -0.8086757549230774]];
  const OK_LMS = [[1, 0.3963377773761749, 0.2158037573099136], [1, -0.1055613458156586, -0.0638541728258133], [1, -0.0894841775298119, -1.2914855480194092]];
  const LMS_XYZ = [[1.2268798758459243, -0.5578149944602171, 0.2813910456659647], [-0.0405757452148008, 1.1122868032803170, -0.0717110580655164], [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816]];
  const KA = [[0.3963377774, 0.2158037573], [-0.1055613458, -0.0638541728], [-0.0894841775, -1.2914855480]];
  const dot = (w, v) => `(${w[0]} * ${v[0]} + ${w[1]} * ${v[1]} + ${w[2]} * ${v[2]})`.replace(/\+ -/g, '- ');
  const sel = (x) => `clamp(0, sign(${x}), 1)`, ge0 = (x) => `clamp(0, sign(${x}) + 1, 1)`;
  const safe = (d) => `(${d} + 1e-30)`; // never 0 but where it is within 1e-30 of it
  const poly = (c) => `(${c[0]} + ${c[1]} * $0 + ${c[2]} * $1 + ${c[3]} * $0 * $0 + ${c[4]} * $0 * $1)`.replace(/\+ -/g, '- ');
  const lg = (L) => `clamp(0.000001, ${L}, 0.999999)`;
  const toe = (x) => `0.5 * (1.1708737864077670 * ${x} - 0.206 + sqrt(pow(1.1708737864077670 * ${x} - 0.206, 2) + 0.1405048543689320 * ${x}))`;
  const P = [], node = (n, ins, outs) => P.push([n, ins, outs]);
  // components (v^3, k v^2, k^2 v) of v = base + chroma k_i for each LMS i, their sums per channel (A, B, C), one Halley
  // step per channel
  const halley = (p, base, chroma, step) => {
    const one = base === 1, v = one ? '(1 + $0 * $1)' : '($0 + $1 * $2)', kk = one ? '$1' : '$2';
    [0, 1, 2].forEach((i) => node(`${p}k${i}`, one ? [chroma, ['K', i]] : [base, chroma, ['K', i]], [`pow(${v}, 3)`, `${kk} * pow(${v}, 2)`, `${kk} * ${kk} * ${v}`]));
    ['A', 'B', 'C'].forEach((t, j) => node(`${p}${t}`, [0, 1, 2].map((i) => [`${p}k${i}`, j]), RGB.map((w) => dot(w, ['$0', '$1', '$2']))));
    [0, 1, 2].forEach((c) => node(`${p}u${c}`, [[`${p}A`, c], [`${p}B`, c], [`${p}C`, c]], [step]));
  };
  node('lms', [['in', 0], ['in', 1], ['in', 2]], XYZ_LMS.map((w) => `sign(${dot(w, ['$0', '$1', '$2'])}) * pow(abs(${dot(w, ['$0', '$1', '$2'])}), 1 / 3)`));
  node('lab', [['lms', 0], ['lms', 1], ['lms', 2]], LMS_OK.map((w) => dot(w, ['$0', '$1', '$2'])));
  // the hue's cosine and sine, and the chroma; below chroma 1e-4 a grey, hue 0
  node('cb', [['lab', 1], ['lab', 2]], [`${ge0('hypot($0, $1) - 0.0001')} * ($0 / max(hypot($0, $1), 1e-30) - 1) + 1`, `${ge0('hypot($0, $1) - 0.0001')} * $1 / max(hypot($0, $1), 1e-30)`, 'hypot($0, $1)']);
  node('K', [['cb', 0], ['cb', 1]], KA.map(([p, q]) => `${p} * $0 + ${q} * $1`.replace(/\+ -/g, '- ')));
  // compute_max_saturation: which channel reaches 0 first; at the blue corner (both tests within 1e-4 of 1) the green
  // branch, as ok_color.h takes it (okhsl.mjs maxSaturation): the hue's line leaves sRGB at red's zero, comes back at blue
  node('Rt', [['cb', 0], ['cb', 1]], T.map(([p, q]) => `${p} * $0 + ${q} * $1`));
  node('RG', [['Rt', 0], ['Rt', 1]], [`(1 - ${sel('0.0001 - abs($0 - 1)')} * ${sel('0.0001 - abs($1 - 1)')}) * ${sel('$0 - 1')}`, `max(${sel('0.0001 - abs($0 - 1)')} * ${sel('0.0001 - abs($1 - 1)')}, ${sel('$1 - 1')})`]);
  node('poly', [['cb', 0], ['cb', 1]], OKC.k.map(poly));
  node('pgb', [['RG', 1], ['poly', 1], ['poly', 2]], ['$0 * $1 + (1 - $0) * $2']);
  node('S0', [['RG', 0], ['poly', 0], ['pgb', 0]], ['$0 * $1 + (1 - $0) * $2']);
  halley('m', 1, ['S0', 0], `3 * $0 * $1 / ${safe('9 * $1 * $1 - 3 * $0 * $2')}`);
  node('mgb', [['RG', 1], ['mu1', 0], ['mu2', 0]], ['$0 * $1 + (1 - $0) * $2']);
  node('mD', [['RG', 0], ['mu0', 0], ['mgb', 0]], ['$0 * $1 + (1 - $0) * $2']);
  node('S', [['S0', 0], ['mD', 0]], ['$0 - $1']);
  // find_cusp
  [0, 1, 2].forEach((i) => node(`U${i}`, [['S', 0], ['K', i]], ['pow(1 + $0 * $1, 3)']));
  node('Lc', [['U0', 0], ['U1', 0], ['U2', 0]], [`pow(1 / max(${RGB.map((w) => dot(w, ['$0', '$1', '$2'])).join(', ')}), 1 / 3)`]);
  node('cusp', [['Lc', 0], ['S', 0]], ['$0', '$0 * $1']);
  node('mid', [['cb', 0], ['cb', 1]], ['0.11516993 + 1 / (7.44778970 + 4.15901240 * $1 + $0 * (-2.19557347 + 1.75198401 * $1 + $0 * (-2.13704948 - 10.02301043 * $1 + $0 * (-4.24894561 + 5.38770819 * $1 + 4.69891013 * $0))))',
    '0.11239642 + 1 / (1.61320320 - 0.68124379 * $1 + $0 * (0.40370612 + 0.90148123 * $1 + $0 * (-0.27087943 + 0.61223990 * $1 + $0 * (0.00299215 - 0.45399568 * $1 - 0.14661872 * $0))))']);
  // get_Cs at a lightness: C_max (the triangle below the cusp; above it, the triangle and one Halley step), C_mid, C_0
  const block = (p, Lref) => {
    node(`${p}a`, [Lref, ['cusp', 0], ['cusp', 1]], [lg('$0'), `$2 * (${lg('$0')} - 1) / ${safe('$1 - 1')}`, `${ge0(`$1 - ${lg('$0')}`)} * ($2 * ${lg('$0')} / $1 + 1) - 1`]);
    node(`${p}b`, [Lref, ['cusp', 0], ['cusp', 1]], [`min(${lg('$0')} * $2 / $1, (1 - ${lg('$0')}) * $2 / (1 - $1))`, `sqrt(1 / (1 / pow(0.4 * ${lg('$0')}, 2) + 1 / pow(0.8 * (1 - ${lg('$0')}), 2)))`]);
    halley(p, [`${p}a`, 0], [`${p}a`, 1], `${ge0('$1 * (3 * $1 * $1 - ($0 - 1) * $2)')} * (1 - $0) * $1 / ${safe('3 * $1 * $1 - ($0 - 1) * $2')} + (1 - ${ge0('$1 * (3 * $1 * $1 - ($0 - 1) * $2)')}) * 1e30`);
    node(`${p}n`, [[`${p}u0`, 0], [`${p}u1`, 0], [`${p}u2`, 0]], ['min($0, $1, $2)']);
    node(`${p}c`, [[`${p}a`, 2], [`${p}a`, 1], [`${p}n`, 0]], [`${ge0('$0')} * $0 + (1 - ${ge0('$0')}) * ($1 + $2)`]);
    node(`${p}s`, [Lref, ['mid', 0], ['mid', 1]], [`pow(1 / (1 / pow(${lg('$0')} * $1, 4) + 1 / pow((1 - ${lg('$0')}) * $2, 4)), 0.25)`]);
    node(`${p}m`, [[`${p}c`, 0], [`${p}b`, 0], [`${p}s`, 0]], ['0.9 * $0 / $1 * $2', '$0']);
  };
  block('p', ['lab', 0]);
  // the color's s: the inverse of okhsl_to_srgb's interpolation (a grey: 0)
  node('sa', [['cb', 2], ['pm', 0], ['pb', 1]], [`${ge0('$0 - 0.0001')} * ($0 - $1 + 1) - 1`, '0.3125 * $1 * $1 / $2', `${ge0('$0 - 0.0001')} * 0.8 * $0 / (0.8 * $2 + (1 - 0.8 * $2 / $1) * $0)`]);
  node('sq', [['sa', 1], ['pm', 1], ['pm', 0]], ['$0 / ($1 - $2)']);
  node('sh', [['sa', 0], ['sa', 1], ['sq', 0]], [`0.8 + 0.2 / (1 + $1 / ${safe('$0')} - $2)`]);
  node('s', [['sa', 0], ['sa', 2], ['sh', 0]], [`${ge0('$0')} * $2 + (1 - ${ge0('$0')}) * $1`]);
  // the target: l and s as given, else the color's own; L = toe_inv(l). (Block q copying block p when l is unset was
  // measured 2026-10-24: 17-21% faster with only s set, 4-7% slower with l set)
  // --gamut-okhsl-l and -s through registered numbers whose initial, -1e30, stands for unset (or none, or anything not
  // a number): then the color's own
  const given = (x) => `clamp(0, sign(var(--gamut--o-${x}) + 1e29), 1)`, or = (x, own) => `${given(x)} * var(--gamut--o-${x}) + (1 - ${given(x)}) * ${own}`;
  node('l', [['lab', 0]], [`clamp(0, ${or('li', toe('$0'))}, 1)`]);
  // (s 0 within 1e-4 of l 0 and 1, where the most chroma is under 1e-4: okhsl_to_srgb's black and white; Chrome 155
  // reads white's l 1e-5 under 1, and white at s 1 kept chroma 2.8e-6, an audit, 2026-10-28)
  node('tgt', [['l', 0], ['s', 0]], ['($0 * $0 + 0.206 * $0) / (1.1708737864077670 * ($0 + 0.03))', `(${or('si', '$1')}) * clamp(0, sign(min($0, 1 - $0) - 0.0001), 1)`]);
  block('q', ['tgt', 0]);
  // okhsl_to_srgb's chroma: below s = 0.8 toward C_mid; above it 1 / (C - C_mid) = (1 - T) / (T k1) + 1 / (C_max - C_mid)
  node('c1', [['tgt', 1], ['qm', 0], ['qb', 1]], ['1.25 * $0 * 0.8 * $2 / (1 - (1 - 0.8 * $2 / $1) * 1.25 * $0)', `(1 - 5 * ($0 - 0.8)) / ${safe('5 * ($0 - 0.8) * 0.3125 * $1 * $1 / $2')}`]);
  node('c2', [['qm', 0], ['c1', 1], ['qm', 1]], [`$0 + 1 / ${safe(`$1 + 1 / ${safe('$2 - $0')}`)}`]);
  node('C', [['tgt', 1], ['c1', 0], ['c2', 0]], [`${sel('0.8 - $0')} * $1 + (1 - ${sel('0.8 - $0')}) * $2`]);
  // oklab(L, C a, C b) to xyz-d65
  node('ab', [['C', 0], ['cb', 0], ['cb', 1]], ['$0 * $1', '$0 * $2']);
  node('olms', [['tgt', 0], ['ab', 0], ['ab', 1]], OK_LMS.map((w) => `pow(${dot(w, ['$0', '$1', '$2'])}, 3)`));
  node('xyz', [['olms', 0], ['olms', 1], ['olms', 2]], LMS_XYZ.map((w) => dot(w, ['$0', '$1', '$2'])));
  // the input through noneHue() (WebKit greys a none hue, QUIRKS.md Q3)
  const reg = (n) => (n === 'in' ? 'var(--gamut--o-fix)' : `var(--gamut--o-${n})`), KW = ['x', 'y', 'z'], nh = noneHue('var(--gamut-in, black)', '--gamut--on-');
  // each step's numbers in the channels that let the most gathers mix the colors as they are (lib/lanes.mjs); the
  // rest are cut down to the numbers wanted. Alpha none, said: Chrome takes an omitted alpha whose origin's is none as
  // 0, and a mix of two alpha-0 colors loses their channels
  const lanes = allocate(P, reg, ['xyz']); if (process.env.FOLD_REPORT) console.error(`okhsl-from: ${lanes.report}`);
  const value = new Map(P.map(([n, , outs]) => {
    const { css, chan } = lanes.gather(n), at = lanes.place(n);
    const sub = (e) => e.replace(/\$([0-2])/g, (_, i) => chan[+i]);
    const short = (e) => e.replace(/(\d+\.\d{10})\d+/g, '$1');
    return [n, `color(from ${css} xyz-d65 ${[0, 1, 2].map((c) => { const i = at.indexOf(c); return i >= 0 ? `calc(${short(sub(outs[i]))})` : 'none'; }).join(' ')} / none)`];
  }));
  const decls = [...value].map(([n, v]) => `--gamut--o-${n}: ${v};`);
  return `/* A color's own Okhsl (okhsl(from <color> h s l)); #10110 (change lightness, future-proof),
   #8659. .okhsl-from: In: --gamut-in; --gamut-okhsl-l and --gamut-okhsl-s replace the color's own (each optional;
   none, or anything not a number, keeps the color's own). Out: --gamut-out, the color at its own Okhsl hue with that
   s and l (keeping its alpha; at alpha 0 its channels too: the alpha rides as 0.5 to 1 through the last mix, since a
   mix to alpha 0 loses the channels in Chrome). ok_color.h both ways, its numbers three to a color in xyz-d65
   channels, ${P.length} steps. A color past sRGB extrapolates (past Okhsl's pole even ok_color.h's own s turns
   negative). */
${nh.props}
${['fix', ...value.keys()].map((n) => `@property --gamut--o-${n} { syntax: '<color>'; inherits: false; initial-value: black; }`).join('\n')}
${['li', 'si'].map((n) => `@property --gamut--o-${n} { syntax: '<number>'; inherits: false; initial-value: -1e30; }`).join('\n')}
.okhsl-from {
  --gamut--o-li: var(--gamut-okhsl-l); --gamut--o-si: var(--gamut-okhsl-s);
  ${nh.decls.join('\n  ')}
  --gamut--o-fix: ${nh.pick('xyz-d65', 'x y z')};
  ${decls.join('\n  ')}
  --gamut-out: color(from color-mix(in xyz-d65, color(from var(--gamut--o-xyz) xyz-d65 x y z / none), color(from var(--gamut-in, black) xyz-d65 none none none / calc(alpha / 2 + 0.5))) xyz-d65 x y z / calc(alpha * 2 - 1));
}`;
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
  const { A, W } = JSON.parse(readFileSync(new URL('./paint.json', import.meta.url), 'utf8')), S = A[0].length, G = Math.ceil(S / 3);
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

// CSS Color 5 §4.10 alpha(): the origin's components, a new alpha. The browser's own where it parses (Chrome, Firefox);
// elsewhere (WebKit) a relative color in sRGB, the same color and alpha as color(srgb), its missing components 0. It reads
// the color as oklch(from … l c h) first: WebKit converts an OkLCh color with a `none` hue as grey (QUIRKS.md Q3), and
// the hop turns that hue into 0 within OkLCh (an lch() one stays grey: the hop is itself a conversion)
export function alphaPart() {
  const a = 'var(--gamut-alpha-value, alpha)';
  return `/* CSS Color 5's alpha(): a color with only its alpha changed; #13994 and
   #13992 (its serialization). .alpha: In: --gamut-in; --gamut-alpha-value, an <alpha-value>, none, or a calc() of the
   keyword alpha (the origin's alpha), default the origin's alpha. Out: --gamut-out. Where alpha() parses, the browser's
   own; elsewhere a relative color in sRGB: the same color and alpha, as color(srgb), its missing components 0 (read
   through OkLCh first: QUIRKS.md Q3, which clamps OkLab lightness to 0 to 1). */
.alpha { --gamut-out: color(from oklch(from var(--gamut-in) l c h) srgb r g b / ${a}); }
@supports (color: alpha(from red / 0.5)) { .alpha { --gamut-out: alpha(from var(--gamut-in) / ${a}); } }`;
}

// #13836: light-dark() in a registered or inherited color resolves on the element that sets it, so a token set on the
// root keeps the root's scheme under a subtree with its own color-scheme. .light-dark keeps the token as its two
// colors (each a registered, inherited <color>: typed, animatable) and picks one with the engine's own light-dark() on
// the element that has the class: the scheme there, as light-dark() written on that element gives it (all three
// engines, test/small-parts-check.mjs). No function: --gamut-light-dark(a, b) would be light-dark(a, b) itself.
export function lightDarkPart() {
  return `/* #13836: a token that follows the color-scheme where it is used. .light-dark: In: --gamut-light and --gamut-dark,
   registered inherited colors (initial transparent), set where the token is defined. Out: --gamut-out, light-dark() of
   the two on this element, in its own used color scheme; its children inherit that color as it is. */
@property --gamut-light { syntax: '<color>'; inherits: true; initial-value: transparent; }
@property --gamut-dark { syntax: '<color>'; inherits: true; initial-value: transparent; }
.light-dark { --gamut-out: light-dark(var(--gamut-light), var(--gamut-dark)); }`;
}

// #13157, resolved (CSS Color 4 §12): two colors in one space compare component by component, `none` only equal to
// `none`; in two spaces a `none` makes them differ; else both in OkLab within 0.00001. CSS reads no color's space and no
// `none` directly, so each color is mixed at 0% with a probe color in oklab, srgb, hsl and hwb: a missing component the
// space has an analogous one for takes the probe's (7, far off any color), a present one stays. Each pair of probed
// colors is then compared in OkLab, their difference halved by a color-mix() with the second negated, into a flag
// color oklab(1 0 0) or oklab(0 0 0). The flags meet in a style()
// query on the children, and in Chrome in if() on the element. What it can't see: a `none` hue at zero chroma (it
// changes no channel), and the space of two colors with the same `none`s (README, SPEC).
const EQ_PROBES = [['srgb', 'color(srgb 7 7 7)'], ['hsl', 'hsl(77.7 77.7 77.7)'], ['hwb', 'hwb(77.7 31.4 31.4)']];
export function equalPart() {
  // first mixed half and half with a color of none but its alpha, 0.314: the none channels take the input's own, so
  // a transparent input keeps them through the premultiplying (0.314 of each to unpremultiply), its alpha a + 0.314
  // over 2, a missing one 0.314 (an audit, 2026-10-28: rgb(255 0 0 / 0) and rgb(128 0 0 / 0) came out
  // equal); then the probe fills the missing components. Firefox 158 carries no `none` out of a color-mix() into
  // another, and mixes three colors: there one mix does both (the feature query; Chrome 155 and WebKit 26.4 mix two)
  const Q = (s) => (s === 'srgb' ? 'color(srgb none none none / 0.314)' : `${s}(none none none / 0.314)`);
  const fills = [(x, s, p) => `color-mix(in ${s}, color-mix(in ${s}, var(${x}), ${Q(s)}) 100%, ${p} 0%)`, (x, s, p) => `color-mix(in ${s}, var(${x}) 50%, ${Q(s)} 50%, ${p} 0%)`];
  const flag = (d, e, l = '') => `oklab(from ${d} calc(clamp(0, sign(${e} - max(${l}abs(a), abs(b))) + 1, 1)) 0 0)`;
  // OkLab: exact, L and a in one color, b and alpha in the other (a missing alpha takes the probe's 0.314); the other
  // spaces only find a missing component, so one color each, with L as 1 - L (it clamps), and a looser bound: their
  // conversions part from OkLab's by up to 1e-4 (Chrome's sRGB curve)
  const P = 'oklab(0.931 7 7 / 0.314)', neg = (x) => `calc(-1 * ${x})`;
  const pairsOf = (fill) => {
    const half = (s, p, [l, a, b], [m, c, d]) => `color-mix(in oklab, oklab(from ${fill('--gamut-equal-a', s, p)} ${l} ${a} ${b} / 1), oklab(from ${fill('--gamut-equal-b', s, p)} ${m} ${c} ${d} / 1))`;
    // (alpha twice: the first mix halved its differences, and §12's bound on it is OkLab's 0.00001; with alpha once,
    // .5 and .500015 came out equal, an audit, 2026-10-28)
    // (and alpha as given, where a missing one reads 0: a missing alpha and 0.314 came out equal through the fills)
    const raw = `color-mix(in oklab, oklab(from var(--gamut-equal-a) 0.5 alpha 0 / 1), oklab(from var(--gamut-equal-b) 0.5 calc(-1 * alpha) 0 / 1))`;
    return [flag(half('oklab', P, ['0.5', 'l', 'a'], ['0.5', neg('l'), neg('a')]), '0.000005'), flag(half('oklab', P, ['0.5', 'b', 'calc(2 * alpha)'], ['0.5', neg('b'), 'calc(-2 * alpha)']), '0.000005'), flag(raw, '0.000005'),
      ...EQ_PROBES.map(([s, p]) => flag(half(s, p, ['l', 'a', 'b'], ['calc(1 - l)', neg('a'), neg('b')]), '0.0005', 'abs(l - 0.5), '))];
  };
  const [pairs, pairs3] = fills.map(pairsOf);
  const names = pairs.map((_, k) => `--gamut--eq${k}`), all = names.map((n) => `style(${n}: oklab(1 0 0))`).join(' and ');
  return `/* #13157: whether two colors are the same color (CSS Color 4 §12). .color-equal: In: --gamut-equal-a and
   --gamut-equal-b. Out: --gamut-equal, 1 or 0, on the element's children (and on the element itself where if() parses). */
${names.map((n) => `@property ${n} { syntax: '<color>'; initial-value: black; inherits: false; }`).join('\n')}
@property --gamut-equal { syntax: '<number>'; inherits: true; initial-value: 0; }
.color-equal { ${names.map((n, k) => `${n}: ${pairs[k]};`).join(' ')} --gamut-equal: if(${all}: 1; else: 0); }
@supports (color: color-mix(in srgb, red 50%, red 50%, red 0%)) { .color-equal { ${names.map((n, k) => `${n}: ${pairs3[k]};`).join(' ')} } }
/* (a child that is itself a .color-equal keeps its own result where if() parses: \`> *\` gave it its parent's, a clean
   room's audit, 2026-10-29) */
.color-equal > :not(.color-equal) { --gamut-equal: 0; }
@container ${all} { .color-equal > :not(.color-equal) { --gamut-equal: 1; } }`;
}

// CSS Color 5 §6 device-cmyk(), which no engine ships: its naive conversion to sRGB (§6.1)
export function cmykPart() {
  // c, m and y ride in an srgb color's channels, k in its alpha: color() reads a number or a percentage (100% is 1) in
  // each, and clamps the alpha to 0 to 1 itself (§6: out-of-range values clamp at computed-value time); then
  // 1 - min(1, c (1 - k) + k), which for c and k in 0 to 1 is (1 - c) (1 - k)
  const v = (c) => `var(--gamut-cmyk-${c}, 0)`, ch = (x) => `calc((1 - clamp(0, ${x}, 1)) * (1 - alpha))`;
  return `/* CSS Color 5's device-cmyk(); #13934. .device-cmyk: In: --gamut-cmyk-c, -m, -y, -k (0 to 1 or 0% to
   100%, clamped) and --gamut-cmyk-alpha (default 1). Out: --gamut-out, CSS Color 5 §6.1's naive conversion to sRGB. */
.device-cmyk { --gamut-out: color(from color(srgb ${v('c')} ${v('m')} ${v('y')} / ${v('k')}) srgb ${ch('r')} ${ch('g')} ${ch('b')} / var(--gamut-cmyk-alpha, 1)); }`;
}


// CSS Color HDR's rec2100-pq, rec2100-hlg and rec2100-linear, which no engine parses: the spec's own decoding
// (css-color-hdr-1's sample code, pq_decode and hlg_decode) to linear BT.2100 RGB with media white at 1, then BT.2020's
// matrix to XYZ D65. The input rides in one color's channels (xyz-d65 holds any number), so each step reads it by
// channel keyword. Out: color(xyz-d65 …), Y 1 at media white and up to 49 (PQ's 10,000 cd/m²) above it.
export function rec2100Part() {
  const M = [[0.6369580483012913, 0.14461690358620838, 0.16888097516417205], [0.26270021201126703, 0.677998071518871, 0.059301716469861945], [0, 0.028072693049087508, 1.0609850577107909]];
  // pq_decode: x = (max(v^(1/m) - c1, 0) / (c2 - c3 v^(1/m)))^(1/n) x 10000 / 203
  const pq = (v) => `calc(pow(max(pow(max(${v}, 0), 0.012683313515655966) - 0.8359375, 0) / (18.8515625 - 18.6875 * pow(max(${v}, 0), 0.012683313515655966)), 6.277394636015326) * 49.26108374384236)`;
  // hlg_decode: v^2 / 3 up to 0.5, (exp((v - c) / a) + b) / 12 above, both times 3.7743 (media white at 0.75)
  const hlg = (v) => `calc((clamp(0, sign(${v} - 0.5), 1) * (exp((${v} - 0.55991073) / 0.17883277) + 0.28466892) / 12 + (1 - clamp(0, sign(${v} - 0.5), 1)) * ${v} * ${v} / 3) * 3.7743)`;
  const row = (r) => `calc(${r.map((m, i) => (m === 0 ? null : `${m} * ${'xyz'[i]}`)).filter(Boolean).join(' + ')})`;
  const reg = (n) => `@property --gamut--r21-${n} { syntax: '<color>'; inherits: false; initial-value: transparent; }`;
  return `/* CSS Color HDR's rec2100-pq, rec2100-hlg and rec2100-linear color spaces; #10460 (PQ's
   absolute luminance, media white at 203 cd/m²) and #11346 (media white). .rec2100-pq,
   .rec2100-hlg, .rec2100-linear: In: --gamut-rec2100-r, -g, -b (the encoded channels, 0 to 1; linear's media white
   is 1 and HDR runs above it; none is 0, CSS Color 4 §4.4) and --gamut-rec2100-alpha (default 1). Out: --gamut-out, color(xyz-d65 …) decoded as
   the spec's sample code does: media white (PQ 0.5807, HLG 0.75, linear 1) is white, Y 1, and brighter colors keep
   Y above 1 for a screen that shows them. */
${reg('in')}
${reg('lin')}
.rec2100-pq, .rec2100-hlg, .rec2100-linear {
  --gamut--r21-in: color(xyz-d65 var(--gamut-rec2100-r, 0) var(--gamut-rec2100-g, 0) var(--gamut-rec2100-b, 0) / var(--gamut-rec2100-alpha, 1));
  --gamut-out: color(from var(--gamut--r21-lin) xyz-d65 ${M.map(row).join(' ')} / alpha);
}
.rec2100-pq { --gamut--r21-lin: color(from var(--gamut--r21-in) xyz-d65 ${pq('x')} ${pq('y')} ${pq('z')} / alpha); }
.rec2100-hlg { --gamut--r21-lin: color(from var(--gamut--r21-in) xyz-d65 ${hlg('x')} ${hlg('y')} ${hlg('z')} / alpha); }
.rec2100-linear { --gamut--r21-lin: var(--gamut--r21-in); }`;
}

// CSS Color HDR's jzazbz(), jzczhz() and ictcp(), which no engine parses: each decoded to XYZ D65 relative to media
// white (Y 1 at 203 cd/m²), as the spec's sample code would with its Jzazbz decode divided by 203 on the way back (it returns absolute XYZ,
// though its comment says relative to media white) and its
// ICtCp decode returning relative XYZ like its encode takes. Three steps, each a relative color in xyz-d65: the
// PQ-coded LMS from the coordinates, LMS by the PQ curve (Jzazbz's has its exponent scaled by 1.7), XYZ by matrix.
export function hdrSpacesPart() {
  const mat = (M, v = ['x', 'y', 'z']) => M.map((r) => `calc(${r.map((m, i) => `${m} * ${v[i]}`).join(' + ').replace(/\+ -/g, '- ')})`).join(' ');
  const reg = (n) => `@property --gamut--${n} { syntax: '<color>'; inherits: false; initial-value: transparent; }`;
  // Jzazbz: Iz from Jz, then [1, 0.1386, 0.0580; 1, -0.1386, -0.0580; 1, -0.0960, -0.8119] x [Iz, az, bz]
  const Iz = '((x + 1.6295499532821566e-11) / (1 - 0.56 - -0.56 * (x + 1.6295499532821566e-11)))';
  const JZ_PQ = [[1, 0.13860504327153927, 0.05804731615611883], [1, -0.1386050432715393, -0.058047316156118904], [1, -0.09601924202631895, -0.811891896056039]];
  const JZ_XYZ = [[1.9242264357876067, -1.0047923125953657, 0.037651404030618], [0.35031676209499907, 0.7264811939316552, -0.06538442294808501], [-0.09098281098284752, -0.3127282905230739, 1.5227665613052603]];
  // Xm, Ym, Za by JZ_XYZ, then Xa = (Xm + 0.15 Za) / 1.15, Ya = (Ym - 0.34 Xa) / 0.66, all over 203
  const row = (r) => `(${r.map((m, i) => `${m} * ${'xyz'[i]}`).join(' + ').replace(/\+ -/g, '- ')})`;
  const Xa = `((${row(JZ_XYZ[0])} + 0.15 * ${row(JZ_XYZ[2])}) / 1.15)`;
  const jzOut = `calc(${Xa} / 203) calc((${row(JZ_XYZ[1])} - 0.34 * ${Xa}) / 0.66 / 203) calc(${row(JZ_XYZ[2])} / 203)`;
  // PQ's inverse, LMS / 10000 = f^(1/m1), f = (P - c1) / (c2 - c3 P), from q = 1024 ln(v) k (k = 1/m2, or 1/p for Jz;
  // 102400 added where v < 0): P - 1 by its series where |ln(v) k| < 0.1, so neither c2 - c3 P nor P - c1 cancels in
  // 32-bit math, and a stored q keeps its digits where a stored v near 1 doesn't (6 significant digits through var())
  // v a bare sum, never in parentheses of its own: share() takes a repeated (v) and the same text as a function's
  // own arguments, abs(v), for one group, and writes absvar(…)
  const pqX = (v, k) => `calc(1024 * log(max(abs(${v}), 1e-30)) * ${k} + 102400 * clamp(0, sign(${v}) * -1, 1))`;
  const pqInv = (q, signed) => {
    const neg = `clamp(0, sign(${q} - 51200), 1)`, X = `((${q} - 102400 * ${neg}) / 1024)`;
    const series = `${X} * (1 + ${X} * (0.5 + ${X} * (0.16666666666666666 + ${X} * (0.041666666666666664 + ${X} * (0.008333333333333333 + ${X} * 0.001388888888888889)))))`;
    const near = `clamp(0, sign(0.1 - abs(${X})), 1)`;
    const pm1 = `((1 - ${neg}) * ((${series}) * ${near} + (exp(${X}) - 1) * (1 - ${near})) - ${neg} * (exp(${X}) + 1))`;
    const f = `((0.1640625 + ${pm1}) / (0.1640625 - 18.6875 * ${pm1}))`;
    return signed ? `calc(10000 * sign(${f}) * pow(abs(${f}), 6.277394636015326))` : `calc(10000 * pow(max(${f}, 0), 6.277394636015326))`;
  };
  // ICtCp: [L', M', S'] by the inverse of BT.2100's ICtCp matrix, LMS by PQ, absolute XYZ by matrix, over 203. L'M'S'
  // and LMS in one calc() from the inputs as written: a registered stage reaches var() at 6 significant digits in two
  // engines, and the PQ curve and the X row's cancellation took that to 4.2e-4 near 10,000 cd/m²
  const IC_PQ = [[0.9999999999999998, 0.0086090370379328, 0.1110296250030260], [0.9999999999999998, -0.0086090370379328, -0.1110296250030259], [0.9999999999999998, 0.5600313357106791, -0.3206271749873188]];
  const IC_XYZ = [[2.0701522183894223, -1.3263473389671563, 0.2066510476294053], [0.3647385209748072, 0.6805660249472273, -0.0453045459220347], [-0.0497472075358123, -0.0492609666966131, 1.1880659249923042]].map((r) => r.map((m) => +(m / 203).toPrecision(17)));
  // the inputs as written, in one color's channels, so a `none` reads as 0 in the step that takes them (CSS Color 4 §4.4:
  // "a missing component behaves as a zero value"); a calc() of `none` is invalid
  // each channel read as a registered <number> and as a registered <percentage>, each 0 where the input is the other or
  // neither, a percentage scaled to CSS Color HDR's reference range (100%: Jz and I 1, az and bz 0.21, Cz 0.26, Ct and
  // Cp 0.5; color(xyz-d65) alone took 100% as 1, an audit, 2026-10-28): the number carrier and the
  // percentage carrier summed by their mix doubled (no engine adds a number and a percentage in one calc() there)
  const H = hueRegs('--gamut--jz-', '--gamut-jzczhz-hz');
  const SCALE = { jzazbz: [1, 0.21, 0.21], jzczhz: [1, 0.26, 0], ictcp: [1, 0.5, 0.5] };
  const nm = (fn, k, t) => `--gamut--${fn.slice(0, 2)}${t}${k}`;
  const inRegs = Object.keys(SCALE).flatMap((fn) => [0, 1, 2].flatMap((k) => [`@property ${nm(fn, k, 'n')} { syntax: '<number>'; inherits: false; initial-value: 0; }`,
    `@property ${nm(fn, k, 'p')} { syntax: '<percentage>'; inherits: false; initial-value: 0%; }`])).filter((x, i, a) => a.indexOf(x) === i).join('\n');
  const inDecls = (fn, chs) => chs.map((c, k) => (c ? `${nm(fn, k, 'n')}: var(--gamut-${fn}-${c}, 0); ${nm(fn, k, 'p')}: var(--gamut-${fn}-${c}, 0%);` : '')).join(' ');
  const input = (fn, chs) => `color(from color-mix(in xyz-d65, color(xyz-d65 ${chs.map((c, k) => (c ? `var(${nm(fn, k, 'n')})` : 0)).join(' ')}), color(xyz-d65 ${chs.map((c, k) => (c ? `calc(var(${nm(fn, k, 'p')}) * ${SCALE[fn][k]})` : 0)).join(' ')})) xyz-d65 calc(2 * x) calc(2 * y) calc(2 * z) / var(--gamut-${fn}-alpha, 1))`;
  return `/* CSS Color HDR's jzazbz(), jzczhz() and ictcp(). .jzazbz: In: --gamut-jzazbz-jz, -az, -bz,
   -alpha. .jzczhz: --gamut-jzczhz-jz, -cz, -hz (degrees or an angle, as oklch()'s; none 0), -alpha. .ictcp:
   --gamut-ictcp-i, -ct, -cp, -alpha. A channel none is 0 (CSS Color 4 §4.4); a percentage takes CSS Color HDR's
   reference range (100%: Jz and I 1, az and bz 0.21, Cz 0.26, Ct and Cp 0.5); any other input reads as 0.
   Out: --gamut-out, color(xyz-d65 …) with media white (203 cd/m²) at Y 1; brighter colors keep Y above 1. */
${['jz-in', 'jz-pq', 'jz-lms', 'ic-x', 'ic-lms'].map(reg).join('\n')}
${inRegs}
.jzazbz { ${inDecls('jzazbz', ['jz', 'az', 'bz'])} --gamut--jz-in: ${input('jzazbz', ['jz', 'az', 'bz'])}; }
${H.props}
.jzczhz { ${H.decls} ${inDecls('jzczhz', ['jz', 'cz', 0])} --gamut--jz-in: color(from ${input('jzczhz', ['jz', 'cz', 0])} xyz-d65 x calc(y * cos(${H.angle})) calc(y * sin(${H.angle})) / alpha); }
.jzazbz, .jzczhz {
  --gamut--jz-pq: color(from var(--gamut--jz-in) xyz-d65 ${JZ_PQ.map((r) => pqX(r.map((m, i) => `${m} * ${[Iz, 'y', 'z'][i]}`).join(' + ').replace(/\+ -/g, '- '), 0.007460772656268214)).join(' ')} / alpha);
  --gamut--jz-lms: color(from var(--gamut--jz-pq) xyz-d65 ${pqInv('x', true)} ${pqInv('y', true)} ${pqInv('z', true)} / alpha);
  --gamut-out: color(from var(--gamut--jz-lms) xyz-d65 ${jzOut} / alpha);
}
.ictcp {
  ${inDecls('ictcp', ['i', 'ct', 'cp'])}
  --gamut--ic-x: color(from ${input('ictcp', ['i', 'ct', 'cp'])} xyz-d65 ${IC_PQ.map((r) => pqX(r.map((m, i) => `${m} * ${'xyz'[i]}`).join(' + ').replace(/\+ -/g, '- '), 0.012683313515655966)).join(' ')} / alpha);
  --gamut--ic-lms: color(from var(--gamut--ic-x) xyz-d65 ${pqInv('x')} ${pqInv('y')} ${pqInv('z')} / alpha);
  --gamut-out: color(from var(--gamut--ic-lms) xyz-d65 ${mat(IC_XYZ)} / alpha);
}`;
}

// CSS Color HDR §5's hdr-color(): two colors, each at an HDR headroom, and the color for a target headroom, interpolated
// in absolute XYZ (xyz-d65 times 203) as §5.1 writes it: per channel pow(c1 + eps, w1) * pow(c2 + eps, w2) - eps, eps
// 0.001, w2 = clamp(0, (H - H1) / (H2 - H1), 1), w1 = 1 - w2. Each channel reads both colors' channel, gathered by none
// in one color-mix(); the alpha, which the draft leaves out, mixes by the same weights. Where either color's channel is
// below 0 (a color past every gamut can have one), §5.1's pow() would be NaN: eps grows by the most negative, so both
// stay above 0 and each end stays exact. Either color alone is used at every headroom. Each color is read through noneHue() (WebKit greys a
// none hue, QUIRKS.md Q3); the alpha rides as 0.5 to 1 through the last mix, since a mix to alpha 0 loses the channels
// in Chrome.
export function hdrColorPart() {
  const C = (k) => `var(--gamut-hdr-${k}, var(--gamut-hdr-${3 - k}))`, F = (k) => `var(--gamut--hd-f${k})`, w = 'var(--gamut--hw)';
  const pair = (ch, X = F) => `color-mix(in xyz-d65, color(from ${X(1)} xyz-d65 ${ch} none none / none), color(from ${X(2)} xyz-d65 none ${ch} none / none))`;
  const eps = '(0.001 + max(0, -203 * min(x, y)))';
  const chan = (ch, i) => `color(from ${pair(ch)} xyz-d65 ${[0, 1, 2].map((j) => (j === i ? `calc((pow(x * 203 + ${eps}, 1 - ${w}) * pow(y * 203 + ${eps}, ${w}) - ${eps}) / 203)` : 'none')).join(' ')} / none)`;
  const alpha = `color(from ${pair('alpha', C)} xyz-d65 none none none / calc((x * (1 - ${w}) + y * ${w}) / 2 + 0.5))`;
  const nh = [1, 2].map((k) => noneHue(C(k), `--gamut--hn${k}-`));
  return `/* CSS Color HDR's hdr-color(). .hdr-color: In: --gamut-hdr-1 and --gamut-hdr-2, two colors (either alone is used
   at every headroom); --gamut-hdr-h1 (default 0) and --gamut-hdr-h2 (default 1), their headrooms, which differ (the
   draft gives no default); --gamut-headroom, the screen's (default 0, an SDR screen: CSS reads no headroom; a value
   not a number reads as 0). Out: --gamut-out in xyz-d65, the colors interpolated in absolute XYZ as CSS Color HDR §5.1
   writes it (where a channel is below 0, its eps grows by the most negative), alpha by the same weights. */
@property --gamut--hw { syntax: '<number>'; inherits: false; initial-value: 0; }
@property --gamut--hh { syntax: '<number>'; inherits: false; initial-value: 0; }
${nh.map((h) => h.props).join('\n')}
${['f1', 'f2'].map((n) => `@property --gamut--hd-${n} { syntax: '<color>'; inherits: false; initial-value: transparent; }`).join('\n')}
.hdr-color {
  /* the screen's headroom through a registered number first, so a value not a number reads as 0 (in the weight itself
     it made the weight its initial 0, the first color, where a first headroom above the second wants the second: an
     audit, 2026-10-29) */
  --gamut--hh: var(--gamut-headroom, 0);
  --gamut--hw: clamp(0, (var(--gamut--hh) - var(--gamut-hdr-h1, 0)) / (var(--gamut-hdr-h2, 1) - var(--gamut-hdr-h1, 0)), 1);
${nh.map((h, i) => `  ${h.decls.join('\n  ')}\n  --gamut--hd-f${i + 1}: ${h.pick('xyz-d65', 'x y z')};`).join('\n')}
  --gamut-out: color(from color-mix(in xyz-d65, color-mix(in xyz-d65, ${chan('x', 0)}, ${chan('y', 1)}),
    color-mix(in xyz-d65, ${chan('z', 2)}, ${alpha})) xyz-d65 x y z / calc(alpha * 2 - 1));
}`;
}

// a channel as a float's parts, each a whole number under 4096 (extractPart() below):
// e its power of two (log() can land a step either side: the mantissa corrects it), E = e + 64 from 1 to 127 (0 for a
// channel under 2^-63) and q the mantissa's 23 bits: qh its top 12, ql its low 11, se E plus 128 for a negative channel
const e0 = (kw) => `round(down, log(max(abs(${kw}), 1e-30), 2))`, m0 = (kw) => `(abs(${kw}) / pow(2, ${e0(kw)}))`;
const ex = (kw) => `clamp(-63, ${e0(kw)} + clamp(0, sign(${m0(kw)} - 2) + 1, 1) - clamp(0, sign(1 - ${m0(kw)}), 1), 63)`;
const q = (kw) => `clamp(0, round(down, (abs(${kw}) / pow(2, ${ex(kw)}) - 1) * 8388608, 1), 8388607)`;
export const FLOAT = { qh: (kw) => `calc(round(down, ${q(kw)} / 2048, 1))`, ql: (kw) => `calc(mod(${q(kw)}, 2048))`,
  se: (kw) => `calc(clamp(0, sign(-1 * ${kw}), 1) * 128 + (${ex(kw)} + 64) * clamp(0, sign(abs(${kw}) - ${2 ** -63}) + 1, 1))` };
// a channel back from its parts (E, sign, qh, ql), as text that adds up whole numbers: the 32-bit float, exactly
export const unfloat = ({ E, sg, qh, ql }) => `(sign(${E}) * (1 - 2 * ${sg}) * (1 + (${qh} * 2048 + ${ql}) / 8388608) * pow(2, ${E} - 64))`;

// color-extract() (#6937, resolved for CSS Color, not yet in a draft; #5782's getters): a color's channels as numbers. No number leaves a color, but
// a style() query can test one: on the element, each bit of x, y, z (xyz-d65) and alpha is a flag color exactly
// color(xyz-d65 1 0 0) or color(xyz-d65 0 0 0), worked out in calc() from the channel (mod(round(down, N / 2^i, 1), 2));
// ONE child reads the flags with one style() rule each (an element can't query itself) and adds the bits up. x, y and z
// are read as the 32-bit floats engines hold them in: a sign, a power of two from 2^-63 to 2^63 and 23 bits of mantissa,
// so any color, HDR ones too, comes out bit for bit; alpha as 24 bits from 0 to 2. Every other space is worked out from
// x, y, z in calc() as CSS Color 4's sample code converts (its matrices; sign-kept cube roots; hue by atan2).
export function extractPart() {
  const reg = (n, s, inh, init) => `@property ${n} { syntax: '${s}'; inherits: ${inh}; initial-value: ${init}; }`;
  // a channel's parts (FLOAT, above), kept in three colors of whole numbers under 4096, since a registered color reaches
  // var() at 6 significant digits
  // alpha: 24 bits from 0 to 2, two 12-bit halves
  const P = 2 ** 24, H = 2 ** 12, NA = `clamp(0, round(down, alpha / 2 * ${P}, 1), ${P - 1})`;
  const lines = [], flags = [], rules = [], read = [];
  // a digit of B bits a flag: the flag color carries the digit's value d in one channel, and one style() rule a value sets
  // the digit's integer to d; a part is the sum of its digits times their powers of two. 2 bits is the fastest in all three
  // (x y z alpha: Chrome 1,141 -> 1,028 µs, WebKit 1,097 -> 813, Firefox 159 -> 128;
  // 3 bits is faster in WebKit, slower in Chrome); EXTRACT_BITS builds another width
  const B = +(process.env.EXTRACT_BITS ?? 2);
  const digit = (name, src, kw, j, w, space) => {
    lines.push(reg(`--gamut--cx-${name}`, '<color>', false, 'transparent'), reg(`--gamut--cx-b${name}`, '<integer>', false, 0));
    flags.push(`--gamut--cx-${name}: color(from var(${src}) ${space} calc(mod(round(down, ${kw} / ${2 ** j}, 1), ${2 ** w})) 0 0 / 1);`);
    for (let d = 1; d < 2 ** w; d++) rules.push(`@container style(--gamut--cx-${name}: color(${space} ${d} 0 0)) { .color-extract-read { --gamut--cx-b${name}: ${d}; } }`);
    return `var(--gamut--cx-b${name}) * ${2 ** j}`;
  };
  const digits = (prefix, src, kw, bits, space = 'xyz-d65') => { const t = []; for (let j = 0; j < bits; j += B) t.push(digit(`${prefix}${j}`, src, kw, j, Math.min(B, bits - j), space)); return t.join(' + '); };
  for (const c of ['x', 'y', 'z']) {
    // the mantissa's low 11 bits, its high 12, and 8 for the sign (128) and E
    lines.push(...['ql', 'qh', 'S', 'E', 'sg'].map((p) => reg(`--gamut--cx-${p}${c}`, '<integer>', false, 0)));
    read.push(`--gamut--cx-ql${c}: calc(${digits(`${c}l`, '--gamut--cx-ql', c, 11)});`, `--gamut--cx-qh${c}: calc(${digits(`${c}h`, '--gamut--cx-qh', c, 12)});`,
      `--gamut--cx-S${c}: calc(${digits(`${c}s`, '--gamut--cx-se', c, 8)});`, `--gamut--cx-E${c}: calc(mod(var(--gamut--cx-S${c}), 128));`, `--gamut--cx-sg${c}: calc(round(down, var(--gamut--cx-S${c}) / 128, 1));`);
  }
  lines.push(reg('--gamut--alpha-hi', '<integer>', true, 0), reg('--gamut--alpha-lo', '<integer>', true, 0));
  read.push(`--gamut--alpha-hi: calc(${digits('ah', '--gamut--cx-ah', 'x', 12)});`, `--gamut--alpha-lo: calc(${digits('al', '--gamut--cx-al', 'y', 12)});`,
    `--gamut-alpha: calc(2 * (var(--gamut--alpha-hi) * ${H} + var(--gamut--alpha-lo)) / ${P});`);
  // 8-bit sRGB: Chrome converts a hex, rgb() or named color to xyz-d65 up to 1.6e-4 off, but holds it in srgb exactly
  //. So each sRGB channel is also read as a whole number of 255ths, with one
  // more flag, set when the color is exactly an 8-bit sRGB color (every channel within 1e-4 of a 255th, from 0 to 1);
  // then x, y, z are that color's, by CSS Color 4's conversion
  const S8 = ['r', 'g', 'b'];
  const k8 = Object.fromEntries(S8.map((c) => [c, digits(`s${c}`, '--gamut--cx-s', c, 8, 'srgb')]));
  // the channels as whole numbers of 255ths, in one color, which the flags read without converting again
  // the input through noneHue() (WebKit greys a none hue, QUIRKS.md Q3): exactly the input elsewhere, as text (a
  // registered color reaches var() at 6 digits in WebKit); its alpha read from the input itself
  const NH = noneHue('var(--gamut-in)', '--gamut--cxn-'), IN = NH.pick;
  flags.push(`--gamut--cx-s: color(from ${IN('srgb', 'r g b')} srgb ${S8.map((c) => `clamp(0, round(${c} * 255), 255)`).join(' ')} / 1);`);
  lines.push(reg('--gamut--cx-s', '<color>', false, 'transparent'), reg('--gamut--cx-s8', '<color>', false, 'transparent'), ...S8.map((c) => reg(`--gamut--cx-k${c}`, '<integer>', false, 0)));
  flags.push(`--gamut--cx-s8: color(from ${IN('srgb', 'r g b')} srgb calc(1 - sign(max(0, max(${S8.map((c) => `abs(${c} * 255 - round(${c} * 255)), -1 * ${c}, ${c} - 1`).join(', ')}) - 0.0001))) 0 0 / 1);`);
  read.push(...S8.map((c) => `--gamut--cx-k${c}: calc(${k8[c]});`));
  // the numbers' spaces, from x, y, z (raw expressions, so each output is one calc() in doubles)
  // x, y, z: the floats from their parts, or an 8-bit sRGB color's from its 8 bits (lin_sRGB, lin_sRGB_to_XYZ)
  const xyz = [], SPACE_CLASSES = ['srgb', 'srgb-linear', 'display-p3', 'a98-rgb', 'prophoto-rgb', 'rec2020', 'xyz-d50', 'oklab', 'oklch', 'lab', 'lch', 'hsl', 'hwb'];
  const X24 = ['x', 'y', 'z'].map((c) => unfloat({ E: `var(--gamut--cx-E${c})`, sg: `var(--gamut--cx-sg${c})`, qh: `var(--gamut--cx-qh${c})`, ql: `var(--gamut--cx-ql${c})` }));
  const lin8 = (c) => `(clamp(0, sign(var(--gamut--cx-k${c}) / 255 - 0.04045), 1) * pow((var(--gamut--cx-k${c}) / 255 + 0.055) / 1.055, 2.4) + (1 - clamp(0, sign(var(--gamut--cx-k${c}) / 255 - 0.04045), 1)) * var(--gamut--cx-k${c}) / 255 / 12.92)`;
  // a matrix's zero terms left out and its ones written as the value alone
  const mul = (M, v) => M.map((r) => `(${r.flatMap((m, i) => (m === 0 ? [] : [m === 1 ? v[i] : `${m} * ${v[i]}`])).join(' + ').replace(/\+ -/g, '- ')})`);
  const cbrt = (v) => `(sign(${v}) * pow(abs(${v}), 1 / 3))`;
  const gam = (v) => `(sign(${v}) * (clamp(0, sign(abs(${v}) - 0.0031308), 1) * (1.055 * pow(abs(${v}), 1 / 2.4) - 0.055) + (1 - clamp(0, sign(abs(${v}) - 0.0031308), 1)) * 12.92 * abs(${v})))`;
  const hue = (b, a) => `mod(atan2(${b}, ${a}) / 1deg + 360, 360)`;
  const LIN_SRGB = [[12831 / 3959, -329 / 214, -1974 / 3959], [-851781 / 878810, 1648619 / 878810, 36519 / 878810], [705 / 12673, -2585 / 12673, 705 / 667]];
  const LIN_P3 = [[446124 / 178915, -333277 / 357830, -72051 / 178915], [-14852 / 17905, 63121 / 35810, 423 / 17905], [11844 / 330415, -50337 / 660830, 316169 / 330415]];
  const TO_LMS = [[0.8190224379967030, 0.3619062600528904, -0.1288737815209879], [0.0329836539323885, 0.9292868615863434, 0.0361446663506424], [0.0481771893596242, 0.2642395317527308, 0.6335478284694309]];
  const TO_OKLAB = [[0.2104542683093140, 0.7936177747023054, -0.0040720430116193], [1.9779985324311684, -2.4285922420485799, 0.4505937096174110], [0.0259040424655478, 0.7827717124575296, -0.8086757549230774]];
  const D65_D50 = [[1.0479297925449969, 0.022946870601609652, -0.05019226628920524], [0.02962780877005599, 0.9904344267538799, -0.017073799063418826], [-0.009243040646204504, 0.015055191490298152, 0.7518742814281371]];
  const D50 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
  const LIN_2020 = [[30757411 / 17917100, -6372589 / 17917100, -4539589 / 17917100], [-19765991 / 29648200, 47925759 / 29648200, 467509 / 29648200], [792561 / 44930125, -1921689 / 44930125, 42328811 / 44930125]];
  const LIN_A98 = [[1829569 / 896150, -506331 / 896150, -308931 / 896150], [-851781 / 878810, 1648619 / 878810, 36519 / 878810], [16779 / 1248040, -147721 / 1248040, 1266979 / 1248040]];
  const LIN_PROPHOTO = [[1.3457868816471583, -0.25557208737979464, -0.05110186497554526], [-0.5446307051249019, 1.5082477428451468, 0.02052744743642139], [0, 0, 1.2119675456389452]];
  // the spec's other transfer curves, extended past 0 by sign: rec2020 (BT.1886, 2.4), a98-rgb, prophoto-rgb (linear below 1/512)
  const pw = (v, p) => `(sign(${v}) * pow(abs(${v}), ${p}))`;
  const gamPro = (v) => `(clamp(0, sign(abs(${v}) - ${1 / 512}) + 1, 1) * ${pw(v, 1 / 1.8)} + (1 - clamp(0, sign(abs(${v}) - ${1 / 512}) + 1, 1)) * 16 * ${v})`;
  // a kept step is kept exactly: a power of two e and three whole parts under 2^19, registered
  // (each prints exactly), and the number as unregistered text that adds them up, so it reaches var() as the double
  // calc() worked out (a registered number would reach it at 6 digits). Exact for sizes from 1e-30, so a step kept and
  // the same step written where it is read give the same double: which steps are kept is the step graph's choice (below).
  const v = (n) => `var(--gamut--cx-${n})`;
  // the expression is written once, as unregistered text (v) the parts read, and so is the number scaled to 17 bits above
  // its point (m): a power of two scales exactly, so m * 524288 is the same double as the expression times 2^(36 - e).
  // Text is worked out again where read: the same doubles, each part as before
  const keep = (n, e, to = `--gamut--cx-${n}`) => { const p = `--gamut--cx-${n}-`;
    ['e', 'a', 'b', 'c'].forEach((k) => lines.push(reg(p + k, '<number>', false, 0)));
    return `${p}v: calc(${e}); ${p}e: round(down, log(max(abs(var(${p}v)), 1e-30), 2)); ${p}m: calc(var(${p}v) * pow(2, 17 - var(${p}e))); `
      + `${p}a: round(to-zero, var(${p}m)); ${p}b: round(to-zero, rem(var(${p}m), 1) * 524288); ${p}c: calc(rem(var(${p}m) * 524288, 1) * 524288); `
      + `${to}: calc((var(${p}a) + var(${p}b) / 524288 + var(${p}c) / 274877906944) * pow(2, var(${p}e) - 17));`; };
  const SRGB_XYZ = [[506752 / 1228815, 87881 / 245763, 12673 / 70218], [87098 / 409605, 175762 / 245763, 12673 / 175545], [7918 / 409605, 87881 / 737289, 1001167 / 1053270]];
  // alone, x y z are text (worked out where read); with a space, kept. Either from the float's digits, or, for an 8-bit sRGB
  // color, from its channels' linear values (kept too with a space): the query on --gamut--cx-s8 picks one, so only one is worked out
  read.push(...X24.map((e, i) => `--gamut-${'xyz'[i]}: calc(${e});`));
  const anySpace = SPACE_CLASSES.map((c) => `.color-extract-read.extract-${c}`).join(', ');
  xyz.push(`${anySpace} {\n  ${[...X24.map((e, i) => keep(`v${'xyz'[i]}`, e)), ...['x', 'y', 'z'].map((c) => `--gamut-${c}: var(--gamut--cx-v${c});`)].join('\n  ')}\n}`);
  const eight = `@container style(--gamut--cx-s8: color(srgb 1 0 0)) {\n.color-extract-read {\n  ${mul(SRGB_XYZ, S8.map(lin8)).map((e, i) => `--gamut-${'xyz'[i]}: calc(${e});`).join('\n  ')}\n}\n`
    + `${anySpace} {\n  ${[...S8.map((c) => keep(`l8${c}`, lin8(c))), ...mul(SRGB_XYZ, S8.map((c) => v(`l8${c}`))).map((e, i) => keep(`v${'xyz'[i]}`, e))].join('\n  ')}\n}\n}`;
  const X = ['vx', 'vy', 'vz'].map(v);
  // the steps from x, y, z to each space, as a graph: the step graph (lib/steps.mjs) keeps a step where its readers would
  // work it out more often than keeping it costs, writes the rest where they are read, and puts each kept step on the
  // classes whose outputs reach it
  // a kept step's weight: its text once, and 4,000 for its five declarations and four registrations as share()
  // leaves the rest (measured: 4,000 gives the smallest sheet, 212,887 bytes, against 640: 216,780; 100,000: 223,724)
  const g = stepGraph({ prefix: '--gamut--cx-', keep, sel: (c) => `.color-extract-read.extract-${c}`, weigh: (e) => e.length + 4000 });
  const S = (names, exprs) => names.map((n, i) => g.step(n, exprs[i]));
  const lin = S(['lr', 'lg', 'lb'], mul(LIN_SRGB, X)), rgb = S(['r', 'g', 'bl'], lin.map(gam));
  const lms = S(['lc', 'mc', 'sc'], mul(TO_LMS, X).map(cbrt)), ok = S(['ol', 'oa', 'ob'], mul(TO_OKLAB, lms));
  const d50 = S(['dx', 'dy', 'dz'], mul(D65_D50, X)), t = S(['tx', 'ty', 'tz'], d50.map((n, i) => (D50[i] === 1 ? `${n}` : `(${n} / ${D50[i]})`)));
  const f = S(['fx', 'fy', 'fz'], t.map((x) => `(clamp(0, sign(${x} - ${216 / 24389}), 1) * ${cbrt(x)} + (1 - clamp(0, sign(${x} - ${216 / 24389}), 1)) * (${24389 / 27} * ${x} + 16) / 116)`));
  const p3 = mul(LIN_P3, X).map(gam);
  const lab = [`(116 * ${f[1]} - 16)`, `(500 * (${f[0]} - ${f[1]}))`, `(200 * (${f[1]} - ${f[2]}))`];
  // rgbToHsl from CSS Color 4: the branch on which channel is largest as weights 0 or 1, d = 0 giving hue 0
  const [r, g8, bl] = rgb, [mx, mn] = S(['mx', 'mn'], [`max(${r}, ${g8}, ${bl})`, `min(${r}, ${g8}, ${bl})`]);
  const [d, l] = S(['hd', 'hl'], [`(${mx} - ${mn})`, `((${mx} + ${mn}) / 2)`]);
  const [sR] = S(['sR'], [`(1 - sign(${mx} - ${r}))`]), [sG] = S(['sG'], [`((1 - ${sR}) * (1 - sign(${mx} - ${g8})))`]), [sB] = S(['sB'], [`((1 - ${sR}) * (1 - ${sG}))`]), dd = `max(${d}, 1e-30)`;
  const [h6, sat] = S(['h6', 'sat'], [`(${sR} * ((${g8} - ${bl}) / ${dd} + 6 * clamp(0, sign(${bl} - ${g8}), 1)) + ${sG} * ((${bl} - ${r}) / ${dd} + 2) + ${sB} * ((${r} - ${g8}) / ${dd} + 4))`,
    // (0 where l is 0 or 1, as rgbToHsl sets it: divided by 1e-30, color(srgb 1 -1 0) gave 4.3e7%, an audit, 2026-10-28)
    `(abs(sign(min(${l}, 1 - ${l}))) * (${mx} - ${l}) / (min(${l}, 1 - ${l}) + 1e-30 * (1 - sign(abs(min(${l}, 1 - ${l}))))))`]);
  const hueOnly = `mod(60 * ${h6} * sign(${d}), 360)`, hslH = `mod(60 * ${h6} * sign(${d}) + 180 * clamp(0, sign(-1 * ${sat}), 1), 360)`; // HWB's hue is rgbToHue: no turn
  // an output is text where it is read (every digit, one evaluation)
  const out = (cls, ch, exprs) => g.out(cls, ch.map((c) => `--gamut-${cls}-${c}`), exprs.map(String));
  out('srgb', ['r', 'g', 'b'], rgb);
  out('srgb-linear', ['r', 'g', 'b'], lin);
  out('display-p3', ['r', 'g', 'b'], p3);
  out('a98-rgb', ['r', 'g', 'b'], mul(LIN_A98, X).map((x) => pw(x, 256 / 563)));
  out('prophoto-rgb', ['r', 'g', 'b'], mul(LIN_PROPHOTO, d50).map(gamPro));
  out('rec2020', ['r', 'g', 'b'], mul(LIN_2020, X).map((x) => pw(x, 1 / 2.4)));
  out('xyz-d50', ['x', 'y', 'z'], d50);
  out('oklab', ['l', 'a', 'b'], ok);
  out('oklch', ['l', 'c', 'h'], [ok[0], `hypot(${ok[1]}, ${ok[2]})`, hue(ok[2], ok[1])]);
  out('lab', ['l', 'a', 'b'], lab);
  out('lch', ['l', 'c', 'h'], [lab[0], `hypot(${lab[1]}, ${lab[2]})`, hue(lab[2], lab[1])]);
  out('hsl', ['h', 's', 'l'], [hslH, `100 * abs(${sat})`, `100 * ${l}`]);
  out('hwb', ['h', 'w', 'b'], [hueOnly, `100 * ${mn}`, `100 * (1 - ${mx})`]);
  const graph = g.emit(); if (process.env.FOLD_REPORT) console.error(`extract: ${graph.report}`);
  const spaces = [...xyz, ...graph.rules,
    eight,
  ];
  return `/* color-extract() (resolved for CSS Color in #6937, not yet in a draft): a color's channels as numbers; #6937 and #5782 (the getters:
   red(), hue(), lightness() and the rest). .color-extract: In: --gamut-in. Its child .color-extract-read (one element:
   an element can't query its own style) Out, inherited by everything inside it: --gamut-x, --gamut-y, --gamut-z
   (xyz-d65, white's Y 1; read as the 32-bit float the engine holds, any size from 2^-63 to 2^63, so HDR colors too)
   and --gamut-alpha (24 bits; as whole halves, internal: alpha = 2 (hi 4096 + lo) / 2^24), as text
   that adds up whole numbers, so each reaches var() as an exact double; with a class extract-<space> also that
   space's channels, as its relative color's keywords: extract-srgb --gamut-srgb-r/-g/-b, extract-srgb-linear,
   extract-display-p3, extract-a98-rgb, extract-prophoto-rgb, extract-rec2020, extract-xyz-d50 (-x/-y/-z), extract-oklab --gamut-oklab-l/-a/-b, extract-oklch --gamut-oklch-l/-c/-h, extract-lab, extract-lch,
   extract-hsl --gamut-hsl-h/-s/-l, extract-hwb --gamut-hwb-h/-w/-b (hue 0 where it would be none), each an exact
   double too: kept exactly, a power of two and three whole parts under 2^19. */
${NH.props}
${['qh', 'ql', 'se', 'ah', 'al'].map((n) => reg(`--gamut--cx-${n}`, '<color>', false, 'transparent')).join('\n')}
${lines.join('\n')}
.color-extract {
  ${NH.decls.join('\n  ')}
${['qh', 'ql', 'se'].map((p) => `  --gamut--cx-${p}: color(from ${IN('xyz-d65', 'x y z')} xyz-d65 ${['x', 'y', 'z'].map(FLOAT[p]).join(' ')} / 1);`).join('\n')}
  --gamut--cx-ah: color(from var(--gamut-in) xyz-d65 calc(round(down, ${NA} / ${H}, 1)) 0 0 / 1);
  --gamut--cx-al: color(from var(--gamut-in) xyz-d65 0 calc(mod(${NA}, ${H})) 0 / 1);
  ${flags.join('\n  ')}
}
${rules.join('\n')}
.color-extract-read {
  ${read.join('\n  ')}
}
${spaces.join('\n')}`;
}

// The function's steps as a chain of functions. A function's locals substitute as text, and each search step names the
// one before it twice, so as locals the text doubled every halving (8 halvings: 763 KB of CSS and 26 ms a call in Chrome
// 155, 14 of them parsing). A typed argument arrives as a computed value, so a step that is its own function, called with
// the step before as an argument, is computed once, as the class's registered properties are (20 steps deep: 0.1 ms).
// Each step is its own function: Chrome 155 gives the invalid color for a function nested in a call to itself.
function chained(mf, text = [], out = '--gamut--step-out', pre = '--gamut--step-') {
  const names = ['--gamut-in', '--gamut--src', '--gamut--lin', ...text, ...mf.decls.map((d) => d.split(':')[0])];
  const uses = (t) => names.filter((n) => new RegExp(`var\\(${n}[,)]`).test(t));
  // the input stays text, as the class reads it: a typed <color> holds a legacy rgb() in bytes; so do
  // constants written as text (`text`)
  const param = (n) => (['--gamut--lin', '--gamut-in', ...text].includes(n) ? n : `${n} <color>`);
  const call = (fn, t) => `${fn}(${uses(t).map((n) => `var(${n})`).join(', ')})`;
  const fns = [], decls = [];
  const step = (fn, e) => fns.push(`@function ${fn}(${uses(e).map(param).join(', ')}) returns <color> { result: ${e}; }`);
  for (const d of mf.decls) {
    const [, n, e] = d.match(/^(--[\w-]+):\s*([\s\S]*);$/), fn = n.replace('--gamut--', pre);
    step(fn, e); decls.push(`${n}: ${call(fn, e)};`);
  }
  step(out, mf.out);
  return { fns, decls, out: call(out, mf.out) };
}

// The parts a function fits, each read from its class's own rules as the sheet ships them (asFunction() below). An
// argument names the input it sets, in order, and any may be left off from the end. Each is untyped, read as text as
// the class reads its input (a typed <color> holds a legacy rgb() in whole bytes: rgb(207.4 0 0) arrives as 207).
// ` none` makes `none` leave the input unset, so the class's own default applies (an argument can't be skipped:
// Chrome 155 gives the invalid value for an empty one or `initial`). `container` reads a style query on an ancestor's property from an
// argument instead; `locals` are inputs the arguments give another way.
export const FUNCTIONS = [
  { cls: 'screen-edge', args: ['--gamut-in', '--gamut-rel', '--gamut: var(--gamut-target, screen)'], container: { '--gamut-target': '--gamut' } },
  { cls: 'palette-step', args: ['--gamut-in', '--gamut-chroma-scale', '--gamut-step none', '--gamut-tone none'], drop: ['--gamut--mt-yf'], local: () => materialPart().fn },
  { cls: 'readable-text', out: '--gamut-text', args: ['--gamut-bg', '--gamut-ratio', '--gamut-readable-from none', '--gamut-readable-to none'] },
  { cls: 'contrast-color', out: '--gamut-text', args: ['--gamut-bg', '--gamut-contrast-ratio none', ...Array.from({ length: 6 }, (_, i) => `--gamut-try-${i + 1}`)] },
  { cls: 'color-mix', args: ['--gamut-mix-space', ...Array.from({ length: 6 }, (_, i) => [`--gamut-mix-${i + 1}`, `--gamut-mix-pct-${i + 1} none`]).flat()],
    locals: [`--gamut-mix-count: calc(${Array.from({ length: 6 }, (_, i) => `if(style(--gamut-mix-${i + 1}): 1; else: 0)`).join(' + ')});`], container: { '--gamut-mix-space': '--gamut-mix-space' }, hoist: true },
  { cls: 'okhsl', args: ['--gamut-okhsl-h', '--gamut-okhsl-s', '--gamut-okhsl-l'] },
  { cls: 'okhsl-from', args: ['--gamut-in', '--gamut-okhsl-s none', '--gamut-okhsl-l none'] },
  { cls: 'okhsv', args: ['--gamut-okhsv-h', '--gamut-okhsv-s', '--gamut-okhsv-v'] },
  { cls: 'device-cmyk', args: ['c', 'm', 'y', 'k', 'alpha'].map((c) => `--gamut-cmyk-${c}`) },
  ...['pq', 'hlg', 'linear'].map((s) => ({ cls: `rec2100-${s}`, args: ['r', 'g', 'b', 'alpha'].map((c) => `--gamut-rec2100-${c}`) })),
  ...[['jzazbz', 'jz az bz'], ['jzczhz', 'jz cz hz'], ['ictcp', 'i ct cp']].map(([s, c]) => ({ cls: s, args: [...c.split(' '), 'alpha'].map((x) => `--gamut-${s}-${x}`) })),
  { cls: 'color-equal', out: '--gamut-equal', args: ['--gamut-equal-a', '--gamut-equal-b'], number: true },
  { cls: 'hdr-color', args: ['--gamut-hdr-1', '--gamut-hdr-h1', '--gamut-hdr-2', '--gamut-hdr-h2', '--gamut-headroom'] },   // the draft's pairs, then the screen's headroom
];

// A class as a CSS function (css-mixins-1 §2), from the rules an element with only that class matches. Each registered
// property becomes a function of the registered properties its value names, typed as registered, so it is computed
// once, as the class computes it (chained() above says why); a var() of one passes its initial value where it is
// invalid, as a registered property takes it. An unregistered property set once is written into its readers, as var()
// substitutes it in the class; one set under conditions stays a local. An input no argument sets is a local `initial`,
// so the function never reads the caller's own. @supports and @media blocks stay as they are; a @container style()
// query becomes an if() of the argument `container` names.
export function asFunction(css, { cls, args, out = '--gamut-out', locals = [], container = {}, hoist = false, drop = [], pre = '' }) {
  const postcss = createRequire(import.meta.url)('postcss');
  const root = postcss.parse(css), short = `--gamut--${cls}-`;
  const reg = new Map(); // a registered property's syntax and initial value
  root.walkAtRules('property', (r) => { const d = {}; r.walkDecls((x) => { d[x.prop] = x.value; }); reg.set(r.params.trim(), { type: d.syntax.replace(/['"]/g, ''), initial: d['initial-value'] }); });
  const decls = [];
  root.walkRules((rule) => {
    if (!rule.selectors.some((s) => s.trim() === `.${cls}`)) return;
    const ctx = [], cont = [];
    for (let p = rule.parent; p.type !== 'root'; p = p.parent) {
      if (p.type !== 'atrule' || !['supports', 'media', 'container'].includes(p.name)) throw Error(`${cls}: a rule in ${p.type} ${p.name ?? ''}`);
      if (p.name === 'container') cont.unshift(p.params); else ctx.unshift(`@${p.name} ${p.params}`);
    }
    // a rule queried on a flag the function computes as a local of its own (drop)
    if (cont.some((c) => drop.some((x) => c.includes(`(${x}:`)))) return;
    rule.each((d) => { if (d.type === 'decl') decls.push({ prop: d.prop, value: d.value, ctx, cont }); });
  });
  if (!decls.some((d) => d.prop === out)) throw Error(`${cls}: no ${out}`);
  const set = new Map(); for (const d of decls) set.set(d.prop, [...(set.get(d.prop) ?? []), d]);
  // (one read with a fallback stays a local, so the fallback applies where it is invalid: .color-mix's pairs)
  const inline = new Map([...set].filter(([p, ds]) => p !== out && !reg.has(p) && ds.length === 1 && !ds[0].ctx.length && !ds[0].cont.length && !new RegExp(`var\\(${p},`).test(css)).map(([p, [d]]) => [p, d.value]));
  const refs = (t) => [...new Set([...t.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))];
  const text = (t) => t.replace(/var\((--[\w-]+)\)/g, (m, p) => (inline.has(p) ? text(inline.get(p)) : m));
  const params = args.map((a) => { const [, p, def = 'initial', none] = a.match(/^(--[\w-]+)(?:: (.+?))?( none)?$/); return { p, def, none, arg: `--gamut--arg-${p.slice(8)}` }; });
  const head = params.map((x) => (x.none ? `${x.arg}: none` : `${x.p}: ${x.def}`));
  const body = [...params.filter((x) => x.none).map((x) => `${x.p}: if(style(${x.arg}: none): initial; else: var(${x.arg}));`), ...locals];
  const given = new Set([...params.map((x) => x.p), ...locals.map((l) => l.slice(0, l.indexOf(':')))]);
  for (const p of new Set(decls.flatMap((d) => refs(d.value)))) if (!set.has(p) && !given.has(p)) body.push(`${p}: initial;`);
  const fns = [], seen = new Map();
  const call = (p, v) => {
    const deps = refs(v).filter((d) => reg.has(d) && d !== out), k = seen.get(p) ?? 0, fn = `${short}${p.replace(/^--gamut--?/, '')}${k ? `-${k}` : ''}`;
    seen.set(p, k + 1);
    fns.push(`@function ${fn}(${deps.map((d) => `${d} ${reg.get(d).type}`).join(', ')}) returns ${reg.get(p).type} { result: ${v}; }`);
    return `${fn}(${deps.map((d) => `var(${d}, ${reg.get(d).initial})`).join(', ')})`;
  };
  const wrap = (ctx, line) => ctx.reduceRight((t, c) => `${c} { ${t} }`, line);
  const query = (c) => { const m = c.match(/^style\((--[\w-]+): ([\w-]+)\)$/); if (!m || !container[m[1]]) throw Error(`${cls}: @container ${c}`); return `style(${container[m[1]]}: ${m[2]})`; };
  // the gamut constants (OK_SETS): locals as the classes set them, under the same @container queries (a function body
  // takes them, queried on the element's ancestors as the class's are: Chrome 155), the text the classes' rules hold
  const consts = [...set].filter(([p]) => /^--gamut--oc\d+$/.test(p) && !inline.has(p));
  for (const c of new Set(consts.flatMap(([, ds]) => ds.map((d) => d.cont.join(' and '))))) {
    const line = consts.flatMap(([p, ds]) => ds.filter((d) => d.cont.join(' and ') === c && !d.ctx.length).map((d) => `${p}: ${d.value};`)).join(' ');
    body.push(c ? `@container ${c} { ${line} }` : line);
  }
  for (const [p, ds] of set) {
    if (inline.has(p) || consts.some(([q]) => q === p)) continue;
    // a value written as text (the result, a local) reads a registered step with its initial value as fallback, as
    // the class reads it where the step is invalid (an input that isn't a number: --gamut-okhsv(260, 90%, 0.8))
    const held = (t) => t.replace(/var\((--[\w-]+)\)/g, (m, q) => (reg.has(q) && q !== out ? `var(${q}, ${reg.get(q).initial})` : m));
    // a property registered as '*' (no initial value) is a local, so a var() of it can fall back where it is invalid
    const step = reg.has(p) && reg.get(p).type !== '*' && p !== out, prop = p === out ? 'result' : p, value = (d) => (step ? call(p, text(d.value)) : held(text(d.value)));
    if (step && ds.every((d) => d.ctx.length || d.cont.length)) body.push(`${p}: initial;`);
    const plain = ds.filter((d) => !d.cont.length), queried = ds.filter((d) => d.cont.length);
    // hoist: the result's queried values each a function of their own and its one plain value in the else, so the
    // branch not taken is a call, not its text (Chrome 155 works through an untaken branch's text: color-mix's 19 kB
    // paint branch cost 272 µs a call against 177, as a call 185, 2026-10-27)
    const lift = hoist && p === out && queried.length && plain.length === 1 && !plain[0].ctx.length;
    const base = queried.length ? `${short}base-${p.replace(/^--gamut--?/, '')}` : prop;
    if (!lift) for (const d of plain) body.push(wrap(d.ctx, `${base}: ${value(d)};`));
    if (!queried.length) continue;
    if (new Set(queried.map((d) => d.ctx.join())).size > 1) throw Error(`${cls}: ${p} queried in more than one context`);
    const branch = (d, i) => { if (!lift) return value(d); fns.push(`@function ${short}${prop}-${i}() { result: ${value(d)}; }`); return `${short}${prop}-${i}()`; };
    // (with no plain rule, no else: no branch leaves it guaranteed-invalid, as unset in the class, and a var()'s fallback applies)
    body.push(wrap(queried[0].ctx, `${prop}: if(${[...queried].reverse().map((d, i) => `${d.cont.map(query).join(' and ')}: ${branch(d, i)}`).join('; ')}${plain.length ? `; else: ${lift ? value(plain[0]) : `var(${base})`}` : ''});`));
  }
  return `${pre ? `${pre}\n` : ''}${fns.join('\n')}\n@function --gamut-${cls}(${head.join(', ')}) returns ${reg.get(out)?.type ?? '<color>'} {\n  ${body.join('\n  ')}\n}`;
}

export function sheets({ mapping = minde } = {}) {
  const se = screenEdge(), m = mapping(), mf = chained(m);
  const k = adaptive(), KT = ['--gamut--ad-s', '--gamut--ad-h0', '--gamut--ad-g', '--gamut--ad-p'], kf = chained(k, KT, '--gamut--step-ad-out');
  const kc = Object.fromEntries(Object.keys(ADAPTIVE_TARGETS).map((g) => [g, adaptiveConstants(g, g === 'a98-rgb' ? ES_ENC[g].p : 1)]));
  const kcDecls = (g) => `--gamut--ad-s: ${kc[g].s}; --gamut--ad-h0: ${kc[g].h0}; --gamut--ad-g: ${kc[g].g}; --gamut--ad-p: ${kc[g].p};`;
  const kcLin = { 'display-p3': 'display-p3-linear', rec2020: 'rec2020', 'a98-rgb': 'a98-rgb', 'prophoto-rgb': 'prophoto-rgb' };
  // CSS Color 4's other two mappers (--gamut-method: ray-trace, edge-seeker): each a function chain of its own, and on the
  // class, .fit-screen's own registers (onto()); EdgeSeeker's cusp is adaptive()'s, its registers and knots
  const rt = rayTrace(), es = edgeSeeker();
  const mt = materialPart();
  // the matrix read and the clip (Ray Trace), the in-gamut test's space and the 75% point's grey (EdgeSeeker), passed to
  // their functions' steps as text
  const RT_TEXT = ['--gamut--sec-r', '--gamut--sec-g', '--gamut--sec-b', '--gamut--dist', '--gamut--clip', '--gamut--rk'], ES_TEXT = ['--gamut--fl', '--gamut--dist', '--gamut--es-a', '--gamut--es-p'];
  const rtf = chained(rt, RT_TEXT, '--gamut--step-ray-out'), esf = chained(es, [...KT, ...ES_TEXT], '--gamut--step-es-out', '--gamut--step-e-'); // its cusp's steps take ES_P: names of their own
  const sv = Object.fromEntries(['rec2020', 'a98-rgb', 'prophoto-rgb'].map((g) => [g, secVals(g)]));
  const reset = (names) => names.map((n) => `${n}: initial;`).join(' ');
  // EdgeSeeker's knots: adaptive's, but a98-rgb's along its edges in linear light (ES_ENC)
  const kcE = { ...kc, 'a98-rgb': adaptiveConstants('a98-rgb', ES_ENC['a98-rgb'].p) };
  const esDecls = (g) => `--gamut--ad-s: ${kcE[g].s}; --gamut--ad-h0: ${kcE[g].h0};`;
  // the knots by target as adaptive's function reads them
  const ktLine = KT.map((n) => `${n}: if(${Object.entries(kcLin).map(([g, l]) => `style(--gamut--lin: ${l}): ${kc[g][n.slice(12)]};`).join(' ')} else: ${kc.srgb[n.slice(12)]});`).join('\n  ');
  // a method's registers that aren't adaptive()'s, renamed to minde()'s in order, and the rest of those resting (initial)
  const onto = (x) => { const map = new Map();
    const ren = (t) => t.replace(/--gamut--(?:ray|es)-[\w-]+/g, (n) => map.get(n) ?? n), used = new Set(map.values());
    return { decls: x.decls.map(ren), ff: x.ff.map(ren), out: ren(x.out), off: m.regs.filter((n) => !used.has(n)).map((n) => `${n}: initial;`).join(' ') }; };
  const rto = onto(rt), eso = onto(es), OTHER = ['rec2020', 'a98-rgb', 'prophoto-rgb'];
  const fnSrc = (x) => x.src.replace('var(--gamut--in0)', SEED);
  const reg = (n) => `@property ${n} { syntax: '<color>'; inherits: false; initial-value: black; }`;
  const parts = [`/* gamutant.css: a bridge from the CSS color in the specs to the CSS color browsers ship, in CSS alone.
   Generated by build.mjs in the repository; README.md tracks each part; third-party notices in
   LICENSE-THIRD-PARTY. The contract every part keeps: it reads --gamut-in (or its own inputs) and writes --gamut-out,
   a color this file registers, with the private --gamut-- properties its parts use. Each part names its issues in w3c/csswg-drafts
   (https://github.com/w3c/csswg-drafts/issues/N), as they stood on 21 October 2026:
     .fit-screen      #9449 #10579   gamut mapping as CSS Color 4 §14.2 specifies it
     .screen-edge     #11946         relative chroma: a fraction of the gamut's edge at the color's own L and h
     --gamut-target   #10038         the gamut to map to, for a subtree
     --gamut-method   #9449 #10579   .fit-screen's method, for a subtree: css (CSS Color 4's binary search with local
                                     MINDE), ray-trace or edge-seeker (CSS Color 4's other two), or adaptive (Ottosson's
                                     adaptive L0, lightness given up for chroma)
     .palette-step    -              Material 3's tonal palette of one color, by HCT tone, in sRGB (#11533 has tints
                                     as one example of color math over more than one color)
     .alpha           #13994 #13992  CSS Color 5's alpha(): a color with a new alpha
     .light-dark      #13836         a token's two colors, picked in the color-scheme where it is used
     .color-equal     #13157         whether two colors are the same color (CSS Color 4 §12), as 1 or 0
   Then, in this order: contrast (.readable-text, .contrast-color); mix (.color-mix, .color-interpolate, .color-layers, .fit-gradient);
   spaces (.okhsl, .okhsl-from, .okhsv, .device-cmyk); hdr (.rec2100-pq, .rec2100-hlg, .rec2100-linear, .jzazbz,
   .jzczhz, .ictcp, .hdr-color); extract (.color-extract). */
@property --gamut--p { syntax: '<color>'; inherits: false; initial-value: black; }
@property --gamut--k { syntax: '<number>'; inherits: false; initial-value: 1; }
@property --gamut--rel { syntax: '<number>'; inherits: false; initial-value: 1; }
@property --gamut--in0 { syntax: '<color>'; inherits: false; initial-value: black; }
@property --gamut--se { syntax: '<color>'; initial-value: black; inherits: false; }
@property --gamut--step-t { syntax: '<number>'; inherits: false; initial-value: 0; }
@property --gamut-out { syntax: '<color>'; inherits: true; initial-value: transparent; }
${m.regs.map(reg).join('\n')}
${k.regs.map(reg).join('\n')}
${[...rt.regs, ...es.regs.filter((n) => !k.regs.includes(n))].map(reg).join('\n')}
${mt.regs.map((n) => `@property ${n} { syntax: '<color>'; initial-value: black; inherits: false; }`).join('\n')}
${mt.nums.map((n) => `@property ${n} { syntax: '<number>'; initial-value: 0; inherits: false; }`).join('\n')}

/* #9449 (channel clipping breaks author expectations, open since 2023), #10579 (which static gamut mapping algorithm,
   open), #11946 (relative chroma, open). CSS Color 4 §14.2 allows three algorithms. #14545 asks for @supports named-feature(gamut-mapping)
   so a sheet like this one can step aside when one does.
   The mappers. In: --gamut-in (any color) or --gamut-l, --gamut-c, --gamut-h. The target is the screen's gamut;
   --gamut-target (srgb or display-p3) on an ancestor picks one. Out: --gamut-out.
   .fit-screen: CSS Color 4's gamut mapping (binary search with local MINDE): the color at its own lightness and hue,
   chroma lowered until it is a just-noticeable difference from its clip, then clipped; in gamut, unchanged.
   .screen-edge: #11946's relative chroma: the gamut's edge at the color's own lightness and hue, times --gamut-rel (a
   fraction, default 1); the color's own chroma doesn't count.
   Both keep the input's alpha. Where a browser lacks a part, --gamut-out is the input as given, which the browser
   clips as it always did.
   Traps: --gamut-target is read from an ancestor (set it on :root), never from the element itself; without it the
   target is the screen's, so a P3 laptop and an sRGB monitor get different colors (set srgb for the same bytes
   everywhere). --gamut-rel does nothing on .fit-screen. An input built from currentColor stays unresolved, so
   .fit-screen and --gamut-fit-screen() map it at use, the element's own color, in Chrome and WebKit, at 13 to 22 times
   a written color's time; its --gamut-out inherits as that expression, so a child reads it at its own color; Firefox
   and the other parts don't map it: pass the color itself there. A distinct color costs time each time it changes (test/gate-check.mjs measures it); elements that get the same input by inheritance or a class rule
   share it, but an input set in each element's own style attribute is paid again on every
   element. .fit-screen is within 2/255 of Color.js's css method, CSS Color 4's reference: where its E stays within
   0.0001 of the JND over a wide range, Color.js stops at whichever midpoint lands there first (4 in 400,000 colors,
   up to 4/255, in a JS model). */
.fit-screen, .screen-edge, .palette-step { --gamut-out: ${SEED}; }
@supports ${GUARD_MINDE} {
${m.functions ?? ''}.fit-screen {
  /* the input with a none hue as 0 (IN0, QUIRKS.md Q3), its chroma at most 4: past the most of any target (prophoto-rgb
     1.49), the answer is the same (Color.js: within 1.5/255 from 4 to 1,000), and the chain lost it past 100 (chroma
     1e6 came out grey), past 4 in Firefox (QUIRKS.md Q4) */
  --gamut--in0: ${IN0};
  --gamut--src: oklch(from var(--gamut--in0) l min(c, 4) h / none);
  --gamut--lin: srgb-linear;
  ${(m.classDecls ?? m.decls).join('\n  ')}
  --gamut-out: ${m.classOut ?? m.out};
}
${[...new Set([...mf.fns, ...kf.fns])].join('\n')}
/* --gamut-fit-screen(<color>, <gamut>, <method>): .fit-screen's same steps as one CSS function (css-mixins-1 §2), each step a
   function, for background: --gamut-fit-screen(oklch(0.7 0.3 150)). The gamut: the second argument, else --gamut-target,
   else the screen's; the method: the third (css, ray-trace, edge-seeker or adaptive), else --gamut-method, else css (edge-seeker
   to prophoto-rgb: css, as CSS Color 4 §14.2.4 leaves that destination out). Where @function doesn't parse, the rule and any declaration
   calling it are dropped: write the plain color first. test/function-check.mjs, test/adaptive-check.mjs, test/mappers-check.mjs */
@function --gamut-fit-screen(--gamut-in, --gamut: var(--gamut-target, screen), --method: var(--gamut-method, css)) returns <color> {
  --gamut--screen: srgb-linear;
  @media (color-gamut: p3) { --gamut--screen: display-p3-linear; }
  --gamut--src: oklch(from ${SEED} l min(c, 4) h / none);
  --gamut--lin: if(style(--gamut: srgb): srgb-linear; style(--gamut: display-p3): display-p3-linear; ${['rec2020', 'a98-rgb', 'prophoto-rgb'].map((g) => `style(--gamut: ${g}): ${g};`).join(' ')} else: var(--gamut--screen));
  --gamut--how: if(style(--method: adaptive): adaptive; style(--method: ray-trace): ray-trace; style(--method: edge-seeker) and (not style(--gamut--lin: prophoto-rgb)): edge-seeker; else: css);
  ${mf.decls.map((d) => d.replace(/^(--[\w-]+): (.*);$/, '$1: if(style(--gamut--how: css): $2; else: black);')).join('\n  ')}
  result: if(${[['adaptive', 'adaptive'], ['ray-trace', 'ray-trace'], ['edge-seeker', 'edge-seeker']].map(([x, f]) => `style(--gamut--how: ${x}): --gamut--fit-${f}(var(--gamut-in), var(--gamut--lin));`).join(' ')} else: ${mf.out});
}
/* the other two methods' steps, each a function of its own, as adaptive's */
@function --gamut--fit-ray-trace(--gamut-in, --gamut--clip) returns <color> {
  --gamut--lin: if(${OTHER.map((g) => `style(--gamut--clip: ${g})`).join(' or ')}: srgb-linear; else: var(--gamut--clip));
  ${['r', 'g', 'b', 'dist'].map((x) => `--gamut--${x === 'dist' ? 'dist' : `sec-${x}`}: if(${OTHER.map((g) => `style(--gamut--clip: ${g}): ${sv[g][x]};`).join(' ')} else: ${x === 'dist' ? 'min(r, g, b, 1 - max(r, g, b))' : x});`).join('\n  ')}
  --gamut--rk: if(${OTHER.map((g) => `style(--gamut--clip: ${g})`).join(' or ')}: ${RAY_FAR}; else: 2);
  ${fnSrc(rt)}
  ${rtf.decls.join('\n  ')}
  result: ${rtf.out};
}
@function --gamut--fit-edge-seeker(--gamut-in, --gamut--lin) returns <color> {
  ${fnSrc(es)}
  ${['s', 'h0'].map((x) => `--gamut--ad-${x}: if(${['display-p3', 'rec2020', 'a98-rgb'].map((g) => `style(--gamut--lin: ${kcLin[g]}): ${kcE[g][x]};`).join(' ')} else: ${kc.srgb[x]});`).join('\n  ')}
  --gamut--fl: if(style(--gamut--lin: rec2020) or style(--gamut--lin: a98-rgb): srgb-linear; else: var(--gamut--lin));
  --gamut--dist: if(${['rec2020', 'a98-rgb'].map((g) => `style(--gamut--lin: ${g}): ${sv[g].dist};`).join(' ')} else: min(r, g, b, 1 - max(r, g, b)));
  --gamut--es-a: if(${Object.entries(ES_ENC).map(([g, e]) => `style(--gamut--lin: ${g}): ${e.a};`).join(' ')} else: ${n9(A75)});
  --gamut--es-p: if(${Object.entries(ES_ENC).map(([g, e]) => `style(--gamut--lin: ${g}): ${e.p};`).join(' ')} else: 1);
  ${esf.decls.join('\n  ')}
  result: ${esf.out};
}
/* the adaptive method's steps, a function of their own: Chrome 155 computes a function's locals whether or not its
   result reads them (in one function with the css method's, that method took 0.63 ms a call, not 0.31); the css
   method's steps above are each an if() for the same reason (adaptive 0.68 ms a call without, 0.41 with; css 0.32
   with). */
@function --gamut--fit-adaptive(--gamut-in, --gamut--lin) returns <color> {
  --gamut--src: oklch(from ${SEED} l c h / none);
  ${ktLine}
  ${kf.decls.join('\n  ')}
  result: ${kf.out};
}
/* QUIRKS.md Q4 (an engine that rounds alpha through registered colors, found by -moz-orient): its own chain, the other off */
@supports (-moz-orient: inline) { .fit-screen {
  ${m.fused.map((n) => `${n}: initial;`).join(' ')}
  ${m.ff.join('\n  ')}
  --gamut-out: ${m.outFirefox};
} }
/* #9449's authors who would trade lightness for chroma (comments 132, 133, 216, 217): --gamut-method: adaptive on an
   ancestor maps with adaptive() (Ottosson's gamut_clip_adaptive_L0_L_cusp) in place of the search above, whose
   registers rest. One chain in
   every engine: it carries no number in alpha. The cusp's start knots by target follow at the end. */
@supports ${GUARD_ADAPTIVE} { @container style(--gamut-method: adaptive) { .fit-screen {
  ${m.regs.map((n) => `${n}: initial;`).join(' ')}
  /* uncapped: adaptive's L0 depends on the chroma (at 100 it is 0.01 of lightness from chroma 1e9's) */
  --gamut--src: oklch(from var(--gamut--in0) l c h / none);
  ${kcDecls('srgb')}
  ${k.decls.join('\n  ')}
  --gamut-out: ${k.out};
} } }
/* #10579 (which static gamut mapping algorithm, resolved 2025-08-19: CSS Color 4 lists three) and #9449: --gamut-method:
   ray-trace or edge-seeker on an ancestor maps with CSS Color 4's other two in place of the binary search, on its
   registers (rayTrace(), edgeSeeker()), to every target but EdgeSeeker to prophoto-rgb, where the css method runs (§14.2.4:
   "not, for example, ProPhoto RGB"); the targets' own settings follow the target rules at the end. Their functions'
   steps first: the class rules repeat their text, which gzip then takes as a copy (on .fit-screen's own registers the
   sheet was 470 bytes larger gzipped). */
${rtf.fns.join('\n')}
${esf.fns.filter((f) => !kf.fns.includes(f)).join('\n')}
@supports ${GUARD} and ${GUARD_ADAPTIVE} and (color: color(from red srgb-linear calc(hypot(r, g, b)) g b)) {
@container style(--gamut-method: ray-trace) { .fit-screen {
  ${rto.off}
  ${rt.src}
  ${reset(RT_TEXT)}
  ${rto.decls.join('\n  ')}
  --gamut-out: ${rto.out};
} }
@supports (-moz-orient: inline) { @container style(--gamut-method: ray-trace) { .fit-screen {
  ${rto.ff.join('\n  ')}
} } }
@container not style(--gamut-target: prophoto-rgb) { @container style(--gamut-method: edge-seeker) { .fit-screen {
  ${eso.off}
  ${es.src}
  ${esDecls('srgb')}
  ${reset(ES_TEXT)}
  ${eso.decls.join('\n  ')}
  --gamut-out: ${eso.out};
} } }
}
}
@supports ${GUARD} {
.screen-edge {
  ${se.src.join('\n  ')}
}
.screen-edge {
  --gamut--lin: srgb-linear;
  --gamut--p: ${se.p};
}
/* the edge clipped to the target last, in its own channels (an estimate can land just past it: prophoto-rgb at L 0.96
   h 95 gave blue -0.017 encoded, an audit, 2026-10-28); a point inside is itself */
.screen-edge { --gamut-out: ${se.out}; }
@supports (-moz-orient: inline) {
  .screen-edge { --gamut-out: ${se.outFirefox}; }
}
}

/* #11533 (color math over more than one color, resolved 2025-01-30 to spec it, unshipped): its tints example; #11534
   notes no lightness change alone turns blue 50 into blue 950. Palette steps: Material 3's tonal palette
   (materialPart()), the children of an element with a seed (--gamut-in, or --gamut-l/c/h), one .palette-step each and
   nothing else; step t = (sibling-index() - 1) / (sibling-count() - 1), tone 95 - 85 t, or --gamut-tone. Out:
   --gamut-out on each step, in sRGB whatever the target. Without sibling-index(), t comes from :nth-child() and
   :nth-last-child(), for palettes up to ${STEPS} steps; a step past the last of them is the lightest (t = 0). */
@supports ${GUARD_MATERIAL} {
.palette-step { --gamut--step-t: clamp(0, var(--gamut-step, calc((sibling-index() - 1) / max(1, sibling-count() - 1))), 1); }
@supports not (order: sibling-index()) {
${Array.from({ length: STEPS }, (_, k) => `.palette-step:nth-child(${k + 1}) { --gamut--i: ${k + 1}; }`).join(' ')}
${Array.from({ length: STEPS }, (_, k) => `.palette-step:nth-last-child(${k + 1}) { --gamut--m: ${k + 1}; }`).join(' ')}
.palette-step { --gamut--step-t: clamp(0, var(--gamut-step, calc((var(--gamut--i) - 1) / max(1, var(--gamut--i) + var(--gamut--m) - 2))), 1); }
}
@property --gamut--mt-yf { syntax: '<color>'; inherits: false; initial-value: black; }
@property --gamut--mt-yellow { syntax: '<number>'; inherits: false; initial-value: 0; }
:where(:has(> .palette-step)) { ${mt.parent} }
@container style(--gamut--mt-yf: color(srgb-linear 1 0 0)) { .palette-step { --gamut--mt-yellow: 1; } }
.palette-step {
  --gamut--in0: ${IN0};
  --gamut--rel: var(--gamut-chroma-scale, 1);
  ${mt.decls.join('\n  ')}
  --gamut-out: ${mt.out};
}
}
/* #10038 (a property to limit to a specific color gamut, open).
   The target gamut: the screen's, or --gamut-target on an ancestor (a style query reads the parent's value; the
   searches need the gamut's linear space by name, and CSS can't turn display-p3 into display-p3-linear). Without
   display-p3-linear it stays sRGB. */
@supports (color: color(display-p3-linear 1 0 0)) {
@media (color-gamut: p3) { .fit-screen, .screen-edge { --gamut--lin: display-p3-linear; } }
@container style(--gamut-target: srgb) { .fit-screen, .screen-edge { --gamut--lin: srgb-linear; } }
@container style(--gamut-target: display-p3) { .fit-screen, .screen-edge { --gamut--lin: display-p3-linear; } }
@media (color-gamut: p3) { @container style(--gamut-method: adaptive) or style(--gamut-method: edge-seeker) { .fit-screen { ${kcDecls('display-p3')} } } }
${['srgb', 'display-p3'].map((g) => `@container (style(--gamut-method: adaptive) or style(--gamut-method: edge-seeker)) and style(--gamut-target: ${g}) { .fit-screen { ${kcDecls(g)} } }`).join('\n')}
/* #11946 (relative chroma) to CSS Color 4's other RGB destinations (§14): .screen-edge tests and takes
   the secant in the target's linear light, read from srgb-linear by its matrix (secRows(): CSS Color 4's
   <predefined-rgb> has no linear form of these three; in their encoded channels the secant was up to 18/255 off) */
${OTHER.map((g) => `@container style(--gamut-target: ${g}) { .screen-edge { --gamut--lin: srgb-linear; --gamut--clip: ${g}; ${secRows(g)}${g === 'prophoto-rgb' ? ` --gamut--sw: 3; ${Array.from({ length: TESTS }, (_, k) => `--gamut--w${k}: ${3 * W(k)};`).join(' ')}` : ''} } }`).join('\n')}
}
/* CSS Color 4's other RGB destinations (§14) for .fit-screen: rec2020, a98-rgb and prophoto-rgb, clipped in their encoded
   channels, which clips as the linear ones would (each transfer function is monotone and keeps 0 and 1) */
${['rec2020', 'a98-rgb', 'prophoto-rgb'].map((g) => `@container style(--gamut-target: ${g}) { .fit-screen { --gamut--lin: ${g}; } }`).join('\n')}
${['rec2020', 'a98-rgb', 'prophoto-rgb'].map((g) => `@container style(--gamut-method: adaptive) and style(--gamut-target: ${g}) { .fit-screen { ${kcDecls(g)} } }`).join('\n')}
/* Ray Trace to rec2020, a98-rgb and prophoto-rgb: points in srgb-linear, the target's linear channels read by its matrix,
   the clip in the target (rayTrace()); EdgeSeeker to rec2020 and a98-rgb: in the encoded target as adaptive, its knots,
   the 75% point's grey 0.5, in gamut tested by the matrix (edgeSeeker()) */
${OTHER.map((g) => `@container style(--gamut-method: ray-trace) and style(--gamut-target: ${g}) { .fit-screen { --gamut--lin: srgb-linear; ${secRows(g)} --gamut--clip: ${g}; --gamut--rk: ${RAY_FAR}; } }`).join('\n')}
${['rec2020', 'a98-rgb'].map((g) => `@container style(--gamut-method: edge-seeker) and style(--gamut-target: ${g}) { .fit-screen { ${esDecls(g)} --gamut--fl: srgb-linear; --gamut--dist: ${sv[g].dist}; --gamut--es-a: ${ES_ENC[g].a}; --gamut--es-p: ${ES_ENC[g].p}; } }`).join('\n')}
`];
  parts.push(alphaPart(), lightDarkPart(), equalPart());
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
  const modules = {
    contrast: [head('contrast', '.readable-text and .contrast-color'), src('contrast.css'), contrastColor(), rtBg],
    mix: [head('mix', '.color-mix, .color-interpolate, .color-layers and .fit-gradient'), mixPart(), src('scale.css'), layersPart(), stopsPart(m)],
    spaces: [head('spaces', '.okhsl, .okhsl-from, .okhsv and .device-cmyk'), okhslPart(), okhslFromPart(), okhsvPart(), cmykPart()],
    hdr: [head('hdr', '.rec2100-pq, .rec2100-hlg, .rec2100-linear, .jzazbz, .jzczhz, .ictcp and .hdr-color'), rec2100Part(), hdrSpacesPart(), hdrColorPart()],
    extract: [head('extract', '.color-extract'), extractPart()],
  };
  const whole = [parts.join('\n'), ...Object.values(modules).flat()].join('\n');
  const built = { core: [fold(parts.join('\n'), 'k')], ...Object.fromEntries(Object.entries(modules).map(([k, m]) => [k, m.map((t, j) => (hand.includes(t) ? t : fold(t, `${k[0]}${j}`)))])) };
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
