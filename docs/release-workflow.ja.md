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
- [ ] **最初の beta cut がすべての public workspace package をカバーしている** —
      個別の queued changeset か、全パッケージを bump する 1 つの `.changeset/*.md` で。
      これが重要なのは、flip 後の `sync-dist-tag.mjs` が各パッケージの `package.json`
      バージョンを元に **すべての** public workspace package に対して `beta` dist-tag を
      再設定するから。beta バージョン bump を受けていないパッケージがあると、その
      `package.json` は `1.0.0-alpha.<N>` のままで、`sync-dist-tag.mjs` がそのパッケージの
      `beta` dist-tag を alpha 版 tarball に誤って向けてしまう — consumer にとって混乱を
      招き、ワークスペース全体との整合性も壊れる。

      代替案: `sync-dist-tag.mjs` を強化して、**`package.json` バージョンの prerelease 識別子が
      `pre.json.tag` と一致するパッケージだけを sync する** (例: `pre.json.tag === "beta"` のとき
      `1.0.0-alpha.<N>` のままのパッケージはスキップ)。これにより "partial beta cut" が安全になる。
      **Prep PR の `sync-dist-tag.mjs` 設計にはこのガードが含まれている** (この懸念から追加)。
      ガードがあれば、このチェックリスト項目は「少なくとも 1 つの意図的な beta changeset」に
      軟化する。ガードなしの場合はすべてのパッケージを bump する必要がある。
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

### flip 時に解決すべき 2 つの未解決問題 (この Prep PR では決めない)

#### A. exit/enter のシーケンス — 意図しない `1.0.0` publish を防ぐ

素朴な手順は `pre exit && pre enter beta`。注意点: この 2 コマンドの間に `pnpm changeset version`
が走ると (例: `main` への push で `changesets/action` が動く)、pre-suffix がその場で剥がれて
本物の `1.0.0` リリース PR が生まれる。その中間的な `1.0.0` の publish は **望ましくない**。

候補となる手順 (いずれも本番 flip の前に fork で検証が必要):

