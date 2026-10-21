# プロバイダ比較検証プロンプト

新しいセッションでこのファイルを読み込ませて使う（例: 「PROMPT_provider-comparison.md の指示に従って」）。

---

## 背景

このリポジトリは、devcontainer 上で [pi-durable](https://github.com/earendil-works/pi/tree/main/packages/durable)（`@earendil-works/pi-durable` 1.3.0）を動かし、開発者が PO 役エージェントと対話し、内部のサブエージェント群（spec / design / impl）が仕様・設計・実装を行う開発環境を検証している。全体像と進捗は [docs/roadmap.md](docs/roadmap.md) を参照。

現在は M2（pi durable の動作確認）の手前で、使うモデルプロバイダを決める必要がある。モデルアクセスは `@earendil-works/pi-ai`（`createModels()` + `models.setProvider(xxxProvider())`）経由になる。

## 依頼

pi-ai が対応するプロバイダのうち、メジャーな選択肢を比較し、このプロジェクトで採用するプロバイダ（と役割ごとのモデル）を推薦する。

### 比較対象

| プロバイダ | pi-ai の provider |
|---|---|
| Anthropic | `anthropic` |
| OpenAI | `openai`（サブスクリプション経由の `openai-codex` も補足として） |
| Google Gemini | `google`（`google-vertex` も補足として） |
| Amazon Bedrock | `amazon-bedrock` |
| OpenRouter | `openrouter` |
| Cloudflare | `cloudflare-workers-ai` / `cloudflare-ai-gateway`（M11 の Cloudflare 版との相性を見るため） |

### 比較軸

1. **エージェント性能**: ツール呼び出しの精度、長いコーディングタスクでの安定性。PO（対話・判断）と impl（コード編集）で求める性能が違う点を考慮する
2. **pi-ai での対応状況**: ソース（`packages/ai/src/providers/`）を読んで確認する
   - プロンプトキャッシュ（durable は会話ごとの `sessionId` を渡す）
   - thinking レベル、ストリーミング、リトライ、deferred response
   - 画像入力（`read` ツールが画像を返す）
3. **コスト**: 入出力トークン単価とキャッシュ割引。サブエージェントを常駐させる前提で、役割ごとに安いモデルを混ぜられるか
4. **コンテキストウィンドウ**: durable の compaction 設定（`reserveTokens` など）への影響
5. **認証と運用**: devcontainer に API キーを `.env` で渡せるか、レート制限、課金の上限設定
6. **M11 との相性**: Cloudflare Workers から呼べるか、AI Gateway を挟めるか

### 進め方

- pi のソースは `git clone --depth 1 --filter=blob:none --sparse https://github.com/earendil-works/pi.git` で scratchpad に取得し、`packages/ai` と `packages/durable` を読む
- 価格・コンテキスト長・レート制限は記憶に頼らず、各社の公式ページを Web で確認し、出典 URL と確認日を残す
- API キーが手元にあるプロバイダだけ、実際に呼んで確かめてよい。キーをファイルに書いたり、コミットしたりしない
- このリポジトリの AGENTS.md の Work Rules（計画提示 → 承認 → 実装）に従う。コードを書く場合は先に計画を示す

### 成果物

- `docs/provider-comparison.md`: 比較表（比較軸ごと）、出典、推薦とその理由
- 推薦は「単一プロバイダ」と「役割ごとの組み合わせ（PO / spec / design / impl / compaction 用）」の 2 案を出す
- 決定後、`docs/roadmap.md` の M2 行の「調査・決定事項」に結論を 1 行で追記する
- 最後に、決めるべきこと（どの案を採るか）を開発者に質問して終える
