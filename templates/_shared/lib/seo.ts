// Back-compat shim. SEO metadata aggregation moved to
// `@ampless/runtime`. New code should call `ampless.postMetadata` /
// `ampless.siteMetadata` directly.

import { ampless } from './ampless'

export const postMetadata = ampless.postMetadata.bind(ampless)
export const siteMetadata = ampless.siteMetadata.bind(ampless)
