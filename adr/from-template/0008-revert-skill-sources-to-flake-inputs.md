---
status: 'accepted'
date: 2026-11-07
decision-makers: 'Hol1kgmg'
---

# skill / rules の取得元を flake input に戻す

## Context and Problem Statement

[ADR 0007](0007-manage-skills-and-rules-with-apm.md) は、skill / rules の取得元を APM に移した。その前提は、Dependabot の `apm` ecosystem が取得元ごとに PR を立て、[ADR 0003](0003-update-skill-sources-via-dependabot.md) の「差分をレビューしてから手動でマージする」運用と 2 日の cooldown（`cooldown.default-days: 2`）を保てることだった。検証の結果、この前提は成り立たなかった。

Dependabot の `apm` ecosystem は、ref を書いていないエントリ、ローカルパス、`git:` などのオブジェクト形式を更新しない。この構成の依存はすべてこのどれかに当たり、`directories: [/, /packages/template]` にしたあとも apm の実行でチェックされた依存は 0 件だった。同じ時刻の nix の実行は 5 件をチェックしていた。Dependabot が PR を立てないので、lock を進める手段は手動の `apm update` だけになる。`apm update` はすべての依存をその時点の HEAD に一度に上げるため、取得元ごとに見送ることも cooldown をかけることもできない。

ref を書けば更新されるかを、ブランチ指定（`#main`）で確かめた。Dependabot は `apm.lock.yaml` だけを更新する PR を立てた（検証 PR #39）が、更新先は実行の約 4 時間前の commit で、2 日の cooldown は守られなかった。ブランチ指定には、ほかにも次の制約がある。

- `git:` 形式は ref を書いても対象外である。gist の 2 件と、`skills:` で skill を選ぶ yomiyasu はこの形式を外せない
- Dependabot が使う apm の版が古い。PR #39 では lock の `apm_version` が 0.35.0 から 0.34.0 に下がり、ローカルパッケージの `content_hash` が消えた。手元と CI は 0.35.0 で `apm install --frozen` を実行するので、マージすると CI が lock との不一致で失敗するおそれがある

一方、nix では cooldown が守られている。PR #32（nix-claude-code）の作成時点で取得元には公開から 2 日未満の d942ac4 があったが、Dependabot はこれを飛ばし、2 日以上前の dfdc6e6 を選んだ。

## Decision

0007 を実装した commit 80444a9 を revert し、0003 / [ADR 0005](0005-separate-template-and-project-files.md) の構成に戻す。

- 取得元は `flake = false` の flake input として宣言し、`sources*.nix` と `skills*.nix` / `rules*.nix` で選び、agent-skills-nix / agent-rules-nix で配置する
- `flake.lock` は、skill / rules の input を移行前の `locked` に戻し、ツール系 input は現在の値を保つ。lock を作り直すと、すべての input が cooldown なしで最新版になるため
- [ADR 0004](0004-auto-merge-non-skill-dependabot-prs.md) の `flake = false` の node で振り分ける判定と、[ADR 0006](0006-automate-template-sync-pr.md) の `scripts/resolve-flake-lock.sh` も元に戻る

## Consequences

- Good, because 取得元ごとの Dependabot PR、差分のレビュー、2 日の cooldown が戻る
- Good, because Dependabot が使う apm の版と手元の版のずれの影響を受けない
- Bad, because 取得元の追加が、`flake.nix` の input、`sources*.nix`、`skills*.nix` / `rules*.nix` の 3 か所の編集に戻る
- Bad, because yomiyasu などは、APM で取得していた版より古い移行前の版に戻る。次の Dependabot PR で追いつく
- Bad, because 既存の環境は一度、`apm_modules/` と APM が置いた `.agents/skills` を消してから `nix develop` をやり直す必要がある

## Implementation Plan

- **Affected paths**: `flake.nix`、`flake.lock`、`justfile`、`.github/dependabot.yml`、`.github/workflows/`、`.gitignore`、`README.md`、`docs/lockfile-automation.md`、`skills/README.md`、`rules/README.md`、`.codex/rules/README.md`
- **Restored**: `sources.nix`、`sources.template.nix`、`skills.nix`、`skills.template.nix`、`rules.nix`、`rules.template.nix`、`scripts/resolve-flake-lock.sh`、`rules/orca-worktree.md`、`.claude/rules`（symlink）、`packages/template/skills/` から `skills/` に戻した 3 つの skill
- **Removed**: `apm.yml`、`apm.lock.yaml`、`packages/template/apm.yml`、`scripts/resolve-locks.sh`
- **Patterns to avoid**:
  - `nix flake lock` による lock の作り直し

### Verification

- [x] `nix flake check --no-update-lock-file` が通る
- [x] `just skills-list` と `just rules-list` の出力が、APM 構成で配置していた skill / rule と一致する
- [ ] Dependabot が skill の input の PR を、cooldown を守って作成する（nix の cooldown はツール系 input の PR #32 で確認済み）

## Alternatives Considered

- **すべての依存に `#main` を付けて APM を続ける**: cooldown が守られない。`git:` 形式の依存と `packages/template` の依存は、それでも更新されない
- **テンプレートの依存をルートの `apm.yml` に移す**: 0005 の宣言の分離が崩れる。移しても cooldown は守られない
- **`apm update` を週次の workflow で実行し、cooldown を自前で実装する**: 更新が取得元ごとの PR にならず、全採用か全却下に戻る。workflow の実装と保守も増える

## More Information

- 置き換え: [skill / rules を Nix から APM に移す](0007-manage-skills-and-rules-with-apm.md)
- 前提: [skill / rules の取得元を flake input にして Dependabot で更新する](0003-update-skill-sources-via-dependabot.md)
- 前提: [テンプレート管理と派生先管理の宣言を別ファイル・別区画に分ける](0005-separate-template-and-project-files.md)
- Dependabot の apm 対応の仕様: https://docs.github.com/en/code-security/dependabot/ecosystems-supported-by-dependabot/supported-ecosystems-and-repositories
