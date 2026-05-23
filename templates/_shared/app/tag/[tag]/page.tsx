import { ampless } from '@/lib/ampless'
import {
  createThemeTagDispatcher,
  createThemeTagMetadata,
} from '@ampless/runtime/dispatchers'

export const dynamic = 'force-dynamic'

export const generateMetadata = createThemeTagMetadata(ampless)
export default createThemeTagDispatcher(ampless)
