import type { Post } from './types.js'

export const DUMMY_POSTS: Post[] = [
  {
    postId: 'post-001',
    siteId: 'default',
    slug: 'hello-world',
    title: 'Hello, ampless',
    excerpt: 'Welcome to your new ampless-powered blog. This is the first post.',
    format: 'markdown',
    body:
      '# Hello, ampless\n\n' +
      'Welcome to your new blog powered by **ampless** — a serverless CMS for AWS Amplify.\n\n' +
      'This post is served from the built-in dummy content. Once you run `npx ampx sandbox` ' +
      'and create posts from the admin panel, they will replace this placeholder.\n\n' +
      '## What to try next\n\n' +
      '- Edit `cms.config.ts` to customize your site\n' +
      '- Run `npx ampx sandbox` to deploy the backend\n' +
      '- Visit `/admin` to manage content (coming in Phase 4)\n',
    status: 'published',
    publishedAt: '2026-04-01T00:00:00Z',
    tags: ['welcome'],
  },
  {
    postId: 'post-002',
    siteId: 'default',
    slug: 'about-ampless',
    title: 'About ampless',
    excerpt: 'Why ampless exists, and what makes it different from other CMS options.',
    format: 'markdown',
    body:
      '# About ampless\n\n' +
      'ampless is an open-source CMS built natively for AWS Amplify — the "EmDash for AWS" position.\n\n' +
      '## Key differences\n\n' +
      '- **AWS-native**: Uses Amplify Gen 2, DynamoDB, S3, Cognito, Lambda\n' +
      '- **Plugin-first**: Core stays small, features come from plugins\n' +
      '- **AI-first**: MCP Server included from v0.1\n' +
      '- **MIT licensed**: No commercial barriers\n',
    status: 'published',
    publishedAt: '2026-04-02T00:00:00Z',
    tags: ['meta'],
  },
  {
    postId: 'post-003',
    siteId: 'default',
    slug: 'getting-started',
    title: 'Getting started',
    excerpt: 'How to set up your ampless site and deploy it to AWS.',
    format: 'markdown',
    body:
      '# Getting started\n\n' +
      '## Local development\n\n' +
      '```bash\n' +
      'npm install\n' +
      'npm run dev\n' +
      '```\n\n' +
      '## Deploy to AWS\n\n' +
      '```bash\n' +
      'npx ampx sandbox   # personal sandbox\n' +
      '# or push to git and connect to Amplify Hosting\n' +
      '```\n',
    status: 'published',
    publishedAt: '2026-04-03T00:00:00Z',
    tags: ['docs'],
  },
]
