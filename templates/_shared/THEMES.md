> 日本語版: [THEMES.ja.md](./THEMES.ja.md)
>
# THEMES.md

Working guide for customizing themes in an ampless project. Written
for AI coding agents and humans alike — keep it as your day-to-day
reference when designing or restyling a site.

All theme-related instructions live here. `AGENTS.md` / `AGENTS.ja.md`
deliberately keep only a one-line pointer back to this file.

## Ground rules

- Never edit the official themes directly.
- Keep customizations inside `themes/my-*/`.
- The shared shell (`app/`, `components/`, `lib/`) is touched only when
  the change genuinely can't be solved inside a theme.
- `themes-registry.ts` is auto-generated — don't hand-edit it.
- UI / theme changes are NOT done when type-checks pass. Always verify
  in a browser.

## Picking a base theme

Theme customization in ampless starts by copying an existing theme
into `themes/my-*/`. Deciding "which theme to start from" first keeps
the scope small — much smaller than deciding "what to build" first.

### `blog`

Personal blogs, journals, technical notes, short news commentary —
anything chronological where individual posts are the primary unit.

Out of the box:

- Post feed on the home page.
- Per-post detail page.
- Per-tag archive page.
- Header / footer nav.
- Wide tuning surface for colors, fonts, radii, pinned posts, etc.

Good fits:

- Personal-media feel.
- Adjusting the density of the post list.
- Strengthening typography on the detail page.
- Designing Markdown elements (tables, code, blockquotes) as part of
  the reading experience.

When in doubt, start from `blog`.

### `minimal`

Restrained, small-surface blog.

Out of the box:

- Few manifest customization fields.
- Minimal chrome.
- Design steps back so the posts take the lead.

Good fits:

- Light color / radius tweaks only.
- Layout largely untouched.
- Low-content sites.

If you want to redesign meaningfully, start from `blog` instead.

### `landing`

Single-page introduction sites.

Out of the box:

- Hero-centric layout.
- CTA button.
- Optional latest-posts strip.
- Site description and primary CTAs front and center.

Good fits:

- Products, events, portfolios, shop introductions.
- Sites that prioritize the first impression over a long post list.
- Letting an AI design the hero / CTA / feature sections.

### `corporate`

Company sites, firms, organizations.

Out of the box:

- Restrained hero.
- News / announcements list.
- Substantial header / footer.
- Footer disclaimer slot.

Good fits:

- Putting company overview / services up front.
- Managing news and announcements as posts.
- Trust, readability, maintainability as priorities.

### `docs`

Documentation sites.

Out of the box:

- Sidebar-driven navigation.
- Putting `tag:<name>` into a sidebar entry auto-expands the matching
  post list.
- Structure tuned for code fonts and technical writing.

Good fits:

- Help docs, specifications, developer reference.
- Categorizing posts by tag and surfacing them in the sidebar.
- Heavy use of Markdown code blocks and tables.

### `dads`

Public-sector sites following Japan's Digital Agency Design System.

Out of the box:

- High contrast.
- Accessibility-first.
- Restrained decoration.
- Built on `@digital-go-jp/tailwind-theme-plugin`.

Good fits:

- Government, municipal, public-sector information sites.
- Compliance and readability prioritized over a distinctive look.

Caveats:

- Reskinning to non-DADS palettes erodes the "DADS-compliant" claim.
- For public-sector work, don't take AI-suggested decorative changes
  at face value — keep accessibility first.

## Standard workflow

1. Copy an official theme.

   ```bash
   npm run copy-theme blog my-blog
   ```

   The `my-` prefix marks the copy as user-owned;
   `npm run update-ampless` leaves anything under `themes/my-*/` alone.

2. Implement inside the theme first.

   In priority order:

   - `themes/my-blog/tokens.css` — colors, fonts, spacing, rules,
     Markdown body styling.
   - `themes/my-blog/manifest.ts` — fields exposed to the admin UI.
   - `themes/my-blog/pages/` — per-route layouts (home / post / tag /
     feed / sitemap).
   - `themes/my-blog/components.tsx` (or similar) — shared UI used
     only within this theme. Header, footer, wordmark, and such can
     live here.

