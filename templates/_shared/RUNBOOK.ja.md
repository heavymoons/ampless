> English: [RUNBOOK.md](./RUNBOOK.md)
> 

# ランブック

ampless で構築したサイトで、ときどき必要になる運用作業の手順集です。毎日やるわけではないけれど、いざ必要になったときに迷わずに進めるためのものです。

日常的な使い方（コマンド、管理画面、テーマ、プラグイン、デプロイなど）は [README.ja.md](./README.ja.md) を参照してください。

## 目次

- [AppSync API キー（自動更新）](#appsync-api-キー自動更新)
- [よくある運用](#よくある運用)
  - [ユーザーの昇格 / 降格](#promote--demote-a-user)
  - [パスワードリセット（管理者上書き）](#reset-a-users-password-admin-override)
  - [Post テーブルのバックアップから復元](#restore-from-a-post-table-backup)
  - [失敗したプラグインイベントを確認する](#inspect-failed-plugin-events)
- [カスタムドメイン](#custom-domains)
  - [カスタムドメインを Amplify Hosting に追加する](#adding-a-custom-domain-to-amplify-hosting)

## AppSync API キー（自動更新）

パブリックブログの読み取り（`listPublishedPosts`、`getPublishedPost`、`listPostsByTag`）は AppSync API キーで保護されています。このキーは `amplify_outputs.json` に含まれているため、**公開サイトを訪問した誰もが確認できる**状態にあります。低信頼度のクレデンシャルとして扱ってください。このキーが持つ権限は上記 3 つのカスタムクエリを呼び出すことのみであり、それらのクエリは `status === 'published'` の行しか返しません。

### なぜ API キーなのか（Identity Pool ゲストロールではなく）？

Amplify Gen 2 の `a.handler.custom` リゾルバーは `allow.guest()` や `allow.authenticated('identityPool')` をサポートしておらず、apiKey / userPool / lambda / group / owner のみが使用可能です。v0.1 では簡潔さを優先して API キーを選択しました。パブリック読み取りを Lambda 関数データソース（`a.handler.function`）に移行することは v0.2 の候補です。

### 自動更新 — ローテーション手順は不要

`api-key-renewer` Lambda（`amplify/functions/api-key-renewer/` を参照）は、毎月 1 日の UTC 03:00 に EventBridge スケジュールで起動します。`AppSync.UpdateApiKey` を呼び出して既存キーの `expires` を「現時点 + 364 日」に延長するため、以下が保証されます：

- キー ID は変化しない
- `amplify_outputs.json` は引き続き有効
- Next.js アプリの再ビルドは不要
- 常に約 334 日以上の残有効期限が維持される

手動で確認または実行したい場合：

```bash
# 現在の有効期限を確認
aws appsync list-api-keys \
  --region <amplify_outputs.json の data.aws_region> \
  --api-id <amplify_outputs.json の data.url から導出した api-id>

# 手動実行（サンドボックスを長期間停止した後など）
aws lambda invoke \
  --function-name $(aws lambda list-functions \
    --query "Functions[?contains(FunctionName,'api-key-renewer')].FunctionName | [0]" \
    --output text) \
  /tmp/out.json && cat /tmp/out.json
```

### キーの漏洩が疑われる場合

有効期限の延長ではなく、キーの値そのものをローテーションする即時対応を行います：

1. `amplify/data/resource.ts` のコメントを編集して CFN 更新を強制する
2. `npx ampx sandbox`（サンドボックス）または `npx ampx pipeline-deploy ...`（本番）を実行 — Amplify がキーの値を再生成する
3. Next.js アプリを再デプロイして SSR が新しい `data.api_key` を参照するようにする

## 一般的な操作

### ユーザーのグループ昇格 / 降格

AWS Cognito コンソールから操作します：

1. User Pool → Users → 対象ユーザーを選択
2. Group memberships → グループに追加 / グループから削除
3. ユーザーに一度サインアウトしてサインインし直してもらい、新しいクレームを適用させる

グループの種類： `ampless-admin`（フル CRUD + 運用操作）、`ampless-editor`（コンテンツ CRUD）、`ampless-reader`（将来の REST/MCP API 利用者向けに予約済み）。

### ユーザーパスワードのリセット（管理者による上書き）

ロックアウトされており、メールによる復旧が利用できない場合：

```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id <amplify_outputs.json の auth.user_pool_id> \
  --region <リージョン> \
  --username <メールアドレス> \
  --password '<新しいパスワード>' --permanent
```

`/login` ページにはセルフサービスの「パスワードを忘れた場合」フローもあります。

### Post テーブルのバックアップからの復元

DynamoDB のポイントインタイムリカバリ（PITR）は v0.1 の `defineData` では有効になっていません。AWS コンソール → DynamoDB → Tables → `<投稿テーブル名>` → Backups → Edit PITR から手動で有効化してください。有効化後は `aws dynamodb restore-table-to-point-in-time` で新しいテーブルに復元し、その後アイテムをライブテーブルに移行する作業が必要です。

### 失敗したプラグインイベントの確認

処理に失敗したプロセッサー呼び出しは、`amplify/backend.ts` で作成された共有イベント DLQ（`EventsDlq`）に送られます。SQS コンソールまたは `aws sqs receive-message --queue-url <dlq-url> --max-number-of-messages 10` でメッセージを確認してください。v0.1 には自動アラームがないため、定期的な手動確認を推奨します。あるいは `ApproximateNumberOfMessagesVisible` に CloudWatch アラームを設定してください。

## カスタムドメイン

ampless は 1 Amplify デプロイ = 1 サイト。複数サイトを別ドメインで配信したい場合は、サイトごとに Amplify 環境を分けてデプロイしてください。

### Amplify Hosting へのカスタムドメイン追加

バインドしたいドメインごとに以下を実施します：

1. **Amplify Hosting コンソール** → アプリ → **Domain management** → **Add domain** を選択。
2. 頂点ドメイン（`example.com`）と接続したいサブドメインを入力します。Amplify が ACM 証明書と CloudFront SAN エントリを自動でプロビジョニングします。
3. DNS を更新：
   - **Route 53 / Amplify 管理の DNS プロバイダー**：Amplify が CNAME を作成してくれるので、確認するだけです。
   - **外部 DNS**（Cloudflare、Squarespace など）：Amplify が表示する CNAME / DNS 検証レコードをコピーします。ACM のメール検証もフォールバックとして使用できます。
4. **Domain activation** が完了するまで待ちます（通常 15〜60 分。証明書の検証が最も時間がかかります）。
5. `cms.config.ts` の `site.url` を新しい canonical URL に更新し、commit して push します：
   ```bash
   git add cms.config.ts && git commit -m "feat: bind docs.example.com"
   git push   # Amplify Hosting が自動検出します
   ```

エンドツーエンドで確認：

```bash
curl -I https://docs.example.com/   # 200 とサイトの HTML
```
