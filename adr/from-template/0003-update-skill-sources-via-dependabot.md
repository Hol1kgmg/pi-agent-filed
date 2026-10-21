---
status: 'accepted'
date: 2026-10-17
decision-makers: 'Hol1kgmg'
---

# skill / rules の取得元を flake input にして Dependabot で更新する

## Context and Problem Statement

skill と rules の取得元は npins 形式の `registry/sources.lock.json` に固定し、`update-locks` workflow が週次で一括更新して auto-merge していた（[ADR 0002](0002-use-github-app-for-write-access.md)）。この構成では、新しい版の SKILL.md や scripts を誰も読まずに採用される。skill はエージェントの指示・実行物そのものなので、更新前に内容差分を評価する工程が要る。

評価の実行は `dependabot-review` スキル（Hol1kgmg/skills）に任せたい。だが Dependabot は npins の lock を扱えず、2026-04 に追加された `nix` ecosystem は `flake.lock` のみを見る。

## Decision

取得元を `flake = false` な flake input に移し、npins の registry を廃止する。

- `.github/dependabot.yml` に `nix` ecosystem を追加し、input ごとに PR を受ける
- PR は auto-merge しない。`dependabot-review` で差分をレビューしてから手動でマージする
- `update-locks` workflow と GitHub App は不要になるため削除する。`docs/lockfile-automation.md` は Dependabot 前提の手順に書き直す
- main のブランチ保護で必須チェックに `check` を指定し、Dependabot PR も CI を通してからマージする
- `nixpkgs` などツール系 input も同じ Dependabot PR に乗る。レビュー手順の振り分けは `dependabot-review` 側の `references/nix-flake.md` が行う

## Consequences

- Good, because 更新が input 単位の PR になり、問題のある取得元だけ見送れる。lock 一括更新では全採用か全却下しかなかった
- Good, because 書き込み権限を持つ workflow が無くなり、GitHub App と Secrets の管理が消える
- Good, because 派生リポジトリでも `dependabot.yml` がそのまま効く。`if: github.repository` のガードが要らない
- Bad, because 取得元の追加が `flake.nix` の編集になり、registry の「1 ソース 1 ファイル」より差分が読みにくい
- Bad, because PR のマージが手動になる。週次で数本の PR を人が見る運用コストが発生する
- Bad, because Dependabot の `nix` 対応は新しく、gist など plain git input の追従実績が少ない。動かない場合は `just update` で手動更新する

## Implementation Plan

- **Affected paths**: `flake.nix`、`flake.lock`、`.github/dependabot.yml`、`skills.nix`、`rules.nix`、`justfile`、`README.md`、`docs/lockfile-automation.md`
- **Removed**: `registry/`、`.github/workflows/update-locks.yaml`
- **Patterns to follow**:
  - 取得元は `flake = false` で宣言し、source は `{ path = inputs.<name>.outPath; subdir = ...; }` で参照する
  - Dependabot PR は `dependabot-review` でレビューしてからマージする
- **Patterns to avoid**:
  - Dependabot PR の auto-merge
  - npins / registry の再導入

### Verification

- [ ] `nix flake check` が通る
- [ ] `just skills-list` の出力が移行前と一致する
- [ ] Dependabot が `nix` ecosystem の PR を作成する

## Alternatives Considered

- **`update-locks` から auto-merge だけ外す**: 最小変更だが、lock が一括更新のままなので 1 ソースの却下が全体の更新を止める。GitHub App の管理も残る
- **独自のレビュー skill を作って `update-locks` の PR を見る**: `dependabot-review` と二重になる。Dependabot に寄せれば ecosystem の振り分けも既存手順に乗る
- **git submodule にして Dependabot の `gitsubmodule` を使う**: Nix 側で submodule を扱う必要があり、flake input のほうが素直

## More Information

- 置き換え: [書き込み権限を GitHub App の短命トークンで得る](0002-use-github-app-for-write-access.md)
- セットアップ手順: [docs/lockfile-automation.md](../../docs/lockfile-automation.md)
- Dependabot の nix 対応: https://github.blog/changelog/2026-04-07-dependabot-version-updates-now-support-the-nix-ecosystem
