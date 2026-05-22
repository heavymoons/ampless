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
  PostMetadata,
  StaticPostBody,
  Page,
  Media,
  Config,
  SiteConfig,
  AuthContext,
  Role,
  ContentFormat,
  PostStatus,
  ImageDisplay,
  MediaProcessingDefaults,
  DateFormat,
} from './types.js'
export {
  DEFAULT_SITE_ID,
  resolveSiteId,
  isMultiSite,
  siteFor,
  composeSiteIdStatus,
  composeSiteIdSlug,
} from './sites.js'
export {
  setKvStore,
  hasKvStore,
  getKvStore,
  getSiteSetting,
  setSiteSetting,
  deleteSiteSetting,
  listSiteSettings,
  flattenSettings,
  unflattenSettings,
  SITE_CONFIG_PK,
} from './kv.js'
export type { KvStore, KvItem } from './kv.js'
export { formatDate } from './format.js'
export { escapeXml } from './xml.js'
export { encodeAwsJson, decodeAwsJson } from './awsjson.js'
export { formatPublicAssetUrl } from './storage.js'
export { definePlugin } from './plugin.js'
export type {
  AmplessPlugin,
  PluginEventHandler,
  PluginMetadata,
  PluginRuntimeContext,
  TrustLevel,
  OgImageConfig,
  OgImageFont,
  OgImageRenderContext,
} from './plugin.js'
export { extractFirstImageUrl } from './post-images.js'
export type {
  EventType,
  ContentEventType,
  MediaEventType,
  SiteSettingsEventType,
  AmplessEvent,
  ContentEventPayload,
  MediaEventPayload,
  SiteSettingsEventPayload,
  EventPayloadOf,
  StreamEventName,
} from './events.js'
export { detectContentEvents } from './events.js'
export type { FieldDefinition, FieldType, ContentTypeDefinition } from './schema.js'
export {
  defineTheme,
  defineThemeModule,
  themeSettingKey,
  validateThemeValue,
  resolveThemeValues,
  resolveLocalized,
  parseLinkList,
  stringifyLinkList,
  parseColorPair,
  formatColorPair,
  isTagListUrl,
} from './theme.js'
export type {
  ThemeManifest,
  ThemeField,
  ThemeFieldType,
  ThemeColorField,
  ThemeTextField,
  ThemeSelectField,
  ThemeImageField,
  ThemeLengthField,
  ThemeFontFamilyField,
  ThemeLinkListField,
  ThemeModule,
  ThemeRouteContext,
  LocalizedString,
  LinkListItem,
} from './theme.js'

export const VERSION = '0.0.1'
