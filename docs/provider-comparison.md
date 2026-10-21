# モデルプロバイダ比較

M2 で使うモデルプロバイダを決めるための比較。対象は `@earendil-works/pi-ai` / `@earendil-works/pi-durable` 1.3.0。

- 調査日: 2026-10-21
- pi のソース: `earendil-works/pi` main `cae9fd2`（2026-10-21）の `packages/ai` / `packages/durable`
- モデルカタログ: npm `@earendil-works/pi-ai@1.3.0` の `dist/providers/data/*.json`（models.dev から生成）
- API キーは手元になく、実際の呼び出しは未実施。性能はソースと公開情報からの判断で、M2 で実測する

## 決定（2026-10-21）

**試験運用として ChatGPT Plus（$20/月）の定額で始める。** pi-ai の `openai` プロバイダを「Sign in with ChatGPT」（OAuth）で使う。

| 役割 | モデル（初期値） | 理由 |
|---|---|---|
| PO / design | `openai/gpt-6.1-sol` | 判断の質を優先。Plus の枠は 5 時間で 15〜160 メッセージと少ないので、呼び出し回数の少ない役割に回す |
| spec / impl | `openai/gpt-6-luna` | Plus の枠が 5 時間で 350〜3,000 メッセージと多い。ツール呼び出しの多い役割向き |
| compaction | 各会話のモデル | durable 1.3.0 の仕様（「4. コンテキストウィンドウと compaction」） |

- M2 で確かめること: 1 回の API 呼び出しが枠を何メッセージ分消費するか、1 日 3 時間の稼働で 5 時間の上限に当たるか
- 枠が足りない場合の移行先: DeepSeek API の従量課金（標準の想定で月 $70〜$130、「7. 月額の試算」）または ChatGPT Pro（$100〜、5 時間の上限なし）

検討した他の案（API の従量課金）:

| 案 | 構成 | 向いている場合 |
|---|---|---|
| A. 単一プロバイダ | Anthropic のみ。PO / design: `claude-opus-5-5`、spec / impl: `claude-sonnet-5-5`、軽い補助: `claude-haiku-5-5` | 性能を最優先し、月 $400〜$2,000 を許容できる |
| B. 役割ごとの組み合わせ | PO / design: `anthropic/claude-opus-5-5`、spec / impl: `anthropic/claude-sonnet-5-5`、常駐の下働き: `deepseek/deepseek-flash` | A の費用を下げたい |
| C. DeepSeek 単一 | PO / design: `deepseek/deepseek-v4-pro`、spec / impl: `deepseek/deepseek-flash` | 費用を最小にしたい。データが中国の事業者で処理されることを許容できる |

## 比較対象と pi-ai の対応

| プロバイダ | pi-ai provider | 使う API 実装 | 認証（env） |
|---|---|---|---|
| Anthropic | `anthropic` | `anthropic-messages` | `ANTHROPIC_API_KEY`（ほかに `ANTHROPIC_AUTH_TOKEN`、Workload Identity Federation） |
| OpenAI | `openai` | `openai-responses` | `OPENAI_API_KEY` |
| OpenAI（サブスク） | `openai-codex` | `openai-codex-responses` | ChatGPT の OAuth のみ（API キー不可） |
| Google Gemini | `google` | `google-generative-ai` | `GEMINI_API_KEY` |
| Google Vertex | `google-vertex` | `google-vertex` | `GOOGLE_CLOUD_API_KEY` または ADC + `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_LOCATION` |
| Amazon Bedrock | `amazon-bedrock` | `bedrock-converse-stream` | `AWS_BEARER_TOKEN_BEDROCK` / `AWS_PROFILE` / アクセスキー ほか |
| OpenRouter | `openrouter` | `openai-completions`（Claude は `anthropic-messages`） | `OPENROUTER_API_KEY` |
| Cloudflare Workers AI | `cloudflare-workers-ai` | `openai-completions` | `CLOUDFLARE_API_KEY` + `CLOUDFLARE_ACCOUNT_ID` |
| Cloudflare AI Gateway | `cloudflare-ai-gateway` | `anthropic-messages` / `openai-responses` / `openai-completions` | `CLOUDFLARE_API_KEY` + `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_GATEWAY_ID` |
| DeepSeek | `deepseek` | `openai-completions`（`thinkingFormat: "deepseek"`） | `DEEPSEEK_API_KEY` |

### DeepSeek V4 Flash について

