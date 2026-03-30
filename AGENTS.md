# AGENTS.md — Apex (NetApp Proprietary Layer)

> **YOU ARE ON `feat/apex-embed-assets`** — the proprietary tier.
> `dev` = public engine. This branch = thin NetApp veneer on top of dev.
> Never push this branch to a public remote. Never merge public sorties directly here — merge to dev first, then rebase.

---

## Architecture

```
feat/apex-embed-assets  ← YOU ARE HERE (NetApp APEX distribution)
        ↑ rebase
      dev                ← public engine (netbrah/qwen-code, open-source)
        ↑ merge upstreams
  QwenLM/qwen-code  +  google-gemini/gemini-cli
```

**Internal format**: Google `@google/genai` Content[] types (lingua franca — every wire converts to/from this)
**ContentGenerator pattern**: 4 pluggable backends: Gemini (native), Anthropic /messages, OpenAI /responses, Qwen/DashScope

### Wire Protocol Status

| Wire              | Status     | Implementation                                 |
| ----------------- | ---------- | ---------------------------------------------- |
| generateContent   | Native     | GeminiContentGenerator                         |
| /responses        | ✅ Shipped | OpenAIContentGenerator (responsesConverter.ts) |
| /messages         | ✅ Shipped | AnthropicContentGenerator (converter.ts)       |
| /chat/completions | ✅ Shipped | OpenAI-compat via responses path               |

---

## What's Proprietary (This Branch Only)

| Path                                               | Content                                                                     | Why Proprietary                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------ |
| `.qwen/settings.json`                              | Corp MCP servers (mastra-search, reviewboard), Anthropic auth, model config | Has netapp.com email, corp MCP binary paths            |
| `.qwen/APEX.md`                                    | Operator protocol (Delta/APEX wingman doctrine)                             | Corp identity, internal comms style                    |
| `.bin/ontap-apex`                                  | Hermetic launcher script                                                    | Corp deployment, env var setup                         |
| `scripts/postinstall-apex.js`                      | Downloads MCP server binaries to `~/.apex/bin/`                             | `@netapp/seclab-apex` npm package                      |
| `scripts/publish-artifacts.js`                     | Pushes to Artifactory                                                       | Corp Artifactory URL                                   |
| `packages/core/src/lsp/ontap-bridge/`              | ONTAP LSP Python bridge + tests + fixtures                                  | ONTAP-specific, btools references, keymanager fixtures |
| `AGENTS.md` (this file)                            | Corp context + proxy config                                                 | Corp proxy URL                                         |
| `DEPLOYMENT.md`                                    | Artifactory publish procedure                                               | Corp Artifactory                                       |
| `integration-tests/proxy-e2e/helpers/proxy-rig.ts` | Corp proxy URL as default                                                   | `llm-proxy-api.ai.eng.netapp.com` fallback             |

---

## Proxy Configuration

```bash
# Set in ~/.bashrc — do NOT hardcode in source files on dev branch
export OPENAI_API_KEY="<from NetApp vault or ~/.bashrc>"
export OPENAI_BASE_URL="https://llm-proxy-api.ai.eng.netapp.com"

# Optional model overrides (defaults shown):
export PROXY_GPT_MODEL="gpt-4.1-mini"
export PROXY_CLAUDE_MODEL="claude-sonnet-4.6"

# For Anthropic /messages directly:
export ANTHROPIC_API_KEY="$OPENAI_API_KEY"      # proxy accepts same key
export ANTHROPIC_BASE_URL="https://llm-proxy-api.ai.eng.netapp.com"
```

---

## Build & Test — Full Reference

### 1. Unit Tests (run after every change — fast, no network)

```bash
# All unit tests
npm run test

# Single package
npx vitest run packages/core
npx vitest run packages/cli

# Single file (fastest iteration)
npx vitest run packages/core/src/core/anthropicContentGenerator/anthropicContentGenerator.test.ts
npx vitest run packages/core/src/tools/omissionPlaceholderDetector.test.ts

# Watch mode during development
npx vitest packages/core --watch
```

### 2. Proxy E2E Tests (required for wire-layer changes — needs corp proxy)

```bash
# Build first (e2e tests spawn the actual binary)
npm run build

# Full proxy e2e (GPT + Claude via Vertex AI)
npx vitest run --root ./integration-tests proxy-e2e

# Smoke only (fastest — 4 tests, ~30s)
npx vitest run --root ./integration-tests proxy-e2e/smoke

# Tools test (file read/write/shell via proxy)
npx vitest run --root ./integration-tests proxy-e2e/tools
```

**What proxy-e2e covers**:

- `smoke.test.ts`: GPT basic prompt, Claude via Vertex AI, invalid key rejection, structured JSON events
- `tools.test.ts`: file read, file write, shell commands, grep search via live tool calls

**Required env** (check first if tests fail):

```bash
echo $OPENAI_API_KEY    # must be non-empty
echo $OPENAI_BASE_URL   # must be https://llm-proxy-api.ai.eng.netapp.com
```

### 3. Full Integration Tests

```bash
# All integration tests (no sandbox required)
npm run test:e2e

# Full preflight (lint + format + build + typecheck + test — run before merge)
npm run preflight
```

### 4. Build & Bundle

```bash
npm run build    # compile TypeScript
npm run bundle   # bundle for distribution (SEA binary)
```

---

## Sortie Instructions — ALL AGENTS READ THIS

