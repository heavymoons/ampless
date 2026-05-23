import { ampless } from '@/lib/ampless'
import {
  createThemePostDispatcher,
  createThemePostMetadata,
} from '@ampless/runtime/dispatchers'

export const dynamic = 'force-dynamic'

export const generateMetadata = createThemePostMetadata(ampless)
export default createThemePostDispatcher(ampless)
