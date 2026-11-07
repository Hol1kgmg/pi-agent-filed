---
status: 'accepted'
date: 2026-10-24
decision-makers: 'Hol1kgmg'
---

# skill / rules 以外の Dependabot PR を auto-merge する

## Context and Problem Statement

[ADR 0003](0003-update-skill-sources-via-dependabot.md) は skill の内容差分を人が読むために auto-merge をやめ、nixpkgs などのツール系 input や GitHub Actions の更新も含めて全 PR を手動マージにした。だがレビューが要るのは、エージェントの指示・実行物そのものである skill / rules の取得元だけである。ツール系の更新は `nix flake check` が通れば採用してよく、手動マージは運用コストにしかならない。

## Decision

`dependabot-auto-merge` workflow で、skill / rules の取得元を更新しない Dependabot PR を auto-merge する。

- PR が `flake.lock` 上で `flake = false` な node の `locked` を変えていれば何もせず、手動レビューに回す。それ以外は `gh pr merge --auto --squash` する
- 対象は nix と github-actions の全更新。メジャー更新も区別しない
- マージ可否はブランチ保護の必須チェック `check` に委ねる。auto-merge は `check` が通るまで待つ
- 判定に skill の一覧を持たない。`flake = false` で宣言するという 0003 の規約がそのまま判定基準になり、取得元を追加しても workflow を直さずに済む
- テンプレートリポジトリ（`Hol1kgmg/claude-temp`）でだけ動かす。workflow は `just sync` で派生リポジトリにも届くが動かず、派生側では全 PR を手動でマージする

## Consequences

- Good, because 手動で見る PR が skill / rules の更新だけになる
- Good, because Dependabot が作った PR は workflow を発火させるので、0002 で要った GitHub App なしに必須チェックが付く。書き込みは `GITHUB_TOKEN` だけで足りる
- Bad, because 書き込み権限を持つ workflow が再び増える。PR のコードを checkout せず、`flake.lock` を API で読むだけに留める
- Bad, because ツール系のメジャー更新も `nix flake check` が通れば無審査で入る。静的チェックで捕まらない挙動変化は事後に気づくことになる
- Bad, because `GITHUB_TOKEN` によるマージは main への push として `ci.yaml` を発火させない。PR 上の `check` で代替する

## Alternatives Considered

- **`dependabot/fetch-metadata` で依存名を取り、skill の一覧と照合する**: nix ecosystem の出力に実績が少なく、一覧の保守も要る。`flake.lock` の差分なら Dependabot の出力形式に依存しない
- **semver で patch / minor だけ auto-merge する**: nix の input は commit 単位で更新され semver が無い。必須チェックを通ることを採否の基準にした
- **リポジトリ変数（`DEPENDABOT_AUTO_MERGE`）で有効にする**: 派生側で有効にできるが、その予定はない。変数の設定を忘れるとテンプレート自身の auto-merge も止まる

## More Information

- 一部置き換え: [skill / rules の取得元を flake input にして Dependabot で更新する](0003-update-skill-sources-via-dependabot.md)（auto-merge しない、の部分）
- 一時的に一部置き換えられた: [skill / rules を Nix から APM に移す](0007-manage-skills-and-rules-with-apm.md)（`flake = false` の node で判定する部分）。[skill / rules の取得元を flake input に戻す](0008-revert-skill-sources-to-flake-inputs.md) で元に戻した
- セットアップ手順: [docs/lockfile-automation.md](../../docs/lockfile-automation.md)
