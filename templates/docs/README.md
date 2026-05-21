> 日本語版: [README.ja.md](./README.ja.md)
> 

# {{siteName}}

Docs theme: sidebar-led documentation layout. The sidebar combines plain links with **tag-driven sections** — entering a URL like `tag:guide` in the sidebar nav field auto-expands to a list of every published post tagged "guide". Lets writers organize content by tag and have it appear in nav automatically.

## Customizing

In `/admin/sites/<siteId>/theme`:

- **Sidebar navigation** — each row is `Label` + `URL`. The URL can be:
  - a path (`/getting-started`)
  - an external URL (`https://...`)
  - a tag reference (`tag:tutorials`) → renders as a heading + list of tagged posts
- Header navigation (top-level links)
- Code font (system mono / JetBrains Mono / etc.)
- Primary color, corner radius

## Authoring tip

Tag a post `guide` (in the post editor) and add a sidebar row with URL `tag:guide`. The sidebar will list that post automatically — no manual link editing every time you publish.

## Getting started

```bash
npm install
npm run sandbox
```
