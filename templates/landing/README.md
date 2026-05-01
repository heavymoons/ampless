# {{siteName}}

A site powered by [ampless](https://github.com/heavymoons/ampless), using the **Landing** theme — hero-led single-page layout with optional "Latest" post grid, configurable header / footer nav, and a warm-coral accent palette.

## Customizing

In `/admin/sites/<siteId>/theme`:

- Hero headline / subheadline / CTA button text + URL
- Header navigation (label + URL pairs)
- Footer links
- Primary color
- Corner radius

Empty hero fields fall back to the site name / description from `/admin/sites/<siteId>`.

## Getting started

```bash
npm install
npx ampx sandbox       # provision the AWS backend
npm run dev            # start Next.js
```

See the project README for full setup.
