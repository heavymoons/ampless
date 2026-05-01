'use client'

import { MediaUploader } from '@/components/admin/media-uploader'
import { useT } from '@/components/i18n-provider'

export default function MediaPage() {
  const t = useT()
  return (
    <div className="p-8">
      <h1 className="mb-8 text-3xl font-bold">{t('media.title')}</h1>
      <MediaUploader />
    </div>
  )
}
