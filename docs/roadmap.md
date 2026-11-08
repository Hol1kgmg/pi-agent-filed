# ロードマップ

Cloudflare の Durable Object（DO）で [pi-durable](https://github.com/earendil-works/pi/tree/main/packages/durable) を動かしてツールの実行だけを Cloudflare Containers に隔離し、開発者が Slack で PO 役エージェントと対話し、内部のサブエージェント群が仕様・設計・実装を行う開発環境を作るための検証計画。

## 前提となる調査結果

- pi-durable（`@earendil-works/pi-durable` 1.3.0, Node >= 22.19）は Experimental で、API はリリース間で予告なく変わる。1.5.0 で永続データの形が変わり、1.4 以前に戻せない（touka の記録）
- pi の CLI（`pi-coding-agent`）は durable を使っていない。durable 上の host プログラムは自前で書く
- 1 つのストレージを開けるのは 1 つの持ち主だけ（プロセス間ロックなし）。PO とサブエージェントは同じ Harness 内の別会話として動かす
- 標準の SQLite ストレージは `entries` / `tasks` / `conversations` / `submissions` / `documents` / `document_revisions` の各テーブルに、1 行 1 レコードの JSON（`record TEXT CHECK (json_valid(record))`）を持つ。M3 で確認した
- サブエージェントの土台は公式 example `test/examples/23-subagent-background.ts` と、[pi-durable-cloudflare](https://github.com/earendil-works/pi-durable-cloudflare) の `search_history`（子会話に委譲し、親には最終回答だけを返す。replay-safe）
- [pi-durable-cloudflare](https://github.com/earendil-works/pi-durable-cloudflare) は Worker と DO で Harness を動かすサンプル。DO の constructor の `blockConcurrencyWhile` で Harness を開き、hibernation と eviction から再開する。実行環境（sandbox）と認証は扱っていない
- Cloudflare Containers は `outboundByHost` と `interceptHttps` で、Worker がコンテナの要求に資格情報を差し込める（`@cloudflare/containers` 0.3.0 以降）
- [touka](https://github.com/L4Ph/touka) は pi 1.5、Agents SDK 0.33、Containers で動き、デプロイ先で確かめられている。ADR 0002 で写す実行環境の層（`server/src/sandbox/`）について、次のことがわかっている
  - コンテナの中に、チェックサムで固定した pi-env デーモンを取得して動かし、stdin と stdout を Workers RPC でつなぐ。pi-env の `Connection` は `node:child_process` を使うので Worker では動かず、プロトコルの部分だけを自前で話す（`connection.ts`）
  - コンテナのディスクは消える前提で扱う。`ToolTask.afterTool` で bash / write / edit のたびに `snapshotContainer()` を取る。snapshot は作成か最後の復元から 30 日で期限が切れる
  - コンテナはすべての HTTPS を傍受されるので、Cloudflare の CA を `SSL_CERT_FILE` などの環境変数で信頼させる
  - 差し込み方式では `gh` のログイン、`/user`、GraphQL が認証されない。PR は REST API を curl で呼んで作る
- Containers は `wrangler dev` で手元の Docker を使って動く。コンテナの中のコードは保存しても再読み込みされず、同時に動かせる数は手元のマシンで決まる。`outboundByHost` と snapshot がローカルで動くかは、ドキュメントで確かめられなかった
- Slack の 2025 年のレート制限の強化（`conversations.history` / `conversations.replies`）は、Marketplace にない外部配布アプリが対象で、自分のワークスペースにだけ入れる社内向けアプリは対象外
- pi-ai 1.5.0 の `cloudflare-workers-ai` provider は `@cf/deepseek-ai/deepseek-v4.1-flash-1017` を持つ（入力 $0.30、出力 $1.20、キャッシュ $0.006 / 1M トークン）。Worker の `AI` binding ではなく REST API を `CLOUDFLARE_API_KEY` と `CLOUDFLARE_ACCOUNT_ID` で呼ぶ
- Workers AI は 2026-11-20 に 24 モデルを廃止した（DeepSeek では V4 Flash 0731、V4 Pro 0813、R1 distill）。V4.1 Flash 1017 は推奨の移行先で、廃止の対象ではない（[changelog](https://developers.cloudflare.com/changelog/post/2026-11-05-planned-model-deprecations/)）

## 構成

- Worker: Slack の要求の署名と、許可したユーザー ID を確かめる入口。検証用に Bearer トークンで認証する Webhook も持つ。スレッド（目標）の ID でセッション DO に振り分ける。Workers AI を呼ぶ Cloudflare の API トークン、GitHub App の秘密鍵、Slack の署名シークレットと bot トークンを secret に持つ
- セッション DO（目標ごと）: Harness（PO・サブエージェントの会話ループ）とセッション DB。Slack のスレッドに返信する
- リポジトリ DO（作業リポジトリごと）: コンテキスト DB。セッション DO から RPC で読み書きする
- コンテナ DO（目標ごと）: ツールの実行（シェル・ファイル編集）だけ。pi-env デーモンを RPC でつなぐ。外向きの接続は制限せず、GitHub への要求にだけ Egress Worker が GitHub App のインストールトークンを差し込む。`/workspace` は snapshot で退避する

配置の判断は [ADR 0002](../adr/pi-durable-dev-env/0002-run-on-cloudflare.md) にある。ローカル版の配置（[ADR 0001](../adr/pi-durable-dev-env/0001-separate-agent-env-from-work-repos.md)）は置き換えた。

## マイルストーン

依存: M1 → M2 → M3 → M11 → M13 → M14 → M5 → M6 → M12 → M7。M8 / M9 は M6 以降に並行可。M10 は最後。M1〜M3 はローカル版（ADR 0001）で行った。M11 と M13 は `wrangler dev` で、M14 以降はデプロイ先で行う。

要件は [requirements.md](requirements.md) にある。

組み合わせる SDK とコードの判断:

- pi-durable-cloudflare のサンプル: 土台として取り込む（M11）。DO を直接使うので、Cloudflare Agents SDK（npm `agents`）を使うかは M11 で決める（touka は使っている）
- touka の実行環境の層: 写す（M11）。pi-env と `createCodingTools()` をそのまま使えるため
- Cloudflare Sandbox SDK: 不採用。exec とファイル操作に委譲する ExecutionEnv を自作することになるため
- pi agent（`@earendil-works/pi-agent-core`）: 不採用。durable は agent-core に依存せず生成ループとツール実行を自前で永続化しており、役割が重なる

| # | マイルストーン | 達成目標 | 完了条件 | 調査・決定事項 | 状態 |
|---|---|---|---|---|---|
| M0 | リポジトリの土台 | テンプレート初期化 | プレースホルダが埋まり `nix flake check` が通る | — | 完了 |
| M1 | 隔離実行環境 | devcontainer（Nix 入り）で Node 22.19+ が動く | コンテナ内で flake の devShell が有効になり `node -v` が通る。`/workspace` がマウントされている | API キーの渡し方（host がホストで動くので不要）、外部ネットワークの許可範囲（M4 へ持ち越し） | 完了 |
| M2 | pi durable の動作 | 公式 example をホストで動かす | faux provider で `14-chat`、実モデルで `16-real-model` が応答する | プロバイダ（Anthropic / OpenAI）、モデル指定。決定: 試験運用は ChatGPT Plus の定額（pi-ai `openai` を Sign in with ChatGPT で使う。PO / design: gpt-6.1-sol、spec / impl: gpt-6-luna）。詳細は [provider-comparison.md](provider-comparison.md)。のちに DeepSeek V4.1 Flash の API キーに変えた（ADR 0002） | 完了 |
| M3 | SQLite 永続化 | ホストで `openNodeSqliteStorage` を使い保存・再開する | sqlite3 で JSON レコードを確認できる。実行途中の kill から `resume()` で再開できる。会話を JSONL で書き出せる | DB ファイルのホスト上の配置（リポジトリ内 / 外）、WAL の扱い。決定: リポジトリ外（`~/.config/pi-agent-filed/session.sqlite`）、WAL は durable の既定のまま。のちに既定を本体の `.data/` に変えた（ADR 0001）。Cloudflare 版では DO の SQLite に置く（ADR 0002） | 完了 |
| M11 | ローカルのミニマム版 | `wrangler dev` で、Worker（Bearer トークンで認証する Webhook）、セッション DO（PO だけ、Workers AI の DeepSeek V4.1 Flash）、コンテナ DO（touka から写した pi-env の RPC と `createCodingTools()`）を動かす。サブエージェント、リポジトリ DO、プレビュー、Slack は入れない | curl で指示を出すと、PO がコンテナの中でファイルを作る。セッション DO を止めても、未完了の submission から再開できる。Bearer トークンのない Webhook を拒否する | V4.1 Flash のモデル ID と定義の方法（pi-ai を上げるか、自前で定義するか）、pi 1.5 への上げ方、Agents SDK を使うか、目標の ID とセッション DO の名前の付け方、touka から写す範囲、コンテナのイメージ（Nix を使うか）。資格情報の差し込みと `snapshotContainer()` がローカルで動くかを調べ、動かなければ M14 で確かめる。ツール呼び出しが入ると assistant message の text ブロックが複数になるので、表示はすべてのブロックを対象にする。`host/`（ローカル版）を消す時期（決定: M11 のあとに消した） | 完了 |
| M4 | 単体コーディングエージェント | M11 に統合した（ExecutionEnv を自作せず、touka の実行環境の層を写すため） | — | ガードの方針と `agents/<repo>/` の形式は M5 に移す | 統合 |
| M13 | Slack の入口 | Slack App を作り、Events API を Worker で受ける。ローカルでは `cloudflared` のトンネル経由で受ける | スレッドで PO と対話できる。1 スレッドが 1 つのセッション DO に対応する。署名が不正な要求と、許可していないユーザーの要求を拒否する。ACK を 3 秒以内に返し、モデルの処理は DO で進める | submission を保存してから ACK する手順、スレッドへの返信を再送するか（touka の outbox を写すか）、Webhook の入口を残すか、Slack App の manifest（touka の `trigger-slack` を参考にする） | 完了 |
| M14 | デプロイ | Worker、DO、コンテナをデプロイし、secret を登録する | ADR 0002 の Verification のうち、資格情報、再開、snapshot の項目をデプロイ先で満たす | デプロイの手順、コンテナの大きさと `sleepAfter`、snapshot の期限（30 日）の確認、Slack の Request URL の切り替え | 進行中 |
| M5 | PO エージェント | PO 用の instructions と、ガードの設定 | Slack のスレッドで対話でき、実行中の steer / follow-up を受け付ける。開発者の確認が必要になったら、スレッドでメンションする。`beforeTool` で危険なコマンドを止められる | PO の責務、目標の決め方、メンションする条件、ガードの方針と `agents/<repo>/` の形式。follow-up を受け付けると 1 回の run で複数の input が完了するので、返信は input 単位ではなく run 単位にする | 未着手 |
| M6 | サブエージェント | spec / design / impl / test / review のサブエージェント。作業の単位ごとに新しい子会話で起動する | PO から spawn・指示・停止・一覧ができ、結果が PO に報告される。サブエージェントの会話が作業の単位を越えて続かない。DO の eviction のあと、実行中のサブエージェントが同じ子会話で再開する | 役割ごとのモデル・ツール、基本の指示の置き場所（本体に置き、`agents/<repo>/` にはリポジトリ固有の追記だけを置く想定）、サブエージェントの再帰を禁止するか、作業の単位の区切り方。各役割の視点や手順は後から整備する | 未着手 |
| M12 | コンテキスト DB | リポジトリ DO のコンテキスト DB と、それを RPC で読み書きするホスト側のツール | エージェントが必要な情報をツールで取得できる。2 つの目標のセッション DO から同時に書け、`goal_id` で区別できる。目標を終えても残る | テーブルの設計（知識・判断・タスク・目標）、セッション DB との関係、git に残す仕様の文書との分担 | 未着手 |
| M7 | エージェント間連携 | 仕様 → 設計 → 実装・テスト → レビューを回し、MVP の確認を経て最終 PR を作る | 1 つの目標が最終 PR まで通る。チーム内の PR はコンテナの中のブランチで目標ブランチにマージされる。MVP をプレビュー URL で確認でき、認証を通らないと届かない。最終 PR は REST API で作る | 成果物の受け渡し（コンテキスト DB / `/workspace` のファイル / `defineDoc`）、チーム内の PR とレビューの記録の形、プレビュー URL の作り方（Worker のルートからコンテナのポートへ転送する）と認証の方式（期限付きの署名 URL か Access か） | 未着手 |
| M8 | 堅牢性 | 長時間運用・障害への耐性 | サブエージェント作業中の eviction と再デプロイから再開できる。`restartLimit` が働き、usage を確認できる。未完了の submission の再開に失敗しても新しい入力を受け付ける | コスト上限（Workers AI と Containers）。alarm は at-least-once なので、スケジュールは冪等にする。snapshot の期限を越える目標の扱い。compaction は会話を作業の単位で区切る前提では補助になるので、PO の長い会話に要るかだけを見る | 未着手 |
| M9 | 観測 | 動作状況の可視化 | `taskGraph` / `watchEvents` で状況を表示できる。SQLite の分析クエリがある | Slack のスレッドに進捗をどこまで出すか（touka はメッセージを編集して出す） | 未着手 |
| M10 | まとめ | 判断と使い方の記録 | ADR と README の使用手順がある | — | 未着手 |

## 記録

### M1 隔離実行環境

- `.devcontainer/devcontainer.json`: debian ベースイメージ + Nix feature。ツールは `flake.nix` の devShell に一本化し、コンテナ内は direnv で有効にする
- 確認結果（`direnv exec . ...`）: Node v22.23.3 / sqlite 3.53.3 / just 1.58.0
- ワークスペースはホストと同じ絶対パスにマウントする。git worktree の `.git` ファイルがホストの絶対パスを指し、`/workspace` だと flake を評価できないため
- git worktree から起動する場合は、共通の `.git` も同じパスでマウントする:
  `devcontainer up --workspace-folder . --mount "type=bind,source=$(cd "$(git rev-parse --git-common-dir)" && pwd),target=<同じパス>"`
- 構成の変更: 当初は host もコンテナ内で動かす予定だったが、隔離が要るのはツールの実行だけなので、host・DB・認証情報をホストに置き実行だけをコンテナに委譲する構成にした（理由は「構成」を参照）。コンテナは実行サンドボックスとして使う
- 既知の問題: devShell の shellHook によるスキル同期（`.agents/skills`）がコンテナ内で `Permission denied` になる。Nix store から読み取り専用のディレクトリがコピーされ、その中に書き込めないため。ツールの動作には影響しない。コンテナ内の pi エージェントは `.agents/skills` を使わないので後回し

### M2 pi durable の動作

> `host/` と、`just ask` などのレシピは M11 のあとに消した（`worker/` に置き換えたため）。以下の M2・M3 の記録は当時のもので、コードは git の履歴にある。

- `host/`: ホストで動かす host の npm パッケージ。`@earendil-works/pi-durable` / `pi-ai` / `chord` を 1.3.0 に固定し、Node 22 の `--experimental-strip-types` で TS を直接実行する（ビルドなし）
- 公式 example（tag `v1.3.0`）を `host/examples/` に移植した。`../../src/index.ts` の import をパッケージ名に変えるだけで動く
- 確認結果: `just chat`（faux）は `Paris.` を返す。`just real-model`（`openai` / `gpt-6.1-sol`、Sign in with ChatGPT）はストリーミングで応答する
- 認証: pi-ai が標準で持つ資格情報ストアは `InMemoryCredentialStore` だけなので、ファイルに保存する `CredentialStore` を `host/auth.ts` に実装した。保存先はリポジトリの外（`~/.config/pi-agent-filed/`、ディレクトリ 700 / ファイル 600、`PI_AGENT_FILED_HOME` で変更可）。ログインは `just login`。のちに既定を本体の `.data/` に変えた（ADR 0001）
- Sign in with ChatGPT はインストールごとに固定の UUID（device ID）を要求する。`LoginOptions.getDeviceId` で渡し、同じディレクトリの `device-id` に保存する
- トークンの更新（refresh）は `Models.getAuth()` がストアの `modify` 内で行う。ストアの排他はプロセス内だけ（durable も 1 ストレージ 1 プロセスなので足りる）

### M3 SQLite 永続化

- `host/ask.ts`（`just ask "質問"`）: root 会話に 1 問投げてストリーミングで表示する。会話は SQLite に残るので、次の実行は前の会話の続きになる。起動時に未完了の submission があれば、新しい質問の前にそれを完了させる（引数なしの `just ask` は再開だけを行う）
- DB の配置: 資格情報と同じリポジトリ外のディレクトリ（`PI_AGENT_FILED_HOME`）に置く。のちに要件を整理し、配置の理由と最終形を [ADR 0001](../adr/pi-durable-dev-env/0001-separate-agent-env-from-work-repos.md) で決め直した
- WAL: `openNodeSqliteStorage` が `journal_mode = WAL` / `synchronous = NORMAL` を自分で設定する。実行中は `-wal` / `-shm` ができ、`close()` で checkpoint されて消える。kill されると残るが、次に開いたときに取り込まれる
- 確認結果: `just db` でテーブルごとの件数、`sqlite3` で `record` 列の JSON（`{"kind":"pi.user","model":[...],"conversationId":1,...}`）を確認できた。`just export` の出力は 1 行 1 件の JSON として全行パースできた
- kill からの再開: ストリーミング中に `kill -9` すると、submission は `placed`、`pi.generation` タスクは `running` のまま残る。再実行すると `harness.inspect()` に出てくるので、`harness.submission(id)` を `wait()` すると完了する
  - 生成は途中からではなく最初からやり直しになる（別の回答になる）。中断した部分は `stopReason: "aborted"` の `pi.assistant` entry として履歴に残るが、モデルに渡す context には入らない（`context()` の contributions が 0 件）
  - kill のたびに、中断した分の生成で使ったプランの枠は無駄になる。M8 で長い生成を扱うときの前提にする
- `just export` は root 会話（ID 1 は root 用に予約されている）の全 entry を出す。fork や中断した entry も含むので、モデルが見た context そのものではない
- 既知の問題（未確認）: 再開した submission の直後に新しい質問を投げると、前の run の LiveDoc 更新が遅れて届いた場合に古い回答と `--- regenerated ---` が表示されうる。表示だけの問題なので M5 の REPL で扱う

### M11 ローカルのミニマム版

- `worker/`: Worker（`src/index.ts`）、セッション DO（`src/session.ts`）、コンテナ DO（`src/sandbox/`）。pi-durable / pi-ai / pi-env / chord は 1.5.0、wrangler は 4.158.0。`just dev` で起動し、`just say <goal> "<text>"` で指示を送り、`just show <goal>` で会話と未完了の submission 数を見る。secret は `worker/.dev.vars`（雛形は `.dev.vars.example`）
- `src/sandbox/` は touka（`25534c7`、MIT。`src/sandbox/LICENSE`）から写した。`connection.ts` と `checkpoint.ts` はほぼそのまま。`container.ts` は古いイメージの修復と起動時の pi-env のダウンロードを削り、pi-env はイメージのビルド時に sha256 で確かめて入れる。`egress.ts` は touka の `connector-github` を使わず、GitHub App のインストールトークンの発行（JWT を WebCrypto で作る）と差し込みだけを書いた。トークンは作業リポジトリ（`GITHUB_REPOSITORY`）と `contents` / `pull_requests` の書き込みに絞る。PAT は使わない（長期のトークンで、個人アカウントに紐づくため）。`env.ts` は principal と grant の判定を削った
- モデル: はじめは pi-ai 1.5.0 の `deepseek` provider の `deepseek-flash`（DeepSeek V4.1 Flash）で確かめ、そのあと Workers AI の `@cf/deepseek-ai/deepseek-v4.1-flash-1017`（`cloudflare-workers-ai` provider）に移した。作業リポジトリのコードを DeepSeek 社に送らず、Cloudflare の中で完結させるため。料金は同じ。資格情報は `createModels({ authContext })` で Worker の env から渡す
- Agents SDK は使わず、DO を直接書いた。サンプル（pi 1.4）から写した部分は 1.5 で `onReport` の引数が `Report` 1 つになり、`closed` の結果が `{ kind }` になっていた
- 確認結果（`wrangler dev`、Docker Desktop 29.9 / arm64）
  - `ctx.container` の `exec`（stdin / stdout）、`interceptOutboundHttps`、`snapshotContainer` と `start({ containerSnapshot })` での復元は、どれもローカルで動く。snapshot を使わずに起動し直すとファイルは消え、snapshot から起動すると戻る
  - コンテナは x86_64 で動く（arm64 の手元ではエミュレーション）
  - PO が `write` と `bash` でコンテナの `/workspace` を編集できる。ツールのたびに snapshot が取られる（1 回あたり約 976MB）
  - 生成の途中で `wrangler dev` を止め、コンテナも消してから起動し直すと、リクエストなしで alarm が Harness を再開し、未完了の submission が完了した。`/workspace` は snapshot から戻った。中断した bash は再実行されない
  - Egress Worker を通した `git ls-remote` と `api.github.com` への curl が通る。コンテナの環境変数に資格情報はない
  - Bearer トークンがない、または違う要求は 401 で拒否する
  - 上の確認は DeepSeek の API 直接で行った。Workers AI に移したあと（`@cf/deepseek-ai/deepseek-v4.1-flash-1017`）も、PO が `write` と `bash` で `/workspace/hello.txt` を作って中身を確かめられた。このモデルは Workers Free プランでは使えない（403、code 5035）ので、Workers Paid にした
- 修正: 再起動のあと、中断したツールの結果を確定するときに afterTool がコンテナの起動前に snapshot を取ろうとして失敗し、run が止まっていた。コンテナが動いていなければ保存するものはないので、checkpoint を飛ばす
- 既知の問題: 無操作でコンテナが止まると、次の最初のツール呼び出しが `pi-env connection lost` で失敗する（2 回目で新しいコンテナにつながる）。ContainerConnection が止まった daemon を検知するのは ping が 30 秒途切れたときだけのため
- 修正: モデルの呼び出しが失敗しても `just show` に何も出なかった。失敗した assistant のエントリは本文が空でエラー文が `errorMessage` にだけ入り、`show` が空のエントリを落としていたため。本文が空なら `errorMessage` を出す
- 未確認（M14 で確かめる）: snapshot の保存にかかる時間と料金（ツールのたびに約 1GB）、デプロイ先での alarm による再開、GitHub App のトークンでの clone / push / PR の作成
### M13 Slack の入口

- `POST /slack/events`（`src/index.ts`）: 署名（`v0:{timestamp}:{body}` の HMAC-SHA256）と 5 分以内の timestamp を確かめ、`app_mention` だけを受け付ける。`SLACK_ALLOWED_USERS` にないユーザーと bot の投稿は捨てる。スレッドの中でもメンションが要る（`message.channels` を購読すると、スレッドとセッションの対応を毎回確かめることになるため）。Bearer トークンの Webhook は検証用に残した
- 目標の ID は `<channel>-<thread_ts>`（`.` は `_`）。submission を保存してから 200 を返す。`requestId` は Slack の `event_id` で、Slack の再送は pi-durable が同じ submission にまとめる
- 返信: `GenerationTask` の `afterResponse` で、`stopReason` が `stop` / `length` / `error` の応答を `chat.postMessage`（`markdown_text`）でスレッドに送る。pi-durable に run の完了を知らせる DO 側のコールバックはなく、`afterRun` は失敗した run で呼ばれないため。モデルの失敗もスレッドに出る。touka の outbox は写さず、送信の失敗はログに出すだけ。PO に返信のツールを持たせる方式は、モデルが呼び忘れると返信が来ないので採らなかった
- Slack App は `worker/slack-manifest.yaml`（`app_mentions:read` と `chat:write`）から作る。ローカルでは `just tunnel`（cloudflared の Quick Tunnel）の URL を Request URL にする
- 確認結果（`wrangler dev`）
  - 自分で署名した要求で、`url_verification` に challenge を返すこと、署名が不正な要求と 5 分より古い timestamp を 401 で拒否すること、許可していないユーザーのメンションがセッションに入らないことを確かめた
  - Slack でメンションすると PO が `bash` でコンテナを確かめ、スレッドに返信した。Markdown も崩れずに表示された。同じスレッドの 2 回目のメンションは同じセッション DO に入り、`/workspace/slack.txt` を作って、1 回目の内容を答えた
- 既知の問題: Quick Tunnel の URL は、cloudflared が動いていても DNS から消えることがある。Slack の要求が届かないときは `just tunnel` を起動し直し、Request URL を貼り直す
- 既知の問題: 復旧で `afterResponse` が呼び直されると、同じ応答が 2 回送られうる。重なりが目立ったら、送った応答の receipt を DO に残す
### M14 デプロイ

- `just deploy`（`wrangler deploy`）でイメージをビルドしてプッシュし、Worker、DO、コンテナを配る。secret は `just secrets`（`wrangler secret bulk worker/.dev.vars`）で登録する。ログは `just tail` で見る
- コンテナは `instance_type` を 1 vCPU・4 GiB・16 GB にした（requirements の見積もりと同じ）。既定の lite では、約 1GB の snapshot と npm のビルドに足りないため
- コンテナ DO は `ctx.container` を直接使うので `sleepAfter` はない。無操作で止まったときの扱いは M8 で見る
- secret を登録する前は `SLACK_SIGNING_SECRET` がなく、Slack の Request URL の Verify が 401 で失敗した。`just secrets` のあとに通った
- 未確認: デプロイ先での Slack の対話、再デプロイ後の再開、snapshot の時間と料金、snapshot の期限、GitHub App のトークンでの clone / push / PR の作成

## 進め方

マイルストーンごとに「計画の提示 → 承認 → 実装」で進め、完了したら状態と分かったことをこのファイルに追記する。
