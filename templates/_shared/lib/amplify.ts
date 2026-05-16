// Back-compat shim. The Amplify SDK is now configured by the admin's
// `<AdminProviders>` bootstrap (mounted by the layout factory in
// `@ampless/admin/pages`), so most call sites no longer need to call
// `configureAmplify()` themselves. Kept as a no-op so any lingering
// `import '@/lib/amplify'` side-effect imports stay safe.

export function configureAmplify() {
  // intentionally empty — admin bootstrap handles this
}
