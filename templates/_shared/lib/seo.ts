// Back-compat shim. SEO metadata aggregation moved to
// `@ampless/runtime`. New code should call `ampless.postMetadata` /
// `ampless.siteMetadata` directly.

import { ampless } from './ampless'

// Arrow wrappers: defer `ampless` resolution to call time (avoid TDZ).
export const postMetadata: typeof ampless.postMetadata =
  (...args) => ampless.postMetadata(...args)
export const siteMetadata: typeof ampless.siteMetadata =
  (...args) => ampless.siteMetadata(...args)
