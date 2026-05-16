'use client'

import { MediaUploader } from '../components/media-uploader.js'
import { useT } from '../components/i18n-provider.js'

function MediaPage() {
  const t = useT()
  return (
    <div className="p-8">
      <h1 className="mb-8 text-3xl font-bold">{t('media.title')}</h1>
      <MediaUploader />
    </div>
  )
}

export function createMediaPage(_admin: unknown) {
  return MediaPage
}
