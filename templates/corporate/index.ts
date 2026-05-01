import { defineThemeModule } from 'ampless'
import './tokens.css'
import manifest from './manifest'
import CorporateHome from './pages/home'
import CorporatePost, { generatePostMetadata } from './pages/post'
import CorporateTag from './pages/tag'
import { corporateFeedHandler } from './pages/feed'
import { corporateSitemapHandler } from './pages/sitemap'

export default defineThemeModule({
  name: 'corporate',
  manifest,
  components: {
    Home: CorporateHome,
    Post: CorporatePost,
    Tag: CorporateTag,
  },
  metadata: {
    Post: generatePostMetadata,
  },
  routes: {
    feed: corporateFeedHandler,
    sitemap: corporateSitemapHandler,
  },
})
