> 日本語版: [SECURITY.ja.md](./SECURITY.ja.md)

# Security policy

## Supported versions

ampless is in **beta** — packages publish to npm under the `beta` dist-tag. Only the latest published `beta.N` of each package receives security fixes. There are no LTS or back-port branches.

Alpha tarballs are legacy snapshots from the closed dogfood period and are not back-ported; fixes land by moving forward to beta. RC and stable will follow standard semver back-porting.

## Reporting a vulnerability

**Please do not open public issues for security problems.** Use one of the following private channels:

- **Preferred (once enabled): GitHub Private Vulnerability Reporting.** Open a private report at <https://github.com/heavymoons/ampless/security/advisories/new>. If the page returns 404 or "not enabled", use the email fallback below instead.
- **Email: `ishikawa.naoto@heavymoons.net`** with subject prefix `[ampless security]`. If you're unsure whether the PVR form is live, this is always a safe choice.

Please include:

- A description of the issue and which package / surface is affected (e.g. `@ampless/runtime`, plugin secret encryption, public renderer, MCP HTTP transport)
- Minimal reproduction steps or a proof-of-concept
- The version of ampless you tested against
- Whether you have already disclosed this elsewhere

## Response timeline

ampless is currently maintained by a single person on a best-effort basis. There is **no SLA** for response or fix turnaround. In practice, expect:

- Acknowledgement: within a week of report (usually faster)
- Triage assessment: within two weeks of report
- Fix / disclosure plan: communicated case-by-case after triage

If you do not receive an acknowledgement within a reasonable time, please follow up on the same channel.

## Disclosure preference

ampless prefers coordinated disclosure. A reasonable embargo will be agreed on for any confirmed vulnerability so a fix can ship before public disclosure. Reporters who follow this process are credited in the changelog (or anonymously, if preferred).
