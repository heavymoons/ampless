---
"create-ampless": patch
---

template: `cms.config` `history` option + dispatcher handler shell wiring.

The scaffolded `amplify/events/dispatcher/handler.ts` now calls
`createDispatcherHandler({ historyRetentionDays: config.history?.retentionDays ?? 0 })`
instead of bare-re-exporting `handler`, so the post-revision retention window
is driven from the user-side `cms.config`. A commented `history: { retentionDays: 0 }`
example is added to the template `cms.config.ts`.
