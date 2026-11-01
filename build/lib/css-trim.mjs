// One page trimmer for every library (2026-10-23): a sheet cut to what one page can use. Two halves, each the better of
// the two trimmers the lab had:
// - which rules: nada's (trimNada): a rule stays when its selector, widened, matches an element
//   of the page (css-select on the page's own tree). The page never changes, only its state does, so a state
//   pseudo-class (or one css-select does not know) may hold and is dropped, a :not() holding one goes whole, attributes
//   the browser or a shim write after load (open, role, tabindex, aria-*, data-store-press, data-n-js, data-list-empty)
//   may hold too, :defined means "not a custom tag", pseudo-elements are dropped, :nth-*(… of S) is tested as :is(S), a
//   chain past 8 combinators is tested by its last compound, :host / ::part / ::slotted and a selector css-select cannot
//   compile are kept;
//   a kept rule keeps only the selectors of its list that match (beasties');
// - what they need: css-deps.mjs's: the definitions and providers of every name the kept rules, the page and its other
//   sheets read (an @property a @keyframes animates, a font family, a counter style, a @function and every function it
//   calls), @import, and a shared rule's custom properties trimmed to the ones read.
//   trim(sheet, html, { other, runtime, graph }) -> { css, ids }
//   node build/lib/css-trim.mjs <sheet.css> <page.html> [--other a.css ...] [--out cut.css]   the cut's size, raw and gzipped
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { parseDocument } from 'htmlparser2';
import { selectOne, compile } from 'css-select';
import selectorParser from 'postcss-selector-parser';
import { graph, namesOf } from './css-deps.mjs';

const LOGICAL = new Set([':is', ':where', ':has', ':matches', ':not']);
const STRUCTURAL = new Set([':root', ':first-child', ':last-child', ':only-child', ':first-of-type', ':last-of-type', ':only-of-type', ':empty', ':nth-child', ':nth-last-child', ':nth-of-type', ':nth-last-of-type', ':lang', ':defined']);   // trimNada's, :scope a state
const OLD_ELEMENTS = new Set([':before', ':after', ':first-line', ':first-letter']);
const MARK = 'data-trim-custom', LONG = 8;
export const RUNTIME = /^(aria-.*|role|tabindex|open|data-store-press|data-n-js|data-list-empty)$/i;
const isState = (p) => { const n = p.value.toLowerCase(); return !n.startsWith('::') && !OLD_ELEMENTS.has(n) && !LOGICAL.has(n) && !STRUCTURAL.has(n); };
const ofForm = (p) => /^:nth-/.test(p.value) && /\bof\b/.test(String(p));
const asIs = (p) => { const first = p.nodes[0], k = first ? first.nodes.findIndex((n) => n.type === 'tag' && n.value.toLowerCase() === 'of') : -1;
  if (k < 0) { p.remove(); return; } first.nodes.slice(0, k + 1 + (first.nodes[k + 1]?.type === 'combinator' ? 1 : 0)).forEach((n) => n.remove()); p.value = ':is'; };
export const widener = (runtime) => selectorParser((root) => {
  const pseudos = []; root.walkPseudos((p) => { pseudos.push(p); });
  const isRuntime = (a) => a.type === 'attribute' && runtime.test(a.attribute);
  const dropNot = new Set(pseudos.filter((p) => p.value.toLowerCase() === ':not' && (() => { let s = false; p.walk((q) => { if ((q.type === 'pseudo' && (isState(q) || ofForm(q))) || isRuntime(q)) s = true; }); return s; })()));
  const rt = []; root.walkAttributes((a) => { if (isRuntime(a)) rt.push(a); }); rt.forEach((a) => a.remove());
  for (const p of pseudos.reverse()) { if (!p.parent) continue; const name = p.value.toLowerCase();
    if (name === ':not') { if (dropNot.has(p)) p.remove(); }
    else if (name === ':defined') p.replaceWith(selectorParser.pseudo({ value: ':not', nodes: [selectorParser.selector({ nodes: [selectorParser.attribute({ attribute: MARK })] })] }));
    else if (name.startsWith('::') || OLD_ELEMENTS.has(name)) p.remove();
    else if (LOGICAL.has(name)) {}
    else if (STRUCTURAL.has(name)) { if (ofForm(p)) asIs(p); }
    else p.remove(); }
  root.walk((n) => { if (n.type !== 'selector' || n.nodes.filter((x) => x.type === 'combinator').length <= LONG) return;
    for (let up = n.parent; up; up = up.parent) if (up.type === 'pseudo' && up.value.toLowerCase() === ':not') { if (up.parent) up.remove(); return; }
    let k = n.nodes.length - 1; while (k >= 0 && n.nodes[k].type !== 'combinator') k--; n.nodes.slice(0, k + 1).forEach((x) => x.remove()); });
  root.walk((n) => { if (n.type === 'selector' && (n.nodes.length === 0 || n.last?.type === 'combinator')) n.append(selectorParser.universal()); });
  // a combinator with nothing before it gets a *, except where it opens a :has() argument: :has(+ .x) is relative to the
  // element itself, and :has(*+ .x) would ask for a descendant instead, which never matches the sibling (2026-10-27)
  root.walk((n) => { if (n.type === 'combinator') { const prev = n.prev(), up = n.parent?.parent;
    const relative = !prev && up?.type === 'pseudo' && up.value.toLowerCase() === ':has';
    if (!relative && (!prev || prev.type === 'combinator')) n.parent.insertBefore(n, selectorParser.universal()); } });
});

