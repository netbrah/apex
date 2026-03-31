---
name: ontap-mastra-search
description: Analyze ONTAP source code and related engineering artifacts with native OpenGrok tools and mastra-search MCP. Use when investigating symbols, call graphs, iterators, defects, CLI commands, or unit tests in the ONTAP codebase.
---

# ONTAP Code Search & Analysis

## Overview

Native tools (search, analyze_symbol_ast, call_graph_fast, trace_call_chain, analyze_iterator, search_jira, get_jira_issue, get_confluence_page) run in-process against OpenGrok and service APIs. Specialized tools (find_cits, prepare_unit_test_context, verify_generated_code) run via the mastra-search MCP server.

## Investigation Doctrine: Orient → BFS → DFS

1. **Orient** — `get_jira_issue` first. Understand the symptom, component, error strings, mentioned symbols.

2. **BFS fan-out** — Launch parallel subagents on multiple axes simultaneously:
   - `analyze_symbol_ast` on each function mentioned in the ticket
   - `analyze_iterator` on affected iterators
   - `search_jira` for related defects, same component, similar error patterns
   - `search` for SMF schemas, test files, header files
   - Each subagent has full native tool access. Spawning is cheap — serial is waste.

3. **Digest** — Gather BFS results. You now have definitions, callers, Jira history, iterator schemas, test coverage.

4. **DFS deep dive** — Main agent goes depth-first with `trace_call_chain`, `call_graph_fast` (depth=2), and `get_file` on the specific code regions identified by BFS. Read actual code chunks that matter.

## Default Workflow (Pick the Smallest Hammer)

1. Start with the most direct tool for the task (symbol, iterator, defect, or CLI).
2. Keep scope small (limit callers/callees, shallow depth) until you find the hotspot.
3. Only request source snippets (`includeSource` / `include_code`) when needed.
4. Prefer "unified" tools that already stitch context together (for iterators: `analyze_iterator`; for function→tables/CLI triggers: `trace_call_chain`).
5. Use deterministic tools (`analyze_symbol_ast`, `call_graph_fast`, `trace_call_chain`, `analyze_iterator`) before narrative ones.

## Task Recipes

### Explain a Function / Class

- Use `analyze_symbol_ast` first.
  - Start with `includeSource=false` and small `contextLines`.
  - Increase `contextLines` and set `includeSource=true` only if you need code context.
- If you specifically need _upstream_ callers by levels, use `call_graph_fast`.
- If you want a narrative explanation (not just edges), use `ask_codeAnalyst`.

### Build an Upstream Call Graph (Who Calls X?)

- Use `call_graph_fast`.
  - Prefer `max_depth=1` first; increase only when necessary.
  - Use `path_filter` to isolate subsystems (e.g., `keymanager`, `security`, `smf`).
  - Use `format=ascii` for quick reading; `mermaid` only when you want a diagram.

### Understand an SMF Iterator (Fields, Callers, Field Usage)

- Use `analyze_iterator` (recommended).
  - Keep `maxDepth` small (2 is usually enough).
  - Keep `maxCallers` modest first; raise only if you're missing a caller.
  - Set `includeImpMethods=true` (default) for action iterators.

### Trace a Function to Tables + CLI Entry Points

- Use `trace_call_chain`.
  - Prefer `verbose=false` to keep output small.
  - Use the discovered tables + CLI triggers to scope follow-up `call_graph_fast` runs.

### Analyze a Panic / Defect / Failure Mode

- Use `analyze_defect` with the panic string / error message / stack trace.
- Follow up with:
  - `call_graph_fast` for suspicious symbols on the path
  - `find_cits` to locate integration coverage for a relevant CLI command
  - `generate_test_plan` if you need unit-test scaffolding context

### Find Tests / Coverage

- Find CITs for a CLI command: `find_cits`
- Generate unit-test context: `prepare_unit_test_context`
- Generate a suggested plan: `generate_test_plan`
- Generate C++ unit test scaffolding: `generate_unit_test`

## Search and File Retrieval

- Use `search` for OpenGrok-style search (definition, symbol refs, full text, path/type filters). This is your global grep.
- Use `file_search` when you already know the file path and need line hits + context.
- Use `read_file` only when you specifically need a header, SMF file, or non-code file content; prefer `analyze_symbol_ast` for code.

## References

- Read `references/mastra-search-tools.md` for tool-by-tool parameters and minimal examples.
