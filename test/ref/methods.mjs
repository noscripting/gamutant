// Which gamut mapping the sheet should run, decided in JS before any CSS. The reference is what all three CSS Color 4
// §14.2 methods aim at: constant-lightness, constant-hue chroma reduction to the gamut boundary (bisected to 1e-18 in
// JS, then clipped). Scored: CSS Color 4 §14.2.6 Ray Trace as written, the variants a CSS version of it would be (a
// fixed achromatic anchor, fewer or more iterations), the spec's binary search with local MINDE, and a plain chroma bisection run the way color registers would run it: each stage stores its test point as a
// registered oklch() color, the next stage tests it in gamut and reads it back by conversion. Rounding at each
// register: 6 significant digits (Chrome) or 6 decimals (WebKit). On the WPT canvas fixtures
// (css/css-color/canvas-{srgb,display-p3}-gamut-mapping.html: cases, mapped value, per-case tolerance) and on 20,000
// random out-of-gamut OKLCH colors a gamut, as 8-bit channel distance from the reference. No browser.
// Usage: node test/ref/methods.mjs (imported by the checks for the reference: no scoring then)
import { pathToFileURL } from 'node:url';
// The matrices: CSS Color 4 §19's sample code (sRGB and Display P3 to and from XYZ D65), ok_color.h's OKLab (XYZ to
// LMS, LMS to OKLab, and back).
const mul = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const XYZ_LMS = [[0.8190224379967030, 0.3619062600528904, -0.1288737815209879], [0.0329836539323885, 0.9292868615863434, 0.0361446663506424], [0.0481771893596242, 0.2642395317527308, 0.6335478284694309]];
const LMS_OK = [[0.2104542683093140, 0.7936177747023054, -0.0040720430116193], [1.9779985324311684, -2.4285922420485799, 0.4505937096174110], [0.0259040424655478, 0.7827717124575296, -0.8086757549230774]];
const OK_LMS = [[1, 0.3963377773761749, 0.2158037573099136], [1, -0.1055613458156586, -0.0638541728258133], [1, -0.0894841775298119, -1.2914855480194092]];
const LMS_XYZ = [[1.2268798758459243, -0.5578149944602171, 0.2813910456659647], [-0.0405757452148008, 1.1122868032803170, -0.0717110580655164], [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816]];
const spaces = {
  srgb: { toXYZ: [[0.41239079926595934, 0.357584339383878, 0.1804807884018343], [0.21263900587151027, 0.715168678767756, 0.07219231536073371], [0.01933081871559182, 0.11919477979462598, 0.9505321522496607]],
    fromXYZ: [[3.2409699419045226, -1.537383177570094, -0.4986107602930034], [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559], [0.05563007969699366, -0.20397695888897652, 1.0569715142428786]] },
  p3: { toXYZ: [[0.4865709486482162, 0.26566769316909306, 0.1982172852343625], [0.2289745640697488, 0.6917385218365064, 0.079286914093745], [0, 0.04511338185890264, 1.043944368900976]],
    fromXYZ: [[2.4934969119414254, -0.9313836179191239, -0.40271078445071684], [-0.8294889695615747, 1.7626640603183463, 0.023624685841943577], [0.03584583024378447, -0.07617238926804182, 0.9568845240076872]] },
  // CSS Color 4's other RGB destinations, linear light to XYZ D65 (Color.js 0.7.1's matrices; ProPhoto's through §19's
  // Bradford D50 to D65): their gamuts, for the edge (boundary()) of .gamut-screen-edge
  rec2020: { toXYZ: [[0.6369580483012914, 0.14461690358620832, 0.1688809751641721], [0.2627002120112671, 0.6779980715188708, 0.05930171646986196], [0, 0.028072693049087428, 1.060985057710791]] },
  a98: { toXYZ: [[0.5766690429101305, 0.1855582379065463, 0.1882286462349947], [0.29734497525053605, 0.6273635662554661, 0.07529145849399788], [0.02703136138641234, 0.07068885253582723, 0.9913375368376388]] },
  prophoto: { toXYZ: [[0.7555907422969209, 0.11271984265940509, 0.08214534209534545], [0.26832184357857186, 0.7151152566617912, 0.01656289975963686], [0.003915972762425807, -0.0129334428368418, 1.0980752208342943]] },
};
const inv3 = ([[a, b, c], [d, e, f], [g, h, i]]) => { const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C;
  return [[A, c * h - b * i, b * f - c * e], [B, a * i - c * g, c * d - a * f], [C, b * g - a * h, a * e - b * d]].map((r) => r.map((x) => x / det)); };
