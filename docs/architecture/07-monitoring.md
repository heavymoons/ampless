> 日本語版: [07-monitoring.ja.md](./07-monitoring.ja.md)
> 
## 7. Monitoring and Alarms

### Design Philosophy

To help users unfamiliar with AWS understand the operational status of their CMS,
`backend.ts` automatically generates CloudWatch dashboards and alarms.
Users can check the operational state simply by opening the AWS console.

### Auto-Generated Dashboard

The CDK definition in `backend.ts` creates a dashboard including the following metrics.

| Category | Metrics | Meaning |
|----------|---------|---------|
| Content API | Lambda error rate, latency (p50/p99) | Is the site operating normally? |
| Event processing | SQS queue depth, DLQ message count | Are hooks and webhooks backed up? |
| Storage | DynamoDB read/write capacity consumption, throttling | Is the DB backing up under increased load? |
| Media | S3 request count, bucket size | Track storage costs |
| Auth | Cognito sign-in success/failure | Detect unauthorized login attempts |

### Auto-Generated Alarms

A minimal set of alarms is configured by default.

| Alarm | Condition | Notification target |
|-------|-----------|-------------------|
| DLQ backlog | 1 or more messages in DLQ | Email (SNS) |
| Lambda error rate | Error rate > 5% (over 5 minutes) | Email (SNS) |
| DynamoDB throttling | Throttle event occurs | Email (SNS) |

The notification email address is configured in `cms.config.ts`:

```typescript
// cms.config.ts
export default defineConfig({
  monitoring: {
    alertEmail: 'admin@example.com',
  }
})
```

### Customization

Users are free to edit and extend the auto-generated dashboard in the AWS console.
To prevent ampless updates from overwriting user modifications, it is recommended to save customized dashboards under a different name.

### v1 Policy
- v0.2: Auto-generate dashboard + DLQ alarm
- v1.0: Full alarm coverage, basic status display inside the admin UI

---
