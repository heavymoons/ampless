---
"ampless": patch
"@ampless/runtime": patch
---

Document the `noscript` descriptor variant as an intentional
raw-HTML escape hatch. The type comment previously said only
"Raw HTML emitted inside `<noscript>`" without explaining the
spec/safety implication; the doc now spells out:

- The variant uses React `dangerouslySetInnerHTML`.
- It is intended for trusted plugin authors whose tier already
  allows `inlineScript`. Untrusted plugin output should not
  flow here.
- Plugin authors are responsible for not embedding
  `</noscript>` sequences that break out of the element.

Pure documentation change on the existing type — no behavior
change. A regression test in `@ampless/runtime` now pins the
current "raw HTML passthrough" behavior so any future move to
sanitization becomes a deliberate, reviewed change.
