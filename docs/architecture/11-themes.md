> 日本語版: [11-themes.ja.md](./11-themes.ja.md)
> 
## 11. Themes

### Design Philosophy

Themes are handled within the same framework as plugins.
Installation, switching, and preview from the admin UI are supported — no npm or git push required.

Theme = layout (template structure) + style (CSS) + customization schema.

### Theme Components

```typescript
// @ampless/theme-blog
export default defineTheme({
  apiVersion: 1,
  name: 'Blog',
  description: 'A simple blog theme',
  thumbnail: '/themes/blog/thumbnail.png',

  // Declare customizable fields → admin UI auto-generates the UI
  configSchema: {
    primaryColor: { type: 'color', default: '#3b82f6', label: 'Primary color' },
    fontFamily: { type: 'select', options: ['sans', 'serif', 'mono'], default: 'sans', label: 'Font' },
    logo: { type: 'image', label: 'Logo' },
    showSidebar: { type: 'boolean', default: true, label: 'Show sidebar' },
  },

  layouts: { default, post, list },
  slots: ['head', 'before-content', 'after-content', 'sidebar', 'footer'],
})
```

### Theme Distribution and Installation

Uses the same mechanism as plugin distribution (§9).

| Method | User | Operation |
|--------|------|-----------|
| **From admin UI** | Non-developers | Select from theme list and click "Apply". No npm or git required |
| **npm install** | Developers | `npm install @ampless/theme-docs` → git push |
| **eject** | Advanced users | `npx ampless eject-theme` to switch to a local copy |

Installing from the admin UI:

```
Admin UI "Change Theme"
  → Theme list (with thumbnail previews)
  → Download theme package to S3
  → Save theme configuration to DynamoDB
  → New theme renders from the next request
```

Only administrators can install themes (role: admin).
Themes are treated as trusted code; the trust_level plugin sandbox does not apply.

### Theme Switching and Preview

Users can compare multiple themes using real content before applying.

```
┌─────────────────────────────────────────────┐
│ Theme Settings                               │
├──────────┬──────────────────────────────────┤
│          │                                    │
│ Theme    │   ┌────────────────────────┐     │
│ ● Blog   │   │                          │     │
│ ○ Docs   │   │    iframe preview         │     │
│ ○ Corp   │   │  (shows real content)    │     │
│          │   │                          │     │
│ Customize│   └────────────────────────┘     │
│ Color: [■]│                                    │
│ Font     │              [Apply Theme]         │
│ Logo     │                                    │
└──────────┴──────────────────────────────────┘
```

- Preview uses an iframe + URL parameter to specify the theme (admin session only)
- The iframe updates in real time as customization options are changed
- Changes do not appear on the public site until "Apply Theme" is clicked

```typescript
// middleware.ts
export function middleware(request: NextRequest) {
  const theme = request.nextUrl.searchParams.get('theme')
  const preview = request.nextUrl.searchParams.get('preview')

  if (preview && isAdminSession(request)) {
    request.headers.set('x-theme', theme)
  }
}
```

### Caching Strategy

Theme render output is cached by Next.js ISR to minimize theme Lambda invocations.

```
First request → render with theme → cache HTML (ISR)
Subsequent requests → serve from cache
Content update → DynamoDB Stream → SQS → regenerate cache
Theme change → invalidate all page caches → regenerate incrementally
```

### Admin UI

The admin UI is independent of themes. Built with shadcn/ui + Tailwind.

| Area | Technology | Reason |
|------|-----------|--------|
| Admin `(admin)/` | shadcn/ui + Tailwind | Forms, tables, dialogs, and more are available |
| Public site `(public)/` | Theme-dependent (Tailwind-based) | Design varies per theme |

### Slots (Insertion Points)

Themes declare **slots** where plugins can inject content.

```tsx
// Theme side: post page
export default function PostPage({ post }) {
  return (
    <article>
      <Slot name="before-content" />
      <PostBody content={post.body} />
      <Slot name="after-content" />
      <Slot name="sidebar" />
    </article>
  )
}
```

```typescript
// Plugin side: AdSense
export default definePlugin({
  slots: {
    'after-content': (props) => <AdSenseUnit slot="XXXXXXX" />,
  }
})
```

GA scripts, AdSense, related post widgets, etc. all use the slot mechanism.
The `head` slot is used for injecting scripts and meta tags into `<head>`.

### Themes by Use Case

| Theme | Target | Description |
|-------|--------|-------------|
| `@ampless/theme-blog` | Personal/business blog | Text-centric. Simple |
| `@ampless/theme-docs` | Documentation site | Sidebar navigation. Nextra/Docusaurus-style |
| `@ampless/theme-corporate` | Corporate site + blog | Landing page + blog combined |

External theme authors can also make their themes installable and customizable from the admin UI by following the same `defineTheme()` contract.

### v1 Policy
- v0.1: `@ampless/theme-blog` only. CSS variable customization via `configSchema`
- v0.2: Theme switching and preview, add `@ampless/theme-docs`
- v1.0: eject support, third-party theme support

---