for (const s of Object.values(spaces)) s.fromXYZ ??= inv3(s.toXYZ);
const lch2lab = ([L, C, H]) => [L, C * Math.cos(H * Math.PI / 180), C * Math.sin(H * Math.PI / 180)];
const lab2lch = ([L, a, b]) => [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180 / Math.PI) % 360 + 360) % 360];
const toLin = (sp, lch) => mul(spaces[sp].fromXYZ, mul(LMS_XYZ, mul(OK_LMS, lch2lab(lch)).map((x) => x ** 3)));
const toLch = (sp, rgb) => lab2lch(mul(LMS_OK, mul(XYZ_LMS, mul(spaces[sp].toXYZ, rgb)).map(Math.cbrt)));
const gam = (c) => (Math.abs(c) <= 0.0031308 ? 12.92 * c : Math.sign(c) * (1.055 * Math.abs(c) ** (1 / 2.4) - 0.055));
const ungam = (c) => (Math.abs(c) <= 0.04045 ? c / 12.92 : Math.sign(c) * ((Math.abs(c) + 0.055) / 1.055) ** 2.4);
const clip01 = (x) => Math.min(1, Math.max(0, x));
const byte = (lin) => lin.map((x) => clip01(gam(x)) * 255);
const inGamut = (rgb) => rgb.every((x) => x >= 0 && x <= 1);

// Rounding at a register boundary: none, 6 significant digits (Chrome), 6 decimals (WebKit).
const rounders = { exact: (x) => x, sig6: (x) => +x.toPrecision(6), dec6: (x) => Math.round(x * 1e6) / 1e6 };

// Ray cast from start (inside the cube) through end, per §14.2.6: the exit point, or null.
function cast(start, end) {
  let tnear = -Infinity, tfar = Infinity; const dir = [];
  for (let i = 0; i < 3; i++) {
    const a = start[i], d = end[i] - a; dir[i] = d;
    if (Math.abs(d) > 1e-12) { const t1 = (0 - a) / d, t2 = (1 - a) / d; tnear = Math.max(Math.min(t1, t2), tnear); tfar = Math.min(Math.max(t1, t2), tfar); }
    else if (a < 0 || a > 1) return null;
  }
  if (tnear > tfar || tfar < 0) return null;
  if (tnear < 0) tnear = tfar;
  if (!Number.isFinite(tnear)) return null;
  return start.map((a, i) => a + dir[i] * tnear);
}

// Ray Trace, §14.2.6. Options: iterations, update (move the anchor to an in-gamut corrected point), round (register).
function rayTrace(sp, [L, C, H], { iterations = 4, update = true, round = rounders.exact } = {}) {
  if (L >= 1) return [1, 1, 1]; if (L <= 0) return [0, 0, 0];
  const R = (v) => v.map(round);
  let anchor = R(toLin(sp, [L, 0, H])), rgb = R(toLin(sp, [L, C, H]));
  if (inGamut(rgb)) return rgb;
  let last = rgb;
  for (let i = 0; i < iterations; i++) {
    if (i > 0) { const [, c] = toLch(sp, rgb); rgb = R(toLin(sp, [L, round(c), H])); }
    const x = cast(anchor, rgb);
    if (!x) { rgb = last; break; }
    if (update && i > 0 && rgb.every((v) => v > 1e-6 && v < 1 - 1e-6)) anchor = rgb;
    rgb = R(x); last = rgb;
  }
  return rgb.map(clip01);
}

