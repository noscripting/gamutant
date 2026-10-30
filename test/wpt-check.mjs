// Writes test/wpt/ with test/wpt.mjs (the folder is build output, not tracked), then runs it as reftests, the way WPT's runner does: each test and its reference (the
// filled green square) screenshot at 800 x 600 in Chrome, WebKit and Firefox, and compared pixel for pixel; a test
// passes when no pixel differs.
// Usage: node test/wpt-check.mjs [folder=test/wpt]
import { readdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { pw, need, pick } from './engines.mjs';
const { PNG } = need('pngjs');
const here = path.dirname(fileURLToPath(import.meta.url));
// the reftests written again from the sheet, where wpt.mjs is (the source repository's run; a copy of the repo runs them as they are)
if (!process.argv[2] && existsSync(path.join(here, 'wpt.mjs'))) execFileSync(process.execPath, [path.join(here, 'wpt.mjs')], { stdio: 'ignore' });
const WPT = path.resolve(process.argv[2] ?? path.join(here, 'wpt'));
const base = `${pathToFileURL(WPT)}/`; // local files: the shared server has hung under WebKit
const files = readdirSync(WPT).filter((f) => f.endsWith('.html') && !f.startsWith('ref-') && f !== 'index.html').sort();
let failed = false;
for (const [name, type, opts] of pick()) {
  const b = await pw[type].launch({ ...opts, headless: true }), p = await b.newPage({ viewport: { width: 800, height: 600 } });
  const shot = async (f) => { await p.goto(base + f); return PNG.sync.read(await p.screenshot()); };
  const ref = await shot('ref-filled-green-100px-square.html');
  const bad = [];
  for (const f of files) {
    const img = await shot(f); let diff = 0, max = 0;
    for (let i = 0; i < img.data.length; i += 4) { const d = Math.max(...[0, 1, 2].map((k) => Math.abs(img.data[i + k] - ref.data[i + k]))); if (d) { diff++; max = Math.max(max, d); } }
    if (diff) bad.push(`${f} (${diff} pixels, up to ${max})`);
  }
  // a control: the first test with its check made invalid must not match (an assertion that doesn't compute fails)
  const control = path.join(WPT, 'control-invalid.html');
  writeFileSync(control, readFileSync(path.join(WPT, files[0]), 'utf8').replace('</style>', '.sq { --ok: var(--gamut-no-such-property) !important; }\n</style>'));
  const img = await shot('control-invalid.html'); rmSync(control);
  const caught = img.data.some((v, i) => i % 4 < 3 && v !== ref.data[i]);
  failed ||= bad.length > 0 || !caught;
  console.log(`${name}: ${files.length - bad.length} of ${files.length} reftests match the green square${bad.length ? `; fail: ${bad.slice(0, 10).join(', ')}` : ''}; a test whose check doesn't compute ${caught ? 'fails, as it should' : 'PASSES: FAIL'}`);
  await b.close();
}
process.exit(failed ? 1 : 0);
