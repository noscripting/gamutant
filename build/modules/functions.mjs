// The function forms: chained() writes a search's steps as one @function a step (the text would double a halving
// written as one expression), asFunction() reads a part's class rules as the sheet ships them and writes its
// @function, so a class and its function compute the same thing.
import { createRequire } from 'node:module';
import { registered } from './common.mjs';

// The function's steps as a chain of functions. A function's locals substitute as text, and each search step names the
// one before it twice, so as locals the text doubled every halving (8 halvings: 763 KB of CSS and 26 ms a call in Chrome
// 155, 14 of them parsing). A typed argument arrives as a computed value, so a step that is its own function, called with
// the step before as an argument, is computed once, as the class's registered properties are (20 steps deep: 0.1 ms).
// Each step is its own function: Chrome 155 gives the invalid color for a function nested in a call to itself.
export function chained(mf, text = [], out = '--gamut--step-out', pre = '--gamut--step-') {
  const names = ['--gamut-in', '--gamut--src', '--gamut--lin', ...text, ...mf.decls.map((d) => d.split(':')[0])];
  const uses = (t) => names.filter((n) => new RegExp(`var\\(${n}[,)]`).test(t));
  // the input stays text, as the class reads it: a typed <color> holds a legacy rgb() in bytes; so do
  // constants written as text (`text`)
  const param = (n) => (['--gamut--lin', '--gamut-in', ...text].includes(n) ? n : `${n} <color>`);
  const call = (fn, t) => `${fn}(${uses(t).map((n) => `var(${n})`).join(', ')})`;
  const fns = [], decls = [];
  const step = (fn, e) => fns.push(`@function ${fn}(${uses(e).map(param).join(', ')}) returns <color> { result: ${e}; }`);
  for (const d of mf.decls) {
    const [, n, e] = d.match(/^(--[\w-]+):\s*([\s\S]*);$/), fn = n.replace('--gamut--', pre);
    step(fn, e); decls.push(`${n}: ${call(fn, e)};`);
  }
  step(out, mf.out);
  return { fns, decls, out: call(out, mf.out) };
}

