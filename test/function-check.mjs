// Checks --gamut-fit-screen(), .gamut-fit-screen as one CSS function: in an engine that parses @function, the same color as the
// class (within 1e-4 a channel: the same 11 halvings, each step its own function) for 200 oklch() colors and 100 rgb()
// colors with fractional channels to each of the five gamuts given as the argument, and to the gamut --gamut-target
// gives when there is no argument, alpha included; where @function doesn't parse, the rule is dropped and a
// declaration written before the call keeps its color. And every --gamut-method to every gamut it takes, from the
// element, at 72 hues (every 5 degrees), 4 lightnesses and 2 chromas, the same within 1e-4. Chrome, WebKit and Firefox.
// Usage: node test/function-check.mjs   (SHEET= for another sheet)
// Optional: GATE_BATCH=1 GATE_RSS_MIB=512 GATE_REPORT=memory.json (RSS requires Chrome).
import { readFileSync } from 'node:fs';
import { pick, open } from './engines.mjs';
import { batchSize, rendererBudget } from './renderer-budget.mjs';
const batch = batchSize();
const sheet = readFileSync(process.env.SHEET ?? new URL('../gamutant.css', import.meta.url), 'utf8');
let seed = 5; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const colors = [...Array.from({ length: 200 }, (_, i) => `oklch(${(0.02 + 0.96 * rnd()).toFixed(4)} ${(0.4 * rnd()).toFixed(4)} ${(360 * rnd()).toFixed(2)}${i % 10 ? '' : ` / ${rnd().toFixed(2)}`})`),
  ...Array.from({ length: 100 }, (_, i) => `rgb(${(255 * rnd()).toFixed(1)} ${(255 * rnd()).toFixed(1)} ${(255 * rnd()).toFixed(1)}${i % 10 ? '' : ` / ${rnd().toFixed(2)}`})`)];
