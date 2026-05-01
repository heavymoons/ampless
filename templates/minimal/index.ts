import { defineThemeModule } from 'ampless'
import './tokens.css'
import manifest from './manifest'
import MinimalHome from './pages/home'
import MinimalPost, { generatePostMetadata } from './pages/post'
import MinimalTag from './pages/tag'
import { minimalFeedHandler } from './pages/feed'
import { minimalSitemapHandler } from './pages/sitemap'

export default defineThemeModule({
  name: 'minimal',
  manifest,
  components: {
    Home: MinimalHome,
    Post: MinimalPost,
    Tag: MinimalTag,
  },
  metadata: {
    Post: generatePostMetadata,
  },
  routes: {
    feed: minimalFeedHandler,
    sitemap: minimalSitemapHandler,
  },
})
