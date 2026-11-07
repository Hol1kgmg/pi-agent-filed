---
status: 'superseded by 0008'
date: 2026-11-07
decision-makers: 'Hol1kgmg'
---

# skill / rules を Nix から APM に移す

## Context and Problem Statement

skill と rules は flake input（`flake = false`）を取得元にし、agent-skills-nix / agent-rules-nix で `.agents/skills` / `.agents/rules` に配置していた（[ADR 0003](0003-update-skill-sources-via-dependabot.md)、[ADR 0005](0005-separate-template-and-project-files.md)）。この構成では、取得元を 1 つ足すたびに `flake.nix` の input、`sources*.nix`、`skills*.nix` / `rules*.nix` の 3 か所を編集する。

[APM](https://github.com/microsoft/apm) は取得元と配置を `apm.yml` の 1 行で宣言でき、版を `apm.lock.yaml` に固定する。2026-11 に Dependabot が `apm` ecosystem に対応し、0003 の「取得元ごとに更新 PR を受けてレビューする」運用を保てるようになった。

## Decision

skill と rules の宣言と配置を APM に移し、agent-skills-nix / agent-rules-nix をやめる。

| 派生先が編集する | テンプレートが管理する |
|---|---|
| `apm.yml` | `packages/template/apm.yml`、`packages/template/skills/` |

- 派生先の `apm.yml` はローカルパッケージ `./packages/template` に依存し、テンプレートの skill / rules を推移的に受け取る。テンプレート独自の skill は `packages/template/skills/` に置けば列挙しなくても配置される
- 派生先独自の skill は `skills/<id>`、rule は `rules/<id>.instructions.md` に置き、`apm.yml` に足す
- この template の構造や手順を前提にする skill（init-from-template、template-sync-review、bot-pr-routine）はここに置く。コードと同じ取り込み PR で届き、版がずれないため。template と関係なく使える skill / rule は専用リポジトリ（Hol1kgmg/skills、Hol1kgmg/rules）に置いて参照する
- rule は APM の instructions として扱う。ファイル名は `<id>.instructions.md` とし、`claude` target で `.claude/rules/<id>.md` に配置する。`.claude/rules -> ../.agents/rules` の symlink はやめる
- `disable`（テンプレートの skill / rule を派生先で外す仕組み）は持たない。テンプレートには全派生で共通に使うものだけを置く
- `apm.lock.yaml` はコミットする。devShell の shellHook は `apm install --frozen` を実行し、2 回目以降は `apm_modules/` のキャッシュだけで配置する
- `just sync` で `apm.lock.yaml` が衝突したら、`scripts/resolve-locks.sh`（`resolve-flake-lock.sh` を改名）が解消する。テンプレート側の lock を採用し、派生先だけの依存の `dependencies` / `deployments` を派生先側から書き戻してから `apm install` を実行する。派生先だけの依存とは、派生先の lock にあり、テンプレート側にも merge-base にもないものとする
- Dependabot に `apm` ecosystem を足す。`apm.yml` / `apm.lock.yaml` を変える PR は `dependabot-auto-merge` が手動レビューに回す。`flake.lock` の `flake = false` を見る判定は対象がなくなるため消す。`template-dependabot-close` は、派生先だけの依存の commit を変える PR を閉じない

## Consequences

- Good, because 取得元の追加が `apm.yml` の 1 行で済む。`flake.nix` から skill / rules 用の input と agent-skills-nix / agent-rules-nix が消える
- Good, because 派生先だけの依存の版は `just sync` で進まない。更新は Dependabot の PR で入る
- Bad, because apm は初回に GitHub から取得するため、clone 直後の devShell はネットワークが要る。shellHook は失敗しても shell を止めず、`just apm` を促す
- Bad, because ローカルの skill / rule を編集すると `apm.lock.yaml` の content hash がずれる。`just apm` で lock を更新し忘れると CI の `apm install --frozen` で落ちる
- Bad, because rule は Codex にはファイルとして配置されない。APM は Codex 向けの instructions を `apm compile` で AGENTS.md に埋め込む方式で、移行前の `.agents/rules` も Claude からしか参照されていなかった
- Bad, because `.codex-plugin/plugin.json` を持つ skill（yomiyasu）は、そのディレクトリを直接指すと Codex のネイティブプラグイン扱いになり、プロジェクト単位で入らない（apm 0.35.0）。リポジトリのルートを指し、`skills:` で選ぶ
- Bad, because gist は `alias:` を書かないと gist の ID がスキル名になる
- Bad, because 既存の環境は移行時に一度、nix が置いた読み取り専用の `.agents/skills` と `.agents/rules`、`.claude/rules` の symlink を消してから `just apm` を実行する必要がある

## Implementation Plan

- **Affected paths**: `apm.yml`（新規）、`apm.lock.yaml`（新規）、`packages/template/`（新規、`skills/` から 3 つの skill を移動）、`flake.nix`、`flake.lock`、`justfile`、`scripts/resolve-locks.sh`、`.github/dependabot.yml`、`.github/workflows/`、`.gitignore`、`README.md`、`docs/lockfile-automation.md`、`skills/README.md`、`rules/README.md`
- **Removed**: `skills.nix`、`skills.template.nix`、`rules.nix`、`rules.template.nix`、`sources.nix`、`sources.template.nix`、`rules/orca-worktree.md`（Hol1kgmg/rules に移動）、`.claude/rules`（symlink）、flake の skill / rules 用 input と agent-skills / agent-rules、`checks.*`、`apps.*`

### Verification

- [x] `.agents/skills` と `.claude/rules` の一覧と中身が移行前と一致する（yomiyasu は取得した版が新しい）
- [x] `apm.lock.yaml` の衝突を再現し、派生先だけの依存が派生先側の commit のまま残る
- [ ] Dependabot が `apm` ecosystem の PR を作成する。`packages/template/apm.yml` の依存と gist も対象になるか → 作成しない。0008 参照

## Alternatives Considered

- **`apm.lock.yaml` を gitignore し、版を `apm.yml` に `#<sha>` で書く**: 宣言ファイルが分かれているので衝突しないが、lock が無いため `--frozen` を使えない。Dependabot が sha の ref を更新するかも確かめられない
- **衝突したら lock を作り直す**: 単純だが、派生先だけの依存が同期のたびに最新版へ進む
- **template 固有の skill を専用リポジトリに移す**: コードは取り込み PR、skill は Dependabot PR と別々に届き、片方だけマージされると存在しないレシピを案内する
- **rules だけ agent-rules-nix に残す**: ツールが nix と apm の 2 系統になり、取得元の追加手順も分かれる

## More Information

- 置き換えられた: [skill / rules の取得元を flake input に戻す](0008-revert-skill-sources-to-flake-inputs.md)
- 一部置き換え: [skill / rules の取得元を flake input にして Dependabot で更新する](0003-update-skill-sources-via-dependabot.md)（取得元を flake input にする部分）
- 一部置き換え: [テンプレート管理と派生先管理の宣言を別ファイル・別区画に分ける](0005-separate-template-and-project-files.md)（`skills*.nix` / `rules*.nix` / `sources*.nix` の部分）
- Dependabot の apm 対応: https://github.blog/changelog/2026-11-03-dependabot-version-updates-support-agent-package-manager/
