---
status: 'accepted'
date: 2026-10-28
decision-makers: 'Hol1kgmg'
---

# 派生リポジトリにテンプレート取り込みの draft PR を週次で用意し、重複する Dependabot PR を閉じる

## Context and Problem Statement

[ADR 0005](0005-separate-template-and-project-files.md) と同じく、テンプレートの更新を派生リポジトリへ円滑に取り込めるようにすることが目的である。

[ADR 0001](0001-sync-template-via-merge-commit.md) は、派生リポジトリが手元の `just sync` でテンプレートを取り込むと決めた。取り込みを起動するのは人なので、気づかなければテンプレートの更新が派生リポジトリに届かない。[ADR 0005](0005-separate-template-and-project-files.md) で宣言ファイルの衝突はなくなったが、`flake.lock` の衝突は解消方法が決まっていない。

`flake.lock` の衝突には 2 つの原因がある。

- `dependabot.yml` はテンプレートと共通なので、派生リポジトリの Dependabot もテンプレートの input を更新する。テンプレート側の更新と同じ node が変わる
- 派生リポジトリが project inputs を足すと、`root.inputs` と `nodes` で、テンプレートが input を足したときの変更と隣接する行が変わる

自動化の制約は次の 4 つである。

- 派生リポジトリでは auto-merge しない。取り込む内容は各リポジトリで人が判断する
- 同じ差分の PR を 2 本レビューしない。派生リポジトリの Dependabot は、取り込みの前でもテンプレートの input を更新する PR を作る
- GitHub App も PAT も使わない。派生リポジトリごとの構築の手間、鍵の管理、`Workflows` 権限を持つ鍵が漏れたときの影響を避ける
- `GITHUB_TOKEN` では workflow ファイルを変更するコミットを push できず、`GITHUB_TOKEN` で作った PR では `ci.yaml` が動かない。テンプレートから生成したリポジトリは fork ではないので、テンプレートのブランチを head にした PR も作れない

## Decision

派生リポジトリで次の 3 つを組み合わせる。workflow はどれもテンプレートリポジトリ（`Hol1kgmg/claude-temp`）では動かさず、書き込みには `GITHUB_TOKEN` だけを使う。

1. **重複する Dependabot PR を閉じる**（`template-dependabot-close` workflow）
   - nix: 変更された root input がすべて upstream の `flake.lock` の root input に含まれていれば、PR を閉じる
   - github-actions: 変更されたファイルがすべて upstream に存在し、更新される action がすべて upstream の同じファイルで使われていれば、PR を閉じる
   - project inputs や派生リポジトリ独自の workflow を含む PR は閉じず、人がレビューする
2. **取り込みを促す draft PR を週次で用意する**（`template-sync` workflow）
   - 毎週土曜 09:00 JST に実行する。テンプレートの Dependabot は nix・github-actions とも土曜 08:00 JST に実行し、ツール系の更新は auto-merge される。終わっていなくても、取り込みの時点で 3 の確認が止める
   - `main..upstream/main` にコミットがなければ何もしない
   - `template-sync` ブランチがなければ、main から作って空のコミットを 1 つ push し、draft PR を作る。空のコミットは workflow ファイルを変更しないので、`GITHUB_TOKEN` で push できる
   - `template-sync` の PR が開いていれば何もしない。PR の中身と本文は人が扱うものとし、それより新しい更新はマージ後の次回に届ける
   - PR がマージされずに閉じられても、次回また draft PR を作る。取り込みを見送っても、未取り込みであることは知らせ続ける
   - 本文には作成時点の upstream との比較リンク、変更されたファイルの一覧、`just sync-pr` の実行手順を書く
   - Nix は実行しない
3. **取り込みは人が手元の `just sync-pr` で行う**
   - テンプレートに open の Dependabot PR が残っていれば止める。処理途中の upstream を取り込まないため。`SYNC_IGNORE_OPEN_PRS=1` で無視できる。`just sync` でも同じ確認をする
   - `template-sync` を main から作り直して `just sync` を実行し、force push して PR を ready for review にする
   - 人の認証で push するので、workflow ファイルの変更も push でき、`ci.yaml` も動く
   - `flake.lock` の衝突は `scripts/resolve-flake-lock.sh` が input 単位で解消する。テンプレート側の lock を採用し、project inputs の node だけを派生リポジトリ側から書き戻す。project inputs は、派生リポジトリ側の root にあり、テンプレート側にも merge-base にもない input とする
   - 書き戻せるのは `flake = false` の input だけとする。flake の input があれば解消せずに止める。lock を作り直すと project inputs が更新され、Dependabot PR と重複するため
   - `flake.lock` 以外も衝突していれば止め、手で解消する
   - PR はマージコミットでマージする

`ci.yaml` は `nix flake check --no-update-lock-file` にし、`flake.nix` と `flake.lock` のずれを失敗として検出する。

## Consequences

