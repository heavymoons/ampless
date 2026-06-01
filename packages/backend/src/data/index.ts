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
  getMediaBySrc: string
}

/**
 * Default AppSync JS resolver paths. AppSync resolves these strings at
 * CDK synth time relative to the file that calls `defineData` — i.e.
 * the user's `amplify/data/resource.ts`. Templates ship the resolver
 * files at exactly these paths.
 *
 * Users with a non-default layout (e.g. moving the resolvers under a
 * `resolvers/` subdir) pass overrides through `amplessSchemaModels(a, {
 * resolverPaths: { ... } })`.
 */
export const DEFAULT_RESOLVER_PATHS: AmplessResolverPaths = {
  listPublishedPosts: './list-published-posts.js',
  getPublishedPost: './get-published-post.js',
  listPostsByTag: './list-posts-by-tag.js',
  getMediaBySrc: './get-media-by-src.js',
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
  /**
   * Optional Amplify `defineFunction` ref backing the plugin-secret
   * mutation ops (`setPluginSecret`, `clearPluginSecret`).
   *
   * When supplied, the mutations are added to the schema and routed to
   * this Lambda. The Lambda receives the plaintext from admin browser,
   * encrypts with the env-var key, and writes ciphertext to the
   * PluginSecret table. Admin/editor Cognito users never touch
   * PluginSecret directly — only the Lambda (via IAM) does.
   *
   * Typed as `unknown` for the same reason as `userAdminFunction`.
   */
  pluginSecretHandlerFunction?: unknown
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
      })
      .identifier(['postId'])
      // Secondary indexes for the public-read resolvers.
      //   byStatus — PK = status, SK = publishedAt → newest-first listing
      //     of published posts (drafts live in their own partition).
      //   bySlug — PK = slug → O(1) lookup by slug. Slugs are unique
      //     across the site, enforced at the admin form level.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .secondaryIndexes((index: any) => [
        index('status').sortKeys(['publishedAt']).name('byStatus'),
        index('slug').name('bySlug'),
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
        pageId: a.id().required(),
        slug: a.string().required(),
        title: a.string().required(),
        format: a.enum(['tiptap', 'markdown', 'html', 'static']),
        body: a.json(),
        status: a.enum(['draft', 'published']),
        publishedAt: a.datetime(),
      })
      .identifier(['pageId'])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .authorization((allow: any) => [
        allow.groups(['ampless-admin', 'ampless-editor']),
      ]),

    Media: a
      .model({
        mediaId: a.id().required(),
        src: a.string().required(),
        mimeType: a.string().required(),
        size: a.integer(),
        delivery: a.string(),
        // Free-form per-asset metadata (JSON). Currently used to
        // memoise the S3 ETag for stream-back routes; future use
        // for image dimensions, EXIF strip status, etc. Kept loose
        // because the field is read by routes that only need a few
        // hints (no schema-level commitment).
        metadata: a.json(),
      })
      .identifier(['mediaId'])
      // Secondary index on `src` lets the media-proxy route resolve
      // a Media row in one O(1) Query rather than scanning. The
      // src is the S3 key (`public/media/...`) and is unique across
      // the table — uploads use a timestamp-prefixed naming scheme.
      // The `getMediaBySrc` custom resolver below targets this index
      // by its explicit name.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .secondaryIndexes((index: any) => [index('src').name('bySrc')])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .authorization((allow: any) => [
        allow.groups(['ampless-admin', 'ampless-editor']),
      ]),

    Taxonomy: a
      .model({
        termId: a.id().required(),
        type: a.enum(['category', 'tag']),
        name: a.string().required(),
        slug: a.string().required(),
      })
      .identifier(['termId'])
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
    //   PK: tag               e.g. "tech"
    //   SK: publishedAtPostId e.g. "2026-04-27T13:57:05.679Z#post-001"
    PostTag: a
      .model({
        tag: a.string().required(),
        publishedAtPostId: a.string().required(),
        postId: a.id().required(),
        publishedAt: a.datetime().required(),
        slug: a.string().required(),
        title: a.string().required(),
        excerpt: a.string(),
        // Full tag list of the post (for chip rendering on tag pages).
        tags: a.string().array(),
      })
      .identifier(['tag', 'publishedAtPostId'])
      // Lambda resource auth covered at schema scope — see Post for the
      // explanation.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .authorization((allow: any) => [
        allow.groups(['ampless-admin', 'ampless-editor']),
      ]),

    // Generic key/value store. Two roles in one table:
    //   - Site settings: PK = `siteconfig`, SK = dotted key
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

    // Admin-issued API tokens for the HTTP MCP endpoint. Identifier =
    // SHA-256 hex of plaintext; the Lambda hashes incoming Bearers and
    // GetItem's this table directly (bypassing AppSync) so token
    // validation costs one DDB read.
    //
    // Admin-only authorization is the security boundary: the MCP
    // Lambda runs every tool with its own IAM role independent of the
    // issuer's Cognito group, so editors must not be able to mint
    // tokens that bypass their own group restrictions. KvStore is
    // shared with editors for site settings / caches; this model is
    // deliberately separate so the namespace can't be smuggled into
    // there.
    McpToken: a
      .model({
        hash: a.string().required(),
        prefix: a.string().required(),
        createdBy: a.string().required(),
        createdByEmail: a.string().required(),
        issuedAt: a.datetime().required(),
        lastUsedAt: a.datetime(),
        expiresAt: a.datetime(),
        revokedAt: a.datetime(),
      })
      .identifier(['hash'])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .authorization((allow: any) => [
        allow.groups(['ampless-admin']),
      ]),

    // Isolated secret storage for trusted plugins (Phase 6a).
    //
    // This is a COMPLETELY SEPARATE model from KvStore. KvStore grants
    // admin/editor full read access through AppSync, which means any
    // value stored there can be read by anyone with admin/editor
    // credentials. PluginSecret is intentionally inaccessible to
    // admin/editor Cognito users via AppSync — the only way to write
    // a secret is through the `setPluginSecret` / `clearPluginSecret`
    // AppSync mutations which are backed by the plugin-secret-handler
    // Lambda. The Lambda receives the plaintext, reads the encryption
    // key from `process.env.PLUGIN_SECRET_ENCRYPTION_KEY` (injected by
    // CDK at deploy time from `amplify/secrets/encryption-key.ts` — see
    // Phase 6a v2.2 in docs/architecture/08-plugin-architecture.md),
    // and performs the DDB PutItem using its own IAM role. Ciphertext
    // never flows back to the browser.
    //
    // Authorization design:
    //   - admin / editor: NO direct AppSync access. All writes go
    //     through the plugin-secret-handler Lambda mutation.
    //   - IAM (Lambda): full read+write. Both the plugin-secret-handler
    //     (writes ciphertext) and the trusted-processor (reads +
    //     decrypts) use IAM-signed DDB SDK calls.
    //
    // Storage key convention:
    //   siteId = 'default'   (single-site architecture)
    //   sk = `plugins.${instanceId ?? name}.${fieldKey}`
    //
    // DynamoDB auto-encrypts at rest (AWS-managed KMS key). Secrets
    // never flow to the S3 site-settings mirror because the trusted
    // processor only queries KvStore (pk='siteconfig') for that path —
    // PluginSecret is a structurally separate table.
    PluginSecret: a
      .model({
        // Single-site architecture: siteId is always 'default'.
        siteId: a.string().required(),
        // Composite sort key: `plugins.<instanceId>.<fieldKey>`
        sk: a.string().required(),
        // The secret value stored as AES-256-GCM ciphertext (base64).
        // Format: base64( IV[12] || ciphertext || authTag[16] ).
        // Encrypted by the plugin-secret-handler Lambda using the key
        // in `process.env.PLUGIN_SECRET_ENCRYPTION_KEY` (set by CDK at
        // deploy time from the `amplify/secrets/encryption-key.ts`
        // constant). Even if an AWS account operator reads this column
        // via the DDB Console they only see ciphertext — the key lives
        // outside DynamoDB. The honest threat model is documented in
        // docs/architecture/08-plugin-architecture.md: defeated for
        // DDB-only browsing, NOT defeated for anyone with source repo
        // / deploy artifact access, NOT defeated for a malicious
        // trusted plugin co-located in the same Lambda.
        value: a.string().required(),
      })
      .identifier(['siteId', 'sk'])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .authorization((allow: any) => [
        // IAM only — no Cognito group has any AppSync access.
        // plugin-secret-handler Lambda writes (PutItem / DeleteItem).
        // trusted-processor Lambda reads (GetItem, read-only grant
        // in backend.ts via grantReadData).
        allow.authenticated('iam').to(['read', 'create', 'update', 'delete']),
      ]),

    // Existence-only indicator for PluginSecret rows.
    //
    // Admin/editor Cognito users cannot read from PluginSecret at all
    // (IAM-only authorization above). But the admin UI needs to know
    // whether a secret has been saved so it can show the "stored"
    // indicator (••••••••) vs an empty input. PluginSecretIndicator
    // solves this without ever exposing ciphertext or plaintext to the
    // browser — it stores only the timestamp of the last write.
    //
    // The plugin-secret-handler Lambda writes to both tables atomically
    // (in practice: two sequential DDB puts; true DDB transactions would
    // require TransactWriteItems which adds latency; an extra indicator
    // row is at most stale-indicator-but-no-secret, which degrades
    // gracefully as a false "stored" indicator in the UI).
    PluginSecretIndicator: a
      .model({
        siteId: a.string().required(),
        // Same sort-key format as PluginSecret:
        //   `plugins.${instanceId ?? name}.${fieldKey}`
        sk: a.string().required(),
        // ISO 8601 datetime string — set by plugin-secret-handler on
        // every write. Admin UI may show this as "last updated" hint.
        lastSetAt: a.datetime().required(),
      })
      .identifier(['siteId', 'sk'])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .authorization((allow: any) => [
        // Admin/editor can read and write (write needed for clear).
        allow.groups(['ampless-admin', 'ampless-editor']),
        // plugin-secret-handler Lambda also writes via IAM.
        allow.authenticated('iam').to(['read', 'create', 'update', 'delete']),
      ]),

    // Custom return type for public post reads. Decoupling from `Post` lets
    // AppSync skip the model-level (admin-only) auth check on fields.
    //
    // `updatedAt` is projected through so middleware can compute the
    // `metadata.cache='auto'` cooldown without re-fetching the model
    // row. It's an Amplify-managed DynamoDB attribute (set on every
    // write); the JS resolvers pass items through verbatim so the
    // value naturally appears here once the schema declares it.
    PublicPost: a.customType({
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
      updatedAt: a.datetime(),
    }),

    // Paginated wrapper for list responses.
    PublicPostConnection: a.customType({
      items: a.ref('PublicPost').array(),
      nextToken: a.string(),
    }),

    // Minimal Media projection for the public-facing `getMediaBySrc`
    // query. Decoupling from the `Media` model lets the custom
    // resolver bypass the model-level (admin/editor only) auth check
    // on fields, and intentionally keeps `mediaId` / `delivery` /
    // anything else off the wire — guests only need `size` /
    // `mimeType` / `metadata` for the stream-back read path.
    PublicMedia: a.customType({
      src: a.string().required(),
      size: a.integer(),
      mimeType: a.string(),
      metadata: a.json(),
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
      .arguments({ slug: a.string().required() })
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

    // Public Media lookup by S3 key. Called by the `/api/media/...`
    // route handler so guests can resolve `{ size, mimeType, metadata }`
    // and the route can stream the bytes back with the right headers
    // (and skip a HEAD round-trip on cold reads). The custom JS
    // resolver targets the Media table's `bySrc` GSI directly so the
    // lookup is one O(1) Query.
    //
    // Auth: `allow.publicApiKey()` — same model as the post queries
    // above. `a.handler.custom` doesn't accept `allow.guest()` in
    // Amplify Gen 2, so the API key (auto-renewed every 365 days) is
    // the standard public-read channel. The resolver returns only the
    // narrow `PublicMedia` projection — no `mediaId` / `delivery` /
    // anything else leaks to guests.
    getMediaBySrc: a
      .query()
      .arguments({ src: a.string().required() })
      .returns(a.ref('PublicMedia'))
      .handler(
        a.handler.custom({
          dataSource: a.ref('Media'),
          entry: resolverPaths.getMediaBySrc,
        })
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .authorization((allow: any) => [
        allow.publicApiKey(),
        allow.groups(['ampless-admin', 'ampless-editor']),
      ]),

    // Plugin secret mutation ops, only wired when the caller supplies a
    // Lambda function ref. Conditionally spread because
    // `a.handler.function(undefined)` is not a valid call.
    //
    // setPluginSecret:   admin browser sends plaintext → Lambda encrypts
    //                    (AES-256-GCM, env-var key) → DDB PutItem on
    //                    PluginSecret + PutItem on PluginSecretIndicator.
    // clearPluginSecret: Lambda deletes from both tables.
    //
    // Both ops require Cognito group admin-or-editor — the Lambda still
    // re-checks via the Cognito token in the AppSync event context so
    // a raw IAM call bypassing AppSync cannot skip the group gate.
    ...(opts.pluginSecretHandlerFunction
      ? {
          setPluginSecret: a
            .mutation()
            .arguments({
              fieldKey: a.string().required(),
              instanceId: a.string().required(),
              value: a.string().required(),
            })
            .returns(a.string())
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .handler(a.handler.function(opts.pluginSecretHandlerFunction as any))
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .authorization((allow: any) => [
              allow.groups(['ampless-admin', 'ampless-editor']),
            ]),
          clearPluginSecret: a
            .mutation()
            .arguments({
              fieldKey: a.string().required(),
              instanceId: a.string().required(),
            })
            .returns(a.string())
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .handler(a.handler.function(opts.pluginSecretHandlerFunction as any))
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .authorization((allow: any) => [
              allow.groups(['ampless-admin', 'ampless-editor']),
            ]),
        }
      : {}),

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
   * operations narrow the effective surface to Post / PostTag for
   * content tools and Media for `upload_media`.
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
