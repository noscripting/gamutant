# Changelog

All notable changes to gamutant.css are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html): a class, an input, an output, a function or a file removed or changed in meaning is a major version. Before 1.0.0, a minor version can make such a change, as Semantic Versioning allows.

## [Unreleased]

The first release, to be published as 0.0.1.

### Added

- Gamut mapping: `.gamut-fit-screen`, by CSS Color 4's binary search, Ray Trace or EdgeSeeker, or the adaptive L0 method of Oklab's gamut clipping post (`--gamut-method`), to sRGB, Display P3, Rec. 2020, A98 RGB or ProPhoto RGB (`--gamut-target`); `.gamut-screen-edge`, the most colorful color a gamut holds at a color's lightness and hue; `.gamut-fit-gradient`, OkLCh gradient stops each mapped, with an easing between them (`.gamut-gradient-ease`).
- Tints of one color: `.gamut-palette-step`, Material 3's tonal palette from a seed color, at tones you choose (`--gamut-tone`).
- Readable text: `.gamut-readable-text`, a text color that reaches a WCAG 2 contrast ratio, from your own color; `.gamut-contrast-color`, CSS Color 6's `contrast-color()` with your own colors.
- Mixing: `.gamut-color-mix` of up to 6 colors, and of two as paints mix (`.gamut-mix-paint`); `.gamut-color-interpolate`; `.gamut-color-layers`; `.gamut-alpha`; `.gamut-device-cmyk`.
- Tokens and comparisons: `.gamut-light-dark`, a color token kept as its two colors and resolved on the element with the class; `.gamut-color-equal`.
- Color spaces: `.gamut-okhsl`, `.gamut-okhsl-from` and `.gamut-okhsv`, in sRGB, Display P3 and Rec. 2020; `.gamut-jzazbz`, `.gamut-jzczhz`, `.gamut-ictcp`; `.gamut-rec2100-pq`, `.gamut-rec2100-hlg`, `.gamut-rec2100-linear`; `.gamut-hdr-color`; `.gamut-color-extract`.
- A CSS function for 19 parts, named `--gamut-` and the class, where the browser parses `@function`.
- Each part as its own file beside `gamutant.css` (`fit-screen.css` and the rest), for a page that uses only some.
