import { defineConfig } from 'ampless'

export default defineConfig({
  site: {
    name: '{{siteName}}',
    url: 'http://localhost:3000',
  },
  media: {
    delivery: 'nextjs',
    // 'inline'   — images flow inline at imageMaxWidth (default)
    // 'lightbox' — click an image to enlarge in a fullscreen overlay
    imageDisplay: 'inline',
    imageMaxWidth: '100%',
  },
  plugins: {{plugins}},
})
