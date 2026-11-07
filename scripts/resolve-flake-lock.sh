#!/usr/bin/env bash
set -euo pipefail

conflicted=$(git diff --name-only --diff-filter=U)
if [ -z "$conflicted" ]; then
    echo "衝突ではない理由でマージが失敗した。上の git merge の出力を確認する" >&2
    exit 1
fi
if [ "$conflicted" != "flake.lock" ]; then
    printf 'flake.lock 以外も衝突しているため手で解消する:\n%s\n' "$conflicted" >&2
    exit 1
fi

if ! git cat-file -e :2:flake.lock 2>/dev/null || ! git cat-file -e :3:flake.lock 2>/dev/null; then
    echo "flake.lock が片側で削除されているため手で解消する" >&2
    exit 1
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git show :1:flake.lock > "$tmp/base.json" 2>/dev/null || echo '{}' > "$tmp/base.json"
git show :2:flake.lock > "$tmp/ours.json"
git show :3:flake.lock > "$tmp/theirs.json"

# 作り直すと project inputs が最新版になり Dependabot PR と重複するため、書き戻せないものは止める
jq -S -n --slurpfile b "$tmp/base.json" --slurpfile o "$tmp/ours.json" --slurpfile t "$tmp/theirs.json" '
  $b[0] as $b | $o[0] as $o | $t[0] as $t
  | [$o.nodes.root.inputs | to_entries[]
     | select($t.nodes.root.inputs[.key] == null and ($b.nodes.root.inputs // {})[.key] == null)]
  | reduce .[] as $p ($t;
      if ($p.value | type) != "string" then error("follows の project input は書き戻せない: \($p.key)")
      elif $o.nodes[$p.value].flake != false or ($o.nodes[$p.value] | has("inputs")) then error("flake = false でない project input は書き戻せない: \($p.key)")
      elif .nodes[$p.value] != null then error("node 名がテンプレート側と重複: \($p.value)")
      else .nodes[$p.value] = $o.nodes[$p.value] | .nodes.root.inputs[$p.key] = $p.value
      end)
' > "$tmp/flake.lock"

mv "$tmp/flake.lock" flake.lock
git add flake.lock
