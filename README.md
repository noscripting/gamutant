# gamutant

A CSS-only color polyfill. Gamutant is a stylesheet that fits colors into what the screen can show (its gamut), picks readable text colors and works in Okhsl, Okhsv and the HDR color spaces. Use it as classes, or as CSS functions where `@function` runs. No JavaScript needed.

## License

MIT, see LICENSE. Math comes from Color.js by Lea Verou and Chris Lilley, Björn Ottosson’s Okhsl and gamut clipping code, spectral.js by Ronald van Wijnen, Google’s material-color-utilities and the CSS Color drafts’ sample code.

## Installation

```sh
npm install gamutant.css
```

Or link it from a CDN. This page fits an orange to the screen:

```html
<!doctype html>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/gamutant.css@0.0.1/gamutant.css">
<div class="gamut-fit-screen" style="
  --gamut-in: oklch(0.8 0.2 55);
  width: 200px;
  height: 100px;
  background: var(--gamut-out);
"></div>
```

Each part is also its own file in `parts/`, named after its class: gamutant.css is 66 KB gzipped, a part file at most 16 KB. Link the ones a page uses:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/gamutant.css@0.0.1/parts/fit-screen.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/gamutant.css@0.0.1/parts/readable-text.css">
```

Or in a bundler: `import "gamutant.css/parts/fit-screen.css";`.

[TUTORIAL.md](TUTORIAL.md) builds a first page step by step.

## Classes and functions

Each part is a class. Its inputs are custom properties, which inherit: a part inside another takes those it doesn't set, unless set to `initial`. Most write `--gamut-out`, which the element and its children read with `var()`; the text parts write `--gamut-text`. To feed one part's `--gamut-out` to another, copy it beside the first, `--c: var(--gamut-out)`, and read `var(--c)` on a child.

Where `@function` runs, 19 parts are also functions named after their class, their arguments the class's inputs in order. Wrap a call with `var()` arguments in `@supports at-rule(@function)`.

```css
.badge { background: --gamut-fit-screen(oklch(0.8 0.2 55)); }
.paint { background: --gamut-color-mix(paint, blue, 50%, yellow, 50%); }

--gamut-fit-screen(in, target, method)
--gamut-screen-edge(in, rel, target)
--gamut-palette-step(in, chroma-scale, step, tone)
--gamut-color-equal(equal-a, equal-b)
--gamut-readable-text(bg, ratio, from, to)
--gamut-contrast-color(bg, contrast-ratio, try-1, try-2, try-3, try-4, try-5, try-6)
--gamut-color-mix(mix-space, mix-1, mix-pct-1, mix-2, mix-pct-2, mix-3, mix-pct-3, mix-4, mix-pct-4, mix-5, mix-pct-5, mix-6, mix-pct-6)
--gamut-fit-gradient(gradient-from, gradient-to, gradient-hue, target)
--gamut-okhsl(h, s, l)
--gamut-okhsl-from(in, s, l)
--gamut-okhsv(h, s, v)
--gamut-device-cmyk(cmyk-c, cmyk-m, cmyk-y, cmyk-k, cmyk-alpha)
--gamut-rec2100-pq(r, g, b, alpha)
--gamut-rec2100-hlg(r, g, b, alpha)
--gamut-rec2100-linear(r, g, b, alpha)
--gamut-jzazbz(jz, az, bz, alpha)
--gamut-jzczhz(jz, cz, hz, alpha)
--gamut-ictcp(i, ct, cp, alpha)
--gamut-hdr-color(hdr-1, h1, hdr-2, h2, headroom)
```

## Reference

### `.gamut-fit-screen`

Brings a color the screen can't show into its gamut, as [CSS Color 4](https://drafts.csswg.org/css-color-4/#gamut-mapping) describes and [Color.js](https://colorjs.io) does.

```html
<div class="gamut-fit-screen" style="
  --gamut-in: oklch(0.8 0.2 55);
  background: var(--gamut-out);
