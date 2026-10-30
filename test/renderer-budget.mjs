// Optional, event-driven RSS snapshots for bounded experimental correctness runs.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const reports = new Map();
export function batchSize() {
  if (process.env.GATE_BATCH === undefined) return 0;
  const n = +process.env.GATE_BATCH;
  if (!Number.isInteger(n) || n < 1) throw Error('GATE_BATCH must be a positive integer');
  return n;
}
export async function rendererBudget(browser, engine) {
  const limit = +(process.env.GATE_RSS_MIB ?? 0), file = process.env.GATE_REPORT;
  if (!Number.isFinite(limit) || limit < 0) throw Error('GATE_RSS_MIB must be a finite nonnegative number');
  if (file && !reports.has(file)) reports.set(file, []);
  const rows = file ? reports.get(file) : [];
  if (!limit) return async () => {};
  if (!batchSize() || engine !== 'Chrome') throw Error('GATE_RSS_MIB requires GATE_BATCH and Chrome');
  const cdp = await browser.newBrowserCDPSession();
  return async details => {
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
    const sizes = new Map(execFileSync('ps', ['-p', processInfo.map(x => x.id).join(','), '-o', 'pid=,rss='], { encoding: 'utf8' }).trim().split('\n').map(s => s.trim().split(/\s+/).map(Number)));
    const renderers = processInfo.filter(x => x.type === 'renderer');
    if (!renderers.length || renderers.some(x => !sizes.has(x.id))) throw Error('Owned renderer RSS is unavailable');
    const maxRendererMiB = Math.max(...renderers.map(x => sizes.get(x.id) / 1024));
    rows.push({ engine, ...details, maxRendererMiB });
    if (process.env.GATE_REPORT) writeFileSync(process.env.GATE_REPORT, JSON.stringify(rows, null, 2) + '\n');
    if (maxRendererMiB > limit) throw Error(`Renderer RSS ${maxRendererMiB.toFixed(1)} MiB exceeds ${limit} MiB; stopping precision batches`);
  };
}

// The ends check's existing fixture contains i elements under gamut hosts.
// Detach and batch those inputs, preserving their exact attributes and parent
// styles, without reparsing the experimental stylesheet for every input.
export async function readFixture(browser, page, engine, html, read) {
  const batch = batchSize();
  if (!batch) { await page.setContent(html, { timeout: 180000 }); return page.evaluate(read); }
  const at = html.indexOf('<body>');
  if (at < 0) throw Error('Bounded color fixture requires an explicit body');
  await page.setContent(html.slice(0, at) + '<body></body>', { timeout: 180000 });
  const rows = await page.evaluate(markup => {
    const template = document.createElement('template'); template.innerHTML = markup;
    return [...template.content.querySelectorAll('i')].map(el => {
      const host = document.createElement('div'); host.style.cssText = el.parentElement.style.cssText;
      host.append(el.cloneNode(true)); return host.outerHTML;
    });
  }, html.slice(at + 6));
  const budget = await rendererBudget(browser, engine), result = [];
  for (let first = 0; first < rows.length; first += batch) {
    await page.evaluate(markup => { document.body.innerHTML = markup; }, rows.slice(first, first + batch).join(''));
    result.push(...await page.evaluate(read));
    await budget({ first, count: Math.min(batch, rows.length - first) });
  }
  return result;
}