// A class as a CSS function (css-mixins-1 §2), from the rules an element with only that class matches. Each registered
// property becomes a function of the registered properties its value names, typed as registered, so it is computed
// once, as the class computes it (chained() above says why); a var() of one passes its initial value where it is
// invalid, as a registered property takes it. An unregistered property set once is written into its readers, as var()
// substitutes it in the class; one set under conditions stays a local. An input no argument sets is a local `initial`,
// so the function never reads the caller's own. @supports and @media blocks stay as they are; a @container style()
// query becomes an if() of the argument `container` names.
export function asFunction(css, { cls, args, out = '--gamut-out', locals = [], container = {}, hoist = false, drop = [], pre = '' }) {
  const postcss = createRequire(import.meta.url)('postcss');
  const root = postcss.parse(css), short = `--gamut--${cls}-`;
  const reg = new Map(); // a registered property's syntax and initial value
  root.walkAtRules('property', (r) => { const d = {}; r.walkDecls((x) => { d[x.prop] = x.value; }); reg.set(r.params.trim(), { type: d.syntax.replace(/['"]/g, ''), initial: d['initial-value'] }); });
  const decls = [];
  root.walkRules((rule) => {
    if (!rule.selectors.some((s) => s.trim() === `.${cls}`)) return;
    const ctx = [], cont = [];
    for (let p = rule.parent; p.type !== 'root'; p = p.parent) {
      if (p.type !== 'atrule' || !['supports', 'media', 'container'].includes(p.name)) throw Error(`${cls}: a rule in ${p.type} ${p.name ?? ''}`);
      if (p.name === 'container') cont.unshift(p.params); else ctx.unshift(`@${p.name} ${p.params}`);
    }
    // a rule queried on a flag the function computes as a local of its own (drop)
    if (cont.some((c) => drop.some((x) => c.includes(`(${x}:`)))) return;
    rule.each((d) => { if (d.type === 'decl') decls.push({ prop: d.prop, value: d.value, ctx, cont }); });
  });
  if (!decls.some((d) => d.prop === out)) throw Error(`${cls}: no ${out}`);
  const set = new Map(); for (const d of decls) set.set(d.prop, [...(set.get(d.prop) ?? []), d]);
  // (one read with a fallback stays a local, so the fallback applies where it is invalid: .color-mix's pairs)
  const inline = new Map([...set].filter(([p, ds]) => p !== out && !reg.has(p) && ds.length === 1 && !ds[0].ctx.length && !ds[0].cont.length && !new RegExp(`var\\(${p},`).test(css)).map(([p, [d]]) => [p, d.value]));
  const refs = (t) => [...new Set([...t.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))];
  const text = (t) => t.replace(/var\((--[\w-]+)\)/g, (m, p) => (inline.has(p) ? text(inline.get(p)) : m));
  const params = args.map((a) => { const [, p, def = 'initial', none] = a.match(/^(--[\w-]+)(?:: (.+?))?( none)?$/); return { p, def, none, arg: `--gamut--arg-${p.slice(8)}` }; });
  const head = params.map((x) => (x.none ? `${x.arg}: none` : `${x.p}: ${x.def}`));
  const body = [...params.filter((x) => x.none).map((x) => `${x.p}: if(style(${x.arg}: none): initial; else: var(${x.arg}));`), ...locals];
  const given = new Set([...params.map((x) => x.p), ...locals.map((l) => l.slice(0, l.indexOf(':')))]);
  for (const p of new Set(decls.flatMap((d) => refs(d.value)))) if (!set.has(p) && !given.has(p)) body.push(`${p}: initial;`);
  const fns = [], seen = new Map();
  const call = (p, v) => {
    const deps = refs(v).filter((d) => reg.has(d) && d !== out), k = seen.get(p) ?? 0, fn = `${short}${p.replace(/^--gamut--?/, '')}${k ? `-${k}` : ''}`;
    seen.set(p, k + 1);
    fns.push(`@function ${fn}(${deps.map((d) => `${d} ${reg.get(d).type}`).join(', ')}) returns ${reg.get(p).type} { result: ${v}; }`);
    return `${fn}(${deps.map((d) => `var(${d}, ${reg.get(d).initial})`).join(', ')})`;
  };
  const wrap = (ctx, line) => ctx.reduceRight((t, c) => `${c} { ${t} }`, line);
  const query = (c) => { const m = c.match(/^style\((--[\w-]+): ([\w-]+)\)$/); if (!m || !container[m[1]]) throw Error(`${cls}: @container ${c}`); return `style(${container[m[1]]}: ${m[2]})`; };
  // the gamut constants (OK_SETS): locals as the classes set them, under the same @container queries (a function body
  // takes them, queried on the element's ancestors as the class's are: Chrome 155), the text the classes' rules hold
  const consts = [...set].filter(([p]) => /^--gamut--oc\d+$/.test(p) && !inline.has(p));
  for (const c of new Set(consts.flatMap(([, ds]) => ds.map((d) => d.cont.join(' and '))))) {
    const line = consts.flatMap(([p, ds]) => ds.filter((d) => d.cont.join(' and ') === c && !d.ctx.length).map((d) => `${p}: ${d.value};`)).join(' ');
    body.push(c ? `@container ${c} { ${line} }` : line);
  }
  for (const [p, ds] of set) {
    if (inline.has(p) || consts.some(([q]) => q === p)) continue;
    // a value written as text (the result, a local) reads a registered step with its initial value as fallback, as
    // the class reads it where the step is invalid (an input that isn't a number: --gamut-okhsv(260, 90%, 0.8))
    const held = (t) => t.replace(/var\((--[\w-]+)\)/g, (m, q) => (reg.has(q) && q !== out ? `var(${q}, ${reg.get(q).initial})` : m));
    // a property registered as '*' (no initial value) is a local, so a var() of it can fall back where it is invalid
    const step = reg.has(p) && reg.get(p).type !== '*' && p !== out, prop = p === out ? 'result' : p, value = (d) => (step ? call(p, text(d.value)) : held(text(d.value)));
    if (step && ds.every((d) => d.ctx.length || d.cont.length)) body.push(`${p}: initial;`);
    const plain = ds.filter((d) => !d.cont.length), queried = ds.filter((d) => d.cont.length);
    // hoist: the result's queried values each a function of their own and its one plain value in the else, so the
    // branch not taken is a call, not its text (Chrome 155 works through an untaken branch's text: color-mix's 19 kB
    // paint branch cost 272 µs a call against 177, as a call 185, 2026-10-27)
    const lift = hoist && p === out && queried.length && plain.length === 1 && !plain[0].ctx.length;
    const base = queried.length ? `${short}base-${p.replace(/^--gamut--?/, '')}` : prop;
    if (!lift) for (const d of plain) body.push(wrap(d.ctx, `${base}: ${value(d)};`));
    if (!queried.length) continue;
    if (new Set(queried.map((d) => d.ctx.join())).size > 1) throw Error(`${cls}: ${p} queried in more than one context`);
    const branch = (d, i) => { if (!lift) return value(d); fns.push(`@function ${short}${prop}-${i}() { result: ${value(d)}; }`); return `${short}${prop}-${i}()`; };
    // (with no plain rule, no else: no branch leaves it guaranteed-invalid, as unset in the class, and a var()'s fallback applies)
    body.push(wrap(queried[0].ctx, `${prop}: if(${[...queried].reverse().map((d, i) => `${d.cont.map(query).join(' and ')}: ${branch(d, i)}`).join('; ')}${plain.length ? `; else: ${lift ? value(plain[0]) : `var(${base})`}` : ''});`));
  }
  return `${pre ? `${pre}\n` : ''}${fns.join('\n')}\n@function --gamut-${cls}(${head.join(', ')}) returns ${reg.get(out)?.type ?? '<color>'} {\n  ${body.join('\n  ')}\n}`;
}
