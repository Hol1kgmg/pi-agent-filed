---
name: init-from-template
description: Hol1kgmg/claude-temp をテンプレートにして生成した直後のリポジトリで、README.md / AGENTS.md / adr/README.md に残るテンプレートのプレースホルダ（{app name} など）を埋め、不要なセクションを削る。「テンプレートの初期化」「プレースホルダを埋めて」「テンプレート固有のものを消して」と言われたとき、または生成直後のリポジトリで README に {app name} が残っているときに使う。
allowed-tools: Bash(git remote:*), Bash(git status:*), Bash(just sync:*), Bash(nix flake check:*), Bash(gh api -X PUT repos/*/actions/permissions/workflow:*), Read, Edit, Grep, Glob, AskUserQuestion
---

# init-from-template — テンプレート生成直後の初期化

テンプレートから生成したリポジトリに残るプレースホルダを、そのリポジトリの情報で置き換える。

## 消してはいけないもの

`just sync` はテンプレート元を **マージコミット** で取り込み続ける（[adr/from-template/0001](../../adr/from-template/0001-sync-template-via-merge-commit.md)）。同期対象のファイルを派生側で削除すると、テンプレート元がそのファイルを後で変更した時点で modify/delete 衝突が毎回起きる。したがって次は削除しない:

- `adr/from-template/`、`docs/`、`justfile` の `sync` レシピ、`.github/`、`skills/init-from-template/`（このスキル自身）
- README.md の「テンプレート同期」節

やることはプレースホルダの **置換** と、AGENTS.md の任意セクションの削除だけ。置換より **先に初回の `just sync` を済ませる**（理由は手順 2）。

## 手順

### 1. ガード

```bash
git remote get-url origin
```

`Hol1kgmg/claude-temp` 自身なら中断する（テンプレート本体のプレースホルダを埋めてしまう）。

対象ファイルにプレースホルダが残っているかを Grep で確認する。1 つも無ければ「すでに初期化済み」と報告して終了する。

```
pattern: \{app name\}|\{アプリの概要\}|\{Describe the project|\{Remove this whole section|\{DIRECTORY_STRUCTURE_FILE\}|\{TROUBLESHOOTING_FILE\}|# First Run
files: README.md AGENTS.md adr/README.md
```

### 2. 先にテンプレート元と同期する

```bash
git status --porcelain
just sync
```

作業ツリーが clean でなければ中断する（コミットまたは退避してもらう）。

テンプレートに処理中の Dependabot PR があると sync は止まる。PR の一覧をユーザーに見せ、無視してよいと言われたら `SYNC_IGNORE_OPEN_PRS=1 just sync` で再実行する。

初回の `just sync` は共通祖先が無いため、テンプレート由来で派生側が変更したファイルを upstream 版で上書きする（`-X theirs`）。プレースホルダを埋める **前** に実行すれば上書きされるものが無く、このマージコミットが以降の共通祖先になる。sync が衝突で止まったら、解決してから次へ進む。

### 3. 情報を集める

AskUserQuestion で一度にまとめて聞く。引数で渡されていればその分は聞かない。

| 項目 | 使う場所 |
|---|---|
| アプリ名 | README.md の見出し、adr/README.md のディレクトリ名 |
| 概要（1〜2 文） | README.md 2 行目、AGENTS.md の Project Overview |
| Directory Structure ドキュメントの要否（要るならファイル名） | AGENTS.md |
| Troubleshooting ドキュメントの要否（要るならファイル名） | AGENTS.md |
| Dependabot の更新 PR を派生側でも受け取るか | .github/dependabot.yml |

Dependabot は、触らない派生や flake.lock の更新を `just sync` 経由で受け取る派生では不要。選択肢の説明にそう添える。

### 4. 置換する

Edit で行う。sed は使わない。

**README.md**

- `# {app name}` → `# <アプリ名>`
- `{アプリの概要}` → 概要

**AGENTS.md**

- `# First Run` セクション（次の `#` 見出しの直前まで）を削除。初期化後は不要で、毎セッション読まれるファイルに残す理由が無い
- `{Describe the project (e.g. ...)}` の行 → 概要（AGENTS.md は英語セクション見出しだが本文は日本語でよい）
- Directory Structure: 不要なら `# Directory Structure` から次の `#` 見出しの直前まで削除。要るなら `{Remove this whole section ...}` の行を消し、`{DIRECTORY_STRUCTURE_FILE}` 2 箇所をファイル名（拡張子なし）に置換
- Troubleshooting: 同様に削除、または `{Remove this whole section ...}` の行を消して `{TROUBLESHOOTING_FILE}` 2 箇所を置換

**adr/README.md**

- 表の `` `{app name}/` `` → `` `<アプリ名>/` ``

ディレクトリ `adr/<アプリ名>/` はこの時点では作らない。最初の ADR を書くときに `adr-skill` が作る。

**.github/dependabot.yml**（受け取らない場合のみ）

- `nix` と `github-actions` の両 `updates` エントリに `open-pull-requests-limit: 0` を追加する。`0` は version updates を無効化する公式の値
- ファイルは削除しない（同期対象）。以後の `just sync` でこのファイルが衝突したら `0` を残して解決する

**GitHub Actions による PR 作成の許可**

`template-sync` workflow が draft PR を作るために要る（[adr/from-template/0006](../../adr/from-template/0006-automate-template-sync-pr.md)）。新しいリポジトリでは既定で無効。

```bash
gh api -X PUT repos/<owner>/<repo>/actions/permissions/workflow -F can_approve_pull_request_reviews=true
```

`<owner>/<repo>` は手順 1 の origin URL から埋める。`{owner}/{repo}` は使わない（手順 2 で upstream remote が入り、gh が upstream 側を選ぶため）。

失敗したら（権限不足など）、Settings → Actions → General の「Allow GitHub Actions to create and approve pull requests」を手で有効にするよう伝える。

### 5. 確認

- 手順 1 の Grep を再実行し、ヒットが 0 であること
- 参照先ファイルを指定した場合、そのファイルが存在するか Glob で確認し、無ければ「作成が必要」と報告する（勝手に作らない）
- `nix flake check` を実行（skills.nix / rules.nix の解決が壊れていないことの確認）

### 6. 後片付けの提案

変更は自動でコミットしない。差分を要約し、次を提案する:

- コミット（例: `chore: テンプレートのプレースホルダを埋める`）
- 不要なスキルを `skills.nix` の `disable` に足す（派生ごとに判断が異なるため、このスキルでは触らない。`skills.template.nix` は同期対象なので編集しない）
