---
name: template-sync-review
description: Hol1kgmg/claude-temp から生成した派生リポジトリで、template-sync workflow が作ったテンプレート取り込み PR（template-sync ブランチ）に対応する。draft なら just sync-pr で差分を入れ、衝突があれば解消を手伝い、CI・変更内容・flake.lock の input の変化をレビューして報告する。マージはユーザーが明示的に指示したときだけ、マージコミットで行う。「取り込み PR を見て」「template-sync の PR を対応して」「sync-pr して」と言われたときに使う。
allowed-tools: Bash(git remote get-url:*), Bash(git status:*), Bash(git branch --show-current), Bash(git fetch:*), Bash(git diff:*), Bash(git show:*), Bash(git log:*), Bash(git merge-base:*), Bash(git rev-parse:*), Bash(git add:*), Bash(git commit --no-edit), Bash(git switch:*), Bash(just sync-pr), Bash(SYNC_IGNORE_OPEN_PRS=1 just sync-pr), Bash(just _sync-pr-open), Bash(gh repo set-default:*), Bash(gh pr list:*), Bash(gh pr view:*), Bash(gh pr diff:*), Bash(gh pr checks:*), Bash(gh pr merge:*), Bash(gh pr close:*), Bash(jq:*), Read, Edit, Grep, Glob, AskUserQuestion
---

# template-sync-review — テンプレート取り込み PR の対応

`template-sync` workflow は、テンプレート元（`Hol1kgmg/claude-temp`）に未取り込みの更新があると、空コミットだけを含む draft PR を `template-sync` ブランチで作る。このスキルは、その PR に差分を入れ、レビューし、指示があればマージするまでを扱う。

前提となる決定は派生リポジトリの `adr/from-template/` にある。

- `0001`: 取り込みはマージコミットで行う。squash / rebase は共通祖先を壊し、次回以降ツリー全体が衝突する
- `0006`: 差分は人が `just sync-pr` で入れる。PR の本文は人のものなので書き換えない

**`gh pr merge` / `gh pr close` は、ユーザーが明示的に指示するまで実行しない。**

## 手順

### 1. ガード

```bash
git remote get-url origin
```

`Hol1kgmg/claude-temp` 自身なら中断する（テンプレート本体では workflow が動かない）。

`upstream` remote があると gh は origin より upstream を既定の repo に選ぶ。以降の gh が派生リポジトリを向くよう、既定を確認する。

```bash
gh repo set-default --view
```

origin の `<owner>/<repo>` と違う、または未設定なら `gh repo set-default <owner>/<repo>` で origin に固定し、変更したことを報告する。

### 2. 取り込み PR を探す

```bash
gh pr list --head template-sync --state open --json number,isDraft,title,url
```

- 0 件なら「取り込み待ちの PR はない」と報告して終了する
- `isDraft` が `true` なら手順 3、`false` なら手順 4 へ進む

### 3. 差分を入れる（draft のとき）

```bash
git status --porcelain
git branch --show-current
```

作業ツリーが clean でなければ中断する（コミットまたは退避してもらう）。今のブランチ名を控えておく（衝突時に戻るため）。

```bash
just sync-pr
```

結果ごとの対応:

| 出力 | 対応 |
|---|---|
| 正常終了（PR が ready になる） | 手順 4 へ |
| 「取り込む更新はない」 | draft PR は不要になっている。閉じてよいかを AskUserQuestion で聞き、了承されたら `gh pr close <番号>` |
| 「テンプレートに処理中の Dependabot PR がある」 | 表示された PR の一覧をユーザーに見せる。無視してよいと言われたら `SYNC_IGNORE_OPEN_PRS=1 just sync-pr` で再実行し、待つと言われたら終了する |
| 「template-sync で止めた」（衝突） | 下記「衝突の解消」へ |

#### 衝突の解消

`template-sync` ブランチでマージが途中の状態になっている。`flake.lock` だけの衝突は `just sync` 内で自動解消されるので、ここに来るのは `flake.lock` 以外も衝突したか、`flake.lock` を書き戻せない（project inputs に flake の input がある）場合である。

