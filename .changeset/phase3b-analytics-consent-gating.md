---
"@ampless/plugin-analytics-ga4": minor
"@ampless/plugin-gtm": minor
"@ampless/plugin-plausible": minor
---

Add `consentCategory` option and gated mode to all three first-party analytics plugins.

When `consentCategory` is set to a non-empty slug, the plugin switches to **gated mode**: instead of emitting its standard script descriptor(s), it emits a single inline script that defers loading until `window.amplessConsent.has(category)` returns true. This requires `@ampless/plugin-cookie-consent` to be registered in the same `cms.config.ts`.

Behaviour by plugin:

- **GA4**: the two standard descriptors (external loader + inline init) collapse into one `inlineScript` that dynamically creates the `gtag/js` loader and runs the `dataLayer` / `gtag('config', ...)` bootstrap after consent.
- **Plausible**: the single external `<script>` descriptor is replaced by one `inlineScript` that dynamically inserts the Plausible loader with `src`, `defer`, and `data-domain` after consent.
- **GTM**: the inline loader script is replaced by one `inlineScript` that dynamically inserts the GTM loader after consent. The `<noscript>` fallback (`publicBodyEnd`) is suppressed in gated mode — JavaScript-less environments cannot run the consent UI, so suppressing fallback tracking is the correct trade-off.

All three plugins implement the same fail-closed contract: if `consentCategory` is set but `window.amplessConsent` is never installed, the analytics script never fires and a `console.warn` is emitted after 5 seconds.

Empty string (the default) leaves existing behaviour completely unchanged — zero regression for sites not using cookie-consent.
