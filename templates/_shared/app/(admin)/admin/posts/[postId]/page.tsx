import { admin } from '@/lib/admin'
import { createEditPostPage } from '@ampless/admin/pages'
import { renderPreviewHtml } from '../../_actions/render-preview'

export default createEditPostPage(admin, { renderPreviewAction: renderPreviewHtml })
