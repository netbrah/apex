# AGENTS.md — Apex (NetApp Proprietary Layer)

> **YOU ARE ON `feat/apex-embed-assets`** — the proprietary tier.
> `dev` = public engine. This branch = thin NetApp veneer on top of dev.
> Never push this branch to a public remote. Never merge public sorties directly here — merge to dev first, then rebase.

## Dev Workflow — Build, Test & Live E2E

### Build & Unit Tests

```bash
npm run build          # compile TypeScript (required before e2e)
npm run test           # all unit tests — no network, fast
npm run preflight      # lint + format + build + typecheck + test (before merge)

# Single package
npx vitest run packages/core
npx vitest run packages/cli

# Single file (fastest iteration)
npx vitest run packages/core/src/core/anthropicContentGenerator/anthropicContentGenerator.test.ts

# Watch mode
npx vitest packages/core --watch
```

### Live Proxy E2E Tests

All proxy e2e tests are **env-var gated** — they skip cleanly when the required
vars are not set. No corp URLs are hardcoded on this branch.

#### Set these in your shell profile to enable live e2e:

```bash
export OPENAI_API_KEY="<your-key>"
export OPENAI_BASE_URL="<your-openai-compatible-endpoint>"

# Optional overrides (defaults shown):
export PROXY_GPT_MODEL="gpt-4.1-mini"
export PROXY_CLAUDE_MODEL="claude-sonnet-4.6"
export QWEN_BINARY="qwen"   # or absolute path to built binary
```

For the NetApp proxy URL specifically: it lives in `feat/apex-embed-assets` AGENTS.md.
Not here — this branch is public. Your shell profile should already have it set.

#### Run e2e tests

```bash
npm run build   # required — tests spawn the built binary

# Full suite (smoke + tools, ~2 min)
npx vitest run --root ./integration-tests proxy-e2e

# Smoke only (~30s — basic connectivity check)
npx vitest run --root ./integration-tests proxy-e2e/smoke

# Tools only (~60s — file read/write/shell/grep via live tool calls)
npx vitest run --root ./integration-tests proxy-e2e/tools
```

**Auto-skip**: when `OPENAI_BASE_URL` or `OPENAI_API_KEY` is empty, all proxy-e2e
tests skip automatically. `npm run test` and `npm run preflight` are always safe.

#### What e2e covers

| Suite | File                      | Tests                                                          |
| ----- | ------------------------- | -------------------------------------------------------------- |
| Smoke | `proxy-e2e/smoke.test.ts` | GPT prompt, Claude prompt, key rejection, JSON event structure |
| Tools | `proxy-e2e/tools.test.ts` | File read, file write, shell command, grep search              |

#### When to run e2e

| Change area                        | Run e2e?                   |
| ---------------------------------- | -------------------------- |
| `anthropicContentGenerator/`       | Yes — smoke (Claude)       |
| `openaiResponsesContentGenerator/` | Yes — smoke (GPT)          |
| `contentGenerator.ts` dispatch     | Yes — smoke (both)         |
| `packages/core/src/tools/`         | Yes — tools suite          |
| Config, storage, UI                | No — unit tests sufficient |

---

## Project Overview

