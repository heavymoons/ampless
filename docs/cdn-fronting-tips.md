# Fronting ampless with your own CDN (CloudFront / Cloudflare)

> 日本語版: [cdn-fronting-tips.ja.md](./cdn-fronting-tips.ja.md)

Out of the box, ampless serves your site through Amplify Hosting's internal CloudFront. That works fine and needs no setup. For sites where you want **finer control over the cache or cheaper bandwidth at scale**, you can put your own CDN in front of Amplify and S3 — Amplify keeps doing SSR, S3 keeps holding media + static bundles, and the CDN owns the domain and routing.

This is not a managed feature. It's a runbook-shaped tip; ampless does not automate it. The setup is one-time and lives outside the ampless repo.

## When this is worth it

- **You're paying more than you'd like for bandwidth.** CloudFront usage-based pricing is roughly half of Amplify's bandwidth rate per GB. At high traffic the Security Savings Bundle / Reserved Capacity tiers reduce it further.
- **You want to centralise cache control.** ampless already emits useful `Cache-Control` headers (immutable for stream-back media, computed values for themed posts). Your own CDN respects them directly, with no Amplify-internal cache layer to second-guess.
- **You want everything on one domain + one edge.** With multi-origin routing the same CDN serves the SSR HTML, the media bytes from S3, the static bundle assets, and the `public/site-settings.json` — no more split between Amplify-routed and S3-direct traffic.
- **You're already paying for Cloudflare** and want unified DNS / WAF / analytics there.

Skip this until you actually feel one of these. For a typical blog or corporate site the default Amplify-only path is fine.

## Architecture

```
                  ┌─────────────────┐
                  │  Your CDN       │
your domain  →   │  CloudFront or  │
                  │  Cloudflare     │
                  └────┬───────┬────┘
                       │       │
       HTML / API      │       │  media / static bundle /
       /admin / Next   │       │  public assets
                       ▼       ▼
              ┌────────────────┐   ┌──────────────┐
              │ Amplify Hosting │  │  S3 bucket   │
              │   (SSR Lambda) │   │  (private,   │
              │                │   │   via OAC)   │
              └────────────────┘   └──────────────┘
```

The CDN routes by path:

| Path | Origin |
|---|---|
| `/`, `/<slug>`, `/admin/*`, `/api/*`, `/_next/*` | Amplify Hosting (`xxx.amplifyapp.com`) |
| `/api/media/*` (or rewrite to `public/media/*`) | S3 bucket directly |
| `/<slug>/*` for static bundle assets | S3 bucket directly |
| `/public/site-settings.json` | S3 bucket directly |

S3 stays private. CloudFront uses OAC (Origin Access Control). Cloudflare can do the same via signed URLs or by switching media to R2.

## CloudFront option (AWS native)

What you set up manually:

1. **ACM certificate in `us-east-1`** for your domain. CloudFront requires it in that region regardless of where Amplify is deployed.
2. **CloudFront distribution** with two origins:
   - Amplify default domain (`xxx.amplifyapp.com`) — for HTML / SSR routes
   - S3 bucket (the one Amplify backend created) — for media and static assets, with OAC
3. **Cache behaviours** routing the paths above.
4. **Origin request policy** forwarding `Host`, `Accept-Encoding`, `Cookie` (for admin auth) to Amplify; minimal forwarding to S3.
5. **Route 53 alias** (`A` record) from your domain to the distribution.
6. **Detach Amplify's own custom-domain feature** if it's already wired up — keep the `xxx.amplifyapp.com` default and reach it from CloudFront. Don't double-bind the domain.

Pricing knobs (do AFTER the architecture is stable):
- **Security Savings Bundle**: ~$250/month base for ≥10 TB/month commits. Pays off if traffic exceeds roughly 3 TB/month.
- **Reserved Capacity**: enterprise tier, very high traffic only, AWS contract.

CDK is theoretically capable of automating the whole thing (`acm.Certificate` with `crossRegionReferences: true`, `cloudfront.Distribution`, `route53.ARecord`, S3 OAC policy). ampless does not ship this — when you want full automation, the route is to write your own CDK stack alongside `amplify/backend.ts` that reads the Amplify default domain from its outputs.

## Cloudflare option (often simpler)

What you set up manually:

1. **Add your domain to Cloudflare** and switch DNS to their nameservers. Free plan covers the basic case.
2. **Origin rules / page rules** that route requests:
   - Default: proxy to `xxx.amplifyapp.com`
   - `/api/media/*` and static-bundle paths: proxy to the S3 bucket regional endpoint
3. **Origin authentication** for S3:
   - Easiest: keep the bucket public-read for the prefixes you want exposed and rely on path scoping
   - Better: use **signed URLs from a Cloudflare Worker** or migrate the media bucket to **Cloudflare R2** (no egress fees between R2 and CF edge)
4. **Cache rules** mirroring what ampless already emits. Cloudflare respects origin `Cache-Control` when you turn off the "Respect Existing Headers" override.
5. **SSL / TLS mode**: Full (strict) — Cloudflare ↔ origin uses HTTPS with cert validation. Amplify and S3 both already serve HTTPS so no extra cert work.

Cloudflare is often less moving parts than CloudFront for small / medium sites:
- No ACM cert juggling
- DNS and CDN in one place
- Generous free tier
- Pro plan ($20/month) for image resizing + better analytics

The trade-off: you're now running on two providers. Billing, IAM, monitoring split.

## What ampless already does that helps

Whichever CDN you pick, ampless's stream-back media path emits:

- `Cache-Control: public, max-age=31536000, immutable` for media bytes (the upload key is timestamped, so the URL is effectively content-addressed).
- `ETag` passthrough from S3 so conditional GETs return 304.
- Computed `Cache-Control` on themed-post HTML responses based on `metadata.cache` + `post.updatedAt` (see `packages/runtime/src/middleware.ts:208-229`).

You don't need to override these at the CDN — they're already correct for long-lived edge caching. Don't enable any "respect origin Cache-Control = false" toggle on your CDN unless you really know why.

## When you're set up, simplify the SSR media path

Once `/api/media/*` is served direct from S3 by your CDN, the `media-proxy.ts` SSR route ([packages/admin/src/api/media-proxy.ts](../packages/admin/src/api/media-proxy.ts)) becomes a fallback for traffic that bypasses the CDN (e.g. local dev, internal health checks). You can either:

- Leave it in place as a redundant code path (no harm, zero cost when never hit).
- Switch the route to a permanent redirect to the S3 URL for any direct hits and let the CDN cover the public traffic.

This is purely cosmetic — the architecture works either way.

## Things that are still your problem

- **Cache invalidation on publish.** Currently nothing in ampless invalidates an external CDN when a post is republished. Either rely on the `Cache-Control` TTL (5 min for fresh posts by default) or wire a trusted-plugin hook that calls `CloudFront.CreateInvalidation` / Cloudflare's purge API on `content.published`. Build it as a custom plugin in your site repo; not a first-party plugin candidate yet.
- **Cert renewal.** ACM auto-renews if the DNS validation record stays in place. Cloudflare edge certs auto-renew. Don't break either.
- **Cost monitoring.** Once you take the CDN out of Amplify's bundle, two bills to watch.
- **WAF rules.** Both CDNs offer WAF; pick one and don't double-stack.

## Status

Not on the roadmap as a first-party feature. If running ampless behind a custom CDN becomes common (multiple users doing it), we may revisit and ship a CDK helper. Until then, this page is the entire support surface.
