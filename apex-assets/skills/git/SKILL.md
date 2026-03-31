---
name: git
description: 'Git workflow and GitHub Enterprise PR operations for large ONTAP monorepo. All local git commands MUST be path-scoped to component directories. Server-side operations (PRs, comments, reviews) use gh CLI via GH_HOST.'
---

# Git (Scoped Local + GitHub Enterprise)

## CRITICAL: Path-Scoping Rule

The ONTAP tree has **1.35M tracked files** and a **104MB index**. Any unscoped git command
(`git status`, `git diff`, `git log` without path args) will take **minutes** or hang forever.

**Every local git command MUST end with `-- <paths>`.**

## Environment

```bash
# GitHub Enterprise — bake into every gh command
export GH_HOST=github.eng.netapp.com

# Repo coordinates (auto-detected from .git/config)
# Owner: streamline  Repo: DOT
```

## Component Paths

These are the component directories you work in. Use them as path suffixes for every git command.
Derive from the ontap-dev MCP `-C` list in config.toml, or use these common groups:

```bash
# Primary work area
KM="security/keymanager/"

# Full scope (covers all workspace folders)
ALL_PATHS="security/keymanager/ cryptomod/ swagger/ message_catalogs/ security/cert_mgmt/ security/ipsec/ security/libsslmgnt security/security_mgwd security/security_shared third_party/commercial/cryptsoft/"

# Single component (use basename from the -C list)
# security/keymanager/keymanager_mgwd → security/keymanager/keymanager_mgwd/
```

---

## Quick Start (Local — Always Scoped)

```bash
# Status — scoped to your components
git status -- security/keymanager/ cryptomod/ swagger/ message_catalogs/

# Unstaged diff — scoped
git diff -- security/keymanager/ cryptomod/

# Staged diff — scoped
git diff --cached -- security/keymanager/

# Diff against HEAD — scoped
git diff HEAD -- security/keymanager/ message_catalogs/ swagger/

# Stage changes
git add security/keymanager/keymanager_mgwd/src/tables/external/Foo.cc

# Commit
git commit -m "CONTAP-XXXXX: description"
```

### BANNED (will hang on 1.35M files)

```bash
git status                    # NO — scans entire tree
git diff                      # NO — diffs entire tree
git log                       # NO — walks all history
git log --oneline             # NO — still walks all history
git stash                     # NO — snapshots entire tree
```

---

## GitHub Enterprise — PR Operations (Fast, API-Based)

All `gh` commands hit the GitHub API — no local tree scan. Always prefix with `GH_HOST`.

### View PRs

```bash
# Your open PRs
GH_HOST=github.eng.netapp.com gh pr list --author $(whoami) --state open

# View a specific PR
GH_HOST=github.eng.netapp.com gh pr view <number> --json number,title,url,headRefName,state

# Files changed in a PR
GH_HOST=github.eng.netapp.com gh pr view <number> --json files --jq '.files[].path'
```

### PR Review Comments (Inline — On Specific Lines/Files)

This is the key workflow for "fetch comments so an agent can address them":

```bash
# Get ALL inline review comments on a PR (file, line, author, body)
GH_HOST=github.eng.netapp.com gh api repos/streamline/DOT/pulls/<number>/comments \
  --jq '.[] | {path: .path, line: .line, body: .body, author: .user.login, created: .created_at}'

# Filter to unresolved/actionable comments (exclude your own replies)
GH_HOST=github.eng.netapp.com gh api repos/streamline/DOT/pulls/<number>/comments \
  --jq '[.[] | select(.user.login != "palanisd")] | group_by(.path) | .[] | {file: .[0].path, comments: [.[] | {line: .line, author: .user.login, body: .body}]}'
```

### PR Reviews (Top-Level Approve/Request Changes)

```bash
# All reviews with state
GH_HOST=github.eng.netapp.com gh pr view <number> --json reviews \
  --jq '.reviews[] | {author: .author.login, state: .state, body: .body}'

# Just the latest state per reviewer
GH_HOST=github.eng.netapp.com gh api repos/streamline/DOT/pulls/<number>/reviews \
  --jq '[.[] | {author: .user.login, state: .state}] | group_by(.author) | map(last)'
```