1. **アトミック operational workflow** (スケッチ): `changesets/action` が途中で stray `version`
   を実行できないよう、以下すべてを単一 job で走らせる `workflow_dispatch` ワークフローを追加する。
   **既存の `package.json` スクリプトエイリアス** (`version-packages` / `release`) を
   直接の `changeset version` / `changeset publish` コールより優先して使う — 既存エイリアスは
   `scripts/sync-template-versions.mjs` と `turbo run build` をラップしており、バイパスすると
   template-version-sync やビルド前処理なしで publish されてしまう:
   1. `pnpm changeset pre exit` (`.changeset/pre.json` を変更)
   2. `pnpm changeset pre enter beta` (`.changeset/pre.json` を変更)
   3. **`pnpm version-packages`** — 既存エイリアスは
      `changeset version && node scripts/sync-template-versions.mjs &&
      changeset version` ([package.json:14](../package.json#L14));
      `version` を 1 回実行して changeset からパッケージを bump し、
      template-version sync で `templates/_shared/package.json` のピン留めバージョンを更新し、
      さらに `version` を再実行して前のステップが emit した auto-sync changeset を吸収する。
      このエイリアスを使うことで既存の template-pin 不変条件が保たれる。
   4. **`git add -A && git commit -m "<release.yml ガードに合わせたメッセージ>" && git push origin HEAD:main`**
      (GitHub Actions の checkout は通常 detached HEAD になるため、`HEAD:main` という明示的な
      refspec でプッシュ先を明確にする)
      (例: 抑制方法が commit message の `[skip ci]` なら `"chore: flip alpha → beta [skip ci]"`;
      `release.yml` の `head_commit.message` が同じフレーズと一致する `if:` ガードなら
      `"chore: flip alpha → beta"`)。このコミット/プッシュがないと、ワークフローは npm を
      リポジトリ状態より先に進めたまま終わる (= 次の `changesets/action` run が stale なローカル
      状態を見て、stale な VP PR を再度開くか、サイレントに二重 bump する)。`contents: write`
      権限を持つ deploy key / PAT を使うこと。commit message のフレーズと `release.yml` ガードは
      二重トリガーを実際に抑制するために **一貫したペアとして記述する必要がある**。
   5. **`pnpm release`** — 既存エイリアスは `turbo run build &&
      changeset publish` ([package.json:16](../package.json#L16));
      ワークスペース全体をビルドし (`changeset publish` は既存のビルド成果物を publish するだけで
      ビルドは行わないため必要)、beta バージョンの tarball を npm に publish する。
      **注意**: pre mode では、これまで stable release がない "only-pre packages" は
      `npm publish --tag latest` がデフォルトになり、pre-mode タグ (`alpha` / `beta`) ではなく
      `latest` に push される。これがまさに `sync-dist-tag.mjs` が存在する理由で、
      publish 後に正しい pre-mode タグを再設定する。以下のステップ 6 がこれを担う。
   6. `node scripts/sync-dist-tag.mjs` が **一致する public workspace packages** に対して
      `beta` dist-tag を再設定する (リネームされたスクリプトは `pre.json.tag` を読み — 現在は
      `"beta"` — `package.json` バージョンの prerelease 識別子が一致しないパッケージをスキップする
      — まだ alpha のパッケージは warn ログとともにスキップされ、誤ってタグが付くことはない)。
   7. **`pnpm changeset publish` が作成した git タグをプッシュする**。
      Changesets の CLI は publish したパッケージごとに `<pkg-name>@<version>` タグをローカルに
      作成する (scope を含む完全な npm 名を使用 — 例: `ampless@1.0.0-beta.<N>`、
      `@ampless/runtime@1.0.0-beta.<N>`、`create-ampless@1.0.0-beta.<N>`)
      が、**リモートにはプッシュしない**。このステップがないと GitHub Releases が beta cut の
      ものを表示せず、`git tag` イベントを監視する downstream ツール (例: リリースノート生成器)
      も何も受け取れない。以下のどちらかを使う:
      - `git push origin --follow-tags HEAD:main` (ブランチと到達可能な annotated タグを
        同時にプッシュする 1 コマンド; ステップ 4 の detached-HEAD 形状と合う)
      - またはタグを個別にプッシュ:
        作成されたタグそれぞれに `git push origin <pkg-name>@<version>`
      パッケージごとのタグをまったく作りたくない場合は `changeset publish` に直接
      `--no-git-tag` を渡す必要がある。ステップ 5 で使う `pnpm release` エイリアス
      (= `turbo run build && changeset publish`、[package.json:16](../package.json#L16)) は
      `changeset publish` に追加引数を転送しない (pnpm スクリプトエイリアスの arg-forwarding は
      扱いが難しく、ここでは使っていない)。そのため正確な代替コマンドは:

      ```sh
      pnpm build && pnpm changeset publish --no-git-tag
      ```

      (= `pnpm release` を、publish ステップだけを no-tag バリアントに置き換えて実行。)
      この選択肢を取る場合は flip PR にその旨を記録する。デフォルト動作はタグを作成するので、
      no-tag バリアントを明示しない限りステップ 7 のプッシュが必要になる。

   通常の `release.yml` の二重トリガーを抑制するには: commit message に `[skip ci]` を含める、
   `release.yml` に `if: !contains(github.event.head_commit.message, 'flip alpha → beta')` ガードを追加する、
   または手動 dispatch の間だけ `release.yml` を一時無効化する (あまりスマートではない)。
   Prep PR ではどれかを決めない; flip PR で決定する。
2. **`pre.json` 直接編集**: `pre.json.tag` を `"alpha"` から `"beta"` に変更する 1 行 PR。
   pre-mode のまま留まる (exit/enter の落とし穴を完全に回避)。Changesets は公式にこの手法を
   文書化していないが、カウンターロジックは `tag` だけを参照するため実際には動作する。非公式な手法ではある。

#### B. pre カウンターは `pre enter beta` でリセットされない

上記どちらの手順でも alpha の pre カウンターを引き継ぐ。今の `ampless` `@alpha` が
`1.0.0-alpha.N` なら、カウンターリセットなしの beta cut 後の最初の beta publish は
おおよそ `1.0.0-beta.N+1` (同じカウンターの次の整数) になり、`1.0.0-beta.0` には **ならない**。
パッケージごとにカウンターが異なる (`create-ampless` は template auto-sync のため `ampless` より
大幅に高い); それぞれが自分自身の最新 alpha `N` から独立して継続する。

技術的には semver として有効: pre-release 識別子はドット区切りセグメントごとに辞書順で比較され、
整数の連続性は純粋に見た目の問題 — 同じパッケージが同じ `-beta.N` を 2 回 publish することはない。
しかし CHANGELOG.md では最後の `alpha.<some-N>` から `beta.<N+1>` へ飛ぶことになり、読者が
混乱するかもしれない。

選択肢 (flip 時に決定):

- **連続性を受け入れる** (見た目が重要でない限り推奨): `1.0.0-beta.<N+1>` を publish し
  (`N` はそのパッケージの最新 alpha カウンター)、CHANGELOG にジャンプの旨を記述する。
  リリースノートで alpha → beta の移行を明示的に説明できる。
- **カウンターを 0 にリセットする**: カスタムツールが必要 (`pre.json.changesets` 配列から
  alpha エントリを削除するか、`pre enter beta` の前にすべてのパッケージの `package.json` の
  `version` を `1.0.0-alpha.N` から `1.0.0-beta.0` に手動 bump する)。どちらも手作業で
  エラーが起きやすい。見た目が強く重要な場合のみ検討する価値がある。

Prep PR (この PR) では A も B も確定しない; flip PR を作成する際に — できれば throwaway fork で
テストしてから — 両方を詳細化する。

### flip 時に変わるもの

- `.github/workflows/release.yml`: `NPM_CONFIG_PROVENANCE` をコメントアウトから有効化
  (provenance には public repo が必要)
- リポジトリ可視性: GitHub Settings → Public に変更 (Settings → Security →
  Private vulnerability reporting → Enable の後に実施)
- `README.md` + `.ja.md`: `@alpha` を使うインストールコマンドはそのままにするか `@beta` に
  変更するか (エンジニアの判断 — `@alpha` の最後に publish された tarball は `pre exit` 後も
  `sync-dist-tag.mjs` によってピン留めされたまま残る)
- `CLAUDE.md`: `## Status` セクションで現在のステージを反映する 1 行更新が必要かもしれない (alpha → beta)
- `docs/architecture/14-roadmap.md`: 変更不要 (4 段階パスのフレームはステージ非依存)
- `.changeset/pre.json#tag`: `"alpha"` → `"beta"`。**正確な仕組みは上記 §A で選択した flip の
  形状に依存する**: atomic workflow 形状では `pre exit && pre enter beta` が同一ワークフロー run
  内で暗黙的にこれを行う; 直接編集形状では `pre.json#tag` を編集する 1 行 PR (no `pre exit` /
  `pre enter` 不要)。どちらの場合も編集は flip の残りとセットで行う — 単独の変更としては行わない。

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
