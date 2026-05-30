# {{nameKebab}}

{{description}}

Site-local plugin in `plugins/{{nameKebab}}/`. This directory is
user-owned: `update-ampless` never touches it.

## Register

Add to `cms.config.ts`:

```typescript
import {{nameCamelCase}}Plugin from './plugins/{{nameKebab}}'

export default defineConfig({
  // ...
  plugins: [
    {{nameCamelCase}}Plugin(),
  ],
})
```

Restart `next dev` and visit `/admin/plugins` to configure.

## Settings

(none yet — declare via `settings.public` in `index.ts`)

## Notes

- Trust level: `{{trustLevel}}`
- Capabilities: `{{capabilitiesList}}`
- When this plugin grows useful for more than one site, lift it into
  its own npm package via `npx create-ampless plugin <name> --standalone`.
