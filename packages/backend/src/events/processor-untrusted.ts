import type { SQSHandler } from 'aws-lambda'
import type {
  AmplessEvent,
  AmplessPlugin,
  Config,
  PluginRuntimeContext,
} from 'ampless'

export interface CreateProcessorUntrustedHandlerOpts {
  /**
   * The full `cms.config.plugins` array. The handler filters down to
   * untrusted plugins itself.
   *
   * Accepts the raw `Config['plugins']` shape (which permits string
   * entries for future dynamic loading) — the runtime filter discards
   * anything that isn't a plugin object.
   */
  plugins?: Config['plugins']
  /**
   * The `cms.config.site` block, surfaced to plugin hooks via
   * `ctx.site` (read-only — untrusted plugins have no AWS-touching
   * capabilities).
   */
  site: Config['site']
}

/**
 * SQS-driven untrusted plugin executor. Untrusted plugins get a runtime
 * context with NO AWS-touching capabilities — they can only read the
 * event payload, run pure JS, and return. Any attempt to call
 * `listPublishedPosts` or `writePublicAsset` throws.
 *
 * Re-exported by the template's thin shell
 * `amplify/events/processor-untrusted/handler.ts`.
 */
export function createProcessorUntrustedHandler(
  opts: CreateProcessorUntrustedHandlerOpts
): SQSHandler {
  const untrustedPlugins: AmplessPlugin[] = (opts.plugins ?? []).filter(
    (p): p is AmplessPlugin => typeof p === 'object' && p.trust_level === 'untrusted'
  )

  // Untrusted plugins get a runtime context with NO AWS-touching capabilities.
  // They can only read the event payload, run pure JS, and return.
  function makeContext(siteId: string): PluginRuntimeContext {
    return {
      siteId,
      site: opts.site,
      async listPublishedPosts() {
        throw new Error('untrusted plugins cannot list posts')
      },
      async writePublicAsset() {
        throw new Error('untrusted plugins cannot write assets')
      },
    }
  }

  return async (event) => {
    if (untrustedPlugins.length === 0) return

    for (const record of event.Records) {
      let parsed: AmplessEvent
      try {
        parsed = JSON.parse(record.body) as AmplessEvent
      } catch (err) {
        console.error('[untrusted-processor] bad message', record.body, err)
        continue
      }
      const siteId = (parsed.payload as { siteId?: string }).siteId ?? 'default'
      for (const plugin of untrustedPlugins) {
        const hook = plugin.hooks?.[parsed.type]
        if (!hook) continue
        try {
          await hook(parsed as never, makeContext(siteId))
        } catch (err) {
          console.error(`[untrusted-processor] ${plugin.name}.${parsed.type} failed`, err)
          throw err
        }
      }
    }
  }
}
