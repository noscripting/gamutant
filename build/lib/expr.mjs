// Expressions the machine computes, written once and emitted twice: as CSS calc() text for the engines, and as JS for
// the model (run.mjs), which runs the same steps in node. Both compute in doubles, so the model is what the CSS computes
// where the engines follow calc()'s maths (ENGINES.md: doubles in Chrome and WebKit).
//   n(5), r('L0h'), add(a, b, ...), sub(a, b), mul(a, b, ...), div(a, b), floor(a), mod(a, b) (a >= 0, b > 0), min,
//   max, clamp(lo, x, hi), sign(a), abs(a), round(a) (to nearest, a half up, as CSS and Math.round), pow2(k)
//   css(e, ref) -> text, ref(name) the CSS for a register;  js(e, ref) -> JS source, ref(name) the JS for a register
//   op(css, js, ...a): an operation with no kind of its own, its CSS and its JS each a function of the operands' text
//   and the emitter's context c (css(e, ref, c), js(e, ref, c)); with c.memo (a WeakMap) a node emitted again reuses
//   its text
// Constants fold as they are built, and x + 0, x * 1, x * 0 drop out, so a gate that is known stays out of the text.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 noscript.ing contributors
const N = (v) => ({ k: 'n', v }), isN = (e, v) => e.k === 'n' && (v === undefined || e.v === v);
export const n = (v) => N(v);
export const r = (name) => ({ k: 'r', name });
// a place in the program whose PC is known only once the steps are laid out: { pc } or { alias: another label }
export const lab = (l) => ({ k: 'L', l });
export const pcOf = (l) => { while (l.alias) l = l.alias; if (l.pc === undefined || l.pc === null) throw Error('a label with no step'); return l.pc; };
const fold = (k, a, f) => (a.every((x) => isN(x)) ? N(f(...a.map((x) => x.v))) : { k, a });
export const add = (...a) => { a = a.flatMap((x) => (x.k === '+' ? x.a : [x])); const c = a.filter((x) => isN(x)).reduce((t, x) => t + x.v, 0), rest = a.filter((x) => !isN(x));
  if (!rest.length) return N(c); if (c) rest.push(N(c)); return rest.length === 1 ? rest[0] : { k: '+', a: rest }; };
// a + b and a · b as IEEE doubles compute them, in this order: never flattened into another sum or product, never
// regrouped, and folded only when both are numbers ((A1 + 0.1) + 0.2 stays that, not A1 + 0.3; Dekker's product)
export const fadd = (a, b) => (isN(a) && isN(b) ? N(a.v + b.v) : { k: 'f+', a: [a, b] });
export const fmul = (a, b) => (isN(a) && isN(b) ? N(a.v * b.v) : { k: 'f*', a: [a, b] });
// Ordered products/sum by default. Existing compilers may keep their own scalar
// construction policy (including rounding and compatibility printing).
export function dot(a, b, { sum = terms => terms.reduce(fadd), mul: product = fmul } = {}) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length)
    throw Error('dot: nonempty vectors of equal length required');
  return sum(a.map((value, i) => product(value, b[i])));
}
export const sub = (a, b) => (isN(b, 0) ? a : isN(a) && isN(b) ? N(a.v - b.v) : { k: '-', a: [a, b] });
export const mul = (...a) => { a = a.flatMap((x) => (x.k === '*' ? x.a : [x])); if (a.some((x) => isN(x, 0))) return N(0);
  const c = a.filter((x) => isN(x)).reduce((t, x) => t * x.v, 1), rest = a.filter((x) => !isN(x));
  if (!rest.length) return N(c); if (c !== 1) rest.unshift(N(c)); return rest.length === 1 ? rest[0] : { k: '*', a: rest }; };
