// Checks .gamut-color-extract (build.mjs extractPart()) in Chrome, WebKit and Firefox, in two parts:
// - the numbers: for a color exactly in 8-bit sRGB (hex, rgb(), named), --gamut-x, -y, -z (on a read with a space's class
//   and on one without) against CSS Color 4's
//   conversion of those 8 bits within 1e-12 (1e-5 in Firefox); for any other, against what the engine itself gives as color(from <in> xyz-d65
//   x y z) (its own conversion, printed to 6 digits), to its print (x y z are read as 32-bit floats), alpha within 1e-6
//   (Firefox serializes alpha to 2 or 3 decimals, QUIRKS.md Q4: there against its own);
// - the spaces: every extract-<space> output against CSS Color 4's conversions (Color.js 0.7.1, the same matrices; the
//   spec's own rgbToHsl and rgbToHwb for hsl and hwb) of
//   the extracted x, y, z, within 1e-12 of each channel's range in Chrome and WebKit (the outputs are exact doubles: four
//   whole parts each), 5e-5 of the range or the color's size in Firefox (its calc() works in 32-bit floats); hues only
//   where chroma is above 1e-4 of its range (1e-3 in Firefox), and compared on the circle.
// Colors: random sRGB, Display P3 past sRGB, oklch, lab, hsl, hwb, lch, oklab, the other RGB spaces, translucent, greys,
// near-greys (channels 1e-4 apart), black and white.
// Usage: node test/extract-check.mjs
import PW from './playwright.mjs'; // its Chrome is Chrome for Testing, never the installed Chrome.app
import { pick } from './engines.mjs';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { rgbToHsl, rgbToHwb } from './ref/methods.mjs';
import { keep, KEPT } from './vendor/keep.mjs';
const req = createRequire(import.meta.url), pw = PW, cjs = req('colorjs.io'), Color = cjs.default ?? cjs;
const css = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
let seed = 2026102102; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648), f4 = (x) => +x.toFixed(4);
const cols = ['white', 'black', 'grey', 'rgb(128 128 128 / 0.5)', 'transparent', 'red', 'lime', 'blue', 'color(display-p3 1 0 0)',
  // HDR and past any gamut: large, negative, tiny
  'color(xyz-d65 10 20 30)', 'color(xyz-d65 49.2611 49.2611 49.2611)', 'color(xyz-d65 -0.5 2.5 -3)', 'color(srgb 4 0.5 -1)', 'color(srgb-linear 100 0 0.25)',
  'color(xyz-d65 0.000001 0.0000005 0.000002)', 'color(display-p3 2 -0.3 0.5)', 'color(xyz-d65 1000 1000 1000)',
  ...Array.from({ length: 40 }, () => `rgb(${Math.floor(rnd() * 256)} ${Math.floor(rnd() * 256)} ${Math.floor(rnd() * 256)})`),
  ...Array.from({ length: 20 }, () => `color(display-p3 ${f4(rnd())} ${f4(rnd())} ${f4(rnd())})`),
  ...Array.from({ length: 20 }, () => `oklch(${f4(0.05 + rnd() * 0.9)} ${f4(rnd() * 0.35)} ${f4(rnd() * 360)})`),
  ...Array.from({ length: 10 }, () => `lab(${f4(rnd() * 100)} ${f4(rnd() * 200 - 100)} ${f4(rnd() * 200 - 100)} / ${f4(rnd())})`),
  ...Array.from({ length: 10 }, () => `hsl(${f4(rnd() * 360)} ${f4(rnd() * 100)}% ${f4(rnd() * 100)}%)`),
  ...Array.from({ length: 10 }, () => `hwb(${f4(rnd() * 360)} ${f4(rnd() * 60)}% ${f4(rnd() * 60)}%)`),
  ...Array.from({ length: 10 }, () => `lch(${f4(rnd() * 100)} ${f4(rnd() * 150)} ${f4(rnd() * 360)})`),
  ...Array.from({ length: 10 }, () => `oklab(${f4(rnd())} ${f4(rnd() * 0.8 - 0.4)} ${f4(rnd() * 0.8 - 0.4)})`),
  ...Array.from({ length: 15 }, (_, k) => `color(${['a98-rgb', 'rec2020', 'prophoto-rgb', 'srgb-linear', 'xyz-d50'][k % 5]} ${f4(rnd() * 1.4 - 0.2)} ${f4(rnd() * 1.4 - 0.2)} ${f4(rnd() * 1.4 - 0.2)})`),
  // near-greys: Color.js 0.7.1 writes their oklch chroma as 0 below its epsilon, the spec's code as hypot(a, b) (SPEC below)
  ...Array.from({ length: 30 }, () => { const v = rnd(), e = (rnd() - 0.5) * 2e-4; return `color(srgb ${v} ${v + e} ${v - e})`; })];
