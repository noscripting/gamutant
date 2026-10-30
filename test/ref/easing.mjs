// CSS Easing's functions evaluated at an input progress t: Level 1's keywords (§2.1, §3.1, as their cubic-bezier()
// values), cubic-bezier() (§3.1, x(s) = t solved by bisection) and steps() (§4.1, the before flag unset), and Level 2's
// linear() function.
// easing('ease-in')(0.5); used by test/gradient-ease-check.mjs.
export const KEYWORDS = { linear: [0, 0, 1, 1], ease: [0.25, 0.1, 0.25, 1], 'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1] };
const bez = (a, b) => (s) => 3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s * s * b + s ** 3;
export const cubic = ([x1, y1, x2, y2]) => (t) => { const X = bez(x1, x2), Y = bez(y1, y2); let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (X(m) < t) lo = m; else hi = m; } return Y((lo + hi) / 2); };
const steps = (n, pos = 'jump-end') => (t) => { let s = Math.floor(t * n); if (pos === 'jump-start' || pos === 'start' || pos === 'jump-both') s++;
  const jumps = { 'jump-both': n + 1, 'jump-none': n - 1 }[pos] ?? n; if (t >= 0 && s < 0) s = 0; if (t <= 1 && s > jumps) s = jumps; return s / jumps; };
const linearFn = (args) => { const pts = []; for (const a of args) { const [v, ...p] = a.trim().split(/\s+/);
    if (!p.length) pts.push([+v, null]); else p.forEach((q) => pts.push([+v, parseFloat(q) / 100])); }
  if (pts[0][1] === null) pts[0][1] = 0; if (pts.at(-1)[1] === null) pts.at(-1)[1] = 1;
  for (let i = 1; i < pts.length; i++) if (pts[i][1] !== null) pts[i][1] = Math.max(pts[i][1], pts[i - 1][1]);
  for (let i = 1; i < pts.length; i++) if (pts[i][1] === null) { let j = i; while (pts[j][1] === null) j++;
    for (let k = i; k < j; k++) pts[k][1] = pts[i - 1][1] + ((pts[j][1] - pts[i - 1][1]) * (k - i + 1)) / (j - i + 1); }
  return (t) => { let i = pts.findLastIndex(([, x]) => x <= t); if (i < 0) i = 0; if (i >= pts.length - 1) i = pts.length - 2;
    const [[v0, x0], [v1, x1]] = [pts[i], pts[i + 1]]; return x1 === x0 ? v1 : v0 + ((v1 - v0) * (t - x0)) / (x1 - x0); }; };
export const easing = (e) => { e = e.trim(); if (KEYWORDS[e]) return cubic(KEYWORDS[e]);
  const m = /^([\w-]+)\((.*)\)$/.exec(e), args = m[2].split(',').map((x) => x.trim());
  if (m[1] === 'cubic-bezier') return cubic(args.map(Number));
  if (m[1] === 'steps') return steps(+args[0], args[1]);
  if (m[1] === 'linear') return linearFn(args);
  throw new Error(e); };

