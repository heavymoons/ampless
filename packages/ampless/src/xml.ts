// Shared XML utilities for plugins that emit feeds, sitemaps, etc.

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  // Use numeric reference for the apostrophe — &apos; is XML 1.0 only and
  // a few legacy RSS validators reject it. &#39; is universal.
  "'": '&#39;',
}

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]!)
}
