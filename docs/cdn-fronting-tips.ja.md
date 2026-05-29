# 自前 CDN (CloudFront / Cloudflare) で ampless を front する

> English: [cdn-fronting-tips.md](./cdn-fronting-tips.md)

ampless は素のままだと Amplify Hosting 内蔵の CloudFront 経由で配信される。これで普通には十分。**キャッシュをきめ細かく制御したい / 大規模トラフィックで bandwidth を安くしたい** ケースでは、自前 CDN を Amplify と S3 の前に挟む。Amplify は SSR を続け、S3 は media + 静的バンドルを持つ、CDN がドメインとルーティングを所有する形。

これは managed 機能ではない。runbook 寄りの tips。ampless 側で自動化はしない。セットアップは一回きりで、ampless リポジトリの外側で完結する。

## やる価値があるとき

- **bandwidth コストが嵩んでる**。CloudFront usage-based の単価は Amplify bandwidth の約半額/GB。さらに高トラフィックでは Security Savings Bundle / Reserved Capacity でもう一段下げられる。
- **キャッシュ制御を集約したい**。ampless は既に有用な `Cache-Control` (stream-back media に immutable、themed post に computed value) を emit している。自前 CDN ならそれを直接尊重、Amplify 内蔵 cache 層に邪魔されない。
- **ドメイン + edge を 1 箇所に統一したい**。multi-origin routing で、同じ CDN が SSR HTML / S3 由来 media bytes / 静的バンドル / `public/site-settings.json` を全部捌く。Amplify 経由と S3 直行のスプリットが解消する。
- **すでに Cloudflare 契約があって** DNS / WAF / analytics をそこに寄せたい。

上記のどれにも該当感が無いなら不要。普通のブログ / コーポレートサイトなら Amplify だけで十分。

## アーキテクチャ

```
                  ┌─────────────────┐
                  │  自前 CDN       │
あなたのドメイン → │  CloudFront or  │
                  │  Cloudflare     │
                  └────┬───────┬────┘
                       │       │
       HTML / API      │       │  media / 静的バンドル /
       /admin / Next   │       │  公開アセット
                       ▼       ▼
              ┌────────────────┐   ┌──────────────┐
              │ Amplify Hosting │  │  S3 bucket   │
              │   (SSR Lambda) │   │  (private、  │
              │                │   │   OAC 経由)  │
              └────────────────┘   └──────────────┘
```

CDN がパスで振り分け:

| パス | Origin |
|---|---|
| `/`, `/<slug>`, `/admin/*`, `/api/*`, `/_next/*` | Amplify Hosting (`xxx.amplifyapp.com`) |
| `/api/media/*` (or `public/media/*` に rewrite) | S3 bucket 直 |
| `/<slug>/*` 静的バンドル | S3 bucket 直 |
| `/public/site-settings.json` | S3 bucket 直 |

S3 は private のまま。CloudFront は OAC (Origin Access Control)、Cloudflare は signed URL or R2 移行で同等にできる。

## CloudFront パターン (AWS ネイティブ)

手動でやること:

1. **ACM 証明書を `us-east-1`** に。CloudFront はリージョン問わずここに必要。
2. **CloudFront distribution** に 2 origin:
   - Amplify default domain (`xxx.amplifyapp.com`) — HTML / SSR 用
   - S3 bucket (Amplify backend が作ったもの) — media と静的アセット用、OAC 付き
3. **Cache behaviour** で上の表のパスをそれぞれ振る。
4. **Origin request policy** で Amplify には `Host`、`Accept-Encoding`、`Cookie` (admin 認証用) を forward、S3 には最小限のみ。
5. **Route 53 alias** (`A` レコード) でドメインを distribution に向ける。
6. **Amplify 側の custom-domain 機能を解除** (もし既に紐付けてるなら)。`xxx.amplifyapp.com` のデフォルトのまま CloudFront から接続。ドメイン二重紐付け禁止。

価格設計の段階 (アーキテクチャ安定後にやる):
- **Security Savings Bundle**: ベース ~$250/月、10 TB/月コミット以上で意味あり。月 3 TB 超えあたりから元が取れる。
- **Reserved Capacity**: エンタープライズ層、超高トラフィック専用、AWS と個別契約。