export const div = (a, b) => (isN(b, 1) ? a : fold('/', [a, b], (x, y) => x / y));
export const floor = (a) => (a.k === 'floor' || isN(a) && Number.isInteger(a.v) ? a : fold('floor', [a], Math.floor));
export const mod = (a, b) => fold('mod', [a, b], (x, y) => x - y * Math.floor(x / y));
export const min = (...a) => fold('min', a, Math.min), max = (...a) => fold('max', a, Math.max);
export const clamp = (lo, x, hi) => fold('clamp', [lo, x, hi], (l, v, h) => Math.max(l, Math.min(v, h)));
export const sign = (a) => fold('sign', [a], Math.sign), abs = (a) => fold('abs', [a], Math.abs);
export const round = (a) => (isN(a) && Number.isInteger(a.v) ? a : fold('round', [a], Math.round));
export const pow2 = (k) => fold('pow2', [k], (x) => 2 ** x);
// 1 when a whole number x is 0, else 0; 1 when x >= 1 (x whole), else 0; and the boolean ops on 0 / 1
export const isZero = (x) => sub(n(1), min(n(1), abs(x))), pos = (x) => clamp(n(0), x, n(1)), not = (b) => sub(n(1), b);
export const op = (css, js, ...a) => ({ k: 'x', css, js, a });
const x = (e, f, c, form) => { const m = c?.memo; if (m?.has(e)) return m.get(e); const t = e[form](e.a.map(f), c); m?.set(e, t); return t; };
export const pick = (b, x, y) => (isN(b, 1) ? x : isN(b, 0) ? y : add(mul(b, x), mul(not(b), y))); // b ? x : y, b 0 or 1
const OPS = { '+': ' + ', '-': ' - ', '*': ' * ', '/': ' / ', 'f+': ' + ', 'f*': ' * ' };
const num = (v) => (Object.is(v, -0) ? '0' : String(v));
// a constant as CSS: Chrome caps a number literal at 3.4e38, so one past 1e38 (or under 1e-37)
// is m · 2^k, both exact, and an infinity is CSS's (number.mjs's numCss, for constants a fold makes)
const cnum = (v) => { const a = Math.abs(v); if (!Number.isFinite(v)) return v > 0 ? 'infinity' : '-1 * infinity';
  if (a === 0 || (a < 1e38 && a > 1e-37)) return num(v); const k = Math.max(-1074, Math.floor(Math.log2(a)) - 52); return `${v / 2 ** k} * pow(2, ${k})`; };
export function css(e, ref, c) {
  const f = (e) => { switch (e.k) {
    case 'x': return x(e, f, c, 'css');
    case 'n': { const t = cnum(e.v); return e.v < 0 || t !== num(e.v) ? `(${t})` : t; }
    case 'L': return num(pcOf(e.l));
    case 'r': return ref(e.name);
    case '+': case '*': case '/': case 'f+': case 'f*': return `(${e.a.map(f).join(OPS[e.k])})`;
    case '-': return `(${f(e.a[0])} - ${f(e.a[1])})`;
    case 'floor': return `round(down, ${f(e.a[0])})`;
    case 'pow2': return `pow(2, ${f(e.a[0])})`;
    default: return `${e.k}(${e.a.map(f).join(', ')})`; } };
  return f(e);
}
export function js(e, ref, c) {
  const f = (e) => { switch (e.k) {
    case 'x': return x(e, f, c, 'js');
    case 'n': return `(${num(e.v)})`;
    case 'L': return `(${pcOf(e.l)})`;
    case 'r': return ref(e.name);
    case '+': case '*': case '/': case 'f+': case 'f*': return `(${e.a.map(f).join(OPS[e.k])})`;
    case '-': return `(${f(e.a[0])} - ${f(e.a[1])})`;
    case 'floor': return `Math.floor(${f(e.a[0])})`;
    case 'mod': { const [a, b] = e.a.map(f); return `M(${a}, ${b})`; }
    case 'clamp': { const [l, x, h] = e.a.map(f); return `Math.max(${l}, Math.min(${x}, ${h}))`; }
    case 'pow2': return `(2 ** ${f(e.a[0])})`;
    default: return `Math.${e.k}(${e.a.map(f).join(', ')})`; } };
  return f(e);
}
export const M = (x, y) => x - y * Math.floor(x / y); // CSS mod() for a whole x and y > 0
// the registers an expression reads, and an expression with registers replaced (fusing steps)
export const regs = (e, out = new Set()) => { if (e.k === 'r') out.add(e.name); else for (const x of e.a ?? []) regs(x, out); return out; };
export const subst = (e, f) => (e.k === 'r' ? f(e.name) ?? e : !e.a ? e : { ...e, a: e.a.map((x) => subst(x, f)) });
export const size = (e) => (!e.a ? 1 : e.a.reduce((t, x) => t + size(x), 1));