- Good, because テンプレートが更新されると、毎週 PR の一覧に取り込み待ちとして表示される
- Good, because 派生リポジトリで人がレビューするのは、取り込み PR（テンプレートの input）と Dependabot PR（project inputs）だけになり、同じ差分を 2 回レビューしない
- Good, because `flake.lock` の衝突の大半が自動で解消される。テンプレートの input を派生リポジトリで変えるのが取り込みだけになるため
- Good, because 新しい秘密情報が増えない。workflow が持つ書き込み権限は、そのリポジトリの `GITHUB_TOKEN` に限られる
- Bad, because 取り込みには人の操作（`just sync-pr` の実行）が残る。auto-merge をしない以上、レビューとマージにも人が要るので、増える操作はコマンド 1 回である
- Bad, because 派生リポジトリごとに「Allow GitHub Actions to create and approve pull requests」を有効にする設定が要る。新しいリポジトリでは既定で無効になっている
- Bad, because 公開リポジトリで 60 日間活動がないと、GitHub の仕様で schedule の workflow が無効になり、draft PR が届かなくなる。触らないリポジトリでは通知が止まることを受け入れ、再開は `gh workflow enable template-sync` で行う
- Bad, because 閉じた Dependabot PR は、次の版が出ると作り直され、そのたびに閉じられる。レビューは要らないが通知は届く
- Bad, because テンプレートの input をテンプレートより先に上げられない。ツール系はテンプレートで auto-merge されるので、待つのは次の取り込みまでである
- Bad, because 1 つの action をテンプレートの workflow と独自の workflow の両方で使っていると、github-actions の Dependabot PR は閉じられず、テンプレート分を重複してレビューする
- Bad, because テンプレート由来の workflow ファイルに派生リポジトリが action を足すと、その action を含む Dependabot PR は閉じられず、同じ PR のテンプレート分も重複してレビューする。閉じるとその action の更新がどこからも届かなくなるため
- Bad, because テンプレートで skill / rules の Dependabot PR を放置すると、派生リポジトリの `just sync` が止まり続ける。`SYNC_IGNORE_OPEN_PRS=1` で回避できる
- Bad, because `just sync-pr` は `template-sync` を毎回作り直すので、このブランチに手で積んだコミット（衝突の手動解消など）は再実行すると消える

## Implementation Plan

- **Affected paths**: `.github/workflows/template-sync.yaml`（新規）、`.github/workflows/template-dependabot-close.yaml`（新規）、`scripts/resolve-flake-lock.sh`（新規）、`.github/workflows/ci.yaml`、`.github/dependabot.yml`、`justfile`（`sync` と `sync-pr`）、`flake.nix`（devShell に `jq`）、`README.md`、`skills/init-from-template/SKILL.md`、`adr/from-template/0005-separate-template-and-project-files.md`
- **Patterns to follow**:
  - 派生リポジトリ用の workflow は `if: github.repository != 'Hol1kgmg/claude-temp'` で止める
  - workflow の `permissions` は、使う権限だけを書く
  - action はコミット SHA で固定する
  - 「Allow GitHub Actions to create and approve pull requests」は `init-from-template` の手順で `gh api` から有効にする
- **Patterns to avoid**:
  - 派生リポジトリでの auto-merge
  - GitHub App や PAT の導入
  - 取り込み PR の squash / rebase マージ（0001 の共通祖先が失われる）
  - 衝突解消での `nix flake lock` による lock の作り直し

### Verification

- [ ] 検証用の派生リポジトリで、テンプレートの input だけを更新する Dependabot PR が閉じられる
- [ ] project inputs を更新する Dependabot PR は閉じられない
- [ ] テンプレート由来の workflow ファイルに派生リポジトリが足した action を更新する Dependabot PR は閉じられない
- [ ] upstream が進んでいると、空のコミットだけを含む draft PR が作られる。PR が開いている間の実行では何も変わらない
- [ ] upstream が進んでいなければ、PR は作られない
- [ ] `flake.lock` だけが衝突する状態で `just sync-pr` が成功し、`check` が通る
- [ ] `flake.lock` 以外も衝突する状態で、`just sync-pr` が止まる
- [ ] テンプレートに open の Dependabot PR があると、`just sync-pr` が `template-sync` に切り替える前に止まる

## Alternatives Considered

- **GitHub App のトークンで、差分を含む取り込み PR を作る**: 人の操作はレビューとマージだけになるが、派生リポジトリごとに App のインストールと Secrets の登録が要り、`Workflows` 権限を持つ鍵を管理することになる。auto-merge をしないので、減るのはコマンド 1 回だけである
- **`GITHUB_TOKEN` で差分を含む取り込み PR を作る**: upstream の変更に workflow ファイルが含まれると push できない。テンプレートでは github-actions の Dependabot が毎月 SHA を更新するので、少なくとも月 1 回は手作業に戻る
- **Issue で通知する**: draft PR と同じく App は要らないが、取り込みの作業が Issue と PR に分かれる
- **Dependabot PR を閉じない**: 同じ input の PR が 2 本でき、`flake.lock` の衝突も残る
- **衝突時にテンプレート側の lock を採用して `nix flake lock` する**: project inputs が最新版で lock し直される。skill の取得元がレビューなしで更新され、[ADR 0003](0003-update-skill-sources-via-dependabot.md) に反する

## More Information

- 一部置き換え: [テンプレート元の変更を手動のマージコミットで取り込む](0001-sync-template-via-merge-commit.md)（取り込みに気づく手段を人に委ねる、の部分）
- 前提: [テンプレート管理と派生先管理の宣言を別ファイル・別区画に分ける](0005-separate-template-and-project-files.md)
- 関連: [skill / rules 以外の Dependabot PR を auto-merge する](0004-auto-merge-non-skill-dependabot-prs.md)
- 再検討条件: 取り込み PR の auto-merge を許容する、Organization に移って Secrets と App を一か所で管理できる、手元で開発しない人だけが管理する派生リポジトリができる、のどれかに当てはまったら、GitHub App の採用を再検討する
