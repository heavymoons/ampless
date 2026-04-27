# Runbook

Operational tasks for an ampless-powered site.

## AppSync API key rotation

The public blog reads (`listPublishedPosts`, `getPublishedPost`) are gated by
an AppSync API key with a 365-day TTL. The key is bundled in
`amplify_outputs.json` and is therefore **visible to anyone visiting the
public site**. Treat it as a low-trust credential — its only privilege is
calling the two custom queries, which themselves only return posts where
`status = 'published'`.

### When to rotate

- **Routine**: at least 30 days before the key's `expiresInDays` deadline
  (configured in `amplify/data/resource.ts`). AppSync hard-rejects requests
  after expiry, so missing the rotation = public site goes down.
- **Suspected leak**: immediately. (Note: rate-limit your AppSync API in
  CloudFront / WAF if you depend on this for cost control.)

### How to rotate

1. Bump the version of `amplify/data/resource.ts` (any change forces
   redeploy). For a no-op nudge, edit a comment and save.
2. Run a fresh deployment so Amplify regenerates the key:
   ```bash
   npx ampx sandbox        # local development
   npx ampx pipeline-deploy --branch <branch> --app-id <app-id>  # CI / hosting
   ```
3. Confirm the new key is in `amplify_outputs.json` (`data.api_key`) and
   redeploy the Next.js app so SSR picks up the new key.

### Reset the schedule

If you want a different TTL, edit `amplify/data/resource.ts`:

```ts
authorizationModes: {
  defaultAuthorizationMode: 'userPool',
  apiKeyAuthorizationMode: { expiresInDays: 365 }, // 7–365
},
```

Lower TTLs reduce blast radius on leak but require more frequent rotation.
