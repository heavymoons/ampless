# ampless

Serverless CMS for AWS Amplify.

> ⚠️ **Early development** — not yet usable.

## What is ampless?

ampless is an open-source CMS built natively for AWS Amplify. Think of it as [EmDash](https://emdash.dev) for the AWS ecosystem.

- **Next.js** (App Router) frontend
- **DynamoDB** for content storage (Portable Text)
- **S3** for media
- **Cognito** for authentication
- **Lambda** for plugin execution with IAM-based sandboxing

## Quick Start

```bash
npx create-ampless@latest
```

## Packages

| Package | Description |
|---------|-------------|
| [`ampless`](./packages/ampless) | CMS core |
| [`create-ampless`](./packages/create-ampless) | CLI scaffolding tool |
| [`@ampless/plugin-seo`](./packages/plugin-seo) | SEO plugin |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
