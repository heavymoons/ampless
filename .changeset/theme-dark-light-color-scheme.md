---
"@ampless/runtime": minor
"@ampless/admin": minor
"create-ampless": minor
---

Dark / light theme support with a per-site override.

Every shipped theme already carried a dark palette via
`@media (prefers-color-scheme: dark)` blocks in `tokens.css`, but a site
admin had no way to override the visitor's system preference. The
rewrite turns the dark variant into a first-class part of every theme
and adds a per-site setting.

**What changes**

- **`tokens.css` (all 6 themes + globals defaults)**: rewritten to use
  the CSS `light-dark(L, D)` function. A single declaration covers
  both modes; the active `color-scheme` selects which value is
  rendered. `@media (prefers-color-scheme: dark)` blocks are removed
  (≈half the file size per theme).
- **`@ampless/runtime`**: `EffectiveThemeConfig` gains a
  `colorScheme: 'auto' | 'light' | 'dark'` field, validated against
  the site's stored override (`theme.colorScheme` in KvStore).
  Exports `ColorScheme`, `validateColorScheme`,
  `DEFAULT_COLOR_SCHEME`, and `COLOR_SCHEME_SETTING_KEY` for
  consumers.
- **Template `app/layout.tsx`**: writes `data-color-scheme` on
  `<html>` when the site has pinned `'light'` or `'dark'`. Omits the
  attribute for `'auto'` so the document inherits the
  `:root { color-scheme: light dark; }` default and the visitor's
  `prefers-color-scheme` wins.
- **Template `app/globals.css`**: adds the `:root` /
  `html[data-color-scheme=…]` opt-in block; default tokens converted
  to `light-dark()` so admin / non-theme pages also adapt.
- **`@ampless/admin`** theme settings page: new "Color scheme" select
  ("Auto / Light only / Dark only") above the per-theme manifest
  fields. Saves through the same KvStore path; selecting "Auto"
  deletes the override.

**Compatibility note: `light-dark()` requires browsers from 2024 or
later** (Baseline). Older browsers render only the light value, which
is acceptable for ampless's target.
