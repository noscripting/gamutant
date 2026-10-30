// Okhsl as ok_color.h has it (https://bottosson.github.io/posts/colorpicker/, MIT: see LICENSE-THIRD-PARTY), ported line
// for line in doubles: the reference for .gamut-okhsl (#8659). Hue in degrees (the same hue as oklch()), s and l from 0 to 1.
// okhsvToOklab: its okhsv_to_srgb, the reference for .gamut-okhsv, on the same cusp (FORCE included). Color.js 0.7.1's Okhsv
// is ok_color.h refitted (its green k4 is -0.14503204, ok_color.h's +0.14503204), up to 1.1/255 from it.
// Each function takes a gamut last (#8659's P3 and Rec. 2020 variants): a constant set, SRGB (ok_color.h's own, the
// default) or one of OKHSL_GAMUTS (okhsl-fit.mjs), run line for line the same; or exact(space), Ottosson's model with
// the cusp's maximum saturation and the gamut's edge at L found by bisection on Color.js 0.7.1's conversions, and its
// get_ST_mid as ok_color.h has it (a smooth curve chosen under the cusp, not an approximation of a number).
import { createRequire } from 'node:module';
import { OKHSL_GAMUTS } from '../vendor/okhsl-fit.mjs';
const toeK1 = 0.206, toeK2 = 0.03, toeK3 = (1 + toeK1) / (1 + toeK2);
const toe = (x) => 0.5 * (toeK3 * x - toeK1 + Math.sqrt((toeK3 * x - toeK1) ** 2 + 4 * toeK2 * toeK3 * x));
const toeInv = (x) => (x * x + toeK1 * x) / (toeK3 * (x + toeK2));
const lms = (L, a, b) => [L + 0.3963377774 * a + 0.2158037573 * b, L - 0.1055613458 * a - 0.0638541728 * b, L - 0.0894841775 * a - 1.2914855480 * b];
const RGB = [[4.0767416621, -3.3077115913, 0.2309699292], [-1.2684380046, 2.6097574011, -0.3413193965], [-0.0041960863, -0.7034186147, 1.7076147010]];
export const SRGB = { rgb: RGB, rt: [[-1.88170328, -0.80936493], [1.81444104, -1.19445276]],
  k: [[1.19086277, 1.76576728, 0.59662641, 0.75515197, 0.56771245], [0.73956515, -0.45954404, 0.08285427, 0.12541070, 0.14503204], [1.35733652, -0.00915799, -1.15130210, -0.50559606, 0.00692167]] };
