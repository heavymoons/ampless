// Back-compat shim. `cn()` moved to `@ampless/runtime/ui` (L2
// extension) so admin + theme-side site-chrome share one source of
// truth. New code should import `cn` from `@ampless/runtime/ui`.

export { cn } from '@ampless/runtime/ui'
