// Ampless's core data schema, served as model definitions that callers
// spread into their own `a.schema({...})` so they can interleave
// custom models alongside ampless's defaults.
//
// `a` is intentionally typed as `unknown` here because the `@aws-amplify/backend`
// `a` builder is a heavily-overloaded value whose call signatures are
// inferred from the spread shape — pinning it to a concrete type would
// either lose the user's downstream `ClientSchema` inference or force
// a complete duplication of the upstream generics. The user's
// `amplify/data/resource.ts` imports `a` from `@aws-amplify/backend`
// directly and the resulting `ClientSchema<typeof schema>` resolves
// correctly because every model definition is still real.

import type { defineData } from '@aws-amplify/backend'

export interface AmplessResolverPaths {
  listPublishedPosts: string
  getPublishedPost: string
  listPostsByTag: string
}

/**
 * Default AppSync JS resolver paths. AppSync resolves these strings at
 * CDK synth time relative to the file that calls `defineData` — i.e.
 * the user's `amplify/data/resource.ts`. Templates ship the three
 * resolver files at exactly these paths.
 *
 * Users with a non-default layout (e.g. moving the resolvers under a
 * `resolvers/` subdir) pass overrides through `amplessSchemaModels(a, {
 * resolverPaths: { ... } })`.
 */
export const DEFAULT_RESOLVER_PATHS: AmplessResolverPaths = {
  listPublishedPosts: './list-published-posts.js',
  getPublishedPost: './get-published-post.js',
  listPostsByTag: './list-posts-by-tag.js',
}

export interface AmplessSchemaModelsOpts {
  /**
   * Override the relative paths used for AppSync JS resolver entries.
   * Paths are interpreted by Amplify at synth time relative to the
   * file that calls `defineData`, NOT relative to this package — so
   * they must point to actual `.js` files inside the user's project.
   */
  resolverPaths?: Partial<AmplessResolverPaths>
  /**
   * Optional Amplify `defineFunction` ref backing the user-admin
   * AppSync ops (`listAdminUsers` query, `setAdminUserRole` mutation).
   * When supplied, the corresponding `AdminUser` customType + the two
   * ops are added to the schema, both gated to `ampless-admin`.
   *
   * Typed as `unknown` because `defineFunction`'s return type carries
   * internal pnpm paths that don't survive declaration emit — same
   * pattern as `AmplessAuthConfigOpts.postConfirmation`.
   */
  userAdminFunction?: unknown
}

