import { defineConfig } from 'ampless'

export default defineConfig({
  site: {
    name: '{{siteName}}',
    url: 'http://localhost:3000',
  },
  media: {
    delivery: 'nextjs',
  },
  plugins: {{plugins}},
})
