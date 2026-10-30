// .gamut-readable-text's reference: WCAG 2 contrast on painted 8-bit sRGB colors, and the search along a range from a seed
// to an end (README, Readable text), done by halving the mix's weight, never by the closed form the sheet uses.
import { lum8 } from './methods.mjs';
export const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export const enc = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255;
const Yl = (l) => 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
export const ratioY = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
export const ratio8 = (a, b) => ratioY(lum8(a), lum8(b));

// [bytes, reached]: the text for a painted background bg, a seed s and an end e (undefined: white or black), ratio R.
// The seed when it reaches R; with no end, white or black, whichever gives the background more contrast, except when
// both reach R and the seed is lighter or darker than the background, then away from it; the end, or the seed, whichever
// contrasts more, when the end doesn't reach R; else the first mix of their linear channels that does (60 halvings),
// each channel encoded and rounded toward the end's luminance (up when the end is lighter)
export function search(bg, s, e, R) {
  const Yb = lum8(bg), Ys = lum8(s), reaches = (Y) => ratioY(Y, Yb) >= R;
  if (reaches(Ys)) return [s, true];
  if (!e) {
    const up = R * (Yb + 0.05) - 0.05 <= 1, down = (Yb + 0.05) / R - 0.05 >= 0;
    e = up && down && Ys !== Yb ? (Ys > Yb ? [255, 255, 255] : [0, 0, 0]) : (Yb < 0.179129 ? [255, 255, 255] : [0, 0, 0]);
  }
  const ls = s.map(lin), le = e.map(lin), at = (t) => ls.map((v, i) => v + t * (le[i] - v)), Ye = lum8(e);
  if (!reaches(Ye)) return [ratioY(Ye, Yb) > ratioY(Ys, Yb) ? e : s, false];
  let lo = 0, hi = 1; // the seed fails, the end reaches, and luminance moves one way along the range
  for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (reaches(Yl(at(m)))) hi = m; else lo = m; }
  if (hi === 1) return [e, true];
  const upward = Ye > Ys;
  return [at(hi).map((v) => (upward ? Math.ceil(enc(v) - 1e-9) : Math.floor(enc(v) + 1e-9))), true];
}
