// The build against the files it wrote: gamutant.css, each parts/<part>.css and test/data/functions.json built again in
// memory from build.mjs and parts.mjs, compared byte for byte with the files as committed. A change to a part, a constant
// or a folding pass that moves one byte of the published CSS fails here, before any engine runs; `npm run build`
// writes the files again. No browser.
// Exits 1 on a fail. Usage: node test/build-check.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { shipped, FUNCTIONS } from '../build/build.mjs';
import { parts } from '../build/parts.mjs';

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

for (const b of bad) console.log(`FAIL ${b}`);
console.log(`${bad.length ? 'FAIL' : 'PASS'} the build writes gamutant.css (${css.length.toLocaleString('en')} bytes), ${names.length} part files and functions.json as committed${bad.length ? `: ${bad.length} differ; npm run build writes them again` : ''} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(bad.length ? 1 : 0);
