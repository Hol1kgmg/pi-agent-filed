---
status: 'superseded by [0002](0002-run-on-cloudflare.md)'
date: 2026-11-03
decision-makers: 'Hol1kgmg'
---

# エージェント環境の本体を作業リポジトリから分け、すべてをこのリポジトリの下に置く

## Context and Problem Statement

M3 では「M4 からリポジトリがコンテナにマウントされ、エージェントのシェルから DB を読み書きできてしまう」という理由で、DB をリポジトリの外に置いた。しかし、エージェントが作業するリポジトリに host のコード（`host/*.ts`、`justfile`）があると、エージェントはそれを書き換えられる。書き換えたコードは次の起動時にホストで動き、DB も資格情報も読める。隔離を決めるのは DB の置き場所ではなく、何がコンテナにマウントされるかである。

[要件](../../docs/requirements.md)で前提が決まった。

- 作業させるのは GitHub からクローンした別の作業リポジトリで、複数ある。このリポジトリ自体は作業リポジトリにしない
- Orca で人が worktree を作り、worktree ごとに PO を起動する。worktree を並べて同時に動かす
- エージェントは作業の単位ごとに新しいコンテキストで起動し、必要な情報をコンテキスト DB から取りに行く。知識は worktree をまたいで残す

durable のストレージは 1 プロセスでしか開けないので、並行する worktree で 1 つの DB を共有できない。

このリポジトリは実装の検証でもあるので、試験的にすべてを 1 か所にまとめ、見通しと片付けを簡単にしたい。

## Decision

本体、設定、データ、作業リポジトリを、すべてこのリポジトリの下に置く。作業リポジトリは別の git リポジトリのまま `workspace/` にクローンし、コンテナには `workspace/` の下の worktree と共通の `.git` だけをマウントする。

| もの | 場所 | git |
|---|---|---|
| 本体（`host/`、npm の依存、`justfile`） | このリポジトリ | コミットする |
| 指示とガードの設定 | `agents/<repo>/` | コミットする |
| 資格情報 | `.data/` | 無視する |
| セッション DB（durable の会話ログ、worktree ごとに 1 ファイル） | `.data/repos/<repo>/` | 無視する |
| コンテキスト DB（知識・判断・タスク・worktree の記録、`worktree_id` 列を持つ。作業リポジトリごとに 1 ファイル） | 同上 | 無視する |
| 作業リポジトリと worktree | `workspace/` | 無視する（それぞれ独自の git） |

- `<repo>` は GitHub の remote URL で識別する。パスと違い、移動してもつながりが切れない
- 起動は worktree のディレクトリで `just po` を実行する。`just` は親ディレクトリの `justfile` を見つけ、`invocation_directory()` が worktree を指す
- コンテナは host だけが起動し、マウントと設定を明示的に渡す。マウントするのは worktree と共通の `.git` だけで、`.git/hooks` と `.git/config` は読み取り専用で重ねる
- エージェントはコンテキスト DB を、ホスト側のツールを通してだけ読み書きする

## Consequences

- Good, because 本体、設定、データがコンテナに入らないので、エージェントはホストで動くコードもガードの設定も書き換えられず、DB と資格情報も読めない
- Good, because 指示とガードの設定が作業リポジトリの外にあるので、エージェントが次の起動時のガードを緩められない
- Good, because 起動に `just` を使えるので、起動コマンドを PATH に置く仕組みが要らない
- Good, because 検証で作ったものが 1 か所にまとまり、`.data/` と `workspace/` を消せば片付く
- Good, because worktree を消しても、コンテキスト DB の知識が残る
- Good, because pi-durable の API 変更（Experimental）への追従が 1 か所で済む
- Bad, because このリポジトリのルートをコンテナにマウントすると、すべてが見える。ルートで `devcontainer up` を実行する使い方（M1）はやめ、ルートの `.devcontainer/` は M4 で作業用の既定に作り替える
- Bad, because `git clean -fdx` やクローンのし直しで、資格情報、DB、作業リポジトリが消える
- Bad, because このリポジトリの `.envrc` と `AGENTS.md` が `workspace/` の下にも効く。ホスト側のツールが親の設定を読む
- Bad, because remote URL を持たないリポジトリは識別できない。前提が GitHub のクローンなので、当面は扱わない
- Bad, because `.git/config` が読み取り専用になり、エージェントは `git config` を変えられない。hooks を使う作業リポジトリは開発者が先に設定する

## Implementation Plan

- **Affected paths**: `.gitignore`、`.gitleaks.toml`、`host/auth.ts`（データのディレクトリ）、`host/ask.ts`、`justfile`、`.devcontainer/`（M4 で作り替える）
- **Patterns to follow**:
  - データのパスは `.data/repos/<repo>/` から作る
  - host は `just` を起動したディレクトリを作業対象の worktree として扱う
- **Patterns to avoid**:
  - `workspace/` の外をコンテナにマウントすること
  - コンテナの中から `.git/hooks` や `.git/config` に書けるマウント

### Verification

- [ ] `docker inspect` で、マウント元が `workspace/` の下の worktree と共通の `.git` だけである
- [ ] コンテナの中から `host/`、`agents/`、`.data/` が見えない
- [ ] コンテナの中から `.git/hooks` と `.git/config` に書けない。commit はできる
- [ ] 2 つの worktree で別のセッション DB ができ、同時に動かせる。コンテキスト DB は共有され、行の `worktree_id` で区別できる

## Alternatives Considered

- **A. 作業リポジトリの中に環境を置く**: host のコードを書き換えられる。読み取り専用マウントで防ぐと、設定の漏れがそのまま穴になる。API 変更への追従も作業リポジトリの数だけ要る
- **B. 作業リポジトリに設定（`.pi-agent/`）を置き、データをホーム（`~/.config/pi-agent-filed/`）に置く**: 前の決定。設定がマウントされる場所にあるので、エージェントがガードの設定を緩められる。置き場所が散らばり、起動コマンドを PATH に置く仕組みも要る
- **C. 本体は外、設定とセッション DB は作業リポジトリの `.pi-agent/`**: 最初の案。DB がマウントされる場所にあるので、エージェントが直接読み書きでき、worktree を消すと知識も消える
- **このリポジトリ自体を作業リポジトリにする（dogfooding）**: 本体が作業対象になり、前提が崩れる。別のリポジトリを作って `workspace/` で作業させ、成果をこのリポジトリに回収する

## More Information

- 要件: [docs/requirements.md](../../docs/requirements.md)
- 本体を検証の外で使うとき（作業リポジトリを任意の場所に置く、CLI として配布する）は、配置を見直す
