> 日本語版: [README.ja.md](./README.ja.md)
> 
# Docs theme

Sidebar-led documentation layout. The sidebar combines plain links with **tag-driven sections** — a sidebar entry of the form `tag:<name>` auto-expands into a list of every published post with that tag. Lets writers organize content by tag and have it appear in nav automatically.

## Customizing

In `/admin/sites/<siteId>/theme`:

- **Primary color**
- **Corner radius**
- **Code font** — System monospace / JetBrains Mono
- **Sidebar navigation** — each row is `Label` + `URL`. The URL can be:
  - a path (`/getting-started`)
  - an external URL (`https://...`)
  - a tag reference (`tag:tutorials`) → renders as a heading + list of tagged posts
- **Logo image URL**
- **Header navigation** — top-level links
- **Footer links** — label + URL pairs

## Authoring tip

Tag a post `guide` (in the post editor) and add a sidebar row with URL `tag:guide`. The sidebar will list that post automatically — no manual link editing every time you publish.
