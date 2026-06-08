import { admin } from '@/lib/admin'
import { createNewPostPage } from '@ampless/admin/pages'
import { renderPreviewHtml } from '../../_actions/render-preview'

export default createNewPostPage(admin, { renderPreviewAction: renderPreviewHtml })
