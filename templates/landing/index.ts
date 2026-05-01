import { defineThemeModule } from 'ampless'
import './tokens.css'
import manifest from './manifest'
import LandingHome from './pages/home'
import LandingPost, { generatePostMetadata } from './pages/post'
import LandingTag from './pages/tag'
import { landingFeedHandler } from './pages/feed'
import { landingSitemapHandler } from './pages/sitemap'

export default defineThemeModule({
  name: 'landing',
  manifest,
  components: {
    Home: LandingHome,
    Post: LandingPost,
    Tag: LandingTag,
  },
  metadata: {
    Post: generatePostMetadata,
  },
  routes: {
    feed: landingFeedHandler,
    sitemap: landingSitemapHandler,
  },
})