3. Activate the theme.

   Open `/admin/sites/<siteId>/theme`, select `my-blog`, save. Theme
   switching is a runtime setting — no redeploy required.

4. Verify.

   ```bash
   npm run dev
   npx tsc --noEmit
   npm run build
   npm run lint
   ```

   `npm run lint` runs the ESLint CLI. If the project's `lint` script
   still calls `next lint` (removed in Next.js 16), say so — but
   type-check, build, and browser verification still all have to pass.

## Design before you implement

Before changing a theme, decide in this order:

1. **Site role.** Personal blog? Technical notes? News commentary?
   Company site? Documentation? Landing page?
2. **Reading mode.** Slow reading of long-form posts? Fast scanning
   of a list? Strong hero impression? Search / tag discovery?
3. **Screen inventory.** At minimum, think through:
   - home
   - post detail
   - tag / archive
   - empty state
   - mobile home
   - mobile detail
4. **Change surface.** Is `tokens.css` enough? Does `pages/` structure
   change? Do you need a new theme-local component?
5. **Markdown.** For blog or docs themes, Markdown elements are part
   of the design — not afterthought.

### Order of operations

First, change what `tokens.css` can change:

- Colors
- Fonts
- Backgrounds
- Rules
- Spacing
- Prose / Markdown
- Responsive sizing

Then change `pages/`:

- Home structure.
- Post-list density.
- Post-detail spacing and meta.
- Tag / archive presentation.
- Empty state.

Last, extract repeated UI into theme-local components like
`components.tsx`.

Reach for shared `components/` or `app/` only when the change has to
be used across multiple themes.

## Working without Claude Design

Read the existing theme first. Don't restart from scratch.

What to read:

- `tokens.css` token structure.
- Public fields in `manifest.ts`.
- Data fetching and rendering responsibilities in `pages/home.tsx`,
  `pages/post.tsx`, `pages/tag.tsx`.
- `themes/<official-name>/README.*` if present — theme-specific intent.

How to proceed:

1. Decompose the requirements into "reading experience", "information
   density", "brand feel", and "content types".
2. Set the broad direction in `tokens.css`.
3. Change `pages/` only where needed.
4. Extract repeated chrome into theme-local components.
5. Always include Markdown elements in the design.

Markdown elements to check:

- Headings `h1` / `h2` / `h3`
- Paragraphs
- Lists
- Tables
- Blockquotes
- Inline code
- Code blocks
- Images
- Links

For reading-focused sites, body legibility is the top priority.
Express the design through the framing — spacing, rules, navigation,
list density, meta typography — not the body itself.

## Using AI for theme customization

Don't treat AI as a single "implement everything" tool. Accuracy goes
up when you split the work across roles.

A workable split:

- **Design exploration**: Claude Design, ChatGPT, image generation —
  produce a direction.
- **Implementation plan**: Codex / Claude Code reads the existing
  theme and decides which files reflect the plan.
- **Implementation**: edits inside the theme.
- **Verification**: Desktop / Mobile browser screenshots.
- **Polish**: overflow, empty states, Markdown, long titles.

### What to feed the AI

When you ask an AI to draft a theme, include:

- Site name.
- Site content.
- Audience.
- Primary post types.
- Vibes to avoid.
- Reference sites or screenshots.
- That both Desktop and Mobile are required.
- That home / archive / detail / empty-state are all required.
- That Markdown — tables, lists, code, blockquotes — is in scope.

Example:

```text
Design a theme for ishinao.net, a personal blog. The content is
day-to-day life, technical notes, and short news commentary.
Body legibility is the top priority because this is a reading site,
but the home, archive, header, and meta deserve real design.
Produce Top-empty, Top-with-content, Archive, and Detail for both
Desktop and Mobile. Markdown tables, lists, blockquotes, and code
blocks should sit cleanly inside the theme's world.
```

### Don't trust AI output verbatim

Common gaps in AI-produced themes:

