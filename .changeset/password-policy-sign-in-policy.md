---
"@ampless/backend": patch
---

Fix passkey sign-in failing with "WebAuthn not enabled for this pool": the password-policy override assigned `cfnUserPool.policies` wholesale, wiping the `SignInPolicy.AllowedFirstAuthFactors` (`PASSWORD`, `WEB_AUTHN`) that the auth construct emits when webAuthn is enabled. The override is now path-scoped to `Policies.PasswordPolicy`, so the sign-in policy survives. Redeploy (`npx ampx sandbox` / pipeline deploy) after updating to apply the corrected user pool configuration.
