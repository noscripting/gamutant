// What every part's CSS is written with: the seed color a part reads, the in-gamut test held in a color's alpha, the
// guards, a `none` hue made explicit, and a part's steps as registered numbers (registered()).
import { steps as stepGraph, REGISTERED } from '../lib/steps.mjs';
import { okLit } from './oklab.mjs';
// rec2020, a98-rgb and prophoto-rgb have no linear form CSS parses, so for them (--gamut--lin: srgb-linear) a test reads
// the target's linear channels from srgb-linear's by its matrix, set as text (mapping.mjs secRows(): --gamut--dist, the same
// distance as 0.5 - max(|R - 0.5|, |G - 0.5|, |B - 0.5|), which names each row once, and --gamut--sec-r, -g, -b, the rows,
// for the secant); unset, the text as before. Not the encoded channels: WebKit 26.4 converts to rec2020 and prophoto-rgb
// with negative channels as 0 (oklch(0.22198 0.1 92.79) to prophoto-rgb 0.096078 0.07467 0), and the next step reads the
// point back from that clipped color (relative chroma to rec2020 came out up to 16/255 off)
export const X = Object.fromEntries(['r', 'g', 'b'].map((x) => [x, `var(--gamut--sec-${x}, ${x})`]));
export const DIST = 'var(--gamut--dist, min(r, g, b, 1 - max(r, g, b)))';
export const test = (from, flag = DIST) => `color(from ${from} var(--gamut--lin) r g b / ${flag})`;
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
// 580 ms in WebKit, over the load bound its checks hold, 2 x 110 + 300 ms; this, 470 ms.)
const GREY = 'clamp(0, sign(c - 0.000001), 1)';
export const IN0 = `oklch(from color-mix(in oklab, oklab(from oklch(from ${SEED} l c h / ${GREY}) l a b / alpha), oklab(from lch(from ${SEED} l min(c, 400) h) l a b / 0.000001)) round(l, 0.000001) c h / 1)`;
// the input's alpha on a mapped color whose alpha is none: it rides as 0.5 + alpha / 2 and is unpacked after (Chrome mixes
// to alpha 0 as transparent black, dropping the color)
export const alphaLin = (x, S = 'var(--gamut--lin)') => `color(from color-mix(in ${S}, ${x}, color(from ${SEED} ${S} none none none / calc(0.5 + alpha / 2))) ${S} r g b / calc(2 * alpha - 1))`;

// The cusp of a hue (its color of most chroma) on the target's cube: on the hexagon of the cube's edges ((1, u, 0) and so
// on in linear light, position s in [0, 6)), the s whose OKLCH hue is the color's. s starts from knots by hue
// (seekStart(), seeker/start.mjs's knots: on the cyan-blue edge on a square-root scale, below the hue's peak there), then
// Newton steps, the slope from a second point at s + 0.001. The hues meet in one color-mix() (the point's as hue, the
// second's / 360 as l, the color's as 0.25 + h / 720 as c, from t, which keeps the hue from being powerless). s rides in
// a linear channel (Firefox rounds alpha through registers and color-mix(), so alpha only crosses from one space to
// another inside nested relative colors). EdgeSeeker's cusp and curve point (light 0.75 on the
// hexagon a + (1 - a) times that) are found this way.
export const n9 = (x) => +x.toPrecision(9);

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
export const noneHue = (src, prefix) => {
  const A = `oklch(from ${src} l c h / 1)`, B = `lch(from ${src} l c h)`; // (B's alpha: w() and g read it as none)
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
export const hueRegs = (prefix, input) => ({
  props: `@property ${prefix}hn { syntax: '<number>'; inherits: false; initial-value: 0; }\n@property ${prefix}ha { syntax: '<angle>'; inherits: false; initial-value: 0deg; }`,
  decls: `${prefix}hn: var(${input}, 0); ${prefix}ha: var(${input}, 0deg);`,
  angle: `(var(${prefix}hn) * 1deg + var(${prefix}ha))`,
});
// Number inputs as registered <number>s, so one that isn't a number (none, 90%, a unit) reads as its initial (0), the
// same in every step that reads it, whatever the step graph inlines
export const numRegs = (prefix, inputs) => ({
  props: inputs.map(([n]) => `@property ${prefix}${n} { syntax: '<number>'; inherits: false; initial-value: 0; }`).join('\n'),
  decls: inputs.map(([n, input, def]) => `${prefix}${n}: var(${input}, ${def});`).join(' '),
});

// a part's steps as registered <number>s and its outputs (raw, as written) on one class: the step graph (lib/steps.mjs)
// writes a step read once, and cheap enough, where it is read, one register fewer
export function registered(prefix, cls, list, outs) {
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

// The style query that tells a currentColor input apart, as written (an unregistered input matches its own spelling):
// where a part's steps would copy currentColor's unresolved text through every path (1.2 s an element in Chrome 155),
// the input is gated to transparent instead (Chrome's if(), on the element itself; a style query on the parent would
// also gate a nested part's own input, so none is used)
export const CURRENT = (p) => `style(${p}: currentcolor) or style(${p}: currentColor)`;
export const IF_SUPPORTS = '@supports (color: if(style(--a: b): red))'; // (no else: a ';' in a nested @supports's test splits it in postcss)
