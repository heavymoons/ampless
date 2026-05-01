import type { SQSHandler } from 'aws-lambda'
import type { AmplessEvent, AmplessPlugin, PluginRuntimeContext } from 'ampless'
import config from '../../../cms.config'

const untrustedPlugins: AmplessPlugin[] = (config.plugins ?? []).filter(
  (p): p is AmplessPlugin => typeof p === 'object' && p.trust_level === 'untrusted'
)

// Untrusted plugins get a runtime context with NO AWS-touching capabilities.
// They can only read the event payload, run pure JS, and return.
function makeContext(siteId: string): PluginRuntimeContext {
  return {
    siteId,
    site: config.site,
    async listPublishedPosts() {
      throw new Error('untrusted plugins cannot list posts')
    },
    async writePublicAsset() {
      throw new Error('untrusted plugins cannot write assets')
    },
  }
}

export const handler: SQSHandler = async (event) => {
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