- Desktop looks great; Mobile breaks.
- Hero is polished but post detail looks generic.
- Decoration wins over body legibility.
- Markdown tables / code aren't designed.
- No empty state.
- Long real-world Japanese titles overflow.
- Spacing / type sizes drift between mockup and implementation.

Treat AI output as a **visual spec**, not finished code.

## Using Claude Design

Claude Design output HTML is usually a collection of artboards across
multiple screens, not a single finished site. Don't port the HTML
verbatim — extract the design intent per screen and map it onto the
ampless theme structure.

### Reading the output

First, classify the artboards by screen from the HTML or screenshots:

- Desktop / Top empty
- Desktop / Top with content
- Desktop / Archive list
- Desktop / Detail
- Mobile / Top
- Mobile / Archive
- Mobile / Detail

Then pull the shared tokens out of each screen:

- Background color
- Accent color
- Rule color
- Font family
- Heading size relationships
- Body line-height
- List density
- Spacing unit
- Header / footer chrome
- Mobile widths, padding, line breaks, info-elision rules

Don't implement from a single artboard in isolation. Look at Desktop
and Mobile together to see how the same UI transforms.

### Mapping to ampless

Map Claude Design screens onto the ampless theme structure:

- Top / Home → `themes/my-blog/pages/home.tsx`
- Detail / Article → `themes/my-blog/pages/post.tsx`
- Archive / Tag / List → `themes/my-blog/pages/tag.tsx`
- Shared header / wordmark / footer →
  `themes/my-blog/components.tsx`
- Colors, fonts, grid, prose, responsive → `themes/my-blog/tokens.css`
- Values exposed in the admin UI → `themes/my-blog/manifest.ts`

Don't copy generated code or inline styles wholesale. What you need
is the design rules, not the implementation.

### Implementation tips

Extract by hand from the Claude Design HTML:

- Screen types.
- Shared tokens.
- Layout grid.
- Heading size scale.
- List row height, rule treatment, meta position.
- Mobile elision / vertical stacking / size changes.
- Empty-state handling.

On the ampless side, slot those into:

- Shared design language → `tokens.css`
- Screen structure → `pages/*.tsx`
- Repeating UI → theme-local `components.tsx`
- Admin-editable values → `manifest.ts`

If a Claude Design board carries multiple states, note them first.
Example:

```text
Final - ishinao.net theme
- Top empty
- Top with content
- Archive list
- Detail editorial body
- Mobile top empty
- Mobile top with content
- Mobile archive
- Mobile detail
```

Treat the list as your implementation checklist.

### Claude Design reflection checklist

- Implemented both Desktop and Mobile?
- Handled both empty and populated states?
- Same design language flows through list / detail / tag pages?
- Wordmark, nav, meta, rules, background treated consistently?
- No horizontal scroll or text overflow on mobile?
- Long Japanese titles don't break the layout?
- 1 / many / no-tag / multi-tag posts all render cleanly?
- Markdown tables / code blocks don't float outside the theme world?

## Using other AI tools (no Claude Design)

You can still get a lot out of AI without Claude Design.

### Ask in text

Have the AI write a design spec first:

```text
Based on the blog theme, draft a theme spec for a personal technical
blog. Output is a written spec — not code — split across tokens,
home, post detail, tag archive, mobile rules, and Markdown styling.
Body legibility is the top priority; decoration lives in the chrome
and lists.
```

Then hand the spec to Codex / Claude Code for implementation.

### Use reference images / screenshots

If you have reference imagery, have the AI extract:

- Colors.
- Font vibes.
- Spacing.
- Rules.
- Information density.
- Desktop / Mobile differences.
- What should land in `tokens.css`.
- Whether `pages/` structure has to change.

### Asking AI to implement

Phrase the implementation ask narrowly:

```text
Edit only themes/my-blog. Don't touch shared app / components / lib.
Read the existing theme first to learn the tokens.css / pages /
manifest responsibilities. Verify Desktop 1440px and Mobile 390px in
the browser. Style Markdown tables, lists, blockquotes, and code
blocks consistently with the theme.
```

A vague "make it look good" prompt is how you end up with shared
files edited and Mobile forgotten.

