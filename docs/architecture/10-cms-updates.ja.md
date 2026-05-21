> English: [10-cms-updates.md](./10-cms-updates.md)
> 
## 10. CMS 本体のアップデート

### コア更新

CMS コアは npm パッケージとして配布。

```bash
npm update ampless
git push  # → Amplify 自動デプロイ
```

プロジェクト構造でコアとユーザーカスタマイズを分離:

```
├── node_modules/ampless/   ← npm 管理。ユーザーは触らない
├── amplify/
│   ├── backend.ts           ← CMS テンプレート + ユーザーカスタム
│   ├── data/resource.ts     ← スキーマ定義
│   └── functions/           ← プラグイン Lambda
├── themes/my-theme/         ← ユーザーが自由に編集
└── cms.config.ts            ← ユーザー設定ファイル
```

### DB マイグレーション

```bash
npx ampless migrate
```

DynamoDB は RDB と異なり破壊的変更が少ない。
GSI 追加やアトリビュート追加は既存データに影響しない。

### CDK リソース更新

npm update → git push で Amplify ビルドパイプラインが
amplify/backend.ts の変更を検知して CDK デプロイを実行。
ユーザーが意識する必要はない。

---
