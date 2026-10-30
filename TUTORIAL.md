# gamutant: tutorial

You build one page: a vivid green fitted to the screen, text that reads on it, and five tints of it.

## Before you start

- A browser. This page is checked in Chrome 155, WebKit 26.4 and Firefox 158.
- `gamutant.css` from this repository, in a new folder.
- A new file in that folder, `page.html`.

## 1. Link the sheet

Write the page's start, with the sheet linked and a few styles of your own:

```html
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>A green that fits</title>
<link rel="stylesheet" href="gamutant.css">
<style>
  body { font: 18px/1.5 system-ui, sans-serif; margin: 2rem; }
</style>
```

Open it in the browser. The page is empty: the sheet does nothing until an element asks for a part by its class.

## 2. Fit a vivid color to the screen

`oklch(0.7 0.3 150)` is a green past what most screens show. A browser paints it by clipping each channel, which moves
its hue: on an sRGB screen it paints `#00CB00`. The class `.gamut-fit-screen` maps it the way CSS Color 4's text describes: it lowers
the chroma at the color's own lightness and hue until a clip would move it less than the eye can tell, then clips, and
writes the result to `--gamut-out`.

Add a style for the box, and the box:

```html
<style>
  .gamut-fit-screen { background: var(--gamut-out); padding: 1.5rem; border-radius: 12px; }
</style>
<div class="gamut-fit-screen" style="--gamut-in: oklch(0.7 0.3 150)">
</div>
```

Reload. On an sRGB screen the box is `#00C248`, a little darker and bluer than the clipped green, and nearer the hue you asked for (147°
against the clip's 142°, for 150°). On a Display P3 screen it is mapped to P3, which holds more of it.

## 3. Add text that reads on it

The class `.gamut-readable-text` makes a text color from a background: the background's own green, mixed toward black or white
until it reaches a WCAG 2 contrast ratio. It reads `--gamut-bg` and `--gamut-ratio` (4.5 unless you set it: set it on an ancestor,
as a page's `prefers-contrast` rule does, and every `.gamut-readable-text` below takes it) and writes `--gamut-text`.

Put a paragraph inside the box, so it inherits the box's `--gamut-out`:

```html
<style>
  .gamut-readable-text { color: var(--gamut-text); margin: 0; }
</style>
<div class="gamut-fit-screen" style="--gamut-in: oklch(0.7 0.3 150)">
  <p class="gamut-readable-text" style="--gamut-bg: var(--gamut-out)">A green past sRGB, fitted to the screen.</p>
</div>
```

Reload. The text is a dark green, `#004815`, at 4.55:1 on the box. The paragraph reads the box's `--gamut-out`, which it
inherits. The two parts could also share the box, `class="gamut-fit-screen gamut-readable-text"`, since they write different results.

## 4. Make five tints

The class `.gamut-palette-step` makes one tint per element, from light to dark down a list: Material 3's tonal palette of the
color. Each step reads the list's `--gamut-in` and its own place in the list, and writes `--gamut-out`.

```html
<style>
  ul { display: flex; gap: 6px; padding: 0; list-style: none; }
  .gamut-palette-step { flex: 1; height: 48px; border-radius: 6px; background: var(--gamut-out); }
</style>
<ul style="--gamut-in: oklch(0.7 0.3 150)">
  <li class="gamut-palette-step"></li><li class="gamut-palette-step"></li><li class="gamut-palette-step"></li><li class="gamut-palette-step"></li><li class="gamut-palette-step"></li>
</ul>
```

Reload. Five greens run from `#C6FFC5` to `#002107`, tones 95, 73.75, 52.5, 31.25 and 10 of the green's HCT hue (Material's, not OkLCh's), each with the
green's chroma or the most sRGB holds at its tone. Add or remove an item and the steps spread again over the new count. To
give a step a tone of your own, Material's 40 or a tone you print on it, set `--gamut-tone: 40` on that item.

## 5. Keep the same hex on every screen

The box maps to the screen it is on, so a Display P3 screen shows a different green than an sRGB one. To get the
same `#00C248` everywhere, name the target gamut on an ancestor, here the root:

```html
<style>
  :root { --gamut-target: srgb; }
</style>
```

The whole page, as it ends:

```html
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>A green that fits</title>
<link rel="stylesheet" href="gamutant.css">
<style>
  :root { --gamut-target: srgb; }
  body { font: 18px/1.5 system-ui, sans-serif; margin: 2rem; }
  .gamut-fit-screen { background: var(--gamut-out); padding: 1.5rem; border-radius: 12px; }
  .gamut-readable-text { color: var(--gamut-text); margin: 0; }
  ul { display: flex; gap: 6px; padding: 0; list-style: none; }
  .gamut-palette-step { flex: 1; height: 48px; border-radius: 6px; background: var(--gamut-out); }
</style>
<div class="gamut-fit-screen" style="--gamut-in: oklch(0.7 0.3 150)">
  <p class="gamut-readable-text" style="--gamut-bg: var(--gamut-out)">A green past sRGB, fitted to the screen.</p>
</div>
<ul style="--gamut-in: oklch(0.7 0.3 150)">
  <li class="gamut-palette-step"></li><li class="gamut-palette-step"></li><li class="gamut-palette-step"></li><li class="gamut-palette-step"></li><li class="gamut-palette-step"></li>
</ul>
</html>
```

Reload. The box is `#00C248` and the five tints the same on every screen. Read in script, `getComputedStyle()` gives the box's color in linear light, `color(srgb-linear …)`: the same color, written another way, not a hex. The text is worked out for the screen it is on, so it could differ on a wide-gamut one; here it is `#004815` on an sRGB screen and on a Display P3 one alike.


## Next

- [CSS Color 4 §14: Gamut Mapping](https://drafts.csswg.org/css-color-4/#gamut-mapping)
