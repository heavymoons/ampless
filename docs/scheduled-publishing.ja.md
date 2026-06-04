> English: [scheduled-publishing.md](./scheduled-publishing.md)

# 予約投稿

ampless では、今日記事を書いて、指定した日時にサイトへ公開することができます — 公開のタイミングで手動操作は不要です。

---

## 予約投稿の仕組み

予約投稿は 2 つの要素の組み合わせで成立します。

1. **`status: 'published'`** — 投稿が公開状態にある。
2. **`publishedAt`** に未来の UTC タイムスタンプを設定 — その時刻まで、すべての公開サーフェスから投稿が隠れる。

`publishedAt` がすでに過去（または `publishedAt` が未設定）の公開投稿は即時公開されます。

**下書き**投稿は `publishedAt` に関わらず常に非公開です。下書きに未来の `publishedAt` を設定しても、ステータスを `published` に変更するまで効果はありません。

```
status: 'draft'     → 常に非公開
status: 'published' + publishedAt: null     → 今すぐ公開
status: 'published' + publishedAt: 過去     → 今すぐ公開
status: 'published' + publishedAt: 未来     → publishedAt まで非公開
```

---

## `publishedAt` のセマンティクス

### `publishedAt` なし = 即時公開

日時を設定せずに **[公開]** ボタンを押すと、admin エディターと MCP が現在のサーバー時刻を `publishedAt` としてスタンプします。これにより、ホームページ・タグページ・feed.xml など、`publishedAt` の降順で並び替え・フィルタリングするすべてのリストに投稿が表示されます。

### `publishedAt` は公開ソートキー

すべての公開投稿リスト（ホームページ、タグページ、RSS フィード、sitemap）は `publishedAt` の降順で並び替えられ、`publishedAt` が未来の投稿は除外されます。`publishedAt` は一度設定されると固定されます。後で本文を編集しても変わりません。

### `publishedAt` がないレガシー行

予約投稿機能が導入される前から存在するサイトには、`publishedAt` が未設定の公開投稿があります。これらの投稿は:

- 直接 URL（`/<slug>`）でアクセス可能。
- ホームページ、タグページ、feed.xml、sitemap.xml のリスト — ソート・フィルタロジックから**除外される**。

リストに表示させるには、admin エディターで各投稿を開いて保存してください。エディターが現在時刻を `publishedAt` としてバックフィルします。過去の公開日時を保持したい場合は、MCP の `updatePost` ツールで明示的な `publishedAt` を指定してください。

---

## タイミングの精度

予約投稿は**秒単位で正確に**公開されるわけではありません。公開のタイミングはサーバーとブラウザの間のキャッシュウィンドウに依存します。

- 公開サーフェス（投稿ページ、ホーム/リスト、タグページ）は Next.js のサーバーサイドレンダリングで、デフォルトのキャッシュ TTL は最大 **~5 分**です（`cms.config.cache.freshTtlSeconds` で変更可能）。
- `feed.xml` と `sitemap.xml` は RSS / sitemap プラグインが `content.published`・`content.updated` などのイベントを受け取ったときに再生成されます。これらのイベントは **保存時**に発火します。`publishedAt` の時刻ではありません。そのためフィードは、`publishedAt` が過ぎた後に**次のコンテンツイベントが発生したとき**に更新されます — 予約時刻に自動更新されるわけではありません。

分単位の正確な配信が必要な場合（速報など）は、目標時刻より少し早めに予約し、キャッシュウィンドウを考慮してください。

---

## イベントと通知のタイミング

`content.published` イベントは `publishedAt` が到来したときではなく、**投稿がデータベースに保存されたとき**に DynamoDB Streams 経由で発火します。つまり:

- 外部通知プラグイン（webhook、プッシュ通知、SNS 投稿など）は投稿を保存した瞬間に発火します — 投稿が実際に公開される数時間〜数日前の可能性があります。
- 現在の投稿一覧から公開アセットを再構築するプラグイン（RSS、sitemap、JSON インデックスなど）には影響しません: `listPublishedPosts()` が未来日時の投稿を除外しているためです。

プラグイン作者は外部通知の前に `publishedAt` チェックでガードする必要があります。推奨パターンは [`packages/ampless/docs/plugin-author-guide.ja.md` §6a](https://github.com/heavymoons/ampless/blob/main/packages/ampless/docs/plugin-author-guide.ja.md#6a-) を参照してください。

---

## 日付・時刻フォーマット

`publishedAt` の値はすべて `Z` で終わる **UTC ISO 8601** 文字列です（例: `2026-09-01T09:00:00.000Z`）。MCP の `listPosts` や `listPublished` ツールで `from` / `to` クエリ引数を使う場合も、`Z` で終わる UTC ISO 文字列を渡してください。タイムゾーンオフセット形式（`2026-09-01T18:00:00+09:00`）はすべてのクエリパスで受け付けられるとは限りません。

---

## 既存デプロイ済みサイトへのアップグレード手順

予約投稿は 2 か所で独立した変更が必要です。**両方**をデプロイしてください。片方だけでは未来日時の投稿が一部のサーフェスから漏れる可能性があります。

### 1. AppSync リゾルバファイル（サイトごと、`@ampless/backend` には含まれない）

リスト・単一投稿のリゾルバは `amplify/data/` 配下の `.js` ファイルとしてサイトのリポジトリに存在します。これらは `create-ampless` が `templates/_shared/amplify/data/` からコピーしたもので、`@ampless/backend` パッケージのアップグレードでは**更新されません** — サイトのソースの一部です。

最新の `templates/_shared/amplify/data/` から該当するリゾルバファイルを更新し、**再デプロイ**（`amplify push` またはサンドボックス再起動）してください。これをしないと AppSync レイヤーが単一投稿フェッチ時に未来の `publishedAt` 行をフィルタリングしません。

### 2. `@ampless/backend` パッケージ

`feed.xml` と `sitemap.xml` で使われる `listPublished()` ヘルパーは `@ampless/backend` に含まれます。予約投稿フィルタが含まれるバージョンに上げて再デプロイしてください。これをしないと `feed.xml` と `sitemap.xml` に未来日時の投稿が含まれることがあります。

### チェックリスト

- [ ] `amplify/data/*.js` リゾルバファイルを最新テンプレートソースから更新し再デプロイする。
- [ ] `@ampless/backend` を予約投稿サポートが含まれる最低バージョンに上げて再デプロイする。
- [ ] 動作確認: 未来の `publishedAt` を持つ投稿を作成し、予約時刻になる前にホームリスト・タグページ・feed.xml・sitemap.xml に表示されないことを確認する。
