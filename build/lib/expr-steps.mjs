// The stored-step decision over the existing expression tree. Legacy text
// inputs remain a compatibility frontend; no additional expression format.
import { steps as textSteps } from './steps.mjs';
import { css, r, regs } from './expr.mjs';
export { KEPT, REGISTERED } from './steps.mjs';

export function steps({ ref = name => `var(${name})`, ...options }) {
  const stages = [], outputs = [], names = new Set();
  const render = expr => expr?.k ? css(expr, name => names.has(name) ? `var(${options.prefix}${name})` : ref(name)) : String(expr);
  return {
    step(name, expr) {
      if (names.has(name)) throw Error(`duplicate step ${name}`);
      names.add(name); stages.push({ name, expr });
      return Object.assign(r(name), { toString: () => `var(${options.prefix}${name})` });
    },
    out(cls, properties, expressions, raw = false) {
      if (properties.length !== expressions.length) throw Error('output properties and expressions must match');
      outputs.push({ cls, properties, expressions, raw });
    },
    emit() {
      const byName = new Map(stages.map(s => [s.name, s])), done = new Set(), active = new Set();
      const visit = stage => {
        if (active.has(stage.name)) throw Error(`cyclic expression step ${stage.name}`);
        if (done.has(stage.name)) return;
        active.add(stage.name);
        if (stage.expr?.k) for (const name of regs(stage.expr)) if (byName.has(name)) visit(byName.get(name));
        active.delete(stage.name); done.add(stage.name);
      };
      stages.forEach(visit);
      const graph = textSteps(options);
      for (const s of stages) graph.step(s.name, render(s.expr));
      for (const o of outputs) graph.out(o.cls, o.properties, o.expressions.map(render), o.raw);
      return graph.emit();
    },
  };
}