"></div>
```

- Set `--gamut-target` on an ancestor to fit to another gamut: `srgb`, `display-p3`, `rec2020`, `a98-rgb` or `prophoto-rgb`. A `rec2020` color is encoded as all three engines decode it, by BT.2020's curve, not by the 2.4 power CSS Color 4 §10.8 now gives ([#12574](https://github.com/w3c/csswg-drafts/issues/12574)).
- `--gamut-method` on an ancestor picks the method. The default, `css`, turns the hue up to 6° at chroma 0.2; `edge-seeker` ([Alexey Ardov's](https://drafts.csswg.org/css-color-4/#GMA-EdgeSeeker), first written for Color.js, its lookup table replaced by a search of the cube's edges), `ray-trace` ([Isaac Muse's](https://drafts.csswg.org/css-color-4/#GMA-Raytrace), first written for ColorAide) and `adaptive` ([Ottosson's](https://bottosson.github.io/posts/gamutclipping/), its sRGB cusp found on each target's own cube) keep it within 2°, 5° and 2° at chroma 0.05 and up, but not to `prophoto-rgb`. `adaptive` gives up lightness toward the hue's most colorful color; the other three hold it. [lab/mappers.html](lab/mappers.html) shows each method beside the clip.

### `.gamut-screen-edge`

The most colorful version of a color the screen can show, or a fraction of it ([#11946](https://github.com/w3c/csswg-drafts/issues/11946)).

```html
<div class="gamut-screen-edge" style="
  --gamut-in: oklch(0.7 0.3 250);
  --gamut-rel: 0.8;
  background: var(--gamut-out);
"></div>
```

### `.gamut-palette-step`

Material 3's tones of one color, spread evenly from tone 95 to 10 over a list's items ([material-color-utilities](https://github.com/material-foundation/material-color-utilities)). They hold its HCT hue; for one OkLCh hue, set only `--gamut-okhsl-l` on `.gamut-okhsl-from`.

```html
<ul style="--gamut-in: #6750a4">
  <li class="gamut-palette-step" style="background: var(--gamut-out)"></li>
  <li class="gamut-palette-step" style="background: var(--gamut-out)"></li>
  <li class="gamut-palette-step" style="
    --gamut-tone: 40;
    background: var(--gamut-out);
  "></li>
</ul>
```

- `--gamut-chroma-scale` makes every step more or less colorful, within what sRGB holds.

### `.gamut-fit-gradient`

A gradient between two colors with every stop fitted to the screen ([CSS Color 4](https://drafts.csswg.org/css-color-4/#interpolation)).

```html
<div class="gamut-fit-gradient" style="
  --gamut-gradient-from: oklch(0.5 0.16 0);
  --gamut-gradient-to: oklch(0.5 0.16 180);
  background: linear-gradient(in var(--gamut-gradient-space) to right, var(--gamut-gradient-stops));
"></div>
```

- `--gamut-gradient-hue` sets the way round the hue wheel: `longer`, `increasing` or `decreasing`.
- Set `--gamut-target` on an ancestor, as for `.gamut-fit-screen`.
- Add `.gamut-gradient-ease` and set `--gamut-gradient-ease` to an easing, such as `ease-in` ([#1332](https://github.com/w3c/csswg-drafts/issues/1332)). It takes the element's `animation`: put yours on a parent or child.

### `.gamut-readable-text`

A text color that reads on an opaque background: the background's color mixed toward black or white to a WCAG 2 contrast ratio of 4.5, the continuous adjustment [#5153](https://github.com/w3c/csswg-drafts/issues/5153) asked for (deferred), as a tint or shade: its OkLCh chroma falls, and toward white its hue turns too (pure blue's by 20°). Beside another part on one element, `--gamut-bg: var(--gamut-out)` reads that part's color. On a gradient of light colors read its darkest end, of dark ones its lightest; colors between can contrast less. [lab/accent.html](lab/accent.html) themes a whole page from the viewer's `AccentColor` with it and four other parts.

```html
<p class="gamut-readable-text" style="
  --gamut-bg: #3399ff;
  background: var(--gamut-bg);
  color: var(--gamut-text);
">Text</p>
```

- `--gamut-ratio` sets another ratio. Where no color reaches it, the text is white or black, whichever contrasts more, or with the inputs below, their start or end.
- `--gamut-readable-from` starts from your text color instead, and `--gamut-readable-to` ends at another than white or black.

### `.gamut-contrast-color`

Picks a background's text color from up to six, as `contrast-color()` does ([CSS Color 6](https://drafts.csswg.org/css-color-6/#colorcontrast)): the first to reach `--gamut-contrast-ratio`, else white or black; with no ratio, the one that contrasts most. The ratio is WCAG 2's, as Color 6's `wcag2` names it. With one color in, CSS Color 5's own `contrast-color()` already ships in all three engines (it picks by WCAG 2's ratio there too, though [CSS Color 5 §8](https://drafts.csswg.org/css-color-5/#contrast-color) advises against that ratio alone).

```html
<p class="gamut-contrast-color" style="
  --gamut-bg: wheat;
  --gamut-try-1: sienna;
  --gamut-try-2: darkgreen;
  --gamut-contrast-ratio: 4.5;
  background: var(--gamut-bg);
  color: var(--gamut-text);
