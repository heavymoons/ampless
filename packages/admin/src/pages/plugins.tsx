import { redirect } from 'next/navigation'
import type {
  AmplessPlugin,
  PluginSettingField,
  PluginSecretField,
  LocalizedString,
} from 'ampless'
import { isValidPluginKey } from 'ampless'
import type { Admin } from '../index.js'
import { PluginSettingsForm } from '../components/plugin-settings-form.js'

// Same guard as runtime's plugin-head.ts. `apiVersion` is the
// cheapest discriminator: it exists on every plugin instance, and
// hand-typed `string` entries from cms.config.plugins fail it.
function isPlugin(p: unknown): p is AmplessPlugin {
  return typeof p === 'object' && p !== null && 'apiVersion' in p
}

interface PluginEntry {
  instanceId: string
  displayName?: LocalizedString
  fields: ReadonlyArray<PluginSettingField>
  /** Stored values keyed by public field `key`. */
  values: Record<string, unknown>
  secretFields: ReadonlyArray<PluginSecretField>
}

/**
 * Server-rendered `/admin/plugins` page factory. Walks
 * `cmsConfig.plugins`, surfaces every entry that declares a
 * `settings.public` OR `settings.secret` manifest, and reads any
 * stored public values up front so the form can pre-fill without
 * round-tripping AppSync on mount. Secret presence is detected
 * client-side per-field via `hasPluginSecret()` so this server page
 * never touches the secret indicator table.
 *
 * Plugins without either manifest still appear in `cms.config.ts`
 * but disappear from this listing — they have nothing for the admin
 * to edit. That's deliberate: a "Plugins" listing with everything is
 * coming in a later phase that wires the broader plugin inspector,
 * not here.
 */
export function createPluginsPage(admin: Admin) {
  const { cmsConfig, t } = admin

  async function PluginsPage() {
    const session = await admin.getServerSession()
    // Use isEditor as the gate — `editor` already has theme-settings
    // write rights, and plugin settings sit in the same threat tier
    // (rendered into <head>, no secret material). Admin-only setups
    // can still scope further at the Cognito group level.
    if (!session || !admin.isEditor(session)) {
      redirect('/admin')
    }

    const entries: PluginEntry[] = []
    const raw = cmsConfig.plugins ?? []
    for (const p of raw) {
      if (!isPlugin(p)) continue
      const instanceId = p.instanceId ?? p.name
      if (!isValidPluginKey(instanceId)) continue
      // Filter manifest to fields with valid keys — they're the only
      // ones the runtime will actually round-trip through DDB.
      const validPublic = (p.settings?.public ?? []).filter((f) =>
        isValidPluginKey(f.key),
      )
      const validSecret = (p.settings?.secret ?? []).filter((f) =>
        isValidPluginKey(f.key),
      )
      if (validPublic.length === 0 && validSecret.length === 0) continue
      // Skip the public-values load entirely when the plugin only has
      // secret fields — there's nothing to pre-fill and the DDB read
      // would be wasted.
      const values =
        validPublic.length > 0
          ? await admin.loadPluginPublicSettings(instanceId)
          : {}
      entries.push({
        instanceId,
        displayName: p.displayName,
        fields: validPublic,
        values,
        secretFields: validSecret,
      })
    }

    return (
      <div className="mx-auto max-w-7xl p-4 md:p-8">
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl font-bold md:text-3xl">{t('plugins.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('plugins.description')}
          </p>
        </div>

        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('plugins.noConfigurablePlugins')}
          </p>
        ) : (
          <div className="space-y-6">
            {entries.map((entry) => (
              <PluginSettingsForm
                key={entry.instanceId}
                instanceId={entry.instanceId}
                displayName={entry.displayName}
                fields={entry.fields}
                initialValues={entry.values}
                secretFields={entry.secretFields}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return PluginsPage
}
