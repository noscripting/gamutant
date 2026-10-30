// A number kept as unround.css keeps it (../../unround/unround.css): a power of two e and three whole parts under 2^19,
// each registered (each prints exactly in every engine), and the number itself as unregistered text that adds them up,
// so it reaches var() as the double calc() worked out instead of the engine's 6-digit print. The modules' every carried
// number goes through keep(); a check reads it back with kept() from its four parts.
export const reg = (n, inherits = false) => `@property ${n} { syntax: '<number>'; inherits: ${inherits}; initial-value: 0; }`;
// keep('--x', 'expr') → { props: the four parts' @property rules, decls: the parts and --x }
export function keep(name, expr) {
  const p = `${name}-`;
  return {
    props: ['e', 'a', 'b', 'c'].map((k) => reg(p + k)),
    decls: [`${p}e: round(down, log(max(abs(${expr}), 1e-290), 2));`,
      `${p}a: round(to-zero, ${expr} * pow(2, 17 - var(${p}e)));`,
      `${p}b: round(to-zero, rem(${expr} * pow(2, 17 - var(${p}e)), 1) * 524288);`,
      `${p}c: calc(rem(${expr} * pow(2, 36 - var(${p}e)), 1) * 524288);`,
      `${name}: calc((var(${p}a) + var(${p}b) / 524288 + var(${p}c) / 274877906944) * pow(2, var(${p}e) - 17));`],
  };
}
// the same sum in a page, from a computed style: pass KEPT as a string and build it there with new Function
export const KEPT = `return (s, n) => { const g = (k) => +s.getPropertyValue(n + '-' + k); return (g('a') + g('b') / 524288 + g('c') / 274877906944) * 2 ** (g('e') - 17); }`;