- DeepSeek 公式では `deepseek-v4-flash` は**提供終了済み**。旧名のリクエストは受け付けるが、中身は DeepSeek-V4.1-Flash-1017 に置き換わり、Flash の料金で課金される。現行の名前は `deepseek-flash`
- pi-ai 1.3.0 の `deepseek` プロバイダのカタログにも `deepseek-v4-flash` はなく、`deepseek-flash`（V4.1 Flash）と `deepseek-v4-pro` だけ
- V4 Flash そのものを使える経路は OpenRouter（`deepseek/deepseek-v4-flash`、`-0731`）と Cloudflare Workers AI（`@cf/deepseek-ai/deepseek-v4-flash-0731`）。ただし Workers AI の V4 Flash（$0.44 / $1.32）は V4.1 Flash（$0.30 / $1.20）より高く、画像入力もない
- このため以下では「DeepSeek Flash」として **V4.1 Flash（`deepseek-flash`）** を比較する

## 1. エージェント性能

| プロバイダ | 主なモデル | PO（対話・判断）向き | impl（コード編集）向き | 備考 |
|---|---|---|---|---|
| Anthropic | Opus 5.5 / Sonnet 5.5 / Haiku 5.5 | ◎ Opus 5.5 | ◎ Sonnet 5.5 | thinking レベルを off〜max まで細かく指定できる |
| OpenAI | gpt-6.1-sol / gpt-6-luna / gpt-6-astra | ◎ astra / sol | ◎ sol | Terminal-Bench 2.0 の集計サイトでは GPT-5.5 系が首位（下記） |
| Google | gemini-4-argon / gemini-3.8-flash | ○ | ○ | `gemini-4-argon` は最大出力 32K と小さい |
| DeepSeek | deepseek-flash / deepseek-v4-pro | △ | ○（安価な量産向き） | 最大出力 384K。V4 Pro は画像入力なし |
| Bedrock / OpenRouter / Cloudflare | 上記モデルの再販 | 元モデル次第 | 元モデル次第 | 性能は同じモデルなら変わらない。差は経路の機能（後述） |

- 公開ベンチマーク: Terminal-Bench 2.0 の公式リーダーボード（tbench.ai）は本文を取得できなかった。集計サイト BenchLM（2026-10-20 更新）では GPT-5.5 82%、Claude Opus 4.7 69.4%、DeepSeek V4 Pro 0813 67.9%。ただし Opus 5.5 / gpt-6 系 / Gemini 4 / V4.1 Flash は載っておらず、集計サイト間でも値がずれる。**最新モデルの順位は判断材料にしない**
- PO と impl の違い: PO は長い対話で開発者の意図を保ち、承認の判断を誤らないことが重要（大きいモデル + 高い thinking）。impl はツール呼び出しの回数が多く、1 回あたりのコストと速度が効く（中位モデル + 中程度の thinking）
- 1 つの会話の中でモデルを切り替えると thinking ブロックの署名が引き継げない（`google-shared.ts` などは同じ provider・model のときだけ thinking を残す）。役割 = 会話ごとにモデルを固定する設計なら問題にならない

## 2. pi-ai での対応状況

ソースを読んで確認した結果。

| 項目 | anthropic | openai | openai-codex | google | google-vertex | amazon-bedrock | openrouter | cloudflare-workers-ai | cloudflare-ai-gateway | deepseek |
|---|---|---|---|---|---|---|---|---|---|---|
| プロンプトキャッシュ | ◎ `cache_control` を自動付与。`long` で 1h TTL | ◎ `prompt_cache_key` に `sessionId` | ◎ `prompt_cache_key` に `sessionId` | △ 暗黙キャッシュのみ。`sessionId` は使わない | △ 同左 | ○ Claude 系のみ `cachePoint`（`long` で 1h） | ○ `x-session-id` で同じ上流に寄せる。Claude は `cache_control` | △ `cacheRetention: "long"` のときだけキー送信 | 経路の API に従う | ○ サーバ側の自動プレフィックスキャッシュ |
| thinking レベル | ◎ off〜max（モデルによる） | ◎ off〜max（モデルによる） | ◎ | ○ minimal〜high（xhigh / max なし） | ○ 同左 | ○ Claude は adaptive / budget | モデル次第 | モデル次第 | 経路の API に従う | ○ low / high / max |
| ストリーミング | ✓ | ✓ | ✓（WebSocket、SSE にフォールバック） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| リトライ | durable 側で共通（下記） | 同左 | 同左 + 独自の 429 待ち | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 | 同左 |
| deferred response | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| 画像入力（tool result の画像） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓（Claude 系） | モデル次第 | モデル次第 | モデル次第 | `deepseek-flash` のみ ✓ |

