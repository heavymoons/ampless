'use client'

import { useEffect } from 'react'
import type { Config } from 'ampless'
import type { AmplessOutputs } from '@ampless/runtime'
import { configureAmplify } from '../lib/amplify-client.js'
import { installAdminPostsProvider } from '../lib/posts-provider.js'
import { installAdminKvProvider } from '../lib/kv-provider.js'
import { setAdminCmsConfig } from '../lib/admin-site-client.js'
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
 * All side effects are idempotent; mounting this multiple times (e.g.
 * during HMR) won't double-register anything.
 */
export function AdminProviders({ outputs, cmsConfig, children }: Props) {
  // Run state setters synchronously during render so client components
  // that read them during their first render (post-form, sidebar, ...)
  // see the registered values before they mount. The Amplify
  // configure + providers wiring stays inside useEffect because those
  // call `Amplify.configure` which is fine to defer to commit.
  configureAmplify(outputs)
  setAdminCmsConfig(cmsConfig)
  setAdminCmsConfigClient(cmsConfig)
  setAdminMediaContext(outputs, cmsConfig)

  useEffect(() => {
    installAdminPostsProvider()
    installAdminKvProvider()
  }, [])

  return <>{children}</>
}
