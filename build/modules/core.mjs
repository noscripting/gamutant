// The core: the sheet's head (its contract, and the issues each part answers), every registration the mappers and
// .palette-step read, and the rules that wire .fit-screen, .screen-edge and .palette-step to their targets and methods
// (coreParts()); then the small parts, .alpha (CSS Color 5's alpha()), .light-dark and .color-equal (CSS Color 4 §12).
import { GUARD, IF_SUPPORTS, IN0, SEED, n9, registered, test } from './common.mjs';
import { chained } from './functions.mjs';
import { A75, ADAPTIVE_TARGETS, ES_ENC, ES_P, GUARD_ADAPTIVE, GUARD_MATERIAL, GUARD_MINDE, RAY_FAR, STEPS, TESTS, W, adaptive, adaptiveConstants, cusp, edgeSeeker, minde, rayTrace, screenEdge, secRows, secVals } from './mapping.mjs';
import { materialPart } from './palette.mjs';

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

// The core: the sheet's head (its contract and the issues each part answers), every registration the mappers and
// .palette-step read, and the rules that wire .fit-screen, .screen-edge and .palette-step to their targets and methods;
// then .alpha, .light-dark and .color-equal. sheets() in build.mjs folds it as one chunk.
export function coreParts({ mapping = minde } = {}) {
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
@property --gamut--se-q { syntax: '<color>'; inherits: false; initial-value: black; }
@property --gamut--se-c { syntax: '<color>'; inherits: false; initial-value: black; }
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
  --gamut--se-q: ${se.q};
  --gamut--se-c: ${se.q2};
}
/* the edge clipped to the target last, in its own channels (an estimate can land just past it: prophoto-rgb at L 0.96
   h 95 gave blue -0.017 encoded, an audit, 2026-10-28); a point inside is itself */
.screen-edge { --gamut-out: ${se.out}; }
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
${IF_SUPPORTS} { .palette-step { ${mt.onStep} ${mt.fn.locals[0]} } }
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
  return { parts, m };
}
