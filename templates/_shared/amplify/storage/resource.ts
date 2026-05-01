import { defineStorage } from '@aws-amplify/backend'

export const storage = defineStorage({
  name: 'amplessMedia',
  access: (allow) => ({
    'public/media/*': [
      allow.guest.to(['read']),
      allow.groups(['ampless-admin', 'ampless-editor']).to(['read', 'write', 'delete']),
    ],
    'public/plugins/*': [
      allow.guest.to(['read']),
      allow.groups(['ampless-admin']).to(['read', 'write', 'delete']),
    ],
  }),
})
