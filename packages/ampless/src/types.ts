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

export type ImageDisplay = 'inline' | 'lightbox'

export interface Config {
  site: {
    name: string
    url: string
    description?: string
  }
  media?: {
    delivery?: 'nextjs' | 's3-direct'
    /** How embedded images are presented on the public site. */
    imageDisplay?: ImageDisplay
    /** Max content width for inline images (CSS value, default '100%'). */
    imageMaxWidth?: string
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
