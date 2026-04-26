export type ContentFormat = 'tiptap' | 'markdown' | 'html'

export type PostStatus = 'draft' | 'published'

export interface Post {
  postId: string
  siteId: string
  slug: string
  title: string
  excerpt?: string
  format: ContentFormat
  body: unknown
  status: PostStatus
  publishedAt?: string
  tags?: string[]
}

export interface Page {
  pageId: string
  siteId: string
  slug: string
  title: string
  format: ContentFormat
  body: unknown
  status: PostStatus
  publishedAt?: string
}

export interface Media {
  mediaId: string
  siteId: string
  src: string
  mimeType: string
  size: number
  delivery: 'nextjs' | 's3-direct'
}

export interface Config {
  site: {
    name: string
    url: string
    description?: string
  }
  media?: {
    delivery?: 'nextjs' | 's3-direct'
  }
  sites?: Record<string, { domains: string[] }>
  plugins?: string[]
}

export type Role = 'reader' | 'editor' | 'admin'

export interface AuthContext {
  userId: string
  role: Role
  source: 'cognito' | 'api-key' | 'mcp'
}