## Browser verification

UI / theme changes need a real dev server. Open the actual pages.

```bash
npm run dev
```

Representative widths:

- Desktop: `1440 x 1100`
- Mobile: `390 x 844`

When taking screenshots, append a query string to bypass any
intermediate cache:

```text
http://localhost:3000/?v=theme-check-1
```

What to look for:

- First impression matches the reference direction.
- Text doesn't overflow its parent.
- No horizontal scroll on mobile.
- Background, rules, spacing, and type scale all feel right at the
  width.
- Body contrast and line-height are comfortable to read.
- Empty link / tag / nav / footer configurations don't leave dead
  chrome behind.

## Custom classes for posts and tables

A theme can declare named styles for a whole post or a table.

1. Declare them in `manifest.ts`. The id uses lowercase letters, digits
   and hyphens:

   ```ts
   customClasses: [
     { id: 'wide', label: { en: 'Wide', ja: 'ワイド' }, target: 'post' },
     { id: 'compact', label: { en: 'Compact', ja: 'コンパクト' }, target: 'table' },
   ],
   ```

2. Style them in `tokens.css`. A post class renders as
   `ampless-post--<id>` on the post body wrapper; a table class renders
   as `tiptap-table--<id>` on the table. Scope the rules under
   `[data-theme='my-blog']` if they should apply only while this theme
   is active:

   ```css
   [data-theme='my-blog'] .ampless-post--wide { max-width: none; }
   [data-theme='my-blog'] .tiptap-table--compact td { padding: 0.25rem 0.5rem; }
   ```

3. Build the post body wrapper's class with `ampless.postBodyClassName`
   in `pages/post.tsx` (the bundled themes already do):

   ```tsx
   <div id="post-body" className={ampless.postBodyClassName(post, 'prose max-w-none')}>
     {await ampless.renderBody(post)}
   </div>
   ```

Post classes are read from the post's metadata key
`ampless:postClasses`, and only when its value has this exact shape:

```json
{ "ampless:postClasses": { "kind": "ampless.post-classes", "version": 1, "ids": ["wide"] } }
```

Posts without it render the base classes unchanged. A plain
`postClasses` key, or any other value under `ampless:postClasses`, is
never read, so data that themes or plugins stored there earlier does not
change how existing posts render. Invalid ids are dropped when the page
renders.

Static posts (`format: 'static'`) and no_layout HTML posts
(`format: 'html'` with `metadata.no_layout: true`) never get post
classes. Their own URLs don't use the theme's post body wrapper, and
`postBodyClassName` returns the base classes for them everywhere else
too, for example when the home page shows one as its featured post. Ids that a post stores but the active theme does
not declare (for example after a theme switch) still render, unstyled.

### Setting post classes

- **Admin editor**: the post form shows a "Post classes" checkbox group
  with the active theme's `target: 'post'` classes (hidden for static
  and no_layout HTML posts, and when the theme declares none and the
  post has none). Ids a post already has but the theme does not declare
  are listed as "not in current theme" and can be unchecked. Saving
  rewrites only `ampless:postClasses` (other metadata keys are kept
  as-is); when the selection did not change, the stored value is left
  exactly as it was. If `ampless:postClasses` holds a value ampless did
  not write, the form shows a notice, does not let you edit post
  classes, and leaves that value untouched. Restoring a revision brings
  back its post classes but no other revision metadata. The admin
  preview applies the selected classes to its `<main>` wrapper.
- **MCP**: `set_post_classes` changes only the post classes and keeps
  every other metadata key. Use `{ postId, add?, remove? }` to add or
  remove ids, or `{ postId, ids, expectedVersion }` to replace the whole
  list (`ids` requires the `version` from `get_post`). It refuses static
  and no_layout HTML posts and values ampless did not write. MCP cannot
  see the active theme, so it only checks the id syntax. `update_post`
  still replaces `metadata` as a whole and rejects a tagged value with
  invalid ids.

### Concurrent edits

