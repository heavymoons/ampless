// Back-compat shim. KvStore provider installation lives in
// `@ampless/admin` and runs automatically inside the admin's
// <AdminProviders> bootstrap, so a side-effect
// `import '@/lib/kv-provider'` is not required. Kept as a safe
// no-op so existing user code that still imports this path keeps
// working.

export {}