### You Are a Sortie Agent If:

- You are on a `feat/` or `fix/` branch (not `dev`, not `feat/apex-embed-assets`)
- C2 dispatched you via the sortie board

### Rules

1. **Work ONLY on your assigned branch** — do NOT switch, do NOT merge
2. **Do NOT push to dev or feat/apex-embed-assets** — C2 merges
3. **Do NOT revert other agents' commits**
4. **Commit frequently** with conventional commit messages (`feat:`, `fix:`, `test:`, `refactor:`)

### Test Mandate (NON-OPTIONAL)

**Every sortie MUST include tests.** No exceptions. Minimum requirements:

| Change type      | Required tests                                                      |
| ---------------- | ------------------------------------------------------------------- |
| New function     | 3–5 unit tests: happy path, null/empty input, error path, edge case |
| Bug fix          | 1 regression test that fails BEFORE the fix, passes AFTER           |
| New wire field   | Unit test for field presence, unit test for null/missing case       |
| Converter change | Round-trip test: input → convert → assert output fields             |
| Tool change      | Mock-based unit test + at least 1 proxy e2e if output changes       |

**Test file location**: co-located with source (same directory, `.test.ts` suffix)

**Test patterns**:

```typescript
// Unit test skeleton
import { describe, it, expect, vi } from 'vitest';

describe('MyFeature', () => {
  it('happy path — does the thing', () => { ... });
  it('returns empty array on null input', () => { ... });
  it('throws on invalid config', () => { ... });
  it('handles edge case: empty content blocks', () => { ... });
});

// Mock HTTP (for converter tests)
import { createMockContentGenerator } from '@qwen-code/test-utils';

// Mock file system
import { vol } from 'memfs';
vi.mock('node:fs/promises');
```

### Wire-Layer Sorties: E2E Required

If your sortie touches any of these, proxy e2e is **mandatory before marking complete**:

- `packages/core/src/core/anthropicContentGenerator/`
- `packages/core/src/core/openaiResponsesContentGenerator/`
- `packages/core/src/core/contentGenerator.ts`
- `packages/core/src/tools/` (any tool)
- `integration-tests/proxy-e2e/`

Run sequence:

```bash
npm run build
npx vitest run --root ./integration-tests proxy-e2e
```

### Sortie Completion Gate

Your **final commit message** OR a `SORTIE-NOTES.md` in the repo root MUST contain:

```
## Sortie Completion Notes
- Unit tests: [PASS/FAIL — npx vitest run packages/core]
- Proxy e2e: [PASS/FAIL/SKIPPED (not a wire change)]
- Wire behavior changed: [yes/no — if yes: which field/event, which wire]
- New feature: [yes/no — if yes: suggest FQ-{N} or CA-{N}, tier: public/proprietary]
- Null-space gap closed: [yes/no — if yes: which field, remaining gap count]
- Cross-pollination: [yes/no — does XLI (Rust/codex-cli) need this port?]
- Regression risk: [low/medium/high — why]
```

C2 reads this at merge time and runs the doc update gate (evidence ledger, feature registry, wire audit, KPIs). You write code + tests + notes; C2 handles the docs.

### Convergence (Re-dispatch)

If you are re-dispatched on a branch with existing commits:

1. `git log --oneline` — read what's done
2. Check if `SORTIE-NOTES.md` exists → fill in missing fields only
3. Check if tests were already run → re-verify results, don't re-run blindly
4. Continue from the last completed step

---

## Hub Reference

Coordination hub: `~/Projects/cli-ops/`

| Question                       | File                                                    |
| ------------------------------ | ------------------------------------------------------- |
| What are we building?          | `cli-ops/AGENTS.md` §Big Picture                        |
| Feature registry (FQ-1..FQ-25) | `cli-ops/AGENTS.md` §Feature Registry                   |
| What should I work on?         | `cli-ops/sortie-board/SORTIE-BOARD.md`                  |
| Active branch status           | `cli-ops/sortie-board/active-sorties.md`                |
| Null-space gaps (Apex)         | `cli-ops/docs/null-space/01-gemini-to-messages.md`      |
| What we added vs upstream      | `cli-ops/docs/feature-delta/01-gemini-vs-qwen.md`       |
| Features to port from XLI      | `cli-ops/docs/feature-delta/03-cross-implementation.md` |
| How ops work                   | `cli-ops/docs/03-OPERATIONAL-MODEL.md`                  |
| KPIs                           | `cli-ops/docs/04-OBJECTIVES-AND-KPIs.md`                |
| Procedures                     | `cli-ops/docs/05-RUNBOOK.md`                            |

### Features to Port from XLI → Apex

| Port                           | Source in XLI                             | Priority |
| ------------------------------ | ----------------------------------------- | -------- |
| Sandboxing (seatbelt/landlock) | `codex-rs/` security crate                | P0       |
| Guardian approval flow         | `codex-rs/core/src/`                      | P1       |
| Rollout recording + truncation | `codex-rs/core/src/`                      | P1       |
| Commit attribution             | `codex-rs/core/src/commit_attribution.rs` | P2       |
| 70/30 compaction split         | `codex-rs/core/src/compact.rs`            | P2       |

---

## Rebase Procedure (When dev Advances)

```bash
git checkout feat/apex-embed-assets
git fetch origin
git rebase dev
# Resolve conflicts (proprietary files never conflict with codex-rs/)
git push origin feat/apex-embed-assets --force-with-lease
```
