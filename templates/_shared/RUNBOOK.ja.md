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
  - [投稿の公開日時の保存値を正規化する（1 回だけの移行）](#投稿の公開日時の保存値を正規化する1-回だけの移行)
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

- **PostHistory** — `cms.config.ts` の `history.retentionDays` が 0 より大きいとき、リビジョンのスナップショットごとに書き込みます（`0` / 未設定なら `ttl` は書きません）。ampless に含まれる書き込み元は event-dispatcher Lambda だけで、Post ストリームから読んだ保存ごとにリビジョンを `PutItem` します（最大 3 回再試行されるため、保存からしばらく経ってから書き込まれることもあります）。
- **KvStore** — `KvStore.put(pk, sk, value, { ttlSeconds })` で書いた行（プラグインのキャッシュや状態）。ampless が KvStore に書き込むのは、admin / editor のセッションから AppSync 経由（管理画面）だけです。自分で追加したコード、スクリプト、連携も書き込み元になります。

ampless はどちらのテーブルでも DynamoDB の TTL を有効に**しません**。そのため自動削除は行われず、`ttl` を過ぎた行もテーブルに残り、読み取りでもそのまま返ります（ampless は読み取り時に期限切れの行を除外しません）。以前のリリースでは `backend.ts` で TTL を有効にしているように見えましたが、その代入はデプロイされるテーブルに反映されていませんでした（heavymoons/ampless#399）。アップグレードしてもこの状態は変わりません。手動で有効にした TTL も含め、各テーブルの TTL はそのまま維持されます。

オプトインにしているのは、**TTL を有効にすると、`ttl` がすでに過ぎているすべての行を DynamoDB が削除する**ためです。長く運用しているサイトでは、数か月〜数年分のリビジョンやキャッシュ行が一度に対象になることがあり、PITR などのバックアップがなければ元に戻せません。メンテナンス時間を取り、以下の手順でテーブルごとに有効にしてください。

**先に書き込みを止める理由。** スキャンはスナップショットではありません。テーブルをページごとに時間をかけて読むため、スキャン中やスキャン後に書き込まれた行、書き直された行、再配信された行は結果に含まれないことがあります。そうした行の `ttl` がすでに過ぎていれば（または作業中に過ぎれば）、確認されないまま TTL で削除されます。調査に意味があるのは、最初の調査から TTL を有効にして確認し終えるまで、誰もそのテーブルに `ttl` を書けない状態のときだけです。

1. **すべての書き込み元を止め、テーブルに書き込みがないことを確かめます。** 手順 8 まで止めたままにします。
   - **PostHistory**: **Post** テーブルに書き込むものをすべて止めます。admin / editor による編集、MCP クライアント（発行済みの MCP トークンやローカルの MCP サーバー経由の `create_post` / `update_post` / `commit_static_post`）、スクリプト、インポート、連携などです。記事を保存するたびに event-dispatcher Lambda がリビジョンを書き込むためです。`history.retentionDays` は変えずにそのままにします（下の **作業中に `retentionDays` を 0 にしない** を参照）。
   - **KvStore**: admin / editor による編集（サイト設定、テーマ、プラグイン設定）を止め、KvStore に書き込むプラグイン、スクリプト、連携をすべて止めます。
   - 独自の書き込み元（自作の Lambda、スクリプト、同じテーブルを使う別アプリ）も対象です。止められないものがある場合は、先に進む前に **限界** を読んでください。

   そのうえで、次の確認を**すべて**行います（どれか 1 つだけでは足りません）：
   - **テーブルに書き込みが届いていない。** PostHistory または KvStore のテーブル（PostHistory の準備では Post テーブルも）の `ConsumedWriteCapacityUnits`（`AWS/DynamoDB`、ディメンション `TableName`）の `Sum` が、停止してから毎分 0 であること。把握していない書き込み元もこれで見つかります。手順 3 の自分の条件付き更新は、あとでここに現れますが、それは想定どおりです。
   - **dispatcher に処理中・未処理のものがない**（PostHistory）。event-dispatcher 関数とそのストリームのマッピングを確認します：

     ```bash
     aws lambda list-event-source-mappings --region <リージョン> \
       --function-name <event-dispatcher 関数> \
       --query 'EventSourceMappings[].[EventSourceArn,State,LastProcessingResult,DestinationConfig]'
     ```

     2 つのマッピング（Post と KvStore のストリーム）がどちらも `Enabled` で、`LastProcessingResult` が `OK` か `No records processed`（ストリームに新しいレコードがないときの通常の値）であること。それ以外の値（たとえば `PROBLEM: ...`）なら、先に原因を調べます。`State` も `LastProcessingResult` も、それだけではストリームを処理し終えた証明になりません。どちらもマッピングと直近のポーリングの状態を表すだけで、待っているレコードや再試行中のレコードはわからないため、下のメトリクスとログの確認と合わせてだけ使ってください。ampless は失敗時の送信先を設定していないため、再試行（3 回、バッチ分割あり）をすべて失敗したバッチはキューに残らず破棄されます。events DLQ に入るのは失敗したプラグイン processor のメッセージだけで、processor は PostHistory にも KvStore にも書き込まないため、ここでの書き込み元にはなりません。
     dispatcher 関数の CloudWatch メトリクス `Invocations` と `Errors`（`AWS/Lambda`）が、最後に Post へ書き込んでから少なくとも 15 分間 0 であり、`ConcurrentExecutions` がないか 0 であること。停止してからのロググループに、エラーや再試行がないことも確認します。その間にエラーがあれば、バッチが再試行されたか破棄されています。先に進む前に、そのバッチに含まれていたレコードを調べてください。
   - `IteratorAge` が 0 付近に戻っていることは、ストリームを処理し終えた状態と矛盾しませんが、**それだけでは証明になりません**。関数が呼び出されたときにしか記録されないため、データポイントがないことと処理し終えたことの区別がつかず、いま再試行中のバッチについても何もわかりません。上の確認と合わせてだけ使ってください。

2. **調査（読み取りのみ）。** ライブテーブルの名前（`<モデル名>-<apiId>-NONE`。`aws dynamodb list-tables` で確認）を調べ、現在の TTL の状態を確認し、有効にした直後に削除される行を、キーと `ttl` の組で一覧してファイルに保存します：

   ```bash
   aws dynamodb describe-time-to-live --region <リージョン> --table-name <ライブテーブル>

   NOW=$(date +%s)
   aws dynamodb scan --region <リージョン> --table-name <ライブテーブル> \
     --consistent-read \
     --filter-expression 'attribute_exists(#t) AND #t < :now' \
     --projection-expression 'postHistoryId, #t' \
     --expression-attribute-names '{"#t":"ttl"}' \
     --expression-attribute-values "{\":now\":{\"N\":\"$NOW\"}}" \
     --output json > ttl-audit-1.json
   ```

   KvStore では `postHistoryId, #t` の代わりに `pk, sk, #t` を指定します。CLI が `LastEvaluatedKey` をたどってページングし、`Count` がすでに期限切れの行数、`ScannedCount` が読み取った行数です。件数だけ見るなら、projection の代わりに `--select COUNT` を使います。`AND #t < :now` を外すと `ttl` を持つすべての行が出るので、有効にした直後に期限を迎える行も確認できます。スキャンはテーブル全体を読むため読み取りキャパシティを消費します。大きなテーブルでは負荷の少ない時間帯に実行してください。

3. **残す行を決め、条件付きで変更します。** 調査で出た行は、TTL を有効にする**前に** `ttl` を削除するか引き上げない限り、有効にしたあと削除されます。変更は、行がまだ存在し、調査で見た `ttl` のままであることを条件にします：

   ```bash
   aws dynamodb update-item --region <リージョン> --table-name <ライブテーブル> \
     --key '{"postHistoryId":{"S":"<id>"}}' \
     --update-expression 'REMOVE #t' \
     --condition-expression 'attribute_exists(postHistoryId) AND #t = :seen' \
     --expression-attribute-names '{"#t":"ttl"}' \
     --expression-attribute-values '{":seen":{"N":"<調査で見た ttl>"}}'
   ```

   KvStore では `--key '{"pk":{"S":"<pk>"},"sk":{"S":"<sk>"}}'` と `attribute_exists(pk)` を使います。期限を延ばす場合は、同じ条件のまま `--update-expression 'SET #t = :later'` とし、値に `":later":{"N":"<未来のエポック秒>"}` を加えます。

   条件は省略しないでください。条件なしの `update-item` は、元の行がその間に削除されていると、キーだけの行を**新しく作ってしまい**、調査後にほかの書き込み元が変えた `ttl` も黙って上書きします。`ConditionalCheckFailedException` で失敗した場合は何も書き込まれていません。行を読み直し（`aws dynamodb get-item --consistent-read --key ...`）、今の内容で判断し直します。行が消えていれば作り直さず（必要な行なら PITR から復元します）、`ttl` が変わっていればまだ動いている書き込み元があるので、手順 1 に戻ります。

   `history.retentionDays` を変えても既存の行は直りません。変更後に書かれるリビジョンにだけ反映され、既存の行は書き込まれたときの `ttl` を持ち続けます。KvStore の変更も通常の編集と同じくストリームに流れます（dispatcher が処理するのは `siteconfig` の行だけです）。

4. **PITR が有効か確認します。** PITR（またはオンデマンドバックアップ）がなければ、TTL による削除は元に戻せません。復元できる範囲の始まりも控えておきます：

   ```bash
   aws dynamodb describe-continuous-backups --region <リージョン> --table-name <ライブテーブル> \
     --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription'
   ```

   `PointInTimeRecoveryStatus` が `ENABLED` であること、`EarliestRestorableDateTime` が復元できる最も古い時点です。必要な行が消えてしまった場合は、TTL を有効にする直前の時刻を指定して [ポイントインタイムリカバリによるデータテーブルの復元](#ポイントインタイムリカバリによるデータテーブルの復元) の手順に従ってください。書き戻した行は過去の `ttl` を持ったままなので、コピーするときに削除するか引き上げないと、TTL によって再び削除されます。

5. **デプロイの直前にもう一度調査します。** 手順 1 の確認を繰り返し（停止してから、手順 3 の自分の更新以外に説明のつかない書き込みがなく、dispatcher が止まっていること）、そのうえで新しい `NOW` で手順 2 のスキャンをもう一度実行します（`ttl-audit-2.json`）。出てくる行は、すべて削除してよいと決めた行でなければなりません。確認していない行が出たり、直した行が戻っていたりしたら、まだ動いている書き込み元があります。それを止めて手順 2 からやり直します。TTL が有効になるまでの時間の余裕も見ておきます。このスキャンから手順 7 の終わりまでに期限を迎える行も削除されるので、`AND #t < :now` を外すか、`NOW=$(( $(date +%s) + 86400 ))` として、翌日までに期限を迎える行も確認します。

6. **オプトインします。** 書き込み元を止めたまま、`amplify/backend.custom.ts` に追加してデプロイします：

   ```ts
   export function customizeBackend(backend: AmplessBackend): void {
     backend.data.resources.cfnResources.amplifyDynamoDbTables['PostHistory'].timeToLiveAttribute =
       { attributeName: 'ttl', enabled: true }
   }
   ```

   KvStore には `'KvStore'` で同じ行を書きます。プロパティ名に注意してください。`timeToLiveAttribute`（Amplify のテーブルラッパーのセッター）が正しく、`timeToLiveSpecification` はセッターではないため、代入しても何も起きません。Amplify のテーブルマネージャーが `UpdateTimeToLive` でその場で適用し、テーブルは置き換えられません。

7. **デプロイ直後に確認します。** `describe-time-to-live` が `ENABLING` か `ENABLED` で、`AttributeName` が `ttl` になっていることを確かめます。手順 2 のスキャンをもう一度実行し（`ttl-audit-3.json`）、削除してよいと決めた行だけが返ることを確認します（TTL はバックグラウンドで削除するので、すでに消えている行もあります）。一覧にない行があれば、その行は今まさに削除されうる状態です。すぐに手順 3 の条件付き更新で直し、すでに削除されていれば PITR から復元します（手順 4）。

8. **書き込み元を再開します。** 連携と MCP クライアントを再開し、編集を再開します。`history.retentionDays` は一度も変えていないので、新しいリビジョンにはこれまでどおり `ttl` が付きます。これ以降は、`ttl` を過ぎた行が削除されます（それが TTL を有効にする目的です）。リビジョンの `ttl` は保存時刻から計算されるため、`retentionDays` が短いと、遅れて書かれたリビジョン（再試行されたストリームレコード）は書き込んだ時点ですでに `ttl` を過ぎていることがあります。

9. **監視します。** CloudWatch のメトリクス `TimeToLiveDeletedItemCount`（名前空間 `AWS/DynamoDB`、ディメンション `TableName`）で、TTL が削除した行数がわかります。最初の数日は、削除してよいと決めた行数とおおよそ同じ数がまとまって削除され、その後は少しずつになるはずです：

   ```bash
   aws cloudwatch get-metric-statistics --region <リージョン> \
     --namespace AWS/DynamoDB --metric-name TimeToLiveDeletedItemCount \
     --dimensions Name=TableName,Value=<ライブテーブル> \
     --start-time <TTL を有効にした時刻（ISO）> --end-time <現在（ISO）> \
     --period 3600 --statistics Sum
   ```

   合計が一覧より明らかに多ければ、確認していない行が削除されています。PITR で新しいテーブルに復元して比べてください。

**作業中に `retentionDays` を 0 にしない。** 編集を止めずに新しい `ttl` を止める方法に見えますが、0 にしている間に書かれたリビジョンはすべて `ttl` **なし**で保存され、あとで設定を戻しても `ttl` は付きません。それらのリビジョンは期限切れになりません。それでも 0 にする場合（どうしても編集を止められないときなど。**限界** を参照）は、あとでそれらの行を意図して扱ってください。`attribute_not_exists(#t)` かつ `revisedAt` が作業時間内の行を一覧し、ずっと残すことを受け入れるか、本来付くはずだった `ttl`（`epoch(revisedAt) + retentionDays * 86400`）を 1 行ずつ `--update-expression 'SET #t = :ttl'` と `--condition-expression 'attribute_exists(postHistoryId) AND attribute_not_exists(#t)'` で付けます。すでに過去になっている値を付けると、その行はすぐに TTL で削除されます。設定を変えたときに再試行中だった Post ストリームのレコードは、dispatcher が処理する時点の設定で書き込まれます。

TTL を再び無効にするには、オプトインの行を削除してデプロイします（下の「1 時間に 1 回」の注意点を参照）。

**限界。**

- この手順は競合の余地を狭めますが、なくすことはできません。DynamoDB には「調査してから有効にする」を不可分に行う操作がありません。TTL はデプロイで有効になり、非同期に反映され、それ以降は確認したかどうかに関係なく `ttl` を過ぎた行を削除します。安全性は、手順 1 から手順 7 まで書き込みを止められたかどうかで決まります。
- 強い整合性のスキャンも、整合するのはページ単位で、テーブル全体ではありません。2 回のスキャンは別々の時点のテーブルを見ています。書き込みを止めているときにだけ比較できます。
- 手順 1 の確認は根拠であって、証明ではありません。CloudWatch のメトリクスは 1 分単位で集計され、遅れて届きます。直前 1 分の書き込みや、停止の指示に従わない書き込み元は見逃すことがあります。特に `IteratorAge` は、それだけでは dispatcher が止まっている根拠になりません。
- 止められない書き込み元（外部連携、編集を止められない忙しいサイトなど）がある場合、調査から手順 7 までの間にその書き込み元が過去または間もなく過ぎる `ttl` で書いた行は、確認されないまま削除されることがあります。そのテーブルではそれを受け入れるか、先にその書き込み元が `ttl` を送らないように変えるか（PostHistory なら `retentionDays: 0`。上に書いた、期限切れにならない行が残るという結果を伴います）、TTL を無効のままにしてください。
- 望まない TTL 削除から戻す方法は、復元（PITR またはオンデマンドバックアップ）と、必要な行だけの書き戻しだけです。その制約は PITR の節に書いたとおりです。

**注意点。**

- 削除はすぐには行われません。AWS は期限切れの行を通常数日以内に削除します（`UpdateTimeToLive` の API リファレンスでは、通常 2 日、つまり約 48 時間以内とされています）。それまでは読み取り、クエリ、スキャンで返ります。ampless は読み取り時に期限切れの行を除外しません。
- `ttl` が 5 年以上前の値の行や、`ttl` が Number 型でない行は、DynamoDB の TTL の対象外になり、削除されません。
- TTL の変更が反映されるまで最大 1 時間かかることがあり、その間に同じテーブルで有効化・無効化をもう一度行うと `ValidationException` になります。短い間隔で切り替えないでください（例: オプトインをデプロイした直後に取り消す）。
- TTL による削除は無料（書き込みキャパシティを消費しない）で、テーブルのストリームには `userIdentity.principalId` が `dynamodb.amazonaws.com` の `REMOVE` レコードとして流れます。ampless の dispatcher は KvStore のストリームを処理しますが、反応するのは `siteconfig` の行（サイト設定キャッシュの再生成）だけで、これらの行は `ttl` なしで書かれます。PostHistory のストリームは処理しません。自分で追加したストリームの処理があれば、そちらも確認してください。

### 投稿の公開日時の保存値を正規化する（1 回だけの移行）

AppSync の `AWSDateTime` は、同じ時刻をいろいろな書き方で受け付けます（`2026-05-01T09:00:00+09:00`、`2026-05-01T00:00Z`、ナノ秒など）。このリリースから、`createPost` / `updatePost` はすべて（管理画面、MCP、GraphQL の直接呼び出しのいずれでも）`publishedAt` を UTC の正規形（`YYYY-MM-DDTHH:mm:ss.sssZ`）で保存し、あわせて `publishedAtSortKey`（`<publishedAt>#<postId>`）を書きます。UTC で 0000〜9999 年の正しい日時でない値は `ValidationError` で拒否されます。

アップグレード**前**に保存された投稿は、次に保存されるまで元の文字列のままです。そうした行は一覧に遅れて出たり順序がずれたりすることがあり、タグページ用の行も古いキーのまま残ります。また `publishedAtSortKey` を持ちません（今後のリリースで、投稿一覧をこのキーのインデックスに切り替えます）。アップグレードをデプロイした後、サイトごとに `ampless-migrate-published-at` で 1 回書き換えます。

**ツールが保証すること・しないこと。**

- 書き込みは投稿ごとに 1 回の条件付き `UpdateItem` で、`publishedAt` / `publishedAtSortKey` だけを書きます。条件は、**この 2 つ**の属性が（強い整合性の）スキャンで読んだ値のままであることです。その間にどちらかを変えた編集があれば書き込みは失敗し、conflict として報告して何もしません。ほかの属性への編集は conflict に**なりません**。移行の書き込みはそのまま成功しますが、ほかの属性は書かないので、その編集を上書きしません。`updatedAt` は変えません。
- 書き込みは通常の保存と同じく Post のストリームを通ります。dispatcher は `publishedAt` の書き方（と `publishedAtSortKey`）だけが変わったことを見分け、`content.updated` イベントを**出しません**（webhook などのプラグインは動きません）。PostHistory の版も書きません。タグページ用（PostTag）の行は更新します。この更新は、イベントの中身ではなく、投稿の現在の状態を強い整合性で読んで作り直します。行の削除も書き込みも、1 件ずつ「投稿がその状態のままであること」を条件にしたトランザクションで行います。そのため、イベントが順不同で処理されても（trusted キューは SQS 標準キューです）、処理の途中でワーカーが止まっても、下書きや削除済みの投稿の行が書かれることはなく、今の状態の行が消されることもありません。行の削除は非同期です。非公開にした後も、その更新が処理されるまでは行が見えています。
- dry-run で変更対象が 0 件でも、それだけでは移行の完了を**証明しません**。書き込みが処理中のことがあり、PostTag の更新は Post の書き込みの後に非同期で行われるからです。完了は、書き込みをすべて止めた状態で、次の手順を通して確かめます。編集中のサイトでツールを動かしてもデータは安全ですが、その報告は変わり続ける対象についてのものになります。

**手順**

1. **アップグレードをデプロイ**し、完了を待ちます。最初のデプロイでは Post テーブルに `byStatusSorted` インデックスも作るので、大きなテーブルでは時間がかかることがあります。
2. **テーブル名**（`Post-<apiId>-NONE`、`PostTag-<apiId>-NONE`）を DynamoDB コンソールで調べるか、次を実行します。

   ```bash
   aws dynamodb list-tables --query "TableNames[?starts_with(@, 'Post')]"
   ```

   1 つのアカウントに複数の環境がある場合は、`<apiId>` を移行するブランチの AppSync API と照合してください。
3. **書き込みをすべて止めます**: 管理画面・編集者による投稿の保存、MCP トークン、スクリプトや API クライアントを止め、デプロイもしません。手順 8 まで止めたままにします。
4. **dry-run**（既定。強い整合性の読み取りのみ）:

   ```bash
   pnpm exec ampless-migrate-published-at --table <PostTable> --region <region>
   ```

   テーブルと `byStatusSorted` が `ACTIVE`（インデックスの構築が終わっている）ことを確かめ、`publishedAt` を書き換える投稿（元の値、正規値、時刻）、`publishedAtSortKey` が無いかずれている投稿、読めない値の投稿を一覧にします。読めない値は書き換えません。管理画面で公開日時を設定し直して直してください（書き込みを止めているので、手順 3 の前に行うか、別の回として扱います）。
5. dry-run を確認してから **apply** します。インデックスが `ACTIVE` でなければ `--apply` は実行を拒否します。

   ```bash
   pnpm exec ampless-migrate-published-at --table <PostTable> --region <region> --apply
   ```

   書き込みは 1 件ずつ行い、速度は `--max-writes-per-second`（既定 10）で制限します。dry-run で変更対象が 0 件になるまで再実行します。
6. **イベントの処理が終わるのを待ちます。** 次の項目は処理が終わった目安で、証明ではありません（判定に使うのは手順 7 です）。すべてが同時に成り立つことを確かめます。
   - event-dispatcher Lambda の Post ストリームの `IteratorAge` メトリクスが 0 に戻り、そのまま変わらない（CloudWatch → Lambda → dispatcher 関数）。データポイントが無いことは 0 ではありません。apply の実行全体を含む期間で確認します。
   - その期間の dispatcher の `Errors` メトリクスが 0 で、ロググループに `[event-dispatcher]` のエラーが無い。Post ストリームには失敗時の送り先が無いので、再試行しても失敗したバッチは**捨てられ**、そのイベントはキューに届きません。それが起きたことは、エラーにしか表れません。
   - trusted イベントキュー（`amplessEvents` スタックの `TrustedEventsQueue`）の `ApproximateNumberOfMessages`、`ApproximateNumberOfMessagesNotVisible`、`ApproximateNumberOfMessagesDelayed` がすべて 0（近似値なので、1 分ほど空けて何回か読みます）。

     ```bash
     aws sqs get-queue-attributes --queue-url <trusted-queue-url> \
       --attribute-names ApproximateNumberOfMessages \
       ApproximateNumberOfMessagesNotVisible ApproximateNumberOfMessagesDelayed
     ```

   - デッドレターキュー（`EventsDlq`）に今回のメッセージが無い。あれば先に進む前に確認してください（[失敗したプラグインイベントの確認](#失敗したプラグインイベントの確認)）。`post.index.refresh` が失敗していれば、その投稿のタグ行は作り直されていません。

   これらが何を示していても、失われたイベントを見つけられるのは手順 7 だけです。
7. **タグページ用のインデックスを投稿と照合します**（強い整合性の読み取り）:

   ```bash
   pnpm exec ampless-migrate-published-at --table <PostTable> \
     --post-tag-table <PostTagTable> --region <region> --check-post-tags
   ```

   あってはならない PostTag の行（下書きや削除済みの投稿、古いキー、古いタイトル・抜粋など）と、足りない行を報告し、見つかれば 0 以外の終了コードで終わります。`--apply` を付けると修復します。対象の投稿ごとに、イベント処理と同じ方法で現在の状態から作り直します（削除も書き込みも、投稿が作り直しに使った状態のままである間だけ反映されます）。書き込みは 1 件ずつ、`--max-writes-per-second` で速度を制限して行います。報告が 0 件になるまで繰り返します。以前のリリースが残した古い行もこれで消えます。
8. **書き込みを再開します。** 書き込みを止めた状態で、手順 4 の変更対象が 0 件、手順 6 の処理が終わっていて、手順 7 の不一致が 0 件であれば、移行は完了です。

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