/**
 * The Ampless model + custom query definitions, returned as a plain
 * object suitable for spreading into `a.schema({ ... })`.
 *
 *   const schema = a.schema({
 *     ...amplessSchemaModels(a),
 *     MyCustomModel: a.model({ ... }).authorization(...),
 *   })
 *
 * Returning a builder-shape rather than a fully-instantiated `schema`
 * lets the user weave custom models alongside ampless's defaults
 * inside one `a.schema(...)` call, which is the only way Amplify Gen
 * 2's `ClientSchema<typeof schema>` inference picks up the user's
 * extra models.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function amplessSchemaModels(a: any, opts: AmplessSchemaModelsOpts = {}) {
  const resolverPaths: AmplessResolverPaths = {
    ...DEFAULT_RESOLVER_PATHS,
    ...opts.resolverPaths,
  }

  return {
    Post: a
      .model({
        siteId: a.string().required(),
        postId: a.id().required(),
        slug: a.string().required(),
        title: a.string().required(),
        excerpt: a.string(),
        format: a.enum(['tiptap', 'markdown', 'html', 'static']),
        body: a.json(),
        status: a.enum(['draft', 'published']),
        publishedAt: a.datetime(),
        tags: a.string().array(),
        // Free-form per-post metadata (JSON). Reserved well-known keys
        // are documented on `PostMetadata` in `ampless/src/types.ts`.
        // Currently:
        //   no_layout: boolean — serve the post as bare HTML (no theme
        //     chrome). The runtime's post dispatcher redirects to the
        //     raw route handler when this is true.
        // Other keys are passed through unchanged for plugin / app use.
        metadata: a.json(),
        // Denormalized GSI keys — set by every write path (admin client,
        // MCP tools). Same pattern as siteIdStatus: composing the
        // partition key as a single string lets each public-read query
        // hit DynamoDB with a pure PK Query, no filter pass.
        //   siteIdStatus = `${siteId}#${status}`
        //     → bySiteIdStatus partitions per site×status, sorted by publishedAt
        //   siteIdSlug = `${siteId}#${slug}`
        //     → bySiteIdSlug locates a single post by slug in O(1)
        siteIdStatus: a.string(),
        siteIdSlug: a.string(),
      })
      .identifier(['siteId', 'postId'])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .secondaryIndexes((index: any) => [
        index('siteIdStatus').sortKeys(['publishedAt']).name('bySiteIdStatus'),
        index('siteIdSlug').name('bySiteIdSlug'),
      ])
      // Direct table access is admin/editor only — guests must go through
      // the custom queries below, which strip drafts at the resolver level.
      //
      // editor is a trusted principal: body is stored verbatim and rendered
      // without sanitization. editor can persist arbitrary HTML / JS via
      // `format: 'html'` or via tiptap attribute payloads. This is a
      // deliberate design choice — see docs/architecture/04-access-layer-mcp.md
      // §"editor の信頼モデル". Do not grant editor to anyone you wouldn't
      // also trust as admin.
      //
      // Lambda resource auth (e.g. the MCP HTTP handler) is granted at
      // the schema level in the user's `amplify/data/resource.ts` via
      // `amplessSchemaAuthorization(allow, { mcpHandlerFunction })`.
      // Resource auth is currently only supported at schema scope in
      // `@aws-amplify/data-schema` (see `accessSchemaData` /
      // `extractFunctionSchemaAccess` in SchemaProcessor) — model-level
      // `.authorization` callbacks have `resource` destructured out of
      // their `allow` parameter, so this clause stays group-only.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .authorization((allow: any) => [
        allow.groups(['ampless-admin', 'ampless-editor']),
      ]),

    Page: a
      .model({
        siteId: a.string().required(),
        pageId: a.id().required(),
        slug: a.string().required(),
        title: a.string().required(),
        format: a.enum(['tiptap', 'markdown', 'html', 'static']),
        body: a.json(),
        status: a.enum(['draft', 'published']),
        publishedAt: a.datetime(),
      })
      .identifier(['siteId', 'pageId'])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .authorization((allow: any) => [
        allow.groups(['ampless-admin', 'ampless-editor']),
      ]),

    Media: a
      .model({
        siteId: a.string().required(),
        mediaId: a.id().required(),
        src: a.string().required(),
        mimeType: a.string().required(),
        size: a.integer(),
        delivery: a.string(),
      })
      .identifier(['siteId', 'mediaId'])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .authorization((allow: any) => [
        allow.groups(['ampless-admin', 'ampless-editor']),
      ]),

    Taxonomy: a
      .model({
        siteId: a.string().required(),
        termId: a.id().required(),
        type: a.enum(['category', 'tag']),
        name: a.string().required(),
        slug: a.string().required(),
      })
      .identifier(['siteId', 'termId'])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .authorization((allow: any) => [
        allow.groups(['ampless-admin', 'ampless-editor']),
      ]),

    // Denormalized index for "posts by tag" queries. Each Post tag becomes
    // one PostTag row, so listing/filtering by tag is a single Query —
    // including date-range archive views, since publishedAt is part of the
    // sort key. Maintained by the admin client whenever a post is created,
    // updated, or deleted; never edited by end users.
    //
    //   PK: siteIdTag         e.g. "default#tech"
    //   SK: publishedAtPostId e.g. "2026-04-27T13:57:05.679Z#post-001"
    PostTag: a
      .model({
        siteIdTag: a.string().required(),
        publishedAtPostId: a.string().required(),
        siteId: a.string().required(),
        tag: a.string().required(),
        postId: a.id().required(),
        publishedAt: a.datetime().required(),
        slug: a.string().required(),
        title: a.string().required(),
        excerpt: a.string(),
        // Full tag list of the post (for chip rendering on tag pages).
        tags: a.string().array(),
      })
      .identifier(['siteIdTag', 'publishedAtPostId'])
      // Lambda resource auth covered at schema scope — see Post for the
      // explanation.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .authorization((allow: any) => [
        allow.groups(['ampless-admin', 'ampless-editor']),
      ]),

    // Generic key/value store. Two roles in one table:
    //   - Site settings: PK = `siteconfig:{siteId}`, SK = dotted key
    //     (`site.name`, `media.imageDisplay`, ...). No TTL → persistent.
    //   - Caches / plugin state: PK = whatever namespace the caller picks
    //     (`cache:{ns}`, `pluginstate:{name}:...`). TTL set → DynamoDB
    //     auto-deletes within ~48h of expiry.
    //
    // Auth is admin/editor write only. Guests never read this table
    // directly — site settings are mirrored to S3 by the site-settings-
    // cache built-in plugin and the public site fetches from there.
    KvStore: a
      .model({
        pk: a.string().required(),
        sk: a.string().required(),
        value: a.json(),
        // Unix epoch seconds. When set, DynamoDB removes the row
        // automatically (TimeToLive enabled in backend.ts).
        ttl: a.integer(),
      })
      .identifier(['pk', 'sk'])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .authorization((allow: any) => [
        allow.groups(['ampless-admin', 'ampless-editor']),
      ]),

    // Custom return type for public post reads. Decoupling from `Post` lets
    // AppSync skip the model-level (admin-only) auth check on fields.
    PublicPost: a.customType({
      siteId: a.string().required(),
      postId: a.id().required(),
      slug: a.string().required(),
      title: a.string().required(),
      excerpt: a.string(),
      format: a.string(),
      body: a.json(),
      status: a.string(),
      publishedAt: a.datetime(),
      tags: a.string().array(),
      metadata: a.json(),
    }),

    // Paginated wrapper for list responses.
    PublicPostConnection: a.customType({
      items: a.ref('PublicPost').array(),
      nextToken: a.string(),
    }),

    // Public read endpoints — guard against draft leakage via custom resolvers.
    // Custom handlers (`a.handler.custom`) only support apiKey / userPool /
    // lambda / group / owner auth. `allow.guest()` (Cognito Identity Pool
    // unauthenticated role) is NOT supported with custom handlers as of
    // Amplify Gen 2 (2026-04). So anonymous visitors get a public API key,
    // which has a 365-day TTL — see RUNBOOK.md for the rotation procedure.
    // The resolvers themselves strip drafts at the data-source level, so the
    // only thing guests can see is `status === 'published'` rows projected
    // onto `PublicPost`.
    listPublishedPosts: a
      .query()
      .arguments({
        siteId: a.string(),
        // Both ISO 8601 strings; query SK condition is pushed into DynamoDB
        // so only the matching publishedAt range is read.
        from: a.datetime(),
        to: a.datetime(),
        limit: a.integer(),
        // Opaque DynamoDB pagination cursor. Pass back the previous response's
        // `nextToken` to fetch the next page.
        nextToken: a.string(),
      })
      .returns(a.ref('PublicPostConnection'))
      .handler(
        a.handler.custom({
          dataSource: a.ref('Post'),
          entry: resolverPaths.listPublishedPosts,
        })
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .authorization((allow: any) => [
        allow.publicApiKey(),
        allow.groups(['ampless-admin', 'ampless-editor']),
      ]),

    getPublishedPost: a
      .query()
      .arguments({ siteId: a.string(), slug: a.string().required() })
      .returns(a.ref('PublicPost'))
      .handler(
        a.handler.custom({
          dataSource: a.ref('Post'),
          entry: resolverPaths.getPublishedPost,
        })
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .authorization((allow: any) => [
        allow.publicApiKey(),
        allow.groups(['ampless-admin', 'ampless-editor']),
      ]),

    // Tag pages: newest-first only. Archive (date range) within a tag is not
    // a common UX pattern; if it's ever needed, add `from`/`to` args here.
    listPostsByTag: a
      .query()
      .arguments({
        siteId: a.string(),
        tag: a.string().required(),
        limit: a.integer(),
        nextToken: a.string(),
      })
      .returns(a.ref('PublicPostConnection'))
      .handler(
        a.handler.custom({
          dataSource: a.ref('PostTag'),
          entry: resolverPaths.listPostsByTag,
        })
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .authorization((allow: any) => [
        allow.publicApiKey(),
        allow.groups(['ampless-admin', 'ampless-editor']),
      ]),

    // User management ops, only wired when the caller supplies a
    // Lambda function ref. Conditionally spread because
    // `a.handler.function(undefined)` is not a valid call — projects
    // that haven't opted into the user-admin Lambda must not see
    // these schema entries.
    ...(opts.userAdminFunction
      ? {
          AdminUser: a.customType({
            userId: a.string().required(),
            email: a.string().required(),
            // 'admin' | 'editor' | 'none' — stored as string because
            // a.enum() in customType doesn't round-trip cleanly across
            // AppSync's typegen + the admin client cast pattern.
            role: a.string().required(),
          }),
          listAdminUsers: a
            .query()
            .returns(a.ref('AdminUser').array())
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .handler(a.handler.function(opts.userAdminFunction as any))
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .authorization((allow: any) => [allow.groups(['ampless-admin'])]),
          setAdminUserRole: a
            .mutation()
            .arguments({
              userId: a.string().required(),
              role: a.string().required(),
            })
            .returns(a.ref('AdminUser'))
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .handler(a.handler.function(opts.userAdminFunction as any))
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .authorization((allow: any) => [allow.groups(['ampless-admin'])]),
        }
      : {}),
  }
}

/**
 * Convenience helper: build a fully-instantiated `a.schema(...)`
 * containing ampless's models plus any caller-supplied custom models.
 * Pick whichever pattern fits — direct spread is more transparent
 * when reading `amplify/data/resource.ts`, this helper is shorter
 * when there are no custom models.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extendAmplessSchema(a: any, custom?: Record<string, any>, opts?: AmplessSchemaModelsOpts) {
  return a.schema({
    ...amplessSchemaModels(a, opts),
    ...(custom ?? {}),
  })
}

export interface AmplessSchemaAuthorizationOpts {
  /**
   * Optional Amplify `defineFunction` ref for the MCP HTTP handler.
   * When supplied, the schema gains `allow.resource(fn).to(['query',
   * 'mutate'])` so the Lambda can sign AppSync requests with SigV4
   * under its own IAM role (no Cognito identity / shared API key).
   *
   * Resource auth is currently only honoured at schema scope by
   * `@aws-amplify/data-schema` (model-level `.authorization` callbacks
   * destructure `resource` out of their `allow` parameter), so this
   * grant applies broadly — every model the Lambda calls is reachable.
   * That's wider than strictly necessary; the MCP tools' GraphQL
   * operations narrow the effective surface to Post / PostTag in
   * Phase 4 and Media in Phase 5.
   *
   * Typed as `unknown` for the same reason `userAdminFunction` /
   * `mcpHandlerFunction` are in other helpers — `defineFunction`'s
   * return type carries internal pnpm paths that don't survive
   * declaration emit.
   */
  mcpHandlerFunction?: unknown
}