補足:

- **キャッシュと `sessionId`**: durable は会話ごとに `ProviderDoc` へ `sessionId`（uuidv7）を保存し、生成と compaction で渡す（`durable/src/harness/provider.ts`）。これを実際にキャッシュの鍵として使うのは OpenAI 系（`prompt_cache_key`）と OpenRouter（`x-session-id`）。Anthropic / Bedrock / DeepSeek はプレフィックス一致なので `sessionId` 不要。Google は pi-ai が明示キャッシュ（`cachedContent`）を作らないため、暗黙キャッシュ頼み
- **キャッシュ保持時間**: 既定は `short`。`cacheRetention: "long"`（または env `PI_CACHE_RETENTION=long`）で Anthropic は 1h、OpenAI は長期保持を指定する。常駐サブエージェントは呼び出し間隔が 5 分を超えやすいので、Anthropic なら `long` を検討する
- **compaction はキャッシュを使わない**: `compaction.ts` は `cacheRetention: "none"` で要約を呼ぶ
- **リトライ**: pi-ai の `retryProviderRequest` は既定 `maxRetries: 0`。リトライは durable の `DEFAULT_RETRY_POLICY`（3 回、基準 2 秒、最大 60 秒）がプロバイダ共通で行うので差はない
- **deferred response**: pi-ai の型（`SimpleStreamOptions.deferred`、`fetchDeferred`）と durable のポーリング処理はあるが、`fetchDeferred` を実装しているのは `faux` だけ。1.3.0 時点ではどの実プロバイダでも使えない
- **カタログの価格は古いことがある**: 例として Cloudflare AI Gateway 経由の `claude-sonnet-5-5` の `cacheRead` が 0.2（公式は 0.10）。durable の usage / コスト表示はカタログ値で計算されるので、M8 のコスト上限は公式の請求で確かめる

## 3. コスト

USD / 100 万トークン。公式ページで確認（出典は末尾）。

| モデル | 入力 | キャッシュ読み | キャッシュ書き | 出力 | 長いプロンプトの割増 |
|---|---|---|---|---|---|
| Claude Opus 5.5 | 4.00 | 0.20 | 5.00（5m）/ 8.00（1h） | 20.00 | なし（1M まで同額） |
| Claude Sonnet 5.5 | 2.00 | 0.10 | 2.50 / 4.00 | 10.00 | なし |
| Claude Haiku 5.5 | 0.10 | 0.01 | 0.125 / 0.20 | 0.50 | 100K 超は 0.50 / 0.05 / 0.625 / 2.50（5 倍） |
| gpt-6-astra | 10.00 | 1.00 | 12.50（30m） | 50.00 | 272K 超は約 2 倍 |
| gpt-6.1-sol | 2.00 | 0.10 | 2.50（30m） | 10.00 | 272K 超は 4.00 / 0.20 / 15.00 |
| gpt-6-luna | 0.10 | 0.01 | 0.125（30m） | 0.50 | 272K 超は 0.20 / 0.02 / 0.75 |
| gemini-4-argon | 2.00（12/1 から 4.00） | 0.10 | 暗黙のみ | 10.00（12/1 から 20.00） | — |
| gemini-3.8-flash | 0.75（2027/1/1 から 1.50） | 0.075 | 保存 0.50/h | 3.75 | — |
| DeepSeek Flash（V4.1） | 約 0.28（¥2） | 約 0.006（¥0.04） | 0（入力扱い） | 約 1.12（¥8） | なし。ただし北京時間の平日日中は上記、それ以外は半額 |
| DeepSeek V4 Pro | 約 1.26（¥9） | 約 0.04（¥0.30） | 0 | 約 3.78（¥27） | 同上 |
| Workers AI: deepseek-v4.1-flash-1017 | 0.30 | 0.006 | — | 1.20 | — |
| Workers AI: deepseek-v4-flash-0731 | 0.44 | 0.014 | — | 1.32 | — |

