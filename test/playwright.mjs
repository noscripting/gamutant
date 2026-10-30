// Playwright and the checks' packages, from this repo's node_modules (npm install)
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
export const need = (name) => req(name);
const pw = req('playwright');
export default pw;
