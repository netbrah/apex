---
name: ontap-code-analysis
description: Guidance for using native and MCP tools to analyze ONTAP C/C++ source code. Use when the user asks about ONTAP code, functions, iterators, CLI commands, call graphs, defects, or unit tests.
---

# ONTAP Code Analysis

> Tool selection guidance, parameter limits, and investigation workflows.
> Native tools (search, analyze_symbol_ast, call_graph_fast, etc.) run in-process.
> Specialized tools (find_cits, prepare_unit_test_context, verify_generated_code) are via mastra-search MCP.

## Investigation Doctrine: Orient → BFS → DFS

1. **Orient** — `get_jira_issue` first. Read the ticket to extract symptoms, symbols, error strings.

2. **BFS fan-out** — Launch parallel subagents on the symbols from the ticket:
   - `analyze_symbol_ast` on each relevant function (one per agent)
   - `analyze_iterator` on affected iterators
   - `search` for SMF schemas and test files
   - `search_jira` for related defects

   Subagents have full native tool access. Spawning is cheap — serial is waste.

3. **Digest** — Gather BFS results into a focused picture: definitions, callers, iterator schemas, test coverage.

4. **DFS deep dive** — Main agent goes depth-first: `trace_call_chain`, `call_graph_fast` (depth=2), `get_file` on the code regions that matter. Read actual code chunks informed by BFS.

---

## ONTAP Code Patterns

Recognize these common ONTAP patterns:

- **CLI handlers**: `do_*`, `cmd_*`, `handle_*` — command implementations
- **Async work**: work queues, task scheduling, deferred execution
- **Indirection**: `*_imp`, `*_impl` — implementation functions behind interfaces
- **SMDB classes**: `*_iterator`, `*_rdb` — database-generated classes
- **Callbacks**: function pointers passed for later invocation
- **Macros**: `FOREACH_*`, `DEFINE_*` — code generation macros

### SMF → CLI Command Mapping

When you find an iterator class with `*_imp` methods:

1. Extract table name from iterator: `keymanager_external_enable_iterator` → `keymanager_external_enable`
2. Use `smf_cli_mapping` tool → returns CLI command, REST endpoint, description
3. If no CLI → it's a **no-CLI table** (74% of ONTAP tables). Use `analyze_iterator` which auto-traces upstream.

### Iterator \_imp Methods

| Public API | Implementation |
| ---------- | -------------- |
| `create()` | `create_imp()` |
| `modify()` | `modify_imp()` |
| `remove()` | `remove_imp()` |
| `get()`    | `get_imp()`    |
| `next()`   | `next_imp()`   |

---

## Mandatory Rules

1. **ALWAYS USE TOOLS BEFORE ANSWERING** — Never answer from memory, never speculate about code
2. **CITE YOUR SOURCES** — Every claim needs file path + line number from tool results
3. **NEVER HALLUCINATE** — Don't invent file paths, line numbers, or call relationships
4. **EFFICIENCY** — Max 3 search attempts per symbol, stop when you have enough

### Token Limits (USE DEFAULTS)

- **analyze_symbol_ast**: maxCallers≤15, maxCallees≤20, contextLines≤50
- **call_graph_fast**: max_depth≤2, max_callers≤15
- **search**: maxResults≤20 (defaults to 7)
- **trace_call_chain**: 30-second hard budget

Target: 10-25 tool calls per analysis.

---

## Tool Quick Reference

| Tool                 | Use When                                                        |
| -------------------- | --------------------------------------------------------------- |
| `analyze_symbol_ast` | **START HERE** for any function/class/method                    |
| `call_graph_fast`    | Tracing callers/callees (depth 1-2)                             |
| `search`             | OpenGrok definition/symbol/full-text search                     |
| `read_file`          | Reading headers, configs, SMF files (not code!)                 |
| `file_search`        | Grep within a single known file                                 |
| `trace_call_chain`   | Full trace: function → tables → CLI commands (5-30s)            |
| `analyze_iterator`   | Comprehensive iterator analysis (SMF + callers + fields + REST) |
| `find_cits`          | Finding CIT tests for a CLI command                             |
| `generate_test_plan` | "How do I write a unit test for X?"                             |
| `generate_unit_test` | Generate actual C++ test scaffolding                            |
| `ask_codeAnalyst`    | Deep-dive questions needing multi-step analysis                 |
| `analyze_defect`     | Panic/error/defect investigation                                |
| `ask_confluence`     | Architecture docs, design docs                                  |
| `ask_jira`           | Bug investigation, open issues                                  |
| `ask_reviewboard`    | Code review analysis                                            |
| `search_jira`        | Structured JQL search (no LLM)                                  |
| `get_jira_issue`     | Fetch specific Jira issue details                               |

## Decision Tree

| Question                          | Start With                                         |
| --------------------------------- | -------------------------------------------------- |
| "What does function X do?"        | `analyze_symbol_ast`                               |
| "Who calls X?"                    | `call_graph_fast` (depth=1)                        |
| "What CLI triggers X?"            | `call_graph_fast` → `smf_cli_mapping` on iterators |
| "Trace X end-to-end"              | `trace_call_chain`                                 |
| "What tests cover CLI Y?"         | `find_cits`                                        |
| "Help write unit test for X"      | `generate_test_plan` → `generate_unit_test`        |
| "Investigate this panic/error"    | `analyze_defect`                                   |
| "What bugs are open for X?"       | `search_jira` or `ask_jira`                        |
| "How does feature X work? (docs)" | `ask_confluence`                                   |
