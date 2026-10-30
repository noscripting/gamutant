// spectral.js 3.0.0 (MIT, Ronald van Wijnen; node_modules/spectral.js), loaded with its tables exposed: the seven base
// reflectances, the CIE colour matching functions and the conversion matrices it uses, for sheet.mjs and the check.
//   import { spectral, K } from './spectral.mjs'
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const file = createRequire(import.meta.url).resolve('spectral.js');
const src = readFileSync(file, 'utf8').replace('exports.Color = Color;',
  'exports.Color = Color; exports.K = { SIZE, GAMMA, BASE_SPECTRA, CIE, CONVERSION };');
const mod = { exports: {} };
new Function('module', 'exports', 'define', src)(mod, mod.exports, undefined);
export const spectral = mod.exports;
export const K = mod.exports.K;
if (!K?.BASE_SPECTRA) throw new Error(`spectral.mjs: ${file} no longer has the tables this lab reads`);
