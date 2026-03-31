# mastra-search tools (cheat sheet)

Use these tools to analyze ONTAP code quickly (symbols, call graphs, iterators/SMF mappings, defects, and tests) without manual OpenGrok spelunking.

## Start here

- **Explain a function / class**: `analyze_symbol_ast`
- **Narrative code walkthrough**: `ask_codeAnalyst`
- **Upstream call graph ("who calls X?")**: `call_graph_fast`
- **Trace function → tables + CLI triggers**: `trace_call_chain`
- **Iterator deep dive (SMF)**: `analyze_iterator`
- **Panic/defect RCA**: `analyze_defect`
- **Broad search / find definitions**: `search`
- **Find CITs for a CLI command**: `find_cits`
- **Unit test context/scaffolding**: `prepare_unit_test_context`, `generate_test_plan`, `generate_unit_test`
- **Verify generated patch ideas**: `verify_generated_code`

## Tool guide

### `analyze_symbol_ast`

Primary symbol analysis: definition + callers + callees (AST) with SMF enrichment for iterator calls.

Recommended defaults:

- Start with `includeSource=false`, `contextLines` small.
- Keep `maxCallers`/`maxCallees` low first; increase gradually.
- Set `includeTests=true` only when you want unit test entry points.

### `call_graph_fast`

Fast upstream-only call graph for "who calls X?" with optional noise filtering and path scoping.

Tips:

- Prefer `max_depth=1` first; increase to 2-3 only when needed.
- Use `path_filter` to isolate subsystems (e.g., `security`, `keymanager`, `smf`).
- Set `track_instantiations=true` when leaf nodes are iterator `_imp` methods.

Formats: `structured` (default), `ascii` (quick reading), `mermaid` (diagrams)

### `trace_call_chain`

Trace a function or iterator method to:

- Storage/action tables touched (SMF-backed)
- Upstream CLI entry points that trigger the code
- Parameter flows into SMF fields (when `verbose=true`)

Tips:

- Prefer `verbose=false` for a compact view.
- Keep `maxDepth` small (2 is usually enough).

### `analyze_iterator`

Unified iterator analysis. Includes schema-backed fields + callers + field usage by callers (set/get/query/want).

Tips:

- Start with `maxDepth=2` and `maxCallers=10`.
- Keep `includeImpMethods=true` (default) for action iterators.

### `analyze_defect`

Root-cause analysis of panics/errors/hangs.

Inputs: panic/assert string with file/line, error message snippet, stack trace, symptom description.

### `search`

OpenGrok-style search. Use `definition` for symbol definitions, `symbol` for references, `full` for text.

### `file_search`

Search within a known file path; returns matching line numbers + optional context.

### `read_file`

Read raw file content from OpenGrok. Prefer for headers (.h/.hpp), SMF files, configs. Use `analyze_symbol_ast` for C/C++ function context.

### `find_cits`

Map a CLI command (or SMF table name) to CITs. Keep `includeSnippets=true` for evidence.

### `generate_test_plan` / `generate_unit_test`

- `generate_test_plan`: Runs 3-tool chain, returns Markdown summary with fixtures, helpers, suggested test names.
- `generate_unit_test`: Generates C++ unit test scaffolding (testSuiteCode, mockerClasses, testCases).

### `verify_generated_code`

Ground-check code snippets against the live ONTAP codebase. Use when reviewing generated patches.

## Confluence / Jira / ReviewBoard (optional)

- Confluence: `ask_confluence`, `ask_confluence`, `get_confluence_page`
- Jira: `ask_jira`, `search_jira`, `get_jira_issue`
- ReviewBoard: `ask_reviewboard`
