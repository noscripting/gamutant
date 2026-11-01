// .palette-step: Material 3's tonal palette of one color, ported from material-color-utilities 0.4.0 (Apache-2.0).
import { readFileSync } from 'node:fs';
import { X } from './common.mjs';
import { W } from './mapping.mjs';

// Palette steps (.palette-step): Material 3's tonal palette, material-color-utilities 0.4.0's
// TonalPalette.tone(t) = Hct.from(hue, chroma, t): the sRGB color of the seed's CAM16 hue h, CIELAB L* t and CAM16 chroma
// C (times --gamut-chroma-scale), or, where sRGB can't hold C there, the most chroma sRGB holds at that hue and tone
// (hct/hct_solver.js). The viewing conditions are MCU's defaults (ViewingConditions.make()), worked out here from
// CAM16's matrix and MCU's sRGB matrix (its SCALED_DISCOUNT_FROM_LINRGB to 4e-16). In CSS: the seed's adapted
// responses (signed, so a seed past sRGB has a hue and chroma), then (u, v, h) with (u, v) = Q (cos h, sin h),
// Q = 23 p1 / (C t_inner)^(10/9), whose own terms cancel MCU's eHue; HctSolver.findResultByJ's Newton on J from its
// first guess, carried as q = (J / 100)^(1 / c z); P, the color there. P stands where it is in sRGB (MCU: 0 to 100.01
// of 100) and its Y is within 1% of the tone's. Elsewhere the answer is on sRGB's surface at the tone's Y, where MCU
// bisects the polygon's edges: here a ray from grey (Y, Y, Y) in the plane of that Y, along U cos psi + V sin psi (U, V:
// the plane's directions whose CAM16 a, b are cos psi, sin psi near grey), leaves the cube where
// 1 / max(d / (100 - Y), -d / Y) says, and psi starts at h and takes Newton steps on the hue difference, its slope a
// difference over 0.001 rad. Each step's numbers ride in srgb-linear channels of a registered color, three a color (h
// and psi in two, the third one value at a time). Steps: 3 on J and 3 on psi pass test/material-check.mjs in all three
// engines (2 on J: 930 of 983; 2 on psi: 975 of 983 in a JavaScript model, 2026-10-27); each step on psi costs Chrome
// about 120 us a step, on J 46. MCU's grey (chroma under 1e-4, tone 0 or 100) is grey.
export function materialPart() {
  // (NB 3: next to sRGB's red corner, where the hue turns fast along the G = 0 edge, three angle steps leave up to 4.2/255
  // (#fe0003 at tone 53, blue 7 for MCU's 3; 7 of 601 saturated seeds over 1/255, an audit, 2026-10-29); a
  // fourth made 601 of 601 at 18% (WebKit) to 30% (Chrome) more time a step, so the limit is written down instead)
  const NJ = 3, NB = 3;
  const M16 = [[0.401288, 0.650173, -0.051461], [-0.250268, 1.204414, 0.045854], [-0.002079, 0.048952, 0.953127]];
  const S2X = [[0.41233895, 0.35762064, 0.18051042], [0.2126, 0.7152, 0.0722], [0.01932141, 0.11916382, 0.95034478]];
  const K = S2X[1], wp = [95.047, 100, 108.883];
  const yFromL = (l) => { const f = (l + 16) / 116; return 100 * (f ** 3 > 216 / 24389 ? f ** 3 : l / (24389 / 27)); };
  const La = (200 / Math.PI) * yFromL(50) / 100, W = M16.map((r) => r[0] * wp[0] + r[1] * wp[1] + r[2] * wp[2]);
  const d = Math.min(1, Math.max(0, 1 - Math.exp((-La - 42) / 92) / 3.6)), rgbD = W.map((w) => d * (100 / w) + 1 - d);
  const k4 = (1 / (5 * La + 1)) ** 4, fl = k4 * La + 0.1 * (1 - k4) ** 2 * Math.cbrt(5 * La);
  const n = yFromL(50) / 100, cz = 0.69 * (1.48 + Math.sqrt(n)), nbb = 0.725 / n ** 0.2;
  const rgbA = W.map((w, i) => { const f = (fl * rgbD[i] * w / 100) ** 0.42; return 400 * f / (f + 27.13); });
  const AWN = (2 * rgbA[0] + rgbA[1] + 0.05 * rgbA[2]), P1K = (50000 / 13) * nbb, K73 = (1.64 - 0.29 ** n) ** 0.73;
  const mul = (A, v) => A.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  const SD = M16.map((r, i) => [0, 1, 2].map((j) => r.reduce((s, x, k) => s + x * rgbD[i] * fl / 100 * S2X[k][j], 0)));
  const [[a0, b0, c0], [d0, e0, f0], [g0, h0, i0]] = SD, A = e0 * i0 - f0 * h0, B = f0 * g0 - d0 * i0, C = d0 * h0 - e0 * g0, det = a0 * A + b0 * B + c0 * C;
  const LIN = [[A, c0 * h0 - b0 * i0, b0 * f0 - c0 * e0], [B, a0 * i0 - c0 * g0, c0 * d0 - a0 * f0], [C, b0 * g0 - a0 * h0, a0 * e0 - b0 * d0]].map((r) => r.map((x) => x / det));
  // the plane of Y: E1, E2 orthonormal and orthogonal to K; U, V the directions whose a, b (CAM16's opponent axes of
  // SD's responses, linear near grey) are (1, 0) and (0, 1)
  const nk = Math.hypot(...K), kh = K.map((x) => x / nk), unit = (v) => v.map((x) => x / Math.hypot(...v));
  const E1 = unit([1 - kh[0] * kh[0], -kh[0] * kh[1], -kh[0] * kh[2]]), E2 = [kh[1] * E1[2] - kh[2] * E1[1], kh[2] * E1[0] - kh[0] * E1[2], kh[0] * E1[1] - kh[1] * E1[0]];
  const OPP = [[1, -12 / 11, 1 / 11], [1 / 9, 1 / 9, -2 / 9]], L = OPP.map((r) => [E1, E2].map((e) => r.reduce((s, x, i) => s + x * mul(SD, e)[i], 0)));
  const dl = L[0][0] * L[1][1] - L[0][1] * L[1][0];
  // (scaled by 1/1000, so a ray's length, a register's channel, stays over 0.01 at tone 0.1: WebKit keeps 6 decimals)
  const U = [0, 1, 2].map((i) => (E1[i] * L[1][1] - E2[i] * L[1][0]) / dl / 1000), V = [0, 1, 2].map((i) => (E2[i] * L[0][0] - E1[i] * L[0][1]) / dl / 1000);
  const SG = SD.map((r) => r[0] + r[1] + r[2]), SU = mul(SD, U), SV = mul(SD, V), KL = [0, 1, 2].map((i) => K.reduce((s, k, j) => s + k * LIN[j][i], 0));
  const num = (x) => Number(x.toPrecision(7)).toString().replace(/^(-?)0\./, '$1.');
  const sum = (terms) => terms.join(' + ').replace(/\+ -/g, '- '), lin = (cs, vars) => sum(cs.map((c, i) => `${num(c)} * ${vars[i]}`));
  const pm = (x) => `${x < 0 ? '-' : '+'} ${num(Math.abs(x))}`;
  const pre = '--gamut--mt-', R = (x) => `var(${pre}${x})`, regs = [], nums = [], decls = [];
  const reg = (name, value) => { regs.push(pre + name); decls.push(`${pre}${name}: ${value};`); };
  const val = (name, value) => { nums.push(pre + name); decls.push(`${pre}${name}: ${value};`); };
  // the tone: --gamut-tone, else 95 at the first step to 10 at the last; Y its CIELAB Y (0 to 100)
  val('tone', 'clamp(0, var(--gamut-tone, calc(95 - 85 * var(--gamut--step-t))), 100)');
  // MCU's TonalPalette.tone(): tone 99 of a yellow hue (105 to 125 degrees) is tones 98 and 100 averaged in 8-bit sRGB;
  // tone 100 is white, so the step solves tone 98 and averages it with white (yt 1). The hue is known as a number only
  // on the list, the seed's element, which sets --gamut--mt-yf; its flag reaches the step by a style query
  // (--gamut--mt-yellow). An audit, 2026-10-28: #ffff00 at tone 99 gave #fffee1 for MCU's #ffffd6.
  val('yt', `calc(clamp(0, 1 - abs(${R('tone')} - 99) * 1000000, 1) * var(--gamut--mt-yellow))`);
  val('te', `calc(${R('tone')} - ${R('yt')})`);
  // tone 99 (but a yellow's, solved at 98): 1 there
  val('t99', `clamp(0, 1 - abs(${R('te')} - 99) * 1000000, 1)`);
  const T = R('te'), Y = R('y'), above = `clamp(0, sign(${T} - 8), 1)`;
  val('y', `calc(${above} * 100 * pow((${T} + 16) / 116, 3) + (1 - ${above}) * ${T} * ${num(2700 / 24389)})`);
  val('q0', `pow(.11 * sqrt(${Y}), ${num(1 / cz)})`); // MCU's first guess, J = 11 sqrt(Y)
  val('iy0', `calc(1 / ${Y})`); val('iy1', `calc(1 / (100 - ${Y}))`);
  const x = (i) => `(${lin(SD[i].map((v) => v * 100), ['r', 'g', 'b'])})`;
  const ad = (e) => `calc(400 * sign(${e}) / (1 + 27.13 * pow(abs(${e}), -.42)))`;
  reg('s1', `color(from var(--gamut--in0) srgb-linear ${[0, 1, 2].map((i) => ad(x(i))).join(' ')})`);
  // a and b times 11; Q / hypot(a, b) = 23 (u + .305) / (rel^(10/9) (a^2 + b^2) (p2 nbb / aw)^(5 c z / 9))
  const a = '(11 * r - 12 * g + b)', b = '(r + g - 2 * b) * 11 / 9';
  const kq = `${num(23 * 11)} * ((20 * r + 20 * g + 21 * b) / 20 + .305) / max(1e-30, pow(var(--gamut--rel), ${num(10 / 9)}) * (${a} * ${a} + ${b} * ${b}) * pow(max(0, (40 * r + 20 * g + b) / ${num(20 * AWN)}), ${num(5 * cz / 9)}))`;
  reg('s2', `color(from ${R('s1')} srgb-linear calc(${kq} * ${a}) calc(${kq} * ${b}) calc(atan2(${b}, ${a}) / 1rad))`);
  // grey where MCU's solveToInt is: chroma under 1e-4 (Q past this times eHue), no hue (u = v = 0), tone 0 or 100
  const QC = 23 * P1K * 0.25 / (1e-4 / K73) ** (10 / 9);
  const grey = `min(1, clamp(0, sign(hypot(r, g) - ${num(QC)} * (cos(b + 2) + 3.8)), 1) + clamp(0, sign(1e-20 - abs(r) - abs(g)), 1) + clamp(0, sign(${T} - 99.9999), 1) + clamp(0, sign(.0001 - ${T}), 1))`;
  const WT = [[451, 288], [-891, -261], [-220, -6300]].map(([p, q]) => [p / 1403, q / 1403]);
  const G = (q) => `${num(23 * AWN)} * (${q} + ${num(0.305 / AWN)}) / max(1e-9, (r * r + g * g) * pow(${q}, ${num(5 * cz / 9)}) + 11 * r + 108 * g)`;
  const X = (q, i) => `${num(460 * AWN / 1403)} * ${q} + (${G(q)}) * (${lin(WT[i], ['r', 'g'])})`;
  const inv = (e) => `pow(max(0, 27.13 / (400 / (${e}) - 1)), ${num(1 / 0.42)})`;
  const F = (q) => sum([0, 1, 2].map((i) => `${num(KL[i])} * ${inv(X(q, i))}`));
  const newton = (q) => `${q} * pow(.5 + ${Y} / (2 * max(1e-9, ${F(q)})), ${num(1 / cz)})`;
  // the first step goes far negative for grey, so P fails and the edge's ray, of length 0, gives grey
  let prev = R('gf');
  reg('gf', `color(from ${R('s2')} srgb-linear r g calc(${grey}))`);
  for (let k = 1; k <= NJ; k++) { reg(`j${k}`, `color(from ${prev} srgb-linear r g calc(${k === 1 ? `${newton(R('q0'))} - 1000000 * b` : newton('b')}))`); prev = R(`j${k}`); }
  reg('pi', `color(from ${prev} srgb-linear ${[0, 1, 2].map((i) => `calc(1000 * ${inv(X('b', i))})`).join(' ')})`);
  reg('p', `color(from ${R('pi')} srgb-linear ${LIN.map((row) => `calc(${lin(row.map((v) => v / 100000), ['r', 'g', 'b'])})`).join(' ')})`);
  // P stands where it is in sRGB and its Y is within 1% of the tone's (a failed search gives neither)
  const w = `clamp(0, sign(min(r, g, b) + .00001), 1) * clamp(0, sign(1.0001 - max(r, g, b)), 1) * clamp(0, sign(${Y} / 10000 - abs(${lin(K, ['r', 'g', 'b'])} - ${Y} / 100)), 1)`;
  reg('pw', `color(from ${R('p')} srgb-linear r g b / calc(${w}))`);
  const D = (i, p) => `${num(U[i])} * cos(${p}) ${pm(V[i])} * sin(${p})`;
  const mu = (p) => `1 / max(max(${[0, 1, 2].map((i) => D(i, p)).join(', ')}) * ${R('iy1')}, -1 * min(${[0, 1, 2].map((i) => D(i, p)).join(', ')}) * ${R('iy0')})`;
  const adb = (i, p) => `1 / (1 + 27.13 * pow(${num(SG[i])} * ${Y} + (${num(SU[i])} * cos(${p}) ${pm(SV[i])} * sin(${p})) * b, -.42))`;
  // the hue difference, in (-pi, pi]: atan2 of the edge point's b and a (the 400 of the responses cancels)
  // the edge point's a and b need its responses less the third (CAM16's a and b take none of a common part): two
  // numbers, x 1000000 (WebKit keeps 6 decimals), beside h; the hue difference to h, in (-pi, pi], from them
  const diffs = (p) => { const [r, g, bb] = [0, 1, 2].map((i) => adb(i, p)); return `calc(1000000 * (${r} - ${bb})) calc(1000000 * (${g} - ${bb}))`; };
  const res = `calc(mod(atan2((g + b) * 11 / 9, 11 * g - 12 * b) / 1rad - r + ${num(3 * Math.PI)}, ${num(2 * Math.PI)}) - ${num(Math.PI)})`;
  // At tone 99 sRGB's slice is a small triangle, and along its magenta-to-yellow edge the hue runs from 285.70 round
  // through red to 113.85 degrees within a hair of the magenta corner: the ray's correction steps can't follow it (it
  // was up to 30/255 off at 18 of 36 hues, hsl 30: 251 255 225 for MCU's 255 251 255). There, from 255 round to 113.85
  // degrees (Z), the ray's angle psi is MCU's own point's (HctSolver.bisectToLimit, within 0.8 of a byte of the edge at
  // the hue; tone99.json), a step function of the hue, held; elsewhere it solves.
  const T99 = JSON.parse(readFileSync(new URL('../tone99.json', import.meta.url), 'utf8')), Z0 = 255;
  const dot = (u, w) => u[0] * w[0] + u[1] * w[1] + u[2] * w[2], uv = [[dot(U, E1), dot(V, E1)], [dot(U, E2), dot(V, E2)]];
  const psiOf = (pt) => { const dv = pt.map((x) => (x - T99.y) / 100), q = [dot(dv, E1), dot(dv, E2)]; return Math.atan2(uv[0][0] * q[1] - uv[1][0] * q[0], q[0] * uv[1][1] - uv[0][1] * q[1]); };
  // Z's pieces: the one holding Z0, those after it, and the first (hue 0)
  const P99 = T99.pieces, from = P99.findLastIndex(([h]) => h <= Z0), zp = [[Z0, P99[from][1]], ...P99.slice(from + 1)];
  const psis = []; for (const [, pt] of zp) { let a = psiOf(pt); const last = psis[psis.length - 1]; if (last !== undefined) a += 2 * Math.PI * Math.round((last - a) / (2 * Math.PI)); psis.push(a); }
  const step = (h) => `clamp(0, sign(g - ${num(h)}) + 1, 1)`;
  // psi from hue 0 (P99[0], Z's last piece) up, then each of Z's pieces past Z0
  const p0 = psiOf(P99[0][1]), psi99 = sum([num(p0), `${num(psis[0] - p0)} * ${step(Z0)}`, ...zp.slice(1).map(([h], i) => `${num(psis[i + 1] - psis[i])} * ${step(h)}`)]);
  // (h, its degrees 0 to 360, 1 in Z at tone 99), then (h, psi, -): a held psi is the piece's plus 16 turns (32 pi, the
  // same ray), so each step tells it by psi past 50 and leaves it
  const inZ = `(1 - clamp(0, sign(g - ${num(P99[1][0])}) + 1, 1) * clamp(0, sign(${Z0} - g), 1))`;
  reg('hd', `color(from color(from ${R('s2')} srgb-linear b calc(mod(b * ${num(180 / Math.PI)} + 360, 360)) 0) srgb-linear r g calc(${R('t99')} * ${inZ}))`);
  reg('st0', `color(from ${R('hd')} srgb-linear r calc(r + b * (${psi99} + ${num(32 * Math.PI)} - r)) 0)`);
  let state = R('st0'); // (h, psi, -)
  for (let k = 0; k < NB; k++) {
    reg(`ma${k}`, `color(from ${state} srgb-linear r g calc(${mu('g')}))`);
    reg(`da${k}`, `color(from ${R(`ma${k}`)} srgb-linear r ${diffs('g')})`);
    reg(`mb${k}`, `color(from ${state} srgb-linear r g calc(${mu('g + .001')}))`);
    reg(`db${k}`, `color(from ${R(`mb${k}`)} srgb-linear r ${diffs('g + .001')})`);
    // (r_a, psi, r_b), then psi less r_a .001 / (r_b - r_a)
    const both = `color-mix(in srgb-linear, color(from ${R(`da${k}`)} srgb-linear ${res} none none), color-mix(in srgb-linear, color(from ${R(`ma${k}`)} srgb-linear none g none), color(from ${R(`db${k}`)} srgb-linear none none ${res})))`;
    // after the last step, the first channel says which answer: 1 P, 2 grey, else the edge (a mix averages: 2w and 4 grey)
    const first = k < NB - 1 ? `color(from ${R(`ma${k}`)} srgb-linear r none none)` : `color-mix(in srgb-linear, color(from ${R('pw')} srgb-linear calc(2 * alpha) none none), color(from ${R('gf')} srgb-linear calc(4 * b) none none))`;
    state = `color-mix(in srgb-linear, ${first}, color(from ${both} srgb-linear none calc(g - clamp(0, sign(50 - g), 1) * clamp(-1, r * .001 / (b - r), 1)) none))`;
    if (k < NB - 1) { reg(`st${k + 1}`, state); state = R(`st${k + 1}`); } // read twice
  }
  reg('mf', `color(from ${state} srgb-linear r g calc(clamp(0, 2 - r, 1) * ${mu('g')}))`);
  // out: P or the edge point, the other at alpha 0 in a premultiplied mix
  const edge = `color(from ${R('mf')} srgb-linear ${[0, 1, 2].map((i) => `calc(${Y} / 100 + (${D(i, 'g')}) * b / 100)`).join(' ')} / calc(1 - clamp(0, 1 - abs(r - 1), 1)))`;
  const out0 = `color(from color-mix(in srgb-linear, ${R('pw')}, ${edge}) srgb-linear clamp(0, r, 1) clamp(0, g, 1) clamp(0, b, 1) / 1)`;
  const avg = (c) => `calc(${c} + ${R('yt')} * (round((round(${c} * 255) + 255) / 2) / 255 - ${c}))`;
  const out = `color(from color(from ${out0} srgb ${avg('r')} ${avg('g')} ${avg('b')} / 1) srgb-linear r g b / 1)`;
  // the list's flag: the seed's CAM16 hue (its adapted responses, as s1 and s2 take them, read in srgb-linear: in srgb
  // the responses were encoded, and hues 103.4 to 105 and 125 to 127 came out yellow) in [105, 125) degrees
  const seed = 'var(--gamut-in, oklch(var(--gamut-l, 0.5) var(--gamut-c, 0) var(--gamut-h, 0)))';
  const hueR = `atan2((r + g - 2 * b) * 11 / 9, 11 * r - 12 * g + b) / 1rad`;
  const yf = (c) => `color(from color(from ${c} srgb-linear ${[0, 1, 2].map((i) => ad(x(i))).join(' ')}) srgb-linear calc(clamp(0, sign(${hueR} - ${num(105 * Math.PI / 180)}) + 1, 1) * clamp(0, sign(${num(125 * Math.PI / 180)} - ${hueR}), 1)) 0 0)`;
  const parent = `--gamut--mt-yf: ${yf(seed)};`;
  // the function has no list to read: it computes the flag itself, a typed result its if() compares (Chrome 155)
  const fn = { pre: `@function --gamut--palette-step-yf(--c) returns <color> { result: ${yf('var(--c)')}; }`,
    locals: [`--gamut--mt-yellow: if(style(--gamut--mt-yf: color(srgb-linear 1 0 0)): 1; else: 0);`, `--gamut--mt-yf: --gamut--palette-step-yf(${seed});`] };
  return { regs, nums, decls, out, parent, fn };
}