```bash
git diff --name-only --diff-filter=U
```

衝突ファイルごとに `git diff <file>` と、必要なら `git show :2:<file>`（派生側）/ `git show :3:<file>`（テンプレート側）を読み、解消案をユーザーに示す。

- 派生側の独自変更を残し、テンプレート側の変更を取り込むのが基本方針
- `flake.lock` を `nix flake lock` で作り直す解消はしない。project inputs が最新版になり、Dependabot PR と重複する
- 解消案は AskUserQuestion で承認を得てから Edit で適用する

全ファイルを解消したら:

```bash
git add <解消したファイル>
git commit --no-edit
just _sync-pr-open
git switch <控えたブランチ>
```

`just sync-pr` は `template-sync` を毎回 main から作り直すので、解消後に再実行すると手で解消した内容は消える。再実行しない。

### 4. レビュー

ここからは確認だけを行う。

**基本情報と CI**

```bash
gh pr view <番号> --json number,url,mergeable,mergeStateStatus,additions,deletions,changedFiles
gh pr checks <番号> --watch
```

- `mergeable` が `CONFLICTING` なら、main が先に進んでいる。`just sync-pr` の再実行（手順 3）を提案する
- 失敗したチェックがあれば名前とログの要点を記載する

**変更ファイル**

```bash
git fetch --no-tags origin main template-sync
gh pr diff <番号> --name-only
```

取り込み元のコミットはマージコミットの第 2 親（`origin/template-sync^2`）である。両側が変更したファイルを求める。

```bash
up=$(git rev-parse origin/template-sync^2)
base=$(git merge-base origin/main "$up")
git diff --name-only "$base" origin/main   # 派生側の変更
git diff --name-only "$base" "$up"         # テンプレート側の変更
```

`merge-base` が無ければ初回の取り込みなので、両側の比較は省き「初回（テンプレート側を採用）」と記載する。

ファイルを次の区分に分け、各ファイルの変更を `gh pr diff <番号>` から 1 行で要約する。

| 区分 | 判定の観点 |
|---|---|
| 両側が変更したファイル | 自動マージの結果、派生側の変更が残っているか（`git diff origin/main origin/template-sync -- <file>` で派生側の行が消えていないか） |
| 挙動が変わるファイル（`.github/workflows/`、`justfile`、`scripts/`、`flake.nix`） | 派生リポジトリの CI・レシピ・devShell への影響 |
| `flake.lock` | 下記 |
| それ以外（ドキュメント、skill / rules の宣言など） | 要約のみ |

**`flake.lock`**

```bash
git show origin/main:flake.lock | jq -r '.nodes | to_entries[] | "\(.key) \(.value.locked.rev // "-")"' | sort
git show origin/template-sync:flake.lock | jq -r '.nodes | to_entries[] | "\(.key) \(.value.locked.rev // "-")"' | sort
```

- rev が変わった node、追加・削除された node を一覧する
- project inputs（main 側の root にあり、テンプレート側にない input）の rev が変わっていないことを確認する。変わっていれば ❌ とする

### 5. レポート

```
## テンプレート取り込み PR レビュー

PR: #<番号> <url>
CI: ✅ / ❌ / ⏳  コンフリクト: なし / あり
判定: ✅ マージ推奨 / ⚠️ 要確認 / ❌ マージ非推奨

### 両側が変更したファイル
| ファイル | 結果 |
|---|---|

### 挙動が変わるファイル
| ファイル | 変更の要約 | 影響 |
|---|---|---|

### flake.lock
| input | 変化 |
|---|---|

### その他のファイル
- `<file>`: <要約>
```

末尾に「マージする場合は指示してください（Create a merge commit で行います）」と付記し、指示を待つ。

### 6. マージ（指示があったときだけ）

```bash
gh pr merge <番号> --merge --delete-branch
```

`--squash` / `--rebase` は使わない。マージコミットが許可されていないエラーが出たら、Settings → General → Pull Requests の「Allow merge commits」を有効にするようユーザーに伝える（勝手に設定を変えない）。

マージ後、結果（マージ済み / 未マージ）を報告して終了する。
