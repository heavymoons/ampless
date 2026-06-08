import { admin } from '@/lib/admin'
import { createAdminLayout } from '@ampless/admin/pages'
import { EditorBootstrap } from './_editor-bootstrap'

export default createAdminLayout(admin, { editorBootstrap: EditorBootstrap })
