## 6. AI 連携

### 設計思想

AI プロバイダに依存しない抽象レイヤーをコアに持ち、各 AI 機能はプラグインとして提供する。
API キー設定だけで使える手軽さを重視する。

### プロバイダ設定

```typescript
// cms.config.ts
export default defineConfig({
  ai: {
    provider: 'google',  // 'google' | 'openai' | 'anthropic' | 'bedrock'
    apiKey: process.env.GEMINI_API_KEY,
  }
})
```

| プロバイダ | 認証 | 備考 |
|-----------|------|------|
| Google (Gemini) | API キー | 即発行、手軽。デフォルト推奨 |
| OpenAI | API キー | GPT 系 |
| Anthropic | API キー | Claude 系 |
| AWS Bedrock | IAM（キー不要） | AWS 内完結だがセットアップが手動で面倒。上級者向け |

### AI 機能（プラグインとして提供）

| プラグイン | フック連携 | 機能 |
|-----------|-----------|------|
| `@ampless/plugin-ai-proofread` | `before:content.published` | 文章校正・誤字脱字チェック |
| `@ampless/plugin-ai-summary` | `after:content.updated` | 要約・メタディスクリプション自動生成 |
| `@ampless/plugin-ai-ogp` | `after:content.published` | OGP テキスト生成 |
| `@ampless/plugin-ai-alt-text` | `after:media.uploaded` | 画像の ALT テキスト自動生成 |
| `@ampless/plugin-ai-tags` | `after:content.updated` | タグ・カテゴリ提案 |
| `@ampless/plugin-ai-translate` | エディタ内 | 記事の多言語化 |

### コアが提供するもの

- AI プロバイダ抽象レイヤー（プロバイダ切り替え、API キー管理）
- プラグインから呼べる `cms.ai.generate(prompt)` API

各 AI 機能の具体的なプロンプトやロジックはプラグイン側に持たせる。
コアは「どの AI に投げるか」だけを管理する。

### v1 方針
- v0.1: AI プロバイダ抽象レイヤーのみ（プラグインは後続）
- v0.2: 校正・要約プラグイン
- v1.0: 全 AI プラグイン

---