">Text</p>
```

### `.gamut-color-mix`

Mixes up to six colors, as `color-mix()` does with any number ([CSS Color 5](https://drafts.csswg.org/css-color-5/#color-mix)). Colors with no share split what is left.

```html
<div class="gamut-color-mix" style="
  --gamut-mix-count: 3;
  --gamut-mix-1: red;
  --gamut-mix-2: blue;
  --gamut-mix-3: lime;
  --gamut-mix-pct-1: 50;
  background: var(--gamut-out);
"></div>
```

- `--gamut-mix-count` says how many, 2 if unset; `--gamut-mix-space` their space, `oklab` if unset, as `color-mix()` takes it.
- A color set in a slot past the count takes no share but fills a component every counted color leaves missing (`none`), as a color at 0% does in `color-mix()`: leave unused slots unset.
- Add `.gamut-mix-paint` to mix two colors by Kubelka-Munk as Ronald van Wijnen's [spectral.js](https://github.com/rvanwijnen/spectral.js) models pigments (as a function, space `paint`) ([#8715](https://github.com/w3c/csswg-drafts/issues/8715)); [lab/paint.html](lab/paint.html) shows it beside `color-mix()`.

### `.gamut-color-interpolate`

The color at a point along up to eight stops, like `color-interpolate()` ([CSS Values 5](https://drafts.csswg.org/css-values-5/#color-interpolate)). Positions and `--gamut-t` are numbers, not percentages.

```html
<div class="gamut-color-interpolate" style="
  --gamut-stops: 3;
  --gamut-stop-1: #e11d48;
  --gamut-at-1: 0;
  --gamut-stop-2: #f59e0b;
  --gamut-at-2: 0.5;
  --gamut-stop-3: #16a34a;
  --gamut-at-3: 1;
  --gamut-t: 0.4;
  background: var(--gamut-out);
"></div>
```

- `--gamut-space` sets their space, `oklab` if unset; `--gamut-to-k` gives stop k a second position, its color held to there.
- A component missing (`none`) in both stops of a segment takes the next stop's value (in the last segment, the one before's), where CSS Color 4 keeps it missing; so does one missing in a color before the first stop, in a stop's own stretch or after the last.

### `.gamut-color-layers`

Stacks up to six colors into one, as `color-layers()` does ([CSS Color 6](https://drafts.csswg.org/css-color-6/#color-layers)). `--gamut-layer-1` is on top. The blend mode is a class, one of Compositing 1's 15: `.gamut-blend-multiply` to `.gamut-blend-luminosity`.

```html
<div class="gamut-color-layers gamut-blend-multiply" style="
  --gamut-layer-1: rgb(0 0 255 / 0.5);
  --gamut-layer-2: gold;
  background: var(--gamut-out);
"></div>
```

### `.gamut-alpha`

A color with a new alpha, as `alpha()` does ([CSS Color 5](https://drafts.csswg.org/css-color-5/#relative-alpha)).

```html
<div class="gamut-alpha" style="
  --gamut-in: teal;
  --gamut-alpha-value: calc(alpha * 0.5);
  background: var(--gamut-out);
"></div>
```

### `.gamut-device-cmyk`

A color from CMYK, by `device-cmyk()`'s naive conversion ([CSS Color 5](https://drafts.csswg.org/css-color-5/#device-cmyk)).

```html
<div class="gamut-device-cmyk" style="
  --gamut-cmyk-c: 0;
  --gamut-cmyk-m: 0.5;
  --gamut-cmyk-y: 1;
  --gamut-cmyk-k: 0;
  background: var(--gamut-out);
"></div>
```

### `.gamut-light-dark`

A light and a dark color set once, picked by the color scheme of the element with the class; its children inherit the pick. For tokens registered as `<color>`: a workaround for [#13836](https://github.com/w3c/csswg-drafts/issues/13836), which asks `light-dark()` to resolve at used-value time.

```html
<body style="
  color-scheme: light dark;
  --gamut-light: yellow;
  --gamut-dark: blue;
