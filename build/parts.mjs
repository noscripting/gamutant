// The part files: gamutant.css cut to one part each, so a page's build step (or a <link>) carries only the parts it
// imports. Each file is the shipped sheet's own text, never generated apart from it (the passes fold each part, counting a property's readers over the whole sheet):
// the part's rules, the registrations and keyframes they read, its Chrome @function forms and every @function they
// call, cut by a page trimmer (lib/css-trim.mjs) on a page with every class the part's selectors name and a
// call of its function. A function form stays in its part's file: Chrome paints a call to a function no sheet defines
// transparent, past a plain fallback color, where WebKit and Firefox keep the fallback.
//   parts(css) -> { '<part>': text }; node parts.mjs writes parts/<part>.css from gamutant.css
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { trim } from './lib/css-trim.mjs';
import { REGISTRY } from './registry.mjs';

const postcss = createRequire(import.meta.url)('postcss');
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// each part (registry.mjs) and the classes its selectors pair it with, bare; the sheet's classes are gamut-<name>
// (build.mjs CLASS_PREFIX)
const sheetText = readFileSync(new URL('../gamutant.css', import.meta.url), 'utf8');
export const CLASS = (name) => `gamut-${name}`;
export const PARTS = Object.fromEntries(REGISTRY.map(({ part, more = [] }) => [part, typeof more === 'function' ? more(sheetText) : more]));

// a page where every selector of the part can match: the classes on 32 siblings (.gamut-palette-step's :nth-child and
// :nth-last-child rules go to 24), the first with a child and a grandchild, and a child without them (.gamut-color-equal
// > :not(.gamut-color-equal))
const page = (part, more) => { const c = [part, ...more].map(CLASS).join(' ');
  return `<!doctype html><html><body><div class="${c}"><div class="${c}"><div class="${c}"></div></div><i></i></div>${`<div class="${c}"></div>`.repeat(31)}</body></html>`; };

// the trimmer cuts again until nothing changes (a cut keeps what the rules it drops read);
// other: the CSS that calls the part's function, so its forms are kept
const cut = (css, html, other) => { for (let k = 0, last = css; k < 4; k++, last = css) { css = trim(css, html, { other }).css; if (css.length === last.length) break; } return css; };

// the parts that include others' code: each holder's copyright and what was taken and changed (registry.mjs from;
// LICENSE-THIRD-PARTY has the notices)
const FROM = Object.fromEntries(REGISTRY.map(({ part, from = [] }) => [part, from]));

export function parts(css = sheetText) {
  const fns = new Set([...css.matchAll(/@function (--[\w-]+)\(/g)].map((m) => m[1])), out = {};
  for (const [part, more] of Object.entries(PARTS)) {
    const own = `--gamut-${part}`, body = cut(css, page(part, more), fns.has(own) ? `i { color: ${own}(); }` : '');
    // registrations once each (the whole sheet registers --gamut-out twice, the same text)
    const seen = new Set(), rules = postcss.parse(body); rules.each((n) => { if (n.type !== 'atrule' || n.name !== 'property') return; const t = n.toString(); if (seen.has(t)) n.remove(); else seen.add(t); });
    const from = FROM[part] ?? [];
    // SPDX files the 2023 W3C licence under W3C-20150513
    const spdx = ['MIT', ...new Set(from.map(([, , id]) => id).filter(Boolean))].join(' AND ');
    out[part] = `/*! gamutant.css ${version}, ${part}.css: the ${part} part alone\n   SPDX-License-Identifier: ${spdx}\n   Copyright (c) 2026 gamutant contributors\n`
      + from.filter(([h]) => h).map(([h]) => `   Copyright (c) ${h}\n`).join('') + from.map(([, what]) => `   ${what}\n`).join('') + '   Third-party notices: LICENSE-THIRD-PARTY */\n'
      + `${rules.toString().trim()}\n`;
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = new URL('../parts/', import.meta.url); mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith('.css')) rmSync(new URL(f, dir));
  const t = Date.now(), files = parts();
  for (const [part, text] of Object.entries(files)) writeFileSync(new URL(`${part}.css`, dir), text);
  console.log(`parts/: ${Object.keys(files).length} files in ${Date.now() - t} ms`);
}
