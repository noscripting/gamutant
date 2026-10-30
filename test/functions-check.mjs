// Checks each part's function form (build.mjs FUNCTIONS, as test/data/functions.json) against its class: in an engine that parses @function, the
// call gives the color the class writes for the same inputs, within 1e-4 a channel, for 200 random inputs a function
// (arguments left off from the end, `none` for an input left unset, alpha included); where @function doesn't parse,
// the rule is dropped and a declaration written before each call keeps its color. Chrome, WebKit and Firefox.
// A part that reads a media query is checked again where it matches: readable-text on a P3 screen, in Chrome (the
// DevTools protocol emulates color-gamut; WebKit and Firefox can't be made one headless).
// Usage: node test/functions-check.mjs [name ...]   (SHEET= for another sheet; names as in FUNCTIONS, e.g. okhsl)
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { pick, open } from './engines.mjs';
// each part's function form and its arguments, as build.mjs lists them (FUNCTIONS), written out by the build
const FUNCTIONS = JSON.parse(readFileSync(new URL('./data/functions.json', import.meta.url), 'utf8'));
import { gamut } from './ref/classes.mjs';

let seed = 2026102701; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const n = (lo, hi, d = 4) => (lo + (hi - lo) * rnd()).toFixed(d), pickOne = (xs) => xs[Math.floor(rnd() * xs.length)];
const alpha = () => (rnd() < 0.2 ? ` / ${n(0, 1, 2)}` : '');
const color = () => pickOne([
  () => `oklch(${n(0.02, 0.98)} ${n(0, 0.4)} ${n(0, 360, 2)}${alpha()})`,
  () => `rgb(${n(0, 255, 1)} ${n(0, 255, 1)} ${n(0, 255, 1)}${alpha()})`,
  () => `color(display-p3 ${n(0, 1)} ${n(0, 1)} ${n(0, 1)}${alpha()})`,
])();
const opaque = () => pickOne([() => `oklch(${n(0.02, 0.98)} ${n(0, 0.3)} ${n(0, 360, 2)})`, () => `rgb(${n(0, 255, 0)} ${n(0, 255, 0)} ${n(0, 255, 0)})`])();
// and XYZ with a negative channel, past the visible, whose offset only the function's own copy takes (mutation testing,
// 2026-10-29: its min() made max() moved Y by 0.1, unseen)
const hdr = () => pickOne([color, () => `color(xyz-d65 ${n(0, 20)} ${n(0, 20)} ${n(0, 20)})`, () => `color(rec2020 ${n(0, 1)} ${n(0, 1)} ${n(0, 1)})`,
  () => `color(xyz-d65 ${n(-0.4, 1)} ${n(-0.4, 1)} ${n(-0.4, 1)})`])();
// the arguments left off from the end: some cases give fewer than all
const trim = (args, least) => args.slice(0, rnd() < 0.25 ? least + Math.floor(rnd() * (args.length - least)) : args.length);

