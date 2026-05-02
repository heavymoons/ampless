import { defineThemeModule } from 'ampless'
import './tokens.css'
import manifest from './manifest'
import DadsHome from './pages/home'
import DadsPost, { generatePostMetadata } from './pages/post'
import DadsTag from './pages/tag'
import { dadsFeedHandler } from './pages/feed'
import { dadsSitemapHandler } from './pages/sitemap'

export default defineThemeModule({
  name: 'dads',
  manifest,
  components: {
    Home: DadsHome,
    Post: DadsPost,
    Tag: DadsTag,
  },
  metadata: {
    Post: generatePostMetadata,
  },
  routes: {
    feed: dadsFeedHandler,
    sitemap: dadsSitemapHandler,
  },
})
