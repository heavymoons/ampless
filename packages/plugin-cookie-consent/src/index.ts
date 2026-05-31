// @ampless/plugin-cookie-consent — GDPR/ePrivacy cookie consent banner plugin.
//
// Installs the `window.amplessConsent` Consent Convention API in `<head>`
// (afterInteractive) and appends a configurable banner UI to `<body>`
// (afterInteractive). Analytics / tracking plugins gate themselves on
// `window.amplessConsent.has(category)` and subscribe via
// `window.amplessConsent.on(category, cb)` to fire only after the visitor
// consents.
//
// Spec: docs/tmp/plugin-extension-phase3b.md §6 & §7.
// Architecture: docs/architecture/08-plugin-architecture.md — Consent Convention.

import { definePlugin, type AmplessPlugin } from 'ampless'

/** A single consent category configured by the site operator. */
export interface ConsentCategory {
  /** Machine-readable identifier, e.g. `'analytics'`. Pattern: `^[a-z][a-z0-9_-]*$`. */
  id: string
  /** Human-readable label shown in the banner UI. */
  label: string
  /** Optional description shown below the label in the banner UI. */
  description?: string
  /** Whether the category is enabled by default before the visitor makes a choice. */
  defaultEnabled?: boolean
  /**
   * Essential categories are always granted and cannot be toggled by the
   * visitor. The `publicHead` install script enforces `state[id] = true`
   * for every essential category on every page load, overriding any stored
   * value.
   */
  essential?: boolean
}

export interface CookieConsentOptions {
  /**
   * Optional namespace for this instance. Defaults to `'cookie-consent'`.
   * Set distinct values if registering the plugin more than once on the
   * same site.
   */
  instanceId?: string
}

/**
 * Escape a string so it is safe to embed as a JavaScript string literal
 * surrounded by single quotes. Handles backslash, single quote, CR, LF,
 * and Unicode line/paragraph separator (U+2028, U+2029).
 */
function escapeJsString(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\') out += '\\\\'
    else if (ch === "'") out += "\\'"
    else if (ch === '\r') out += '\\r'
    else if (ch === '\n') out += '\\n'
    else if (ch === ' ') out += '\\u2028'
    else if (ch === ' ') out += '\\u2029'
    else out += ch
  }
  return out
}

/**
 * Drop duplicate categories by `id`, keeping the first occurrence
 * (first-wins). Empty / non-string ids are also dropped. The
 * repeatable settings validator does not enforce id uniqueness — duplicate
 * ids would silently collide on the localStorage state map and the
 * banner DOM ids (`ampless-consent-cat-${id}`), so we normalise here
 * before either inline script consumes the list. Documented behaviour:
 * README + Consent Convention doc both say duplicate ids are dropped.
 */
function dedupCategoriesById(cats: ConsentCategory[]): ConsentCategory[] {
  const seen = new Set<string>()
  const out: ConsentCategory[] = []
  for (const c of cats) {
    if (typeof c?.id !== 'string' || c.id === '') continue
    if (seen.has(c.id)) continue
    seen.add(c.id)
    out.push(c)
  }
  return out
}

/**
 * Factory for the cookie consent plugin. Returns a plugin manifest that:
 *
 * - `publicHead`: installs `window.amplessConsent` API before analytics
 *   plugins run so that `has()` / `on()` are available synchronously.
 *
 * - `publicBodyEnd`: appends a cookie banner to `document.body` after the
 *   page is interactive. The banner is rendered outside the React tree to
 *   avoid hydration conflicts. If `categories` is empty, or if all
 *   non-essential categories are already granted (returning visitor), the
 *   banner is not shown.
 */
