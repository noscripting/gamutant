# Changelog

All notable changes to gamutant.css are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html): a class, an input, an output, a function or a file removed or changed in meaning is a major version. Before 1.0.0, a minor version can make such a change, as Semantic Versioning allows.

## [Unreleased]

### Added

- The build: `npm run build` writes `gamutant.css` and `parts/` again, byte for byte, from `build/`.

### Fixed

- Each part file's first line names its version, 0.0.1; in 0.0.1 they said 1.0.0.
- `--gamut-method: ray-trace` maps a color below lightness 0.015 to its grey; in WebKit, a ray from near black ran parallel to a face and came out at a primary (`oklch(0.008 0.1 260)` painted full blue).
- `.gamut-color-equal`'s README line says it compares in OkLab, as the sheet does.
- The README credits EdgeSeeker to Alexey Ardov and Ray Trace to Isaac Muse, as CSS Color 4 does.
- `.gamut-palette-step` next to sRGB's red corner is within 1/255 of Material's palette: `#fe0003` at tone 53 was 4.2/255 off.
- In Chrome, `.gamut-palette-step` at tone 99 tells a yellow seed by the step's own seed, not the list's: a yellow step under a red list was 41/255 off.
- `.gamut-screen-edge` finds the most chroma near sRGB's blue, where the line leaves the gamut by a hair and comes back: `#0000ff` gives itself, not `rgb(0 49 229)`, and an input in the gamut never gets less chroma than its own.
- `.gamut-screen-edge` to `prophoto-rgb` at hues 196° to 206° finds the most chroma where red dips under 0 and the line comes back: `oklch(0.42 0.3 196)` was 210/255 short.
- `.gamut-screen-edge` to `prophoto-rgb` near its yellow at lightness 0.99 finds the most chroma: `oklch(0.99 0.3 103.1)` was 100/255 short.
- README says what `.gamut-color-mix` and `.gamut-color-interpolate` do with a component missing in both colors they mix, and counts 48 browser checks, not 49.
- In WebKit, `--gamut-method: adaptive` to `prophoto-rgb` maps bright yellows: `oklch(0.95 0.25 100)` was 141/255 off, greyed.
- In Chrome, a bare `currentColor` input to `.gamut-okhsl-from`, `--gamut-okhsl-from()` and `--gamut-palette-step()` gives transparent at once; it stalled the page's load.

## [0.0.1] - 2026-10-30

The first release.

### Added

- Gamut mapping: `.gamut-fit-screen`, by CSS Color 4's binary search, Ray Trace or EdgeSeeker, or the adaptive L0 method of Oklab's gamut clipping post (`--gamut-method`), to sRGB, Display P3, Rec. 2020, A98 RGB or ProPhoto RGB (`--gamut-target`); `.gamut-screen-edge`, the most colorful color a gamut holds at a color's lightness and hue; `.gamut-fit-gradient`, OkLCh gradient stops each mapped, with an easing between them (`.gamut-gradient-ease`).
- Tones of one color: `.gamut-palette-step`, Material 3's tonal palette from a seed color, at tones you choose (`--gamut-tone`).
- Readable text: `.gamut-readable-text`, a text color that reaches a WCAG 2 contrast ratio, from your own color; `.gamut-contrast-color`, CSS Color 6's `contrast-color()` with your own colors.
- Mixing: `.gamut-color-mix` of up to 6 colors, and of two as paints mix (`.gamut-mix-paint`); `.gamut-color-interpolate`; `.gamut-color-layers`; `.gamut-alpha`; `.gamut-device-cmyk`.
- Tokens and comparisons: `.gamut-light-dark`, a color token kept as its two colors and resolved on the element with the class; `.gamut-color-equal`.
- Color spaces: `.gamut-okhsl`, `.gamut-okhsl-from` and `.gamut-okhsv`, in sRGB, Display P3 and Rec. 2020; `.gamut-jzazbz`, `.gamut-jzczhz`, `.gamut-ictcp`; `.gamut-rec2100-pq`, `.gamut-rec2100-hlg`, `.gamut-rec2100-linear`; `.gamut-hdr-color`; `.gamut-color-extract`.
- A CSS function for 19 parts, named `--gamut-` and the class, where the browser parses `@function`.
- Each part as its own file in `parts/` (`parts/fit-screen.css` and the rest), for a page that uses only some.

[Unreleased]: https://github.com/noscripting/gamutant/commits/main
[0.0.1]: https://www.npmjs.com/package/gamutant.css/v/0.0.1
