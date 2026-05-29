/**
 * Validate the user-supplied key for ctx.writePublicAsset.
 *
 * The trusted Lambda still has a processor-wide S3 grant, so path safety is
 * enforced at the runtime context boundary before the key is joined under the
 * plugin namespace.
 */
export function validatePublicAssetKey(key: string): string | null {
  if (key.length === 0) return 'key must not be empty'
  if (key.length > 256) return 'key must be 256 characters or less'
  if (key.startsWith('/')) return 'key must be relative and must not start with "/"'
  if (key.includes('\\')) return 'key must not contain backslashes'
  if (/[\u0000-\u001f\u007f]/.test(key)) {
    return 'key must not contain control characters'
  }
  // URL-reserved characters (#, ?, &, =, +, space, etc.) would survive an
  // S3 PutObject as raw bytes but break the returned public URL — the S3
  // path and the URL parse to different objects. Restrict to a conservative
  // ASCII subset that round-trips identically. Plugins that need other
  // characters should sanitize before calling ctx.writePublicAsset.
  if (!/^[A-Za-z0-9._/-]+$/.test(key)) {
    return 'key may only contain ASCII letters, digits, ".", "_", "-", and "/" (path separator)'
  }

  const segments = key.split('/')
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return 'key must not contain "." or ".." path segments'
  }

  return null
}
