---
"ampless": minor
"@ampless/runtime": minor
"@ampless/admin": minor
"@ampless/plugin-analytics-ga4": minor
---

Phase 2 plugin extension: admin-managed public settings + `/admin/plugins` UI.

- `ampless`: add `PluginSettingsManifest` / `PluginSettingField` (8 field types: text / textarea / boolean / number / select / url / code / json), `AmplessPlugin.settings.public`, and `PluginPublicRenderContext.setting<T>(key)`. New helpers: `validatePluginSettingValue`, `resolvePluginSettings`, `isValidPluginKey`, `PLUGIN_KEY_PATTERN`. Plugin author guide ships in the npm tarball under `docs/plugin-author-guide.md`.
- `@ampless/runtime`: `createPluginSettings(storage)` reads admin-managed values from the `public/site-settings.json` cache; `Ampless.publicHead()` / `publicBodyEnd()` are now async and bind `ctx.setting<T>()` to a per-plugin snapshot. Empty / invalid stored values fall back to manifest defaults; fetch failures return an empty snapshot so the layout never crashes when storage is unconfigured.
- `@ampless/admin`: new `/admin/plugins` page factory, `PluginSettingsForm` component (touched-field tracking + "Reset to default" + ~8s delayed cache invalidation, mirroring the theme-settings form), `setPluginPublicSetting` / `deletePluginPublicSetting` / `loadPluginPublicSettings` helpers. Sidebar gains a "Plugins" entry. New i18n strings under `sidebar.plugins` / `plugins.*`.
- `@ampless/plugin-analytics-ga4`: declares `settings.public.measurementId` and reads the value via `ctx.setting()`. The constructor `measurementId` option is now optional (defaults to empty) and seeds the manifest's `default`; existing deployments keep their current behaviour while new ones configure the value from the admin UI.

Templates: `app/layout.tsx` awaits `publicHead()` / `publicBodyEnd()` via `Promise.all`. A scaffold copy of the author guide lands at `docs/plugin-author-guide.md` in every new project.

Breaking change: `Ampless.publicHead` and `Ampless.publicBodyEnd` switched from sync to async return. Template scaffolds are updated. External callers that interpolate them directly into JSX need to `await` (or use `Promise.all`) before render.
