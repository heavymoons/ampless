import config from '../../../cms.config'
import { createProcessorTrustedHandler } from '@ampless/backend/events/processor-trusted'

// Plugins + site come from the user-side `cms.config`. The factory
// filters down to `trust_level === 'trusted'` plugins, wires the
// runtime context (listPublishedPosts / writePublicAsset), and runs
// the built-in site-settings cache rebuild on
// `site.settings.updated` events.
export const handler = createProcessorTrustedHandler({
  plugins: config.plugins,
  site: config.site,
})
