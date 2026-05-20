> English: [12-setup-experience.md](./12-setup-experience.md)
> 
## 12. セットアップ体験

### ユーザーの操作フロー

```bash
$ npx create-ampless@latest

? サイト名: my-blog
? テーマ: ブログ / ランディングページ / ポートフォリオ
? 認証方法: パスキー / メールリンク / Cognito 標準
? プラグイン: [x] SEO  [x] お問い合わせフォーム  [ ] Analytics
? デプロイ先: ローカル開発 / Amplify (AWS)

✅ プロジェクトを生成しました
次のステップ:
  cd my-blog
  npx ampx sandbox    # ローカル開発用バックエンド起動
  npm run dev          # フロントエンド起動
```

CLI ウィザードが amplify/ 配下のリソース定義を動的に生成。
ユーザーは裏で CDK が動いていることを意識しなくてよい。

### 本番デプロイ

```bash
git init && git add . && git commit -m "init"
git remote add origin <your-repo>
git push
# → Amplify コンソールで Git リポジトリを接続
# → 自動ビルド・デプロイ
```

### EmDash との比較

| ステップ | EmDash (Cloudflare) | 本 CMS (Amplify) |
|---------|--------------------|--------------------|
| 初期化 | `npm create emdash@latest` | `npx create-ampless@latest` |
| ローカル開発 | `npx wrangler dev` | `npx ampx sandbox` + `npm run dev` |
| 本番デプロイ | `npx wrangler deploy` | Amplify コンソールで git 接続 |
| 要アカウント | Cloudflare（無料） | AWS（無料枠あり） |
| 最大のハードル | wrangler 設定 | AWS アカウント + IAM 初期設定 |

### 配布方法

1. **npm create テンプレート**（メイン）: CLI ウィザードでプロジェクト生成
2. **GitHub Template Repository**: 「Use this template」ボタンでフォーク
3. **CDK コンストラクト**（上級者向け）: 既存 Amplify プロジェクトへの追加

---