// Binary search with local MINDE (deltaEOK JND 0.02), in linear light of either space.
function minde(sp, [L, C, H]) {
  if (L >= 1) return [1, 1, 1]; if (L <= 0) return [0, 0, 0];
  const dE = (a, b) => Math.hypot(...lch2lab(a).map((x, i) => x - lch2lab(b)[i]));
  const clipLin = (lin) => lin.map((x) => ungam(clip01(gam(x))));
  let cur = toLin(sp, [L, C, H]); if (inGamut(cur)) return cur;
  let clipped = clipLin(cur); if (dE(toLch(sp, clipped), [L, C, H]) < 0.02) return clipped;
  let lo = 0, hi = C, minIn = true;
  while (hi - lo > 0.0001) {
    const ch = (lo + hi) / 2; cur = toLin(sp, [L, ch, H]);
    if (minIn && inGamut(cur)) { lo = ch; continue; }
    clipped = clipLin(cur); const e = dE(toLch(sp, clipped), [L, ch, H]);
    if (e < 0.02) { if (0.02 - e < 0.0001) return clipped; minIn = false; lo = ch; } else hi = ch;
  }
  return clipLin(cur);
}

const wpt = {
  srgb: [['oklch(90% 0.35 0)', [255, 205, 220], 6], ['oklch(80% 0.35 30)', [255, 159, 142], 8], ['oklch(80% 0.35 0)', [255, 152, 186], 8],
    ['oklch(80% 0.35 300)', [202, 170, 255], 4], ['oklch(90% 0.3 240)', [185, 228, 255], 11], ['oklch(90% 0.3 0)', [255, 205, 220], 6],
    ['oklch(40% 0.35 210)', [0, 82, 94], 5], ['oklch(60% 0.35 60)', [190, 102, 0], 7], ['oklch(40% 0.35 90)', [90, 69, 0], 4],
    ['oklch(50% 0.35 210)', [0, 113, 128], 6], ['oklch(50% 0.3 60)', [149, 78, 0], 6], ['oklch(90% 0.3 300)', [228, 213, 255], 4],
    ['oklch(90% 0.2 240)', [185, 228, 255], 11]],
  p3: [['oklch(90% 0.3 240)', [191, 227, 255], 9], ['oklch(60% 0.35 60)', [185, 102, 0], 5], ['oklch(90% 0.35 30)', [255, 206, 195], 7],
    ['oklch(90% 0.35 300)', [226, 213, 255], 4], ['oklch(50% 0.35 60)', [145, 78, 0], 5], ['oklch(80% 0.35 300)', [198, 169, 255], 4],
    ['oklch(80% 0.35 30)', [255, 154, 134], 8], ['oklch(30% 0.35 210)', [0, 54, 65], 5], ['oklch(30% 0.3 90)', [58, 44, 0], 3],
    ['oklch(30% 0.35 240)', [0, 48, 87], 8], ['oklch(80% 0.35 0)', [255, 145, 184], 8], ['oklch(50% 0.35 210)', [0, 114, 135], 5],
    ['oklch(90% 0.25 60)', [255, 210, 166], 14], ['oklch(90% 0.3 60)', [255, 210, 166], 14], ['oklch(90% 0.35 270)', [209, 220, 255], 5],
    ['oklch(40% 0.35 90)', [89, 69, 0], 3]],
};
const parse = (s) => { const [l, c, h] = s.match(/[\d.]+/g).map(Number); return [l / 100, c, h]; };

// The reference: the gamut boundary at the color's own L and h, by bisection on chroma in doubles. A color within
// 2e-5 of the gamut in linear light fits, clipped (as the sheet's edge counts it: re-read pure blue is 1.2e-5 out) (at most 0.33/255 off itself, by black where the sRGB curve is
// steepest), as CSS Color 4's gamut mapping clips a color whose clipping can't be seen; bisected instead, a blue
// that re-enters the gamut, oklch(0.452 0.313 264.052), 1.2e-5 out, would drop 49/255 to its line's first exit.
function boundary(sp, [L, C, H]) {
  if (L >= 1) return [1, 1, 1]; if (L <= 0) return [0, 0, 0];
  const lin = toLin(sp, [L, C, H]);
  if (lin.every((x) => x >= -2e-5 && x <= 1 + 2e-5)) return lin.map(clip01);
  let lo = 0, hi = C; for (let i = 0; i < 60; i++) { const c = (lo + hi) / 2; if (inGamut(toLin(sp, [L, c, H]))) lo = c; else hi = c; }
  return toLin(sp, [L, lo, H]).map(clip01);
}

