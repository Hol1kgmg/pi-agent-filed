# 全体像

開発者が何をするとエージェントが起動し、どこで定義されたものがどう動くかをまとめる。要件は [requirements.md](requirements.md)、配置の判断は [ADR 0002](../adr/pi-durable-dev-env/0002-run-on-cloudflare.md)、実装の状況と未決の項目は [roadmap.md](roadmap.md) にある。ここに書く内容は計画で、まだ実装していない（ローカル版の M1〜M3 は roadmap.md の記録に残す）。

![構成図](diagrams/pi-durable-cloudflare.png)

## 置き場所

本体と設定はこのリポジトリに置き、Worker と一緒にデプロイする。データと作業リポジトリは Cloudflare の上にある。コンテナに入るのは作業リポジトリのクローンだけなので、エージェントのシェルから本体、設定、DB、資格情報には届かない。

| もの | 場所 | 単位 |
|---|---|---|
| Worker のコード、`agents/<repo>/` | このリポジトリ → デプロイ | — |
| Workers AI を呼ぶ Cloudflare の API トークン、GitHub App の秘密鍵、Slack の署名シークレットと bot トークン | Worker の secret | — |
| セッション DB（Harness） | セッション DO | 目標ごと |
| コンテキスト DB | リポジトリ DO | 作業リポジトリごと |
| クローンと目標ブランチ | コンテナ DO の `/workspace` | 目標ごと |
| `/workspace` の退避 | コンテナの snapshot | 目標ごと |

`<repo>` は GitHub の remote URL で識別する。

```mermaid
flowchart LR
  dev(["開発者"])
  slack["Slack<br/>スレッド = 目標"]
  subgraph CF["Cloudflare"]
    worker["Worker<br/>署名の検証・secret"]
    subgraph SDO["セッション DO（目標ごと）"]
      harness["Harness<br/>PO + サブエージェント"]
      sdb[("セッション DB")]
    end
    rdo[("リポジトリ DO<br/>コンテキスト DB")]
    subgraph CDO["コンテナ DO（目標ごと）"]
      ws["/workspace<br/>クローン + 目標ブランチ"]
    end
    snap[("snapshot<br/>退避")]
    egress["Egress Worker<br/>App トークンを差し込む"]
    llm["Workers AI<br/>DeepSeek V4.1 Flash"]
  end
  gh["GitHub"]
  net["インターネット<br/>npm ほか"]
  dev <-->|"メンション・返信"| slack
  slack -->|"Events API"| worker
  worker --> harness
  harness -->|"返信・メンション"| slack
  harness <--> sdb
  harness <-->|"ホスト側ツール（RPC）"| rdo
  harness -->|"pi-env RPC"| ws
  harness -->|"生成"| llm
  ws <-->|"ツール実行ごと"| snap
  ws --> egress
  egress -->|"push・PR"| gh
  egress -->|"そのまま通す"| net
  dev -->|"プレビュー URL"| worker
```

## 開発者がすること

最初に一度:

```sh
git clone git@github.com:Hol1kgmg/pi-agent-filed.git
cd pi-agent-filed
# Slack App を作り、ワークスペースに入れる
# GitHub App を作り（Contents と Pull requests の Read and write だけ）、作業リポジトリにだけインストールする
# Worker の secret に Workers AI の権限だけの Cloudflare API トークンとアカウント ID、GitHub App の ID と秘密鍵とインストール ID、
#   Slack の署名シークレットと bot トークン、許可する Slack のユーザー ID を登録する
# デプロイする
```

作業リポジトリごとに一度:

```sh
# agents/my-app/ に指示とガードの設定を置いてコミットし、デプロイする
```

目標ごと:

1. Slack で PO にメンションしてスレッドを始め、作業リポジトリと目標を書く
2. スレッドで PO と対話して目標を決める。あとはメンションを待ち、MVP をプレビュー URL で確認し、最終 PR をレビューする

具体的なコマンドは roadmap.md の M11、M13、M14 で決める。