export const GAMUTS = { srgb: SRGB, ...OKHSL_GAMUTS };
const oklabToLinear = (L, a, b, G = SRGB) => { const c = lms(L, a, b).map((x) => x ** 3); return G.rgb.map((w) => w[0] * c[0] + w[1] * c[1] + w[2] * c[2]); };
// the exact model of a gamut ('srgb', 'display-p3', 'rec2020'): Color.js 0.7.1's matrices, bisection
const r2 = createRequire(import.meta.url), cjs = r2('colorjs.io'), Color = cjs.default ?? cjs;
const LIN = { srgb: 'srgb-linear', 'display-p3': 'p3-linear', rec2020: 'rec2020-linear' };
const mm = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
export const exact = (g) => ({ exact: g, rgb: mm(Color.Space.get(LIN[g]).M.fromXYZ, Color.Space.get('oklab').M.LMStoXYZ) });
const inside = (G, L, a, b, top) => oklabToLinear(L, a, b, G).every((x) => x >= 0 && (!top || x <= 1));
// the first chroma (from 0, steps of `step`, then 60 halvings) at which f turns false
const firstOut = (f, step) => { let lo = 0, hi = step; while (f(hi)) { lo = hi; hi += step; } for (let j = 0; j < 60; j++) { const m = (lo + hi) / 2; if (f(m)) lo = m; else hi = m; } return lo; };
// ok_color.h's branch as written: Rt > 1 first, then Gt > 1. FORCE ('red', 'green', 'blue') picks one instead, for the
// blue corner, where both tests are within 1e-4 of 1 (the hue's line leaves sRGB at red's zero, S 0.588, and comes back at
// pure blue, 0.693): a browser's hue lands on either side there (Chrome's for #0000ff is 0.0013° off), so the checks hold
// a case at the corner to either branch and count it apart
let FORCE = null;
export const setBranch = (b) => { FORCE = b; };
export const atCorner = (a, b, G = SRGB) => !G.exact && Math.abs(G.rt[0][0] * a + G.rt[0][1] * b - 1) < 1e-4 && Math.abs(G.rt[1][0] * a + G.rt[1][1] * b - 1) < 1e-4;
function maxSaturation(a, b, G = SRGB) {
  if (G.exact) return firstOut((S) => inside(G, 1, S * a, S * b), 0.005);
  let k, w;
  const Rt = G.rt[0][0] * a + G.rt[0][1] * b, Gt = G.rt[1][0] * a + G.rt[1][1] * b, br = FORCE ?? (Rt > 1 ? 'red' : Gt > 1 ? 'green' : 'blue');
  if (br === 'red') { k = G.k[0]; w = G.rgb[0]; }
  else if (br === 'green') { k = G.k[1]; w = G.rgb[1]; }
  else { k = G.k[2]; w = G.rgb[2]; }
  let S = k[0] + k[1] * a + k[2] * b + k[3] * a * a + k[4] * a * b;
  const kl = 0.3963377774 * a + 0.2158037573 * b, km = -0.1055613458 * a - 0.0638541728 * b, ks = -0.0894841775 * a - 1.2914855480 * b;
  const l_ = 1 + S * kl, m_ = 1 + S * km, s_ = 1 + S * ks;
  const f = w[0] * l_ ** 3 + w[1] * m_ ** 3 + w[2] * s_ ** 3;
  const f1 = w[0] * 3 * kl * l_ * l_ + w[1] * 3 * km * m_ * m_ + w[2] * 3 * ks * s_ * s_;
  const f2 = w[0] * 6 * kl * kl * l_ + w[1] * 6 * km * km * m_ + w[2] * 6 * ks * ks * s_;
  return S - f * f1 / (f1 * f1 - 0.5 * f * f2);
}
function cusp(a, b, G = SRGB) { const S = maxSaturation(a, b, G), rgb = oklabToLinear(1, S * a, S * b, G), L = Math.cbrt(1 / Math.max(...rgb)); return [L, L * S]; }
// find_gamut_intersection(a, b, L1 = L, C1 = 1, L0 = L, cusp): the chroma of the gamut's edge at L
function edgeC(a, b, L, [Lc, Cc], G = SRGB) {
  if (G.exact) return firstOut((C) => inside(G, L, C * a, C * b, true), 0.002);
  if (-(Lc - L) <= 0) return Cc * L / Lc;
  let t = Cc * (L - 1) / (Lc - 1);
  const kl = 0.3963377774 * a + 0.2158037573 * b, km = -0.1055613458 * a - 0.0638541728 * b, ks = -0.0894841775 * a - 1.2914855480 * b;
  const [l_, m_, s_] = [L + t * kl, L + t * km, L + t * ks], c = [l_ ** 3, m_ ** 3, s_ ** 3];
  const d1 = [3 * kl * l_ * l_, 3 * km * m_ * m_, 3 * ks * s_ * s_], d2 = [6 * kl * kl * l_, 6 * km * km * m_, 6 * ks * ks * s_];
  const steps = G.rgb.map((w) => { const r = w[0] * c[0] + w[1] * c[1] + w[2] * c[2] - 1, r1 = w[0] * d1[0] + w[1] * d1[1] + w[2] * d1[2], r2 = w[0] * d2[0] + w[1] * d2[1] + w[2] * d2[2];
    const u = r1 / (r1 * r1 - 0.5 * r * r2); return u >= 0 ? -r * u : Number.MAX_VALUE; });
  return t + Math.min(...steps);
}
function stMid(a, b) {
  const S = 0.11516993 + 1 / (7.44778970 + 4.15901240 * b + a * (-2.19557347 + 1.75198401 * b + a * (-2.13704948 - 10.02301043 * b + a * (-4.24894561 + 5.38770819 * b + 4.69891013 * a))));
  const T = 0.11239642 + 1 / (1.61320320 - 0.68124379 * b + a * (0.40370612 + 0.90148123 * b + a * (-0.27087943 + 0.61223990 * b + a * (0.00299215 - 0.45399568 * b - 0.14661872 * a))));
  return [S, T];
}
function cs(L, a, b, G) {
  const cu = cusp(a, b, G), Cmax = edgeC(a, b, L, cu, G), Smax = cu[1] / cu[0], Tmax = cu[1] / (1 - cu[0]);
  const k = Cmax / Math.min(L * Smax, (1 - L) * Tmax), [Sm, Tm] = stMid(a, b), Ca = L * Sm, Cb = (1 - L) * Tm;
  const Cmid = 0.9 * k * Math.sqrt(Math.sqrt(1 / (1 / Ca ** 4 + 1 / Cb ** 4)));
  const C0 = Math.sqrt(1 / (1 / (L * 0.4) ** 2 + 1 / ((1 - L) * 0.8) ** 2));
  return [C0, Cmid, Cmax];
}
// okhsl -> oklab [L, a, b]
export function okhslToOklab(hDeg, s, l, G = SRGB) {
  if (l >= 1) return [1, 0, 0];
  if (l <= 0) return [0, 0, 0];
  const a = Math.cos(hDeg * Math.PI / 180), b = Math.sin(hDeg * Math.PI / 180), L = toeInv(l);
  const [C0, Cmid, Cmax] = cs(L, a, b, G);
  let C;
  if (s < 0.8) { const t = 1.25 * s, k1 = 0.8 * C0, k2 = 1 - k1 / Cmid; C = t * k1 / (1 - k2 * t); }
  else { const t = (s - 0.8) / 0.2, k0 = Cmid, k1 = 0.2 * Cmid * Cmid * 1.25 * 1.25 / C0, k2 = 1 - k1 / (Cmax - Cmid); C = k0 + t * k1 / (1 - k2 * t); }
  return [L, C * a, C * b];
}
// oklab -> okhsl [h degrees, s, l]
export function oklabToOkhsl(L, A, B, G = SRGB) {
  const C = Math.hypot(A, B), h = ((Math.atan2(B, A) * 180 / Math.PI) % 360 + 360) % 360;
  if (C < 1e-4) return [0, 0, toe(Math.min(1, Math.max(0, L)))]; // a grey (chroma below 1e-4, the sheet's own cut, build.mjs okhslFromPart): hue 0
  if (L <= 0 || L >= 1) return [h, 0, toe(Math.min(1, Math.max(0, L)))];
  const a = A / C, b = B / C, [C0, Cmid, Cmax] = cs(L, a, b, G);
  let s;
  if (C < Cmid) { const k1 = 0.8 * C0, k2 = 1 - k1 / Cmid, t = C / (k1 + k2 * C); s = t * 0.8; }
  else { const k0 = Cmid, k1 = 0.2 * Cmid * Cmid * 1.25 * 1.25 / C0, k2 = 1 - k1 / (Cmax - Cmid), t = (C - k0) / (k1 + k2 * (C - k0)); s = 0.8 + 0.2 * t; }
  return [h, s, toe(L)];
}
// okhsv -> oklab [L, a, b] (okhsv_to_srgb up to its last step)
export function okhsvToOklab(hDeg, s, v, G = SRGB) {
  if (v <= 0) return [0, 0, 0];
  const a = Math.cos(hDeg * Math.PI / 180), b = Math.sin(hDeg * Math.PI / 180);
  const [Lc, Cc] = cusp(a, b, G), Smax = Cc / Lc, Tmax = Cc / (1 - Lc), S0 = 0.5, k = 1 - S0 / Smax;
  const Lv = 1 - s * S0 / (S0 + Tmax - Tmax * k * s), Cv = s * Tmax * S0 / (S0 + Tmax - Tmax * k * s);
  let L = v * Lv, C = v * Cv;
  const Lvt = toeInv(Lv), Cvt = Cv * Lvt / Lv, Lnew = toeInv(L);
  C = C * Lnew / L; L = Lnew;
  const scaleL = Math.cbrt(1 / Math.max(...oklabToLinear(Lvt, a * Cvt, b * Cvt, G), 0));
  return [L * scaleL, C * scaleL * a, C * scaleL * b];
}
