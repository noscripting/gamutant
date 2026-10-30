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

Each part is also its own file in `parts/`, named after its class: gamutant.css is 65 KB gzipped, a part file at most 16 KB. Link the ones a page uses:

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

- Set `--gamut-target` on an ancestor to fit to another gamut: `srgb`, `display-p3`, `rec2020`, `a98-rgb` or `prophoto-rgb`.
- `--gamut-method` on an ancestor picks the method. The default, `css`, turns the hue up to 6° at chroma 0.2; `edge-seeker`, `ray-trace` and `adaptive` ([Ottosson's](https://bottosson.github.io/posts/gamutclipping/)) keep it within 2°, 5° and 2° at chroma 0.05 and up, but not to `prophoto-rgb`.

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

Material 3's tones of one color, spread over a list's items ([material-color-utilities](https://github.com/material-foundation/material-color-utilities)). They hold its HCT hue; for one OkLCh hue, set only `--gamut-okhsl-l` on `.gamut-okhsl-from`.

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

A text color that reads on an opaque background: the background's color mixed toward black or white to a 4.5 contrast ratio ([#5153](https://github.com/w3c/csswg-drafts/issues/5153)). Beside another part on one element, `--gamut-bg: var(--gamut-out)` reads that part's color. On a gradient of light colors read its darkest end, of dark ones its lightest; colors between can contrast less.

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

Picks a background's text color from up to six, as `contrast-color()` does ([CSS Color 6](https://drafts.csswg.org/css-color-6/#colorcontrast)): the first to reach `--gamut-contrast-ratio`, else white or black; with no ratio, the one that contrasts most.

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

Mixes up to six colors, as `color-mix()` mixes two ([CSS Color 5](https://drafts.csswg.org/css-color-5/#color-mix)). Colors with no share split what is left.

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
- Add `.gamut-mix-paint` to mix two colors as paints do (as a function, space `paint`), with Ronald van Wijnen's [spectral.js](https://github.com/rvanwijnen/spectral.js) ([#8715](https://github.com/w3c/csswg-drafts/issues/8715)).

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

### `.gamut-color-layers`

Stacks up to six colors into one, as `color-layers()` does ([CSS Color 6](https://drafts.csswg.org/css-color-6/#color-layers)). `--gamut-layer-1` is on top. The blend mode is a class.

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

A color from CMYK, as `device-cmyk()` does ([CSS Color 5](https://drafts.csswg.org/css-color-5/#device-cmyk)).

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

A light and a dark color set once, picked by the color scheme of the element with the class; its children inherit the pick. For tokens registered as `<color>` ([#13836](https://github.com/w3c/csswg-drafts/issues/13836)).

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

Whether two colors are equal, as 1 or 0 for its children: their channels compared as [CSS Color 4](https://drafts.csswg.org/css-color-4/#comparing-color-values) does, not as painted.

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

- Set `--gamut-target: display-p3` or `rec2020` on an ancestor to pick in that gamut (P3 constants: Isaac Muse's, [#8659](https://github.com/w3c/csswg-drafts/issues/8659)).

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

A color between a standard and a bright version, by `--gamut-headroom`, which you set to how far past white the screen goes, as `hdr-color()` does ([CSS Color HDR](https://drafts.csswg.org/css-color-hdr-1/#hdr-color-function)).

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

A color's channels as numbers, for CSS that needs them ([#6937](https://github.com/w3c/csswg-drafts/issues/6937)).

```html
<div class="gamut-color-extract" style="--gamut-in: #ff3366">
  <div class="gamut-color-extract-read gamut-extract-oklch" style="width: calc(var(--gamut-oklch-l) * 100%)"></div>
</div>
```

## Browsers

Measured 2026-10-30, headless: Chrome 155, WebKit 26.4, Firefox 158.

The classes run in all three, the functions only in Chrome 155. Firefox 158 doesn't read a percentage in `--gamut-mix-pct-1` to `--gamut-mix-pct-6`: write `40`, not `40%`. Some colors follow an engine's bugs: `.gamut-color-mix` in Chrome 155; `.gamut-color-layers` and `.gamut-alpha` in WebKit 26.4; `.gamut-fit-screen`, `.gamut-color-mix` and `.gamut-color-equal` in Firefox 158. `npm run browsers` fetches all but Firefox 158, the machine's own.

## Build

The checks expect the builds in [Browsers](#browsers).

```sh
npm install
npm run browsers
npm test
```
