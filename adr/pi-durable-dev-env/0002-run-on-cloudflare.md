---
status: 'accepted'
date: 2026-11-08
decision-makers: 'Hol1kgmg'
---

# エージェント環境を Cloudflare の Workers と Containers で動かし、Slack から使う

## Context and Problem Statement

[ADR 0001](0001-separate-agent-env-from-work-repos.md) は、ローカルで動かすことと ChatGPT Plus の定額枠に収めることを前提に、本体、データ、作業リポジトリをすべてこのリポジトリの下に置いた。この前提が 2 つ変わった。

- クラウドでの常時稼働を許容する。開発者のマシンを閉じても、チームが自走できるようにする
- モデルを DeepSeek V4.1 Flash にし、Cloudflare Workers AI（`@cf/deepseek-ai/deepseek-v4.1-flash-1017`）で呼ぶ。Sign in with ChatGPT の資格情報をローカルに置く必要がなくなった

[Pi Durable on Cloudflare](https://earendil.com/posts/pi-durable-on-cloudflare/) と [pi-durable-cloudflare](https://github.com/earendil-works/pi-durable-cloudflare) のサンプルで、Durable Object（DO）の中で Harness を開き、DO の SQLite に保存し、eviction から再開する形が示された。このサンプルは実行環境（sandbox）を扱わず、認証もない。

[touka](https://github.com/L4Ph/touka) は、同じ部品（Pi Durable、DO、Containers）をデプロイした環境で動かしている。実行環境はコンテナの中の pi-env デーモンを Workers RPC でつなぎ、`/workspace` は snapshot で退避し、資格情報は GitHub への要求にだけ差し込む。ただし touka 全体は、チームで使うための部品（Trigger、Connector、grant、outbox）が大半で、このリポジトリの検証には大きすぎる。

ローカル版には、Cloudflare に移すと消える問題があった。

- durable のストレージは 1 プロセスでしか開けないので、コンテキスト DB を WAL で複数プロセスから開く必要があった
- 開発者がホストで git を実行するので、`.git/hooks` と `.git/config` をコンテナから読み取り専用にする必要があった
- GitHub のトークンをコンテナに渡すと、エージェントのシェルから読める
- 開発者が離席すると、通知を受けて返事をする手段がない

## Decision

Worker と DO で Harness を動かし、ツールの実行を Cloudflare Containers に隔離する。開発者は Slack で PO と対話する。土台は pi-durable-cloudflare のサンプルにし、実行環境の層は touka から写す。

| もの | 置き場所 | 単位 |
|---|---|---|
| Harness（PO。のちにサブエージェント） | セッション DO | 目標ごとに 1 つ |
| セッション DB（durable の会話ログと再開の状態） | セッション DO の SQLite（`openDurableObjectSqliteStorage`） | 目標ごとに 1 つ |
| コンテキスト DB（知識・判断・タスク・目標の記録。行ごとに `goal_id` を持つ） | リポジトリ DO の SQLite | 作業リポジトリごとに 1 つ |
| 作業リポジトリのクローンと目標ブランチ | コンテナ DO（Containers）の `/workspace` | 目標ごとに 1 つ |
| `/workspace` の退避 | `snapshotContainer()`。bash / write / edit のたびに取る | 目標ごと |
| Workers AI を呼ぶ Cloudflare の API トークン、GitHub App の秘密鍵、Slack の署名シークレットと bot トークン | Worker の secret | — |
| 本体（Worker のコード）、指示とガードの設定（`agents/<repo>/`） | このリポジトリ。Worker と一緒にデプロイする | — |

- `<repo>` は ADR 0001 と同じく GitHub の remote URL で識別する
- ADR 0001 の「worktree」は「目標」に置き換える。1 つの目標が、1 つの Slack スレッド、1 つのセッション DO、1 つの PO、1 つのコンテナに対応する。git worktree は使わず、コンテナごとにクローンする
- pi は 1.5 に上げる。コンテナ DO は touka の `server/src/sandbox/`（`container.ts`、`connection.ts`、`env.ts`、`checkpoint.ts`、`image.ts`）と `sandbox.Dockerfile` を写して作り、ツールは pi の `createCodingTools()` をそのまま使う
- セッション DO はコンテキスト DB を直接開かず、リポジトリ DO の RPC をホスト側のツールから呼ぶ。どの目標の行を見せるかはリポジトリ DO が決める
- 入口は Slack にする。要求は署名で検証し、許可したユーザー ID からのものだけを受け付ける。通知は PO がスレッドで開発者にメンションして行う。検証用に、Bearer トークンで認証する Webhook も置く
- コンテナの外向きの接続は制限しない。GitHub（`github.com`、`api.github.com`、`codeload.github.com`）への要求にだけ、Egress Worker が GitHub App のインストールトークンを差し込む。トークンは Egress Worker が App の秘密鍵からその場で発行し、作業リポジトリと `contents` / `pull_requests` の書き込みに絞る（1 時間で失効する）。App は作業リポジトリにだけインストールし、`workflows` の権限を持たせない
- PR は GitHub の REST API を curl で呼んで作る。差し込み方式では `gh` の GraphQL が認証されないため
- 開発は `wrangler dev`（Miniflare と手元の Docker）で始め、そのあとデプロイする
- チーム内のブランチは GitHub に push せず、snapshot で残す
- モデルは Workers AI の `@cf/deepseek-ai/deepseek-v4.1-flash-1017` を pi-ai の `cloudflare-workers-ai` provider で呼ぶ。API トークンは Workers AI の権限だけに絞る
- 作業リポジトリのコードと会話は、Workers AI（Cloudflare）と Slack に送ってよい

## Consequences

- Good, because 開発者のマシンを閉じても作業が進む
- Good, because 通知と返事を Slack で行えるので、離席中もスマートフォンから対応できる。通知の仕組みを作らなくてよい
- Good, because DO は 1 オブジェクトの中で処理を直列にするので、コンテキスト DB を複数プロセスから開く問題がなくなる
- Good, because 資格情報がコンテナに入らない。本体、設定、DB にもエージェントは届かない（ADR 0001 の Good を引き継ぎ、トークンの扱いはより強くなる）
- Good, because 開発者がコンテナの `.git` に対して git を実行しないので、`.git/hooks` と `.git/config` を守る仕組みが要らない。エージェントは `git config` を使える
- Good, because ExecutionEnv を自作しなくてよい。pi-env と pi の `createCodingTools()` をそのまま使える
- Bad, because コンテナから任意の外部に接続できる。外部へ情報が出ることは防がない
- Bad, because snapshot は 30 日で期限が切れる（touka の記録による。Cloudflare のドキュメントでは確かめていない）。期限を越えて置いたチーム内のブランチは失われる
- Bad, because 写したコードを自分で保守し、touka の修正は手で取り込む
- Good, because モデルの呼び出しが Cloudflare の中で完結する。Workers AI のこのモデルは Zero data retention で、作業リポジトリのコードを DeepSeek 社に送らない。料金は DeepSeek の API と同じで、請求先が Cloudflare にまとまる
- Bad, because Workers AI の従量課金と Containers が動いている時間の課金がかかる。Slack の履歴を 90 日より長く残すなら Slack Pro の料金も加わる。コスト上限は M8 で決める
- Bad, because Slack に作業リポジトリのコードと会話の断片が残る
- Bad, because DeepSeek の API にあるオフピーク（半額）の割引がない
- Bad, because Workers AI のモデルは日付付きの版ごとに廃止される（2026-11-20 に V4 Flash 0731 などが廃止された）。`-1017` もいずれ切り替えが要る
- Bad, because pi-ai の `cloudflare-workers-ai` provider は Worker の `AI` binding ではなく REST API を呼ぶので、API トークンを secret に置く。`wrangler dev` でも本番のモデルが呼ばれ、課金される
- Bad, because ローカルで Slack の Events API を受けるには、公開 URL（`cloudflared` のトンネルなど）が要る
- Bad, because GitHub App の秘密鍵は長期の secret になる。コンテナには入らないが、漏れるとインストールしたリポジトリに書ける。App の作成とインストールは手作業で、commit と PR は bot の名前になる
- Bad, because Orca と `just po` を使った手元の worktree の流れがなくなる。MVP の確認はポートフォワードではなくプレビュー URL になる

## Implementation Plan

- **Affected paths**: 新しい Worker のパッケージ（サンプルから取り込み、touka の実行環境の層を写す）、`wrangler` の設定、コンテナのイメージ、`agents/<repo>/`、`docs/`。`host/`（ローカル版）はセッション DO が動くまで残し、置き換えたら消す
- **Patterns to follow**:
  - Harness は DO の constructor の `blockConcurrencyWhile` の中で開く（サンプルと同じ）
  - DO の名前は、セッション DO が目標の ID（Slack のスレッド）、リポジトリ DO が `<repo>` から作る
  - Slack への ACK は、submission をセッション DO に保存してから返す。モデルの処理は ACK のあとに DO で進める
  - 再送されうる要求（Slack のイベント、Webhook、スケジュール）は ID の receipt で冪等にする
  - サブエージェントは子会話として起動し、ツールを replay-safe にする
- **Patterns to avoid**:
  - 資格情報をコンテナの環境変数やファイルに渡すこと
  - セッション DO からコンテキスト DB の SQLite を直接開くこと
  - Slack の要求を、ACK を返す前にモデルの処理まで進めること

### Verification

- [ ] コンテナの中の環境変数とファイルに、GitHub のトークンと App の秘密鍵、Cloudflare の API トークン、Slack のトークンがない。それでも `git push` と REST API での PR の作成が作業リポジトリに通る。ほかのリポジトリには書けない
- [ ] 署名が不正な Slack の要求、許可していないユーザーの要求、Bearer トークンのない Webhook を拒否する
- [ ] セッション DO が止まったあと、未完了の submission から再開する
- [ ] コンテナを止めて起動し直すと、snapshot から `/workspace` のチーム内のブランチが戻る
- [ ] 2 つの目標のセッション DO が同時に動き、同じリポジトリ DO に書いた行を `goal_id` で区別できる

## Alternatives Considered

- **A. ローカルのまま続ける（ADR 0001）**: 常時稼働できない。コンテキスト DB の同時書き込みと `.git` の保護を自前で作る必要がある
- **B. Worker と DO で Harness を動かし、ツールは手元の devcontainer の pi-env で実行する（元の M11）**: 手元のマシンとトンネルを常時動かす必要があり、常時稼働の意味がない
- **C. 実行環境を別のサービス（E2B、Blaxel など）にする**: トークンの差し込みを Worker の外で作ることになる。課金先も分かれる
- **D. チーム内のブランチを GitHub に push して残す**: 退避の仕組みは要らないが、開発者が GitHub で見る PR を最終 PR の 1 本にする要件と衝突しやすい
- **E. touka を fork する**: 実行環境、復旧、管理 API はデプロイ先で確かめられている。しかし、チームで使うための部品が大半を占め、上流は Devin と同等の機能を目指して範囲を広げている。このリポジトリで検証したい PO、サブエージェント、コンテキスト DB はどれも touka にない
- **F. Sandbox SDK と R2 で実行環境と退避を作る**: Sandbox SDK の exec とファイル操作に委譲する ExecutionEnv を自作することになる。touka で動いている形からも外れる
- **G. Web クライアントか CLI を入口にする**: 通知と、離席中に返事をする手段を別に作る必要がある
- **H. GitHub の資格情報を fine-grained PAT にする**: 長期のトークンで、個人アカウントに紐づく。App のインストールトークンなら 1 時間で失効し、発行のたびにリポジトリと権限を絞れる
- **I. GitHub の資格情報を deploy key（SSH）にする**: リポジトリ単位で範囲は狭いが、SSH は Egress Worker の HTTP の傍受を通らないので、鍵をコンテナに置くことになる。PR も作れない
- **J. GitHub の資格情報を OAuth のユーザートークンにする**: 開発者本人の権限で動くので範囲が広く、refresh の管理も要る

## More Information

- 置き換え: [エージェント環境の本体を作業リポジトリから分け、すべてをこのリポジトリの下に置く](0001-separate-agent-env-from-work-repos.md)
- 要件: [docs/requirements.md](../../docs/requirements.md)
- 構成図: [docs/diagrams/pi-durable-cloudflare.png](../../docs/diagrams/pi-durable-cloudflare.png)
- touka の実行環境: <https://github.com/L4Ph/touka/tree/main/server/src/sandbox>
- Containers の外向きの接続: <https://developers.cloudflare.com/containers/guides/outbound-traffic/>
- Containers のローカル開発: <https://developers.cloudflare.com/containers/local-dev>
- Slack のレート制限（社内向けアプリは対象外）: <https://docs.slack.dev/changelog/2025/06/03/rate-limits-clarity>