**Qwen Code** is an open-source AI agent for the terminal, optimized for [Qwen3-Coder](https://github.com/QwenLM/Qwen3-Coder). It helps developers understand large codebases, automate tedious work, and ship faster.

This project is based on [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) with adaptations to better support Qwen-Coder models.

### Key Features

- **OpenAI-compatible, OAuth free tier**: Use an OpenAI-compatible API, or sign in with Qwen OAuth to get 1,000 free requests/day
- **Agentic workflow, feature-rich**: Rich built-in tools (Skills, SubAgents, Plan Mode) for a full agentic workflow
- **Terminal-first, IDE-friendly**: Built for developers who live in the command line, with optional integration for VS Code, Zed, and JetBrains IDEs

## Technology Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript 5.3+
- **Package Manager**: npm with workspaces
- **Build Tool**: esbuild
- **Testing**: Vitest
- **Linting**: ESLint + Prettier
- **UI Framework**: Ink (React for CLI)
- **React Version**: 19.x

## Project Structure

```
├── packages/
│   ├── cli/              # Command-line interface (main entry point)
│   ├── core/             # Core backend logic and tool implementations
│   ├── sdk-java/         # Java SDK
│   ├── sdk-typescript/   # TypeScript SDK
│   ├── test-utils/       # Shared testing utilities
│   ├── vscode-ide-companion/  # VS Code extension companion
│   ├── webui/            # Web UI components
│   └── zed-extension/    # Zed editor extension
├── scripts/              # Build and utility scripts
├── docs/                 # Documentation source
├── docs-site/            # Documentation website (Next.js)
├── integration-tests/    # End-to-end integration tests
└── eslint-rules/         # Custom ESLint rules
```

### Package Details

#### `@qwen-code/qwen-code` (packages/cli/)

The main CLI package providing:

- Interactive terminal UI using Ink/React
- Non-interactive/headless mode
- Authentication handling (OAuth, API keys)
- Configuration management
- Command system (`/help`, `/clear`, `/compress`, etc.)

#### `@qwen-code/qwen-code-core` (packages/core/)

Core library containing:

- **Tools**: File operations (read, write, edit, glob, grep), shell execution, web fetch, LSP integration, MCP client
- **Subagents**: Task delegation to specialized agents
- **Skills**: Reusable skill system
- **Models**: Model configuration and registry for Qwen and OpenAI-compatible APIs
- **Services**: Git integration, file discovery, session management
- **LSP Support**: Language Server Protocol integration
- **MCP**: Model Context Protocol implementation

## Building and Running

### Prerequisites

- **Node.js**: ~20.19.0 for development (use nvm to manage versions)
- **Git**
- For sandboxing: Docker or Podman (optional but recommended)

### Setup

```bash
# Clone and install
git clone https://github.com/QwenLM/qwen-code.git
cd qwen-code
npm install
```

### Build Commands

```bash
# Build all packages
npm run build

# Build everything including sandbox and VSCode companion
npm run build:all

# Build only packages
npm run build:packages

# Development mode with hot reload
npm run dev

# Bundle for distribution
npm run bundle
```

### Running

```bash
# Start interactive CLI
npm start

# Or after global installation
qwen

# Debug mode
npm run debug

# With environment variables
DEBUG=1 npm start
```

### Testing

```bash
# Run all unit tests
npm run test

# Run integration tests (no sandbox)
npm run test:e2e

# Run all integration tests with different sandbox modes
npm run test:integration:all

# Terminal benchmark tests
npm run test:terminal-bench
```

### Code Quality

```bash
# Run all checks (lint, format, build, test)
npm run preflight

# Lint only
npm run lint
npm run lint:fix

# Format only
npm run format

# Type check
npm run typecheck
```

## Development Conventions

### Code Style

- **Strict TypeScript**: All strict flags enabled (`strictNullChecks`, `noImplicitAny`, etc.)
- **Module System**: ES modules (`"type": "module"`)
- **Import Style**: Node.js native ESM with `.js` extensions in imports
- **No Relative Imports Between Packages**: ESLint enforces this restriction

### Key Configuration Files

- `tsconfig.json`: Base TypeScript configuration with strict settings
- `eslint.config.js`: ESLint flat config with custom rules
- `esbuild.config.js`: Build configuration
- `vitest.config.ts`: Test configuration

### Import Patterns

```typescript
// Within a package - use relative paths
import { something } from './utils/something.js';

// Between packages - use package names
import { Config } from '@qwen-code/qwen-code-core';
```

### Testing Patterns

- Unit tests co-located with source files (`.test.ts` suffix)
- Integration tests in separate `integration-tests/` directory
- Uses Vitest with globals enabled
- Mocking via `msw` for HTTP, `memfs`/`mock-fs` for filesystem

### Architecture Patterns

#### Tools System

All tools extend `BaseDeclarativeTool` or implement the tool interfaces:

- Located in `packages/core/src/tools/`
- Each tool has a corresponding `.test.ts` file
- Tools are registered in the tool registry

#### Subagents System

Task delegation framework:

- Configuration stored as Markdown + YAML frontmatter
- Supports both project-level and user-level subagents
- Event-driven architecture for UI updates

#### Configuration System

Hierarchical configuration loading:

1. Default values
2. User settings (`~/.qwen/settings.json`)
3. Project settings (`.qwen/settings.json`)
4. Environment variables
5. CLI flags

### Authentication Methods

1. **Qwen OAuth** (recommended): Browser-based OAuth flow
2. **OpenAI-compatible API**: Via `OPENAI_API_KEY` environment variable

Environment variables for API mode:

```bash
export OPENAI_API_KEY="your-api-key"
export OPENAI_BASE_URL="https://api.openai.com/v1"  # optional
export OPENAI_MODEL="gpt-4o"                        # optional
```

## Debugging

### VS Code

Press `F5` to launch with debugger attached, or:

```bash
npm run debug  # Runs with --inspect-brk
```

### React DevTools (for CLI UI)

```bash
DEV=true npm start
npx react-devtools@4.28.5
```

### Sandbox Debugging

```bash
DEBUG=1 qwen
```

## Documentation

- User documentation: <https://qwenlm.github.io/qwen-code-docs/>
- Local docs development:

  ```bash
  cd docs-site
  npm install
  npm run link  # Links ../docs to content
  npm run dev   # http://localhost:3000
  ```

## Contributing Guidelines

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed guidelines. Key points:

1. Link PRs to existing issues
2. Keep PRs small and focused
3. Use Draft PRs for WIP
4. Ensure `npm run preflight` passes
5. Update documentation for user-facing changes
6. Follow Conventional Commits for commit messages

## Useful Commands Reference

| Command             | Description                                                          |
| ------------------- | -------------------------------------------------------------------- |
| `npm start`         | Start CLI in interactive mode                                        |
| `npm run dev`       | Development mode with hot reload                                     |
| `npm run build`     | Build all packages                                                   |
| `npm run test`      | Run unit tests                                                       |
| `npm run test:e2e`  | Run integration tests                                                |
| `npm run preflight` | Full CI check (clean, install, format, lint, build, typecheck, test) |
| `npm run lint`      | Run ESLint                                                           |
| `npm run format`    | Run Prettier                                                         |
| `npm run clean`     | Clean build artifacts                                                |

## Session Commands (within CLI)

- `/help` - Display available commands
- `/clear` - Clear conversation history
- `/compress` - Compress history to save tokens
- `/stats` - Show session information
- `/bug` - Submit bug report
- `/exit` or `/quit` - Exit Qwen Code

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
# Build + bundle first (proxy e2e spawns dist/cli.js)
npm run build
npm run bundle

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