/**
 * Schema-level authorization rules for ampless. Pass the result into
 * `a.schema({...}).authorization((allow) => [...])` in the user's
 * `amplify/data/resource.ts`. When no Lambda function refs are
 * supplied the function returns `[]`, so the schema stays unaffected.
 *
 * Return type is `any[]` (matching the rest of this module's
 * intentional looseness around `@aws-amplify/data-schema`'s heavily
 * generic builder types) so callers don't have to wrestle the
 * generic `SchemaAuthorization<…>` parameters that change between
 * minor versions. `amplify/data/resource.ts` strict-type-checks fine
 * downstream because the schema itself still resolves through
 * `ClientSchema<typeof schema>` correctly.
 *
 * Usage:
 *
 *     const schema = a.schema({
 *       ...amplessSchemaModels(a, { resolverPaths, userAdminFunction }),
 *       ...customSchemaModels(a),
 *     }).authorization((allow) => amplessSchemaAuthorization(allow, {
 *       mcpHandlerFunction: mcpHandler,
 *     }))
 */
export function amplessSchemaAuthorization(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  allow: any,
  opts: AmplessSchemaAuthorizationOpts = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rules: any[] = []
  if (opts.mcpHandlerFunction) {
    rules.push(allow.resource(opts.mcpHandlerFunction).to(['query', 'mutate']))
  }
  return rules
}

/**
 * Standard authorization modes for ampless. `userPool` is the default
 * (admin/editor access); the API key serves the public read endpoints
 * because `a.handler.custom` doesn't support `allow.guest()` in
 * Amplify Gen 2 (verified 2026-04). The key has a 365-day TTL; the
 * `@ampless/backend/functions/api-key-renewer` Lambda rotates it
 * monthly so the public site never silently 401s.
 */
export const defaultAuthorizationModes: Parameters<typeof defineData>[0]['authorizationModes'] = {
  defaultAuthorizationMode: 'userPool',
  apiKeyAuthorizationMode: { expiresInDays: 365 },
}
