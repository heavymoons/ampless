> English: [02-tech-stack.md](./02-tech-stack.md)
> 
## 2. 技術スタック

| レイヤー | 技術 | 備考 |
|---------|------|------|
| フレームワーク | Next.js (App Router) | Astro(EmDash)より開発者人口が多い |
| バックエンド | Amplify Gen 2 | CDK ベース、TypeScript で完結 |
| データベース | DynamoDB | Amplify ネイティブ、サーバーレス |
| ストレージ | S3 | メディアファイル |
| 認証 | Cognito | Amplify Auth 標準 |
| イベント処理 | DynamoDB Streams + SQS | 非同期フック・Webhook の基盤 |
| プラグイン実行 | Lambda（リージョン） | trust_level 別に複数関数 |
| エディタ | tiptap (MIT) | ProseMirror ベース、Extensions 豊富 |
| CSS | Tailwind CSS | 公開テーマ・管理画面共通 |
| 管理画面 UI | shadcn/ui | Tailwind ベースのコンポーネント集 |
| CDN | CloudFront | Amplify Hosting が自動構成 |
| ライセンス | MIT | EmDash と同じ。企業利用のハードルを下げる |

### エッジ実行について
CloudFront Functions / Lambda@Edge はプラグイン実行には使わない。
理由: Amplify が自動生成する CloudFront にカスタムエッジ関数を差し込む正規の方法がない。
テキスト変換程度の処理はリージョン Lambda で 1-2ms で完了するため実用上問題なし。
CloudFront のキャッシュが効けばそもそも Lambda は呼ばれない。

---
