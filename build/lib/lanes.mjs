// lanes: a pass over a part whose numbers live three to a color (build.mjs okhslFromPart): each step is a color whose
// channels are expressions over the numbers it gathers ($0, $1, $2). A gather mixes the colors a step reads; a color
// mixed as it is (bare) costs nothing more, since every engine keeps none in a registered color and color-mix() fills a
// channel from the color that has it; one whose other channels are in the way is first cut down to the numbers wanted
// (a relative color). allocate() puts each step's numbers in the channels that let the most gathers mix bare.
//   const { gather, place } = allocate(steps, source, fixed)   (fixed: steps whose channels stay as written)   steps: [[name, [[from, channel], ...], [expr, ...]], ...]
//   gather(name) -> the gathered color's CSS and the channel keyword of each $j; place(name) -> the channel of each output
const KW = ['x', 'y', 'z'];
const perms = (k) => (k === 0 ? [[]] : [0, 1, 2].flatMap((c) => perms(k - 1).filter((p) => !p.includes(c)).map((p) => [c, ...p]))).filter((p) => p.length === k);
export function allocate(P, source, fixed = []) {
  const at = new Map(P.map((p) => [p[0], p])), pos = new Map(P.map(([n, , outs]) => [n, outs.map((_, i) => i)]));
  // a step's gather: the colors it can mix bare (their channels apart, room left for the numbers cut from the rest)
  const plan = ([, ins]) => {
    const from = [...new Set(ins.map(([r]) => r))], bare = [], used = new Set();
    const need = (r) => new Set(ins.filter(([q]) => q === r).map(([, sl]) => sl)).size;
    if (from.length === 1 && from[0] !== 'in') return { bare: from, used: new Set(pos.get(from[0])) };
    for (const r of from.filter((x) => x !== 'in').sort((a, b) => pos.get(a).length - pos.get(b).length)) {
      const ch = pos.get(r); if (ch.some((c) => used.has(c))) continue;
      const rest = from.filter((x) => x !== r && !bare.includes(x)).reduce((t, x) => t + need(x), 0);
      if (3 - used.size - ch.length >= rest) { bare.push(r); ch.forEach((c) => used.add(c)); }
    }
    return { bare, used };
  };
  const score = () => P.reduce((t, p) => t + plan(p).bare.length, 0);
  // each step's channels, tried every way while the count of bare colors grows
  let best = score();
  for (let changed = true; changed;) {
    changed = false;
    for (const [n, , outs] of P.filter(([x]) => !fixed.includes(x))) for (const p of perms(outs.length)) {
      const old = pos.get(n); pos.set(n, p); const s = score();
      if (s > best) { best = s; changed = true; } else pos.set(n, old);
    }
  }
  const gather = (name) => {
    const C = at.get(name), [, ins] = C, { bare, used } = plan(C), chan = [], parts = bare.map(source);
    const free = [0, 1, 2].filter((c) => !used.has(c)), cut = new Map();
    ins.forEach(([r, sl], j) => {
      if (bare.includes(r)) { chan[j] = pos.get(r)?.[sl] ?? sl; return; }
      const k = `${r}:${sl}`; if (!cut.has(k)) cut.set(k, [r, sl, free.shift()]); chan[j] = cut.get(k)[2];
    });
    const by = new Map(); for (const [r, sl, c] of cut.values()) { if (!by.has(r)) by.set(r, []); by.get(r).push([sl, c]); }
    for (const [r, m] of by) {
      // the input color in place, or a step's numbers moved to the channels this gather has free
      const ident = r === 'in' && m.length === 3 && m.every(([sl, c]) => sl === c) && by.size === 1 && !parts.length;
      parts.push(ident ? source(r) : `color(from ${source(r)} xyz-d65 ${[0, 1, 2].map((c) => { const f = m.find(([, cc]) => cc === c); return f ? KW[r === 'in' ? f[0] : pos.get(r)[f[0]]] : 'none'; }).join(' ')} / none)`);
    }
    return { css: parts.reduce((a, b) => `color-mix(in xyz-d65, ${a}, ${b})`), chan: chan.map((c) => KW[c]) };
  };
  const extracts = P.reduce((t, p) => { const from = new Set(p[1].map(([r]) => r)); return t + from.size - plan(p).bare.length; }, 0);
  return { gather, place: (n) => pos.get(n), report: `${best} colors mixed bare, ${extracts} cut down` };
}
