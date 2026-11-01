# gamutant: QUIRKS

The engine bugs gamutant.css meets, where at least one engine follows the spec. Each has the spec's words, a web-platform-tests test (written with WPT's own `testharness.js` and `color-testcommon.js`, in quirks/wpt/, where Repro names it, and run in a WPT checkout too in Chrome and Firefox), each engine's result and the workaround. WebKit here is Playwright's build of Safari's engine, not Safari.

Measured 2026-10-27, headless: Chrome 155.0.8059.86, WebKit 26.4, Firefox 158.0.

### Q1 WebKit: `cos()` of an angle built from a channel reads its value in degrees as radians

- Feature: `trig-functions`
- Spec: [CSS Values 4, trigonometric functions](https://drafts.csswg.org/css-values-4/#trig-funcs): “The sin(A), cos(A), and tan(A) functions all contain a single calculation which must resolve to either a <number> or an <angle>, and compute their corresponding function by interpreting the result of their argument as radians. (That is, sin(45deg), sin(.125turn), and sin(3.14159 / 4) all represent the same value, approximately .707.)” (css-values-4) “The component keywords return a <number>, or none” (css-color-5) “These are not invalid, and are retained for intermediate computations” (css-color-4); these give `color(srgb 0.5 0 0)`. No WPT test found for it.
- Engines: Chrome PASS: `color(srgb 0.5 0 0)` · WebKit FAIL: `color(srgb -0.952413 0 0)` · Firefox PASS: `color(srgb 0.5 0 0)`
- Repro: `quirks/wpt/cos-degrees.html`
- Bug: none found
- Workaround: no part takes `cos()` of a channel: `.gamut-okhsl`, `.gamut-okhsv` and `.gamut-jzczhz` take it of their hue input, a number times `1deg` or an angle.

### Q2 Chrome, WebKit: a relative color with its alpha omitted turns an origin's `none` alpha into 0

- Feature: `relative-color`
- Spec: [CSS Color 5, relative colors](https://drafts.csswg.org/css-color-5/#relative-colors): “If the alpha value of the relative color is omitted, it defaults to that of the origin color (rather than defaulting to 100%, as it does in the absolute syntax).” (css-color-5) “Missing components are handled the same way as with CSS Color 4 § 13.3 Interpolating with Missing Components: the origin colorspace and the relative function colorspace are checked for analogous components which are then carried forward as missing.” (css-color-5) “Alpha is its own analogous component (alpha is analogous to alpha), so a missing alpha is carried forward in exactly the same way as any other missing component.” (css-color-4) “If a color with a missing component is serialized or otherwise presented directly to an author, then for legacy color syntax it represents that component as a zero value; otherwise, it represents that component as being the none keyword.” (css-color-4) “including a missing alpha carried forward from the origin color per CSS Color 4 § 13.3 Interpolating with Missing Components” (css-color-5); these give `color(srgb 0.2 0.4 0.6 / none)`. No WPT test found for it.
- Engines: Chrome FAIL: `color(srgb 0.2 0.4 0.6 / 0); the control, color: color(srgb 0.2 0.4 0.6 / none): PASS` · WebKit FAIL: `color(srgb 0.2 0.4 0.6 / 0); the control, color: color(srgb 0.2 0.4 0.6 / none): PASS` · Firefox PASS: `color(srgb 0.2 0.4 0.6 / none); the control, color: color(srgb 0.2 0.4 0.6 / none): PASS`
- Repro: `quirks/wpt/alpha-none-origin.html`
- Bug: https://issues.chromium.org/issues/569954059 (fixed)
- Upstream: fixed in Chrome on its tracker, after the builds measured here
- Workaround: `.gamut-okhsl-from` writes `/ none` on every relative color it mixes.

### Q3 WebKit: a `none` hue converts as grey in a relative color

- Feature: `oklab`
- Spec: [CSS Color 4, missing components](https://drafts.csswg.org/css-color-4/#missing): “For all other purposes, a missing component behaves as a zero value, in the appropriate unit for that component: 0, 0%, or 0deg. This includes rendering the color directly, converting it to another color space, performing computations on the color component values, etc.” (css-color-4); these give `color(srgb 0.978129 -0.26354 0.474082)`. No WPT test found for it.
- Engines: Chrome PASS: `color(srgb 0.978088 -0.263507 0.474126)` · WebKit FAIL: `color(srgb 0.502111 0.502111 0.502111)` · Firefox PASS: `color(srgb 0.978129 -0.26354 0.474082)`
- Repro: `quirks/wpt/none-hue-grey.html`
- Bug: none found
- Workaround: `.gamut-fit-screen`, `.gamut-screen-edge` and `.gamut-palette-step` read the input as `oklch(from … l c h)` and as `lch(from … l c h)`, each of which turns a `none` hue into 0 in its own space and greys the other's, and take the second only where the first comes out grey; `.gamut-okhsl-from`, `.gamut-hdr-color` and `.gamut-color-extract` read theirs as given, as `oklch(from … l c h)` and as `lch(from … l c h)`, and take the reading with chroma where the input as given converts as grey.

### Q4 Firefox: a relative color from `var()` of a registered color computes off the spec

- Feature: `registered-custom-properties`
- Spec: [CSS Color 4, serializing alpha](https://drafts.csswg.org/css-color-4/#serializing-modern-alpha-values): “For modern color syntax, the precision with which <alpha-value>s are retained, and thus the number of decimal places in the serialized value, is required to be sufficient to round-trip 16-bit decimal values.” (css-color-4) “The serialized value must contain six decimal places (unless trailing zeroes have been removed).” (css-color-4) “Any var() function that references a registered custom property must be replaced with an equivalent token sequence, which is equal to the token sequence that would have been produced by serializing the computed value, and tokenizing the resulting string.” (css-properties-values-api-1); these give `color(srgb 0.8436 0 0)`. No WPT test found for it.
- Engines: Chrome PASS: `color(srgb 0.843608 0 0); the control, --e: color(from color(srgb 0 0 0 / 0.632812) srgb calc((alpha - 0.63) * 300) 0 0 / 1): PASS` · WebKit PASS: `color(srgb 0.843607 0 0); the control, --e: color(from color(srgb 0 0 0 / 0.632812) srgb calc((alpha - 0.63) * 300) 0 0 / 1): PASS` · Firefox FAIL: `color(srgb 0 0 0); the control, --e: color(from color(srgb 0 0 0 / 0.632812) srgb calc((alpha - 0.63) * 300) 0 0 / 1): PASS`
- Repro: `quirks/wpt/alpha-decimals.html`
- Bug: none found
- Workaround: in Firefox `.gamut-fit-screen`'s search carries its chroma in a channel and uses alpha only as a flag of 0.25 or 0.75, which rounding keeps; `.gamut-color-layers` carries the alpha of the stack below in channels.

### Q5 Firefox: `color-mix()` whose percentages sum to 0% doesn't give the spec's color

- Feature: `color-mix`
- Spec: [CSS Color 5, color-mix()](https://drafts.csswg.org/css-color-5/#color-mix-result): “Interpolate a and b’s colors as described in CSS Color 4 § 13. Color Interpolation, with a progress percentage equal to (b’s percentage) / combined percentage), if combined percentage is greater than 0, and 0.5 otherwise.” (css-color-5) “Let alpha mult be 1 - leftover, interpreting leftover as a number between 0 and 1.” (css-color-5) “In this example, both percentages are zero, so their sum is also zero; thus, the alpha is zero and the color components are mixed 50% 50%: color-mix(in oklch, teal 0%, olive 0%);” (css-color-5); these give `color(srgb 0.5 0 0.5 / 0)`. WPT already tests it: `css/css-color/parsing/color-computed-color-mix-function.html`.
- Engines: Chrome PASS: `color(srgb 0.5 0 0.5 / 0)` · WebKit FAIL: `rgb(0, 255, 0)` · Firefox FAIL: `color(srgb 0 0 0 / 0)`
- Repro: `quirks/wpt/mix-zero-zero.html`
- Bug: https://bugs.webkit.org/show_bug.cgi?id=316215 (fixed 2026-06-04)
- Upstream: fixed in WebKit on its tracker, after the builds measured here; on wpt.fyi's stable run (Chrome 156.0.8078.47 PASS, Safari 27.0 PASS, Firefox 158.0.1 FAIL, 2026-10-23) its case is `css/css-color/parsing/color-computed-color-mix-function.html`'s subtest "Property color value 'color-mix(in srgb, red 0%,        blue 0%)'"
- Workaround: `.gamut-color-mix`: its last mix, at a total of 0%, has `calc()` percentages, which WebKit computes as transparent black instead of rejecting.

### Q14 Chrome: `color-mix()` in oklch drops the hue of a low-chroma color whose hue isn't powerless

- Feature: `color-mix`
- Spec: [CSS Color 4, powerless components](https://drafts.csswg.org/css-color-4/#powerless): “When performing color space conversion to a cylindrical polar color space, user agents shall treat a hue component as powerless if the chroma (or other measure of colorfulness, such as saturation in hsl) is less than or equal to the epsilon (ε) specified for that color space.” (css-color-4) “| Powerless hue ε | C <= 0.000004” (css-color-4) “| Powerless hue ε | C <= 0.0015” (css-color-4); these give `oklch(0.616561 0.056375 278.615933)`. No WPT test found for it.
- Engines: Chrome FAIL: `oklch(0.616559 0.0563893 200)` · WebKit PASS: `oklch(0.616561 0.056375 278.615906)` · Firefox PASS: `oklch(0.616561 0.0563753 278.616)`
- Repro: `quirks/wpt/grey-hue-dropped.html`
- Bug: https://issues.chromium.org/issues/565837690 (new)
- Workaround: `.gamut-color-interpolate` mixes with the browser's own `color-mix()`, so it follows Chrome there; in a stop's own stretch between its two positions, such a hue takes the next stop's.

### Q37 Firefox: `color-mix()` in display-p3 doesn't carry a missing r from srgb

- Feature: `color-mix`
- Spec: [CSS Color 4, analogous components](https://drafts.csswg.org/css-color-4/#analogous-components): “If any analogous components which are missing components are found, they will be carried forward and re-inserted in the converted color before premultiplication, and before linear interpolation takes place.” (css-color-4) “| Reds | r,x | Greens | g,y | Blues | b,z” (css-color-4) “Note: for the purposes of this classification, the XYZ spaces are considered super-saturated RGB spaces.” (css-color-4) “If a color with a carried forward missing component is interpolated with another color which is not missing that component, the missing component is treated as having the other color’s component value.” (css-color-4) “In the course of converting the two colors to the interpolation color space, any missing components would be replaced with the value 0.” (css-color-4); these give `color(display-p3 0.8 0.346124 0.218251)`. No WPT test found for it.
- Engines: Chrome PASS: `color(display-p3 0.8 0.346114 0.218241)` · WebKit PASS: `color(display-p3 0.8 0.346124 0.218251)` · Firefox FAIL: `color(display-p3 0.507542 0.346124 0.218251)`
- Repro: `quirks/wpt/rgb-carry.html`
- Bug: none found
- Workaround: met in `.gamut-color-mix`, which mixes with the browser's own `color-mix()`: no workaround.

### Q41 WebKit: `color-mix()` in hwb with a missing hue mixes off the spec

- Feature: `hwb`
- Spec: [CSS Color 4, interpolating with missing components](https://drafts.csswg.org/css-color-4/#interpolation-missing): “If any analogous components which are missing components are found, they will be carried forward and re-inserted in the converted color before premultiplication, and before linear interpolation takes place.” (css-color-4) “| Hue | H” (css-color-4) “If a color with a carried forward missing component is interpolated with another color which is not missing that component, the missing component is treated as having the other color’s component value.” (css-color-4) “For all other purposes, a missing component behaves as a zero value, in the appropriate unit for that component: 0, 0%, or 0deg.” (css-color-4); these give `color(srgb 0.321715 0.540977 0.75503)`. WPT already tests it: `css/css-color/parsing/color-computed-none.html`.
- Engines: Chrome FAIL: `color(srgb 0.571016 0.32169 0.75502)` · WebKit FAIL: `color(srgb 0.407553 0.510913 0.611817)` · Firefox PASS: `color(srgb 0.321715 0.540977 0.75503)`
- Repro: `quirks/wpt/hwb-none-hue.html`
- Bug: https://issues.chromium.org/issues/564362185 (fixed)
- Upstream: fixed in Chrome on its tracker, after the builds measured here
- Workaround: met in `.gamut-color-mix` in hwb, which mixes with the browser's own `color-mix()`: no workaround.

### Q42 Firefox: a grey converted between hsl and hwb gets hue 180 instead of a missing hue

- Feature: `hwb`
- Spec: [CSS Color 4, powerless components](https://drafts.csswg.org/css-color-4/#powerless): “However, if a color is automatically produced by color space conversion, then any powerless components in the result must instead be set to missing, instead of whatever value was produced by the conversion process.” (css-color-4) “Achromatic HWB colors no longer contain any hint of the chosen hue. In this case, the hue component is powerless.” (css-color-4) “If the saturation of an HSL color is 0% or 0, then the hue component is powerless.” (css-color-4); these give `color(srgb 0.725 0.55 0.375)`. WPT already tests it: `css/css-color/parsing/color-computed-powerless.html`.
- Engines: Chrome PASS: `color(srgb 0.725 0.55 0.375)` · WebKit PASS: `color(srgb 0.725 0.55 0.375)` · Firefox FAIL: `color(srgb 0.4625 0.725 0.375)`
- Repro: `quirks/wpt/grey-hue-180.html`
- Bug: https://bugzilla.mozilla.org/show_bug.cgi?id=2084587 (new)
- Workaround: met in `.gamut-color-mix` in hsl and hwb, which mixes with the browser's own `color-mix()`: no workaround.

### Q45 Chrome: `prophoto-rgb` has no linear part near black

- Feature: `color-function`
- Spec: [CSS Color 4, prophoto-rgb](https://drafts.csswg.org/css-color-4/#predefined-prophoto-rgb): “The transfer curve is a gamma function with a value of 1/1.8, and a small linear portion near black.” (css-color-4) “const E = 16/512; let sign = c < 0? -1 : 1; let abs = Math.abs(c); if (abs <= E) { cl = c / 16; } else { cl = sign * Math.pow(c, 1.8); }” (css-color-4) “c is the gamma-encoded red, green or blue component. cl is the corresponding linear-light component.” (css-color-4); these give `color(srgb-linear 0.625 0.625 0.625)`. No WPT test found for it.
- Engines: Chrome FAIL: `color(srgb-linear 0.251115 0.251219 0.251229)` · WebKit PASS: `color(srgb-linear 0.625 0.625 0.625)` · Firefox PASS: `color(srgb-linear 0.625 0.625 0.625)`
- Repro: `quirks/wpt/prophoto-toe.html`
- Bug: none found
- Workaround: `.gamut-color-extract`'s `extract-prophoto-rgb` writes the spec's curve itself, linear part included.

### Q71 WebKit: `color-mix()` with `longer hue` and a missing hue doesn't go round

- Feature: `color-mix`
- Spec: [CSS Color 4, hue interpolation](https://drafts.csswg.org/css-color-4/#hue-longer): “- fill in missing components with the other color’s component values - (if required) fixing up the hues, depending on the selected <hue-interpolation-method>” (css-color-4) “Angles are adjusted so that θ₂ - θ₁ ∈ {(-360, -180], [180, 360)}. In pseudo-Javascript: if (0 < θ₂ - θ₁ < 180) { θ₁ += 360; } else if (-180 < θ₂ - θ₁ <= 0) { θ₂ += 360; }” (css-color-4); these give `oklch(0.6 0.1 270)`. No WPT test found for it.
- Engines: Chrome PASS: `oklch(0.6 0.1 270)` · WebKit FAIL: `oklch(0.6 0.1 90)` · Firefox PASS: `oklch(0.6 0.1 270)`
- Repro: `quirks/wpt/longer-missing-hue.html`
- Bug: none found
- Workaround: `.gamut-fit-gradient` fills a missing or powerless hue at either end from the other end first (`color-mix(in oklch, A 100%, B 0%)`), as the spec's interpolation does; WebKit goes round with `longer` from two equal hues. `.gamut-color-mix` hands its hue method to the engine's `color-mix()`.

### Q74 WebKit: `mix-blend-mode: luminosity` with a white source paints off the spec

- Feature: `mix-blend-mode`
- Spec: [Compositing 1, luminosity](https://drafts.csswg.org/compositing-1/#blendingluminosity): “B(Cb, Cs) = SetLum(Cb, Lum(Cs))” (compositing-1) “ClipColor(C) L = Lum(C) n = min(Cred, Cgreen, Cblue) x = max(Cred, Cgreen, Cblue) if(n < 0) C = L + (((C - L) × L) / (L - n)) if(x > 1) C = L + (((C - L) × (1 - L)) / (x - L)) return C” (compositing-1) “Lum(C) = 0.3 x Cred + 0.59 x Cgreen + 0.11 x Cblue” (compositing-1); these give `255 255 255 at the midpoint, over rgb(128 192 144)`. No WPT test found for it.
- Engines: Chrome PASS: `within its fuzzy limits` · WebKit FAIL: `max difference 254, 10000 pixels` · Firefox PASS: `within its fuzzy limits`
- Repro: `quirks/wpt/luminosity-white.html`
- Bug: none found
- Workaround: `.gamut-color-layers` computes the blend itself.

### Q77 Firefox: a relative color from a `color-mix()` reads the mix's alpha to 3 decimals

- Feature: `color-mix`
- Spec: [CSS Color 4, serializing alpha](https://drafts.csswg.org/css-color-4/#serializing-modern-alpha-values): “For modern color syntax, the precision with which <alpha-value>s are retained, and thus the number of decimal places in the serialized value, is required to be sufficient to round-trip 16-bit decimal values.” (css-color-4); these give `color(srgb 0.8436 0 0)`. No WPT test found for it.
- Engines: Chrome PASS: `color(srgb 0.843608 0 0); the control, --e: color(from color(srgb 0 0 0 / 0.632812) srgb calc((alpha - 0.63) * 300) 0 0 / 1): PASS` · WebKit PASS: `color(srgb 0.843607 0 0); the control, --e: color(from color(srgb 0 0 0 / 0.632812) srgb calc((alpha - 0.63) * 300) 0 0 / 1): PASS` · Firefox FAIL: `color(srgb 0.900006 0 0); the control, --e: color(from color(srgb 0 0 0 / 0.632812) srgb calc((alpha - 0.63) * 300) 0 0 / 1): PASS`
- Repro: `quirks/wpt/mix-alpha-decimals.html`
- Bug: none found
- Workaround: `.gamut-color-layers` carries each number it reads back in a mix's channels, never its alpha; a stack whose alpha is under 0.15 is checked premultiplied: its output divides by the rounded alpha, 0.0005 / alpha a channel at most.
