# Codex の実行許可ルール

`default.rules` は Codex 専用のコマンド実行許可を管理する。`.claude/settings.json` の Bash 許可リストを移植している。
共有 Markdown ルールの `rules/`、`rules.nix`、`.agents/rules/` とは独立して、このディレクトリの実ファイルを Git で管理する。

Codex は信頼済みプロジェクトの `.codex/rules/*.rules` を起動時に読み込む。変更後は Codex を再起動する。
`allow` は一致するコマンドのサンドボックス外実行を承認なしで許可する。他のルールや管理ポリシーによる制約は引き続き適用される。
WebFetch、WebSearch、Write、Skill はシェルコマンドではないため、このファイルには定義しない。

コマンドを実行せずにルールを確認できる。

```bash
codex execpolicy check --rules .codex/rules/default.rules -- git status
codex execpolicy check --rules .codex/rules/default.rules -- npm install
```

前者は `allow`、後者はこのルールに一致しないことを確認する。

仕様: [Codex Rules](https://learn.chatgpt.com/docs/agent-configuration/rules)
