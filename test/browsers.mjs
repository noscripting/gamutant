// The browsers the results in README.md were measured in: Chrome for Testing 155, into node_modules/.chrome-for-testing/,
// and Playwright's WebKit 26.4; Firefox is the machine's release Firefox (158). Run once after npm install.
// Usage: npm run browsers
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export const CHROME_VERSION = '155.0.8059.86';
const APP = 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const BUILD = { 'darwin-arm64': ['mac-arm64', APP], 'darwin-x64': ['mac-x64', APP], 'linux-x64': ['linux64', 'chrome'], 'win32-x64': ['win64', 'chrome.exe'] }[`${process.platform}-${process.arch}`];
const dir = fileURLToPath(new URL(`../node_modules/.chrome-for-testing/${CHROME_VERSION}`, import.meta.url));
export const CHROME = BUILD ? `${dir}/chrome-${BUILD[0]}/${BUILD[1]}` : '';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!BUILD) throw Error(`no Chrome for Testing build for ${process.platform}-${process.arch}: set CHROME= to a Chrome 155`);
  // curl ships with macOS, Linux and Windows 10 and later; the zip is opened by ditto on macOS, unzip on Linux and
  // Windows' own tar (bsdtar, which reads a zip, where GNU tar doesn't)
  if (!existsSync(CHROME)) { mkdirSync(dir, { recursive: true }); const zip = `chrome-${BUILD[0]}.zip`;
    execSync(`curl -sfo ${zip} https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/${BUILD[0]}/${zip}`, { cwd: dir, stdio: 'inherit' });
    execSync({ darwin: `ditto -x -k ${zip} .`, win32: `tar -xf ${zip}` }[process.platform] ?? `unzip -q ${zip}`, { cwd: dir, stdio: 'inherit' }); rmSync(`${dir}/${zip}`); }
  execSync('npx playwright install webkit', { stdio: 'inherit' });
  console.log(`Chrome for Testing ${CHROME_VERSION}: ${CHROME}\nWebKit: Playwright's\nFirefox: the machine's release Firefox (FIREFOX= names another)`);
}
