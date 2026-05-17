'use client'

import { MediaUploader } from './media-uploader.js'
import { useT } from './i18n-provider.js'

export function MediaPage() {
  const t = useT()
  return (
    <div className="p-8">
      <h1 className="mb-8 text-3xl font-bold">{t('media.title')}</h1>
      <MediaUploader />
    </div>
  )
}