// other: the text of the page's other stylesheets, which may read this sheet's names (layoutit's app.css draws in
// nada-app.css's nada-letters counter style). Without it nothing about them is known, so every definition and every
// shared custom property stays (trimNada's choice); with it ('' for none) they are cut to what is read.
export function trim(sheet, html, { other, runtime = RUNTIME, graph: g } = {}) {
  const unknown = other === undefined; other ??= '';
  // a page with no <body> tag has one in the browser (the parser makes it): htmlparser2 makes none, so body would match nothing
  const G = g ?? graph(sheet), widen = widener(runtime), full = !/<html[\s>]/i.test(html) ? `<html><body>${html}</body></html>` : /<body[\s>]/i.test(html) ? html : html.replace(/<html[^>]*>/i, '$&<body>');
  const dom = parseDocument(full.replace(/<([a-z][a-z0-9]*-[a-z0-9-]*)(?=[\s>/])/g, `<$1 ${MARK}`), { lowerCaseAttributeNames: false });
  const memo = new Map(), matches = (sel) => { if (memo.has(sel)) return memo.get(sel); let ok;
    if (/:host\b|::part\(|::slotted\(/i.test(sel)) ok = true;
    else try { const w = widen.processSync(sel).trim() || '*'; compile(w); ok = !!selectOne(w, dom); } catch { ok = true; }
    memo.set(sel, ok); return ok; };
  const seed = G.nodes.filter((x) => x.kind === 'rule' && matches(x.n.selector)).map((x) => x.id);
  const text = `${html}\n${other}`, words = new Set(text.match(/[\w-]+/g) ?? []);
  const defs = G.nodes.filter((x) => x.kind !== 'rule' && x.kind !== '@property').map((x) => x.defines[0].split(':').slice(1).join(':')).filter((k) => k && (unknown || words.has(k)));
  const regs = unknown ? G.nodes.filter((x) => x.kind === '@property').map((x) => x.defines[0]) : [];
  // a rule that provides a name is taken only when it matches the page too (trimNada's rule: 639 KB to ... over nada's 77)
  const s = G.slice([], { seed, names: [...namesOf(text), ...defs, ...regs], accept: (x) => matches(x.n.selector) });
  // and each kept rule's selector list cut to the selectors that match, as beasties does for trimNada (nada's rules
  // list many components' selectors; a nested rule's & keeps its parent's list whole)
  const selectors = new Map();
  for (const id of s.ids) { const x = G.nodes[id]; if (x.kind !== 'rule' || x.n.nodes?.some((c) => c.type === 'rule') || x.n.parent?.type === 'rule') continue;
    const list = x.n.selectors; if (list.length < 2) continue; const keep = list.filter((sel) => matches(sel));
    if (keep.length && keep.length < list.length) selectors.set(id, keep.join(',\n')); }
  return { ...s, css: G.sheetOf(s.ids, s.names, selectors, { keepCustom: unknown }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [sheetPath, pagePath, ...rest] = process.argv.slice(2), out = rest[rest.indexOf('--out') + 1];
  const others = rest.filter((x, i) => rest[i - 1] === '--other').map((f) => readFileSync(f, 'utf8')).join('\n');
  const sheet = readFileSync(sheetPath, 'utf8'), { css } = trim(sheet, readFileSync(pagePath, 'utf8'), rest.includes('--other') ? { other: others } : {}), kb = (b) => `${(b / 1024).toFixed(1)} KB`;
  console.log(`${pagePath}: ${kb(css.length)} of ${kb(sheet.length)}, gzipped ${kb(gzipSync(css, { level: 9 }).length)} of ${kb(gzipSync(sheet, { level: 9 }).length)}`);
  if (rest.includes('--out')) writeFileSync(out, css);
}
