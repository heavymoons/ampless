// Back-compat shim. Upload helper moved to `@ampless/admin` (L2
// extraction). Existing call sites
// (`uploadProcessedImage(...)`, `sanitizeName(...)`) keep working
// through this shim.

export { uploadProcessedImage, sanitizeName } from '@ampless/admin/components'
