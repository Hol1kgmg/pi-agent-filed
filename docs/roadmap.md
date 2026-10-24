# ロードマップ

ホストで [pi-durable](https://github.com/earendil-works/pi/tree/main/packages/durable) を動かしてツールの実行だけを devcontainer に隔離し、開発者が PO 役エージェントと対話し、内部のサブエージェント群が仕様・設計・実装を行う開発環境を作るための検証計画。

## 前提となる調査結果

- pi-durable（`@earendil-works/pi-durable` 1.3.0, Node >= 22.19）は Experimental で、API はリリース間で予告なく変わる
- pi の CLI（`pi-coding-agent`）は durable を使っていない。durable 上の host プログラムは自前で書く
- 1 つのストレージを開けるのは 1 プロセスだけ（プロセス間ロックなし）。PO とサブエージェントは同じ Harness 内の別会話として動かす
- 標準の SQLite ストレージは `entries` / `tasks` / `conversations` / `submissions` / `documents` / `document_revisions` の各テーブルに、1 行 1 レコードの JSON（`record TEXT CHECK (json_valid(record))`）を持つ。「SQLite に JSON 行として格納する」方針は標準ストレージで満たせる見込み（M3 で検証）
- サブエージェントの土台は公式 example `test/examples/23-subagent-background.ts`

## 構成

- ホスト: durable の host（PO・サブエージェントの会話ループ）、SQLite の DB、プロバイダの認証情報
- devcontainer: ツールの実行（シェル・ファイル編集）だけ。host から `RemoteExecutionEnv` 経由でコンテナ内の pi-env デーモンに委譲する
- 隔離が要るのは任意のコマンドを実行するツールだけで、会話ループと永続化は動かす場所に依存しない。認証トークンと DB をエージェントのシェルから読めない位置に置ける。M11（Cloudflare の host → devcontainer の pi-env）と同じ形なので、M11 はストレージの差し替えで済む

## マイルストーン

依存: M1 → M2 → M3 → M4 → M5 → M6 → M7 → M11。M8 / M9 は M6 以降に並行可。M10 は最後。

durable の API はストレージ非依存なので、ローカル版（M2〜M7）で書いた host を M11 でほぼそのまま Cloudflare に載せる。

組み合わせる SDK の判断:

- Cloudflare Agents SDK（npm `agents`）: 採用（M11）。durable が DO SQLite ストレージと `onWake` による alarm 再開を公式に持つため
- pi agent（`@earendil-works/pi-agent-core`）: 不採用。durable は agent-core に依存せず生成ループとツール実行を自前で永続化しており、役割が重なる

| # | マイルストーン | 達成目標 | 完了条件 | 調査・決定事項 | 状態 |
|---|---|---|---|---|---|
| M0 | リポジトリの土台 | テンプレート初期化 | プレースホルダが埋まり `nix flake check` が通る | — | 完了 |
| M1 | 隔離実行環境 | devcontainer（Nix 入り）で Node 22.19+ が動く | コンテナ内で flake の devShell が有効になり `node -v` が通る。`/workspace` がマウントされている | API キーの渡し方（host がホストで動くので不要）、外部ネットワークの許可範囲（M4 へ持ち越し） | 完了 |
| M2 | pi durable の動作 | 公式 example をホストで動かす | faux provider で `14-chat`、実モデルで `16-real-model` が応答する | プロバイダ（Anthropic / OpenAI）、モデル指定。決定: 試験運用は ChatGPT Plus の定額（pi-ai `openai` を Sign in with ChatGPT で使う。PO / design: gpt-6.1-sol、spec / impl: gpt-6-luna）。詳細は [provider-comparison.md](provider-comparison.md) | 完了 |
| M3 | SQLite 永続化 | ホストで `openNodeSqliteStorage` を使い保存・再開する | sqlite3 で JSON レコードを確認できる。実行途中の kill から `resume()` で再開できる。会話を JSONL で書き出せる | DB ファイルのホスト上の配置（リポジトリ内 / 外）、WAL の扱い。決定: リポジトリ外（`~/.config/pi-agent-filed/session.sqlite`）、WAL は durable の既定のまま | 完了 |
| M4 | 単体コーディングエージェント | `CodingTools` + `RemoteExecutionEnv`（コンテナ内の pi-env デーモン） | ホストの host からコンテナ内のファイルを編集できる。`beforeTool` で危険なコマンドを止められる | pi-env の起動方法、ホストとコンテナ間の通信、コンテナの外部ネットワークの許可範囲、ガードの方針 | 未着手 |
| M5 | PO エージェント | 開発者と対話する入口（readline REPL + PO 用 instructions） | 対話でき、実行中の steer / follow-up を受け付ける | PO の責務、承認の手順 | 未着手 |
| M6 | サブエージェント | spec / design / impl の常駐サブエージェント | PO から spawn・指示・停止・一覧ができ、結果が PO に報告される | 役割ごとのモデル・ツール、サブエージェントの再帰を禁止するか | 未着手 |
| M7 | エージェント間連携 | 仕様 → 設計 → 実装 → レビューを PO の承認付きで回す | 1 つのお題が最後まで通る | 成果物の受け渡し（workspace のファイル / `defineDoc`） | 未着手 |
| M8 | 堅牢性 | 長時間運用・障害への耐性 | サブエージェント作業中の再起動から再開できる。compaction と `restartLimit` が働き、usage を確認できる | compaction の閾値、コスト上限 | 未着手 |
| M9 | 観測 | 動作状況の可視化 | `taskGraph` / `watchEvents` で状況を表示できる。SQLite の分析クエリがある | TUI / Web UI の要否 | 未着手 |
| M11 | Cloudflare 版 | Cloudflare Agents SDK の Agent（Durable Object）内で Harness を開き、ストレージを DO SQLite（`openDurableObjectSqliteStorage`）にする | `wrangler dev` で PO と対話でき、alarm（`onWake`）で再開できる。コード実行は devcontainer 内の pi-env デーモン（`RemoteExecutionEnv`）に委譲する | 実行環境（pi-env / Cloudflare Containers / Sandbox）、UI 接続 | 未着手 |
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

- `host/`: ホストで動かす host の npm パッケージ。`@earendil-works/pi-durable` / `pi-ai` / `chord` を 1.3.0 に固定し、Node 22 の `--experimental-strip-types` で TS を直接実行する（ビルドなし）
- 公式 example（tag `v1.3.0`）を `host/examples/` に移植した。`../../src/index.ts` の import をパッケージ名に変えるだけで動く
- 確認結果: `just chat`（faux）は `Paris.` を返す。`just real-model`（`openai` / `gpt-6.1-sol`、Sign in with ChatGPT）はストリーミングで応答する
- 認証: pi-ai が標準で持つ資格情報ストアは `InMemoryCredentialStore` だけなので、ファイルに保存する `CredentialStore` を `host/auth.ts` に実装した。保存先はリポジトリの外（`~/.config/pi-agent-filed/`、ディレクトリ 700 / ファイル 600、`PI_AGENT_FILED_HOME` で変更可）。ログインは `just login`
- Sign in with ChatGPT はインストールごとに固定の UUID（device ID）を要求する。`LoginOptions.getDeviceId` で渡し、同じディレクトリの `device-id` に保存する
- トークンの更新（refresh）は `Models.getAuth()` がストアの `modify` 内で行う。ストアの排他はプロセス内だけ（durable も 1 ストレージ 1 プロセスなので足りる）

### M3 SQLite 永続化

- `host/ask.ts`（`just ask "質問"`）: root 会話に 1 問投げてストリーミングで表示する。会話は SQLite に残るので、次の実行は前の会話の続きになる。起動時に未完了の submission があれば、新しい質問の前にそれを完了させる（引数なしの `just ask` は再開だけを行う）
- DB の配置: 資格情報と同じリポジトリ外のディレクトリ（`PI_AGENT_FILED_HOME`）に置く。M4 からリポジトリはコンテナにマウントされるので、リポジトリ内に置くとエージェントのシェルが会話履歴を読み書きできてしまう
- WAL: `openNodeSqliteStorage` が `journal_mode = WAL` / `synchronous = NORMAL` を自分で設定する。実行中は `-wal` / `-shm` ができ、`close()` で checkpoint されて消える。kill されると残るが、次に開いたときに取り込まれる
- 確認結果: `just db` でテーブルごとの件数、`sqlite3` で `record` 列の JSON（`{"kind":"pi.user","model":[...],"conversationId":1,...}`）を確認できた。`just export` の出力は 1 行 1 件の JSON として全行パースできた
- kill からの再開: ストリーミング中に `kill -9` すると、submission は `placed`、`pi.generation` タスクは `running` のまま残る。再実行すると `harness.inspect()` に出てくるので、`harness.submission(id)` を `wait()` すると完了する
  - 生成は途中からではなく最初からやり直しになる（別の回答になる）。中断した部分は `stopReason: "aborted"` の `pi.assistant` entry として履歴に残るが、モデルに渡す context には入らない（`context()` の contributions が 0 件）
  - kill のたびに、中断した分の生成で使ったプランの枠は無駄になる。M8 で長い生成を扱うときの前提にする
- `just export` は root 会話（ID 1 は root 用に予約されている）の全 entry を出す。fork や中断した entry も含むので、モデルが見た context そのものではない

## 進め方

マイルストーンごとに「計画の提示 → 承認 → 実装」で進め、完了したら状態と分かったことをこのファイルに追記する。
