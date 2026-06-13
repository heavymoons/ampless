---
"@ampless/admin": minor
---

Add a generic code-block language attribute editor to the tiptap toolbar.

When the cursor is inside a code block, a small text input appears in the toolbar allowing the operator to type a language identifier (e.g. `mermaid`, `ts`, `python`). The value is normalised to a safe token (lowercase, symbols stripped) before being written to the `codeBlock.attrs.language` attribute, ensuring compatibility with the public renderer's `class="language-<x>"` output and the tiptap→markdown `` ```<lang> `` fence serialiser. Languages whose conventional name contains symbols should use their highlight alias (e.g. `cpp` for C++).
