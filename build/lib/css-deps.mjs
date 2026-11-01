// A stylesheet's dependency graph: every style rule and every definition (@property, @font-face, @keyframes,
// @counter-style, @function) a node; the edges are names, a custom property one rule sets and another reads (var(), a
// style query), an @property, an anchor name, a font family, a keyframes or counter-style name, a function another
// calls. Only what css-trim.mjs reads: graph() and namesOf().
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

// the graph of one sheet's text: its nodes, and slice / sheetOf / ranges over them
export function graph(src, from = 'sheet.css') {
  const root = postcss.parse(src, { from });
const all = (re, s) => [...s.matchAll(re)].map((m) => m[1]);
const DEF = ['property', 'font-face', 'keyframes', 'counter-style', 'position-try', 'function'];

// the nodes, in the sheet's order: a style rule (its at-rule context read with it) or a definition
const nodes = [];
const condReads = (at) => (at.name === 'container' ? all(/style\(\s*(--[\w-]+)/g, at.params) : []);
// a complex selector as the class sequences it can match: compounds of classes and attributes ([data-x]), an :is() or
// :where() one sequence an alternative (its last compound merged into the compound it sits in), :has() a reach from its
// compound to the classes inside it, :not() nothing (capped at 64 sequences a selector)
const ANY = /^:(is|where|matches|-webkit-any)$/;
function seqs(complex) {
  let out = [{ seq: [[]], has: [], tags: [] }];
  complex.each((t) => {
    if (t.type === 'combinator') out.forEach((v) => v.seq.push([]));
    else if (t.type === 'tag') out.forEach((v) => v.tags.push(t.value.toLowerCase()));
    else if (t.type === 'class') out.forEach((v) => v.seq.at(-1).push(t.value));
    else if (t.type === 'attribute' && t.attribute !== 'style') out.forEach((v) => v.seq.at(-1).push(`[${t.attribute}]`));
    else if (t.type === 'pseudo' && ANY.test(t.value)) { const alts = t.nodes.flatMap((x) => seqs(x));
      out = out.flatMap((v) => alts.map((a) => { const head = v.seq.slice(0, -1).map((c) => [...c]), inner = a.seq.map((c) => [...c]), tail = inner.pop();
        return { seq: [...head, ...inner, [...v.seq.at(-1), ...tail]], has: [...v.has, ...a.has], tags: [...v.tags, ...a.tags] }; })).slice(0, 64); }
    else if (t.type === 'pseudo' && t.value === ':has') { const ks = t.nodes.flatMap((x) => seqs(x)).flatMap((a) => a.seq.flat());
      out.forEach((v) => { if (v.seq.at(-1).length && ks.length) v.has.push([[...v.seq.at(-1)], ks]); }); } });
  return out;
}
const inDef = (n) => { for (let p = n.parent; p && p.type !== 'root'; p = p.parent) if (p.type === 'atrule' && DEF.includes(p.name)) return true; return false; };
root.walk((n) => {
  if (inDef(n)) return;   // a definition's own declarations are part of it
  if (n.type === 'atrule' && DEF.includes(n.name)) {
    const name = n.name === 'font-face' ? (n.nodes.find((d) => d.prop === 'font-family')?.value ?? '').replace(/["']/g, '').trim() : n.name === 'function' ? n.params.trim().split('(')[0].trim() : n.params.trim();
    // a @keyframes reads what it animates: a custom property it steps needs its registration to interpolate, and what its values read
    const kf = n.name === 'keyframes' ? [...all(/(--[\w-]+)\s*:/g, n.toString()), ...all(/var\(\s*(--[\w-]+)/g, n.toString())] : [];
    // a @function reads the functions its body calls (gamutant's --gamut-fit-screen() calls 18 step functions); its
    // var()s are its own parameters and locals, so nothing else
    const calls = n.name === 'function' ? all(/(--[\w-]+)\(/g, n.toString()).filter((x) => x !== name).map((x) => `function:${x}`) : [];
    nodes.push({ n, kind: `@${n.name}`, defines: [`${n.name === 'property' ? '' : n.name + ':'}${name}`], classes: [], sets: [], reads: n.name === 'counter-style' ? all(/(?:extends\s+|fallback:\s*)([\w-]+)/g, n.toString()).map((x) => `counter-style:${x}`) : [...kf, ...calls] }); // a counter style reads the one it extends and its fallback
    return; }
  if (n.type !== 'rule') return;
  const ctx = []; for (let p = n.parent; p && p.type !== 'root'; p = p.parent) if (p.type === 'atrule') ctx.push(...condReads(p));
  const sels = [], has = [], tagsets = [];
  selectorParser((sel) => { sel.each((complex) => { for (const v of seqs(complex)) { sels.push(v.seq); has.push(...v.has); tagsets.push(v.tags); } }); }).processSync(n.selector);
  const sets = [], reads = [...ctx], defines = [];
  n.each((d) => { if (d.type !== 'decl') return; const v = d.value;
    if (d.prop.startsWith('--')) sets.push(d.prop);
    reads.push(...all(/var\(\s*(--[\w-]+)/g, v), ...all(/anchor(?:-size)?\(\s*(--[\w-]+)/g, v).map((x) => `anchor:${x}`));
    if (d.prop === 'anchor-name') defines.push(...v.split(',').map((x) => `anchor:${x.trim()}`));
    if (d.prop === 'position-anchor') reads.push(`anchor:${v.trim()}`);
    if (d.prop === 'font-family' || d.prop === 'font') reads.push(...v.split(',').map((x) => `font-face:${x.replace(/["']/g, '').trim().split(/\s+/).at(-1)}`));
    if (/^animation(-name)?$/.test(d.prop)) reads.push(...v.split(/[\s,]+/).map((x) => `keyframes:${x}`));
    if (/^position-try(-fallbacks)?$/.test(d.prop)) reads.push(...all(/(--[\w-]+)/g, v).map((x) => `position-try:${x}`));
    reads.push(...all(/(--[\w-]+)\(/g, v).map((x) => `function:${x}`));
    reads.push(...[...all(/counters?\([^,)]*,\s*(?:"[^"]*",\s*)?([\w-]+)\)/g, v), ...(/^list-style/.test(d.prop) ? v.split(/\s+/) : [])].map((x) => `counter-style:${x}`)); });
  nodes.push({ n, kind: 'rule', sels, has, tagsets, classes: [...new Set(sels.flat(2))], defines, sets, reads }); });
nodes.forEach((x, i) => { x.id = i; x.lines = [x.n.source.start.line, x.n.source.end.line]; x.bytes = x.n.toString().length; });
// a definition's name anywhere in a rule's text is a read of it: an animation name in a custom property's value, a font in a variable
{ const defName = new Map(nodes.filter((x) => x.kind !== 'rule' && x.kind !== '@property').map((x) => [x.defines[0].split(':').slice(1).join(':'), x.defines[0]]).filter(([k]) => k));
  for (const x of nodes) if (x.kind === 'rule') for (const w of new Set(x.n.toString().match(/[\w-]+/g) ?? [])) if (defName.has(w)) x.reads.push(defName.get(w)); }
// a name read that nothing in the sheet defines (a builtin font, an author's custom property) is not an edge
const known = new Set(nodes.flatMap((x) => [...x.defines, ...x.sets]));
nodes.forEach((x) => { x.reads = [...new Set(x.reads)].filter((r) => known.has(r)); });

// what a class reaches through the compounds below it, and whether a rule lies inside a set of classes
// (a compound reaches only when all its classes are in: .a.m and .b.m are two features' modifiers)
const below = new Map(), steps = [];
const step = (comp, ds) => { steps.push([comp, ds]); comp.forEach((k) => { if (!below.has(k)) below.set(k, new Set()); ds.forEach((d) => below.get(k).add(d)); }); };
for (const x of nodes) { for (const c of x.sels ?? []) c.forEach((comp, i) => { const ds = c.slice(i + 1).flat(); if (comp.length && ds.length) step(comp, ds); }); for (const [comp, ds] of x.has ?? []) step(comp, ds); }
const reach = (cls) => { const S = new Set(cls); for (let grew = true; grew;) { grew = false; for (const [comp, ds] of steps) if (comp.every((k) => S.has(k))) for (const d of ds) if (!S.has(d)) { S.add(d); grew = true; } } return S; };
const inside = (x, S) => x.kind === 'rule' && x.classes.length && x.sels.some((c) => { const ks = c.flat(); return ks.length && ks.every((k) => S.has(k)); });

// a slice: the classes' rules, then what they read: definitions, global rules, and (listed, not taken) another
// feature's rules that set or define it
const providers = new Map(); for (const x of nodes) for (const k of [...x.defines, ...x.sets]) { if (!providers.has(k)) providers.set(k, []); providers.get(k).push(x); }
// (the names a page's markup holds, a custom property it sets or reads, an animation it names: their
// registrations and the classless rules that provide them)
// (seed: the rules to start from instead of the classes' own, as css-trim.mjs picks them by the page's elements)
// (accept: whether a provider rule may be taken; a page's cut takes only the ones whose selectors match the page)
function slice(cls, { names = [], seed, accept = () => true } = {}) {
  const S = reach(cls), take = new Set(seed ?? nodes.filter((x) => inside(x, S)).map((x) => x.id)), outside = new Map();
  for (const k of names) for (const p of [...(providers.get(k) ?? []), ...['keyframes', 'counter-style', 'font-face', 'position-try', 'function'].flatMap((t) => providers.get(`${t}:${k}`) ?? [])]) if ((p.kind !== 'rule' || !p.classes.length) && (p.kind !== 'rule' || accept(p))) take.add(p.id);
  const todo = [...take];
  while (todo.length) { const x = nodes[todo.pop()];
    for (const r of [...x.reads, ...x.sets]) { const ps = providers.get(r) ?? [], mine = ps.filter((p) => take.has(p.id));
      for (const p of ps) { if (take.has(p.id)) continue;
        if ((p.kind !== 'rule' || !p.classes.length) && (p.kind !== 'rule' || accept(p))) { take.add(p.id); todo.push(p.id); }
        else if (x.reads.includes(r) && !mine.some((m) => m.defines.includes(r) || m.sets.includes(r))) { if (!outside.has(r)) outside.set(r, new Set()); p.classes.forEach((k) => outside.get(r).add(k)); } } } }
  return { S, ids: [...take].sort((a, b) => a - b), outside, names };
}
const ranges = (ids) => { const out = []; for (const id of ids) { const [a, b] = nodes[id].lines, last = out.at(-1); if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b); else out.push([a, b]); } return out; };
// the cut sheet: the nodes, each in its at-rules; a classless rule keeps its custom properties only where the cut
// reads them (followed through the declarations it keeps: nicon's :root of every icon's paths gives each icon its own)
let readSomewhere = null;
const sheetOf = (ids, names = [], selectors = new Map(), { keepCustom = false } = {}) => { const keep = new Set(ids.map((id) => nodes[id].n)), copy = root.clone(), orig = [], cl = [];
  const vars = (v) => [...v.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]), globalIds = ids.filter((id) => nodes[id].kind === 'rule' && !nodes[id].classes.length);
  // (a node's reads: var() in its values, a style query over it, and, for a definition, what its own text reads)
  const need = new Set([...names, ...ids.filter((id) => !globalIds.includes(id)).flatMap((id) => [...nodes[id].reads, ...vars(nodes[id].n.toString())])]);
  for (let grew = true; grew;) { grew = false; for (const id of globalIds) for (const d of nodes[id].n.nodes) if (d.type === 'decl' && (!d.prop.startsWith('--') || need.has(d.prop))) for (const r of vars(d.value)) if (!need.has(r)) { need.add(r); grew = true; } }
  root.walk((n) => { orig.push(n); }); copy.walk((n) => { cl.push(n); });
  const map = new Map(orig.map((n, i) => [n, cl[i]])), kept = new Set([...keep].map((n) => map.get(n)));
  const keepTree = new Set(); for (const n of kept) { n.walk?.((d) => { keepTree.add(d); }); for (let p = n; p && p.type !== 'root'; p = p.parent) keepTree.add(p); }
  // a custom property no CSS in the sheet reads is an output (one a script reads): it stays; one the
  // sheet reads elsewhere but this cut does not is plumbing and goes
  readSomewhere ??= new Set(nodes.flatMap((x) => [...x.reads, ...vars(x.n.toString())]));
  if (!keepCustom) for (const id of globalIds) for (const d of map.get(nodes[id].n).nodes ?? []) if (d.type === 'decl' && d.prop.startsWith('--') && !need.has(d.prop) && readSomewhere.has(d.prop)) keepTree.delete(d);
  // statements every cut keeps: @import, @charset, @namespace, @layer a, b;
  copy.each((n) => { if (n.type === 'atrule' && (['import', 'charset', 'namespace'].includes(n.name) || (n.name === 'layer' && !n.nodes))) keepTree.add(n); });
  for (const [id, sel] of selectors) { const n = map.get(nodes[id].n); if (n) n.selector = sel; }   // a kept rule's selector list cut to what matched (css-trim)
  copy.walk((n) => { if (!keepTree.has(n) && n.type !== 'comment') n.remove(); });
  copy.walkComments((c) => { c.remove(); });
  return copy.toString().replace(/\n{3,}/g, '\n\n').trim() + '\n'; };
const kb = (b) => `${(b / 1024).toFixed(1)} KB`, total = (ids) => ids.reduce((s, id) => s + nodes[id].bytes, 0);
  return { src, root, nodes, below, slice, sheetOf, ranges, total, kb };
}
// the names a page's text holds (its markup, its other sheets): custom properties and animation names, whose
// definitions a page's cut keeps (css-trim.mjs)
export const namesOf = (html) => [...new Set([...html.matchAll(/--[A-Za-z_][\w-]*/g)].map((m) => m[0]).concat([...html.matchAll(/animation(?:-name)?\s*:\s*([\w-]+)/g)].map((m) => m[1])))];
