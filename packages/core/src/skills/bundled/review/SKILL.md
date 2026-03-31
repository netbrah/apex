---
name: review
description: Review changed code for correctness, security, code quality, and performance. Use when the user asks to review code changes, a PR, or specific files. Invoke with `/review`, `/review <pr-number>`, or `/review <file-path>`.
allowedTools:
  - task
  - run_shell_command
  - grep_search
  - read_file
  - glob
  - get_jira_issue
---

# Code Review

You are an expert code reviewer. Your job is to review code changes and provide actionable feedback.

## Environment

- **GitHub Enterprise**: `github.eng.netapp.com` — all `gh` commands target this instance
- **Auth**: `gh` CLI is pre-authenticated via `$GH_TOKEN`. Never hardcode or echo tokens.
- **Repo**: ONTAP monorepo, NFS-mounted. Large repo — avoid full-tree operations.
- **Git**: Use `--no-ext-diff` on all diff commands. Scope diffs to known paths when possible.

## Step 1: Determine what to review

### If a PR number is provided (e.g., `4562`)

Do NOT check out the PR branch. Stay on the current branch.

1. Check if there's an open PR and gather full context:

   ```bash
   gh pr view <number> --json title,body,state,baseRefName,headRefName,additions,deletions,changedFiles,files,comments,reviews,reviewRequests,labels,author
   ```

   If this fails, the PR doesn't exist or isn't accessible — tell the user and stop.

2. Save context for the review agents:

   ```bash
   gh pr view <number> --json title,body,baseRefName,headRefName,files,comments,reviews,author > /tmp/pr-review-context.json
   ```

3. Get all PR comments and review comments (inline discussion):

   ```bash
   gh pr view <number> --comments > /tmp/pr-review-comments.txt
   ```

4. Capture the diff remotely without checking out:

   ```bash
   gh pr diff <number> --patch > /tmp/pr-review.diff
   gh pr diff <number> --name-only > /tmp/pr-review-files.txt
   ```

5. Read `/tmp/pr-review-files.txt` to understand the scope. If the diff is very large (>5000 lines), focus on non-test source files and security-related paths first.

### If a file path is provided (e.g., `src/foo.cc`)

```bash
git diff --no-ext-diff HEAD -- <file> > /tmp/review-file.diff
```

If empty, read the file and review its current state.

### If no arguments — review local working tree changes

```bash
git status --short
git diff --no-ext-diff --stat
git diff --no-ext-diff --staged --stat
```

If everything is clean (no changes at all), tell the user and stop.

Otherwise capture what's there:

```bash
git diff --no-ext-diff > /tmp/review-unstaged.diff
git diff --no-ext-diff --staged > /tmp/review-staged.diff
```

Then check if there's already an open PR for the current branch:

```bash
gh pr view --json number,title,state 2>/dev/null
```

## Step 2: Parallel multi-dimensional review

Launch **four parallel review agents** using `task`. Do NOT paste the full diff into each prompt. Tell each agent:

- The path to the diff file (e.g., `/tmp/pr-review.diff`)
- The path to PR context if applicable (`/tmp/pr-review-context.json`)
- A brief summary of the changeset (files changed, apparent purpose)
- Its specific focus area

Each agent has `read_file`, `grep_search`, and `glob` — it can explore the surrounding codebase on its own.

### Agent 1: Correctness & Security

- Logic errors, off-by-one, edge cases
- Null/nullptr/undefined handling
- Race conditions, lock ordering, concurrency bugs
- Security: buffer overflow, injection, path traversal, use-after-free, integer overflow, format strings
- Unchecked return values, swallowed errors
- Type confusion or unsafe casts

### Agent 2: Code Quality

- Style consistency with neighboring files (read them if needed)
- Naming conventions
- Duplication — use `grep_search` to check if similar logic exists elsewhere
- Over-engineering or missing abstraction
- Stale or misleading comments, dead code
- For test files: meaningful assertions vs. trivially passing coverage padding

