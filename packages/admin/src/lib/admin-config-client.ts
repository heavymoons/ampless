'use client'

import type { Config, MediaProcessingDefaults } from 'ampless'

// Module-level state for the admin's cms.config visible to client
// components. Registered once by the admin layout factory (which runs
// on both server + client). Mirrors the admin-site-client / admin-media
// pattern.

let cmsConfig: Config | null = null

export function setAdminCmsConfigClient(config: Config): void {
  cmsConfig = config
}

export function getAdminCmsConfig(): Config | null {
  return cmsConfig
}

export function getMediaProcessingDefaults(): MediaProcessingDefaults | undefined {
  return cmsConfig?.media?.processing
}
