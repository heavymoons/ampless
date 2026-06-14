---
'@ampless/plugin-mermaid': minor
'@ampless/plugin-highlight': minor
---

Make both plugins auto-adapt to the site's light/dark color scheme so diagram and code text stay readable on a dark background.

The default `theme` is now the sentinel `'auto'` for both plugins. In `'auto'` mode the plugin resolves the theme at runtime from the site's color scheme:

- **`@ampless/plugin-mermaid`** — `default` on a light scheme, `dark` on a dark scheme. Because mermaid bakes the theme into the rendered SVG, each diagram keeps its source on a `data-mermaid-src` attribute and is re-rendered in place when the scheme changes.
- **`@ampless/plugin-highlight`** — `github` on a light scheme, `github-dark` on a dark scheme. The `<link>` stylesheet is swapped in place (flash-free, with the new stylesheet loaded before the old one is removed); the `hljs` classes stay, so no re-highlight is needed.

The scheme is read from the `<html data-color-scheme>` attribute (`'light'` / `'dark'`); when absent (site setting `auto`) it follows the OS `prefers-color-scheme`. Live switching is wired for both an in-site toggle (a `data-color-scheme` `MutationObserver`) and, in `auto` mode, an OS preference change (`matchMedia`). Pages with no diagram / code block never download the library or stylesheet on a scheme change.

Behavior change: light-page output is unchanged from the previous `default` / `github` defaults, but dark and `auto` pages now adapt instead of rendering a low-contrast light theme. Passing an explicit theme (e.g. `theme: 'dark'` / `theme: 'github-dark'`) pins it as before and disables the live re-render/swap.
