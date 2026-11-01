// .okhsl, .okhsv and .okhsl-from (ok_color.h, through oklab.mjs's constants) and .device-cmyk (CSS Color 5 §6.1).
import { LAB_LMS } from '../okhsl-fit.mjs';
import { allocate } from '../lib/lanes.mjs';
import { CURRENT, IF_SUPPORTS, hueRegs, noneHue, numRegs, registered } from './common.mjs';
import { OKC, OK_AB, TOE, okCusp, okDot, okGamuts, okSafe, okSel } from './oklab.mjs';

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
    ['L', `calc((pow(clamp(0, ${n('ln')}, 1), 2) + ${TOE.k1} * clamp(0, ${n('ln')}, 1)) / (${TOE.k3} * (clamp(0, ${n('ln')}, 1) + ${TOE.k2})))`],
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

// Okhsv (#8659 names it with Okhsl) from three numbers: ok_color.h's okhsv_to_srgb as registered <number>s, on
// .okhsl's cusp (its green branch at the blue corner), out as oklab()
export function okhsvPart() {
  const n = (x) => `var(--gamut--ov-${x})`;
  const RGB = OKC.rgb, dot = okDot;
  const toeInv = (x) => `(pow(${x}, 2) + ${TOE.k1} * ${x}) / (${TOE.k3} * (${x} + ${TOE.k2}))`;
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
  const OK_LMS = LAB_LMS;
  const LMS_XYZ = [[1.2268798758459243, -0.5578149944602171, 0.2813910456659647], [-0.0405757452148008, 1.1122868032803170, -0.0717110580655164], [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816]];
  const KA = OK_AB.map((r) => r.map(Number));
  const dot = (w, v) => `(${w[0]} * ${v[0]} + ${w[1]} * ${v[1]} + ${w[2]} * ${v[2]})`.replace(/\+ -/g, '- ');
  const sel = (x) => `clamp(0, sign(${x}), 1)`, ge0 = (x) => `clamp(0, sign(${x}) + 1, 1)`;
  const safe = (d) => `(${d} + 1e-30)`; // never 0 but where it is within 1e-30 of it
  const poly = (c) => `(${c[0]} + ${c[1]} * $0 + ${c[2]} * $1 + ${c[3]} * $0 * $0 + ${c[4]} * $0 * $1)`.replace(/\+ -/g, '- ');
  const lg = (L) => `clamp(0.000001, ${L}, 0.999999)`;
  const toe = (x) => `0.5 * (${TOE.k3} * ${x} - ${TOE.k1} + sqrt(pow(${TOE.k3} * ${x} - ${TOE.k1}, 2) + ${TOE.k4} * ${x}))`;
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
  node('tgt', [['l', 0], ['s', 0]], [`($0 * $0 + ${TOE.k1} * $0) / (${TOE.k3} * ($0 + ${TOE.k2}))`, `(${or('si', '$1')}) * clamp(0, sign(min($0, 1 - $0) - 0.0001), 1)`]);
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
  const reg = (n) => (n === 'in' ? 'var(--gamut--o-fix)' : `var(--gamut--o-${n})`), KW = ['x', 'y', 'z'], nh = noneHue('var(--gamut--o-src)', '--gamut--on-');
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
  --gamut--o-li: var(--gamut-okhsl-l); --gamut--o-si: var(--gamut-okhsl-s); --gamut--o-src: var(--gamut-in, black);
  ${nh.decls.join('\n  ')}
  --gamut--o-fix: ${nh.pick('xyz-d65', 'x y z')};
  ${decls.join('\n  ')}
  --gamut-out: color(from color-mix(in xyz-d65, color(from var(--gamut--o-xyz) xyz-d65 x y z / none), color(from var(--gamut--o-src) xyz-d65 none none none / calc(alpha / 2 + 0.5))) xyz-d65 x y z / calc(alpha * 2 - 1));
}
${IF_SUPPORTS} { .okhsl-from { --gamut--o-src: if(${CURRENT('--gamut-in')}: transparent; else: var(--gamut-in, black)); } }`;
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
