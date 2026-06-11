> English: [10-cms-updates.md](./10-cms-updates.md)
> 
## 10. CMS コア更新

### 配布形態

ampless は複数の npm パッケージとして出荷する。生成されたプロジェクトは実際に使うものだけに依存する：

| パッケージ | 役割 |
|---|---|
| `ampless` | 型定義、プラグイン / テーマ / 設定の契約、ヘルパー |
| `@ampless/admin` | 管理画面のコンポーネント、Provider、Server Action |
| `@ampless/runtime` | 公開側ランタイム：middleware、dispatcher、ルートハンドラ |
| `@ampless/backend` | Amplify Gen 2 バックエンド配線 + AppSync スキーマ |
| `@ampless/plugin-*` | ファーストパーティプラグイン（seo / rss / og-image / webhook） |
| `create-ampless` | スキャフォールド + アップグレード CLI |

生成プロジェクトは薄いシェル：`cms.config.ts`、テーマオーバーレイ、`@ampless/runtime` の dispatcher を組み立てるルートシェル、`@ampless/backend` を配線する `amplify/` ツリー。ampless の更新はパッケージのバージョン bump が中心で、シェル側はめったに変わらない。

```
my-site/
├── package.json                 ← ampless + @ampless/* に依存
├── cms.config.ts                ← ユーザ設定（site、plugins、media、cache）
├── themes-registry.ts           ← ユーザ管理のテーマ一覧
├── amplify/
│   ├── backend.ts               ← 薄い：defineAmplessBackend(...) を呼ぶだけ
│   ├── data/resource.ts         ← 薄い：amplessSchemaModels(a) を spread
│   ├── auth/resource.ts         ← 薄い：amplessAuthConfig(...) を返す
│   └── functions/<name>/handler.ts  ← 薄い：@ampless/backend を re-export
├── app/
│   ├── (admin)/admin/…          ← 管理ルート（upgrade で再生成）
│   ├── [slug]/page.tsx          ← 薄い：createThemePostDispatcher(ampless)
│   ├── raw/<slug>/route.ts      ← 薄い：createRawRouteHandler(ampless)
│   └── static/[slug]/[[...path]]/route.ts  ← 薄い：createStaticRouteHandler(ampless)
└── themes/<your-theme>/…        ← ユーザ所有のテーマコード
```

### ampless の更新

ライフサイクルは 2 つのコマンドでカバーできる：

```bash
# 1. npm パッケージを更新
pnpm update ampless @ampless/admin @ampless/runtime @ampless/backend \
            @ampless/plugin-seo @ampless/plugin-rss

# 2. テンプレート管理下のファイル（ルートシェル、管理ページ等）を再生成
npx create-ampless@beta --upgrade
```

`--upgrade` はプロジェクト内の **ampless 管理パス**（管理ルート、内部ルートシェル、API プロキシルート）を現在のテンプレートと同期する。管理パスのリストは [`packages/create-ampless/src/upgrade.ts`](../../packages/create-ampless/src/upgrade.ts) の `AMPLESS_MANAGED_APP_PATHS` に固定されている。管理パス外のユーザ所有ファイル（`themes/`、`app/page.tsx`、`cms.config.ts` 等）は触らない。

その後 `git push` で Amplify Hosting のビルドが走る — 型チェック、Lambda バンドル、CDK 差分のデプロイ。ampless 側のリリースノートは Version Packages bot（changesets）が管理する。ユーザプロジェクトは bump 後のパッケージに入った変更を取り込むだけ。

### 「マイグレーション」

`ampless migrate` のような CLI コマンドは存在しない。DynamoDB が真実の源で、ampless が行うスキーマ変更は基本的に additive：

- **モデルへのフィールド追加** — Amplify Gen 2 が AppSync 型を拡張する。既存行は書き換えるまで新フィールドが `null` で返る。
- **インデックス追加** — 次回デプロイの CDK 適用で provisioning される。
- **モデル追加** — 次回デプロイで provisioning。書き込むまで空。
- **フィールド削除** — AppSync スキーマから消える。DynamoDB の attribute は残るが表面には出てこない。ドリフトは積極的にはクリーンアップしない。

破壊的な形状変更（モデルのリネーム、1 モデルの 2 分割等）は CLI ではなく、デプロイに同梱する 1 度限りの Lambda として実装する。現状のモデルでこれを必要としたケースはまだない。

### CDK リソース

`amplify/backend.ts` や `amplify/*/resource.ts` を触る変更は通常の Amplify Hosting ビルドに乗る — `git push` で CDK synth + デプロイが走る。ユーザが手動で叩くものはなく、CDK の変更はアプリケーションバンドルと同じデプロイに同乗する。

---
