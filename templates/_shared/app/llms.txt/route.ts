import { ampless } from '@/lib/ampless'
import { createLlmsTxtRouteHandler } from '@ampless/runtime/routes'

// Site-wide AI index. Disable with `cms.config.ai.llmsTxt: false`.
export const dynamic = 'force-dynamic'
export const GET = createLlmsTxtRouteHandler(ampless)
