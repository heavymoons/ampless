import config from '../../../cms.config'
import { createProcessorUntrustedHandler } from '@ampless/backend/events/processor-untrusted'

// Untrusted plugins get a runtime context with NO AWS-touching
// capabilities — listPublishedPosts / writePublicAsset throw. The
// factory filters `trust_level === 'untrusted'` from cms.config.
export const handler = createProcessorUntrustedHandler({
  plugins: config.plugins,
  site: config.site,
})
