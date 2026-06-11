# Release workflow 運用ノート

> English: [release-workflow.md](./release-workflow.md)

このドキュメントは本リポジトリの changesets ドリブンなリリースパイプラインの動き方と、それを壊さないための運用ルールをまとめたもの。仕組み全体は CI が回しているので、feature PR 著者がやるべきことは **changeset を追加して、それ以上は触らない** ことだけ。

1 つだけ読むなら [落とし穴: pre.json のステイル登録](#落とし穴-prejson-のステイル登録) を読んで。

## パイプライン全体像

1. **feature PR を作る**
   - コードを書く
   - `.changeset/<slug>.md` をバンプ情報の frontmatter 付きで追加 ([CLAUDE.md → Changeset Policy](../CLAUDE.ja.md#changeset-policy) 参照)
   - commit → push → PR → review → `main` に merge

2. **`main` への push で Release workflow (`.github/workflows/release.yml`) が走る**
   - [`changesets/action@v1`](https://github.com/changesets/action) を使用
   - `.changeset/` に pending changeset があれば:
     - `pnpm version-packages` (`changeset version` 相当) を実行
     - `changeset-release/main` ブランチで「Version Packages (alpha)」PR を open / update
   - pending changeset が無ければ:
     - `pnpm release` (`changeset publish` 相当) を実行、`main` 上にあるが npm に未公開のものを publish

3. **Version Packages PR を merge**
   - 影響パッケージの `version` フィールドが bump される
   - `.md` ファイルの名前が `.changeset/pre.json` の `changesets: []` に記録される (consumed)。pre-mode 中、consumed 済みの `.md` ファイルはディスクに残り、`pre.json#changesets` のエントリと並存するのが通常状態。クリーンアップは `pre exit` 後か手動で実施する。`pre.json#changesets` 配列が "consumed 済み" の正式な source of truth
   - merge で Release workflow が再走、`changeset publish` が新バージョンを npm に出荷

feature PR 著者は **1 だけ** 担当する。**2 や 3 をローカルで触らない**。

## Pre-release (alpha) モード

このリポジトリは現在 [changesets pre-release モード](https://github.com/changesets/changesets/blob/main/docs/prereleases.md) で `alpha` タグ運用中。モードのマーカーは `.changeset/pre.json` の `"mode": "pre"`。

pre モードで知っておくべき挙動は 2 点:

1. **consumed 済み changeset の名前は `pre.json.changesets` に記録される**。pre モードを抜ける時 (`changeset pre exit`) に最終 stable リリースエントリへ再生するための仕組み。`.md` ファイルが削除された後も名前は残る。実際、pre-mode 中は consumed 済みの `.md` ファイルが `pre.json#changesets` エントリと並存したままディスクに残るのが通常状態。クリーンアップ (`.md` を削除すること) は `pre exit` 後か手動で実施され、`pre.json#changesets` が consumed 状態の正式な source of truth となる。

2. **changesets/action は `pre.json.changesets` の名前を「既に consumed 済み」とみなす**。対応する `.md` ファイルがディスク上に存在していても、pending 集合からは除外される。したがって `pre.json.changesets` にステイル登録があって `.md` が並存 → action は「No changesets found」と判定 → Version Packages PR は開かない。

## 落とし穴: `pre.json` のステイル登録

**症状**: changeset 付きの feature PR を merge した。Release workflow は走ったが `No changesets found. Attempting to publish any unpublished packages to npm` と出て、**Version Packages PR が現れない**。

**原因**: 追加した changeset の名前が `.changeset/pre.json` の `changesets` 配列に既に入っている。Release workflow は `.md` を consumed 済みと判定して skip する。

**なぜ起きるか**: 一番ありそうなのは **PR 作業中にローカルで `pnpm changeset version` (or `pnpm version-packages`) を叩いた**ケース。そのコマンドは `.changeset/` 内の新規 `.md` を処理して名前を `pre.json.changesets` に追記する。さらにその `pre.json` を code 変更や `.md` と一緒に commit してしまうと、entry と file が両方 main に乗る → 壊れた状態完成。

第二の原因として、`changeset version` を副作用的に呼ぶツールやスクリプト (or AI エージェント) が混入するケース。

**注意**: このケースは、consumed 済みの `.md` を手動削除した際に生まれる正常な ✗/✓ 状態 (`.md` なし・`pre.json#changesets` エントリあり) とは別物。後者は意図的なクリーンアップであり無害 (後述のメンタルモデル参照)。この落とし穴で問題なのは、**まだ consumed されていない `.md`** (= 対応するバージョン bump がまだ publish されていない) が不正な `pre.json#changesets` エントリによって consumed 扱いされて skip されることだ。

### やってはいけない

```bash
# feature PR 作業中にこれを叩かない
pnpm changeset version
pnpm version-packages
pnpm release
pnpm changeset pre exit
pnpm changeset pre enter
```

これらは CI の仕事 (changesets/action 経由)。feature PR 中にローカルで叩くと `pre.json` と changeset `.md` が CI で復帰不能な状態に書き換わる。

### 正しい手順

```bash
# インタラクティブに changeset を追加
pnpm changeset

# または .md を手書き
echo '---
"@ampless/admin": minor
---

短い説明。' > .changeset/my-change.md

# 何が起こるか確認 (read-only)
pnpm changeset status
```

`changeset status` は読むだけ・安全。今 `version` を走らせたらどの bump が発生するかを表示してくれる。

### 復旧手順 (既にステイル状態を merge してしまった場合)

過去に発生済み — [#135](https://github.com/heavymoons/ampless/pull/135) と [#139](https://github.com/heavymoons/ampless/pull/139)。どちらも同じ手順で復旧した。

1. Release workflow のログで症状を確認: `No changesets found`
2. `main` 上で両方の状態が並存していることを確認:
   - `.changeset/<your-slug>.md` が存在
   - `.changeset/pre.json` の `changesets` 配列に `"<your-slug>"` が含まれる
3. **`pre.json` から該当エントリを 1 行削除するだけ** の小さな修正 PR を立てる。`.md` には触らない
4. ローカルで `pnpm changeset status` を叩いて、bump が「Packages to be bumped」に表示されることを確認
5. merge する。次の Release workflow 実行時に changeset が拾われ、Version Packages PR が開く

## 落とし穴: 新規パッケージに `CHANGELOG.md` が無い

**症状**: Release workflow が `Error: ENOENT: no such file or directory, open '.../packages/<pkg>/CHANGELOG.md'` で crash。Version Packages PR body 生成のステップで発生。

**原因**: `changesets/action` は各リリース対象パッケージの `CHANGELOG.md` を読んで PR body を組み立てる。エントリが無い新規パッケージにもファイル自体は必要。

**予防**: `packages/` 配下に新パッケージを追加する時は最低限の `packages/<pkg>/CHANGELOG.md` を作る:

```markdown
# @ampless/<pkg>
```

[#136](https://github.com/heavymoons/ampless/pull/136) で検証済み。PR レビュー時に新しい `packages/<pkg>/` フォルダが出てきたら grep で確認すると安全。

## 落とし穴: 新規 plugin パッケージ追加時の配線漏れ

**症状**: 新規 `@ampless/plugin-<x>` パッケージは build / publish できているのに、`create-ampless` で scaffold したサイトに入らない、または `npx create-ampless@latest upgrade` でバージョンが追従しない、あるいは Release workflow が前述の `CHANGELOG.md` ENOENT で crash する。

**原因**: plugin 追加は 6 箇所触る必要がある。どれか 1 つでも欠けると「ほぼ ship した」状態 — npm tarball は存在するのにパイプラインの残りが「無いもの」として扱う。このリストは過去の実 fix から来ている:

- `#136` ([heavymoons/ampless#136](https://github.com/heavymoons/ampless/pull/136)) — 初回 GA4 publish が `CHANGELOG.md` 不在で crash
- `#142` ([heavymoons/ampless#142](https://github.com/heavymoons/ampless/pull/142)) — GA4 が template の `package.json` に未登録で、scaffold したサイトに永久に入らなかった

**チェックリスト** — `packages/<plugin>/` を新規追加する時:

1. **`packages/<plugin>/CHANGELOG.md`** — 最小 `# @ampless/<plugin>` を作る。**`package.json` の `files` には含めない** — npm tarball に CHANGELOG.md を入れない既存 plugin の慣習に合わせる。
2. **`packages/create-ampless/src/upgrade.ts`** — `AMPLESS_PACKAGES` set にパッケージ名を追加。`create-ampless upgrade` で後続の ampless リリースとバージョン同期される。
3. **`templates/_shared/package.json`** — `dependencies` に追加（仮 `^0.1.0-alpha.0` でよい。初回 publish 後に `scripts/sync-template-versions.mjs` が実バージョンに書き換える）。
4. **`templates/_shared/cms.config.ts`** — 既存 opt-in plugin の隣にコメントアウト済みの register 例を追加（mandatory plugin で初回から登録 ship したい場合のみスキップ）。
5. **`docs/architecture/09-plugin-distribution.md`** + `.ja.md` — first-party 一覧に追加。`trust_level` と 1 行説明を付ける。
6. **`packages/ampless/docs/plugin-author-guide.md`** + `.ja.md` — §12「参考実装」のリンク集に追加。両ファイルを `templates/_shared/docs/` 配下にコピーして scaffold 側を byte-for-byte 同期する（CI check は未実装なので人手）。

#1 を忘れると Release workflow が派手に crash、#2〜#6 は silent fail で downstream user が「なんで plugin が入らないんだ / 検索しても出ないんだ」と困った時点で初めて顕在化する。PR review 時に `packages/plugin-*/` フォルダが新規で出てきたら diff 内の `@ampless/plugin-` を grep して 6 箇所揃っているかを確認。

## 落とし穴: changeset を忘れる

**症状**: PR が merge され Release workflow も走るが、バージョン bump が起きず、下流 consumer の `npm install` に修正が届かない。

**原因**: `.changeset/` に `.md` ファイルが無い。doc-only や未公開パッケージへの変更には不要、公開パッケージのコードや README 変更には必要。

**予防**: スコープルールは [CLAUDE.md → Changeset Policy](../CLAUDE.ja.md#changeset-policy) 参照。PR が `packages/<pkg>/` に触っていたら、diff に `.changeset/*.md` が入っているかを確認する。

## メンタルモデル

pre-mode 中、changeset の名前が取りうる 4 つの状態:

| `.md` 存在 | `pre.json#changesets` エントリ | 意味 |
|---|---|---|
| ✓ | ✗ | **queued** — 未 consumed。次の Version Packages サイクルで拾われる |
| ✓ | ✓ | **consumed** — pre-mode 中の通常状態。`.md` は `pre.json` エントリと並存したままディスクに残る |
| ✗ | ✓ | **consumed-and-cleaned-up** — 手動クリーンアップ後の正常状態。consumed 後に `.md` を手動削除した |
| ✗ | ✗ | **unknown** — どこにも追跡されていない。タイポか consumed 前に削除されたエントリの可能性 |

`pre.json#changesets` 配列が consumed 状態の正式な source of truth。feature PR 著者は `.md` ファイルを追加するだけ (queued 状態を作るだけ)。それ以外は全部 CI が担当する。

## アルファ → ベータ プレリリースへの切り替え

alpha → beta 移行とは、ampless の npm dist-tag を `alpha` から `beta` に切り替え、GitHub リポジトリを public 化し、外部インストールを受け入れ始める瞬間のこと ([リリース戦略](./architecture/14-roadmap.md) 参照)。**一度行ったら元に戻せない操作**。慎重に計画すること。

### 事前確認チェックリスト

切り替えを開始する前に、以下をすべて確認する:

- [ ] public-flip 向けドキュメントが merge 済み (README scrub、Community files、
      Positioning pivot — git log の PR #240、#242、#243、#244 周辺を参照)
- [ ] **意図的な beta changeset を手動で queue する必要はない** —
      flip workflow が kickoff changeset (`.changeset/beta-kickoff-<tag>.md`、
      `ampless: patch`、"First beta cut") を `pnpm version-packages` の直前に自動生成する。
      手動で事前 queue **しない**こと: alpha Version Packages パイプラインと race して
      silent に消費される可能性がある。
      `sync-dist-tag.mjs` にはバージョン-prerelease 整合ガードが組み込まれており、
      flip 後は `package.json` バージョンの prerelease 識別子が `pre.json.tag` と一致する
      パッケージ (= `1.0.0-beta.<N>` に bump 済み) にのみ `beta` dist-tag を再設定する。
      `1.0.0-alpha.<N>` のままのパッケージは warn ログ付きで skip され、誤ってタグ付けされない。
      したがって "partial beta cut" は安全 — bump されたパッケージだけが `beta` に移行し、
      それ以外は次の cut で bump されるまで既存の `alpha` タグのまま残る。
- [ ] 最初の beta cut に含めたくない queued `.changeset/*.md` がない (`pnpm changeset status` で確認)
- [ ] 未 merge の "Version Packages (alpha)" PR がない — 先に merge か close する
- [ ] dogfood サイト (例: ishinao.net) が最新の `@alpha` で正常稼働中。
      既知の正常な `@alpha` tarball へのロールバック手順を頭の中で確認済み
- [ ] 切り替え + publish workflow の監視に ~30 分の集中時間がある

### なぜ CI-only 操作なのか

`pnpm changeset pre exit` と `pnpm changeset pre enter beta` は `.changeset/pre.json` を書き換える。
feature PR 中 (または調整されていないコンテキスト) でこれらをローカルで実行すると、bump がサイレントに
失われる — [落とし穴: pre.json のステイル登録](#落とし穴-prejson-のステイル登録) と CLAUDE.md の
`## Changeset Policy` (過去の事例 #135、#139) を参照。

したがって flip は feature ブランチのローカル編集としてではなく、`main` 上での調整済みオペレーションとして実行する。

### 解決済み決定事項 (旧「2 つの未解決問題」)

Prep PR では未確定だったが、どちらも `.github/workflows/flip-prerelease.yml` に実装済みで確定した。

#### A. exit/enter のシーケンス — 決定: アトミック workflow + [skip ci]

**採用したアプローチ**: `.github/workflows/flip-prerelease.yml` — 以下すべてを単一のアトミック
`workflow_dispatch` job で実行することで、`pre exit` と `pre enter` の間に `changesets/action`
が stray `version` を実行する隙を完全になくす:

1. `pnpm changeset pre exit`
2. `pnpm changeset pre enter <tag>`
3. kickoff changeset を自動生成 (`beta-kickoff-<tag>.md`)
4. `pnpm version-packages` (エイリアス — template-version-sync を含む)
5. `git commit -m "chore: flip prerelease to <tag> [skip ci]" && git push origin HEAD:main`
6. `pnpm release` (エイリアス — pre-publish build を含む)
7. パッケージタグの 3 段 reconcile + 明示的 push (名前指定、`--tags` 不使用)
8. `.npmrc` 書き直し + `node scripts/sync-dist-tag.mjs`

**二重再トリガー抑制** (2 層の独立した対策):

- 主対策: GITHUB_TOKEN による push は GitHub プラットフォーム仕様で push-based workflow を
  トリガーしないため、flip commit で `release.yml` は起動しない。`release.yml` は**無変更**
  — `if:` ガードも不要。
- ベルト+サスペンダー: commit message に `[skip ci]` を含める。

#### B. pre カウンター — 決定: 連続性を受け入れる

beta に移行しても alpha の pre カウンターは**リセットしない**。最初の beta cut は
`1.0.0-beta.<N+1>` (各パッケージの最新 alpha カウンターの次の整数) から始まる。
これは semver として有効; CHANGELOG の `alpha.<N>` から `beta.<N+1>` へのジャンプは
見た目が奇妙に見えるが正確。カスタムリセットツールは導入しない。
alpha → beta の移行はリリースノートで明示的に説明する。

### flip の実行手順

flip は 2 フェーズの dispatch で行う: まず dry-run で確認し、次に本番 flip。

**フェーズ 1 — dry-run**

**main** から (feature ブランチからではなく) `.github/workflows/flip-prerelease.yml` を dispatch:

```
tag:     beta
mode:    dry-run
confirm: (空のまま)
```

実行完了後、`flip-preview` artifact をダウンロードして確認:

- `version-diff.patch`: `pre.json` が `{mode: "pre", tag: "beta"}` になっていること;
  kickoff changeset と queued alpha changeset で bump されたパッケージが
  `1.0.0-alpha.N` から `1.0.0-beta.N+1` に移行していること;
  `templates/_shared/package.json` のピン留めバージョンが更新されていること。
- **`CHANGELOG.md` の diff が新規エントリ (kickoff changeset + 本当に pending の
  changeset) だけを含むこと**。出荷済みの alpha 期の変更が再掲されている場合
  (= `pre exit` / `pre enter` のサイクルで consumed-changesets の記録が落ち、
  `version` が蓄積された alpha `.md` を再適用した)、**本番 flip を実行しない**。
  この failure mode は全 CHANGELOG に alpha エントリを重複させ過剰 bump を生む —
  解消 (例: 同 workflow step で consumed 済 alpha `.md` の削除を追加し、再度
  dry-run で検証) してから進める。
- `status.txt`: 変更ファイルに予期しないものが含まれていないこと。
- pending changeset がないパッケージは alpha のまま残る — 正常 (`sync-dist-tag.mjs` がスキップする)。

**フェーズ 2 — 本番 flip**

dry-run の diff に問題がなければ、以下で再 dispatch:

```
tag:     beta
mode:    flip
confirm: flip-to-beta
```

workflow がバージョン bump を main に commit し、npm に publish し、パッケージタグを push し、
`beta` dist-tag を sync する。

**flip 後の確認コマンド**

```sh
npm view ampless@beta version        # 1.0.0-beta.<N> になっているはず
npm view ampless@alpha version       # 最後の alpha で凍結済; 今後は動かない
npm view ampless@latest version      # only-pre packages は beta と同じになる場合がある
gh run list --workflow=release.yml   # 次の通常 push で release.yml が正常に動くことを確認
```

**npm provenance** はこの workflow では**有効化しない**。Provenance には public GitHub
source repository が必要。repo の public 化は GitHub Settings での手動操作であり、この
workflow の範囲外。repo が public になった後、別の follow-up PR で
`.github/workflows/release.yml` の `NPM_CONFIG_PROVENANCE: true` を un-comment して有効化する。

### 部分 flip の復旧手順

flip commit の main への push (workflow の手順 1〜5) は成功したが、publish / tag push /
dist-tag sync のどこかで失敗した場合、リポジトリはすでに beta 状態 (`pre.json.tag == "beta"`)
になっているが npm はまだ更新されていない。`mode=flip` で再 dispatch しても pre-flight チェック
(「pre.json.tag がすでに 'beta'」) で弾かれる。

`mode=publish-only` で復旧する:

```
tag:     beta
mode:    publish-only
confirm: flip-to-beta
```

`publish-only` は `pre exit` / `pre enter` / kickoff / version / commit をすべてスキップし、
`pnpm release` → タグ reconcile → dist-tag sync だけを再実行する。3 つのステップはすべて冪等:

- `changeset publish`: npm に既にある version はスキップ。
- タグ reconcile: リモートに既にあるタグはスキップ。
- `sync-dist-tag.mjs`: dist-tag が既に正しいバージョンを指している場合は no-op。

`publish-only` の pre-flight は `pre.json.tag == requested tag` を要求する (flip チェックと
逆向き)。これにより「flip commit 済みの復旧シナリオ」であることを確認し、誤った二重 flip を
構造的に防ぐ。

### flip 時に変わるもの

- `.changeset/pre.json#tag`: `"alpha"` → `"beta"`。`flip-prerelease.yml` workflow の
  `pre exit && pre enter beta` によってアトミックに処理される。別途 commit や PR にしない。
- リポジトリ可視性: GitHub Settings → Public に変更 (Settings → Security →
  Private vulnerability reporting → Enable の後に実施)。workflow の範囲外の手動操作。
- `.github/workflows/release.yml`: **repo が public になった後に**
  `NPM_CONFIG_PROVENANCE` を un-comment して有効化する (provenance には public repo が必要;
  flip workflow の範囲外 — follow-up PR で対応する)。
- `README.md` + `.ja.md`: `@alpha` を使うインストールコマンドはそのままにするか `@beta` に
  変更するか (エンジニアの判断 — `@alpha` の最後に publish された tarball は `pre exit` 後も
  `sync-dist-tag.mjs` によってピン留めされたまま残る)
- `CLAUDE.md`: `## Status` セクションで現在のステージを反映する 1 行更新が必要かもしれない (alpha → beta)
- `docs/architecture/14-roadmap.md`: 変更不要 (4 段階パスのフレームはステージ非依存)

### flip 時に変わらないもの

- `scripts/sync-dist-tag.mjs`: `pre.json.tag` を読むため、`pre.json.tag` が flip されると
  自動的に新しいタグを検出する
- `scripts/sync-template-versions.mjs`: 変更なし
- `.changeset/config.json`: `access: "public"` は既に設定済み

### ロールバック手順

beta cut で壊れたものが publish された場合、既存の alpha tarball は
`npm i ampless@1.0.0-alpha.<some-N>` で引き続きインストール可能 (既に publish 済みの
alpha バージョンのどれでも)。dist-tag を既知の正常な alpha に戻すには
`npm dist-tag add ampless@1.0.0-alpha.<known-good-version> alpha`。データ損失なし;
npm の publish は immutable。最後に正常だったバージョンは
`npm view ampless versions --json | tail -20` で確認し、本番 dogfood のデプロイログと照合する。

## 困った時

- `pnpm changeset status` — 読み取り専用、安全
- `gh run list --workflow=release.yml --limit 5` — main への push ごとに CI が何を見たかを確認
- `gh run view <id> --log-failed` — 失敗 run のログ
- ローカルで `pnpm changeset version` 系を叩かない
