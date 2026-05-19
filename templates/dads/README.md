# {{siteName}}

DADS theme — built on the official **[Digital Agency Design System Tailwind plugin](https://github.com/digital-go-jp/tailwind-theme-plugin)** (`@digital-go-jp/tailwind-theme-plugin`, MIT). Color palette and typography conform to DADS specifications, suitable for Japanese government / public-sector / institutional sites.

## What's plugin-backed

- **Color palette** — `solidBlue` (`#0017c1`) as primary, plus the full DADS scale (light-blue, cyan, green, lime, yellow, orange, red, magenta) accessible as Tailwind classes (`bg-blue-900`, `text-blue-50`, etc.)
- **Typography** — `fontFamily.sans` set to Noto Sans JP via the plugin; surfaced through `--ampless-body-font`
- **Border radii** — `rounded-4` / `rounded-6` available

`templates/dads/tokens.css` binds the plugin's CSS variables (`--color-blue-900` etc.) to ampless's standard theme variables (`--primary`, `--background`, ...) so all shared chrome (SiteHeader, SiteFooter, shadcn buttons, etc.) automatically renders in DADS colors.

When DADS publishes a new palette version, bumping `@digital-go-jp/tailwind-theme-plugin` in `package.json` is enough — the theme picks it up.

## Customizing

In `/admin/sites/<siteId>/theme`:

- **Logo image URL** — branding (organization mark)
- **Primary color** — defaults to DADS solidBlue. Changing to a non-DADS color makes the site no longer DADS-conformant.
- **Top story slug** — feature one published post between hero and news
- **Header navigation / Footer links / Footer legend**

## Notes

- Dark mode uses an inverted approximation. DADS doesn't ship an official dark palette as of plugin 0.3.4; when one lands, update `templates/dads/tokens.css` to bind the dark variables.
- The plugin only provides design tokens. For full DADS components (buttons, alerts, tabs, etc.), see [design-system-example-components](https://github.com/digital-go-jp/design-system-example-components) and adapt as needed.

## Getting started

```bash
npm install
npm run sandbox
```