// #11946's relative chroma (.gamut-screen-edge): the most chroma the gamut holds at L and h ("the maximum chroma possible"),
// in doubles. edgeExits() gives every chroma where the line at L and h leaves the gamut, from a scan to top by 0.0005
// then 50 halvings past each: a line can leave the gamut and come back (pure blue's first exit is at 0.265, its edge
// 0.313; prophoto-rgb's, from about 192 to 225 degrees, leave at 0.26 and come back up to 0.99), and the sheet's
// halvings land on one of them. The last is the most, edgeMax()'s, as [L, C, h], C 0 at L >= 1 or L <= 0. A grey's hue
// is 0 (CSS Color 4 §4.4.1: a converted grey's hue is missing), but a hue written with chroma 0 (§4.4.1: manually
// specified, it acts as normal); grey is chroma 1e-4 or less, as the sheet takes it (build.mjs EDGE_SRC)
function edgeExits(sp, [L, C, h], top = 2) {
  const H = C === 0 || C > 1e-4 ? h : 0, ok = (c) => inGamut(toLin(sp, [L, c, H]));
  if (L >= 1 || L <= 0) return { L, H, exits: [0] };
  const exits = [];
  for (let c = 0.0005, was = true; c <= top + 0.0005; c += 0.0005) { const is = ok(c);
    if (was && !is) { let lo = c - 0.0005, hi = c; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; } exits.push(lo); }
    was = is; }
  return { L, H, exits: exits.length ? exits : [top] };
}
function edgeMax(sp, lch, top = 2) { const { L, H, exits } = edgeExits(sp, lch, top); return [L, exits.at(-1), H]; }

// Chroma bisection as color registers: stage k holds the test point oklch(L, lo + W_k, h), rounded as a register; the
// next stage tests it in gamut (a 0/1 flag), reads l c h back by conversion, recovers lo = c - W_k and adds W_k if the
// point was in gamut. Out: oklch(L, min(c_in, lo), h), clipped. W_0 = W0 / 2 (chroma above W0 never reached).
function bisect(sp, [L, C, H], n, round, W0 = 0.5) {
  if (L >= 1) return [1, 1, 1]; if (L <= 0) return [0, 0, 0];
  let p = [L, W0 / 2, H].map(round);
  for (let k = 0; k < n; k++) {
    const W = W0 / 2 ** (k + 1), rgb = toLin(sp, p), f = inGamut(rgb) ? 1 : 0, [l, c, h] = toLch(sp, rgb);
    const lo = c - W + f * W; p = [l, k === n - 1 ? lo : lo + W / 2, h].map(round);
  }
  return toLin(sp, [L, Math.min(C, p[1]), H]).map(clip01);
}

// CSS Color 4's rgbToHsl (better-rgbToHsl.js) and hslToRgb, rgbToHwb and hwbToRgb, in [0, 360) and 0..100
function rgbToHsl(r, g, b, turn = true) { const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min; let [hue, sat, light] = [NaN, 0, (min + max) / 2];
  if (d !== 0) { sat = light === 0 || light === 1 ? 0 : (max - light) / Math.min(light, 1 - light);
    switch (max) { case r: hue = (g - b) / d + (g < b ? 6 : 0); break; case g: hue = (b - r) / d + 2; break; case b: hue = (r - g) / d + 4; } hue *= 60; }
  if (turn && sat < 0) { hue += 180; sat = Math.abs(sat); } if (hue >= 360) hue -= 360; if (Math.abs(sat) <= 1e-5) hue = NaN; return [hue, sat * 100, light * 100]; }
