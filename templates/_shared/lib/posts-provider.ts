// Back-compat shim. Admin Posts provider installation moved to
// `@ampless/admin` (L2 extraction). The install runs automatically
// inside the admin's <AdminProviders> bootstrap, so a side-effect
// `import '@/lib/posts-provider'` is no longer required — kept as a
// safe no-op for legacy callers.

export {}
