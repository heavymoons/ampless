/**
 * Normalise a user-typed language string into a safe codeBlock language token.
 *
 * Rules applied:
 *  1. Lowercase the entire string.
 *  2. Strip every character that is not [a-z0-9_-] — this removes spaces,
 *     quotes, newlines, backticks, and other symbols.
 *  3. If the result matches /^[a-z0-9][a-z0-9_-]{0,63}$/ return it; otherwise
 *     return null.
 *
 * Why this matters:
 *  - The public renderer emits `class="language-${language}"` on the <code>
 *    element (packages/runtime/src/rendering.ts:357).  A space in the value
 *    would split the attribute into multiple class tokens and break
 *    `code.language-mermaid` detection.
 *  - The tiptap→markdown serialiser emits ` ```${lang} ` fence headers
 *    (rendering.ts:935).  A backtick or newline in the value would corrupt
 *    the fence entirely.
 *
 * Note: languages whose conventional name contains symbols should use their
 * highlight alias instead, e.g. `cpp` for C++, `csharp` for C#.
 */
const TOKEN = /^[a-z0-9][a-z0-9_-]{0,63}$/

export function normalizeCodeLanguage(value: string): string | null {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9_-]/g, '')
  return TOKEN.test(cleaned) ? cleaned : null
}