">
  <div class="gamut-light-dark" style="
    color-scheme: dark;
    background: var(--gamut-out);
  ">Blue</div>
</body>
```

### `.gamut-color-equal`

Whether two colors are equal, as 1 or 0 for its children: compared in OkLab within 0.00001, as [CSS Color 4](https://drafts.csswg.org/css-color-4/#comparing-color-values) compares two colors of different spaces, not as painted. A stylesheet can't read which space a color was written in, so two of one space are compared that way too, and §12's rules for missing and powerless components aren't followed.

```html
<div class="gamut-color-equal" style="
  --gamut-equal-a: red;
  --gamut-equal-b: color(srgb-linear 1 0 0);
">
  <p style="color: rgb(calc(255 * var(--gamut-equal)) 0 0)">Red when the two are one color</p>
</div>
```

### `.gamut-okhsl`, `.gamut-okhsl-from`, `.gamut-okhsv`

Colors picked in Okhsl and Okhsv ([Ottosson's color picker spaces](https://bottosson.github.io/posts/colorpicker/)), and a color's own Okhsl changed. One `--gamut-okhsl-l` is one OkLab lightness at every hue.

```html
<div class="gamut-okhsl" style="
  --gamut-okhsl-h: 260;
  --gamut-okhsl-s: 0.9;
  --gamut-okhsl-l: 0.6;
  background: var(--gamut-out);
"></div>
```

```html
<div class="gamut-okhsl-from" style="
  --gamut-in: #ff3366;
  --gamut-okhsl-l: 0.9;
  background: var(--gamut-out);
"></div>
```

- Set `--gamut-target: display-p3` or `rec2020` on an ancestor to pick in that gamut (P3 constants: Isaac Muse's, [#8659](https://github.com/w3c/csswg-drafts/issues/8659); Rec. 2020's are this library's own fit of Ottosson's polynomials, up to 35/255 off his exact model near the blue primary).

### `.gamut-rec2100-pq`, `.gamut-rec2100-hlg`, `.gamut-rec2100-linear`

Colors in the HDR video encodings ([CSS Color HDR](https://drafts.csswg.org/css-color-hdr-1/#predefined-HDR)).

```html
<div class="gamut-rec2100-pq" style="
  --gamut-rec2100-r: 0.55;
  --gamut-rec2100-g: 0.5;
  --gamut-rec2100-b: 0.4;
  background: var(--gamut-out);
"></div>
```

### `.gamut-jzazbz`, `.gamut-jzczhz`, `.gamut-ictcp`

Colors in the HDR spaces Jzazbz, JzCzhz and ICtCp ([CSS Color HDR](https://drafts.csswg.org/css-color-hdr-1/#DI-HDR)), which can lie past the screen's gamut: `.gamut-fit-screen` fits them.

```html
<div class="gamut-jzczhz" style="
  --gamut-jzczhz-jz: 0.1571;
  --gamut-jzczhz-cz: 0.0944;
  --gamut-jzczhz-hz: 69.57;
  background: var(--gamut-out);
"></div>
```

### `.gamut-hdr-color`

A color between a standard and a bright version, by `--gamut-headroom`, which you set to how far past white the screen goes: `hdr-color()`'s interpolation at a headroom you give it, since CSS exposes no screen's ([CSS Color HDR](https://drafts.csswg.org/css-color-hdr-1/#hdr-color-function)).

```html
<div class="gamut-hdr-color" style="
  --gamut-hdr-1: color(display-p3 1 1 0.33);
  --gamut-hdr-2: color(xyz-d65 18.6 21.5 7.8);
  --gamut-hdr-h1: 0.5;
  --gamut-hdr-h2: 4;
  --gamut-headroom: 2;
  background: var(--gamut-out);
"></div>
```

- Headrooms are in stops: 1 is twice SDR white. No CSS gives the screen's; `(dynamic-range: high)` only says it has one.

### `.gamut-color-extract`

A color's channels as numbers, for CSS that needs them ([#6937](https://github.com/w3c/csswg-drafts/issues/6937)), on a child `.gamut-color-extract-read` and everything inside it.

```html
<div class="gamut-color-extract" style="--gamut-in: #ff3366">
  <div class="gamut-color-extract-read gamut-extract-oklch" style="width: calc(var(--gamut-oklch-l) * 100%)"></div>
