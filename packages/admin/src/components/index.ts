// `@ampless/admin/components` — optional escape hatch for projects
// that want to embed admin form components (post-form, site-settings-form,
// theme-settings-form, media-uploader) outside the bundled admin pages.
// Most consumers don't need this — the `@ampless/admin/pages` factories
// already wire everything up. Surfaces stay minimal so the public API
// surface for v0.1 stays small and overridable later.

export { I18nProvider, useT, useLocale } from './i18n-provider.js'
export { AdminProviders } from './admin-providers.js'
// Admin page view components — re-exported here both as an opt-in
// escape hatch for projects that want to embed admin views outside
// the bundled `@ampless/admin/pages` factories, AND so tsup splits
// them into a shared chunk (instead of inlining them into
// `dist/pages/index.js` and pulling the `'use client'` directive
// across that server-side entry).
export { AdminDashboard } from './admin-dashboard.js'
export { PostsList } from './posts-list-view.js'
export { NewPostPage } from './new-post-view.js'
export { EditPostPage } from './edit-post-view.js'
export { MediaPage } from './media-view.js'
export { LoginPage } from './login-view.js'
export { UsersListView } from './users-list-view.js'
export {
  ADMIN_SITE_COOKIE,
  readAdminSiteIdFromCookie,
  setAdminCmsConfig,
} from '../lib/admin-site-client.js'
export { publicMediaUrl, setAdminMediaContext } from '../lib/media.js'
export { uploadProcessedImage, sanitizeName } from '../lib/upload.js'
export { invalidateSiteSettingsCache } from '../lib/theme-actions.js'
export { Sidebar } from './sidebar.js'
export { SiteSelector } from './site-selector.js'
export { PostForm } from './post-form.js'
export { SiteSettingsForm, type SiteSettingsFormValues } from './site-settings-form.js'
export { ThemeSettingsForm } from './theme-settings-form.js'
export { MediaUploader } from './media-uploader.js'
export { MediaPicker } from './media-picker.js'
export { ImageUploadDialog, type ImageUploadDialogProps } from './image-upload-dialog.js'
