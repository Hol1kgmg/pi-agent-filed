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

# Merge template updates from upstream
sync:
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
        git merge upstream/main --no-edit
    else
        git merge upstream/main --allow-unrelated-histories --no-edit -X theirs
    fi

# Scan working tree for secrets
scan:
    gitleaks dir --verbose

# Scan staged changes for secrets
scan-staged:
    gitleaks protect --staged --verbose

# Serve markdown at http://localhost:8080
docs *ARGS:
    markserv . -p 8080 -a 0.0.0.0 --browser=false {{ARGS}}

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

db := env("PI_AGENT_FILED_HOME", home_directory() / ".config/pi-agent-filed") / "session.sqlite"

# Ask the persistent root conversation (no question: finish interrupted inputs)
ask *QUESTION:
    @cd host && node --disable-warning=ExperimentalWarning --experimental-strip-types ask.ts {{quote(QUESTION)}}

# Count stored records per table
db:
    @sqlite3 -readonly {{quote(db)}} "SELECT 'conversations', count(*) FROM conversations UNION ALL SELECT 'entries', count(*) FROM entries UNION ALL SELECT 'tasks', count(*) FROM tasks UNION ALL SELECT 'submissions', count(*) FROM submissions UNION ALL SELECT 'documents', count(*) FROM documents"

# Print the root conversation's entries as JSONL
export:
    @sqlite3 -readonly {{quote(db)}} "SELECT record FROM entries WHERE conversation_id = 1 ORDER BY id"
