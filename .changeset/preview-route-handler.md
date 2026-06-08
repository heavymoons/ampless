---
"@ampless/admin": minor
"create-ampless": patch
"ampless": patch
---

Move the admin preview pipeline from a Server Action to a Route Handler
at `/admin/preview`. **Alpha breaking** for `@ampless/admin`: the
`renderPreviewAction?` prop on `<PostForm>` / `<PostHistoryPanel>` is
removed and replaced by `previewEndpoint?: string` (default
`'/admin/preview'`). The matching `renderPreviewAction` option on
`createEditPostPage` / `createNewPostPage` is also removed and
replaced by `previewEndpoint?: string`; `CreateEditPostPageOptions` /
`CreateNewPostPageOptions` are retained but now expose only that one
field. Templates no longer need to provide a server action — the form
fetches the Route Handler at the default path, overridable via the
new option for non-default admin mount paths or Next.js `basePath`
configurations.

Why: a `'use server'` module that reaches `react-dom/server` from a
Client Component's import graph makes Next.js 15+ refuse to compile
the edit-post page ("You're importing a component that imports
react-dom/server") because the build traces the import graph from
Client Components through Server Action modules. Putting this
rendering behind a Route Handler decouples it from that graph
entirely — the form fetches a plain HTTP endpoint and the bundler
never walks from `<PostForm>` into the rendering code. The handler
also gets an explicit `admin.isEditor()` gate as defence-in-depth
against the `(admin)` middleware being misconfigured. (Inside the
handler, the `react-dom/server` import itself is loaded via dynamic
`import()` — Next.js 16's Turbopack flags any top-level static
import of `react-dom/server` reached from the app router build,
Route Handlers included, so the dynamic resolution is necessary at
that single seam.)

Template scaffold migration:
- Add `app/(admin)/admin/preview/route.tsx` with the POST handler
- Delete `app/(admin)/admin/_actions/render-preview.tsx`
- Drop `{ renderPreviewAction: renderPreviewHtml }` from
  `createEditPostPage(admin, ...)` / `createNewPostPage(admin, ...)`

Existing alpha sites pick this up via `npm run update-ampless`.
