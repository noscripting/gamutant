// fold: a stylesheet unfolded into rules and expressions, rewritten, folded back. Each pass keeps every output the same.
// Pass nest: a registered color read once is written inside its reader. Pass share: an expression a rule writes more than
// once is written once. (A pass that registered each repeated flag, faster, was dropped for share on 2026-10-24: 58
// registrations fewer and a smaller sheet.)
//   import { nest, share } from './fold.mjs'
import { readFileSync, writeFileSync } from 'node:fs';

// the sheet as top-level pieces, braces matched, comments and strings skipped
export function pieces(css) {
  const out = []; let i = 0;
  while (i < css.length) {
    if (/\s/.test(css[i])) { let j = i; while (j < css.length && /\s/.test(css[j])) j++; out.push({ kind: 'ws', text: css.slice(i, j) }); i = j; continue; }
    if (css.startsWith('/*', i)) { const j = css.indexOf('*/', i + 2) + 2; out.push({ kind: 'comment', text: css.slice(i, j) }); i = j; continue; }
    let j = i, depth = 0, q = null;
    for (; j < css.length; j++) { const ch = css[j]; if (q) { if (ch === q && css[j - 1] !== '\\') q = null; continue; }
      if (ch === '"' || ch === "'") q = ch; else if (css.startsWith('/*', j)) j = css.indexOf('*/', j + 2) + 1;
      else if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) { j++; break; } } else if (ch === ';' && depth === 0) { j++; break; } }
    out.push({ kind: 'rule', text: css.slice(i, j) }); i = j;
  }
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) { const [i, o] = process.argv.slice(2); const n = nest(readFileSync(i, 'utf8')), r = share(n.css); writeFileSync(o, r.css); console.log(`${n.report}; ${r.report}`); }
// Pass nest: a registered, non-inherited <color> declared once and read once in the whole sheet, by a later declaration of
// the same rule, is written inside its reader, a relative color nested in it: worked out once there with no
// registration, and its 32-bit floats reach the reader whole (through var() a registered color arrives at 6 digits).
//   nest(css, sheet) -> { css, report }   (sheet: the whole stylesheet the counts are taken over; css by default)
export function nest(css, sheet = css) {
  const props = new Map([...sheet.matchAll(/@property (--[\w-]+) \{ syntax: '<color>'; inherits: false;[^}]*\}\n?/g)].map((m) => [m[1], m[0]]));
  const count = (t, s) => t.split(s).length - 1;
  const P = pieces(css), gone = new Set();
  for (const p of P) {
    if (p.kind !== 'rule' || p.text.trimStart().startsWith('@')) continue;
    for (let changed = true; changed;) {
      changed = false;
      for (const m of p.text.matchAll(/(?<=^|[{;])\s*(--[\w-]+): ([^;]*);/g)) {
        const [, name, value] = m, ref = `var(${name})`;
        if (!props.has(name) || gone.has(name) || count(sheet, ref) !== 1 || count(p.text, ref) !== 1 || count(sheet, `${name}:`) !== 1) continue;
        const at = p.text.indexOf(`${name}: ${value};`);
        if (p.text.indexOf(ref) < at) continue;
        p.text = p.text.replace(new RegExp(`\\n?\\s*${name.replace(/-/g, '\\-')}: [^;]*;`), '').replace(ref, value);
        sheet = sheet.replace(ref, value).replace(`${name}:`, ''); gone.add(name); changed = true; break;
      }
    }
  }
  const out = P.map((p) => (p.kind === 'rule' && p.text.startsWith('@property') && gone.has(p.text.match(/@property (--[\w-]+)/)?.[1]) ? '' : p.text)).join('');
  return { css: out.replace(/\n{3,}/g, '\n\n'), report: `${gone.size} registered colors nested in their one reader` };
}
// Pass share: an expression a rule writes more than once is written once, as an unregistered property of that rule the
// others read by var(): the same tokens come back where it is read (worked out there, as before), so every output is
// the same; the rule's own declaration is the one its elements see, so inheritance never reaches it.
//   share(css, { prefix, minLength }) -> { css, report }
export function share(css, { prefix = '', minLength = 40 } = {}) {
  let n = 0, saved = 0;
  // a group: a parenthesized expression or a function call, whole
  const groups = (body) => { const out = new Map();
    for (let i = 0; i < body.length; i++) { if (body[i] !== '(') continue;
      let st = i; while (st > 0 && /[\w-]/.test(body[st - 1])) st--;
      let d = 0, j = i; for (; j < body.length; j++) { if (body[j] === '(') d++; else if (body[j] === ')' && !--d) break; }
      const g = body.slice(st, j + 1); if (g.length >= minLength && !/[;{}]/.test(g) && (!g.startsWith('var(') || g.includes(','))) out.set(g, (out.get(g) ?? 0) + 1); }
    return out; };
  const rule = (text) => {
    const open = text.indexOf('{'), head = text.slice(0, open + 1); let body = text.slice(open + 1, text.lastIndexOf('}'));
    const added = [];
    for (;;) {
      const name = () => `--_s-${prefix}${n.toString(36)}`, cost = (g, k) => (k - 1) * g.length - (name().length + 4 + k * (name().length + 5));
      const best = [...groups(body)].map(([g]) => [g, body.split(g).length - 1]).filter(([g, k]) => k > 1 && cost(g, k) > 0).sort((a, b) => cost(b[0], b[1]) - cost(a[0], a[1]))[0];
      if (!best) break;
      const v = name(); n++; saved += cost(...best); body = body.split(best[0]).join(`var(${v})`); added.push(`${v}: ${best[0]};`);
    }
    return added.length ? `${head}\n  ${added.join('\n  ')}${body}}` : text;
  };
  const walk = (src) => pieces(src).map((p) => {
    if (p.kind !== 'rule' || p.text.startsWith('@property')) return p.text;
    if (p.text.trimStart().startsWith('@')) { const o = p.text.indexOf('{'), c = p.text.lastIndexOf('}'); return o < 0 ? p.text : `${p.text.slice(0, o + 1)}${walk(p.text.slice(o + 1, c))}}`; }
    return p.text.includes('{') ? rule(p.text) : p.text;
  }).join('');
  const out = walk(css);
  return { css: out, report: `${n} expressions written once, ${saved} bytes` };
}
// Pass across: an expression written in two or more rules is written once, as an unregistered property declared on every
// element those rules select (one rule of their selectors, at the end); each rule reads it by var(). The rules select
// different elements, so each element works it out once, as before; the text that comes back is the same.
//   across(css, { prefix, minLength }) -> { css, report }   (before share: share's names belong to one rule)
export function across(css, { prefix = '', minLength = 60 } = {}) {
  const P = pieces(css), rules = [];
  const collect = (list) => list.forEach((p) => {
    if (p.kind !== 'rule' || p.text.startsWith('@property')) return;
    const o = p.text.indexOf('{'); if (o < 0) return;
    if (p.text.trimStart().startsWith('@')) { const inner = pieces(p.text.slice(o + 1, p.text.lastIndexOf('}'))); p.inner = inner; collect(inner); return; }
    rules.push(p);
  });
  collect(P);
  const head = (p) => p.text.slice(0, p.text.indexOf('{')).trim(), body = (p) => p.text.slice(p.text.indexOf('{') + 1);
  const groupsOf = (t) => { const out = new Set();
    for (let i = 0; i < t.length; i++) { if (t[i] !== '(') continue; let st = i; while (st > 0 && /[\w-]/.test(t[st - 1])) st--;
      let d = 0, j = i; for (; j < t.length; j++) { if (t[j] === '(') d++; else if (t[j] === ')' && !--d) break; }
      const g = t.slice(st, j + 1); if (g.length >= minLength && !/[;{}]/.test(g) && (!g.startsWith('var(') || g.includes(','))) out.add(g); }
    return out; };
  const shared = new Map(); let n = 0, saved = 0;
  for (;;) {
    const where = new Map();
    for (const r of rules) for (const g of groupsOf(body(r))) { if (!where.has(g)) where.set(g, []); where.get(g).push(r); }
    const gain = ([g, rs]) => { const k = rs.reduce((t, r) => t + body(r).split(g).length - 1, 0), name = `--_x-${prefix}${n.toString(36)}`;
      return (k - 1) * g.length - k * (name.length + 5) - (name.length + 4) - [...new Set(rs.map(head))].join(', ').length - 4; };
    const best = [...where].filter(([, rs]) => rs.length > 1).map((x) => [x, gain(x)]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0];
    if (!best) break;
    const [[g, rs], v] = best, name = `--_x-${prefix}${(n++).toString(36)}`; saved += v;
    for (const r of rs) r.text = `${r.text.slice(0, r.text.indexOf('{') + 1)}${body(r).split(g).join(`var(${name})`)}`;
    const sel = [...new Set(rs.map(head))].join(', ');
    if (!shared.has(sel)) shared.set(sel, []); shared.get(sel).push(`${name}: ${g};`);
  }
  const emit = (list) => list.map((p) => (p.inner ? `${p.text.slice(0, p.text.indexOf('{') + 1)}${emit(p.inner)}}` : p.text)).join('');
  const out = emit(P) + [...shared].map(([sel, d]) => `\n${sel} {\n  ${d.join('\n  ')}\n}`).join('');
  return { css: out, report: `${n} expressions written once across rules, ${saved} bytes` };
}
