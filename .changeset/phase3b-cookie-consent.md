---
"@ampless/plugin-cookie-consent": minor
"ampless": patch
---

Add `@ampless/plugin-cookie-consent` — new GDPR/ePrivacy cookie consent banner plugin (Phase 3b PR C).

Installs `window.amplessConsent` Consent Convention API (`has` / `on` / `set`) in every public page and appends a configurable banner (`bannerText`, `acceptLabel`, `rejectLabel`, `position: bottom | top | modal`) to `<body>` outside the React tree. Consent state is persisted in `localStorage` under `ampless:consent`. Essential categories are always granted; non-essential categories gate analytics plugins via the `on()` subscriber pattern.

Uses `PluginRepeatableField` for the `categories` setting (Phase 3b PR A/B prerequisite): each category carries `id`, `label`, `description`, `defaultEnabled`, and `essential` sub-fields (up to 20 items).

The `ampless` patch ships the Consent Convention section added to `docs/architecture/08-plugin-architecture.md` and its Japanese translation, which travel in the `ampless` npm tarball.