## 起動してから動くもの

PO とサブエージェントは、同じセッション DO の同じ Harness の中で、別の会話として動く。durable のストレージを開けるのが 1 つの持ち主だけだからである。モデルの呼び出しと DB の読み書きは DO で行い、コンテナに届くのはツールの実行（シェル、ファイル編集）だけである。

```mermaid
sequenceDiagram
  actor Dev as 開発者
  participant SL as Slack
  participant W as Worker
  participant S as セッション DO
  participant R as リポジトリ DO
  participant C as コンテナ DO
  participant LLM as Workers AI
  Dev->>SL: PO にメンションしてスレッドを始める
  SL->>W: Events API
  W->>W: 署名とユーザー ID を確かめる
  W->>S: スレッドの ID で DO を開き、submission を保存する
  W-->>SL: ACK（3 秒以内）
  S->>S: blockConcurrencyWhile の中で Harness を開く
  S->>S: agents/repo の指示とガードを読む
  S->>C: 起動し、snapshot から /workspace を戻す。無ければクローンする
  S->>S: 未完了の submission があれば再開
  S->>LLM: PO の応答を生成
  S->>SL: スレッドに返信する
  S->>S: サブエージェントの子会話を作る
  S->>R: 必要な判断・知識をツールで取る
  S->>LLM: サブエージェントの応答を生成
  S->>C: ツール実行（pi-env RPC）。beforeTool のガードを通す
  C->>C: bash / write / edit のあとに snapshot を取る
  S->>R: 成果と判断を書く
  S->>SL: 確認が必要になったら開発者にメンションする
```

## どこで何を定義するか

| もの | 定義する場所 | 誰が変えるか | コンテナから |
|---|---|---|---|
| 会話ループ、Slack と Webhook の入口、サブエージェントの起動、ツール | Worker のコード | 開発者 | 見えない |
| 役割ごとのモデルと基本の指示 | 本体 | 開発者 | 見えない |
| リポジトリ固有の指示とガードの設定 | `agents/<repo>/` | 開発者 | 見えない |
| App トークンを差し込む先（GitHub のホスト）と、トークンの範囲 | Egress Worker のコード | 開発者 | 見えない |
| 実行環境（イメージ、依存、pi-env） | コンテナのイメージ（touka の `sandbox.Dockerfile` から写す） | 開発者 | 見えない |
| 資格情報 | Worker の secret | 開発者 | 見えない |
| 会話ログと再開の状態 | セッション DB | セッション DO | 見えない |
| 知識・判断・タスク・目標の記録 | コンテキスト DB | エージェントがホスト側のツールで | 見えない |
| 仕様の文書 | `/workspace`（作業リポジトリの git） | spec | 書ける |

データの単位と寿命は、[requirements.md](requirements.md) の「コンテキストの要件」にある。

## 1 つの目標が流れる様子

```mermaid
flowchart TB
  dev(["開発者"]) <-->|"Slack のスレッドで目標を決める・確認する"| po["PO"]
  po --> spec["spec<br/>仕様の文書"]
  spec --> design["design<br/>設計"]
  design --> impl["impl<br/>コード"]
  design --> test["test<br/>仕様からテスト"]
  impl --> review["review"]
  test --> review
  review -->|"コンテナの中のブランチを目標ブランチにマージ"| goalbr["目標ブランチ"]
  goalbr -->|"MVP をコンテナで起動し、プレビュー URL で公開"| dev
  goalbr -->|"最終 PR を 1 本"| gh["GitHub"]
  ctx[("コンテキスト DB")]
  spec -.-> ctx
  design -.-> ctx
  impl -.-> ctx
  test -.-> ctx
  review -.-> ctx
  po -.-> ctx
```

サブエージェントは作業の単位ごとに新しい子会話で起動し、終わるときに成果と判断をコンテキスト DB に書く。親の会話には最終の報告だけが返る。次に起動するエージェントは、自分が前に下した判断も他の役割の判断も、同じ DB から取る。
