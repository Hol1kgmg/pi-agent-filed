# lockfile の自動更新 — セットアップ手順

`flake.lock` の更新は Dependabot（`nix` ecosystem、[.github/dependabot.yml](../.github/dependabot.yml)）が担う。skill / rules の取得元も `flake = false` な input なので同じ仕組みに乗り、input ごとに PR が立つ。

skill / rules の取得元（`flake = false` な input）を更新する PR は auto-merge しない。`dependabot-review` スキルで差分をレビューし、`ci.yaml` の `nix flake check` が通ったものを手動でマージする。それ以外の PR（ツール系 input、GitHub Actions）は `dependabot-auto-merge.yaml` が auto-merge を設定し、`check` が通ればメジャー更新も含めてマージされる（[ADR 0004](../adr/from-template/0004-auto-merge-non-skill-dependabot-prs.md)）。auto-merge はテンプレートリポジトリでだけ動く。派生リポジトリにも `dependabot.yml` と workflow はそのまま降るが、auto-merge は動かず、すべての PR を `dependabot-review` スキルでレビューして手動でマージする。派生側で止める場合は各 `updates` エントリに `open-pull-requests-limit: 0` を書く。ファイルは同期対象なので削除しない。

**なぜこの構成なのかは [adr/from-template/0003](../adr/from-template/0003-update-skill-sources-via-dependabot.md) にある。**

## ブランチ保護

main を保護し、必須チェックに `check` を指定する。

設定しないと `nix flake check` が落ちている PR もマージできてしまう。Dependabot の PR は `pull_request` トリガーで `ci.yaml` を起動するため、必須チェックにしておけば検証を経ないマージは起きない。

## 手動更新

Dependabot を待たずに更新したいときは `just update` を使う。`nix flake update` の後に `nix flake check` が走る。1 つの input だけ進めるなら `nix flake update <input名>`。

## 既知の弱点

**Dependabot の `nix` 対応は 2026-04 に追加されたもので、gist のような plain git input の追従実績が少ない。** PR が立たない input があれば `just update` で補う。

`ci.yaml` は PR が持ち込んだ flake を `nix flake check` で評価する。secrets を持たず token も読み取り専用なので漏洩経路にはならず、公開リポジトリの GitHub-hosted runner には課金も発生しない。見知らぬ相手の初回 PR は GitHub 既定の first-time contributor 承認で止まるため、追加の設定は要らない。外部コントリビュータが実際に現れたら Settings → Actions の `Require approval for all external contributors` を検討する。
