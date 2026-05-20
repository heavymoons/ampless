> 日本語版: [02-tech-stack.ja.md](./02-tech-stack.ja.md)
> 
## 2. Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | Next.js (App Router) | Larger developer community than Astro (used by EmDash) |
| Backend | Amplify Gen 2 | CDK-based, TypeScript throughout |
| Database | DynamoDB | Amplify-native, serverless |
| Storage | S3 | Media files |
| Auth | Cognito | Amplify Auth standard |
| Event processing | DynamoDB Streams + SQS | Foundation for async hooks and webhooks |
| Plugin execution | Lambda (regional) | Separate functions per trust_level |
| Editor | tiptap (MIT) | ProseMirror-based, rich Extensions ecosystem |
| CSS | Tailwind CSS | Shared between public themes and admin UI |
| Admin UI | shadcn/ui | Tailwind-based component library |
| CDN | CloudFront | Auto-configured by Amplify Hosting |
| License | MIT | Same as EmDash. Lowers the barrier for commercial use |

### On Edge Execution
CloudFront Functions / Lambda@Edge are not used for plugin execution.
Reason: there is no official way to inject custom edge functions into the CloudFront distribution that Amplify auto-generates.
Simple text-transformation workloads complete in 1–2 ms on regional Lambda, which is sufficient in practice.
When CloudFront cache is effective, Lambda is not invoked at all.

---