A post's `updatedAt` is stamped with millisecond precision, so two saves
in the same millisecond can leave it unchanged; it is not a safe version
number on its own. The admin editor, `set_post_classes` and `update_post`
with `expectedVersion` therefore save through the
`amplessUpdatePostIfUnchanged` mutation: one database write that only
happens if `updatedAt` **and** the post fields the writer read are all
still the same, and that always sets a strictly newer `updatedAt`.

- **Admin editor**: saving an existing post fails with a conflict message
  if anything about the post changed since the editor opened it (another
  tab, another editor, an MCP client, a direct GraphQL write), even
  within the same millisecond. Nothing is written. Your edits stay in the
  browser's local draft; reload the page and choose "Restore anyway".
  Static posts have no local draft, and a static post saved with a new
  bundle is not protected this way (see below).
- **MCP**: `get_post` (and every tool that returns a whole post) returns
  a `version`: `v1:` plus a SHA-256 hash of the post's content (every
  returned field, `updatedAt` included). Any change to the post changes
  it, even one that leaves `updatedAt` unchanged. Pass it as
  `expectedVersion` to `update_post` or `set_post_classes`: the tool
  reads the post again, fails with a conflict unless that read still has
  your version, and then writes conditioned on every field of that read.
  So a write with `expectedVersion` never overwrites a change made after
  the read you took the version from, including a same-millisecond write
  by a stock or older writer. On a conflict nothing is saved; call
  `get_post` again, redo your change and retry. `set_post_classes` with
  `add` / `remove` and no `expectedVersion` writes conditioned on the
  metadata, format and `updatedAt` it read, and on a conflict reads the
  post again and re-applies the same additions and removals (3 attempts
  in total). This is safe because adding and removing ids gives the same
  result on top of whatever the other writer changed. `ids` (a full
  replacement) is refused without `expectedVersion`, because a list
  computed from an earlier read would undo a concurrent change.
  `list_posts` summaries have no `version`; call `get_post` for it.

What is **not** protected:

- Unconditional writers can still overwrite anything, including changes
  the guarded writers made: `update_post` without `expectedVersion`, the
  static bundle tools, older admin builds, and any other direct GraphQL
  `updatePost` call.
- Concurrent static bundle saves are **not** made safe (the static
  concurrency requirement of heavymoons/ampless#411 is not addressed; it needs a
  separately reviewed design). Saving a static post with a new bundle,
  from the admin editor or the MCP static tools, overwrites the slug's
  bundle files in place and then writes the post unconditionally. The
  editor only checks for a conflict before uploading; an edit, delete or
  other upload landing during the upload is overwritten or mixed.
- The revision history keys snapshots by `updatedAt`. A guarded write
  always gets a new one, so a snapshot can only be lost when an
  unconditional writer saves in the same millisecond as another write.

The mutation needs `create-ampless upgrade` (it ships
`amplify/data/update-post-if-unchanged.js` and wires it in
`amplify/data/resource.ts`) and a redeploy. Until then: the MCP tools
above fail with nothing saved, and the admin editor falls back to the
previous unconditional save, sent **without** the metadata field so the
stored metadata (post classes included) is not touched. Switching an
HTML post with the no-layout setting to another format is saved the same
way: the setting stays stored but has no effect, because it only applies
to HTML posts (the editor shows it again if the post is switched back to
HTML). A save that changes post classes, or turns the no-layout setting
on or off for an HTML post, is refused instead, with nothing saved.

## Theme-local components

Theme-specific shared UI belongs in the theme, e.g.
`themes/my-blog/components.tsx`.

Good candidates:

- Header
- Footer
- Wordmark
- Post row
- Meta block
- Theme-specific decorative UI

Put something in shared `components/` only when it has to be reused
across multiple themes or by the admin UI.

## Common failure modes

- Implementing only the first Claude Design thumbnail you opened.
- Hugging Desktop and missing the Mobile artboards.
- Editing shared `components/` for a change `tokens.css` could have
  handled.
- Editing the official `themes/blog/` directly.
- Leaving Markdown tables, blockquotes, and code blocks unstyled.
- Calling a change "done" because the build passed, with no browser
  check.
- Empty footer / nav configurations still rendering empty chrome.
