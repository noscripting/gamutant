# The checks

Each check loads `gamutant.css` in headless Chrome for Testing, WebKit and Firefox, reads what the browser computes, and compares
it with a reference written apart from the sheet:

- CSS Color 4's conversions and gamut mapping: Color.js 0.7.1, and the draft's own pseudocode for Ray Trace and
  EdgeSeeker (`ref/methods.mjs`, `vendor/edge-seeker.mjs`);
- the drafts' algorithms, written apart from the sheet: CSS Color 5's `color-mix()` and `alpha()` (`vendor/css-color/`),
  CSS Color 6's `contrast-color()`, CSS Easing 1 and 2, and Compositing 1's blend formulas; CSS Color HDR's sample code and
  its §5.1 examples;
- Okhsl and Okhsv: Björn Ottosson's `ok_color.h`, ported in doubles (`ref/okhsl.mjs`); the adaptive mapping: his gamut clipping code, transcribed (`ref/ottosson.mjs`);
- palette steps: material-color-utilities 0.4.0's tonal palettes (`data/material-palettes.json`);
- paint mixing: spectral.js 3.0.0;
- the sheet's matrices, digit by digit, against their published values (`constants-check.mjs`).

Each check prints its cases and their worst error, and exits 1 on a fail. A known engine failure, counted in the check
itself, is printed as such and fails only when it gets worse. `wpt-check.mjs` writes `wpt/` with `wpt.mjs`,
a web-platform-tests reftest for each part, and runs them as WPT's runner does.

From a clone of this repository (the npm package holds the sheet and its part files, not `test/`):

```sh
npm install
npm run browsers
npm test
```

`npm run browsers` fetches Chrome for Testing 155 (with `curl`, and `unzip` on Linux) and Playwright's WebKit 26.4; Firefox is the machine's release
Firefox, which the checks need (on a machine without it, `ENGINES=Chrome,WebKit`). These are the builds the results
in README.md were measured in. Playwright's own Chromium (148) and Firefox
(150) are older, and some checks fail there.

`node test/cost.mjs gamutant.css gamutant.css fit-screen` measures a part's style cost (the two sheets side by side; any part it lists). `node test/fuzz-engines.mjs` runs a cross-engine fuzz: the same seeded inputs in
the three engines, compared with each other. Two results come from the source repository's own tools, not these: the
part files' check (each part file alone, in any order, twice, beside the sheet) and the tally of requirements in
compat.json.

The checks' comments name the library's source repository: its build (`build.mjs`), its requirements (`SPEC.md`, as G16 or H3, the ids `compat.json` carries) and its notes on engine bugs (`QUIRKS.md`, as Q3). Those files live there, not here.

`npm test` runs every check, four at a time. `node test/mapper-check.mjs` runs one; `ENGINES=WebKit` (or
`ENGINES=Chrome,Firefox`) narrows the engines, and `SHEET=` names another sheet to check (the reftests in `wpt/`
link `gamutant.css` itself). `CHROME=` and `FIREFOX=` name other
executables.