CDK で全自動化は理論上可能 (`acm.Certificate` を `crossRegionReferences: true`、`cloudfront.Distribution`、`route53.ARecord`、S3 OAC policy)。ampless はこれを同梱しない。完全自動化したくなったら、`amplify/backend.ts` の隣に Amplify default domain を outputs から読む独自 CDK stack を書く形になる。

## Cloudflare パターン (多くの場合シンプル)

手動でやること:

1. **Cloudflare にドメイン追加**、DNS を Cloudflare nameserver に切り替え。Free プランで足りる。
2. **Origin rules / Page rules** でリクエスト振り分け:
   - デフォルト: `xxx.amplifyapp.com` に proxy
   - `/api/media/*` と静的バンドルパス: S3 bucket regional endpoint に proxy
3. **S3 認証**:
   - 最も楽: 公開して欲しい prefix だけ bucket public-read にしてパスで scope
   - より堅い: **Cloudflare Worker で signed URL** 発行、または media bucket を **Cloudflare R2** に移行 (CF edge との egress 無料)
4. **Cache rules** を ampless が emit するものに合わせる。Cloudflare は「Respect Existing Headers」を有効化すれば origin の `Cache-Control` を尊重する。
5. **SSL / TLS mode**: Full (strict) で Cloudflare ↔ origin を HTTPS + cert 検証。Amplify も S3 もすでに HTTPS 提供なので追加の cert 作業不要。

Cloudflare は小〜中規模では CloudFront より構成パーツが少なくて済むことが多い:
- ACM cert の region juggling 不要
- DNS と CDN が同居
- 寛大な free tier
- Pro ($20/月) で image resize + 高度な analytics

トレードオフ: provider が 2 つになる。billing / IAM / monitoring が分かれる。

## ampless 側が既にやってる助け

どっちの CDN でも、ampless の stream-back media は以下を emit している:

- media bytes に `Cache-Control: public, max-age=31536000, immutable` (アップロード時に timestamp 込みの key になるので URL は実質 content-addressed)
- S3 ETag passthrough、conditional GET で 304 返す
- themed post HTML に `metadata.cache` + `post.updatedAt` から計算した `Cache-Control` (`packages/runtime/src/middleware.ts:208-229`)

CDN 側でこれを上書きする必要なし — そのまま長寿命キャッシュとして edge で正しく動く。「origin Cache-Control を尊重しない」みたいなトグルは本当に理由があるとき以外触らないこと。

## CDN 構築完了後に SSR media 経路を整理する

`/api/media/*` が CDN から S3 直行になれば、`media-proxy.ts` SSR route ([packages/admin/src/api/media-proxy.ts](../packages/admin/src/api/media-proxy.ts)) は CDN を通らないトラフィック (ローカル dev、内部ヘルスチェック等) の fallback になる。選択肢:

- そのまま残す。冗長な経路として置いておく、当たらなければコストゼロ。
- ルートを S3 URL への永続 redirect に切り替え、公開トラフィックは CDN 任せに。

純粋に整理問題。どちらでもアーキテクチャは動く。

## 引き続き自分でやる必要があること

- **publish 時のキャッシュ invalidation**。現状 ampless は外部 CDN を invalidate しない。`Cache-Control` TTL (デフォルト fresh post 5 分) に任せるか、`content.published` で `CloudFront.CreateInvalidation` / Cloudflare purge API を呼ぶ trusted plugin hook を自前で書く。ファーストパーティ plugin 候補にはまだしない、サイト repo の中で作る形。
- **証明書更新**。ACM は DNS validation レコードを残せば自動更新。Cloudflare edge cert も自動更新。どちらも壊さないこと。
- **コスト監視**。Amplify バンドルから外れたら請求が 2 つに分かれる。
- **WAF ルール**。両 CDN とも WAF 提供。片方だけ使う、二重スタックしない。

## ステータス

ファーストパーティ機能としてはロードマップに無い。複数 user が自前 CDN 運用するのが常態化したら CDK helper の同梱を再検討するかもしれない。それまで本ページが唯一のサポート面。
