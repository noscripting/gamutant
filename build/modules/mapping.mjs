// The mappers (.fit-screen, --gamut-method, --gamut-target) and the gamut's edge (.screen-edge): CSS Color 4 §14's binary
// search with local MINDE (minde()), its Ray Trace and EdgeSeeker, Ottosson's adaptive L0, and the edge by chroma
// halvings (mapper()). coreParts() in core.mjs wires them to their classes, targets and methods.
import { createRequire } from 'node:module';
import { DIST, IN0, SEED, X, alphaLin, n9, test } from './common.mjs';

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
export const TESTS = 6, W = (k) => 0.5 / 2 ** (k + 1); // test k steps by W(k): 0.25, 0.125 ... 0.0078125
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
export const STEPS = 24; // palette steps the fallback numbers without sibling-index() (README.md: 24)
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
export function cusp(R, LIN, P = null) {
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
export const ES_P = 'var(--gamut--es-p, 1)';
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
