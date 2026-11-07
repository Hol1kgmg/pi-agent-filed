# List recipes
list:
    @just --list

# Install skills into .claude/skills
skills:
    nix run .#skills-install-local

# List installed skills
skills-list:
    nix run .#skills-list

# Install rules into .agents/rules
rules:
    nix run .#rules-install-local

# List available rules
rules-list:
    nix run .#rules-list

# Update flake.lock, then check
update:
    nix flake update
    nix flake check

# 処理途中のテンプレートを取り込まないため、Dependabot PR が残っていれば止める（adr/from-template/0006）
_template-settled:
    #!/usr/bin/env bash
    set -euo pipefail
    [ -z "${SYNC_IGNORE_OPEN_PRS:-}" ] || exit 0
    open=$(gh pr list -R Hol1kgmg/claude-temp --author app/dependabot --state open --json url,title -q '.[] | "\(.url) \(.title)"') \
        || { echo "gh でテンプレートの PR を確認できない。gh auth login するか、SYNC_IGNORE_OPEN_PRS=1 で無視する" >&2; exit 1; }
    if [ -n "$open" ]; then
        printf 'テンプレートに処理中の Dependabot PR がある。終わってから実行するか、SYNC_IGNORE_OPEN_PRS=1 で無視する:\n%s\n' "$open" >&2
        exit 1
    fi

# Merge template updates from upstream
sync: _template-settled
    #!/usr/bin/env bash
    set -euo pipefail
    git remote get-url upstream >/dev/null 2>&1 \
        || git remote add upstream https://github.com/Hol1kgmg/claude-temp.git
    git fetch --no-tags upstream main
    # 初回（共通祖先なし）はテンプレート生成由来の同一ファイルが全部 both added で衝突するため、
    # upstream 側を採用する。2 回目以降は独自変更を守るため通常マージ。
    # マージコミットであることが必須。squash / rebase すると共通祖先が失われ、
    # 次回以降ツリー全体が衝突する（adr/from-template/0001）
    if git merge-base HEAD upstream/main >/dev/null 2>&1; then
        git merge upstream/main --no-edit || { scripts/resolve-flake-lock.sh && git commit --no-edit; }
    else
        git merge upstream/main --allow-unrelated-histories --no-edit -X theirs
    fi

# Open the template sync PR from template-sync
sync-pr: _template-settled
    #!/usr/bin/env bash
    set -euo pipefail
    [ -z "$(git status --porcelain)" ] || { echo "作業ツリーを clean にしてから実行する" >&2; exit 1; }
    orig=$(git branch --show-current)
    [ -n "$orig" ] || { echo "detached HEAD では実行しない。ブランチに切り替えてから実行する" >&2; exit 1; }
    git fetch --no-tags origin main
    git switch -C template-sync origin/main
    # 確認はこのレシピの依存で済んでいる
    SYNC_IGNORE_OPEN_PRS=1 just sync || {
        printf 'template-sync で止めた。解決して commit し、just _sync-pr-open を実行して %s に戻る\n' "$orig" >&2
        exit 1
    }
    if [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]; then
        echo "取り込む更新はない"
        git switch "$orig"
        exit 0
    fi
    just _sync-pr-open
    git switch "$orig"

# Push template-sync and mark the sync PR ready
_sync-pr-open:
    #!/usr/bin/env bash
    set -euo pipefail
    [ "$(git branch --show-current)" = template-sync ] || { echo "template-sync ブランチで実行する" >&2; exit 1; }
    # upstream remote があると gh は origin より upstream を既定の repo に選ぶ
    export GH_REPO=$(git remote get-url origin | sed -E 's#(\.git)?$##; s#.*github\.com[:/]##')
    # template-sync は template-sync workflow が空コミットで作るブランチなので、毎回作り直す（adr/from-template/0006）
    git push --force origin template-sync
    case "$(gh pr list --head template-sync --state open --json isDraft -q '.[0].isDraft')" in
        true) gh pr ready template-sync ;;
        false) ;;
        *) gh pr create --base main --head template-sync --title "chore: テンプレートの更新を取り込む" \
            --body "**Create a merge commit** でマージする（squash / rebase は共通祖先を壊す。adr/from-template/0001）" ;;
    esac

# Scan working tree for secrets
scan:
    gitleaks dir --verbose

# Scan staged changes for secrets
scan-staged:
    gitleaks protect --staged --verbose

# portless が worktree のブランチ名を前置するのは run のときだけ。リポジトリ名は worktree 内でも本体の .git から取る
# PORTLESS=0 でプロキシを通さず起動したときは PORT が渡されない
# Serve markdown at http://docs.<repo>.localhost:1355
docs *ARGS:
    portless run --name docs.{{file_name(parent_directory(`git rev-parse --path-format=absolute --git-common-dir`))}} sh -c 'markserv . -p "${PORT:-8080}" -a 127.0.0.1 --browser=false "$@"' _ {{ARGS}}

# Install host dependencies
host-install:
    cd host && npm ci

# Sign in with ChatGPT for the openai provider
login:
    cd host && node --experimental-strip-types login.ts

# Run the faux-provider chat example
chat:
    cd host && node --experimental-strip-types examples/14-chat.ts

# Stream an answer from a real model
real-model:
    cd host && node --experimental-strip-types examples/16-real-model.ts

# Recipes that cd into host/ would otherwise resolve a relative path to a different directory than db/export.
export PI_AGENT_FILED_HOME := clean(join(invocation_directory(), env("PI_AGENT_FILED_HOME", justfile_directory() / ".data")))
db := PI_AGENT_FILED_HOME / "session.sqlite"

# Ask the persistent root conversation (no question: finish interrupted inputs)
ask *QUESTION:
    @cd host && node --disable-warning=ExperimentalWarning --experimental-strip-types ask.ts {{quote(QUESTION)}}

# Count stored records per table
db:
    @sqlite3 -readonly {{quote(db)}} "SELECT 'conversations', count(*) FROM conversations UNION ALL SELECT 'entries', count(*) FROM entries UNION ALL SELECT 'tasks', count(*) FROM tasks UNION ALL SELECT 'submissions', count(*) FROM submissions UNION ALL SELECT 'documents', count(*) FROM documents"

# Print the root conversation's entries as JSONL
export:
    @sqlite3 -readonly {{quote(db)}} "SELECT record FROM entries WHERE conversation_id = 1 ORDER BY id"
