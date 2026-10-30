// Okhsl and Okhsv for another RGB gamut (#8659): ok_color.h's per-gamut constants for display-p3 (facelessuser's, below)
// and rec2020 (this file's fit, made the way Ottosson made them for sRGB: https://bottosson.github.io/posts/colorpicker/). Per gamut: the matrix from
// Oklab's cubed LMS to the gamut's linear RGB (CSS Color 4's sample-code matrices, as a browser converts the oklab()
// the parts give); compute_max_saturation's two branch lines (each through two primaries' Oklab hues: a hue's
// saturation is cut by red between green and blue, by green between blue and red, else by blue); and its three
// polynomials k0 + k1 a + k2 b + k3 a^2 + k4 a b, each a least-squares fit to the exact maximum saturation (bisected)
// over its branch's hues, every 0.05 degrees. get_ST_mid stays ok_color.h's own, as ColorAide's Okhsl P3 keeps it:
// it is a smooth curve under the cusp, and a wider gamut's cusp lies further out.
// build.mjs reads OKHSL_GAMUTS (rounded, below); test/ref/okhsl.mjs runs them.
// Usage: node okhsl-fit.mjs   prints each gamut's constants, and the method run on ok_color.h's own sRGB matrix
// beside ok_color.h's published constants.
import { pathToFileURL } from 'node:url';

const XYZ_LMS = [[0.8190224379967030, 0.3619062600528904, -0.1288737815209879], [0.0329836539323885, 0.9292868615863434, 0.0361446663506424], [0.0481771893596242, 0.2642395317527308, 0.6335478284694309]];
const LMS_XYZ = [[1.2268798758459243, -0.5578149944602171, 0.2813910456659647], [-0.0405757452148008, 1.1122868032803170, -0.0717110580655164], [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816]];
const LMS_LAB = [[0.2104542683093140, 0.7936177747023054, -0.0040720430116193], [1.9779985324311684, -2.4285922420485799, 0.4505937096174110], [0.0259040424655478, 0.7827717124575296, -0.8086757549230774]];
const LAB_LMS = [[1, 0.3963377773761749, 0.2158037573099136], [1, -0.1055613458156586, -0.0638541728258133], [1, -0.0894841775298119, -1.2914855480194092]];
// CSS Color 4 §18's XYZ_to_lin_P3 and XYZ_to_lin_2020, and their inverses
const FROM_XYZ = {
  'display-p3': [[446124 / 178915, -333277 / 357830, -72051 / 178915], [-14852 / 17905, 63121 / 35810, 423 / 17905], [11844 / 330415, -50337 / 660830, 316169 / 330415]],
  rec2020: [[30757411 / 17917100, -6372589 / 17917100, -4539589 / 17917100], [-19765991 / 29648200, 47925759 / 29648200, 467509 / 29648200], [792561 / 44930125, -1921689 / 44930125, 42328811 / 44930125]],
};
// ok_color.h's own sRGB constants, for the method's run on them
const OK = { rgb: [[4.0767416621, -3.3077115913, 0.2309699292], [-1.2684380046, 2.6097574011, -0.3413193965], [-0.0041960863, -0.7034186147, 1.7076147010]],
  rt: [[-1.88170328, -0.80936493], [1.81444104, -1.19445276]],
  k: [[1.19086277, 1.76576728, 0.59662641, 0.75515197, 0.56771245], [0.73956515, -0.45954404, 0.08285427, 0.12541070, 0.14503204], [1.35733652, -0.00915799, -1.15130210, -0.50559606, 0.00692167]] };

const mul = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const mm = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const inv = (m) => { const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2], A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C;
  return [[A, c * h - b * i, b * f - c * e], [B, a * i - c * g, c * d - a * f], [C, b * g - a * h, a * e - b * d]].map((r) => r.map((x) => x / det)); };
function solve(A, y) { const n = y.length, M = A.map((r, i) => [...r, y[i]]);
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } }
  return M.map((r, i) => r[n] / r[i]); }
