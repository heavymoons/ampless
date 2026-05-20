> 日本語版: [04-access-layer-mcp.ja.md](./04-access-layer-mcp.ja.md)
> 
## 4. Access Layer and MCP

### Design Philosophy

Content can be accessed through multiple paths, but all business logic is consolidated in the Core library.
Each interface is a thin adapter that simply calls Core.

```
Admin UI (Next.js)  ─┐
REST / GraphQL API  ─┤─→  Core (packages/ampless)  ─→  DynamoDB / S3
MCP Server          ─┘
```

### Core Library (`packages/ampless`)

Provides all CRUD operations, permission checks, and format conversions.

```typescript
// packages/ampless/src/core.ts
interface AuthContext {
  userId: string
  role: 'reader' | 'editor' | 'admin'
  source: 'cognito' | 'api-key' | 'mcp'
}

// All operations receive an AuthContext
function getPost(auth: AuthContext, siteId: string, postId: string) { ... }
function updatePost(auth: AuthContext, siteId: string, postId: string, data: ...) { ... }
function listPosts(auth: AuthContext, siteId: string, options?: ListOptions) { ... }
```

### Authentication

Passwordless Cognito authentication is the default.

#### Login Flow

```
Enter email address → Cognito sends a one-time code → Enter code → Login complete
```

- No password management required. Reduces security risk
- Implemented with Cognito `CUSTOM_AUTH` flow + Lambda trigger
- Passkey support may be considered in the future

#### Amplify Auth Configuration

```typescript
// amplify/auth/resource.ts
export const auth = defineAuth({
  loginWith: { email: true },
  groups: ['ampless-admin', 'ampless-editor', 'ampless-reader'],
  triggers: {
    postConfirmation: defineFunction({ name: 'post-confirmation' }),
  },
})
```

Cognito user groups are automatically created simply by declaring them in `groups`.

#### Initial Setup

```
1. Generate project with npx create-ampless@latest
2. After deployment, a setup screen appears on first access
3. Enter the administrator's email address
4. Authenticate with a one-time code → the first user is automatically added to the admin group
5. Subsequent users cannot access the admin panel unless invited by an admin
```

Automatic admin registration for the first user is implemented via the Post Confirmation Lambda trigger:

```typescript
// amplify/auth/post-confirmation.ts
export async function handler(event) {
  const cognito = new CognitoIdentityProviderClient({})

  // admin group is empty = first user → add to admin
  const group = await cognito.send(new ListUsersInGroupCommand({
    UserPoolId: event.userPoolId,
    GroupName: 'ampless-admin',
  }))

  if (group.Users.length === 0) {
    await cognito.send(new AdminAddUserToGroupCommand({
      UserPoolId: event.userPoolId,
      Username: event.userName,
      GroupName: 'ampless-admin',
    }))
  }

  return event
}
```

#### User Management

The admin panel's user management page calls the Cognito Admin API directly.
No custom user table is maintained.

| Operation | Who can perform it | Cognito API |
|-----------|-------------------|------------|
| Initial admin registration | First setup only | Post Confirmation trigger |
| Invite user | admin | `AdminCreateUser` (invitation email sent automatically) |
| Assign/change role | admin | `AdminAddUserToGroup` / `AdminRemoveUserFromGroup` |
| List users | admin | `ListUsers` |
| Delete user | admin | `AdminDeleteUser` |
| Own login | Invited user | Normal auth flow |

The Cognito Admin API is protected by IAM and cannot be called directly from a browser.
Access is only permitted through Server Actions / API Routes.

#### Security Measures

Authentication and authorization checks are required for all admin panel operations (Server Actions / API Routes).

```typescript
// Executed at the start of every Server Action
async function requireAdmin() {
  const session = await getServerSession()
  if (!session) throw new Error('Unauthorized')
  if (!session.groups.includes('ampless-admin')) throw new Error('Forbidden')
  return session
}
```

| Risk | Mitigation |
|------|-----------|
| Unauthenticated user access | Auth check in every Server Action |
| editor performing admin operations | Role check |
| Self-promotion to admin | Cognito group changes restricted to admin only |
| Deleting the last admin | Block any operation that would leave the admin group empty |

