---
"@ampless/admin": minor
---

Admin sidebar brand shows the site name (falls back to "ampless")

The sidebar now shows `settings.site.name` as the primary line (font-semibold, truncate) with "ampless" as a small muted subtitle, at both the mobile top bar and the desktop rail. When the site name is unavailable or empty, the existing brand-only display is preserved as a graceful fallback.
