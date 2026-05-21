---
"@ampless/backend": patch
---

Fix CloudFormation deployment failure for the `mcp-handler` Function
URL added in the Phase 3 of the v0.2 MCP HTTP transport rebuild.

The CFN error:

> Properties validation failed for resource
> `mcphandlerlambdaFunctionUrl1CB2E3DA` with message: ...
> The stack named ... failed to deploy: UPDATE_ROLLBACK_COMPLETE

Root cause: the CORS `allowedMethods` list included
`HttpMethod.OPTIONS`. The CDK `HttpMethod` enum exposes `OPTIONS`, so
TypeScript was happy, but the Lambda Function URL's CFN resource only
accepts `* | GET | PUT | HEAD | POST | PATCH | DELETE` and rejects
`OPTIONS` at deploy time. Preflight is handled automatically by the
Function URL CORS layer — `allowedMethods` should only list the
"real" HTTP methods the endpoint serves.

Fix: drop `HttpMethod.OPTIONS` from the list, leaving `[POST]`. The
handler's defensive 204-on-OPTIONS branch stays (it's harmless and
covers any non-CORS client that sends OPTIONS manually).
