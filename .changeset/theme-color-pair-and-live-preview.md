---
"ampless": minor
"@ampless/runtime": minor
"@ampless/admin": minor
"create-ampless": patch
---

Three follow-ups to the dark / light theme support shipped earlier:

1. **Custom colour overrides accept a light / dark pair.** Every color
   field on the theme settings page now has an opt-in "Add dark
   variant" toggle. When set, the value is stored as
   `light-dark(L, D)`, which the runtime pastes verbatim into the
   inline `:root { --foo: ... }` override — the browser then picks
   between the two per active `color-scheme`. Stored value parsing
   and validation handle both single-form (existing) and pair-form
   (new); the validator splits on the top-level comma so nested
   `rgb(r, g, b)` / `hsl(...)` commas don't trip it.

2. **Colour picker now starts on the current value.** The previous
   canvas-based hex round-trip relied on `ctx.fillStyle` parsing,
   which silently kept the reset value when oklch parsing failed on
   some browsers — surfacing as a picker stuck on black. The new
   `useColorAsHex` initialises from `#rrggbb` synchronously and then
   resolves any non-hex form via `getComputedStyle` in `useEffect`,
   so the swatch always reflects the saved colour after mount.

3. **Iframe preview now reflects the unsaved colour-scheme.**
   Middleware forwards `?previewColorScheme=<mode>` as the
   `x-preview-color-scheme` header; the root layout uses it to
   override the saved `theme.colorScheme` for the duration of that
   request. The admin form's iframe `key` and `src` now include the
   pending colorScheme so changing the select live-updates the
   preview.

`ampless` exports `parseColorPair` and `formatColorPair` helpers.