// each function's random arguments, as a list (an absent one left off), the --gamut-target around them, if any, and
// how many sibling elements call it (a palette's steps)
const edge = () => { const g = pickOne(['srgb', 'display-p3', 'rec2020', undefined]), given = rnd() < 0.5; return { args: [color(), !given && rnd() < 0.3 ? undefined : n(0.1, 1), given ? g : undefined], target: g }; };
const okTarget = () => pickOne([undefined, 'srgb', 'display-p3', 'rec2020']);
export const CASES = {
  'screen-edge': edge,
  // a palette: the seed, rel, the step (none: its place) and the tone (none: from the step); the target around it, if
  // any, changes nothing (sRGB whatever the target)
  'palette-step': () => ({ args: trim([color(), n(0.1, 1), rnd() < 0.6 ? 'none' : n(0, 1), rnd() < 0.5 ? 'none' : n(0, 100, 1)], 1), target: okTarget(), steps: 2 + Math.floor(rnd() * 11) }),
  // a ratio just over 1 a fifth of the time: a text a shade off its background, mixed under 2% toward white or black
  'readable-text': () => ({ args: trim([opaque(), rnd() < 0.2 ? n(1, 1.1, 3) : n(1, 21, 2), rnd() < 0.3 ? 'none' : opaque(), rnd() < 0.4 ? 'none' : pickOne([opaque, () => 'white', () => 'black'])()], 1) }),
  'contrast-color': () => ({ args: [color(), pickOne(['none', '3', '4.5', '7', n(1, 21, 2)]), ...Array.from({ length: Math.floor(rnd() * 7) }, color)] }),
  'color-mix': () => { const k = 1 + Math.floor(rnd() * 6);
    return { args: [pickOne(['oklab', 'oklch', 'srgb', 'srgb-linear', 'lab', 'lch', 'hsl', 'xyz-d65', 'oklch longer hue']), ...Array.from({ length: k }, () => [color(), rnd() < 0.4 ? 'none' : n(0, 100, 1)]).flat()].slice(0, rnd() < 0.3 ? 2 * k : 2 * k + 1) }; },
  // the Okhsl parts follow --gamut-target on an ancestor (#8659's P3 and Rec. 2020 variants), the function as the class
  okhsl: () => ({ args: trim([n(0, 360, 2), n(0, 1), n(0, 1)], 0), target: okTarget() }),
  'okhsl-from': () => ({ args: trim([color(), rnd() < 0.3 ? 'none' : n(0, 1), rnd() < 0.5 ? 'none' : n(0, 1)], 1), target: okTarget() }),
  okhsv: () => ({ args: trim([n(0, 360, 2), n(0, 1), n(0, 1)], 0), target: okTarget() }),
  'device-cmyk': () => ({ args: trim([n(0, 1), n(0, 1), n(0, 1), n(0, 1), n(0, 1, 2)], 0) }),
  'rec2100-pq': () => ({ args: trim([n(0, 1), n(0, 1), n(0, 1), n(0, 1, 2)], 3) }),
  'rec2100-hlg': () => ({ args: trim([n(0, 1), n(0, 1), n(0, 1), n(0, 1, 2)], 3) }),
  'rec2100-linear': () => ({ args: trim([n(0, 4), n(0, 4), n(0, 4), n(0, 1, 2)], 3) }),
  jzazbz: () => ({ args: trim([n(0, 0.25), n(-0.15, 0.15), n(-0.15, 0.15), n(0, 1, 2)], 3) }),
  jzczhz: () => ({ args: trim([n(0, 0.25), n(0, 0.15), n(0, 360, 2), n(0, 1, 2)], 3) }),
  ictcp: () => ({ args: trim([n(0, 0.7), n(-0.25, 0.25), n(-0.25, 0.25), n(0, 1, 2)], 3) }),
  // two colors, half the time one color in two spellings (its own OkLab, to 9 digits), sometimes with a `none`
  'color-equal': () => { const a = color(), same = rnd() < 0.5;
    return { args: [a, same ? `oklab(from ${a} l a b / alpha)` : pickOne([color, () => a.replace(/ ([\d.]+)%? /, ' none ')])()] }; },
  'hdr-color': () => ({ args: trim([hdr(), n(0, 1, 2), hdr(), n(1.5, 4, 2), n(0, 5, 2)], 3) }),   // (color-1, h1, color-2, h2, headroom)
};

// the class's inputs for the same arguments, on the element or on the list around its steps: each argument sets the
// input it names, `none` none
export function classStyle(f, { args, target }) {
  const names = f.args.map((a) => a.split(/[ :]/)[0]), set = [];
  // an argument standing for an ancestor's property of another name (--gamut for --gamut-target) is the case's target;
  // one named as the property (--gamut-mix-space) is set here, on the class's parent, which a style query reads
  args.forEach((v, i) => { if (v !== undefined && v !== 'none' && !Object.entries(f.container ?? {}).some(([k, a]) => a === names[i] && k !== a)) set.push(`${names[i]}: ${v}`); });
  if (f.cls === 'color-mix') set.push(`--gamut-mix-count: ${(args.length) >> 1}`);
  return set.join('; ');
}
export const call = (f, { args }) => { const given = args.slice(0, args.findLastIndex((v) => v !== undefined) + 1); return `--gamut-${f.cls}(${given.map((v) => v ?? 'none').join(', ')})`; };
export const outOf = (f) => f.out ?? '--gamut-out';
// a number output (--gamut-equal) painted as a color, so it compares as one
const paint = (f, v) => (f.number ? `rgb(calc(255 * ${v}) 0 0)` : v);