const K = (a, b) => [0, 1, 2].map((i) => LAB_LMS[i][1] * a + LAB_LMS[i][2] * b);
const channel = (W, i, S, k) => W[i][0] * (1 + S * k[0]) ** 3 + W[i][1] * (1 + S * k[1]) ** 3 + W[i][2] * (1 + S * k[2]) ** 3;
// the exact maximum saturation S = C / L at a hue: where the first channel of oklab(1, S a, S b) reaches 0
export function maxSaturation(W, a, b) {
  const k = K(a, b), ok = (S) => [0, 1, 2].every((i) => channel(W, i, S, k) >= 0);
  let lo = 0, hi = 0.005;
  while (ok(hi)) { lo = hi; hi += 0.005; }
  for (let j = 0; j < 60; j++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
  return lo;
}
const basis = (a, b) => [1, a, b, a * a, a * b];

// the constants for an LMS-to-linear-RGB matrix W (and its RGB-to-LMS inverse), unrounded
export function fitGamut(W) {
  const toLMS = inv(W), hue = (lin) => { const [, a, b] = mul(LMS_LAB, mul(toLMS, lin).map(Math.cbrt)), c = Math.hypot(a, b); return [a / c, b / c]; };
  const [R, G, B] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(hue);
  const rt = [solve([G, B], [1, 1]), solve([B, R], [1, 1])];
  const branch = (a, b) => (rt[0][0] * a + rt[0][1] * b > 1 ? 0 : rt[1][0] * a + rt[1][1] * b > 1 ? 1 : 2);
  const pts = [[], [], []];
  for (let i = 0; i < 7200; i++) { const h = i * Math.PI / 3600, a = Math.cos(h), b = Math.sin(h); pts[branch(a, b)].push([a, b, maxSaturation(W, a, b)]); }
  const k = pts.map((p) => solve([0, 1, 2, 3, 4].map((i) => [0, 1, 2, 3, 4].map((j) => p.reduce((s, [a, b]) => s + basis(a, b)[i] * basis(a, b)[j], 0))),
    [0, 1, 2, 3, 4].map((i) => p.reduce((s, [a, b, S]) => s + basis(a, b)[i] * S, 0))));
  return { rgb: W, rt, k };
}
// rounded to fewer digits than ok_color.h's 10 and 8, to keep the sheet small: the matrix to 8 decimals, the branch
// lines to 7, the polynomials to 6 (a Halley step refines them); away from blue within 0.03/255 of the numerical model
const round = ({ rgb, rt, k }) => ({ rgb: rgb.map((r) => r.map((x) => +x.toFixed(8))), rt: rt.map((r) => r.map((x) => +x.toFixed(7))), k: k.map((r) => r.map((x) => +x.toFixed(6))) });
// Display P3's branch lines and polynomials as Isaac Muse (facelessuser, ColorAide's author) published them for Okhsl P3,
// csswg-drafts #8659 (https://github.com/w3c/csswg-drafts/issues/8659#issuecomment-1500699972, the gist it links:
// okhsl_p3.py, P3L_COEFF), made by Ottosson's own procedure; its matrix is CSS Color 4's, as a browser converts (the
// gist's equals it to 8 decimals). Rec. 2020 has no published set: its constants are this file's fit, ours.
const OKHSL_P3 = { rt: [[-1.77234393, -0.82075874], [1.8031987, -1.1932814]],
  k: [[1.19413664, 1.76298424, 0.59586087, 0.75759729, 0.56816791], [2.65372708, -3.76337813, 2.01565193, 1.56037817, -2.62199151], [1.3650924, -0.01396104, -1.14523207, -0.50259958, 0.00317569]] };
export const OKHSL_GAMUTS = Object.fromEntries(Object.entries(FROM_XYZ).map(([g, M]) => { const W = mm(M, LMS_XYZ);
  return [g, g === 'display-p3' ? { rgb: round({ rgb: W, rt: [], k: [] }).rgb, ...OKHSL_P3 } : round(fitGamut(W))]; }));

// one Halley step from a set's polynomial, as compute_max_saturation takes it
export function halley({ rgb, rt, k: KS }, a, b) {
  const br = rt[0][0] * a + rt[0][1] * b > 1 ? 0 : rt[1][0] * a + rt[1][1] * b > 1 ? 1 : 2, w = rgb[br], k = K(a, b);
  const S = basis(a, b).reduce((s, x, i) => s + x * KS[br][i], 0), [l, m, s] = k.map((x) => 1 + S * x);
  const f = w[0] * l ** 3 + w[1] * m ** 3 + w[2] * s ** 3, f1 = 3 * (w[0] * k[0] * l * l + w[1] * k[1] * m * m + w[2] * k[2] * s * s);
  const f2 = 6 * (w[0] * k[0] ** 2 * l + w[1] * k[1] ** 2 * m + w[2] * k[2] ** 2 * s);
  return S - f * f1 / (f1 * f1 - 0.5 * f * f2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fmt = (r) => r.map((x) => x.toFixed(8)).join(', ');
  // the worst error in S after the Halley step, over every 0.05 degrees, away from the blue corner's 2 degrees
  const worst = (set, W) => { let e = 0, at = 0, blue = hueOf(W, [0, 0, 1]);
    for (let i = 0; i < 7200; i++) { const h = i * Math.PI / 3600; if (Math.abs(((h - blue + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) < Math.PI / 90) continue;
      const d = Math.abs(halley(set, Math.cos(h), Math.sin(h)) - maxSaturation(W, Math.cos(h), Math.sin(h))); if (d > e) { e = d; at = h * 180 / Math.PI; } }
    return `${e.toExponential(1)} at ${at.toFixed(2)} deg`; };
  function hueOf(W, lin) { const [, a, b] = mul(LMS_LAB, mul(inv(W), lin).map(Math.cbrt)); return Math.atan2(b, a); }
  const mine = fitGamut(OK.rgb);
  console.log('the method on ok_color.h\'s sRGB matrix, against its published constants:');
  console.log(`  branch lines ${mine.rt.map(fmt).join(' | ')}\n  published    ${OK.rt.map(fmt).join(' | ')}`);
  mine.k.forEach((r, i) => console.log(`  ${'RGB'[i]} polynomial ${fmt(r)}\n  published    ${fmt(OK.k[i])}`));
  console.log(`  S after the Halley step, worst off the exact: fitted ${worst(mine, OK.rgb)}, published ${worst(OK, OK.rgb)} (2 degrees round blue left out)`);
  for (const [g, set] of Object.entries(OKHSL_GAMUTS)) {
    console.log(`${g}: rgb ${set.rgb.map((r) => r.join(', ')).join(' | ')}\n  branch lines ${set.rt.map((r) => r.join(', ')).join(' | ')}`);
    set.k.forEach((r, i) => console.log(`  ${'RGB'[i]} polynomial ${r.join(', ')}`));
    console.log(`  S after the Halley step, worst off the exact: ${worst(set, set.rgb)}`);
  }
}
