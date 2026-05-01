import { MediaUploader } from '@/components/admin/media-uploader'

export default function MediaPage() {
  return (
    <div className="p-8">
      <h1 className="mb-8 text-3xl font-bold">Media</h1>
      <MediaUploader />
    </div>
  )
}
