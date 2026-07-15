---
"create-ampless": patch
"@ampless/plugin-ai-actions": patch
"@ampless/plugin-reading-time": patch
---

Add default styling for the `.ampless-ai-actions` and `.ampless-reading-time` plugin hooks.

`publicHtmlForPost` output (used by `@ampless/plugin-ai-actions` and `@ampless/plugin-reading-time`) renders outside `.prose`, as a sibling of the post body, so it inherited no typography. No first-party theme styled the hook classes, so on every theme the AI-actions links and the reading-time badge looked identical to regular body text.

`templates/_shared/app/globals.css` now ships a small set of `:where()` (zero-specificity) rules for both classes: the AI-actions links render as pill-shaped buttons, and the reading-time badge renders as small muted text. Colors reference the existing theme CSS variables (`--muted-foreground`, `--border`, `--foreground`), so both light and dark mode resolve correctly on all six bundled themes (blog/docs/corporate/dads/landing/minimal) as well as fork themes. Because every selector uses `:where()`, any theme `tokens.css` or site CSS with normal specificity still wins outright.

Sites that don't use either plugin see no visual change.

Also updates both plugins' READMEs (English + Japanese) to reflect that a default style now ships instead of "No default styling is injected".