### PR General Comments (Conversation Tab)

```bash
GH_HOST=github.eng.netapp.com gh pr view <number> --json comments \
  --jq '.comments[] | {author: .author.login, body: .body, created: .createdAt}'
```

### PR Diff (Server-Side — Fast)

```bash
# Full diff via API (no local tree involved)
GH_HOST=github.eng.netapp.com gh pr diff <number>

# Just filenames
GH_HOST=github.eng.netapp.com gh pr diff <number> --name-only
```

---

## Address Review Comments Workflow

When asked to "address PR comments" or "fix review feedback":

1. **Fetch inline comments** grouped by file:

   ```bash
   GH_HOST=github.eng.netapp.com gh api repos/streamline/DOT/pulls/<N>/comments \
     --jq '[.[] | select(.user.login != "palanisd")] | group_by(.path) | .[] | {file: .[0].path, comments: [.[] | {line: .line, author: .user.login, body: .body}]}'
   ```

2. **For each file with comments**: read the file locally, understand the feedback, make the fix.

3. **Stage and commit** the fixes with a descriptive message referencing the review.

---

## Diagnosing Breaking Changes (Scoped)

### Step 1: Recent commits on a file/directory

```bash
# Last 10 commits on a specific file (fast — single file)
git log --oneline -10 -- security/keymanager/keymanager_mgwd/src/tables/external/Foo.cc

# Last 10 commits on a component
git log --oneline -10 -- security/keymanager/keymanager_mgwd/

# With full messages (to see JIRA IDs)
git log -10 -- security/keymanager/keymanager_mgwd/src/tables/external/Foo.cc
```

### Step 2: Commit details

```bash
# Summary + affected files (fast, no diff content)
git show --stat <commit>

# Diff for a specific file only
git show <commit> -- security/keymanager/keymanager_mgwd/src/tables/external/Foo.cc
```

### Step 3: Blame (single file — always fast)

```bash
git blame security/keymanager/keymanager_mgwd/src/tables/external/Foo.cc
git blame -L 100,120 security/keymanager/keymanager_mgwd/src/tables/external/Foo.cc
git show <commit_from_blame>
```

### Step 4: Compare revisions (scoped)

```bash
git diff <old_commit>..<new_commit> -- security/keymanager/keymanager_mgwd/
git diff HEAD~5..HEAD -- security/keymanager/keymanager_mgwd/src/tables/
```

### Step 5: Retrieve old content (single file — always fast)

```bash
git show <commit>:security/keymanager/keymanager_mgwd/src/tables/external/Foo.cc
git show <commit>~1:security/keymanager/keymanager_mgwd/src/tables/external/Foo.cc
```

### Typical defect investigation flow

1. `git log --oneline -10 -- <suspect_file>` → scan for relevant changes
2. `git blame -L <range> <suspect_file>` → find commit that touched the broken line(s)
3. `git show --stat <commit>` → confirm author, JIRA, affected files
4. `git show <commit> -- <suspect_file>` → see exact diff
5. `git diff <prev>..<commit> -- <file>` → compare before/after

### Search by JIRA (scoped)

```bash
git log --oneline --grep='CONTAP-XXXXX' -- security/keymanager/
```

---

## Guardrails

- Do NOT run `git push` or `git reset --hard` unless the user explicitly asks.
- Do NOT force-push (`git push --force`) without explicit approval.
- Do NOT run bare `git stash` — it snapshots the entire 1.35M file tree. If needed, use `git stash push -- <paths>`.
- Stay on the current branch unless instructed otherwise.
- **NEVER run an unscoped git command.** If you catch yourself typing `git diff` without `-- <paths>`, STOP and add the path suffix.

---

## Troubleshooting

- **git command hangs**: you forgot the path scope. Ctrl+C and re-run with `-- <paths>`.
- **"not a git repository"**: `cd` to the workspace root first.
- **Auth issues with gh**: check `gh auth status` and ensure token is configured for github.eng.netapp.com.
- **No PR found for branch**: the branch may not have a PR yet. Use `gh pr list` to find PRs by author.
