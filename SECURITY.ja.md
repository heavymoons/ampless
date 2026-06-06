> English: [SECURITY.md](./SECURITY.md)

# セキュリティポリシー

## サポートされるバージョン

ampless は現在 **alpha** 段階で、パッケージは npm の `alpha` dist-tag で publish しています。各パッケージで最新の `alpha.N` のみがセキュリティ修正の対象です。LTS / バックポートブランチはありません。

ampless が beta に進むと (npm `beta` dist-tag、リポジトリ公開)、同じ「最新のみ」ポリシーが最新の `beta.N` に適用されます。RC および stable では標準的な semver バックポートに従います。

## 脆弱性の報告

**セキュリティ問題については public な issue を立てないでください。** 以下の private チャンネルのいずれかを使ってください:

- **推奨 (有効化後): GitHub Private Vulnerability Reporting**。 <https://github.com/heavymoons/ampless/security/advisories/new> から private な脆弱性レポートを open してください。リポジトリが public になった beta 以降で、かつメンテナがリポジトリ Settings で Private Vulnerability Reporting を **明示的に有効化** したあとに利用可能です。ページが 404 / "not enabled" を返す場合は、下記メールにフォールバックしてください。
- **メール: `ishikawa.naoto@heavymoons.net`** に件名プレフィックス `[ampless security]` をつけて送ってください。現状の alpha (private repo) を含む任意のステージで利用可能で、PVR フォームの状態に関わらず安全な選択肢です。

報告には以下を含めてください:

- 問題の概要、影響パッケージ / サーフェス (例: `@ampless/runtime`、プラグインシークレット暗号化、public renderer、MCP HTTP transport)
- 最小再現手順または PoC
- テストした ampless のバージョン
- 既に他の場所で開示済みかどうか

## 対応スケジュール

ampless は現在 1 名のメンテナがベストエフォートで運用しています。 **SLA はありません**。実際の目安:

- 受領確認: 報告から 1 週間以内 (通常はもっと早い)
- トリアージ評価: 報告から 2 週間以内
- 修正 / 開示計画: トリアージ後にケースバイケースで連絡

合理的な時間内に受領確認が来ない場合は、同じチャンネルでフォローアップしてください。

## 開示方針

ampless は **協調開示 (coordinated disclosure)** を希望します。確認された脆弱性については、修正が ship する前に公開開示しないよう合理的な禁輸期間に合意します。このプロセスに従ったレポーターは changelog にクレジットされます (匿名希望も可)。
