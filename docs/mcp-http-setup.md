# MCP HTTP setup

Set up the HTTP MCP endpoint so AI clients (Claude Desktop, Cursor,
Claude Code, anything that speaks MCP) can read and write your
production ampless site over the wire — no local
`amplify_outputs.json` required.

The endpoint mounts at `https://<your-domain>/api/mcp` and authenticates
with a Bearer token issued from `/admin/mcp-tokens`.

## One-time setup (per site)

ampless's HTTP MCP route runs inside your Next.js SSR Lambda. Calls to
AppSync need a Cognito id token, so the route signs in as a dedicated
**service Cognito user** that you provision once.

### 1. Create the service user

In the admin UI:

1. Sign in as an admin.
2. Open `/admin/users` and create a new account, e.g.
   `mcp-service@<your-domain>`.
3. Set a **strong** random password (the MCP route is the only thing
   that uses it, you won't type it again).
4. Promote the user to the `admin` group.

> Tip: you can disable MFA on this account in the Cognito console —
> the MCP route does username/password SRP and can't satisfy MFA
> challenges.

### 2. Set environment variables

In the Amplify Hosting console for your app:

- Open **Hosting → Environment variables**.
- Add:
  - `AMPLESS_MCP_SERVICE_EMAIL` — the service user's email
  - `AMPLESS_MCP_SERVICE_PASSWORD` — the password from step 1
- Trigger a redeploy so the SSR Lambda picks up the new env.

> Amplify Hosting encrypts environment variables at rest. They're
> only visible to your AWS account.

### 3. Issue an MCP access token

After the redeploy completes:

1. Open `/admin/mcp-tokens` in the admin UI (admin role required).
2. Click **Generate token**, give it a label that identifies where
   you'll use it (e.g. `Claude Desktop — laptop`).
3. Pick a role:
   - `admin` — all tools, including `delete_post`.
   - `editor` — every tool except destructive ones.
4. The plaintext token is shown **once**. Copy it into your MCP
   client config immediately.

If you lose a token, revoke it from the same page and issue a new
one — the plaintext is unrecoverable by design.

## Client configuration

### Claude Desktop / Claude Code

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS; see Anthropic's docs for other platforms) and add:

```json
{
  "mcpServers": {
    "ampless-prod": {
      "url": "https://<your-domain>/api/mcp",
      "headers": {
        "Authorization": "Bearer amp_mcp_<token>"
      }
    }
  }
}
```

Restart Claude Desktop. The connection should show "Connected" and
expose 6 tools.

### Cursor / others

Any MCP client that accepts a URL + custom headers works the same
way. The wire protocol is JSON-RPC 2.0 over POST.

## Available tools

| Tool | Description | Required role |
|---|---|---|
| `list_posts` | List posts with status filter + pagination | editor |
| `get_post` | Fetch a post by slug or postId | editor |
| `create_post` | Create a new post (draft or published) | editor |
| `update_post` | Patch fields on an existing post | editor |
| `delete_post` | Delete a post (and its tag index entries) | **admin** |
| `get_schema` | Return the CMS content schema | editor |

`upload_media` from the stdio CLI is **not** available over HTTP in
this release — the SSR Lambda doesn't have direct `s3:PutObject`
permission on the media bucket, and granting it across Amplify
Hosting's managed compute model is left to a follow-up release.
Upload media via the admin UI for now.

## Troubleshooting

### "AMPLESS_MCP_SERVICE_EMAIL env vars are required"

The Lambda can't see the service user creds. Confirm the env vars are
set on **Hosting → Environment variables** (not under Build settings),
and that the latest build picked them up.

### `401 unauthorized`

- The Bearer token is wrong, expired, or revoked.
- Open `/admin/mcp-tokens` to verify the token is still listed; if
  not, generate a new one.

### `403 admin role required`

The token's role is `editor` but the tool you called needs `admin`.
Issue a new token with `admin` role for that client.

### `Cognito returned NEW_PASSWORD_REQUIRED`

The service user is in the post-signup "force-reset" state. Sign in
once via `/admin/login` with the service-user credentials to land on
the permanent-password setup, set a permanent password, and put the
new password into the env var.

## Stdio CLI (for sandbox / local development)

The HTTP route replaces the stdio CLI for production. The stdio CLI
(`npx -y @ampless/mcp-server@alpha`) is still useful for:

- Operating a local `npx ampx sandbox` from an AI client during
  development.
- CI / scripted contexts that already have `amplify_outputs.json` on
  disk.

It authenticates with the user's own Cognito credentials and
short-circuits the service-user dance — but only works against a
deployment whose `amplify_outputs.json` you have access to locally.
