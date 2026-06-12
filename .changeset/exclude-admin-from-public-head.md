---
"@ampless/runtime": patch
"ampless": patch
---

Skip `publicHead` and `publicBodyEnd` rendering on admin-owned traffic. The runtime now requires a middleware-set pathname marker before emitting site-wide head/body plugin descriptors, and it suppresses them for `/admin`, `/login`, and theme preview iframe requests (`?previewTheme=` / `?previewColorScheme=`). This keeps GTM, GA, and consent scripts off admin page views and live preview traffic while preserving normal public-page rendering.

Sites with custom middleware matchers should keep public routes covered by the ampless middleware; routes excluded from the matcher will not emit `publicHead` / `publicBodyEnd` descriptors.
