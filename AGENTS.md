# First Run
If README.md still contains `{app name}`, this repository was just generated from the template.
Run the `init-from-template` skill before any other work.

# Project Overview
{Describe the project (e.g. Dotfiles management project for macOS using Nix and Home-Manager)}

# Setup and Basic Usage
Setup instructions and basic usage are documented in [README.md](./README.md).

# Directory Structure
{Remove this whole section if a directory structure document is not needed}
See [{DIRECTORY_STRUCTURE_FILE}.md](./{DIRECTORY_STRUCTURE_FILE}.md) for details.

# Troubleshooting
{Remove this whole section if a troubleshooting document is not needed}
- Setup and daily usage issues: See [{TROUBLESHOOTING_FILE}.md](./{TROUBLESHOOTING_FILE}.md)

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
- Responses: `.claude/settings.json` - `language`
- Thinking: English (for token reduction)
