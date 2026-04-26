export { defineConfig } from './config.js'
export { defineSchema } from './schema.js'
export { listPosts, getPost } from './core.js'
export type { ListOptions } from './core.js'
export type {
  Post,
  Page,
  Media,
  Config,
  AuthContext,
  Role,
  ContentFormat,
  PostStatus,
} from './types.js'
export type { FieldDefinition, FieldType, ContentTypeDefinition } from './schema.js'

export const VERSION = '0.0.1'
