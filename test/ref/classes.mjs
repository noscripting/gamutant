// The sheet's classes ship as gamut-<name> (build.mjs CLASS_PREFIX). gamut('fit-screen readable-text sq') prefixes the
// tokens that are the sheet's own classes, read from gamutant.css, and leaves a page's own (sq) as they are.
//   import { gamut } from './ref/classes.mjs'
import { readFileSync } from 'node:fs';

const sheet = readFileSync(new URL('../../gamutant.css', import.meta.url), 'utf8');
export const CLASSES = new Set([...sheet.matchAll(/\.gamut-([a-z0-9-]+)/g)].map((m) => m[1]));
export const gamut = (s) => String(s).split(/(\s+)/).map((t) => (CLASSES.has(t) ? `gamut-${t}` : t)).join('');
// an older sheet, from before the prefix (BASE= sheets, git history), with its classes prefixed as the shipped one's
const alt = [...CLASSES].sort((a, b) => b.length - a.length).map((c) => c.replace(/[-]/g, '\\-')).join('|');
export const prefixSheet = (css) => (new RegExp(`\\.gamut-(${alt})(?![\\w-])`).test(css) ? css : css.replace(new RegExp(`(?<!\\d)\\.(${alt})(?![\\w-])`, 'g'), '.gamut-$1'));
