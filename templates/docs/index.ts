import { defineThemeModule } from 'ampless'
import './tokens.css'
import manifest from './manifest'
import DocsHome from './pages/home'
import DocsPost, { generatePostMetadata } from './pages/post'
import DocsTag from './pages/tag'
import { docsFeedHandler } from './pages/feed'
import { docsSitemapHandler } from './pages/sitemap'

export default defineThemeModule({
  name: 'docs',
  manifest,
  components: {
    Home: DocsHome,
    Post: DocsPost,
    Tag: DocsTag,
  },
  metadata: {
    Post: generatePostMetadata,
  },
  routes: {
    feed: docsFeedHandler,
    sitemap: docsSitemapHandler,
  },
})