#### Cognito User Groups

| Cognito Group | Role | Description |
|--------------|------|-------------|
| `ampless-admin` | admin | Full permissions: user management, site settings, plugin management |
| `ampless-editor` | editor | Create, edit, and delete content |
| `ampless-reader` | reader | Read published content (for API consumers) |

### Permission Model

| Role | Permitted actions |
|------|------------------|
| `reader` | Read published content |
| `editor` | Create, edit, and delete content |
| `admin` | Site settings, plugin management, user management |

Role-based access control applies uniformly regardless of auth source.

| Source | Auth method | Role determination |
|--------|------------|-------------------|
| Admin UI | Cognito one-time code | From Cognito user group |
| REST API | API key | Set at key issuance |
| MCP | MCP access token | Set at token issuance |

#### Editor Trust Model (Specification)

In ampless, `editor` is treated as a **trusted principal**. Following the same philosophy as WordPress's `unfiltered_html` capability, **editors can save arbitrary HTML / JavaScript as post body content** — this is a deliberate design decision.

Specifically:

- The `body` field of a Post is not sanitized server-side
  - No sanitization for any of the `format: 'tiptap' | 'markdown' | 'html'` formats
  - tiptap attributes (`href`, `src`, `alt`, `title`, etc.) are also not sanitized
  - `<script>` tags, `javascript:` URIs, and event handler injection via attribute breakout are all preserved as-is and rendered via `dangerouslySetInnerHTML` on the public page
- As a result, an editor can **execute arbitrary JavaScript in any browser that views the public post (including admin browsers)**
- This is an explicit design decision not to constrain editor permissions to "content CRUD only," prioritizing expressive freedom (embedded widgets, campaign pages with custom scripts, HTML email templates, etc.)

**Operational implications:**

- **Grant editor permissions only to individuals trusted at the same level as admins.** For untrusted users, assign only `reader`, or isolate them in a separate Cognito User Pool (separate Amplify environment).
- If an editor acts maliciously, the upper bound of permissions obtainable is equivalent to `admin` (an editor can steal an admin's Cognito JWT from localStorage via a published post and operate AppSync as admin).
- For operators who want to change this trade-off, an **opt-in sanitization plugin** (DOMPurify-based) will be provided in v0.2 or later. Rather than changing the schema, the plugin will rewrite the body via a `before:content.update` hook.

**Handling in security reviews:**

Findings that include an editor-privileged attacker in the threat model (editor-to-admin privilege escalation, JWT leakage via stored XSS, arbitrary script storage via `format: 'html'`, etc.) are **by design, not vulnerabilities**. During reviews, explicitly exclude these paths as specified behavior and treat the following as actual vulnerabilities:

- Paths by which an unauthenticated (or `reader`-only) principal can perform editor-level writes
- Paths by which an editor's actions affect other tenants (sites with different `siteId` — applicable in v0.2 multi-site)
- Server-side RCE, secret leakage, or IAM privilege escalation that does not go through the admin/operator

### MCP Server (`packages/mcp-server`)

An MCP interface allowing AI agents (e.g., Claude) to manage content.

```
packages/
  ampless/        ← Core (shared business logic)
  mcp-server/     ← MCP adapter (depends on Core)
```

#### MCP Tools (planned)

| Tool | Role | Description |
|------|------|-------------|
| `list_posts` | reader | Retrieve post list |
| `get_post` | reader | Retrieve a post (format can be specified) |
| `create_post` | editor | Create a post |
| `update_post` | editor | Update a post |
| `delete_post` | editor | Delete a post |
| `upload_media` | editor | Upload a media file |
| `get_schema` | reader | Retrieve content schema |
| `manage_site` | admin | Change site settings |
| `manage_plugins` | admin | Install and configure plugins |

#### MCP and trust_level

The MCP Server calls the ampless Core directly, so it is independent of plugin trust_level.
Permissions are controlled by the role associated with the MCP access token.

### v1 Policy
- The admin UI and MCP Server share the same Core library
- REST API will be added in v0.2 or later
- MCP Server is available from v0.1 (a key AI-first differentiator)

---