- DeepSeek は公式に人民元表示（ピーク時）。USD は 1 元 = 0.14 ドル換算の目安。ピーク時間は北京時間の平日 9:00–12:00 / 14:00–18:00（日本時間 10:00–13:00 / 15:00–19:00）で、**日本の作業時間とほぼ重なる**
- Bedrock の Claude は global 推論プロファイルで Anthropic と同額、リージョン指定（`jp.` など）は 1.1 倍（pi-ai カタログ）
- OpenRouter はモデル単価に上乗せしないが、クレジット購入時に手数料がかかる（率は FAQ ページで取得できず未確認）。BYOK は月 $25,000 分まで手数料なし
- 役割ごとに安いモデルを混ぜられるか: どのプロバイダも大・中・小のモデルを持つので、**単一プロバイダ内でも混ぜられる**。Anthropic なら Opus / Sonnet / Haiku、OpenAI なら astra / sol / luna

## 4. コンテキストウィンドウと compaction

| モデル | コンテキスト | 最大出力 |
|---|---|---|
| Claude Opus 5.5 / Sonnet 5.5 / Haiku 5.5 | 1M | 128K |
| gpt-6 系 | 272K（6.1-sol は codex 経由で 500K） | 128K |
| gemini-4-argon / 3.8-flash | 1M | 32K / 64K |
| DeepSeek Flash / V4 Pro | 1M | 384K |

durable の compaction への影響:

- 既定値は `reserveTokens: 16384`、`keepRecentTokens: 20000`、`backgroundTokens: 32768`（`durable/src/harness/agent.ts`）。compaction は `contextWindow - reserveTokens` を超えたときに走るので、**1M モデルでは既定のままだと約 98 万トークンまで要約されない**。毎ターンの入力が膨らみ、キャッシュ読みでも費用と待ち時間が増える
- Haiku 5.5 は 100K 超で単価が 5 倍、gpt-6 系は 272K 超で約 2 倍になる。`CompactionSettings.modelOverrides`（`"provider/modelId"` ごとに `reserveTokens` などを上書き）で、割増の手前で compaction が走るように調整する
- **compaction は会話自身のモデルで要約する**（`compaction.ts` が `agent.model` を使う）。「compaction 専用の安いモデル」を指定する設定は 1.3.0 にない。安いモデルで要約したい場合は host 側で独自実装が必要（M8 で判断）
- 例（M8 の初期値案）: Opus / Sonnet は `reserveTokens: 800000`（約 200K で compaction）、Haiku は `reserveTokens: 916000`（約 84K で compaction）

## 5. 認証と運用

| プロバイダ | `.env` で渡せるか | レート制限 | 課金上限 |
|---|---|---|---|
| Anthropic | ✓ `ANTHROPIC_API_KEY` | 最初の Start tier でも各モデル 1,000 RPM / 2M ITPM / 400K OTPM。キャッシュ読みは ITPM に数えない | ✓ 組織とワークスペースごとに月額上限を設定できる。tier ごとの上限（Start $500/月） |
| OpenAI | ✓ `OPENAI_API_KEY` | tier 制（今回未確認） | プロジェクト単位の予算設定（今回未確認） |
| OpenAI（codex） | ✗ OAuth のみ。devcontainer では対話ログインが必要 | サブスクの枠 | 定額 |
| Google | ✓ `GEMINI_API_KEY` | tier 制（今回未確認）。無料枠のデータは製品改善に使われうる | 未確認 |
| Vertex / Bedrock | △ ADC / AWS 資格情報。コンテナへの受け渡しが増える | クラウドのクォータ | クラウドの予算アラート |
| OpenRouter | ✓ `OPENROUTER_API_KEY` | 上流次第 | プリペイドのクレジット |
| Cloudflare | ✓ 3 つの env | アカウント単位 | Workers Paid / AI Gateway のプリペイドクレジット |
| DeepSeek | ✓ `DEEPSEEK_API_KEY` | 同時実行数で制限（Flash 2,500 / Pro 500） | プリペイド残高。データは中国の事業者が処理する |

- サブスクリプションの OAuth（`anthropic` の Claude Pro/Max、`openai-codex`）は自作の常駐エージェント基盤から使う前提では選ばない。API キーで従量課金にする
- `.env` は `.gitignore` 済み。devcontainer には `--env-file` か `remoteEnv` で渡す（キーをファイルにコミットしない）

## 6. M11（Cloudflare 版）との相性

