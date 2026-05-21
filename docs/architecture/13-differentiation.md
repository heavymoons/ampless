> 日本語版: [13-differentiation.ja.md](./13-differentiation.ja.md)
> 
## 13. Differentiation from EmDash

| Aspect | EmDash | This CMS |
|--------|--------|---------|
| Target infrastructure | Cloudflare | AWS (Amplify) |
| Plugin isolation | V8 isolate (Workers) | IAM policy (Lambda) |
| Sandbox functionality | Only works in Cloudflare environment | Works in any AWS environment |
| Permission control | Custom capability declarations | IAM (industry standard) |
| Auditing | Custom | CloudTrail (AWS standard) |
| Frontend | Astro | Next.js |
| Database | D1 (SQLite) | DynamoDB |
| Isolation in self-hosted scenarios | Not supported | Equivalent with IAM |
| Content storage | Portable Text (fixed) | Multi-format (tiptap / Markdown / HTML) |
| AI integration | None (at v1) | MCP Server + AI provider abstraction layer |
| Hook system | Unknown | before/after hooks + webhooks (general-purpose external integration) |
| Multi-site | Not supported | Subdomain-based multi-site |
| Ecosystem | Cloudflare users | AWS users (vastly larger community) |

---
