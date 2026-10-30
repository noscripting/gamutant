// The engines for the checks, headless: Chrome for Testing 155 and WebKit 26.4 (npm run browsers fetches them) and the
// machine's release Firefox, the builds the results in README.md were measured in; without Chrome for Testing,
// Playwright's own Chromium, an older build some checks fail. CHROME= names another Chrome, FIREFOX= another release
// Firefox; ENGINES= narrows the engines (ENGINES=WebKit, ENGINES=Chrome,Firefox).
import { existsSync } from 'node:fs';
import pw, { need } from './playwright.mjs';
import { CHROME, CHROME_VERSION } from './browsers.mjs';
export { pw, need };
export const benchLock = async () => () => {};   // the source repository's bench lock, which two checks take: none here
const chrome = process.env.CHROME || (existsSync(CHROME) && CHROME);
export const ENGINES = [['Chrome', 'chromium', chrome ? { executablePath: chrome } : {}], ['WebKit', 'webkit', {}],
  ['Firefox', 'firefox', { channel: 'moz-firefox', ...(process.env.FIREFOX ? { executablePath: process.env.FIREFOX } : {}) }]];
if (!chrome) console.log(`Chrome: Playwright's own Chromium, not Chrome for Testing ${CHROME_VERSION} (npm run browsers)`);
export function pick(want = ENGINES.map((e) => e[0]), env = process.env.ENGINES) {
  const only = env && env.toLowerCase().split(',');
  const got = ENGINES.filter(([name]) => want.includes(name) && (!only || only.includes(name.toLowerCase())));
  if (!got.length) throw new Error(`ENGINES=${env} names none of the engines this check runs (${want.join(', ')})`);
  return got;
}
export const launch = ([, type, opts], extra = {}) => pw[type].launch({ ...opts, ...extra, headless: true });
export async function open(e, { viewport = { width: 1000, height: 800 }, ...extra } = {}) {
  const browser = await launch(e, extra), context = await browser.newContext({ viewport }), page = await context.newPage();
  return { browser, context, page, close: () => browser.close() };
}
