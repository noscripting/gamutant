// CSS Color HDR's spaces: .rec2100-pq, .rec2100-hlg, .rec2100-linear, .jzazbz, .jzczhz, .ictcp, and .hdr-color.
import { X, hueRegs, noneHue, registered } from './common.mjs';

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
