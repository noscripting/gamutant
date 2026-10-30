// Checks .gamut-color-interpolate (src/scale.css, as gamutant.css holds it) in Chrome, WebKit and Firefox against Color.js 0.7.1's
// mix() (premultiplied, shorter hue): the computed --gamut-out of 1,375 cases (1 to 8 stops in oklab, oklch, srgb-linear,
// srgb and lab; interior points, the stops themselves, coincident positions and a step either side of them, t past both
// ends, absent counts and colors) within 1/255 a channel in sRGB, unclipped (this sheet's own bar); a stop within the
// count with no position, which css-values-5 §7.5's grammar (`<input-position>{1,2} : <color>`, every stop) makes
// invalid: --gamut-out invalid at computed-value time, so the parent's; the contract (the 34 registers src/scale.css
// declares and one rule, --gamut-out inherited, the stages transparent and the
// numbers 0 on a child, no paint or animation of its own); painted pixels; the pixel of a scale whose --gamut-t changes
// at the next rAF; and the style time of 256 distinct five-stop scales changing at once, under the bench lock (its
// correctness asserted, its duration printed). One headless browser at a time, the sheet linked at the page's load.
// Usage: node test/scale-check.mjs [Chrome|WebKit|Firefox]
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { pw, need, pick, benchLock } from './engines.mjs';
import { prefixSheet } from './ref/classes.mjs';

