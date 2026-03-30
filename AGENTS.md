# AGENTS.md — Qwen-Code (Apex TS Harness)

## Mission

This is the **TypeScript universal CLI agent harness** — codename **Apex**. Fork of QwenLM/qwen-code (itself a fork of Google Gemini CLI) with multi-provider cross-wire support: native /responses, /messages, and generateContent wire protocols.

## Why It Exists

Traditional CLI agents are monolithic: one harness, one wire, one model. Apex breaks that by implementing a pluggable ContentGenerator architecture where each provider (Gemini, OpenAI, Anthropic, Qwen) is a separate implementation behind a shared interface. The same TS codebase can drive Claude, GPT, Gemini, Qwen, DeepSeek — through whichever wire protocol each requires.

Google's `@google/genai` Content[] types are the **lingua franca**: every provider converts to and from Gemini format. This keeps the harness core (tools, skills, subagents, hooks, IDE integration) wire-agnostic.

**Two tiers**:

- `dev` branch = PUBLIC tier (netbrah GitHub). All cross-wire implementations, converters, and unique features. Open-source and upstreamable.
- `feat/apex-embed-assets` = PROPRIETARY tier (NetApp APEX). A thin veneer on top of dev: ~11 commits for branding, ONTAP skills, MCP configs, proxy integration. Maximize dev, minimize this layer.

### Cross-Wire Context

- **Internal format**: Google `@google/genai` Content[] types (lingua franca)
- **ContentGenerator pattern**: 4 pluggable implementations (Gemini, OpenAI, Anthropic, Qwen)
- **Upstreams**: QwenLM/qwen-code (`upstream`), google-gemini/gemini-cli (`gemini`)
- **Proprietary layer**: `feat/apex-embed-assets` branch (dev + ~11 NetApp commits)

### Wire Protocol Status

| Wire              | Status                      | Implementation                                 |
| ----------------- | --------------------------- | ---------------------------------------------- |
| generateContent   | Native (from gemini-cli)    | GeminiContentGenerator                         |
| /responses        | Shipped                     | OpenAIContentGenerator (1363-line converter)   |
| /messages         | Shipped                     | AnthropicContentGenerator (581-line converter) |
| /chat/completions | Shipped (via OpenAI compat) | OpenAIContentGenerator                         |

### Unique Features (not in any upstream)

- Multi-provider ContentGenerator architecture
- StreamingToolCallParser truncation detection (prevents silent data loss)
- Orphaned tool call cleanup (cleanOrphanedToolCalls)
- Schema compliance modes (auto/strict/relaxed)
- Modality gating with text placeholders
- Arena mode (multi-model comparison)
- Claude plugin/extension converter (823 lines)

### Sortie Agent Instructions

If you are on a `feat/` or `fix/` branch, you may be a sortie agent:

- Work ONLY on your assigned branch
- Commit with conventional commit messages
- Do NOT merge into `dev` or `feat/apex-embed-assets` — that is C2's job
- Do NOT switch branches
- Do NOT revert commits from other agents

### Sortie Completion Gate

Your FINAL COMMIT message or a `SORTIE-NOTES.md` in the repo root must include:

```
## Sortie Completion Notes
- Unit tests: [PASS/FAIL — npm run test]
- Proxy e2e: [PASS/FAIL/SKIPPED — see below]
- Wire behavior changed: [yes/no — if yes, what field/event]
- New feature: [yes/no — if yes, suggest registry ID: FQ-{N}, tier: public/proprietary]
- Null-space gap closed: [yes/no — if yes, which gap, new remaining count]
- Cross-pollination: [yes/no — does the Rust harness (XLI) need this?]
```

### E2E Testing (required for wire-layer sorties)

If your sortie changes wire behavior (converters, content generators, streaming parsers), you MUST run the proxy e2e tests before marking complete. See "Build & Test" section below for full reference.

```bash
# 1. Build first (required — e2e tests spawn the built binary)
npm run build

# 2. Run proxy e2e (tests GPT + Claude through live proxy)
npx vitest run --root ./integration-tests proxy-e2e

# 3. Quick smoke only (skip tool tests):
npx vitest run --root ./integration-tests proxy-e2e/smoke
```

