> 日本語版: [13-differentiation.ja.md](./13-differentiation.ja.md)
> 
## 13. Differentiation from EmDash

| Aspect | EmDash | ampless |
|--------|--------|---------|
| Target infrastructure | Cloudflare (Workers, D1, R2) | AWS (Amplify Gen 2: Lambda, DynamoDB, S3, AppSync, Cognito) |
| Plugin isolation | V8 isolate (Workers) | IAM-scoped Lambda per trust_level |
| Sandbox availability | Only meaningful on Cloudflare | Works in any AWS account |
| Permission control | Custom capability declarations | IAM (industry standard) |
| Auditing | Custom | CloudTrail (AWS standard) |
| Frontend | Astro | Next.js |
| Database | D1 (SQLite) | DynamoDB |
| Content storage | Portable Text (fixed) | Multi-format: `tiptap` / `markdown` / `html` / `static` |
| Editor | Custom (tiptap with Portable Text conversion) | tiptap, content stored verbatim — no extra conversion layer |
| AI integration | None at v1 | MCP HTTP server with 11 tools (admin-equivalent agents via Bearer tokens) |
| Hook surface | (Closed) | `after:*` event hooks over Stream → SQS → trust_level Lambdas; outbound webhooks; pure-function metadata hooks at request time |
| Theme model | (Single theme per deploy) | Multi-theme install (6 shipped), swap from admin UI without redeploy |
| Public read auth | n/a (Workers handle it inline) | AppSync API key on custom resolvers that strip drafts |
| Ecosystem | Cloudflare users | AWS users (vastly larger community) |

The high-order differentiator is **target infrastructure**: ampless is "EmDash for AWS" — same posture (developer-built sites, plugin-first extensibility, MCP-native for AI agents) on the AWS stack and its IAM model, rather than Cloudflare and its Workers model.

---
