---
"@ampless/admin": minor
"create-ampless": patch
---

`/admin/sites/<id>` and `/admin/sites/<id>/theme` were 500-ing on every
deployed scaffold with the error

> [@ampless/admin] createAdmin was called without an `ampless` runtime
> instance, but a method that needs one (loadSiteSettings /
> loadThemeConfig) was invoked.

…because the scaffolded `lib/admin.ts` intentionally omitted `ampless`
to avoid a static-import cycle
(`lib/admin.ts → lib/ampless.ts → themes-registry → themes →
lib/i18n.ts → lib/admin.ts`) that TDZ-throws on `ampless` at module
init. The comment said `createAdmin` would build its own internal
Ampless when the option is omitted, but it doesn't — the methods just
throw at request time.

Fix in two parts:

1. **`@ampless/admin`**: `CreateAdminOpts.ampless` now also accepts a
   thunk: `Ampless | (() => Ampless | Promise<Ampless>)`. The thunk is
   invoked lazily on the first `loadSiteSettings` / `loadThemeConfig`
   call and the resolved instance is cached. When the thunk form is
   used, `admin.ampless` is exposed as `null` (no synchronous access
   path) — call `admin.loadSiteSettings()` etc. instead.

2. **Template `lib/admin.ts`**: switch to the thunk form using a
   dynamic `import()` so no static import of `./ampless` is emitted.
   `lib/ampless.ts` only loads on the first sites/theme settings call
   (request time), well after every module has finished initialising,
   so the TDZ cycle never triggers.