Tests cover: GPT basic prompt, Claude via Vertex AI, invalid key rejection, structured JSON output, file read/write via tool calls, shell commands, grep search.

C2 reads these notes at merge time and executes the doc updates (evidence ledger, feature registry, wire audit, KPIs). You focus on code; C2 handles the docs.

### Convergence (idempotent re-dispatch)

If you are re-dispatched on a branch that already has commits (e.g., previous agent crashed):

1. Read existing commits: `git log --oneline`
2. Check if `SORTIE-NOTES.md` exists and is partially filled → complete the missing fields
3. Check if tests were already run → verify results rather than re-running
4. Continue from where the previous agent left off — don't redo completed work

### Hub Reference

Coordination hub: `~/Projects/cli-ops/` — read `AGENTS.md` there for the full big picture, feature registry (public vs proprietary tracking), and four-dimension overview.

| What you need                        | Where to find it                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| Apex null-space gaps                 | `~/Projects/cli-ops/docs/null-space/01-gemini-to-messages.md`                   |
| What we added vs upstream Gemini CLI | `~/Projects/cli-ops/docs/feature-delta/01-gemini-vs-qwen.md`                    |
| Features to port from XLI            | `~/Projects/cli-ops/docs/feature-delta/03-cross-implementation.md`              |
| How ops work (sortie lifecycle)      | `~/Projects/cli-ops/docs/03-OPERATIONAL-MODEL.md`                               |
| KPIs and objectives                  | `~/Projects/cli-ops/docs/04-OBJECTIVES-AND-KPIs.md`                             |
| Build/deploy/merge procedures        | `~/Projects/cli-ops/docs/05-RUNBOOK.md` (RB-4: APEX build, RB-6: delta reports) |

### Features to Port from XLI (Rust)

| Feature                         | Source                  | Priority |
| ------------------------------- | ----------------------- | -------- |
| Sandboxing (seatbelt/landlock)  | codex-rs security crate | P0       |
| Guardian approval flow          | codex-rs core           | P1       |
| Rollout recording + truncation  | codex-rs core           | P1       |
| Commit attribution              | codex-rs git module     | P2       |
| 70/30 compaction split strategy | codex-rs compact.rs     | P2       |

---

## Dev Workflow — Build & Test

### Required Env Vars

```bash
# For proxy e2e tests (set in your shell profile):
export OPENAI_API_KEY="your-proxy-api-key"
export OPENAI_BASE_URL="https://llm-proxy-api.ai.eng.netapp.com"

# Optional overrides:
export PROXY_GPT_MODEL="gpt-4.1-mini"           # default
export PROXY_CLAUDE_MODEL="claude-sonnet-4.6"    # default
```

### Commands (what to run and when)

```bash
# 1. BUILD (after code changes)
npm run build

# 2. UNIT TESTS (after every change — fast, no network)
npm run test

# 3. PROXY E2E (after wire-layer changes — ~30s, needs proxy)
npx vitest run --root ./integration-tests proxy-e2e

# 4. QUICK SMOKE (proxy e2e — smoke only, skip tool tests)
npx vitest run --root ./integration-tests proxy-e2e/smoke

# 5. FULL INTEGRATION (all integration tests — slower)
npm run test:e2e

# 6. PREFLIGHT (full CI check — lint, format, build, test)
npm run preflight

# 7. BUNDLE (for distribution)
npm run bundle
```

### Quick Reference

| What                   | Command                                                     | When          | Needs Network |
| ---------------------- | ----------------------------------------------------------- | ------------- | ------------- |
| Unit tests             | `npm run test`                                              | Every change  | No            |
| Proxy e2e (GPT+Claude) | `npx vitest run --root ./integration-tests proxy-e2e`       | Wire changes  | Yes (proxy)   |
| Smoke only             | `npx vitest run --root ./integration-tests proxy-e2e/smoke` | Quick check   | Yes           |
| Full preflight         | `npm run preflight`                                         | Before merge  | No            |
| Bundle                 | `npm run bundle`                                            | Before deploy | No            |

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
