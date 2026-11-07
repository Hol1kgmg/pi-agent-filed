---
name: bot-pr-routine
description: Hol1kgmg/claude-temp から生成した派生リポジトリで、bot が作る PR の週次対応をまとめて行う。先に template-sync-review でテンプレート取り込み PR を対応し、続けて dependabot-review で Dependabot PR をレビューする。「bot の PR を対応して」「週次の PR 対応」「ルーティーン」と言われたときに使う。
allowed-tools: Skill, Bash(gh pr list:*), AskUserQuestion
---

# bot-pr-routine — bot PR の週次対応

派生リポジトリには毎週 2 種類の bot PR が届く。この順で対応する。

1. テンプレート取り込み PR（`template-sync` workflow）→ `template-sync-review`
2. Dependabot PR（project inputs など）→ `dependabot-review`

取り込みを先にするのは、取り込み PR が `flake.lock` を大きく変えるためである。Dependabot PR を先にマージすると、取り込み側の `flake.lock` が衝突し `just sync-pr` のやり直しになる。

各スキルのマージは、それぞれのスキルの規則どおりユーザーの明示的な指示があるときだけ行う。

## 手順

### 1. テンプレート取り込み PR

Skill ツールで `template-sync-review` を実行し、完了まで進める。

### 2. 結果の確認

`template-sync-review` の結果で分岐する。

| 結果 | 対応 |
|---|---|
| 取り込み PR をマージした / 取り込み待ちの PR が無かった | 手順 3 へ |
| 取り込み PR をマージしていない（レビューだけ、見送り、CI 失敗など） | 「Dependabot PR を先にマージすると取り込み PR の `flake.lock` が衝突する」と伝え、Dependabot のレビューに進むかを AskUserQuestion で聞く。進まないなら終了する |

取り込み PR をマージした直後は、`flake.lock` に触る Dependabot PR が衝突状態になり、Dependabot が自動で rebase する。`dependabot-review` で CI 実行中・衝突ありと出たものは、時間をおいて再確認するよう伝える。

### 3. Dependabot PR

Skill ツールで `dependabot-review` を実行する（`$ARGUMENTS` に Dependabot の PR 番号があれば渡す）。

`dependabot-review` が使えない（`skills.nix` の `disable` などで無効）ときは、一覧だけを出す。

```bash
gh pr list --author app/dependabot --state open --json number,title,url
```

### 4. まとめ

最後に 1 回だけ、次を短く報告する。

- 取り込み PR: マージ済み / 未マージ（理由） / 無し
- Dependabot PR: マージ済み・要確認・未対応の PR 番号