// a computed color as its form and its channels (rgb() in 0 to 1, none as NaN), alpha last
const parse = (v) => {
  const m = v.match(/^([a-z-]+)\((.*)\)$/); if (!m) return [v];
  if (m[1] === 'rgb' || m[1] === 'rgba') { const c = m[2].split(/,\s*/).map(Number); return ['rgb', c[0] / 255, c[1] / 255, c[2] / 255, c[3] ?? 1]; }
  const [rest, a = '1'] = m[2].split('/'), t = rest.trim().split(/\s+/);
  return [...(m[1] === 'color' ? [m[1], t.shift()] : [m[1]]), ...t.map((x) => (x === 'none' ? NaN : Number(x))), Number(a)];
};
const diff = (x, y) => {
  const a = parse(x), b = parse(y), k = a.findIndex((v) => typeof v === 'number');
  if (k < 0 || a.length !== b.length || a.slice(0, k).join() !== b.slice(0, k).join()) return x === y ? 0 : Infinity;
  return Math.max(...a.slice(k).map((v, i) => (Number.isNaN(v) && Number.isNaN(b[k + i]) ? 0 : Number.isNaN(v - b[k + i]) ? Infinity : Math.abs(v - b[k + i]))));
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sheet = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
  const only = process.argv.slice(2), fns = FUNCTIONS.filter((f) => !only.length || only.includes(f.cls));
  const unknown = only.filter((k) => !FUNCTIONS.some((f) => f.cls === k));
  if (unknown.length) { console.log(`FAIL no function for ${unknown.join(' ')}`); process.exit(1); }
  const cases = Object.fromEntries(fns.map((f) => [f.cls, Array.from({ length: 200 }, CASES[f.cls])]));
  // each argument the type its input takes, so a fixture in the wrong order can't pass as both forms' fallback
  const COLOR = /^--gamut-(in|bg|readable-(from|to)|try-\d|mix-\d|equal-[ab]|hdr-\d)$/, NUM = /^(none|-?[\d.]+(e[-+]?\d+)?(%|deg|rad|grad|turn)?|calc\(.*\))$/;
  const misfit = fns.flatMap((f) => cases[f.cls].flatMap((c) => c.args.map((v, i) => [f.args[i].split(/[ :]/)[0], v]).filter(([n, v]) => v !== undefined && v !== 'none' && n !== '--gamut' && n !== '--gamut-mix-space' && (COLOR.test(n) ? NUM.test(v) && !/^calc/.test(v) : !NUM.test(v))).map(([n, v]) => `${f.cls} ${n}: ${v}`)));
  if (misfit.length) { console.log(`FAIL: ${misfit.length} arguments of another type than their input takes: ${misfit.slice(0, 6).join(' | ')}`); process.exit(1); }
  const fallbacks = fns.map((f) => `<b data-f="${f.cls}" style="background: rgb(1 2 3); background: ${paint(f, call(f, cases[f.cls][0]))}"></b>`).join('');
  let fail = 0;
  for (const e of pick()) {
    const { browser, page } = await open(e);
    try {
      await page.setContent(`<style>${sheet}\ni{display:block;width:2px;height:2px}p{margin:0}</style>${fallbacks}<div id=cases></div>`, { timeout: 120000 });
      const has = await page.evaluate(() => [...document.styleSheets[0].cssRules].some(function has(x) { return x.constructor.name === 'CSSFunctionRule' || [...(x.cssRules ?? [])].some(has); }));
      if (!has) {
        const kept = await page.evaluate(() => [...document.querySelectorAll('b')].filter((x) => getComputedStyle(x).backgroundColor !== 'rgb(1, 2, 3)').map((x) => x.dataset.f));
        if (kept.length) fail++;
        console.log(`${e[0]}: ${kept.length ? `FAIL: ${kept.join(', ')} lost the declaration before the call` : `PRECONDITION_FAILED: @function doesn't parse; the declaration before each of ${fns.length} calls keeps its color`}`);
        continue;
      }
      const MEDIA = { 'readable-text': { name: 'color-gamut', value: 'p3', label: 'P3 screen' } };
      const runs = [...fns.map((f) => [f]), ...(/chrom/i.test(String(e)) ? fns.filter((f) => MEDIA[f.cls]).map((f) => [f, MEDIA[f.cls]]) : [])];
      for (const [f, media] of runs) {
        if (media) await (await page.context().newCDPSession(page)).send('Emulation.setEmulatedMedia', { features: [{ name: media.name, value: media.value }] });
        // a case: the calls in one list, the class's elements in another, each list its own siblings
        const markup = cases[f.cls].map((c) => { const k = c.steps ?? 1;
          return `<div${c.target ? ` style="--gamut-target: ${c.target}"` : ''}><p>${`<i style="background: ${paint(f, call(f, c))}"></i>`.repeat(k)}</p><p style="${classStyle(f, c)}">${`<i class="${gamut(f.cls)}" style="background: ${paint(f, `var(${outOf(f)})`)}"></i>`.repeat(k)}</p></div>`; }).join('');
        const v = await page.evaluate((m) => { document.getElementById('cases').innerHTML = m; return [...document.querySelectorAll('#cases > div')].map((d) => [...d.children].map((p) => [...p.children].map((x) => getComputedStyle(x).backgroundColor))); }, markup);
        let same = 0, all = 0, worst = 0; const bad = [];
        v.forEach(([a, b], i) => a.forEach((x, j) => { const d = diff(x, b[j]); all++; if (d <= 1e-4) same++; else bad.push(`${call(f, cases[f.cls][i])}${a.length > 1 ? ` step ${j + 1} of ${a.length}` : ''}: ${x} | class ${b[j]}`); worst = Math.max(worst, d); }));
        // the cases must drive the class: a fixture whose arguments don't fit gives both forms their fallback, and they agree
        const blank = v.flatMap(([, b]) => b).filter((x) => /^(rgba\(0, 0, 0, 0\)|transparent|)$/.test(x)).length;
        if (blank > all / 4) { fail++; console.log(`${e[0]}: FAIL: .${f.cls} paints nothing in ${blank} of ${all} cases: its fixture doesn't drive it`); }
        if (same < all) fail++;
        console.log(`${e[0]}${media ? `, ${media.label}` : ''}: ${same === all ? 'PASS' : 'FAIL'}: --gamut-${f.cls}() is .${f.cls} within 1e-4 a channel in ${same} of ${all}${all > v.length ? ` (${v.length} lists)` : ''} (worst ${worst.toExponential(1)})${bad.length ? `\n  ${bad.slice(0, 4).join('\n  ')}` : ''}`);
      }
    } finally { await browser.close(); }
  }
  process.exit(fail ? 1 : 0);
}