- Workers からは `fetch` でどのプロバイダの HTTPS API も呼べる。pi-ai の `google-vertex` / `amazon-bedrock` は ADC ファイルや AWS SDK の資格情報チェーンに依存するので、Workers では使いにくい
- AI Gateway 自体は Anthropic / OpenAI / Google AI Studio / Vertex / Bedrock / OpenRouter / DeepSeek / Workers AI などに対応している
- ただし **pi-ai の `cloudflare-ai-gateway` プロバイダのカタログは Anthropic（Claude）・OpenAI・Workers AI のモデルだけ**。Gemini とネイティブ DeepSeek は、AI Gateway 経由にするならカタログ追加（`models.json` / `registerProvider`）が要る
- まとめ: Anthropic と OpenAI は、ローカルでは直接、M11 では `cloudflare-ai-gateway` 経由に切り替えるだけで同じモデル ID を使える。DeepSeek Flash は Workers AI の `@cf/deepseek-ai/deepseek-v4.1-flash-1017`（$0.30 / $1.20）が使えるが、pi-ai 1.3.0 のカタログにはまだない

## 7. 月額の試算（1 日 3 時間 × 30 日 = 90 時間）

前提（M2 で実測して補正する）:

- 呼び出し = モデルへのリクエスト 1 回。1 回あたりキャッシュ済み入力 80K、新規入力 3K、出力 1.5K（thinking 込み）
- 1 時間あたりの呼び出し数: 軽め 120 回（PO と対話中心）、標準 300 回（エージェント 1〜2 体がほぼずっと作業）、重め 600 回（サブエージェント 3 体以上が並行）

| 構成 | 1 回あたり | 軽め（月 10,800 回） | 標準（月 27,000 回） | 重め（月 54,000 回） |
|---|---|---|---|---|
| 案 A: Anthropic（Opus 2 割 / Sonnet 8 割） | $0.037 | 約 $400 | 約 $990 | 約 $1,980 |
| Sonnet 5.5 のみ / gpt-6.1-sol のみ | $0.031 | 約 $330 | 約 $820 | 約 $1,650 |
| 案 C: DeepSeek（V4 Pro 2 割 / Flash 8 割）日中 | $0.0050 | 約 $54 | 約 $134 | 約 $268 |
| 同・夜間/週末（半額） | $0.0025 | 約 $27 | 約 $67 | 約 $134 |
| DeepSeek Flash のみ・日中 | $0.0030 | 約 $32 | 約 $81 | 約 $162 |
| Haiku 5.5 / gpt-6-luna のみ（文脈 100K 以下） | $0.0019 | 約 $21 | 約 $51 | 約 $103 |

- 文脈の長さが最も効く。compaction の閾値を 100K 前後に下げると、どの構成も 3〜5 割下がる見込み

## 8. 定額プランでの運用

| プロバイダ | 可否 | 理由 |
|---|---|---|
| Anthropic（Pro / Max） | 不可 | 規約で、サブスクの OAuth トークンを他の製品・ツール（Agent SDK を含む）で使うことは禁止されている。pi-ai の `anthropic` OAuth は Claude Code になりすます実装（`user-agent: claude-cli`、ツール名を Claude Code に合わせる）なので使わない |
| OpenAI（ChatGPT） | 可（公式・プレビュー） | 「Sign in with ChatGPT」で、オープンソース・ローカル実行のアプリからプランの枠を使える。pi-ai の `openai` プロバイダがこの流れを実装している（`auth/oauth/openai-chatgpt.ts`: 動的クライアント登録、scope `chatgpt.tokens.use.direct`、Responses API に直接送る） |
| Google（Gemini） | 不可 | pi-ai の `google` は `GEMINI_API_KEY` だけで、サブスク経由の経路がない |
| DeepSeek | 不可 | 公式の定額プランはない。定額をうたうのは非公式の転売サイト |

ChatGPT プランの条件:

- 価格: Go $8 / Plus $20 / Pro $100・$200・$500
- Plus の上限は 5 時間あたり gpt-6.1-sol 15〜160、gpt-6-sol 15〜150、gpt-6-astra 5〜45、gpt-6-luna 350〜3,000 メッセージ。週の上限もある（数値は非公開）。Pro には 5 時間の上限がない
- 枠は ChatGPT 本体・Codex と共有。アプリごとの上限は設定できるが、枠は増えない
- プレビューなので使えないパラメータがある（`prompt_cache_retention`、`max_output_tokens`、`temperature` など）。pi-ai は OAuth のとき `prompt_cache_retention` などを省いて送る。仕様は変わりうる
- API 呼び出し 1 回が何メッセージ分になるかは公式資料に書かれていない
- `openai-codex`（`chatgpt.com/backend-api` を使う旧経路）は使わず、`openai` の Sign in with ChatGPT を使う
- devcontainer での注意: OAuth のコールバックは `127.0.0.1:1455` で受ける（`PI_OAUTH_CALLBACK_HOST` で変更可）。ログイン時はポート 1455 をホストへ転送する。取得したトークンはコミットしない