const SPACES = [['srgb', 'srgb', ['r', 'g', 'b'], [1, 1, 1]], ['srgb-linear', 'srgb-linear', ['r', 'g', 'b'], [1, 1, 1]], ['display-p3', 'p3', ['r', 'g', 'b'], [1, 1, 1]],
  ['a98-rgb', 'a98', ['r', 'g', 'b'], [1, 1, 1]], ['prophoto-rgb', 'prophoto', ['r', 'g', 'b'], [1, 1, 1]], ['rec2020', 'rec2020', ['r', 'g', 'b'], [1, 1, 1]], ['xyz-d50', 'xyz-d50', ['x', 'y', 'z'], [1, 1, 1]],
  ['oklab', 'oklab', ['l', 'a', 'b'], [1, 0.8, 0.8]], ['oklch', 'oklch', ['l', 'c', 'h'], [1, 0.4, 360]], ['lab', 'lab', ['l', 'a', 'b'], [100, 250, 250]],
  ['lch', 'lch', ['l', 'c', 'h'], [100, 150, 360]], ['hsl', 'hsl', ['h', 's', 'l'], [360, 100, 100]], ['hwb', 'hwb', ['h', 'w', 'b'], [360, 100, 100]]];
const cls = SPACES.map(([s]) => `gamut-extract-${s}`).join(' ');
// each space's outputs read as the engine computes them where a page reads them: kept again on the reading element (test
// only), so a 32-bit calc() (Firefox) shows, rather than worked out from the text here
const READ = SPACES.flatMap(([sp, , chs]) => chs.map((c) => keep(`--rd-${sp}-${c}`, `var(--gamut-${sp}-${c})`)));
const page = `<!doctype html><style>${css}\n${READ.flatMap((k) => k.props).join('\n')}\n.gamut-color-extract-read { ${READ.flatMap((k) => k.decls).join(' ')} }</style>${cols.map((c) => `<div class="gamut-color-extract" style="--gamut-in: ${c}"><i class="gamut-color-extract-read ${cls}"></i><b class="gamut-color-extract-read"></b></div>`).join('')}`;
// outputs are unregistered text, calc() over whole parts: worked out here in doubles, in the same order, by CSS Values 4's
// math functions (round() with its strategy, mod() taking the divisor's sign, rem() the dividend's, atan2() an angle that
// the sheet divides by 1deg)
const CSSMATH = { sign: Math.sign, abs: Math.abs, pow: Math.pow, hypot: Math.hypot, max: Math.max, min: Math.min, clamp: (lo, v, hi) => Math.max(lo, Math.min(v, hi)),
  mod: (a, b) => a - b * Math.floor(a / b), rem: (a, b) => a - b * Math.trunc(a / b), log: (x, base) => (base === undefined ? Math.log(x) : Math.log(x) / Math.log(base)),
  atan2: (y, x) => (Math.atan2(y, x) * 180) / Math.PI,
  round: (k, x, step = 1) => { const q = x / step; return step * (k === 'down' ? Math.floor(q) : k === 'up' ? Math.ceil(q) : k === 'to-zero' ? Math.trunc(q) : Math.floor(q + 0.5)); } };
