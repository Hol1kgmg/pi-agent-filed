# Project Overview
pi durable agent を Cloudflare の Durable Object で動かしてツールの実行だけを Cloudflare Containers に隔離し、コンテキストを DO の SQLite で永続化、開発者は Slack で PO 役エージェントと対話し、内部のサブエージェント群が仕様・設計・実装を行う開発環境の検証・調査リポジトリ。

# Implementation Principles

このリポジトリの目的は、要件を満たすエージェント開発環境の実現可能性を検証することである。実装では次の基準に従う。

- 要件を満たす範囲で、シンプルで最小限の構成を選ぶ。
- 検証に必要のない機能追加、汎用化、抽象化は行わない。
- 将来の拡張を見越した仕組みは、検証に必要になった時点で検討する。

# Setup and Basic Usage
Setup instructions and basic usage are documented in [README.md](./README.md).

# Work Rules
1. Propose implementation plan
2. Wait for approval
3. Start implementation

# Comment Policy
- Code: How
- Test code: What
- Commit log: Why
- Code comments: Why not

Code comment rules:
- Write only the reasons (why / why not) that cannot be read from the code. Do not describe what it does or how it works.
- Before writing, ask "if this line were deleted, would the code still make it clear?" If yes, do not write it.
- Keep only background and constraints: external library behavior, browser compatibility, preventing regressions of past bugs, etc.
- Keep it to one line. If it gets longer, that is a design problem, so fix the code instead.

# Tool Usage Policy
**Prefer dedicated tools for file operations by default** (not enforced via `permissions.deny` — occasional Bash use is fine when it's genuinely more convenient):
- `ls`, `find` → `Glob` tool
- `cat`, `head`, `tail` → `Read` tool
- `grep` → `Grep` tool
- `sed`, `awk` → `Edit` tool
- File writing → `Write` tool
- `curl` → `WebFetch` tool

# Language Settings
- Responses: Japanese
- Thinking: English (for token reduction)
