/**
 * Thin re-export of the shared static-bundle zip extractor so the
 * Lambda handler / its tests have a backend-package-local import
 * surface. The actual implementation lives in
 * `@ampless/mcp-server/tools` (via the package's `./tools` subpath
 * export) — both the stdio CLI and this Lambda run the same code so
 * the `upload_static_bundle` tool behaves identically across transports.
 *
 * Kept as a separate file because it isolates the `fflate` import to
 * a single backend module; the rest of the Lambda handler stays
 * insulated from zip-internals concerns.
 */

export {
  extractZipFromBuffer,
  decodeUtf8,
  type ExtractZipOptions,
} from '@ampless/mcp-server/tools'
