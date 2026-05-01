import { defineThemeModule } from 'ampless'
import './tokens.css'
import manifest from './manifest'
import BlogHome from './pages/home'
import BlogPost, { generatePostMetadata } from './pages/post'
import BlogTag from './pages/tag'
import { blogFeedHandler } from './pages/feed'
import { blogSitemapHandler } from './pages/sitemap'

// `tokens.css` is imported as a side-effect so Next.js bundles it
// whenever the theme registry pulls this module in. Multiple themes
// can ship their own tokens.css side-by-side; only the active theme's
// `[data-theme="<name>"]` selector matches at runtime.
export default defineThemeModule({
  name: 'blog',
  manifest,
  components: {
    Home: BlogHome,
    Post: BlogPost,
    Tag: BlogTag,
  },
  metadata: {
    Post: generatePostMetadata,
  },
  routes: {
    feed: blogFeedHandler,
    sitemap: blogSitemapHandler,
  },
})
