import { PostForm } from '@/components/admin/post-form'

export default function NewPostPage() {
  return (
    <div className="p-8">
      <h1 className="mb-8 text-3xl font-bold">New post</h1>
      <PostForm />
    </div>
  )
}
