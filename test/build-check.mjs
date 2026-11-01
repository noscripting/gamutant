// The build against the files it wrote: gamutant.css, each parts/<part>.css and test/data/functions.json built again in
// memory from build.mjs and parts.mjs, compared byte for byte with the files as committed. A change to a part, a constant
// or a folding pass that moves one byte of the published CSS fails here, before any engine runs; `npm run build`
// writes the files again. Then the registry (registry.mjs) against the sheet: every class the sheet defines belongs to
// one part, every part's file and checks exist. No browser.
// Exits 1 on a fail. Usage: node test/build-check.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { shipped, FUNCTIONS } from '../build/build.mjs';
import { parts, PARTS } from '../build/parts.mjs';
import { REGISTRY } from '../build/registry.mjs';

const at = (f) => new URL(`../${f}`, import.meta.url);
const t0 = Date.now(), bad = [];
const same = (file, built) => { const was = readFileSync(at(file), 'utf8'); if (was === built) return;
  let i = 0; while (i < was.length && was[i] === built[i]) i++;
  bad.push(`${file}: ${built.length - was.length >= 0 ? '+' : ''}${built.length - was.length} bytes, first difference at byte ${i}: ${JSON.stringify(was.slice(i, i + 40))} built as ${JSON.stringify(built.slice(i, i + 40))}`); };

const css = shipped();
same('gamutant.css', css);
const files = parts(css), names = Object.keys(files);
for (const p of names) same(`parts/${p}.css`, files[p]);
const extra = readdirSync(at('parts')).filter((f) => f.endsWith('.css') && !names.includes(f.slice(0, -4)));
if (extra.length) bad.push(`parts/: ${extra.join(', ')} not written by the build`);
same('test/data/functions.json', JSON.stringify(FUNCTIONS.map(({ cls, args, out, container, number }) => ({ cls, args, out, container, number })), null, 1) + '\n');

const classes = new Set([...css.matchAll(/\.gamut-([a-z0-9-]+)/g)].map((m) => m[1])), owned = new Set(Object.entries(PARTS).flat(2));
const loose = [...classes].filter((c) => !owned.has(c));
if (loose.length) bad.push(`registry.mjs: ${loose.map((c) => `.gamut-${c}`).join(', ')} in no part's row`);
for (const { part, file, checks = [] } of REGISTRY) {
  if (!classes.has(part)) bad.push(`registry.mjs: ${part} has no .gamut-${part} in the sheet`);
  for (const f of [new URL(file, new URL('../build/registry.mjs', import.meta.url)), ...checks.map((c) => new URL(c, import.meta.url))]) { try { readFileSync(f); } catch { bad.push(`registry.mjs: ${part}'s ${f.pathname.split('/').slice(-2).join('/')} is missing`); } } }

for (const b of bad) console.log(`FAIL ${b}`);
console.log(`${bad.length ? 'FAIL' : 'PASS'} the build writes gamutant.css (${css.length.toLocaleString('en')} bytes), ${names.length} part files and functions.json as committed, ${REGISTRY.length} parts in the registry${bad.length ? `: ${bad.length} differ; npm run build writes them again` : ''} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(bad.length ? 1 : 0);
