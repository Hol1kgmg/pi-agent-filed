---
status: 'accepted'
date: 2026-10-28
decision-makers: 'Hol1kgmg'
---

# テンプレート管理と派生先管理の宣言を別ファイル・別区画に分ける

## Context and Problem Statement

テンプレートリポジトリと派生リポジトリの管理場所を分け、テンプレートの更新を派生リポジトリへ円滑に取り込めるようにすることが目的である。

[ADR 0001](0001-sync-template-via-merge-commit.md) のとおり、`just sync` はテンプレート元をマージコミットで取り込む。git のマージは行単位で、両側が同じ行か隣接する行を変えると衝突する。テンプレートと派生先が同じリスト（`skills.nix` の ID、`flake.nix` の `inputs`・skill の取得元・devShell の `packages`）に追記するため、同期のたびに衝突していた。

## Decision

テンプレートが更新する宣言と派生先が編集する宣言を分け、テンプレートは派生先の分を初期状態から変更しない。

| 派生先が編集する | テンプレートが管理する |
|---|---|
| `skills.nix` / `rules.nix` | `skills.template.nix` / `rules.template.nix` |
| `sources.nix` | `sources.template.nix` |
| `flake.nix` の `inputs` 末尾の「project inputs」区画 | `flake.nix` の `inputs` のそれ以外 |
| `flake.nix` 末尾の `devShells.default` | `flake.nix` の `devShells.template` |

- 派生先の `skills.nix` / `rules.nix` は `{ enable; disable; }` とし、最終的な ID は `(template ++ enable) - disable` にする。テンプレートの ID を外すときも `*.template.nix` を編集せずに済む
- `sources.nix` と `sources.template.nix` で取得元の名前が重なると評価を止める。各リポジトリは片方しか編集しないため、重なりは誤りである
- 派生先が標準の名前（`skills.nix`）を使い、テンプレート側に `.template` を付ける。日常的に編集するほうを短く自然な名前にするため
- `inputs` は flake の仕様で文字列リテラルの attrset でなければならず、別ファイルに出せない。区画をテンプレート側と離して置き、隣接行の衝突を避ける
- `devShells.default` は `mkShell` の `inputsFrom` で `devShells.template` の `packages` と `shellHook` を引き継ぐ

## Consequences

- Good, because 移行後の `just sync` では、`skills.nix` などの宣言ファイルが衝突しなくなる。`flake.nix` も区画の境界を変えない限り衝突しない
- Good, because `nix develop .#template` でテンプレートだけの環境を確認できる
- Bad, because 既存の派生先は移行時の同期で一度だけ次の箇所が衝突する。独自分を派生先の区画・ファイルへ移して解消する
  - `skills.nix` / `rules.nix`: リストから `{ enable; disable; }` に変わる
  - `flake.nix` の `let` 内の `sources` / `ruleSources`: `sources*.nix` に移した
  - `flake.nix` の `inputs` 末尾: 独自の input を足していた場合、「project inputs」区画の追加と重なる
  - `flake.nix` の `devShells.default`: `packages` を足していた場合、テンプレート側を `devShells.template` に改名したことと重なる
- Bad, because `flake.nix` の `inputs` と `devShells` は同じファイル内の区画分けに留まり、テンプレートが区画の境界付近を変えると衝突しうる
- Bad, because `flake.lock` は両側が更新するため衝突が残る。自動解消は [ADR 0006](0006-automate-template-sync-pr.md) で決めた

## Implementation Plan

- **Affected paths**: `flake.nix`、`skills.nix`、`skills.template.nix`、`rules.nix`、`rules.template.nix`、`sources.nix`、`sources.template.nix`、`README.md`、`skills/README.md`、`rules/README.md`、`skills/init-from-template/SKILL.md`

## Alternatives Considered

- **同じファイル内で区画を分けるだけにする**: 両側がリスト末尾に追記すると隣接行で衝突する。分離できない `flake.nix` だけに採用した
- **派生先の分を `*.local.nix` にする**: 既存のファイル名は保てるが、派生先が日常的に編集するのが長い名前になる
- **devShell の `packages` を `packages.template.nix` / `packages.nix` に分ける**: `inputsFrom` で足り、ファイルを増やす必要がない

## More Information

- 前提: [テンプレート元の変更を手動のマージコミットで取り込む](0001-sync-template-via-merge-commit.md)
- 一時的に一部置き換えられた: [skill / rules を Nix から APM に移す](0007-manage-skills-and-rules-with-apm.md)（`skills*.nix` / `rules*.nix` / `sources*.nix` の部分）。[skill / rules の取得元を flake input に戻す](0008-revert-skill-sources-to-flake-inputs.md) で元に戻した
