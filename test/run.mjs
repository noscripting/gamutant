// The test suite: every check against gamutant.css, each in Chrome for Testing, WebKit and release Firefox (Playwright,
// through test/engines.mjs), four at a time. Prints each check's verdict lines and exits 1 when any check fails.
// Usage: npm test   (or node test/run.mjs [name ...] to run some)
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const CHECKS = [
  ['gate', 'gate-check.mjs', [process.env.SHEET ?? '../gamutant.css', '--oracle', 'css', '--no-time', '--engine', 'all'], '.gamut-fit-screen: 2,855 colors, CSS Color 4 gamut mapping (Color.js 0.7.1)'],
  ['mapper', 'mapper-check.mjs', [], '.gamut-fit-screen and .gamut-screen-edge: WPT\'s 29, random colors, alpha, system colors', { QUICK: '1' }],
  ['fit-screen()', 'function-check.mjs', [], '--gamut-fit-screen(): .gamut-fit-screen as one CSS function, where @function parses'],
  ['functions', 'functions-check.mjs', [], 'every other part\'s function form against its class, where @function parses'],
  ['ends', 'ends-check.mjs', [], '.gamut-fit-screen at lightness 1 and 0 with chroma (CSS Color 4 §14.2.2), and just inside'],
  ['9449', 'issue-9449-check.mjs', [], '.gamut-fit-screen on the colors posted in csswg-drafts #9449, against Color.js'],
  ['currentColor', 'current-color-check.mjs', [], '.gamut-fit-screen and --gamut-fit-screen() on inputs built from currentColor, against Color.js, and their load time'],
  ['ottosson', 'ottosson-check.mjs', [], '.gamut-fit-screen\'s adaptive method to sRGB: Ottosson\'s own code, transcribed'],
  ['adaptive', 'adaptive-check.mjs', [], '.gamut-fit-screen and --gamut-fit-screen() with --gamut-method: adaptive (Ottosson\'s adaptive L0) to all five gamuts, against Color.js'],
  ['targets', 'targets-check.mjs', [], '.gamut-fit-screen and .gamut-screen-edge to rec2020, a98-rgb and prophoto-rgb (CSS Color 4 §14), against Color.js and the edge in doubles'],
  ['mappers', 'mappers-check.mjs', [], '--gamut-method: ray-trace and edge-seeker (Color.js raytrace, the spec\'s EdgeSeeker), and .gamut-screen-edge and .gamut-palette-step to rec2020, a98-rgb and prophoto-rgb'],
  ['drift', 'drift-check.mjs', [], '--gamut-method: how far each method moves the hue and lightness, as README.md says, to all five targets'],
  ['fit-gradient', 'fit-gradient-check.mjs', [], '.gamut-fit-gradient and --gamut-fit-gradient(): 9 OkLCh gradient stops, each mapped, against Color.js'],
  ['gradient-ease', 'gradient-ease-check.mjs', [], '.gamut-fit-gradient with --gamut-gradient-ease: stops at the eased fraction, against CSS Easing 1 and 2 in JS and Color.js'],
  ['gradient-space', 'gradient-space-check.mjs', [], '.gamut-fit-gradient\'s --gamut-gradient-space: the target\'s RGB space, the colors between stops inside the target there'],
  ['material', 'material-check.mjs', [], '.gamut-palette-step: Material 3\'s tonal palette (material-color-utilities 0.4.0), 983 steps'],
  ['mapping-hostile', 'mapping-hostile-check.mjs', [], 'the mapping parts on hostile inputs: currentColor under adaptive, none and powerless hues, grey seeds, hue keywords, huge chroma, --gamut-rel, --gamut-chroma-scale and --gamut-step'],
  ['readable-text', 'contrast-check.mjs', [], '.gamut-readable-text: WCAG 2 in the 8-bit paint'],
  ['readable-from', 'contrast-seed-check.mjs', [], '.gamut-readable-text with --gamut-readable-from and --gamut-readable-to: the search along the range, WCAG 2 in the 8-bit paint'],
  ['readable-wide', 'readable-wide-check.mjs', [], '.gamut-readable-text on a P3 screen: the ratio on the background as painted; on an sRGB screen, the results before the fix'],
  ['recipes', 'recipes-check.mjs', [], 'three recipes from the parts: --gamut-bg as the background color (#5292), semantic color pairs (#11199), a background that animates'],
  ['scale', 'scale-check.mjs', [], '.gamut-color-interpolate: Color.js mix()'],
  ['scale-none', 'scale-none-check.mjs', [], '.gamut-color-interpolate: none against the browser\'s color-mix()'],
  ['stops', 'stops-check.mjs', [], '.gamut-color-interpolate: two positions a stop and fixup against the browser\'s color-mix()'],
  ['hdr-color', 'hdr-color-check.mjs', [], '.gamut-hdr-color against CSS Color HDR §5.1 and its examples'],
  ['contrast-color', 'contrast-color-check.mjs', [], '.gamut-contrast-color: CSS Color 6 §2'],
  ['color-layers', 'layers-check.mjs', [], '.gamut-color-layers: Compositing 1, and the browser\'s own paint'],
  ['contrast-hostile', 'contrast-hostile-check.mjs', [], '.gamut-readable-text, .gamut-contrast-color, .gamut-color-layers: none, transparent, unset slots and ratios that aren\'t numbers'],
  ['okhsl', 'okhsl-check.mjs', [], '.gamut-okhsl: ok_color.h'],
  ['okhsl-from', 'okhsl-from-check.mjs', [], '.gamut-okhsl-from: ok_color.h both ways'],
  ['okhsv', 'okhsv-check.mjs', [], '.gamut-okhsv: ok_color.h\'s okhsv_to_srgb'],
  ['okhsl-coloraide', 'okhsl-coloraide-check.mjs', [], '.gamut-okhsl and .gamut-okhsv under --gamut-target: display-p3: ColorAide with #8659\'s published P3 constants'],
  ['okhsl-gamuts', 'okhsl-gamuts-check.mjs', [], '.gamut-okhsl, .gamut-okhsv, .gamut-okhsl-from and their functions under --gamut-target: display-p3 and rec2020: Ottosson\'s model run numerically for that gamut'],
  ['alpha', 'alpha-check.mjs', [], '.gamut-alpha: CSS Color 5 §4.10 on the spec model'],
  ['color-mix', 'color-mix-check.mjs', [], '.gamut-color-mix: CSS Color 5 §3.3, and Firefox\'s own; .gamut-device-cmyk: §6.1'],
  ['paint', 'paint-check.mjs', [], '.gamut-color-mix.gamut-mix-paint, and its function: spectral.js 3.0.0\'s mix() (#8715)'],
  ['mix-hostile', 'mix-hostile-check.mjs', [], '.gamut-color-mix, .gamut-color-interpolate, .gamut-alpha, .gamut-device-cmyk and their functions: hostile inputs (clamps, invalid percentages) and what the docs say they give'],
  ['rec2100', 'rec2100-check.mjs', [], '.gamut-rec2100-pq, -hlg, -linear: CSS Color HDR\'s sample code'],
  ['hdr-spaces', 'hdr-spaces-check.mjs', [], '.gamut-jzazbz, .gamut-jzczhz, .gamut-ictcp: round trip through CSS Color HDR\'s encoders'],
  ['two backgrounds', 'two-bg-check.mjs', [], 'a recipe for text over two stops: 4.5:1 on both, painted'],
  ['invalid', 'invalid-check.mjs', [], 'an input a part can\'t read: the parent\'s output, transparent, or its default, as SPEC.md\'s FL5 says'],
  ['share', 'share-check.mjs', [], 'two parts on one element: each part\'s outputs as alone, under every target and method; a text part reading --gamut-out on its own element'],
  ['small-parts', 'small-parts-check.mjs', [], '.gamut-light-dark: the element\'s own light-dark(); .gamut-color-equal: CSS Color 4 §12 (#13157) on Color.js; #11533\'s recipe on .gamut-color-extract'],
  ['extract', 'extract-check.mjs', [], '.gamut-color-extract: the engine\'s own x y z, and CSS Color 4\'s conversions'],
  ['constants', 'constants-check.mjs', [], 'the sheet\'s matrices: each row of three products a row of a published matrix (Color.js 0.7.1\'s conversions, OkLab, Jzazbz, ICtCp, Compositing 1) to its digits'],
  ['spaces-hostile', 'spaces-hostile-check.mjs', [], 'the spaces parts on hostile inputs: none hues, alpha 0, angle hues, none and percentages, negative HDR channels'],
  ['tutorial', 'tutorial-check.mjs', [], 'TUTORIAL.md: every color and ratio it states, measured on its final page'],
  ['reftests', 'wpt-check.mjs', [], 'wpt/: every part as a WPT reftest'],
];
const only = process.argv.slice(2), todo = CHECKS.filter(([n]) => !only.length || only.includes(n));
const unknown = only.filter((n) => !CHECKS.some(([c]) => c === n));
if (unknown.length) { console.log(`FAIL no check named ${unknown.join(', ')}: the names are ${CHECKS.map(([n]) => n).join(', ')}`); process.exit(1); }
// a check past LIMIT seconds is stopped with its browsers (its own process group) and run once more: a browser can hang
// under load (paint, 6 s alone, sat 7 minutes in Chrome in a fresh copy's run, 2026-10-30); the slowest check takes 97 s
const LIMIT = +(process.env.LIMIT ?? 300);
const once = ([name, file, args, what, env]) => new Promise((done) => {
  const t0 = Date.now(), p = spawn(process.execPath, [file, ...args], { cwd: here, detached: true, env: { ...process.env, ...(typeof env === 'function' ? env() : env) } });
  let out = '', late = false; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  const timer = setTimeout(() => { late = true; try { process.kill(-p.pid, 'SIGKILL'); } catch {} }, LIMIT * 1000);
  p.on('close', (code) => { clearTimeout(timer); done({ name, what, code: late ? 1 : code, late, out: late ? `${out}\nstopped after ${LIMIT} s` : out, s: (Date.now() - t0) / 1000 }); });
});
const run = async (c) => { const r = await once(c); return r.late ? { ...(await once(c)), retried: true } : r; };
const results = [], queue = [...todo];
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) { const r = await run(queue.shift()); results.push(r);
  // a pass shows its verdict lines; a fail shows its last 60 lines whole, so the reason is there (a check's tallies
  // need not name an engine)
  const lines = r.out.trim().split('\n'), shown = r.code === 0 ? lines.filter((l) => /Chrome|WebKit|Firefox|PASS|FAIL|Error/.test(l)).slice(0, 40) : lines.slice(-60);
  console.log(`${r.code === 0 ? 'PASS' : 'FAIL'} ${r.name} (${r.s.toFixed(0)} s${r.retried ? `, run again after ${LIMIT} s` : ''}): ${r.what}\n${shown.map((l) => `  ${l}`).join('\n')}`); } }));
const failed = results.filter((r) => r.code !== 0);
console.log(`\n${results.length - failed.length} of ${results.length} checks pass${failed.length ? `; failing: ${failed.map((r) => r.name).join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
