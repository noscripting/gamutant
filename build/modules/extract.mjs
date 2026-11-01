// .color-extract: a color's channels in any space as numbers, CSS Color 4's conversions on registered properties.
import { steps as stepGraph } from '../lib/steps.mjs';
import { X, noneHue } from './common.mjs';

// a channel as a float's parts, each a whole number under 4096 (extractPart() below):
// e its power of two (log() can land a step either side: the mantissa corrects it), E = e + 64 from 1 to 127 (0 for a
// channel under 2^-63) and q the mantissa's 23 bits: qh its top 12, ql its low 11, se E plus 128 for a negative channel
export const e0 = (kw) => `round(down, log(max(abs(${kw}), 1e-30), 2))`, m0 = (kw) => `(abs(${kw}) / pow(2, ${e0(kw)}))`;
const ex = (kw) => `clamp(-63, ${e0(kw)} + clamp(0, sign(${m0(kw)} - 2) + 1, 1) - clamp(0, sign(1 - ${m0(kw)}), 1), 63)`;
export const q = (kw) => `clamp(0, round(down, (abs(${kw}) / pow(2, ${ex(kw)}) - 1) * 8388608, 1), 8388607)`;
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
