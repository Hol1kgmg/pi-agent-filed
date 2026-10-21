# ロードマップ

devcontainer 上で [pi-durable](https://github.com/earendil-works/pi/tree/main/packages/durable) を動かし、開発者が PO 役エージェントと対話し、内部のサブエージェント群が仕様・設計・実装を行う開発環境を作るための検証計画。

## 前提となる調査結果

- pi-durable（`@earendil-works/pi-durable` 1.3.0, Node >= 22.19）は Experimental で、API はリリース間で予告なく変わる
- pi の CLI（`pi-coding-agent`）は durable を使っていない。durable 上の host プログラムは自前で書く
- 1 つのストレージを開けるのは 1 プロセスだけ（プロセス間ロックなし）。PO とサブエージェントは同じ Harness 内の別会話として動かす
- 標準の SQLite ストレージは `entries` / `tasks` / `conversations` / `submissions` / `documents` / `document_revisions` の各テーブルに、1 行 1 レコードの JSON（`record TEXT CHECK (json_valid(record))`）を持つ。「SQLite に JSON 行として格納する」方針は標準ストレージで満たせる見込み（M3 で検証）
- サブエージェントの土台は公式 example `test/examples/23-subagent-background.ts`

## マイルストーン

依存: M1 → M2 → M3 → M4 → M5 → M6 → M7。M8 / M9 は M6 以降に並行可。

| # | マイルストーン | 達成目標 | 完了条件 | 調査・決定事項 | 状態 |
|---|---|---|---|---|---|
| M0 | リポジトリの土台 | テンプレート初期化 | プレースホルダが埋まり `nix flake check` が通る | — | 完了 |
| M1 | 隔離実行環境 | devcontainer（Nix 入り）で Node 22.19+ が動く | コンテナ内で flake の devShell が有効になり `node -v` が通る。`/workspace` がマウントされている | API キーの渡し方、外部ネットワークの許可範囲 | 未着手 |
| M2 | pi durable の動作 | 公式 example を動かす | faux provider で `14-chat`、実モデルで `16-real-model` が応答する | プロバイダ（Anthropic / OpenAI）、モデル指定 | 未着手 |
| M3 | SQLite 永続化 | `openNodeSqliteStorage` で保存・再開する | sqlite3 で JSON レコードを確認できる。実行途中の kill から `resume()` で再開できる。会話を JSONL で書き出せる | DB ファイルの配置（コンテナ内 / ボリューム）、WAL の扱い | 未着手 |
| M4 | 単体コーディングエージェント | `CodingTools` + `NodeExecutionEnv` | コンテナ内のファイルを編集できる。`beforeTool` で危険なコマンドを止められる | ガードの方針 | 未着手 |
| M5 | PO エージェント | 開発者と対話する入口（readline REPL + PO 用 instructions） | 対話でき、実行中の steer / follow-up を受け付ける | PO の責務、承認の手順 | 未着手 |
| M6 | サブエージェント | spec / design / impl の常駐サブエージェント | PO から spawn・指示・停止・一覧ができ、結果が PO に報告される | 役割ごとのモデル・ツール、サブエージェントの再帰を禁止するか | 未着手 |
| M7 | エージェント間連携 | 仕様 → 設計 → 実装 → レビューを PO の承認付きで回す | 1 つのお題が最後まで通る | 成果物の受け渡し（workspace のファイル / `defineDoc`） | 未着手 |
| M8 | 堅牢性 | 長時間運用・障害への耐性 | サブエージェント作業中の再起動から再開できる。compaction と `restartLimit` が働き、usage を確認できる | compaction の閾値、コスト上限 | 未着手 |
| M9 | 観測 | 動作状況の可視化 | `taskGraph` / `watchEvents` で状況を表示できる。SQLite の分析クエリがある | TUI / Web UI の要否 | 未着手 |
| M10 | まとめ | 判断と使い方の記録 | ADR と README の使用手順がある | — | 未着手 |

## 進め方

マイルストーンごとに「計画の提示 → 承認 → 実装」で進め、完了したら状態と分かったことをこのファイルに追記する。
