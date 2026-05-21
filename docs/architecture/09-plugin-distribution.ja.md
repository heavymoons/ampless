> English: [09-plugin-distribution.md](./09-plugin-distribution.md)
> 
## 9. プラグインの配布とインストール

### A方式: ビルドタイム（コアプラグイン）

npm パッケージとして配布。ビルド時にバンドルされる。

```bash
npm install @ampless/plugin-seo
```

```typescript
// amplify/plugins.ts
import { defineCmsPlugins } from 'ampless';
export const plugins = defineCmsPlugins([
  '@ampless/plugin-seo',
  '@ampless/plugin-contact-form',
]);
```

git push → Amplify 自動ビルド・デプロイ。

利点: npm のバージョン管理・lockfile・セキュリティ監査がそのまま使える。
欠点: 追加のたびにデプロイが走る。非開発者には操作できない。

### B方式: ランタイム（サードパーティプラグイン）

管理画面からインストール。プラグインコードを S3 に保存し、Lambda 実行時に動的ロード。

```
管理画面「プラグイン追加」
  → バンドル済みJSを S3 にアップロード
  → マニフェストを DynamoDB に登録
  → Lambda 実行時に S3 からコード取得
  → new Function() で実行（trust_level に応じた Lambda で）
```

キャッシュ戦略:
1. Lambda メモリ内キャッシュ（ウォームスタート間で保持）
2. /tmp ファイルキャッシュ（コールドスタートでも高速）
3. S3 から取得（完全初回のみ）

プラグイン開発者は esbuild 等でバンドル済み単一 JS ファイルとして配布。

### v1 方針
- コアプラグインは A 方式（npm）
- サードパーティプラグインは B 方式（S3 + ランタイムロード）
- 両方式を組み合わせたハイブリッド運用

---
