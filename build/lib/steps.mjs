// the step graph: a pass over build.mjs's own expressions: a part declares its steps (named expressions over var()s and other
// steps) and its outputs (by class); it works out, from who reads each step how often, whether it is kept (worked
// out once in its own declarations, read by var()) or text (written out where it is read), and on which classes each
// kept step's rule applies (those whose outputs reach it). A step interpolated into a template literal is a token, so the
// part writes its expressions as it always did; so is var(prefix + name) of any step.
//   const g = steps({ prefix: '--_cx-', keep, sel }); const a = g.step('a', `...`); g.out('srgb', ['--color-srgb-r'], [`${a} * 2`]);
//   g.emit() -> { rules: [css...], report }
// keep(name, expr) returns a kept step's declarations (the step's value as var(prefix + name)); sel(cls) a class's selector;
// out(cls, names, exprs, raw) writes raw outputs as they are (a color), others in calc(). With weigh(expr), the bytes a
// kept step's declarations and registrations take, it decides by the sheet's size; without, by time:
// The cost of an evaluation: 0.5 µs an operation and 0.02 µs a byte (a calc() operation 0.42 / 0.57 µs, Chrome's re-parse
// 0.035 µs a byte, as measured). KEPT, the default, keeps a number exactly: four evaluations (its text written once), four registers
// (1.25 µs each) and a decode of 4 µs a read, exact, so a kept step and its text give the same double. REGISTERED is one
// registered <number>: one evaluation and one register, read at 6 significant digits.
export const KEPT = { evals: 4, regs: 4, read: 4, writes: 1 }, REGISTERED = { evals: 1, regs: 1, read: 0 };
// by bytes in place of time: a kept step costs its declarations and registrations (weigh(expr) bytes) and a var() a
// read; text costs the expression each time it is written
const TOKEN = /\u0001(\d+)\u0002/g, OPS = /[a-z0-9-]+\(| [-+*/] /g, REG = 1.25;
const cost = (t) => (t.match(OPS)?.length ?? 0) * 0.5 + t.length * 0.02;
// text that is one group already (a parenthesized whole or a function call) needs no parentheses round it
const whole = (t) => { if (!/^[a-z0-9-]*\(/.test(t) || !t.endsWith(')')) return /^[\w.-]+$/.test(t); let d = 0;
  for (let i = t.indexOf('('); i < t.length; i++) { if (t[i] === '(') d++; else if (t[i] === ')' && !--d) return i === t.length - 1; } return false; };
export function steps({ prefix, keep, sel, as = KEPT, weigh, storage = {} }) {
  const all = [], outs = [], named = new Map(), esc = prefix.replace(/[-]/g, '\\-');
  const refs = (t) => String(t).replace(new RegExp(`var\\(${esc}([\\w-]+)\\)`, 'g'), (m, x) => (named.has(x) ? `${named.get(x)}` : m));
  const step = (name, expr) => { const s = { name, expr: String(expr), id: all.length, toString: () => `\u0001${s.id}\u0002` }; all.push(s); named.set(name, s); return s; };
  const out = (cls, names, exprs, raw = false) => outs.push({ cls, names, exprs: exprs.map(String), raw });
  const uses = (t) => [...t.matchAll(TOKEN)].map((m) => all[+m[1]]);
  function emit() {
    for (const [name, mode] of Object.entries(storage))
      if (!named.has(name) || !['keep', 'inline'].includes(mode)) throw Error(`invalid storage policy for ${name}`);
    // var()s of steps read as the steps, then the steps in an order where each comes after what it reads
    for (const x of [...all, ...outs]) if (x.exprs) x.exprs = x.exprs.map(refs); else x.expr = refs(x.expr);
    const order = [], seen = new Set(), visit = (s) => { if (seen.has(s)) return; seen.add(s); uses(s.expr).forEach(visit); order.push(s); };
    all.forEach(visit);
    const classes = outs.map((o) => o.cls), reads = new Map(all.map((s) => [s, Object.fromEntries(classes.map((c) => [c, 0]))]));
    for (const o of outs) for (const e of o.exprs) for (const u of uses(e)) reads.get(u)[o.cls]++;
    // consumers first: each step's readers are decided when it is
    const kept = new Set(), plain = (t) => t.replace(TOKEN, (_, i) => `var(${prefix}${all[+i].name})`), times = new Map();
    const written = (s) => times.get(s) ?? 0;
    for (const o of outs) for (const e of o.exprs) for (const u of uses(e)) times.set(u, written(u) + 1);
    for (const s of [...order].reverse()) {
      const r = reads.get(s), on = classes.filter((c) => r[c]), c1 = cost(plain(s.expr));
      const asText = on.reduce((t, c) => t + r[c] * c1, 0), asKept = on.reduce((t, c) => t + as.evals * c1 + as.regs * REG + r[c] * as.read, 0);
      // by bytes: how often the step is written as text over the whole sheet (once a class it reaches, each time a reader's text is)
      const k = on.length > 0 && (storage[s.name] === 'keep' || storage[s.name] !== 'inline' && (weigh ? weigh(plain(s.expr)) + written(s) * (prefix.length + s.name.length + 5) < written(s) * plain(s.expr).length : asKept < asText));
      if (k) kept.add(s);
      for (const u of uses(s.expr)) { for (const c of on) reads.get(u)[c] += k ? as.evals : r[c]; times.set(u, written(u) + (k ? as.writes ?? as.evals : written(s))); }
    }
    const text = (t) => t.replace(TOKEN, (_, i) => { const s = all[+i]; if (kept.has(s)) return `var(${prefix}${s.name})`; const x = text(s.expr); return whole(x) ? x : `(${x})`; });
    // kept steps in their order, one rule for each run of steps on the same classes
    const rules = [];
    for (const s of order.filter((x) => kept.has(x))) {
      const on = classes.filter((c) => reads.get(s)[c]), head = on.map(sel).join(', '), last = rules.at(-1);
      if (last?.head === head) last.body.push(keep(s.name, text(s.expr))); else rules.push({ head, body: [keep(s.name, text(s.expr))] });
    }
    const css = [...rules.map((r) => `${r.head} {\n  ${r.body.join('\n  ')}\n}`),
      ...outs.map((o) => `${sel(o.cls)} {\n  ${o.names.map((n, i) => { const t = text(o.exprs[i]); return `${n}: ${o.raw || /^var\([^()]*\)$/.test(t) ? t : `calc(${t})`};`; }).join('\n  ')}\n}`)];
    return { rules: css, report: `${kept.size} of ${all.length} steps kept: ${[...kept].map((s) => s.name).join(' ')}; text: ${all.filter((s) => !kept.has(s)).map((s) => s.name).join(' ')}` };
  }
  return { step, out, emit };
}
