// ok_color.h's constants (Björn Ottosson, MIT): the Oklab matrices, each gamut's cusp fit, and the cusp search they
// feed, shared by .okhsl, .okhsv and .okhsl-from (spaces.mjs).
import { OKHSL_GAMUTS } from '../okhsl-fit.mjs';

const OK_RGB = [[4.0767416621, -3.3077115913, 0.2309699292], [-1.2684380046, 2.6097574011, -0.3413193965], [-0.0041960863, -0.7034186147, 1.7076147010]];
// The constants ok_color.h fits to sRGB (its matrix to linear sRGB, compute_max_saturation's branch lines and
// polynomials), for #8659's Display P3 and Rec. 2020 variants: the parts read them by name, as unregistered custom
// properties (substituted as text, every digit), ok_color.h's own on the classes and okhsl-fit.mjs's under
// @container style(--gamut-target: display-p3 | rec2020). get_ST_mid stays ok_color.h's for all three.
const OK_SETS = { srgb: { rgb: OK_RGB, rt: [[-1.88170328, -0.80936493], [1.81444104, -1.19445276]],
  k: [[1.19086277, 1.76576728, 0.59662641, 0.75515197, 0.56771245], [0.73956515, -0.45954404, 0.08285427, 0.12541070, 0.14503204], [1.35733652, -0.00915799, -1.15130210, -0.50559606, 0.00692167]] }, ...OKHSL_GAMUTS };
const OKN = { rgb: (i, j) => `--gamut--oc${3 * i + j}`, rt: (i, j) => `--gamut--oc${9 + 2 * i + j}`, k: (i, j) => `--gamut--oc${13 + 5 * i + j}` };
export const OKC = Object.fromEntries(Object.entries(OKN).map(([x, f]) => [x, OK_SETS.srgb[x].map((r, i) => r.map((_, j) => `var(${f(i, j)})`))]));
const okConsts = (set) => Object.entries(OKN).flatMap(([x, f]) => set[x].flatMap((r, i) => r.map((v, j) => `${f(i, j)}: ${v};`))).join(' ');
const OK_LIT = new Map(Object.entries(OKN).flatMap(([x, f]) => OK_SETS.srgb[x].flatMap((r, i) => r.map((v, j) => [`var(${f(i, j)})`, `${v}`]))));
export const okLit = (e) => e.replace(/var\(--gamut--oc\d+\)/g, (m) => OK_LIT.get(m));
const OK_CLASSES = '.okhsl, .okhsv, .okhsl-from';
export const okGamuts = () => `${OK_CLASSES} { ${okConsts(OK_SETS.srgb)} }
${Object.keys(OKHSL_GAMUTS).map((g) => `@container style(--gamut-target: ${g}) { ${OK_CLASSES} { ${okConsts(OK_SETS[g])} } }`).join('\n')}`;
export const okSel = (x) => `clamp(0, sign(${x}), 1)`; // 1 when x > 0
export const okDot = (w, x, y, z) => `${w[0]} * ${x} + ${w[1]} * ${y} + ${w[2]} * ${z}`;
export const okSafe = (d) => `(max(abs(${d}), 1e-30) * (sign(${d}) + 1 - abs(sign(${d}))))`; // never 0
// ok_color.h's find_cusp for the hue's unit vector (steps a and b), as steps of registered <number>s: Okhsl and Okhsv
// share it. Gives kl, km, ks (the hue's LMS directions), Lc and Cc (the cusp)
// ok_color.h's Lab to LMS rows (M2's inverse), the a and b columns, as compute_max_saturation() writes them (10 digits;
// okhsl-fit.mjs LAB_LMS has them to 16), and its toe: k1, k2, k3 = (1 + k1) / (1 + k2), and 4 k2 k3 (toe(), toe_inv()),
// as text, the digits the sheet writes
export const OK_AB = [['0.3963377774', '0.2158037573'], ['-0.1055613458', '-0.0638541728'], ['-0.0894841775', '-1.2914855480']];
export const TOE = { k1: '0.206', k2: '0.03', k3: '1.1708737864077670', k4: '0.1405048543689320' };
const abDot = (r, a, b) => `${r[0]} * ${a} ${r[1].startsWith('-') ? `- ${r[1].slice(1)}` : `+ ${r[1]}`} * ${b}`;
export function okCusp(n) {
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
    ['kl', abDot(OK_AB[0], n('a'), n('b'))], ['km', abDot(OK_AB[1], n('a'), n('b'))],
    ['ks', abDot(OK_AB[2], n('a'), n('b'))],
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
