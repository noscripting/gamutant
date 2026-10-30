// Björn Ottosson's gamut_clip_adaptive_L0_L_cusp (alpha 0.05) and what it calls, from bottosson.github.io/posts/
// gamutclipping, transcribed in doubles (MIT, Copyright (c) 2021 Björn Ottosson: LICENSE-THIRD-PARTY): his OkLab matrices, his polynomial cusp with one Halley step, his intersection
// with one Halley step. For test/ottosson-check.mjs, the adaptive method's source.
export const lab2lin = ([L, a, b]) => { const l_ = L + 0.3963377774 * a + 0.2158037573 * b, m_ = L - 0.1055613458 * a - 0.0638541728 * b, s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s]; };
export const lin2lab = ([r, g, b]) => { const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s]; };
function maxS(a, b) {
  let k0, k1, k2, k3, k4, wl, wm, ws;
  if (-1.88170328 * a - 0.80936493 * b > 1) { [k0, k1, k2, k3, k4, wl, wm, ws] = [1.19086277, 1.76576728, 0.59662641, 0.75515197, 0.56771245, 4.0767416621, -3.3077115913, 0.2309699292]; }
  else if (1.81444104 * a - 1.19445276 * b > 1) { [k0, k1, k2, k3, k4, wl, wm, ws] = [0.73956515, -0.45954404, 0.08285427, 0.12541070, 0.14503204, -1.2684380046, 2.6097574011, -0.3413193965]; }
  else { [k0, k1, k2, k3, k4, wl, wm, ws] = [1.35733652, -0.00915799, -1.15130210, -0.50559606, 0.00692167, -0.0041960863, -0.7034186147, 1.7076147010]; }
  let S = k0 + k1 * a + k2 * b + k3 * a * a + k4 * a * b;
  const kl = 0.3963377774 * a + 0.2158037573 * b, km = -0.1055613458 * a - 0.0638541728 * b, ks = -0.0894841775 * a - 1.2914855480 * b;
  const l_ = 1 + S * kl, m_ = 1 + S * km, s_ = 1 + S * ks, l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const ld = 3 * kl * l_ * l_, md = 3 * km * m_ * m_, sd = 3 * ks * s_ * s_, ld2 = 6 * kl * kl * l_, md2 = 6 * km * km * m_, sd2 = 6 * ks * ks * s_;
  const f = wl * l + wm * m + ws * s, f1 = wl * ld + wm * md + ws * sd, f2 = wl * ld2 + wm * md2 + ws * sd2;
  return S - (f * f1) / (f1 * f1 - 0.5 * f * f2); }
function cusp(a, b) { const S = maxS(a, b), rgb = lab2lin([1, S * a, S * b]), L = Math.cbrt(1 / Math.max(...rgb)); return [L, L * S]; }
function intersect(a, b, L1, C1, L0) {
  const [cL, cC] = cusp(a, b); let t;
  if ((L1 - L0) * cC - (cL - L0) * C1 <= 0) t = (cC * L0) / (C1 * cL + cC * (L0 - L1));
  else { t = (cC * (L0 - 1)) / (C1 * (cL - 1) + cC * (L0 - L1));
    const dL = L1 - L0, dC = C1, kl = 0.3963377774 * a + 0.2158037573 * b, km = -0.1055613458 * a - 0.0638541728 * b, ks = -0.0894841775 * a - 1.2914855480 * b;
    const ldt = dL + dC * kl, mdt = dL + dC * km, sdt = dL + dC * ks, L = L0 * (1 - t) + t * L1, C = t * C1;
    const l_ = L + C * kl, m_ = L + C * km, s_ = L + C * ks, l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
    const ld = 3 * ldt * l_ * l_, md = 3 * mdt * m_ * m_, sd = 3 * sdt * s_ * s_, ld2 = 6 * ldt * ldt * l_, md2 = 6 * mdt * mdt * m_, sd2 = 6 * sdt * sdt * s_;
    const step = (w) => { const r = w[0] * l + w[1] * m + w[2] * s - 1, r1 = w[0] * ld + w[1] * md + w[2] * sd, r2 = w[0] * ld2 + w[1] * md2 + w[2] * sd2, u = r1 / (r1 * r1 - 0.5 * r * r2); return u >= 0 ? -r * u : Infinity; };
    t += Math.min(step([4.0767416621, -3.3077115913, 0.2309699292]), step([-1.2684380046, 2.6097574011, -0.3413193965]), step([-0.0041960863, -0.7034186147, 1.7076147010])); }
  return t; }
export function ottosson(lab, alpha = 0.05) {
  const rgb = lab2lin(lab); if (rgb.every((x) => x >= 0 && x <= 1)) return rgb;
  const [L] = lab, C = Math.max(0.00001, Math.hypot(lab[1], lab[2])), a_ = lab[1] / C, b_ = lab[2] / C;
  const [cL] = cusp(a_, b_), Ld = L - cL, k = 2 * (Ld > 0 ? 1 - cL : cL), e1 = 0.5 * k + Math.abs(Ld) + (alpha * C) / k;
  const L0 = cL + 0.5 * (Math.sign(Ld) * (e1 - Math.sqrt(e1 * e1 - 2 * k * Math.abs(Ld)))), t = intersect(a_, b_, L, C, L0);
  const Lc = L0 * (1 - t) + t * L, Cc = t * C; return lab2lin([Lc, Cc * a_, Cc * b_]); }
