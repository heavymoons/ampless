'use server'

// Phase 7 preview pipeline. <PostForm> / <PostHistoryPanel> calls this
// server action with the in-flight draft Post; we render the body +
// page-level scripts on the server (where async ReactNode +
// `contentFields` plugin renderers can run) and return a complete HTML
// string that the admin shows in an iframe (sandbox=`allow-scripts`).
//
// Server-side is the only place this can live: `ampless.renderBody`
// returns a Promise<ReactNode>, so client code can't call it inline.
// The action also has access to the `Ampless` instance via
// `admin.getAmpless()` which the client never sees.

import { renderToStaticMarkup } from 'react-dom/server'
import type { Post } from 'ampless'
import { admin } from '@/lib/admin'

export async function renderPreviewHtml(draft: Post): Promise<string> {
  const ampless = await admin.getAmpless()
  // IMPORTANT: include BOTH the body and the page-level scripts so
  // widgets like x.com's `widgets.js` get a chance to hydrate in the
  // iframe. Without `publicPostScriptsForPage([draft])` the embed
  // blockquote would render but never load the widget JS, and authors
  // wouldn't see what the public page actually looks like.
  const node = (
    <>
      {await ampless.renderBody(draft)}
      {await ampless.publicPostScriptsForPage([draft])}
    </>
  )
  return renderToStaticMarkup(node)
}
