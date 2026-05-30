import { definePlugin, type AmplessPlugin } from 'ampless'

export interface {{NameCamelCase}}Options {
  /** Optional namespace when registering multiple instances. */
  instanceId?: string
  // TODO: add the constructor options your plugin needs.
}

/**
 * {{description}}
 */
export default function {{nameCamelCase}}Plugin(
  options: {{NameCamelCase}}Options = {}
): AmplessPlugin {
  const instanceId = options.instanceId ?? '{{nameKebab}}'
  return definePlugin({
    name: '{{nameKebab}}',
    packageName: '{{packageName}}',
    instanceId,
    apiVersion: 1,
    trust_level: '{{trustLevel}}',
    displayName: { en: '{{DisplayName}}', ja: '{{displayNameJa}}' },
    capabilities: [{{capabilitiesList}}],
    // TODO: implement the surfaces declared in `capabilities`. The
    // most common starting point is `publicHead(ctx)` returning a
    // descriptor array. See:
    //   https://github.com/heavymoons/ampless/blob/main/packages/ampless/docs/plugin-author-guide.md
  })
}