const byTarget = [...colors.slice(0, 25), ...colors.slice(200, 225)];
const G = ['srgb', 'display-p3', 'rec2020', 'a98-rgb', 'prophoto-rgb'];
const pair = (c, call) => `<i style="background: ${call}"></i><i class="gamut-fit-screen" style="--gamut-in: ${c}; background: var(--gamut-out)"></i>`;
const html = `<style>${sheet}\ni{display:block;width:2px;height:2px}</style>
${G.map((g) => `<div style="--gamut-target: ${g}">${colors.map((c) => pair(c, `--gamut-fit-screen(${c}, ${g})`)).join('')}</div>`).join('\n')}
${G.map((g) => `<div style="--gamut-target: ${g}">${byTarget.map((c) => pair(c, `--gamut-fit-screen(${c})`)).join('')}</div>`).join('\n')}
<b id="fallback" style="background: rgb(1 2 3); background: --gamut-fit-screen(oklch(0.7 0.3 150))"></b>`;
const parse = (v) => { const m = v.match(/^color\(([\w-]+) ([^)]*)\)/); if (!m) return [v]; const [rgb, a = '1'] = m[2].split('/'); return [m[1], ...rgb.trim().split(/\s+/).map(Number), +a]; };
let fail = 0;
for (const e of pick()) {
  const { browser, page } = await open(e);
  try {
  const budget = await rendererBudget(browser, e[0]);
  await page.setContent(batch ? `<style>${sheet}\ni{display:block;width:2px;height:2px}</style><div id=cases></div><b id=fallback style="background:rgb(1 2 3);background:--gamut-fit-screen(oklch(.7 .3 150))"></b>` : html, { timeout: 120000 });
  const r = await page.evaluate(() => {
    const fn = [...document.styleSheets[0].cssRules].some(function has(x) { return x.constructor.name === 'CSSFunctionRule' || [...(x.cssRules ?? [])].some(has); });
    return { fn, v: [...document.querySelectorAll('i')].map((x) => getComputedStyle(x).backgroundColor), fallback: getComputedStyle(document.getElementById('fallback')).backgroundColor };
  });
  if (!r.fn) {
    const ok = r.fallback === 'rgb(1, 2, 3)';
    if (!ok) fail++;
    console.log(`${e[0]}: ${ok ? 'PRECONDITION_FAILED' : 'FAIL'}: @function doesn't parse; the declaration before the call keeps ${r.fallback}`);
    continue;
  }
  if (batch) {
    r.v = [];
    const list = G.flatMap(g => colors.map(c => ({g,c,call:`--gamut-fit-screen(${c}, ${g})`}))).concat(G.flatMap(g => byTarget.map(c => ({g,c,call:`--gamut-fit-screen(${c})`}))));
    for (let first = 0; first < list.length; first += batch) {
      const markup = list.slice(first, first + batch).map(({g,c,call}) => `<div style="--gamut-target:${g}">${pair(c,call)}</div>`).join('');
      r.v.push(...await page.evaluate(markup => { document.getElementById('cases').innerHTML = markup; return [...document.querySelectorAll('i')].map(x => getComputedStyle(x).backgroundColor); }, markup));
      await budget({first,count:Math.min(batch,list.length-first)});
    }
  }
  let same = 0, worst = 0; const bad = [];
  for (let i = 0; i < r.v.length; i += 2) {
    const a = parse(r.v[i]), b = parse(r.v[i + 1]);
    const d = a.length < 4 || a[0] !== b[0] || a.length !== b.length ? Infinity : Math.max(...a.slice(1).map((x, j) => Math.abs(x - b[j + 1])));
    if (d <= 1e-4) same++; else bad.push(`${r.v[i]} | ${r.v[i + 1]}`); worst = Math.max(worst, d);
  }
  const n = r.v.length / 2;
  if (same < n) fail++;
  // each method's copy in the function against the class's: random colors missed a change to one copy that a sweep
  // of hues finds (mutation testing, 2026-10-29: adaptive to prophoto-rgb moved 0.064 at 216deg, edge-seeker to rec2020
  // 2.6e-4 at 165deg)
  if (!batch) {
    const M = ['css', 'ray-trace', 'edge-seeker', 'adaptive'].flatMap((m) => G.filter((g) => !(m === 'edge-seeker' && g === 'prophoto-rgb')).map((g) => [m, g]));
    const sweep = []; for (let h = 0; h < 360; h += 5) for (const l of [0.3, 0.55, 0.75, 0.92]) for (const c of [0.25, 0.6]) sweep.push(`oklch(${l} ${c} ${h})`);
    await page.setContent(`<style>${sheet}\ni{display:block;width:2px;height:2px}</style>${M.map(([m, g]) => `<div style="--gamut-target: ${g}; --gamut-method: ${m}">${sweep.map((c) => pair(c, `--gamut-fit-screen(${c})`)).join('')}</div>`).join('')}`, { timeout: 300000 });
    const v = await page.evaluate(() => [...document.querySelectorAll('i')].map((x) => getComputedStyle(x).backgroundColor));
    const off = []; let w = 0;
    for (let i = 0; i < v.length; i += 2) { const a = parse(v[i]), b = parse(v[i + 1]), d = a[0] !== b[0] || a.length !== b.length ? Infinity : Math.max(...a.slice(1).map((x, j) => Math.abs(x - b[j + 1])));
      w = Math.max(w, d); if (!(d <= 1e-4)) { const k = i / 2, [m, g] = M[Math.floor(k / sweep.length)]; off.push(`${m} to ${g}, ${sweep[k % sweep.length]}: ${v[i]} | ${v[i + 1]}`); } }
    if (off.length) fail++;
    console.log(`${e[0]}: ${off.length ? 'FAIL' : 'PASS'}: --gamut-fit-screen() is .gamut-fit-screen within 1e-4 a channel, every method to every gamut, in ${v.length / 2 - off.length} of ${v.length / 2} (${sweep.length} colors x ${M.length}; worst ${w.toExponential(1)})${off.length ? `; off: ${off.slice(0, 3).join(' / ')}` : ''}`);
  }
  console.log(`${e[0]}: ${same === n ? 'PASS' : 'FAIL'}: --gamut-fit-screen() is .gamut-fit-screen within 1e-4 a channel in ${same} of ${n} (300 colors to 5 gamuts by argument, 100 of them rgb(), 50 to 5 by --gamut-target; worst ${worst.toExponential(1)})${bad.length ? `\n  ${bad.slice(0, 5).join('\n  ')}` : ''}`);
  } finally { await browser.close(); }
}
process.exit(fail ? 1 : 0);
