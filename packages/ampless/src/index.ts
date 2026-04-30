export { defineConfig } from './config.js'
export { defineSchema } from './schema.js'
export {
  listPosts,
  getPost,
  getPostById,
  createPost,
  updatePost,
  deletePost,
  setPostsProvider,
  hasPostsProvider,
} from './core.js'
export type { ListOptions, CreatePostInput, PostsProvider } from './core.js'
export type {
  Post,
  Page,
  Media,
  Config,
  AuthContext,
  Role,
  ContentFormat,
  PostStatus,
  ImageDisplay,
  MediaProcessingDefaults,
  DateFormat,
} from './types.js'
export { formatDate } from './format.js'
export type { FieldDefinition, FieldType, ContentTypeDefinition } from './schema.js'

export const VERSION = '0.0.1'