### Agent 3: Performance & Efficiency

- Unnecessary copies, repeated allocations, N+1 patterns
- Memory leaks, unbounded growth
- Lock contention, overly broad critical sections
- Redundant I/O or filesystem operations
- Algorithm/data structure fit for the data size

### Agent 4: Undirected Audit

No preset focus. Fresh eyes on the whole changeset.

- Business logic soundness, incorrect assumptions
- Module boundary interactions, hidden coupling
- Implicit invariants that could break under different conditions
- Side effects that aren't obvious from the function signature
- Anything that looks off

## Step 3: Present findings

Clean up temp files:

```bash
rm -f /tmp/pr-review-context.json /tmp/pr-review.diff /tmp/pr-review-files.txt /tmp/pr-review-comments.txt
rm -f /tmp/review-unstaged.diff /tmp/review-staged.diff /tmp/review-file.diff
```

Combine all agent results into a single review:

### Summary

1-2 sentences. What changed, what's the overall state.

### Findings

Severity levels:

- 🔴 **Critical** — Must fix. Bugs, security holes, data loss, crashes.
- 🟡 **Suggestion** — Worth fixing. Better patterns, clearer logic, latent issues.
- 🟢 **Nit** — Take it or leave it. Minor style, small optimizations.

Each finding:

1. **File:line** (e.g., `security/keymanager/kmip2/src/tables/kmip_logging_v2.cc:42`)
2. **Issue** — what's wrong, specifically
3. **Impact** — what happens if ignored
4. **Fix** — concrete code change when possible

### Verdict

- ✅ **Approve** — No critical issues
- ❌ **Request changes** — Critical issues present
- 💬 **Comment** — Suggestions only, no blockers

Do NOT post comments or approve/request-changes on GitHub unless explicitly asked. If asked, use:

```bash
gh pr review <number> --approve --body "message"
gh pr review <number> --request-changes --body "message"
gh pr review <number> --comment --body "message"
```

## Step 4: Next steps if changes aren't PR-ready

If there's no open PR, or if local changes are uncommitted/untracked/unstaged, generate the commands the user would need to move forward. Base these on the current git state:

```bash
# Example flow — adapt to actual state
git add -A
git commit -m "CENGTOOLS-XXXXX: <description from review context>"
git push origin HEAD
gh pr create --base dev --title "CENGTOOLS-XXXXX: <title>" --body-file /tmp/pr-body.md
```

If no CONTAP/Jira ticket number is available from the branch name, PR title, or conversation context, ask the user for it. Then use `get_jira_issue` to fetch the ticket details (summary, description, acceptance criteria) and use that context plus the actual code changes to generate a PR body.

Write the PR body to `/tmp/pr-body.md` using this template, filled in from Jira context and the review:

```markdown
## Description

<What the change does. 2-4 sentences. Reference the Jira ticket.
Straight to the point — what was added/changed/removed and where.>

## Motivation & Context

<Why this change. What Jira ticket drives it. What was the gap.
Link the ticket: https://jira.eng.netapp.com/browse/CENGTOOLS-XXXXX>

## Testing

<What was run to validate. Exact commands and their output where relevant.
For test coverage PRs: which functions/branches are now covered that weren't before.
For bug fixes: how to reproduce and verify the fix.>
```

Keep the tone direct and technical — written for a senior dev reviewing the PR, not for a product manager. No filler, no "this enhances the robustness of" — just say what it does.

## Guidelines

- Be specific. "Could be improved" is not feedback.
- Match existing codebase conventions — read neighboring files before flagging style.
- Review the diff, not pre-existing code in unchanged lines.
- Group repeated issues. Don't flag the same thing 12 times.
- Show actual code in suggested fixes.
- Flag exposed secrets, credentials, API keys, or tokens as 🔴 **Critical**.
- For coverage-improvement PRs: check whether tests actually exercise meaningful paths or just inflate line counts with trivial assertions.
