import { ampless } from '@/lib/ampless'
import {
  createThemeHomeDispatcher,
  createThemeHomeMetadata,
} from '@ampless/runtime/dispatchers'

export const dynamic = 'force-dynamic'

export const generateMetadata = createThemeHomeMetadata(ampless)
export default createThemeHomeDispatcher(ampless)
