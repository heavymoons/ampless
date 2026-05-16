// Lazy font loaders for the OG image plugin.
//
// We return a function (not the ArrayBuffer directly) so importing the
// plugin module doesn't trigger network fetches. The dispatcher route
// invokes the function on demand and the result is cached in-process so
// subsequent OG renders skip the fetch.

const cache = new Map<string, Promise<ArrayBuffer>>()

/**
 * Return a font loader that fetches `url` lazily and caches the result.
 * Use in `cms.config.ts`:
 *
 *     ogImagePlugin({
 *       fonts: [
 *         { name: 'Inter', data: loadFontFromUrl('https://.../Inter.ttf') },
 *       ],
 *     })
 */
export function loadFontFromUrl(url: string): () => Promise<ArrayBuffer> {
  return () => {
    const hit = cache.get(url)
    if (hit) return hit
    const promise = fetch(url).then(async (res) => {
      if (!res.ok) {
        // Drop the bad entry so a transient 502 doesn't permanently break
        // OG image generation for the lifetime of the process.
        cache.delete(url)
        throw new Error(`[plugin-og-image] failed to load font ${url}: HTTP ${res.status}`)
      }
      return res.arrayBuffer()
    })
    cache.set(url, promise)
    return promise
  }
}
