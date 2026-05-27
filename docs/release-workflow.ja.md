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
   - `.md` ファイルは consumed (削除され、名前が `.changeset/pre.json` の `changesets: []` に記録される)
   - merge で Release workflow が再走、`changeset publish` が新バージョンを npm に出荷

feature PR 著者は **1 だけ** 担当する。**2 や 3 をローカルで触らない**。

## Pre-release (alpha) モード

このリポジトリは現在 [changesets pre-release モード](https://github.com/changesets/changesets/blob/main/docs/prereleases.md) で `alpha` タグ運用中。モードのマーカーは `.changeset/pre.json` の `"mode": "pre"`。

pre モードで知っておくべき挙動は 2 点:

1. **consumed 済み changeset の名前は `pre.json.changesets` に記録される**。pre モードを抜ける時 (`changeset pre exit`) に最終 stable リリースエントリへ再生するための仕組み。`.md` ファイルが削除された後も名前は残る。

2. **changesets/action は `pre.json.changesets` の名前を「既に consumed 済み」とみなす**。対応する `.md` ファイルがディスク上に存在していても、pending 集合からは除外される。したがって `pre.json.changesets` にステイル登録があって `.md` が並存 → action は「No changesets found」と判定 → Version Packages PR は開かない。

## 落とし穴: `pre.json` のステイル登録

**症状**: changeset 付きの feature PR を merge した。Release workflow は走ったが `No changesets found. Attempting to publish any unpublished packages to npm` と出て、**Version Packages PR が現れない**。

**原因**: 追加した changeset の名前が `.changeset/pre.json` の `changesets` 配列に既に入っている。Release workflow は `.md` を consumed 済みと判定して skip する。

**なぜ起きるか**: 一番ありそうなのは **PR 作業中にローカルで `pnpm changeset version` (or `pnpm version-packages`) を叩いた**ケース。そのコマンドは `.changeset/` 内の新規 `.md` を処理して名前を `pre.json.changesets` に追記する。さらにその `pre.json` を code 変更や `.md` と一緒に commit してしまうと、entry と file が両方 main に乗る → 壊れた状態完成。

第二の原因として、`changeset version` を副作用的に呼ぶツールやスクリプト (or AI エージェント) が混入するケース。

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

- `.changeset/*.md` (`pre.json` / `config.json` / `README.md` 以外) = 未適用の pending bump
- `.changeset/pre.json.changesets` = 適用済みの bump (pre モードでのみ意味あり)
- ある名前は **必ずどちらか片方だけ** に存在する。両方には入らないし、bump したいなら片方には必ず居る
- feature PR 著者は `.md` を追加するだけ。それ以外は全部 CI

## 困った時

- `pnpm changeset status` — 読み取り専用、安全
- `gh run list --workflow=release.yml --limit 5` — main への push ごとに CI が何を見たかを確認
- `gh run view <id> --log-failed` — 失敗 run のログ
- ローカルで `pnpm changeset version` 系を叩かない
