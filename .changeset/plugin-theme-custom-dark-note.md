---
"@ampless/plugin-mermaid": patch
"@ampless/plugin-highlight": patch
---

Docs: note that `theme: 'auto'` keys off the `data-color-scheme` / `prefers-color-scheme` signal, not the theme's visual darkness. With a custom theme that renders dark but doesn't set `data-color-scheme="dark"` on `<html>`, pin `theme: 'dark'` (mermaid) / `theme: 'github-dark'` (highlight) so the diagram/code colors match the dark background.