function hslToRgb(h, s, l) { s /= 100; l /= 100; const f = (n) => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0), f(8), f(4)]; }
function rgbToHwb(r, g, b) { const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min; let hue = NaN;
  if (d !== 0) { switch (max) { case r: hue = (g - b) / d + (g < b ? 6 : 0); break; case g: hue = (b - r) / d + 2; break; case b: hue = (r - g) / d + 4; } hue *= 60; if (hue >= 360) hue -= 360; }
  const white = min, black = 1 - max; if (white + black >= 1 - 1e-5) hue = NaN; return [hue, white * 100, black * 100]; }
function hwbToRgb(h, w, bl) { w /= 100; bl /= 100; if (w + bl >= 1) { const g = w / (w + bl); return [g, g, g]; } return hslToRgb(h, 100, 50).map((c) => c * (1 - w - bl) + w); }
// WCAG 2's relative luminance and contrast ratio of 8-bit sRGB channels (0 to 255)
const lum8 = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio8 = (a, b) => { const [x, y] = [lum8(a), lum8(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
export { XYZ_LMS, LMS_OK, spaces, toLin, toLch, gam, ungam, clip01, inGamut, boundary, edgeMax, edgeExits, rayTrace, wpt, parse, rgbToHsl, hslToRgb, rgbToHwb, hwbToRgb, lum8, ratio8 };
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
let seed = 1; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const corpus = { srgb: [], p3: [] };
for (const sp of ['srgb', 'p3']) while (corpus[sp].length < 20000) {
  const lch = [0.02 + rnd() * 0.96, rnd() * 0.4, rnd() * 360]; if (!inGamut(toLin(sp, lch))) corpus[sp].push(lch);
}
const variants = {
  'Ray Trace, spec (4 iterations)': (sp, c) => rayTrace(sp, c),
  'Ray Trace, 3 iterations': (sp, c) => rayTrace(sp, c, { iterations: 3 }),
  'Ray Trace, spec, 6 decimals': (sp, c) => rayTrace(sp, c, { round: rounders.dec6 }),
  'Ray Trace, fixed anchor, 4 iterations': (sp, c) => rayTrace(sp, c, { update: false }),
  'Ray Trace, fixed anchor, 6 iterations': (sp, c) => rayTrace(sp, c, { update: false, iterations: 6 }),
  'Binary search, local MINDE': minde,
  'Chroma bisection, 10 stages, 6 decimals': (sp, c) => bisect(sp, c, 10, rounders.dec6),
  'Chroma bisection, 11 stages, 6 decimals': (sp, c) => bisect(sp, c, 11, rounders.dec6),
  'Chroma bisection, 12 stages, 6 decimals': (sp, c) => bisect(sp, c, 12, rounders.dec6),
  'Chroma bisection, 12 stages, 6 digits': (sp, c) => bisect(sp, c, 12, rounders.sig6),
};
for (const sp of ['srgb', 'p3']) {
  const ref = corpus[sp].map((c) => byte(boundary(sp, c)).map(Math.round));
  console.log(`\n${sp}: WPT cases passed, and 8-bit distance from the boundary over ${corpus[sp].length} random out-of-gamut colors`);
  for (const [name, f] of Object.entries(variants)) {
    const pass = wpt[sp].filter(([s, want, tol]) => byte(f(sp, parse(s))).every((v, i) => Math.abs(v - want[i]) <= tol)).length;
    let max = 0, sum = 0, over1 = 0, worst = null;
    corpus[sp].forEach((c, k) => {
      const got = byte(f(sp, c)), d = Math.max(...ref[k].map((v, i) => Math.abs(v - Math.round(got[i]))));
      sum += d; if (d > 1) over1++; if (d > max) { max = d; worst = c; }
    });
    console.log(`  ${name.padEnd(42)} WPT ${pass}/${wpt[sp].length}  max ${String(max).padStart(3)}  mean ${(sum / corpus[sp].length).toFixed(3)}  over 1: ${String(over1).padStart(5)}` +
      (worst ? `  worst oklch(${worst.map((x) => +x.toFixed(3)).join(' ')})` : ''));
  }
}
}
