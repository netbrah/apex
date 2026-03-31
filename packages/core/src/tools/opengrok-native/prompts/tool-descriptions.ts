/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Tool Descriptions
 *
 * Exported for consistency across tool definitions. Each entry maps a tool ID
 * to its human-readable description used in MCP discovery and documentation.
 */

export const TOOL_DESCRIPTIONS = {
  ontap_discover: `Deterministic ONTAP API discovery — structured lookup across ~1,253 REST endpoints, ~10,946 SMF tables, and 7,541 CLI commands.

NO LLM involved — pass structured params, get instant results.

Actions:
- search: keyword search across all indexed items. Requires "query".
- get_endpoint: get REST endpoint details by path. Requires "path".
- get_smf_table: get internal table schema, fields, storage type, access patterns. Requires "tableName".
- get_command: unified lookup — pass a CLI command, table name, or path to get full details with CLI examples.
- browse_cli: deterministic CLI command tree navigator — pass a CLI path to browse subcommands, or a full command to get detailed parameter info with type resolution.
- list_debug_smdb_tables: list tables queryable via debug smdb (the "dark" internal API).
- cli_to_rest: convert an ONTAP CLI command to its REST equivalent. Requires "cliCommand".
- list_tags/list_domains: enumerate categories.
- options: discover allowed HTTP methods for a path. Requires "path".
- stats: index statistics.

Examples:
- { "action": "search", "query": "enable encryption" }
- { "action": "get_endpoint", "path": "/security/key-managers", "method": "POST" }
- { "action": "get_smf_table", "tableName": "cluster_kdb_rdb" }
- { "action": "get_command", "cliCommand": "security key-manager onboard enable" }
- { "action": "browse_cli", "cliPath": "security key-manager" }
- { "action": "cli_to_rest", "cliCommand": "volume snapshot create" }
- { "action": "list_debug_smdb_tables", "domain": "security" }`,

  analyze_symbol_ast: `HYBRID symbol analysis: OpenGrok references + AST callees + SMF enrichment.

Combines the BEST of both approaches:
1. **All References** (from OpenGrok): comments, headers, tests, mocks, actual calls
2. **Precise Callees** (from AST): filtered function calls, no trace/logging noise
3. **SMF Enrichment**: Iterator callees get database field info automatically

Returns:
- Definition: file, line, signature, source snippet
- Callers: deduplicated by containing function (actual call sites)
- Callees: with receiverType + smfField (for iterator methods)
- smfSchemas: which SMF files were fetched

Output filtering (verbose=false by default):
- filteredCallees, timing, allReferences hidden unless verbose=true
- smfSchemas always included (useful context)

Example: { "symbol": "pushKeyToKmipServerIfNeeded" }

Callee output includes:
- receiverType: resolved iterator type (e.g., "kmip_keytable_v2_iterator")
- smfField: database field info for set_*/query_* methods

Use this as your PRIMARY symbol analysis tool - it gives you everything:
- Filtered callers for call graph building
- Precise callees with iterator field info for understanding code flow`,

  call_graph_fast: `Fast call graph builder using analyze_symbol chains (NO LLM overhead).

Builds UPSTREAM-ONLY call graphs showing who calls the entry point function.
Much faster than call_graph - purely deterministic API calls.

Example: { "symbol": "deleteKeyFromLocalCryptomod", "max_depth": 1 }
Example with filter: { "symbol": "deleteKeyFromLocalCryptomod", "path_filter": "keymanager" }

Features:
- **Noise filtering**: Automatically filters out tracing functions (traceError, etc.), STL (std::*), and common utilities
- **Path filtering**: Focus on specific subsystems (e.g., "keymanager", "security")

Output formats:
- **ascii**: Beautiful tree visualization with timing stats
- **mermaid**: Renders in GitHub, VS Code, documentation
- **structured**: Machine-parseable JSON with confidence scores and noise detection`,

  search: `Search ONTAP source code using OpenGrok (backed by Lucene).

Parameters:
- definition: Find where a function/class/variable is DEFINED (use for functions, classes, macros)
- symbol: Find all REFERENCES/usages of a symbol
- full: Full text search in file contents (use simple keywords, NOT raw code snippets)
- path: Filter by file path pattern
- type: Filter by file type (c, cxx, java, python)

⚠️ IMPORTANT — Lucene query syntax:
- The "full" field uses Lucene syntax. Characters like " ( ) [ ] { } + - ! * ? : \\ / ^ ~ are operators.
- DO NOT paste raw code into "full" — it will cause query parse errors.
- Use simple keywords instead: "encrypt key available" not 'dotsql_query("CALL encrypt_key")'
- For exact phrases, use balanced quotes: "exact phrase here"
- For code patterns, search for the distinctive function/variable name using "definition" or "symbol" instead.

Examples:
- Find definition: { "definition": "deleteKeyFromLocalCryptomod" }
- Find usages: { "symbol": "keymanager_utils" }
- Text search: { "full": "encrypt key available", "path": "security/*" }
- Find code pattern: { "definition": "keymanager_vdek_table_key_available_on_dest" } (NOT full text)`,

  get_file: `Read source file content from OpenGrok.

Supports explicit startLine/endLine params for exact line ranges,
or #L100-L200 suffix on the filePath (explicit params take precedence).
Always returns totalLines so you know how much of the file you're seeing.

⚠️ RARELY NEEDED - prefer these tools instead:
- Need more context? → call_graph_fast (explores callers/callees with source)
- Need function source? → analyze_symbol_ast with contextLines: 150
- Need to find a line? → file_search first, then get_file with startLine/endLine

Only use get_file for:
- Header files (.h, .hpp) for declarations
- Config files, SMF files, non-code files
- Files that aren't C/C++ source code

Examples:
- { "filePath": "/security/keymanager/keymanager_utils.h" }
- { "filePath": "/security/keymanager/keymanager_utils.cc", "startLine": 100, "endLine": 200 }
- { "filePath": "/security/keymanager/keymanager_utils.cc#L100-L200" }`,

  file_search: `Search within a single file for lines matching a pattern.

Use when you already know the file path and need to find specific content.
Returns matching line numbers + text + optional surrounding context.
Pattern is treated as regex if valid, falls back to case-insensitive substring match.

Workflow: file_search → get line numbers → get_file(startLine, endLine) to read the region.

Example: { "filePath": "/test/.../test_key_manager_veto.py", "pattern": "node_takeover_giveback", "contextLines": 2 }

Parameters:
- filePath: Path to the file to search within
- pattern: Regex or substring to search for
- contextLines: Number of context lines before/after each match (0-10, default 0)
- maxMatches: Maximum matches to return (default 50, max 200)`,

  smf_cli_mapping: `Get CLI command for an SMF iterator or table.

Given an iterator class name (e.g., keymanager_external_enable_iterator),
this tool finds the corresponding SMF file and extracts the CLI command.

Example:
- Input: { "name": "keymanager_external_enable_iterator" }
- Output: { "cliCommand": "security key-manager external enable", "smfFile": "..." }

Use this when you find an *_iterator class with _imp methods to discover
what CLI command triggers it.`,

  swagger_rest_mapping: `Find REST API endpoints for an ONTAP CLI command.

Given a CLI command (e.g., "security key-manager external enable"),
this tool searches swagger documentation for "Related ONTAP commands"
sections and returns:
- Matching REST endpoints (path, method, operationId)
- ALL related CLI commands that map to each endpoint
- Curl examples with descriptions
- Raw YAML sections for additional context

Multiple CLI commands often map to the same REST endpoint (e.g., both
"security key-manager external enable" and "security key-manager onboard enable"
map to POST /security/key-managers).

Example output:
{
  "endpoints": [{
    "path": "/security/key-managers",
    "method": "POST",
    "operationId": "security_key_manager_create",
    "relatedCliCommands": [
      "security key-manager external enable",
      "security key-manager onboard enable"
    ],
    "curlExamples": [{
      "command": "curl -X POST 'https://<mgmt-ip>/api/security/key-managers'...",
      "description": "Creating an external key manager"
    }]
  }]
}

Use this after smf_cli_mapping to get the full chain:
  iterator → SMF → CLI command → REST endpoint → curl example`,

  ask_codeAnalyst: `Ask the ONTAP Code Analyst agent a question.

The agent is an expert at:
- Analyzing C/C++ code
- Building call graphs
- Tracing code paths
- Explaining function behavior

Example queries:
- "Explain the role of keymanager_keystore_all_rdb_iterator"
- "Build a call graph for deleteKeyFromLocalCryptomod depth 3"
- "What are the entry points for volume space balance?"`,

  discover_subsystem_setup: `Discover setup/enable commands for a subsystem.

Given a subsystem name, finds all "enable", "setup", "create" commands
that are typically prerequisites for using other features.

Example: { "subsystem": "keymanager" }
Returns:
- security key-manager external enable
- security key-manager onboard enable
- security key-manager external azure enable
- etc.

Use this when:
1. You need to understand prerequisites for testing a function
2. User asks "how do I set up X before using Y?"
3. You found a low-level function and need to know what enables it

Parameters:
- subsystem: Name like "keymanager", "volume", "aggregate", "snapmirror"
- includeAll: Set true to get ALL commands, not just setup commands`,

  find_cits: `Find CITs (Component Integration Tests) using deterministic mapping.

Uses a 5-step chain: SMF → CLI → NACL method → test usage sites → CIT .stest files.
Accepts either a CLI command or an SMF table/iterator name.

Example: { "cliCommand": "security key-manager external enable" }
Example: { "cliCommand": "keymanager_key_query" }

Returns:
- mappingChain: resolved CLI commands, NACL method names, SMF/CDEF files
- cits: .stest files with test references and evidence trails
  - Default (compact): tests as strings ("path[::func1,func2][#runId]"), pathMap for path prefix dedup
  - verbose=true: full testReferences objects with testPath, testType, codeSnippet
- unmappedUsageFiles: test files that use the command but aren't linked to any CIT (verbose mode)

Use this when:
1. User asks "what CITs test this command?"
2. User wants to find test coverage for a feature
3. Mapping from SMF iterator to CIT tests`,

  generate_test_plan: `Generate unit test context for a function.

Analyzes the function using analyze_symbol_ast and call_graph_fast to provide:
- Function analysis (definition, callees, callers)
- Iterator entry points (CLI commands that exercise the function via call_graph_fast)
- Test file location and TestSuite class
- Registered fixtures with resolved table names (strips prefixes like smdb_table__, rdb_table__)
- Helper classes for test setup
- FIJI faults for error path testing
- SMF tables accessed by the function
- Similar existing tests that use the same helpers/fixtures/tables

Output: Comprehensive unit test context for writing new tests

Example:
{ "functionName": "deleteKeyFromLocalCryptomod" }`,

  generate_unit_test: `Generate C++ unit test scaffolding for ONTAP SMF framework code.

Analyzes a function and generates:
- TestSuite class with proper fixtures (RdbTableSetup, NoImpsTableSetup, etc.)
- Mocker classes for utility function dependencies
- Test cases for success and failure paths
- Required includes and test helpers

Mock patterns supported (from MOCKING_GUIDE.md):
1. SmfMethodReturnHelper - Control iterator return status
2. SmfTableErrorHelper - Inject error into next operation
3. SmfTableReplaceImpHelper - Full *_imp() replacement
4. Mocker<T> - Free function mocking
5. ScopedFaultAlways - FIJI fault injection
6. TestHelpers (e.g., cryptomod_rewrap_key_Helper)

Input: { "functionName": "deleteKeyFromLocalCryptomod" }
Output: Complete unit test scaffolding with TODO markers for implementation`,

  prepare_unit_test_context: `Prepare comprehensive context for writing unit tests.

Analyzes a function using analyze_symbol_ast and call_graph_fast to provide:
- Function analysis (definition, signature, callees, callers)
- Iterator entry points (CLI commands that exercise the function)
- Test file location and TestSuite class
- Registered fixtures with resolved table names
- Helper classes for test setup
- FIJI faults for error path testing
- SMF tables accessed by the function
- Similar existing tests for reference

This is the underlying tool used by generate_test_plan. Use this when you need
raw context data for custom test generation workflows.

Input: { "functionName": "deleteKeyFromLocalCryptomod" }
Output: Structured context for unit test scaffolding`,

  verify_generated_code: `Verify generated code against the ONTAP codebase.

Given code snippets AND/OR explicit symbols:
1. EXTRACTS symbols from code (tree-sitter AST + regex)
2. RESOLVES each symbol against the live codebase (definitions, callers, callees)
3. BUILDS a typed meta-graph of all entities and relationships
4. RETURNS structured JSON with ground truth

100% deterministic — no LLM agent phase. Fast (~1-5s per symbol).

USE WHEN:
- Verifying generated C/C++ code uses real functions
- Checking if code changes affect the right callers/callees
- Building a relationship map of symbols in a diff/patch
- Grounding agent analysis in deterministic facts

INPUT:
- code_snippets: [{code: "...", language: "cpp"}] — parsed with tree-sitter
- symbols: ["funcName"] — explicit symbols to resolve
- call_graph_depth: 1-3 — how far upstream to trace
- path_filter: "keymanager" — focus subsystem

OUTPUT:
- extracted: symbols found in each code snippet
- resolved: per-symbol resolution (found, file, callers, callees)
- graph: full meta-graph {nodes, edges, stats}
- timing: extraction + resolution + total ms`,

  analyze_defect: `Analyze a defect, panic, or error in the ONTAP codebase.

This is a powerful meta-agent that orchestrates all available tools to:
1. **Understand** the defect from panic strings, error codes, or descriptions
2. **Explore** the code with call graphs and source analysis
3. **Gather context** - CLI commands, REST endpoints, prerequisites
4. **Hypothesize** root cause with confidence rating
5. **Suggest fix** with specific file/line changes
6. **Provide repro steps** - exact commands to reproduce

Input types accepted:
- Panic string: "ASSERT(keyId != nullptr) in deleteKeyFromLocalCryptomod"
- Error message: "security key-manager external enable fails with EEXIST"
- Stack trace: Function names from a core dump
- Symptom description: "Rekey operation hangs after 10 minutes"
- Code diff: "This change introduced a regression"

Example queries:
- "Analyze panic: ASSERT(ptr != nullptr) in function X at file.cc:123"
- "Why does 'security key-manager external enable' fail with EEXIST on second run?"
- "Investigate: intermittent hang in deleteKeyFromLocalCryptomod during cluster failover"
- "Root cause analysis for null pointer in keymanager_external_enable_iterator::create_imp"

Output includes:
- Defect summary
- Affected code (function, file, line)
- Call graph showing failure path
- Root cause hypothesis with confidence
- Reproduction steps (setup + trigger)
- Suggested fix (file, change, rationale)
- Related CITs for verification`,

  debug_ast: `DEBUG TOOL: Dump the AST structure of code to understand why patterns don't match.

USE THIS WHEN:
- A tree-sitter query returns no results unexpectedly
- You need to find the correct node types for a pattern
- You're adding support for a new code pattern

OUTPUT: Tree structure showing node types, field names, and positions.
This tells you EXACTLY what to query for.

Example: { "code": "class Foo : public Bar {};", "language": "cpp" }
Returns ASCII tree with all node types, helpful hints for common patterns.`,

  test_pattern: `TEST a tree-sitter query against code WITHOUT modifying any files.

USE THIS WHEN:
- You've used debug_ast to find node types
- You want to verify a query works before adding it to the codebase
- You're iterating on a pattern that isn't matching

Returns matches with captured nodes and their positions.

Example: { "code": "void foo() { bar(); }", "query": "(call_expression function: (identifier) @callee)", "language": "cpp" }
Returns: { success: true, matchCount: 1, matches: [{ captures: { callee: { text: "bar", line: 1, column: 13 }}}]}`,

  smf_iterator_fields: `Parse SMF schema to get iterator field definitions and auto-generated methods.

Given an iterator class name (e.g., keymanager_external_show_status_iterator),
finds the corresponding .smf file and extracts:
- Field definitions (name, type, description, role: key/read/write)
- Auto-generated set_*/get_* methods
- CLI command mapped to this iterator

Use this to understand:
- What data an iterator manages (its schema)
- Which methods are SMF-generated vs custom code
- Key fields vs read-only fields

Example:
- Input: { "iterator": "keymanager_external_show_status_iterator" }
- Output: { fields: [{name: "node", role: "key"}, ...], generatedMethods: ["set_node", "get_node", ...] }`,

  trace_call_chain: `Bidirectional tracing: function/iterator → tables → CLI commands.

Works for BOTH regular functions AND iterator methods:
- Functions: Traces downstream to tables, upstream to CLI entry points
- Iterators: Finds CLI commands and table relationships

EXAMPLE usage:
- trace_call_chain("pushKeyToKmipServerForced")  → finds tables + 2 CLI commands + parameter flows
- trace_call_chain("deleteKeyFromLocalCryptomod")  → finds action tables + CLI triggers
- trace_call_chain("keymanager_vdek_table_iterator::create_imp")  → finds CLI commands

What it does:
✅ Table Discovery - Finds action tables and storage tables the function touches
✅ CLI Trigger Discovery - Finds CLI commands that invoke the code
✅ Bidirectional Tracing - Downstream (tables) AND upstream (callers → CLI)
✅ Rich Graph Data - All intermediate callers, callees, and iterators discovered
✅ Call Chains - Shows the path from function → intermediate callers → CLI
✅ Parameter Flows - Maps function parameters → callee arguments → SMF fields (zero extra requests!)

Output includes:
- function: { name, file, line, signature }
- tables: { actionTables, storageTables } with SMF file paths
- cliTriggers: CLI commands with caller function info
- upstreamCallers: All callers with depth/file/line (direct + transitive)
- functionCallees: What the function calls (with iterator info, arguments[], smfField)
- iteratorsDiscovered: All iterator entry points found
- callChains: { downstream, upstream } paths (with verbose=true)
- parameterFlows: { functionParams[], directFlows[], endToEndFlows[] }
  - functionParams: parsed C++ signature → [{name, type, position}]
  - directFlows: param → callee(arg) → smfField mapping with line numbers
  - endToEndFlows: CLI param → function param → intermediate calls → terminal SMF field (verbose only)`,

  analyze_iterator: `Unified analysis of ONTAP SMF iterators.

Combines SMF schema, call graph, REST mapping, and field usage analysis into
a single comprehensive view. This is the RECOMMENDED tool for understanding:
- What fields an iterator has and their roles
- Who calls the iterator (direct and transitive callers)
- Which callers use which fields (set_*, get_*, query_*, want_*)
- REST endpoints for CLI commands
- Implementation details of *_imp methods

Use this instead of calling smf_iterator_fields + call_graph_fast + swagger_rest_mapping separately.

Example:
- Input: { "iterator": "keymanager_keystore_enable_iterator" }
- Returns: SMF fields, callers with field usage matrix, REST endpoints, *_imp method analysis`,

  ask_confluence: `Search and analyze Confluence documentation.

This is an intelligent agent that:
1. **Searches** for relevant pages using your question
2. **Reads** the full content of matching pages
3. **Synthesizes** information into a coherent answer
4. **Cites** all source pages used

Use this for:
- Finding documentation about ONTAP features
- Understanding test procedures and requirements
- Getting summaries of multiple related pages
- Exploring Confluence spaces

Example queries:
- "How does keymanager veto work in N-Way HA?"
- "Summarize the security key-manager test architecture"
- "What are the prerequisites for NAE encryption testing?"

Parameters:
- question: Your question about Confluence content
- pageIds: (Optional) Specific page IDs to include in analysis
- maxSteps: (Optional) Max search/read iterations (default 15)

Output includes:
- answer: Synthesized response with information from multiple pages
- references: List of Confluence pages used (id, title, url)`,

  ask_jira: `Search and analyze Jira issues intelligently.

This is an intelligent agent that:
1. **Builds JQL queries** from your natural language question
2. **Searches** for relevant issues
3. **Reads** full issue details (description, comments)
4. **Synthesizes** findings into a coherent answer
5. **Cites** all issues explored

Use this for:
- Finding bugs related to a feature or component
- Understanding the status of issues
- Summarizing recent activity in a project
- Investigating specific defects

Example queries:
- "What keymanager bugs are currently open?"
- "Summarize BURT-123456"
- "What issues mention panic in keymanager?"
- "Recent high-priority bugs in security component"

Parameters:
- question: Your question about Jira issues
- issueKeys: (Optional) Specific issue keys to analyze
- projectKey: (Optional) Limit search to a project (e.g., 'BURT')
- maxSteps: (Optional) Max search/read iterations (default 15)

Output includes:
- answer: Synthesized response with issue analysis
- references: List of Jira issues explored (key, summary, status, url)`,

  get_confluence_page: `Get raw Confluence page content (pass-through).

Fetches full page content by ID from Atlassian Cloud Confluence.
Returns markdown-converted content. No LLM involved.

Parameters:
- page_id: Confluence page ID

Returns: { id, title, url, space, content }`,

  search_confluence: `Search Confluence pages using CQL (Confluence Query Language).

No LLM involved — direct REST search against Atlassian Cloud Confluence.

Parameters:
- cql: CQL query string (e.g., 'text ~ "keymanager" AND type = "page"')
- limit: Max results (default 10)

Returns array of:
{
  id, title, url, spaceKey, bodyHtml (optional), lastModified
}

Examples:
- Search by text: { "cql": "text ~ \\"keymanager veto\\"" }
- Search in space: { "cql": "space = \\"ONTAPDEV\\" AND text ~ \\"encryption\\"" }
- Search by label: { "cql": "label = \\"security\\" AND type = \\"page\\"" }
- Recent pages: { "cql": "type = \\"page\\" AND lastModified >= \\"2024-01-01\\"", "limit": 5 }`,

  search_jira: `Search Jira issues using structured filters or raw JQL.

Supports two modes:
1. **Structured filters** (recommended) — provide project, text, status, assignee, etc. and JQL is auto-generated.
2. **Raw JQL** — provide a jql string directly (structured filters are ignored).

Structured filter parameters (all optional, combine as needed):
- project: Project key (e.g., 'CONTAP', 'BURT')
- text: Full-text search across summary + description + comments
- status: Status filter (string or array, e.g., 'Open' or ['In Progress', 'New'])
- assignee: Assignee username
- reporter: Reporter username
- component: Component name(s) (e.g., 'key_mgmt_external <Security>')
- priority: Priority level(s) (e.g., 'P0' or ['P0', 'P1'])
- issueType: Issue type (e.g., 'Defect', 'Root Cause Analysis')
- resolution: Resolution (e.g., 'Fixed', 'EMPTY' for unresolved)
- labels: Label(s) to filter on
- fixVersion: Fix version name
- createdAfter / updatedAfter: Date filters (YYYY-MM-DD)
- orderBy: ORDER BY clause (e.g., 'priority ASC, created DESC')
- limit: Max results (default 20)
- offset: Skip first N results (pagination)

Raw JQL mode:
- jql: Full JQL query string (e.g., 'project = BURT AND status = Open')

Returns array of:
{
  key, summary, status, priority, assignee, reporter,
  created, updated, components, fixVersions, labels, url
}`,

  get_jira_issue: `Get detailed Jira issue information by key.

Parameters:
- issueKey: Jira issue key (e.g., 'BURT-123456')
- includeComments: Whether to include comments (default: true)

Returns:
{
  key, summary, description, status, priority, issueType,
  assignee, reporter, created, updated, resolution, resolutionDate,
  components, fixVersions, labels, comments, url
}`,

  ask_reviewboard: `Search and analyze Review Board reviews intelligently.

This is an intelligent agent that:
1. **Searches** for relevant reviews
2. **Reads** review content and comments
3. **Synthesizes** findings into an answer
4. **Cites** all reviews explored

Use this for:
- Finding reviews related to a feature or bug
- Understanding review feedback patterns
- Investigating code changes in a subsystem

Example queries:
- "What reviews touch keymanager code?"
- "Summarize review 123456"
- "Recent security-related reviews"

Parameters:
- question: Your question about Review Board reviews
- reviewIds: (Optional) Specific review IDs to analyze
- maxSteps: (Optional) Max search/read iterations (default 15)

Output includes:
- answer: Synthesized review analysis
- tokenUsage: LLM token usage`,

  agent_graph_search: `Graph-first code exploration agent with session-persistent knowledge graph.
Iteratively explores the codebase by building and traversing an in-memory graph.
Uses cached graph nodes (FREE) before making expensive API calls.

DO NOT USE FOR (use the faster primitive tool instead):
- Single symbol lookup → use analyze_symbol_ast (~5s)
- "Who calls X?" → use call_graph_fast (~4s)
- "Trace X to CLI entry point" → use trace_call_chain (~60s)
- "What tables does X touch?" → use trace_call_chain (~60s)
- Iterator field analysis → use analyze_iterator (~30s)
- "What CLI triggers X?" → use call_graph_fast + smf_cli_mapping

BEST FOR (genuine value-add over primitives):
- Multi-entity exploration: "How are X, Y, and Z related?"
- Follow-up discovery: iterative exploration building on prior results
- Comparison queries: "Compare the enable flow vs disable flow"
- Open-ended investigation: "What subsystems does keymanager touch?"
- Neighborhood analysis: "What are all the neighbors of X?"

Parameters:
- query: Your question about code relationships
- maxSteps: Maximum reasoning steps (default: 100, max: 100)

This agent is COST-AWARE - it uses the graph cache before making API calls.
Typical runtime: 30-120s. Runs async by default.`,

  agent_investigate: `Deep investigation agent with multi-turn session memory.

This is the most powerful tool — a full autonomous agent that orchestrates ALL 19
primitive tools to deeply investigate code questions. Unlike single-turn tools,
it maintains conversation context across calls, building on prior findings.

USE THIS WHEN:
- Questions require 5+ tool calls to answer properly
- You need deep, tenacious investigation (the agent won't stop until it finds answers)
- Multi-hop tracing: function → callers → iterators → CLI → REST → tables
- Understanding complex subsystem interactions
- Investigating defects that span multiple files/components
- Any question where you'd normally chain 3+ primitive tools

DO NOT USE WHEN:
- Simple lookups (use analyze_symbol_ast instead)
- Single function definition (use search)
- Quick call graph (use call_graph_fast)

MULTI-TURN: Pass the returned session_id back to continue the conversation.
The agent remembers all prior context — ask follow-up questions naturally.
Sessions auto-expire after 30 minutes of inactivity.

Parameters:
- question: Your investigation question (be specific for best results)
- session_id: (Optional) Resume a prior session for follow-up questions
- max_steps: (Optional) Max reasoning steps per turn (default 30, max 100)
- model: (Optional) Model override (default: gpt-5.2, only for new sessions)

Example flow:
  1. { question: "Trace keymanager veto flow from CLI to database tables" }
     → Returns answer + session_id: "s-abc123"
  2. { question: "What happens during takeover?", session_id: "s-abc123" }
     → Continues investigation with full prior context`,

  graph_walk: `Walk the in-memory knowledge graph (FREE — no API calls).

Performs multi-hop BFS traversal from a starting node.
Use this to explore known entities before making expensive API calls.
Returns nodes and edges within the specified depth.

The graph accumulates knowledge from every tool call - it's a WARM CACHE.

Parameters:
- startNode: Node ID to start from (lowercase)
- maxDepth: Maximum BFS depth (default: 2)`,

  graph_expand: `Expand a single node in the knowledge graph by fetching fresh data from OpenGrok.

Calls analyze_symbol_ast for the node, then merges callers/callees into the graph.
Costs 1 OpenGrok API call. Use graph_walk first to check what's already known.

Parameters:
- nodeId: Node ID to expand (the symbol name)

Example: { "nodeId": "deleteKeyFromLocalCryptomod" }

Returns: { nodesAdded, edgesAdded, definition }`,

  graph_expand_batch: `Expand multiple nodes in parallel (batch). Each node costs 1 API call.

Uses Promise.all for maximum throughput. Merges all results into the knowledge graph.
Use after graph_walk to expand frontier nodes.

Parameters:
- nodeIds: Array of node IDs to expand (1-10 nodes)

Example: { "nodeIds": ["func1", "func2", "func3"] }

Returns: { results: [{nodeId, nodesAdded, edgesAdded}], totalNodesAdded, totalEdgesAdded }`,

  graph_find_or_expand: `Find a node in the graph, or expand it from OpenGrok if not found.

This is the recommended entry point for graph search - it avoids redundant API calls.
If the node is already in the graph, returns its data for free.
If not found, seeds it from OpenGrok (1 API call).

Parameters:
- symbol: Symbol name to find or expand

Example: { "symbol": "deleteKeyFromLocalCryptomod" }`,
};
