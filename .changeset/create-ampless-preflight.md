---
"create-ampless": minor
---

Add pre-flight checks to `create-ampless --deploy`. The CLI now verifies every prerequisite (gh installed + authenticated with `repo` scope, aws installed + credentialed, target GitHub repo + Amplify app name free, CDK bootstrap stack present, Route 53 hosted zone for `--domain`, and an Amplify Hosting IAM service role with `AmplifyBackendDeployFullAccess`) BEFORE any side effect — so a missing prereq never leaves the user with a half-created GitHub repo or Amplify app to clean up.

Two new flags control the IAM service role resolution: `--iam-service-role <arn>` reuses an existing role, and `--create-iam-role` opts into letting `create-ampless` provision (idempotently) a role named `AmplifyDeployBackend`. With neither flag, pre-flight searches IAM for an existing role that trusts `amplify.amazonaws.com` and has `AmplifyBackendDeployFullAccess` attached; if none is found, it fails with copy-pasteable remediation rather than silently building one.
