'use client'

import type { Config } from 'ampless'
import type { AmplessOutputs } from '@ampless/runtime'
import { configureAmplify } from '../lib/amplify-client.js'
import { installAdminPostsProvider } from '../lib/posts-provider.js'
import { installAdminKvProvider } from '../lib/kv-provider.js'
import { installAdminMcpTokenProvider } from '../lib/mcp-token-provider.js'
import { setAdminCmsConfigClient } from '../lib/admin-config-client.js'
import { setAdminMediaContext } from '../lib/media.js'

interface Props {
  outputs: AmplessOutputs
  cmsConfig: Config
  children: React.ReactNode
}

/**
 * Client-side admin bootstrap. Runs on first render of any admin route
 * — configures the Amplify SDK, registers the cms.config / outputs in
 * the client-side state modules, and installs the admin's posts / kv
 * providers so 'ampless'-imported functions hit the AppSync client.
 *
 * All bootstrap calls happen synchronously during render, NOT in
 * `useEffect`. React runs child useEffects before parent useEffects,
 * so if `installAdminPostsProvider` were inside an effect, a child
 * page's first `listPosts()` call (also in a useEffect) would race
 * the install and fall back to ampless's dummy data. Synchronous
 * registration guarantees the provider is in place before any child
 * component mounts.
 *
 * All side effects are idempotent (the install functions guard with an
 * `installed` flag) — mounting this multiple times (e.g. during HMR or
 * remount) is safe.
 */
export function AdminProviders({ outputs, cmsConfig, children }: Props) {
  configureAmplify(outputs)
  setAdminCmsConfigClient(cmsConfig)
  setAdminMediaContext(outputs, cmsConfig)
  installAdminPostsProvider()
  installAdminKvProvider()
  installAdminMcpTokenProvider()

  return <>{children}</>
}