const { PNG } = need('pngjs');
const requireColor = createRequire(import.meta.url);
const Color = requireColor('colorjs.io').default ?? requireColor('colorjs.io');
const colorPackage = JSON.parse(readFileSync(new URL('../package.json', `file://${requireColor.resolve('colorjs.io')}`)));
if (colorPackage.version !== '0.7.1') throw new Error(`Expected Color.js 0.7.1, got ${colorPackage.version}`);
const selected = process.argv.slice(2);
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
// the sheet's numbers: the stop count; the stop ends, fixed up (each at least the stop's start, which is at least the end
// before) and each held as the number the engine keeps when it substitutes one (6 significant digits in Chrome and
// Firefox, 6 decimals in WebKit) plus the rest x 1e6; the zero flags of the segments' widths
const numericNames = ['n', ...range(1, 7).map((k) => `e${k}`), ...range(2, 8).map((k) => `z${k}`), ...range(1, 8).map((k) => `u${k}`)];
const expectedRegisters = [
  ['--gamut-out', '<color>', true],
  ...range(1, 9).map((k) => [`--gamut--scale-s${k}`, '<color>', false]),   // s9: the eighth stop's own stretch
  ...numericNames.map((name) => [`--gamut--scale-${name}`, '<number>', false]),
  ['--gamut--scale-g', '<percentage>', false],
];
const css = prefixSheet(readFileSync(new URL('./vendor/scale.css', import.meta.url), 'utf8'));   // its classes as the sheet ships them
// the part as the built sheet holds it (comments and blank lines aside): a sheet not rebuilt since src/scale.css changed fails here
const bare = (t) => t.replace(/\/\*[^]*?\*\//g, '').replace(/\s+/g, ' ').trim();
// and the pages run on the sheet itself (SHEET= another), so a rule elsewhere in it that reaches the part shows
const sheetText = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
if (!bare(sheetText).includes(bare(css))) {
  console.log('FAIL gamutant.css does not hold src/scale.css as it is: rebuild (node build.mjs)'); process.exit(1); }
const limit = 1; // this sheet's own bar: 8-bit sRGB steps, without gamut mapping or clipping
const ink = '#d653b6';
const colors = ['#ee3344', '#f28c28', '#d2c62b', '#30b969', '#29a6cf', '#4163dc', '#9c46dc', '#e14b99'];
const clamp = (n) => Math.min(1, Math.max(0, n));
const sets = [
  { name: '2 stops', stops: [colors[0], colors[4]] },
  { name: '3 stops', stops: [colors[0], colors[3], colors[6]] },
  { name: '5 stops', stops: [colors[0], colors[1], colors[3], colors[5], colors[7]] },
  { name: '8 stops', stops: colors },
  { name: '4 custom, duplicate', stops: [colors[0], colors[2], colors[4], colors[6]], at: [0, 0.37, 0.37, 1] },
];
const variants = sets.flatMap((set) => (set.stops.length === 5
  ? ['oklab', 'oklch', 'srgb-linear', 'srgb', 'lab']
  : ['oklab', 'oklch', 'srgb-linear']).map((space) => ({ ...set, space })));

function resolved(set) {
  const count = set.count ?? set.stops.length;
  const stops = Array.from({ length: 8 }, (_, k) => set.stops[k]);
  for (let k = 0; k < 8; k++) stops[k] ??= k ? stops[k - 1] : '#808080';
  return { count, stops, at: Array.from({ length: 8 }, (_, k) => set.at?.[k] ?? k / Math.max(1, count - 1)) };
}

function reference(set, t) {
  const { count, stops, at } = resolved(set);
  let result = new Color(stops[0]);
  for (let k = 1; k < 8; k++) {
    const d = at[k] - at[k - 1];
    const w = k >= count ? 0 : d === 0 ? Number(t >= at[k]) : clamp((t - at[k - 1]) / d);
    result = result.mix(stops[k], w, { space: set.space ?? 'oklab', hue: 'shorter', premultiplied: true });
  }
  return result;
}

function atStop(set, t) {
  const { count, stops, at } = resolved(set);
  // At a coincident position the final stop at that position wins.
  let index = 0;
  for (let k = 0; k < count; k++) if (at[k] <= t) index = k;
  return new Color(stops[index]);
}

function declarations(set, t) {
  return [
    `color:${ink}`,
    t === undefined ? '' : `--gamut-t:${t}`,
    set.omitCount ? '' : `--gamut-stops:${set.count ?? set.stops.length}`,
    set.space ? `--gamut-space:${set.space}` : '',
    ...set.stops.map((c, k) => c ? `--gamut-stop-${k + 1}:${c}` : ''),
    // every stop within the count gets its position (k / (count - 1) unless the set gives one); a set marked missing
    // writes only the positions it lists
    ...(set.missing ? set.at ?? [] : resolved(set).at.slice(0, set.count ?? set.stops.length)).map((p, k) => p == null ? '' : `--gamut-at-${k + 1}:${p}`),
  ].filter(Boolean).join(';');
}

const cases = [];
function addCase(set, t, kind, expected = reference(set, t ?? 0)) {
  cases.push({ set, t, kind, expected, label: `${set.name}/${set.space ?? 'default'} t=${t ?? 'unset'} ${kind}` });
}
for (const set of variants) {
  const { count, at } = resolved(set);
  for (let k = 1; k < count; k++) {
    // A zero-width segment has no interior; still test all 20 requested samples
    // at its position, plus the two sides below.
    for (let j = 1; j <= 20; j++) addCase(set, at[k - 1] + (at[k] - at[k - 1]) * j / 21, at[k] === at[k - 1] ? 'coincident' : 'interior');
    if (at[k] === at[k - 1]) {
      addCase(set, at[k] - 1e-7, 'step-before');
      addCase(set, at[k] + 1e-7, 'step-after');
    }
  }
  for (const t of at.slice(0, count)) addCase(set, t, 'stop', atStop(set, t));
  addCase(set, -0.5, 'end', new Color(set.stops[0]));
  addCase(set, 1.5, 'end', new Color(set.stops[count - 1]));
}

const extras = [
  { name: 'default count and space', stops: [colors[0], colors[4]], omitCount: true },
  { name: 'only first stop', stops: [colors[0]], count: 8 },
  { name: 'all colors absent', stops: [], count: 8 },
  { name: 'missing interior colors', stops: [colors[0], null, colors[3], null, colors[6]], count: 8 },
  { name: 'missing first color', stops: [null, colors[4]], count: 2 },
  { name: 'unused colors and zero denominators', stops: colors, count: 2, at: [0, 1, 1, 1, 1, 1, 1, 1] },
  { name: 'tiny positive segment', stops: sets[1].stops, at: [0, 1e-8, 1] },
];
for (const set of extras) for (const t of [-0.5, 0, 5e-9, 0.13, 0.37, 0.5, 0.81, 1, 1.5]) addCase(set, t, 'fallback');
addCase(extras[0], undefined, 'fallback');
// a stop within the count with no position: invalid, the parent's --gamut-out (teal, from the wrapper)
const PARENT = new Color('teal');
const missing = [
  { name: 'missing interior position', stops: sets[2].stops, at: [0, 0.13, null, 0.81, 1], missing: true },
  { name: 'no positions', stops: sets[1].stops, missing: true },
  { name: 'missing first position', stops: sets[0].stops, at: [null, 1], missing: true },
  { name: 'missing last position', stops: sets[1].stops, at: [0, 0.5], missing: true },
  { name: 'no positions, default count', stops: [colors[0], colors[4]], omitCount: true, missing: true },
  { name: 'one stop, no position', stops: [colors[2]], count: 1, missing: true },
];
for (const set of missing) for (const t of [-0.5, 0.3, 1.5]) addCase(set, t, 'missing', PARENT);
// one stop is its color at every t: counted as two copies, a hue method turned it a full circle between them
const one = { name: 'one stop, longer hue', stops: [colors[2]], count: 1, space: 'oklch longer hue' };
for (const t of [-0.5, 0, 0.3, 0.7, 1, 1.5]) addCase(one, t, 'fallback', new Color(colors[2]));

// One in-gamut interior pixel per set/space; raw out-of-gamut results remain in
// the computed-value tests, where browser gamut mapping cannot hide a mismatch.
const pixels = variants.map((set) => cases.find((c) => c.set === set && c.kind === 'interior'
  && c.expected.to('srgb').coords.every((v) => v > 0.02 && v < 0.98)));
if (pixels.some((c) => !c)) throw new Error('Missing in-gamut pixel fixture');
const frameSet = { ...sets[2], space: 'srgb-linear' };
const frameOld = 0.08, frameNew = 0.86;
const pixelY = 8, frameY = 48;
const styles = `
  body { margin:0; }
  .scale-sample { position:absolute; left:0; top:110px; width:1px; height:1px; }
  .scale-pixel { position:absolute; top:${pixelY}px; width:24px; height:24px; background:var(--gamut-out); }
  .scale-frame { position:absolute; top:${frameY}px; left:8px; width:24px; height:24px; background:var(--gamut-out); }
  .scale-cost { display:inline-block; width:2px; height:2px; background:var(--gamut-out); }
`;
const shell = (body) => `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/scale.css"><style>${styles}</style>${body}`;
const mainHTML = shell(
  `<div style="--gamut-out: teal">${cases.map((c, i) => `<div class="gamut-color-interpolate scale-sample" data-case="${i}" style="${declarations(c.set, c.t)}"></div>`).join('')}</div>`
  + pixels.map((c, i) => `<div class="gamut-color-interpolate scale-pixel" style="${declarations(c.set, c.t)};left:${8 + i * 28}px"></div>`).join('')
  + `<div class="gamut-color-interpolate scale-frame" style="${declarations(frameSet, frameOld)}"><span class="scale-child"></span></div>`
  + `<div class="gamut-color-interpolate scale-unpainted" style="${declarations(frameSet, 0.4)}"></div>`
  + `<div class="gamut-color-interpolate scale-parent" style="${declarations(frameSet, 0.2)}"><div class="gamut-color-interpolate scale-nested" style="--gamut-t:0.7"></div></div>`
);
const costHTML = shell(Array.from({ length: 256 }, (_, i) =>
  `<div class="gamut-color-interpolate scale-cost" style="${declarations(frameSet, (i + 0.5) / 256)}"></div>`).join(''));

function compare(actual, expected) {
  try {
    const a = new Color(actual.replace(/-?\d*\.?\d+e[-+]?\d+/gi, (x) => Number(x).toFixed(12))); // Firefox prints 2.98023e-8; Color.js can't read it
    const rgb = a.to('srgb').coords;
    const want = expected.to('srgb').coords;
    const error = Math.max(...rgb.map((v, k) => Math.abs(v - want[k]) * 255), Math.abs(a.alpha - expected.alpha) * 255);
    return { error: Number.isFinite(error) ? error : Infinity, actual, rgb, want };
  } catch (error) {
    return { error: Infinity, actual, reason: error.message };
  }
}
function pixelAt(image, x, y) {
  const offset = (y * image.width + x) * 4;
  return [...image.data.subarray(offset, offset + 3)];
}
function comparePixel(rgb, expected) {
  const want = expected.to('srgb').coords.map((v) => Math.round(v * 255));
  return { rgb, want, error: Math.max(...rgb.map((v, k) => Math.abs(v - want[k]))) };
}
const resultWord = (ok) => ok ? 'PASS' : 'FAIL';
const ms = (n) => n.toFixed(3);

async function measureCost(page, url) {
  // a fresh document, the sheet linked at its load
  await page.goto(url, { waitUntil: 'load' });
  const cost = await page.evaluate(async () => {
    const elements = [...document.querySelectorAll('.scale-cost')];
    const read = () => elements.map((el) => getComputedStyle(el).getPropertyValue('--gamut-out').trim());
    let before = read();
    const trials = [];
    for (let trial = -1; trial < 5; trial++) {
      await new Promise(requestAnimationFrame);
      const offset = (trial + 2) * 37;
      const values = elements.map((_, i) => (((i + offset) % 256) + 0.5) / 256);
      for (let i = 0; i < elements.length; i++) elements[i].style.setProperty('--gamut-t', String(values[i]));
      const start = performance.now();
      const after = read(); // forces style; no geometry read, screenshot or paint
      const duration = performance.now() - start;
      if (trial >= 0) trials.push({ duration, changed: after.filter((v, k) => v !== before[k]).length, values, after });
      before = after;
    }
    const idleStart = performance.now();
    read();
    const cleanRead = performance.now() - idleStart;
    return { trials, cleanRead };
  });
  let ok = true;
  for (const trial of cost.trials) {
    ok &&= trial.changed === 256 && Number.isFinite(trial.duration);
    for (let k = 0; k < 256; k++) ok &&= compare(trial.after[k], reference(frameSet, trial.values[k])).error <= limit;
  }
  const durations = cost.trials.map((r) => r.duration);
  return { ok, durations, median: [...durations].sort((a, b) => a - b)[2], cleanRead: cost.cleanRead };
}

async function checkEngine(name, type, options, origin) {
  const browser = await pw[type].launch({ headless: true, ...options });
  let failed = false;
  try {
    const page = await browser.newPage({ viewport: { width: 512, height: 128 }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(10000);
    await page.goto(origin, { waitUntil: 'load' });
    const raw = await page.evaluate(() => [...document.querySelectorAll('.scale-sample')]
      .map((el) => getComputedStyle(el).getPropertyValue('--gamut-out').trim()));
    const results = cases.map((c, k) => ({ ...compare(raw[k], c.expected), label: c.label, kind: c.kind }));
    const bad = results.filter((r) => r.error > limit);
    failed ||= bad.length > 0;
    const counts = ['interior', 'coincident', 'stop', 'end', 'step-before', 'step-after', 'fallback', 'missing'].map((kind) => {
      const group = results.filter((r) => r.kind === kind);
      return `${kind}=${group.length - group.filter((r) => r.error > limit).length}/${group.length}`;
    }).join(' ');
    console.log(`${name} ${browser.version()} ${resultWord(!bad.length)} computed ${results.length - bad.length}/${results.length}; ${counts}`);
    console.log(`${name} five worst (max channel error in 1/255 sRGB, unclipped):`);
    for (const r of [...results].sort((a, b) => b.error - a.error).slice(0, 5)) {
      console.log(`  ${r.error.toFixed(6)} ${r.label}; ${r.actual}${r.reason ? `; ${r.reason}` : ''}`);
    }

    const contract = await page.evaluate(([numericNames, src]) => {
      const get = (selector) => getComputedStyle(document.querySelector(selector));
      const bare = get('.scale-unpainted');
      return {
        child: get('.scale-child').getPropertyValue('--gamut-out').trim(),
        childStages: Array.from({ length: 9 }, (_, k) => get('.scale-child').getPropertyValue(`--gamut--scale-s${k + 1}`).trim()),
        childNumbers: numericNames.map((name) => get('.scale-child').getPropertyValue(`--gamut--scale-${name}`).trim()),
        nested: get('.scale-nested').getPropertyValue('--gamut-out').trim(),
        background: bare.backgroundColor, image: bare.backgroundImage,
        animations: document.getAnimations().length,
        // the part's own rules, from src/scale.css as the sheet holds it (the page links the whole sheet)
        rules: (() => { const own = new CSSStyleSheet(); own.replaceSync(src); return [...own.cssRules].map((rule) => ({ name: rule.name, syntax: rule.syntax, inherits: rule.inherits, selector: rule.selectorText })); })(),
      };
    }, [numericNames, css]);
    const registrations = contract.rules.filter((r) => r.syntax);
    const contractOK = compare(contract.child, reference(frameSet, frameOld)).error <= limit
      && compare(contract.nested, reference(frameSet, 0.7)).error <= limit
      && contract.childStages.every((c) => Number(new Color(c).alpha) === 0)
      && contract.childNumbers.every((n) => n === '0' || n === '0%')
      && Number(new Color(contract.background).alpha) === 0 && contract.image === 'none' && contract.animations === 0
      && registrations.length === expectedRegisters.length
      && expectedRegisters.every(([name, syntax, inherits]) =>
        registrations.some((r) => r.name === name && r.syntax === syntax && r.inherits === inherits))
      && contract.rules.filter((r) => r.selector).length === 1;
    failed ||= !contractOK;
    console.log(`${name} ${resultWord(contractOK)} contract: inherited output, isolated stages, nested inputs, no paint/animation, fixed 10 color + ${numericNames.length} numeric + 1 percentage registers + 1 rule`);
    if (!contractOK) console.log(`  contract details: ${JSON.stringify(contract)}`);

    const image = PNG.sync.read(await page.screenshot({ caret: 'initial' }));
    const pixelResults = pixels.map((c, i) => ({ ...comparePixel(pixelAt(image, 20 + i * 28, pixelY + 12), c.expected), label: c.label }));
    pixelResults.push({ ...comparePixel(pixelAt(image, 20, frameY + 12), reference(frameSet, frameOld)), label: 'frame initial' });
    const badPixels = pixelResults.filter((r) => r.error > limit);
    failed ||= badPixels.length > 0;
    console.log(`${name} ${resultWord(!badPixels.length)} pixels ${pixelResults.length - badPixels.length}/${pixelResults.length}; worst=${Math.max(...pixelResults.map((r) => r.error))}/255`);
    for (const r of badPixels) console.log(`  FAIL pixel ${r.label}: got ${r.rgb}, want ${r.want}`);

    // No computed-style read between mutation and the next rAF. The screenshot
    // is requested as soon as that next callback resolves, without extra waits.
    // This is a next-rAF screenshot test, not a compositor presentation trace.
    const frames = await page.evaluate((t) => new Promise((resolve) => {
      requestAnimationFrame((changedAt) => {
        document.querySelector('.scale-frame').style.setProperty('--gamut-t', String(t));
        requestAnimationFrame((nextAt) => resolve({ changedAt, nextAt }));
      });
    }), frameNew);
    const nextImage = PNG.sync.read(await page.screenshot({ caret: 'initial' }));
    const frameResult = comparePixel(pixelAt(nextImage, 20, frameY + 12), reference(frameSet, frameNew));
    const childAfter = await page.evaluate(() => getComputedStyle(document.querySelector('.scale-child')).getPropertyValue('--gamut-out').trim());
    const frameOK = frameResult.error <= limit && compare(childAfter, reference(frameSet, frameNew)).error <= limit;
    failed ||= !frameOK;
    console.log(`${name} ${resultWord(frameOK)} next-rAF pixel: got ${frameResult.rgb}, want ${frameResult.want}; callback gap=${ms(frames.nextAt - frames.changedAt)} ms; inherited output updated`);

    // Same page, fresh document, the sheet linked at load. Only these 256 scales
    // participate in the timing. Unique t values prevent identical style sharing.
    const release = await benchLock('scale.mjs');
    const cost = await measureCost(page, `${origin}/cost`);
    release();
    failed ||= !cost.ok;
    console.log(`${name} ${resultWord(cost.ok)} cost: 256 distinct five-stop scales, 5/5 batches; median style+256 reads=${ms(cost.median)} ms; samples=[${cost.durations.map(ms).join(', ')}]; clean reads=${ms(cost.cleanRead)} ms`);
    console.log(`${name} ${resultWord(!failed)} overall`);
  } finally {
    await browser.close();
  }
  return failed;
}

const engines = pick();
if (selected.some((name) => !engines.some(([engine]) => engine === name))) throw new Error('Usage: node test/scale-check.mjs [Chrome|WebKit|Firefox]');
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const isCSS = url.pathname === '/scale.css';
  response.setHeader('Content-Type', isCSS ? 'text/css' : 'text/html');
  response.end(isCSS ? sheetText : url.pathname === '/cost' ? costHTML : mainHTML);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
console.log(`Color.js ${colorPackage.version}; tolerance <=1/255/channel; ${variants.length} stop-set/space combinations; ${Buffer.byteLength(css)} CSS bytes`);
let failed = false;
try {
  for (const [name, type, options] of engines) {
    if (selected.length && !selected.includes(name)) continue;
    try {
      failed = await checkEngine(name, type, options, origin) || failed;
    } catch (error) {
      failed = true;
      console.error(`${name} FAIL exception: ${error.stack}`);
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
process.exitCode = failed ? 1 : 0;