export default function cookieConsentPlugin(
  options: CookieConsentOptions = {}
): AmplessPlugin {
  const { instanceId = 'cookie-consent' } = options

  return definePlugin({
    name: 'cookie-consent',
    packageName: '@ampless/plugin-cookie-consent',
    instanceId,
    displayName: { en: 'Cookie Consent', ja: 'Cookie 同意' },
    apiVersion: 1,
    trust_level: 'untrusted',
    capabilities: ['publicHead', 'publicBody', 'adminSettings'],

    settings: {
      public: [
        {
          type: 'textarea',
          key: 'bannerText',
          maxLength: 1000,
          label: {
            en: 'Banner text',
            ja: 'バナーのテキスト',
          },
          description: {
            en: 'Message displayed in the cookie consent banner.',
            ja: 'Cookie 同意バナーに表示するメッセージ。',
          },
          default:
            'This site uses cookies to enhance your browsing experience. You can manage your preferences below.',
        },
        {
          type: 'text',
          key: 'acceptLabel',
          maxLength: 50,
          label: {
            en: 'Accept button label',
            ja: '「すべて同意」ボタンのラベル',
          },
          default: 'Accept all',
        },
        {
          type: 'text',
          key: 'rejectLabel',
          maxLength: 50,
          label: {
            en: 'Reject button label',
            ja: '「拒否」ボタンのラベル',
          },
          default: 'Reject non-essential',
        },
        {
          type: 'text',
          key: 'saveLabel',
          maxLength: 50,
          label: {
            en: 'Save-selected button label',
            ja: '「選択を保存」ボタンのラベル',
          },
          description: {
            en: 'Label for the button that saves the per-category toggle state without granting (or rejecting) everything.',
            ja: '個別トグルの状態をそのまま保存するボタンのラベル。「全て同意」「全て拒否」とは別の選択肢。',
          },
          default: 'Save selected',
        },
        {
          type: 'select',
          key: 'position',
          label: {
            en: 'Banner position',
            ja: 'バナーの表示位置',
          },
          options: [
            {
              value: 'bottom',
              label: { en: 'Bottom bar', ja: '画面下部バー' },
            },
            {
              value: 'top',
              label: { en: 'Top bar', ja: '画面上部バー' },
            },
            {
              value: 'modal',
              label: { en: 'Modal overlay', ja: 'モーダルオーバーレイ' },
            },
          ],
          default: 'bottom',
        },
        {
          type: 'repeatable',
          key: 'categories',
          label: {
            en: 'Consent categories',
            ja: '同意カテゴリ',
          },
          description: {
            en: 'Define the consent categories shown in the banner. Each category must have a unique machine-readable id (e.g. "analytics") and a human-readable label.',
            ja: 'バナーに表示する同意カテゴリを定義します。各カテゴリに一意の識別子（例: "analytics"）と表示名が必要です。',
          },
          maxItems: 20,
          itemLabelKey: 'id',
          addLabel: {
            en: '+ Add category',
            ja: '+ カテゴリを追加',
          },
          fields: [
            {
              type: 'text',
              key: 'id',
              label: { en: 'ID', ja: 'ID' },
              required: true,
              pattern: '^[a-z][a-z0-9_-]*$',
              maxLength: 32,
              placeholder: 'analytics',
            },
            {
              type: 'text',
              key: 'label',
              label: { en: 'Label', ja: 'ラベル' },
              required: true,
              maxLength: 100,
            },
            {
              type: 'textarea',
              key: 'description',
              label: { en: 'Description', ja: '説明' },
              maxLength: 500,
            },
            {
              type: 'boolean',
              key: 'defaultEnabled',
              label: {
                en: 'Enabled by default',
                ja: 'デフォルトで有効',
              },
            },
            {
              type: 'boolean',
              key: 'essential',
              label: {
                en: 'Essential (always on, cannot be disabled)',
                ja: '必須（常時 ON、無効化不可）',
              },
            },
          ],
        },
      ],
    },

    publicHead(ctx) {
      // Read categories from resolved settings. Default to [] when absent.
      // Drop duplicates by `id` first-wins — the localStorage state map
      // and the per-category subscriber map both key on `id`, so a
      // duplicate would silently overwrite earlier entries. We also use
      // the same dedup'd list in `publicBodyEnd` to keep DOM ids
      // collision-free.
      const rawCategories = ctx.setting<ConsentCategory[]>('categories') ?? []
      const categories = dedupCategoriesById(
        Array.isArray(rawCategories) ? rawCategories : []
      )

      // Embed the categories config as a compact JSON literal so the
      // install script can enforce essential grants without an extra
      // network request.
      const categoriesJson = JSON.stringify(categories)

      // Note: ampless ScriptStrategy does not include 'beforeInteractive'.
      // We use 'afterInteractive' and rely on the fact that the install
      // script runs before any analytics plugin (which also runs
      // afterInteractive) because plugins are registered in order in
      // cms.config.ts. The cookie-consent plugin should be listed first.
      return [
        {
          type: 'inlineScript' as const,
          id: `cookie-consent-install-${instanceId}`,
          strategy: 'afterInteractive' as const,
          body: [
            '(function() {',
            "  var STORAGE_KEY = 'ampless:consent';",
            `  var categoriesConfig = ${categoriesJson};`,
            '',
            '  // Restore consent state from localStorage.',
            '  var state = {};',
            '  try {',
            '    var raw = localStorage.getItem(STORAGE_KEY);',
            '    if (raw) state = JSON.parse(raw) || {};',
            '  } catch (e) { state = {}; }',
            '',
            '  // Essential categories are always granted.',
            '  for (var i = 0; i < categoriesConfig.length; i++) {',
            '    var c = categoriesConfig[i];',
            '    if (c.essential) state[c.id] = true;',
            '  }',
            '',
            '  // Per-category subscriber lists (one-shot on-grant callbacks).',
            '  var listeners = {};',
            '',
            '  function persist() {',
            "    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}",
            '  }',
            '',
            '  window.amplessConsent = {',
            '    has: function(category) { return state[category] === true; },',
            '    isSet: function(category) { return Object.prototype.hasOwnProperty.call(state, category); },',
            '    on: function(category, cb) {',
            '      if (state[category] === true) {',
            '        // Already granted — fire immediately (one-shot semantics).',
            '        try { cb(); } catch (e) {}',
            '        return function() {};',
            '      }',
            '      if (!listeners[category]) listeners[category] = [];',
            '      listeners[category].push(cb);',
            '      return function() {',
            '        var arr = listeners[category];',
            '        if (!arr) return;',
            '        var idx = arr.indexOf(cb);',
            '        if (idx >= 0) arr.splice(idx, 1);',
            '      };',
            '    },',
            '    set: function(category, granted) {',
            '      var prev = state[category] === true;',
            '      state[category] = granted === true;',
            '      persist();',
            "      var ev = new CustomEvent('ampless:consent-changed', { detail: { category: category, granted: granted === true } });",
            '      window.dispatchEvent(ev);',
            '      if (!prev && granted === true && listeners[category]) {',
            '        var cbs = listeners[category].slice();',
            '        listeners[category] = [];',
            '        for (var j = 0; j < cbs.length; j++) {',
            '          try { cbs[j](); } catch (e) {}',
            '        }',
            '      }',
            '    },',
            '  };',
            '',
            "  window.dispatchEvent(new CustomEvent('ampless:consent-ready'));",
            '})();',
          ].join('\n'),
        },
      ]
    },

    publicBodyEnd(ctx) {
      // Same dedup as publicHead so the banner DOM ids
      // (`ampless-consent-cat-${id}`) stay unique.
      const rawCategories = ctx.setting<ConsentCategory[]>('categories') ?? []
      const categories = dedupCategoriesById(
        Array.isArray(rawCategories) ? rawCategories : []
      )

      // Emit descriptor even when all categories are essential (the script
      // itself exits early via the nonEssential.length === 0 guard).
      // This allows tests to inspect the emitted descriptor body.
      // When categories is entirely empty, return [] — nothing to show.
      if (categories.length === 0) return []

      const nonEssential = categories.filter((c) => !c.essential)

      const bannerText =
        (ctx.setting<string>('bannerText') ?? '').trim() ||
        'This site uses cookies to enhance your browsing experience. You can manage your preferences below.'
      const acceptLabel =
        (ctx.setting<string>('acceptLabel') ?? '').trim() || 'Accept all'
      const rejectLabel =
        (ctx.setting<string>('rejectLabel') ?? '').trim() ||
        'Reject non-essential'
      const saveLabel =
        (ctx.setting<string>('saveLabel') ?? '').trim() || 'Save selected'
      const position = ctx.setting<string>('position') ?? 'bottom'

      // Escape user-supplied strings for embedding as JS string literals.
      const bannerTextJs = escapeJsString(bannerText)
      const acceptLabelJs = escapeJsString(acceptLabel)
      const rejectLabelJs = escapeJsString(rejectLabel)
      const saveLabelJs = escapeJsString(saveLabel)

      // Encode non-essential categories for banner UI.
      const nonEssentialJson = JSON.stringify(
        nonEssential.map((c) => ({
          id: c.id,
          label: c.label,
          description: c.description ?? '',
          defaultEnabled: c.defaultEnabled ?? false,
        }))
      )

      // Position styles — light theme fixed (v1, no theme integration).
      let containerStyle: string
      let dialogStyle: string

      if (position === 'modal') {
        containerStyle =
          'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;'
        dialogStyle =
          'background:#fff;color:#111;padding:24px;border-radius:8px;max-width:480px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.2);'
      } else if (position === 'top') {
        containerStyle = 'position:fixed;top:0;left:0;right:0;z-index:99999;'
        dialogStyle =
          'background:#fff;color:#111;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.15);'
      } else {
        // bottom (default)
        containerStyle = 'position:fixed;bottom:0;left:0;right:0;z-index:99999;'
        dialogStyle =
          'background:#fff;color:#111;padding:16px;box-shadow:0 -2px 8px rgba(0,0,0,.15);'
      }

      const containerStyleJs = escapeJsString(containerStyle)
      const dialogStyleJs = escapeJsString(dialogStyle)

      return [
        {
          type: 'inlineScript' as const,
          id: `cookie-consent-banner-${instanceId}`,
          strategy: 'afterInteractive' as const,
          body: [
            '(function() {',
            `  var nonEssential = ${nonEssentialJson};`,
            '  if (nonEssential.length === 0) return;',
            '',
            '  // Skip banner if every non-essential category has been *decided*',
            '  // (accepted OR rejected) on a previous visit. Using `has` here',
            '  // would re-show the banner forever after a Reject — `false` would',
            '  // round-trip as "not yet decided". `isSet` is the explicit',
            '  // user-made-a-choice predicate.',
            '  if (window.amplessConsent) {',
            '    var allDecided = nonEssential.every(function(c) { return window.amplessConsent.isSet(c.id); });',
            '    if (allDecided) return;',
            '  }',
            '',
            `  var bannerText = '${bannerTextJs}';`,
            `  var acceptLabel = '${acceptLabelJs}';`,
            `  var rejectLabel = '${rejectLabelJs}';`,
            `  var saveLabel = '${saveLabelJs}';`,
            '',
            "  // Build banner DOM outside React tree (avoids hydration conflicts).",
            "  var container = document.createElement('div');",
            `  container.setAttribute('style', '${containerStyleJs}');`,
            '',
            "  var dialog = document.createElement('div');",
            "  dialog.setAttribute('role', 'dialog');",
            "  dialog.setAttribute('aria-label', 'Cookie consent');",
            `  dialog.setAttribute('style', '${dialogStyleJs}');`,
            '',
            '  // Banner text paragraph — use textContent to avoid XSS.',
            "  var p = document.createElement('p');",
            "  p.style.margin = '0 0 12px';",
            '  p.textContent = bannerText;',
            '  dialog.appendChild(p);',
            '',
            '  // Category toggles with checkboxes.',
            '  // Initial checkbox state precedence:',
            "  //   1. user already decided this category → use their stored choice (has)",
            "  //   2. user has NOT decided yet            → use `defaultEnabled` as a UI hint",
            "  // `defaultEnabled` is intentionally NOT pre-granted in state — that would",
            "  // bypass the user's explicit consent action, which is incompatible with",
            "  // GDPR/ePrivacy. It only seeds the UI checkbox before first interaction.",
            '  var toggleState = {};',
            '  nonEssential.forEach(function(cat) {',
            '    var checked;',
            '    if (window.amplessConsent && window.amplessConsent.isSet(cat.id)) {',
            '      checked = window.amplessConsent.has(cat.id);',
            '    } else {',
            '      checked = cat.defaultEnabled === true;',
            '    }',
            '    toggleState[cat.id] = checked;',
            '',
            "    var row = document.createElement('div');",
            "    row.style.cssText = 'display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;';",
            '',
            "    var checkbox = document.createElement('input');",
            "    checkbox.type = 'checkbox';",
            '    checkbox.checked = checked;',
            "    checkbox.id = 'ampless-consent-cat-' + cat.id;",
            "    checkbox.style.marginTop = '2px';",
            "    (function(catId) {",
            "      checkbox.addEventListener('change', function() {",
            '        toggleState[catId] = checkbox.checked;',
            '      });',
            '    })(cat.id);',
            '',
            "    var labelEl = document.createElement('label');",
            "    labelEl.htmlFor = 'ampless-consent-cat-' + cat.id;",
            '',
            "    var strong = document.createElement('strong');",
            '    strong.textContent = cat.label;',
            '    labelEl.appendChild(strong);',
            '',
            '    if (cat.description) {',
            "      var desc = document.createElement('div');",
            "      desc.style.cssText = 'font-size:0.85em;color:#555;';",
            '      desc.textContent = cat.description;',
            '      labelEl.appendChild(desc);',
            '    }',
            '',
            '    row.appendChild(checkbox);',
            '    row.appendChild(labelEl);',
            '    dialog.appendChild(row);',
            '  });',
            '',
            '  // Button row.',
            "  var btnRow = document.createElement('div');",
            "  btnRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;';",
            '',
            "  var btnBase = 'cursor:pointer;padding:8px 16px;border:1px solid #333;border-radius:4px;font-size:0.9em;';",
            '',
            '  // Accept all.',
            "  var acceptBtn = document.createElement('button');",
            "  acceptBtn.style.cssText = btnBase + 'background:#111;color:#fff;';",
            '  acceptBtn.textContent = acceptLabel;',
            "  acceptBtn.addEventListener('click', function() {",
            '    nonEssential.forEach(function(cat) {',
            '      if (window.amplessConsent) window.amplessConsent.set(cat.id, true);',
            '    });',
            '    document.body.removeChild(container);',
            '  });',
            '',
            '  // Save selected (granular toggle state).',
            "  var saveBtn = document.createElement('button');",
            "  saveBtn.style.cssText = btnBase + 'background:#fff;color:#111;';",
            '  saveBtn.textContent = saveLabel;',
            "  saveBtn.addEventListener('click', function() {",
            '    nonEssential.forEach(function(cat) {',
            '      if (window.amplessConsent) window.amplessConsent.set(cat.id, toggleState[cat.id] === true);',
            '    });',
            '    document.body.removeChild(container);',
            '  });',
            '',
            '  // Reject non-essential.',
            "  var rejectBtn = document.createElement('button');",
            "  rejectBtn.style.cssText = btnBase + 'background:#fff;color:#111;';",
            '  rejectBtn.textContent = rejectLabel;',
            "  rejectBtn.addEventListener('click', function() {",
            '    nonEssential.forEach(function(cat) {',
            '      if (window.amplessConsent) window.amplessConsent.set(cat.id, false);',
            '    });',
            '    document.body.removeChild(container);',
            '  });',
            '',
            '  btnRow.appendChild(acceptBtn);',
            '  btnRow.appendChild(saveBtn);',
            '  btnRow.appendChild(rejectBtn);',
            '  dialog.appendChild(btnRow);',
            '  container.appendChild(dialog);',
            '  document.body.appendChild(container);',
            '})();',
          ].join('\n'),
        },
      ]
    },
  })
}
