# 有効にするスキル ID の宣言ファイル。
#
# 取得元は flake.nix の flake = false な input（rev は flake.lock に固定）。
# ID 一覧は `just skills-list` で確認できる。不要なものは行ごと消す。
[
  # anthropics/skills
  "frontend-design"
  "skill-creator"
  "webapp-testing"

  # vercel/ai
  "adr-skill"

  # gist
  "cognitive-rhythm-writing"
  "japanese-tech-writing"

  # addyosmani/web-quality-skills
  "web-quality-audit"
  "performance"
  "core-web-vitals"
  "accessibility"
  "seo"
  "best-practices"

  # nanaism/yomiyasu
  "yomiyasu"

  # cloudflare/security-audit-skill
  "security-audit"

  # Hol1kgmg/skills（必要なリポジトリで有効化する）
  "dependabot-review"
  # "speckit-explain"

  # ./skills（独自）
  "init-from-template"
]
