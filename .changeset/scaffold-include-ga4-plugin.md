---
"create-ampless": patch
---

Include `@ampless/plugin-analytics-ga4` in the scaffold default dependencies. The plugin lands in scaffolded sites as an installed-but-not-registered package — adding it to the `cms.config.ts` `plugins` array activates it (a commented-out example is included alongside `webhookPlugin` / `ogImagePlugin`).

This also lets `create-ampless upgrade` keep the GA4 plugin version in sync. The upgrade flow only touches dependencies that are listed in the template `package.json`; without this entry, users who installed GA4 manually under Phase 1 (`^0.1.x` range) would stay pinned to that range and miss the Phase 2 settings-manifest API (the `/admin/plugins` page would show "no configurable plugins" because the loaded plugin lacks `settings.public`).
