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
  - [ポイントインタイムリカバリによるデータテーブルの復元](#ポイントインタイムリカバリによるデータテーブルの復元)
  - [KvStore / PostHistory の DynamoDB TTL（オプトイン）](#dynamodb-ttl-のオプトイン)
  - [失敗したプラグインイベントを確認する](#inspect-failed-plugin-events)
- [カスタムドメイン](#custom-domains)
  - [カスタムドメインを Amplify Hosting に追加する](#adding-a-custom-domain-to-amplify-hosting)

## AppSync API キー（自動更新）

パブリックブログの読み取り（`listPublishedPosts`、`getPublishedPost`、`listPostsByTag`）は AppSync API キーで保護されています。このキーは `amplify_outputs.json` に含まれているため、**公開サイトを訪問した誰もが確認できる**状態にあります。低信頼度のクレデンシャルとして扱ってください。このキーが持つ権限は上記 3 つのカスタムクエリを呼び出すことのみであり、それらのクエリは `status === 'published'` の行しか返しません。

### なぜ API キーなのか（Identity Pool ゲストロールではなく）？

Amplify Gen 2 の `a.handler.custom` リゾルバーは `allow.guest()` や `allow.authenticated('identityPool')` をサポートしておらず、apiKey / userPool / lambda / group / owner のみが使用可能です。ampless では簡潔さを優先して API キーを選択しています。パブリック読み取りを Lambda 関数データソース（`a.handler.function`）に移行することは将来の選択肢です。

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

### ポイントインタイムリカバリによるデータテーブルの復元

**PITR はデフォルトで有効です。** `defineAmplessBackend` は、すべてのデータテーブル — ampless のモデル（Post、Page、Media、Taxonomy、KvStore、PostHistory など）と `amplify/data/resource.custom.ts` で追加したモデル — で DynamoDB のポイントインタイムリカバリ（PITR）を有効にします。既存サイトでは、`@ampless/backend` をこの変更（heavymoons/ampless#395）を含むリリースに更新した後の最初のデプロイで有効になります。変更は**その場で（in place）**適用され、テーブルの置き換えやデータのコピーは発生しません。

**復元できる期間。** 新たに PITR が有効になるテーブルには、DynamoDB のデフォルトである 35 日間の復旧期間が設定されます。すでに PITR が有効だったテーブルは変更されないため、以前に設定した復旧期間（1〜35 日）がそのまま残ります。ampless がリセットすることはありません。どちらの場合も、そのテーブルで PITR を有効にした時点より前には戻せません。復元する前に、テーブルの実際の復元可能範囲を確認してください：

```bash
aws dynamodb describe-continuous-backups --region <リージョン> --table-name <ライブテーブル> \
  --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription'
```

`EarliestRestorableDateTime` と `LatestRestorableDateTime` が、`--restore-date-time` に指定できる範囲です。最新の時点は通常、現在時刻より 5 分ほど前になります。`RecoveryPeriodInDays` は設定されている期間です。メディアファイルは S3 にあるため、PITR の対象外です。

**コスト。** PITR はテーブルサイズ（アイテムデータ + ローカルセカンダリインデックス）に対して課金され、us-east-1 でおおよそ 1 GB・月あたり $0.20 です。復元は、復元したデータ量（GSI を含む）に対しておおよそ 1 GB あたり $0.15 かかります。料金はリージョンによって異なります — [Amazon DynamoDB の料金](https://aws.amazon.com/dynamodb/pricing/) を参照してください。一般的な CMS のテーブルは MB 単位なので、通常は月に数セント程度です。

**復元手順。** 復元は常に**新しい**テーブルを作成し、ライブテーブル自体を巻き戻すことはありません。ライブテーブルは Amplify が管理しており名前も変わらないため、手順は「別テーブルに復元 → 必要なアイテムをライブテーブルにコピー → 別テーブルを削除」となります。

これはアイテム単位の選択的な修復であり、サイト全体をある時点に巻き戻す操作では**ありません**。テーブルはそれぞれ個別に復元され、アイテムを書き戻しても上書きされるのは書き込んだキーだけです。復元時点より後に作られた行はライブテーブルに残り、コピーしなかった行は現在の値のままです。関連するテーブル（Post、PostTag、PostHistory、KvStore など）が、整合した同じ時点にまとめて戻ることもありません。

1. ライブテーブルの名前を確認します（Amplify は `<モデル名>-<apiId>-NONE` という名前を付けます。例: `Post-abc123…-NONE`）：

   ```bash
   aws dynamodb list-tables --region <amplify_outputs.json の data.aws_region>
   ```

2. `describe-continuous-backups`（前述）で確認した復元可能範囲内の時点を指定して、新しいテーブルに復元します：

   ```bash
   aws dynamodb restore-table-to-point-in-time \
     --region <リージョン> \
     --source-table-name Post-<apiId>-NONE \
     --target-table-name Post-<apiId>-NONE-restore-20260101 \
     --restore-date-time 2026-01-01T09:00:00Z
   ```

   `aws dynamodb describe-table --table-name <復元先>` が `TableStatus: ACTIVE` を返すまで待ちます（小さなテーブルなら数分です）。

3. まず範囲を決めます。修復するキーを正確に決め、書き込む前に復元したテーブルとライブテーブルで内容を比較してください。コピー中は次の点に注意します：

   - **書き込みを分離または停止する。** 編集者に編集を止めてもらい、書き込みを行う MCP クライアントや自動化も止めて、ライブの変更とコピーが競合しないようにします。
   - **`put-item` / `batch-write-item` は同じキーのアイテム全体を置き換えます。** ライブの行にあったより新しい変更は失われます。ライブテーブルにしかないアイテムは削除されません。消す必要があるものは明示的に削除してください。
   - **必要に応じて条件付き書き込みを使う。** 例えば `--condition-expression 'attribute_not_exists(postId)'`（テーブルのパーティションキーを使います。Post は `postId`、KvStore は `pk` など）で、まだ存在する行には触れずに削除された行だけを作り直せます。`updatedAt` の条件を付ければ、より新しい編集を上書きせずに済みます。

   数件なら `get-item` / `put-item`、多い場合は `scan` + `batch-write-item` の短いスクリプトを使います（`batch-write-item` は条件を指定できません）。Post / KvStore への書き込みはストリームを経由するため、通常の編集と同じく、復元した行に対してもイベントシステム（PostTag インデックス、キャッシュ、履歴）が再実行されます。

   終わったら**整合を確認します**。修復したキーをライブテーブルから読み直し、管理画面と公開サイトを確認し、イベントの DLQ に処理の失敗がないか確認してください。

   アプリの接続先を復元したテーブルに切り替えたり、ライブテーブルを削除したりは**しないでください** — ライブテーブルは Amplify の管理下にあり、コピーしたテーブルを引き継ぐことはありません。

4. 作業が終わったら、課金を止めるために復元したテーブルを削除します：

   ```bash
   aws dynamodb delete-table --region <リージョン> --table-name <復元先>
   ```

復元したテーブルにはキースキーマ、インデックス、課金モードは引き継がれますが、ストリーム、TTL、PITR、タグ、Auto Scaling、IAM ポリシーは引き継がれ**ません**。一時的な作業用テーブルとしては問題ありませんが、そのまま置き換えられるテーブルとして扱わないでください。

**無効化（オプトアウト）。** テーブルの PITR を無効にするには、`amplify/backend.custom.ts` で上書きします（ampless の設定より後に実行されるため、こちらが優先されます）：

```ts
export function customizeBackend(backend: AmplessBackend): void {
  backend.data.resources.cfnResources.amplifyDynamoDbTables['KvStore'].pointInTimeRecoveryEnabled = false
}
```

### DynamoDB TTL のオプトイン

**KvStore / PostHistory の TTL はデフォルトで無効です。** 次の 2 つのテーブルは `ttl` 属性（Unix エポック秒）を書き込みます：

- **PostHistory** — `cms.config.ts` の `history.retentionDays` が 0 より大きいとき、リビジョンのスナップショットごとに書き込みます（`0` / 未設定なら `ttl` は書きません）。
- **KvStore** — `KvStore.put(pk, sk, value, { ttlSeconds })` で書いた行（プラグインのキャッシュや状態）。

ampless はどちらのテーブルでも DynamoDB の TTL を有効に**しません**。そのため自動削除は行われず、`ttl` を過ぎた行もテーブルに残り、読み取りでもそのまま返ります（ampless は読み取り時に期限切れの行を除外しません）。以前のリリースでは `backend.ts` で TTL を有効にしているように見えましたが、その代入はデプロイされるテーブルに反映されていませんでした（heavymoons/ampless#399）。アップグレードしてもこの状態は変わりません。手動で有効にした TTL も含め、各テーブルの TTL はそのまま維持されます。

オプトインにしているのは、**TTL を有効にすると、`ttl` がすでに過ぎているすべての行を DynamoDB が削除する**ためです。長く運用しているサイトでは、数か月〜数年分のリビジョンやキャッシュ行が一度に対象になることがあり、PITR などのバックアップがなければ元に戻せません。以下の確認を済ませてから、テーブルごとに有効にしてください。

1. **事前調査（読み取りのみ）。** ライブテーブルの名前（`<モデル名>-<apiId>-NONE`。`aws dynamodb list-tables` で確認）を調べ、現在の TTL の状態と、有効にした直後に削除される行の数を確認します：

   ```bash
   aws dynamodb describe-time-to-live --region <リージョン> --table-name <ライブテーブル>

   aws dynamodb scan --region <リージョン> --table-name <ライブテーブル> \
     --select COUNT \
     --filter-expression 'attribute_exists(#t) AND #t < :now' \
     --expression-attribute-names '{"#t":"ttl"}' \
     --expression-attribute-values "{\":now\":{\"N\":\"$(date +%s)\"}}"
   ```

   CLI が `LastEvaluatedKey` をたどってページングし、合計の `Count`（すでに期限切れの行数）と `ScannedCount`（読み取った行数）を返します。スキャンはテーブル全体を読むため読み取りキャパシティを消費します。大きなテーブルでは負荷の少ない時間帯に実行してください。`AND #t < :now` を外すと `ttl` を持つすべての行の数になり、`--select COUNT` の代わりにキー属性（PostHistory は `postHistoryId`、KvStore は `pk, sk`）を `--projection-expression` に指定すると、対象の行を一覧できます。

2. **残す行を決める。** 残したい行は、TTL を有効にする**前に**期限切れでない状態にしておく必要があります。属性を削除するか、値を引き上げます：

   ```bash
   aws dynamodb update-item --region <リージョン> --table-name <ライブテーブル> \
     --key '{"postHistoryId":{"S":"<id>"}}' \
     --update-expression 'REMOVE #t' \
     --expression-attribute-names '{"#t":"ttl"}'
   ```

   （KvStore のキーは `{"pk":…,"sk":…}` です。将来のエポック秒にする場合は `--update-expression 'SET #t = :later'` を使います。）`history.retentionDays` を変えても既存の行には効きません。変更後に書かれたリビジョンにだけ反映され、既存の行は書き込み時の `ttl` のままです。KvStore への書き込みは通常の編集と同じくストリームを通ります（dispatcher が反応するのは `siteconfig` の行だけです）。

3. **PITR が有効なことを確認する。** PITR（またはオンデマンドバックアップ）がなければ、TTL で削除された行は元に戻せません。復元できる範囲の開始時点も控えておきます：

   ```bash
   aws dynamodb describe-continuous-backups --region <リージョン> --table-name <ライブテーブル> \
     --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription'
   ```

   `PointInTimeRecoveryStatus` が `ENABLED` であること、`EarliestRestorableDateTime` が復元できる最も古い時点です。必要な行が消えてしまった場合は、TTL を有効にする直前の時刻を指定して [ポイントインタイムリカバリによるデータテーブルの復元](#ポイントインタイムリカバリによるデータテーブルの復元) の手順に従ってください。書き戻した行は過去の `ttl` を持ったままなので、コピーするときに削除するか引き上げないと、TTL によって再び削除されます。

4. **オプトインする。** `amplify/backend.custom.ts` に次を書いてデプロイします：

   ```ts
   export function customizeBackend(backend: AmplessBackend): void {
     backend.data.resources.cfnResources.amplifyDynamoDbTables['PostHistory'].timeToLiveAttribute =
       { attributeName: 'ttl', enabled: true }
   }
   ```

   KvStore にも有効にする場合は、同じ行を `'KvStore'` で書きます。プロパティ名に注意してください。正しくは `timeToLiveAttribute`（Amplify のテーブルラッパーのセッター）です。`timeToLiveSpecification` はセッターではなく、代入しても何も起きません。変更は Amplify のテーブルマネージャーが `UpdateTimeToLive` でその場で適用し、テーブルの置き換えは発生しません。TTL を再び無効にするには、この行を削除してデプロイします。

5. **監視する。** CloudWatch のメトリクス `TimeToLiveDeletedItemCount`（名前空間 `AWS/DynamoDB`、ディメンション `TableName`）で、TTL が削除した行数を確認できます。最初の数日は事前調査の件数に近い量がまとめて削除され、その後は少しずつ削除されるはずです：

   ```bash
   aws cloudwatch get-metric-statistics --region <リージョン> \
     --namespace AWS/DynamoDB --metric-name TimeToLiveDeletedItemCount \
     --dimensions Name=TableName,Value=<ライブテーブル> \
     --start-time <TTL を有効にした時刻（ISO）> --end-time <現在時刻（ISO）> \
     --period 3600 --statistics Sum
   ```

**注意点。**

- 削除はすぐには行われません。AWS は期限切れの行を通常数日以内に削除します（`UpdateTimeToLive` の API リファレンスでは、通常 2 日、つまり約 48 時間以内とされています）。それまでは読み取り、クエリ、スキャンで返ります。ampless は読み取り時に期限切れの行を除外しません。
- `ttl` が 5 年以上前の値の行や、`ttl` が Number 型でない行は、DynamoDB の TTL の対象外になり、削除されません。
- TTL の変更が反映されるまで最大 1 時間かかることがあり、その間に同じテーブルで有効化・無効化をもう一度行うと `ValidationException` になります。短い間隔で切り替えないでください（例: オプトインをデプロイした直後に取り消す）。
- TTL による削除は無料（書き込みキャパシティを消費しない）で、テーブルのストリームには `userIdentity.principalId` が `dynamodb.amazonaws.com` の `REMOVE` レコードとして流れます。ampless の dispatcher は KvStore のストリームを処理しますが、反応するのは `siteconfig` の行（サイト設定キャッシュの再生成）だけで、これらの行は `ttl` なしで書かれます。PostHistory のストリームは処理しません。自分で追加したストリームの処理があれば、そちらも確認してください。

### 失敗したプラグインイベントの確認

処理に失敗したプロセッサー呼び出しは、`amplify/backend.ts` で作成された共有イベント DLQ（`EventsDlq`）に送られます。SQS コンソールまたは `aws sqs receive-message --queue-url <dlq-url> --max-number-of-messages 10` でメッセージを確認してください。ampless にはデフォルトの自動アラームがないため、定期的な手動確認を推奨します。あるいは `ApproximateNumberOfMessagesVisible` に CloudWatch アラームを設定してください。

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
