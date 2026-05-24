// Back-compat shim. Admin Posts provider installation lives in
// `@ampless/admin` and runs automatically inside the admin's
// <AdminProviders> bootstrap, so a side-effect
// `import '@/lib/posts-provider'` is not required. Kept as a safe
// no-op so existing user code that still imports this path keeps
// working.

export {}