## 推薦の理由（API 従量課金の場合）

### 案 A: Anthropic 単一

1. pi-ai の対応が最も厚い。`cache_control` の自動付与、1h キャッシュ、off〜max の thinking、tool result の画像がすべて使える
2. キャッシュ読みが ITPM に数えられず、Start tier でもサブエージェント複数の常駐に十分なレート制限がある
3. 1M コンテキストが割増なし（Opus / Sonnet）。compaction の閾値を `modelOverrides` で自由に下げられる
4. 組織・ワークスペース単位の月額上限があり、M8 の「コスト上限」をプロバイダ側でも担保できる
5. M11 で `cloudflare-ai-gateway` に同じモデル ID のまま移れる

OpenAI 単一（PO: gpt-6-astra か gpt-6.1-sol、impl: gpt-6.1-sol、補助: gpt-6-luna）も機能面はほぼ同等で、価格も近い。Anthropic を推す差は、272K を超えると割増になる点と、上限設定を今回確認できていない点。

### 案 B: 役割ごとの組み合わせ

| 役割 | モデル | 理由 |
|---|---|---|
| PO | `anthropic/claude-opus-5-5`（thinking high） | 対話と承認の判断。呼び出し回数は少ないので単価より質 |
| spec | `anthropic/claude-sonnet-5-5`（thinking medium） | 文章の質と単価の釣り合い |
| design | `anthropic/claude-opus-5-5`（thinking high） | 後工程への影響が大きい |
| impl | `anthropic/claude-sonnet-5-5`（thinking medium〜high） | ツール呼び出しが多い。キャッシュ読み $0.10 が効く |
| 常駐の下働き | `deepseek/deepseek-flash`（thinking low） | 1M コンテキストで割増なし、キャッシュ読み約 $0.006、最大出力 384K。ログ要約やテスト結果の監視など量が多い作業向け |
| compaction | 各会話のモデル（1.3.0 の仕様） | 専用モデルは指定できない。必要なら M8 で独自実装を検討 |

- Haiku 5.5 は 100K 以下なら DeepSeek Flash より安い（入力 $0.10 対 約 $0.28）。DeepSeek Flash が有利なのは、100K を超える長い文脈を安く扱う場合と、日本時間の夜間・週末（半額）
- 注意点: キーと課金が 2 系統になる。DeepSeek はデータが中国の事業者で処理される。V4.1 Flash は M11 の AI Gateway カタログにまだない

## 出典（確認日 2026-10-21）

- Anthropic 価格: https://platform.claude.com/docs/en/about-claude/pricing
- Anthropic レート制限・上限: https://platform.claude.com/docs/en/api/rate-limits
- OpenAI 価格: https://developers.openai.com/api/docs/pricing （openai.com/api/pricing は 403）
- Gemini 価格: https://ai.google.dev/gemini-api/docs/pricing
- DeepSeek モデルと価格: https://api-docs.deepseek.com/zh-cn/quick_start/pricing （英語版は表を取得できず）
- Cloudflare AI Gateway 対応プロバイダ: https://developers.cloudflare.com/ai-gateway/usage/providers/
- Cloudflare Workers AI 価格: https://developers.cloudflare.com/workers-ai/platform/pricing/
- OpenRouter プロンプトキャッシュ: https://openrouter.ai/docs/guides/best-practices/prompt-caching
- OpenRouter FAQ（手数料・BYOK）: https://openrouter.ai/docs/faq
- Terminal-Bench 2.0（集計サイト、参考のみ）: https://benchlm.ai/benchmarks/terminal-bench-2
- Claude Code の認証に関する規約: https://code.claude.com/docs/en/legal-and-compliance
- Sign in with ChatGPT（オープンソース向け）: https://developers.openai.com/siwc/token-sharing-open-source
- 同・プレビューの制限: https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- ChatGPT / Codex の価格と上限: https://learn.chatgpt.com/docs/pricing
- pi ソース: https://github.com/earendil-works/pi （`packages/ai/src/api/*.ts`、`packages/ai/src/providers/*.ts`、`packages/durable/src/harness/{agent,compaction,generation,provider}.ts`）

未確認のまま残した項目: OpenAI / Google のレート制限と課金上限、OpenRouter のクレジット購入手数料の率、最新モデル同士のエージェント性能の比較（M2 で実測する）。
