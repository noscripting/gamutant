// .contrast-color: CSS Color 6's contrast-color() (.readable-text is hand-written, contrast.css).
import { W } from './mapping.mjs';

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