const num = (s) => { s = (s || '0').trim(); if (!/^[-+*/(). 0-9e,a-z]*$/.test(s)) return NaN;
  const js = s.replace(/calc\(/g, '(').replace(/round\((down|up|to-zero|nearest),/g, "round('$1',").replace(/round\((?!')/g, "round('nearest', ").replace(/\b1deg\b/g, '1');
  return Function(...Object.keys(CSSMATH), `return ${js}`)(...Object.values(CSSMATH)); };
// CSS Color 4's conversions.js where Color.js 0.7.1 differs: rec2020 by BT.1886's 2.4 (the current draft) written out, and
// lch, whose chroma Color.js makes 0 when a and b are both under 1e-5 of their range (conversions.js keeps it, and only
// the hue goes powerless)
const mm = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]), sg = (f) => (v) => Math.sign(v) * f(Math.abs(v));
const D65_D50 = [[1.0479297925449969, 0.022946870601609652, -0.05019226628920524], [0.02962780877005599, 0.9904344267538799, -0.017073799063418826], [-0.009243040646204504, 0.015055191490298152, 0.7518742814281371]];
const SPEC = {
  'rec2020': (xyz) => mm([[30757411 / 17917100, -6372589 / 17917100, -4539589 / 17917100], [-19765991 / 29648200, 47925759 / 29648200, 467509 / 29648200], [792561 / 44930125, -1921689 / 44930125, 42328811 / 44930125]], xyz).map(sg((a) => a ** (1 / 2.4))),
  'a98-rgb': (xyz) => mm([[1829569 / 896150, -506331 / 896150, -308931 / 896150], [-851781 / 878810, 1648619 / 878810, 36519 / 878810], [16779 / 1248040, -147721 / 1248040, 1266979 / 1248040]], xyz).map(sg((a) => a ** (256 / 563))),
  'prophoto-rgb': (xyz) => mm([[1.3457868816471583, -0.25557208737979464, -0.05110186497554526], [-0.5446307051249019, 1.5082477428451468, 0.02052744743642139], [0, 0, 1.2119675456389452]], mm(D65_D50, xyz)).map((v) => (Math.abs(v) >= 1 / 512 ? Math.sign(v) * Math.abs(v) ** (1 / 1.8) : 16 * v)),
  'xyz-d50': (xyz) => mm(D65_D50, xyz),
  'lch': (xyz) => { const [L, A, B] = new Color('xyz-d65', xyz).to('lab').coords; return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360]; },
  // CSS Color 4's OKLab_to_OKLCH: chroma is hypot(a, b) however small (Color.js 0.7.1 writes 0 below its epsilon)
  'oklch': (xyz) => { const [L, A, B] = new Color('xyz-d65', xyz).to('oklab').coords; return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360]; } };
// CSS Color 4's lin_sRGB and lin_sRGB_to_XYZ, for 8-bit sRGB colors
const SRGB_XYZ = [[506752 / 1228815, 87881 / 245763, 12673 / 70218], [87098 / 409605, 175762 / 245763, 12673 / 175545], [7918 / 409605, 87881 / 737289, 1001167 / 1053270]];
const eight = (col) => { const v = new Color(col).to('srgb').coords; return v.every((x) => x >= 0 && x <= 1 && Math.abs(x * 255 - Math.round(x * 255)) < 1e-6) ? v.map((x) => Math.round(x * 255)) : null; };
const xyz8 = (k) => mm(SRGB_XYZ, k.map((n) => n / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)));
let failed = false;
for (const [name, type, opts] of pick()) {
  const b = await pw[type].launch(opts), p = await b.newPage();
  await p.setContent(page);
  const got = await p.evaluate(([SPACES, K]) => { const kept = new Function(K)(); return [...document.querySelectorAll('i.gamut-color-extract-read')].map((e) => { const s = getComputedStyle(e), bare = getComputedStyle(e.nextElementSibling);
    const own = getComputedStyle(e.parentElement).getPropertyValue('--gamut-in');
    return { x: s.getPropertyValue('--gamut-x'), y: s.getPropertyValue('--gamut-y'), z: s.getPropertyValue('--gamut-z'), a: s.getPropertyValue('--gamut-alpha'), own,
      bare: ['--gamut-x', '--gamut-y', '--gamut-z'].map((q) => bare.getPropertyValue(q)),
      parts: ['x', 'y', 'z'].map((c) => ['qh', 'ql', 'E'].map((p) => +s.getPropertyValue(`--gamut--cx-${p}${c}`)).concat(+s.getPropertyValue(`--gamut--cx-sg${c}`))),
      sp: Object.fromEntries(SPACES.map(([sp, , chs]) => [sp, chs.map((c) => String(kept(s, `--rd-${sp}-${c}`)))])) }; }); }, [SPACES, KEPT]);
  // the engine's own xyz-d65 of each input, printed
  const ownXYZ = await p.evaluate((cols) => { const d = document.createElement('div'); document.body.append(d);
    return cols.map((c) => { d.style.color = `color(from ${c} xyz-d65 x y z / alpha)`; return getComputedStyle(d).color; }); }, cols);
  const bad = [], tolS = name === 'Firefox' ? 5e-5 : 1e-12; let worstN = 0, worst8 = 0; const worstS = {};
  cols.forEach((c, i) => {
    const g = got[i], m = ownXYZ[i].match(/xyz-d65 (\S+) (\S+) (\S+?)(?: \/ (\S+))?\)/), xyz = [g.x, g.y, g.z].map(num);
    const want = m ? [m[1], m[2], m[3]].map(num) : [0, 0, 0], wa = m && m[4] !== undefined ? num(m[4]) : 1;
    const k8 = eight(c), exactN = k8 ? xyz8(k8) : g.parts.map(([h, l, E, s]) => (E ? (s ? -1 : 1) * (1 + (h * 2048 + l) / 2 ** 23) * 2 ** (E - 64) : 0));
    const offN = k8 ? Math.max(...exactN.map((v, k) => Math.abs(xyz[k] - v))) : Math.max(...exactN.map((v, k) => Math.abs(v - want[k]))), offA = Math.abs(num(g.a) - wa);
    if (k8) worst8 = Math.max(worst8, offN); else worstN = Math.max(worstN, offN);
    // both sides print rounded (6 decimals in WebKit, 6 significant digits in Chrome and Firefox): two half units and a step
    const tolN = k8 ? (name === 'Firefox' ? 1e-5 : 1e-12) : 2 * Math.max(5e-7, ...want.map((v) => 5e-6 * Math.abs(v)));
    // the x, y, z a page reads, against the floats' parts it is written from (an 8-bit color is compared above)
    const offP = k8 ? 0 : Math.max(...exactN.map((v, k) => Math.abs(xyz[k] - v)));
    // alpha: 1e-6, as compat.json's requirement has it; 8 bits in Firefox 158, which keeps alpha so (QUIRKS.md Q4)
    const tolA = name === 'Firefox' ? 0.006 : 1e-6;
    if (!(offN <= tolN) || !(offP <= tolN) || !(offA <= tolA)) bad.push(`${c}: xyz ${xyz.join(' ')} alpha ${g.a}, the engine's ${ownXYZ[i]}`);
    // a read with no space's class takes x, y, z by its own rule (8-bit sRGB from the bytes): the same numbers
    // (mutation testing, 2026-10-29: that rule's matrix changed 2% passed, every read here having a space's class)
    const bare = g.bare.map(num), offB = Math.max(...bare.map((v, k) => Math.abs(v - (k8 ? exactN[k] : xyz[k]))));
    if (!(offB <= (k8 ? tolN : Math.max(tolN, 1e-12)))) bad.push(`${c}: a read with no space's class gives xyz ${g.bare.map((v) => num(v)).join(' ')}, with one ${xyz.join(' ')}`);
    for (const [sp, cj, chs, range] of SPACES) {
      // the reference from the x, y, z read (the floats' parts), which the spaces use
      const srgb = new Color('xyz-d65', exactN).to('srgb').coords;
      const ref = sp === 'hsl' ? rgbToHsl(...srgb) : sp === 'hwb' ? rgbToHwb(...srgb) : SPEC[sp] ? SPEC[sp](exactN) : new Color('xyz-d65', exactN).to(cj).coords, outv = g.sp[sp].map(num);
      const spread = Math.max(...srgb) - Math.min(...srgb);
      chs.forEach((ch, k) => {
        // a hue only where it is well defined (chroma, or the sRGB channels' spread, above 1e-4); HSL's saturation only
        // where min(l, 1 - l) is above 1e-4 (it divides by it); values past the range compared relative to themselves.
        // Firefox from 1e-3: its 32-bit calc() leaves a and b about 1e-7 off, 0.1 degree of hue at chroma 4e-5
        const cut = name === 'Firefox' ? 1e-3 : 1e-4;
        if (ch === 'h' && ((sp === 'hsl' || sp === 'hwb') ? !(spread > cut) : !(outv[1] / range[1] > cut))) return;
        if (sp === 'hsl' && ch === 's' && !(Math.min(ref[2], 100 - ref[2]) > cut * 100)) return;
        let w = ref[k]; if (Number.isNaN(w)) { if (ch === 'h') return; w = 0; }
        // Firefox's calc() is 32-bit: a98-rgb's curve (slope without bound at 0) magnifies that near 0, so there both
        // sides are compared in linear light
        const lin = name === 'Firefox' && sp === 'a98-rgb' ? (x) => Math.sign(x) * Math.abs(x) ** (563 / 256) : (x) => x;
        let off = Math.abs(lin(outv[k]) - lin(w)); if (ch === 'h') { off %= 360; off = Math.min(off, 360 - off); }
        // Firefox: its calc() is 32-bit, so its error grows with the color's own size (an HDR x of 41 cancelling to a
        // green near 0) and with what a step magnifies (HSL's saturation near white): 5e-5 of the larger
        off /= Math.max(range[k], Math.abs(w), name === 'Firefox' ? range[k] * Math.max(...exactN.map(Math.abs)) : 0); worstS[sp] = Math.max(worstS[sp] ?? 0, off);
        if (!(off <= tolS)) bad.push(`${c}: ${sp} ${ch} ${outv[k]}, want ${w} (from x y z ${exactN.map((x) => x.toFixed(9)).join(' ')})`);
      });
    }
  });
  failed ||= bad.length > 0;
  console.log(`${name}: ${cols.length * (1 + SPACES.length) - bad.length} of ${cols.length * (1 + SPACES.length)} (numbers worst ${worstN.toExponential(1)} off the engine's own, 8-bit sRGB colors ${worst8.toExponential(1)} off the spec's; spaces worst ${Object.entries(worstS).map(([k, v]) => `${k} ${v.toExponential(0)}`).join(', ')})${bad.length ? `\n  ${bad.slice(0, 8).join('\n  ')}` : ''}`);
  await b.close();
}
process.exit(failed ? 1 : 0);