</div>
```

- A class `.gamut-extract-<space>` beside `.gamut-color-extract-read` adds that space's channels as `--gamut-<space>-<channel>`, for `srgb`, `srgb-linear`, `display-p3`, `a98-rgb`, `prophoto-rgb`, `rec2020`, `xyz-d50`, `lab`, `lch`, `oklab`, `oklch`, `hsl` and `hwb`.

## Browsers

Measured 2026-10-31, headless: Chrome 155, WebKit 26.4, Firefox 159.

The classes run in all three, the functions only in Chrome 155. Firefox 159 doesn't read a percentage in `--gamut-mix-pct-1` to `--gamut-mix-pct-6`: write `40`, not `40%`. Some colors follow an engine's bugs: `.gamut-color-mix` in Chrome 155; `.gamut-color-layers` and `.gamut-alpha` in WebKit 26.4; `.gamut-fit-screen`, `.gamut-color-mix` and `.gamut-color-equal` in Firefox 159. In Firefox 159, `.gamut-fit-screen` maps an input built from `currentColor` wrong: 12 of 33 within 2/255 of Color.js, and slowly. `currentColor` as the input of `.gamut-okhsl-from`, `.gamut-color-extract` and `.gamut-color-equal` doesn't work in any of the three (transparent; every channel 0; 0 for two equal colors), nor of `.gamut-palette-step` in Chrome 155 and WebKit 26.4: write the color out. Given `currentColor` itself, `.gamut-okhsl-from`, `--gamut-okhsl-from()` and `--gamut-palette-step()` give transparent at once in Chrome 155; in Firefox 159, and given a color built from `currentColor`, they slow the page's load. `npm run browsers` fetches all but Firefox 159, the machine's own.

Short of their references in all three: `.gamut-screen-edge`, where the line at a lightness and hue comes back into the gamut for under 0.001 of chroma, takes the exit before it, up to 10/255 short (`prophoto-rgb` at `oklch(0.56 0.3 206)`); `--gamut-method: adaptive` to `prophoto-rgb` at lightness 0.99 and hues 100° to 110°, up to 48/255 (`oklch(0.99 0.7 105)`). In WebKit 26.4 and Firefox 159, `.gamut-palette-step` at tone 99 tells a yellow seed by its parent's `--gamut-in`, so a step with a seed of its own under a parent with another can be 41/255 off: set the seed on the parent.

## Build

### Running the checks

```sh
git clone https://github.com/noscripting/gamutant
cd gamutant
npm install
npm run browsers
npm test
```

`npm run browsers` downloads the builds in [Browsers](#browsers), once. `npm test` runs every check, four at a time, in a few minutes, and ends with `50 of 50 checks pass`; a check that fails prints its last lines and the run exits 1. A line marked `FAIL (known: …)` inside a passing check is a limit [Browsers](#browsers) states.

To run some checks, name them as the run prints them: `node test/run.mjs material okhsl`. `ENGINES=` with one or more engine names as the run prints them, comma-separated, runs them in those engines only.

Each of the 48 browser checks reads what the builds in [Browsers](#browsers) compute from `gamutant.css` and compares it with a reference written apart from the sheet: Color.js for CSS Color 4's conversions and gamut mapping, the drafts' own pseudocode and sample code, Björn Ottosson's `ok_color.h` for Okhsl and Okhsv, material-color-utilities for palette steps and spectral.js for paint mixing. Each prints its worst error. A web-platform-tests reftest for each part runs beside them. [test/README.md](test/README.md) lists every reference and its version. Two more run without a browser: `test/build-check.mjs` builds the sheet and its parts again in memory and fails on any byte that differs from the files committed, and `test/constants-check.mjs` reads each matrix row in the sheet against a published matrix to its digits.

### Building the sheet

`npm run build` writes `gamutant.css` and `parts/` again from `build/`, the same bytes as published: `build/build.mjs` puts the sheet together from `build/modules/`, a file for each group of parts (two parts, `contrast.css` and `scale.css`, are written by hand beside it), and `build/parts.mjs` cuts it into parts. `build/registry.mjs` lists every part with the file that writes it, its function form, its credits and its checks. The modules' comments say how each part computes in CSS: a gamut test held in a color's alpha, a distance as a mix with a color's negation, the searches' steps written out one after another.
