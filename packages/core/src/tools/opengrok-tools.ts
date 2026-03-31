/**
 * Native ONTAP OpenGrok tools (vendored from opengrokmcp).
 */

import type { ToolInvocation, ToolResult } from './tools.js';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.js';
import { ToolErrorType } from './tool-error.js';
import { ToolDisplayNames, ToolNames } from './tool-names.js';
import { safeJsonStringify } from '../utils/safeJsonStringify.js';

import { TOOL_DESCRIPTIONS } from './opengrok-native/prompts/index.js';
import { searchTool } from './opengrok-native/tools/search.js';
import { analyzeSymbolAstTool } from './opengrok-native/tools/analyze-symbol-ast.js';
import { ontapDiscoverTool } from './opengrok-native/ontap-discover/ontap-discover.js';
import { createJiraTools } from './opengrok-native/tools/jira-tools.js';
import { createConfluenceTools } from './opengrok-native/tools/confluence-tools.js';
import { callGraphFastTool } from './opengrok-native/tools/call-graph-fast.js';
import { traceCallChainTool } from './opengrok-native/tools/trace-call-chain.js';
import { analyzeIteratorTool } from './opengrok-native/tools/analyze-iterator.js';
import {
  searchConfluence,
  isConfluenceConfigured,
  isConfluenceError,
} from './opengrok-native/lib/confluence-client.js';

// Lazy-initialize Jira/Confluence tool instances
const _jiraTools = createJiraTools();
const _confluenceTools = createConfluenceTools();

interface OpenGrokSearchParams {
  full?: string | null;
  definition?: string | null;
  symbol?: string | null;
  path?: string | null;
  type?: string | null;
  maxResults?: number;
  suggestOnEmpty?: boolean;
}

interface OpenGrokAnalyzeSymbolAstParams {
  symbol: string;
  maxCallers?: number;
  maxCallees?: number;
  includeSource?: boolean;
  contextLines?: number;
  includeTests?: boolean;
  maxTestCallers?: number;
  verbose?: boolean;
  suggestOnEmpty?: boolean;
}

interface SearchJiraParams {
  jql?: string;
  project?: string;
  text?: string;
  status?: string | string[];
  assignee?: string;
  reporter?: string;
  component?: string | string[];
  priority?: string | string[];
  issueType?: string;
  resolution?: string;
  labels?: string | string[];
  fixVersion?: string;
  createdAfter?: string;
  updatedAfter?: string;
  orderBy?: string;
  limit?: number;
}

interface GetJiraIssueParams {
  issue_key: string;
}

interface GetConfluencePageParams {
  page_id: string;
}

interface CallGraphFastParams {
  symbol: string;
  max_depth?: number;
  max_callers?: number;
  format?: 'mermaid' | 'structured' | 'all';
  filter_noise?: boolean;
  path_filter?: string;
  track_instantiations?: boolean;
  include_code?: boolean;
  verbose?: boolean;
  references?: boolean;
  suggestOnEmpty?: boolean;
}

interface TraceCallChainParams {
  symbol: string;
  maxDepth?: number;
  verbose?: boolean;
  suggestOnEmpty?: boolean;
}

interface AnalyzeIteratorParams {
  iterator: string;
  maxCallers?: number;
  maxDepth?: number;
  includeImpMethods?: boolean;
  verbose?: boolean;
  suggestOnEmpty?: boolean;
}

function serializeResult(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }
  return safeJsonStringify(result);
}

class OpenGrokSearchInvocation extends BaseToolInvocation<
  OpenGrokSearchParams,
  ToolResult
> {
  getDescription(): string {
    return (
      this.params.definition ||
      this.params.symbol ||
      this.params.full ||
      'search'
    );
  }

  async execute(): Promise<ToolResult> {
    try {
      const result = await searchTool.execute(this.params);
      const output = serializeResult(result);
      return {
        llmContent: output,
        returnDisplay: output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        llmContent: message,
        returnDisplay: message,
        error: {
          message,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }
  }
}

class OpenGrokAnalyzeSymbolAstInvocation extends BaseToolInvocation<
  OpenGrokAnalyzeSymbolAstParams,
  ToolResult
> {
  getDescription(): string {
    return this.params.symbol;
  }

  async execute(): Promise<ToolResult> {
    try {
      const result = await analyzeSymbolAstTool.execute(this.params);
      const output = serializeResult(result);
      return {
        llmContent: output,
        returnDisplay: output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        llmContent: message,
        returnDisplay: message,
        error: {
          message,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }
  }
}

export class OpenGrokSearchTool extends BaseDeclarativeTool<
  OpenGrokSearchParams,
  ToolResult
> {
  static readonly Name = ToolNames.SEARCH;

  constructor() {
    super(
      OpenGrokSearchTool.Name,
      ToolDisplayNames.SEARCH,
      TOOL_DESCRIPTIONS.search,
      Kind.Read,
      {
        type: 'object',
        properties: {
          full: {
            type: 'string',
            description:
              "Full text search (Lucene syntax). Use simple keywords, NOT raw code. Avoid unmatched quotes/parens — they cause errors. Prefer 'definition' or 'symbol' for function names.",
          },
          definition: {
            type: 'string',
            description:
              'Find where a symbol is DEFINED (function, class, macro name)',
          },
          symbol: {
            type: 'string',
            description: 'Find all REFERENCES/usages of a symbol',
          },
          path: {
            type: 'string',
            description: 'Filter by file path pattern',
          },
          type: {
            type: 'string',
            description: 'Filter by file type (c, cxx, java, python, etc.)',
          },
          maxResults: {
            type: 'number',
            description:
              'Maximum results (keep ≤10 for agent use, ≤20 for interactive)',
          },
          suggestOnEmpty: {
            type: 'boolean',
            description:
              'When true and no results found, use semantic search to suggest similar symbols (Did You Mean?).',
          },
        },
      },
      false,
    );
  }

  protected createInvocation(
    params: OpenGrokSearchParams,
  ): ToolInvocation<OpenGrokSearchParams, ToolResult> {
    return new OpenGrokSearchInvocation(params);
  }
}

export class OpenGrokAnalyzeSymbolAstTool extends BaseDeclarativeTool<
  OpenGrokAnalyzeSymbolAstParams,
  ToolResult
> {
  static readonly Name = ToolNames.ANALYZE_SYMBOL_AST;

  constructor() {
    super(
      OpenGrokAnalyzeSymbolAstTool.Name,
      ToolDisplayNames.ANALYZE_SYMBOL_AST,
      TOOL_DESCRIPTIONS.analyze_symbol_ast,
      Kind.Read,
      {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Function/method name to analyze',
          },
          maxCallers: {
            type: 'number',
            description:
              'Maximum callers to return (keep low to avoid token overflow)',
          },
          maxCallees: {
            type: 'number',
            description:
              'Maximum callees to return (keep low to avoid token overflow)',
          },
          includeSource: {
            type: 'boolean',
            description: 'Include source snippet',
          },
          contextLines: {
            type: 'number',
            description:
              'Lines of source to include (keep ≤50 to avoid token overflow)',
          },
          includeTests: {
            type: 'boolean',
            description:
              'Include test file callers (*.ut, /test/, _test.) in output',
          },
          maxTestCallers: {
            type: 'number',
            description: 'Maximum test file callers to return',
          },
          verbose: {
            type: 'boolean',
            description:
              'Include allReferences, filteredCallees, and timing in output (default: true for full context)',
          },
          suggestOnEmpty: {
            type: 'boolean',
            description:
              'When true and no results found, use semantic search to suggest similar symbols (Did You Mean?).',
          },
        },
        required: ['symbol'],
      },
      false,
    );
  }

  protected createInvocation(
    params: OpenGrokAnalyzeSymbolAstParams,
  ): ToolInvocation<OpenGrokAnalyzeSymbolAstParams, ToolResult> {
    return new OpenGrokAnalyzeSymbolAstInvocation(params);
  }
}

// ============================================================================
// ONTAP Discover Tool — deterministic API/SMF/CLI discovery
// ============================================================================

interface OntapDiscoverParams {
  action:
    | 'search'
    | 'get_endpoint'
    | 'get_smf_table'
    | 'get_command'
    | 'browse_cli'
    | 'list_debug_smdb_tables'
    | 'list_tags'
    | 'list_domains'
    | 'cli_to_rest'
    | 'options'
    | 'stats';
  query?: string;
  limit?: number;
  domain?: string;
  source?: 'swagger' | 'smf-rest' | 'smf-debug' | 'private-cli' | 'smf-action';
  queryableOnly?: boolean;
  debugSmdbOnly?: boolean;
  path?: string;
  method?: string;
  tableName?: string;
  cliCommand?: string;
  cliPath?: string;
  includeCurl?: boolean;
  clusterIp?: string;
  includeExamples?: boolean;
}

class OntapDiscoverInvocation extends BaseToolInvocation<
  OntapDiscoverParams,
  ToolResult
> {
  getDescription(): string {
    return `${this.params.action}: ${this.params.query || this.params.tableName || this.params.path || this.params.cliCommand || this.params.cliPath || ''}`;
  }

  async execute(): Promise<ToolResult> {
    try {
      const result = await ontapDiscoverTool.execute(this.params);
      const output = serializeResult(result);
      return {
        llmContent: output,
        returnDisplay: output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        llmContent: message,
        returnDisplay: message,
        error: {
          message,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }
  }
}

export class OntapDiscoverTool extends BaseDeclarativeTool<
  OntapDiscoverParams,
  ToolResult
> {
  static readonly Name = ToolNames.ONTAP_DISCOVER;

  constructor() {
    super(
      OntapDiscoverTool.Name,
      ToolDisplayNames.ONTAP_DISCOVER,
      TOOL_DESCRIPTIONS.ontap_discover,
      Kind.Read,
      {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [
              'search',
              'get_endpoint',
              'get_smf_table',
              'get_command',
              'browse_cli',
              'list_debug_smdb_tables',
              'list_tags',
              'list_domains',
              'cli_to_rest',
              'options',
              'stats',
            ],
            description:
              'search: find APIs/tables by keyword. ' +
              'get_endpoint: get REST endpoint details by path. ' +
              'get_smf_table: get internal table schema. ' +
              'get_command: unified lookup by CLI/table/path. ' +
              'browse_cli: CLI command tree navigator. ' +
              'list_debug_smdb_tables: list dark API tables. ' +
              'cli_to_rest: convert CLI to REST. ' +
              'list_tags/list_domains: enumerate categories. ' +
              'options: discover allowed HTTP methods. ' +
              'stats: index statistics.',
          },
          query: {
            type: 'string',
            description:
              'Natural-language search query. Required for search action.',
          },
          limit: {
            type: 'number',
            description: 'Max results to return (default 10)',
          },
          domain: {
            type: 'string',
            description:
              'Filter by API domain (e.g., security, storage, cluster, network).',
          },
          source: {
            type: 'string',
            enum: [
              'swagger',
              'smf-rest',
              'smf-debug',
              'private-cli',
              'smf-action',
            ],
            description: 'Filter by data source.',
          },
          queryableOnly: {
            type: 'boolean',
            description:
              'When true, only return endpoints with a queryable REST or debug API.',
          },
          debugSmdbOnly: {
            type: 'boolean',
            description:
              'When true, only return tables queryable via debug smdb.',
          },
          path: {
            type: 'string',
            description:
              'REST API path WITHOUT /api/ prefix. Required for get_endpoint and options.',
          },
          method: {
            type: 'string',
            description: 'HTTP method: GET, POST, PATCH, DELETE.',
          },
          tableName: {
            type: 'string',
            description:
              'SMF table name. Also accepts CLI commands — resolved via cross-reference.',
          },
          cliCommand: {
            type: 'string',
            description:
              'ONTAP CLI command. Required for cli_to_rest. Also used by get_command.',
          },
          cliPath: {
            type: 'string',
            description:
              'CLI command path for browse_cli. Examples: "security key-manager".',
          },
          includeCurl: {
            type: 'boolean',
            description:
              'Include curl examples in the response (default true).',
          },
          clusterIp: {
            type: 'string',
            description: 'ONTAP cluster management IP for curl examples.',
          },
          includeExamples: {
            type: 'boolean',
            description: 'Fetch CLI examples with real parameter values.',
          },
        },
        required: ['action'],
      },
      false,
    );
  }

  protected createInvocation(
    params: OntapDiscoverParams,
  ): ToolInvocation<OntapDiscoverParams, ToolResult> {
    return new OntapDiscoverInvocation(params);
  }
}

// ============================================================================
// Search Jira Tool
// ============================================================================

class SearchJiraInvocation extends BaseToolInvocation<
  SearchJiraParams,
  ToolResult
> {
  getDescription(): string {
    return (
      this.params.jql ||
      this.params.text ||
      this.params.project ||
      'search jira'
    );
  }

  async execute(): Promise<ToolResult> {
    try {
      const result = await _jiraTools.search_jira.execute(this.params);
      const output = serializeResult(result);
      return {
        llmContent: output,
        returnDisplay: output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        llmContent: message,
        returnDisplay: message,
        error: {
          message,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }
  }
}

export class SearchJiraTool extends BaseDeclarativeTool<
  SearchJiraParams,
  ToolResult
> {
  static readonly Name = ToolNames.SEARCH_JIRA;

  constructor() {
    super(
      SearchJiraTool.Name,
      ToolDisplayNames.SEARCH_JIRA,
      TOOL_DESCRIPTIONS.search_jira,
      Kind.Read,
      {
        type: 'object',
        properties: {
          jql: {
            type: 'string',
            description:
              'Raw JQL query string. If provided, structured filters below are ignored.',
          },
          project: {
            type: 'string',
            description: "Project key (e.g., 'CONTAP', 'BURT')",
          },
          text: {
            type: 'string',
            description:
              'Full-text search across summary + description + comments',
          },
          status: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
            description:
              "Status filter: single value or array (e.g., 'Open' or ['In Progress', 'New'])",
          },
          assignee: {
            type: 'string',
            description: 'Assignee username or displayName',
          },
          reporter: {
            type: 'string',
            description: 'Reporter username or displayName',
          },
          component: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
            description:
              "Component name(s) (e.g., 'key_mgmt_external <Security>')",
          },
          priority: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
            description: "Priority level(s) (e.g., 'P0' or ['P0', 'P1'])",
          },
          issueType: {
            type: 'string',
            description: "Issue type (e.g., 'Defect', 'Root Cause Analysis')",
          },
          resolution: {
            type: 'string',
            description: "Resolution (e.g., 'Fixed', 'EMPTY' for unresolved)",
          },
          labels: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
            description: 'Label(s) to filter on',
          },
          fixVersion: {
            type: 'string',
            description: 'Fix version name',
          },
          createdAfter: {
            type: 'string',
            description: 'Created after date (YYYY-MM-DD)',
          },
          updatedAfter: {
            type: 'string',
            description: 'Updated after date (YYYY-MM-DD)',
          },
          orderBy: {
            type: 'string',
            description: "ORDER BY clause (e.g., 'priority ASC, created DESC')",
          },
          limit: {
            type: 'number',
            description: 'Max results (default 20)',
          },
        },
      },
      false,
    );
  }

  protected createInvocation(
    params: SearchJiraParams,
  ): ToolInvocation<SearchJiraParams, ToolResult> {
    return new SearchJiraInvocation(params);
  }
}

// ============================================================================
// Get Jira Issue Tool
// ============================================================================

class GetJiraIssueInvocation extends BaseToolInvocation<
  GetJiraIssueParams,
  ToolResult
> {
  getDescription(): string {
    return this.params.issue_key;
  }

  async execute(): Promise<ToolResult> {
    try {
      const result = await _jiraTools.get_jira_issue.execute(this.params);
      const output = serializeResult(result);
      return {
        llmContent: output,
        returnDisplay: output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        llmContent: message,
        returnDisplay: message,
        error: {
          message,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }
  }
}

export class GetJiraIssueTool extends BaseDeclarativeTool<
  GetJiraIssueParams,
  ToolResult
> {
  static readonly Name = ToolNames.GET_JIRA_ISSUE;

  constructor() {
    super(
      GetJiraIssueTool.Name,
      ToolDisplayNames.GET_JIRA_ISSUE,
      TOOL_DESCRIPTIONS.get_jira_issue,
      Kind.Read,
      {
        type: 'object',
        properties: {
          issue_key: {
            type: 'string',
            description:
              "Jira issue key (e.g., 'BURT-123456', 'CONTAP-600293')",
          },
        },
        required: ['issue_key'],
      },
      false,
    );
  }

  protected createInvocation(
    params: GetJiraIssueParams,
  ): ToolInvocation<GetJiraIssueParams, ToolResult> {
    return new GetJiraIssueInvocation(params);
  }
}

// ============================================================================
// Get Confluence Page Tool
// ============================================================================

class GetConfluencePageInvocation extends BaseToolInvocation<
  GetConfluencePageParams,
  ToolResult
> {
  getDescription(): string {
    return this.params.page_id;
  }

  async execute(): Promise<ToolResult> {
    try {
      const result = await _confluenceTools.get_confluence_page.execute(
        this.params,
      );
      const output = serializeResult(result);
      return {
        llmContent: output,
        returnDisplay: output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        llmContent: message,
        returnDisplay: message,
        error: {
          message,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }
  }
}

export class GetConfluencePageTool extends BaseDeclarativeTool<
  GetConfluencePageParams,
  ToolResult
> {
  static readonly Name = ToolNames.GET_CONFLUENCE_PAGE;

  constructor() {
    super(
      GetConfluencePageTool.Name,
      ToolDisplayNames.GET_CONFLUENCE_PAGE,
      TOOL_DESCRIPTIONS.get_confluence_page,
      Kind.Read,
      {
        type: 'object',
        properties: {
          page_id: {
            type: 'string',
            description: 'Confluence page ID',
          },
        },
        required: ['page_id'],
      },
      false,
    );
  }

  protected createInvocation(
    params: GetConfluencePageParams,
  ): ToolInvocation<GetConfluencePageParams, ToolResult> {
    return new GetConfluencePageInvocation(params);
  }
}

// ============================================================================
// Call Graph Fast Tool
// ============================================================================

class CallGraphFastInvocation extends BaseToolInvocation<
  CallGraphFastParams,
  ToolResult
> {
  getDescription(): string {
    return this.params.symbol;
  }

  async execute(): Promise<ToolResult> {
    try {
      const result = await callGraphFastTool.execute(this.params);
      const output = serializeResult(result);
      return {
        llmContent: output,
        returnDisplay: output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        llmContent: message,
        returnDisplay: message,
        error: {
          message,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }
  }
}

export class CallGraphFastTool extends BaseDeclarativeTool<
  CallGraphFastParams,
  ToolResult
> {
  static readonly Name = ToolNames.CALL_GRAPH_FAST;

  constructor() {
    super(
      CallGraphFastTool.Name,
      ToolDisplayNames.CALL_GRAPH_FAST,
      TOOL_DESCRIPTIONS.call_graph_fast,
      Kind.Read,
      {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Entry point function to find callers for',
          },
          max_depth: {
            type: 'number',
            description:
              'Maximum depth to traverse upstream (default: 1, max: 3). Use 1 for fast iterator tracing, 2 only if needed.',
          },
          max_callers: {
            type: 'number',
            description: 'Maximum callers to find per level (default: 10)',
          },
          format: {
            type: 'string',
            enum: ['mermaid', 'structured', 'all'],
            description:
              'Output format: structured (default, machine-parseable JSON), mermaid for visual diagram, all for structured+mermaid',
          },
          filter_noise: {
            type: 'boolean',
            description:
              'Filter out noise functions like traceError, std::*, ON_SCOPE_EXIT (default: true)',
          },
          path_filter: {
            type: 'string',
            description:
              "Only include callers from files matching this path (e.g., 'keymanager', 'security')",
          },
          track_instantiations: {
            type: 'boolean',
            description:
              'For leaf nodes that are iterator _imp methods, search for instantiation patterns to discover deeper callers. Adds ~1-3s per iterator method.',
          },
          include_code: {
            type: 'boolean',
            description:
              'Include code snippets in output for in-depth understanding. Adds function signatures, call site context (~10 lines), and docstrings.',
          },
          verbose: {
            type: 'boolean',
            description:
              'Include timing stats, noise entries, and debug info in output. Default false for cleaner output.',
          },
          references: {
            type: 'boolean',
            description:
              'Return only flat references array with file:line links for VS Code. When true, returns minimal output optimized for downstream processing.',
          },
          suggestOnEmpty: {
            type: 'boolean',
            description:
              'When true and no callers found, use semantic search to suggest similar symbols (Did You Mean?).',
          },
        },
        required: ['symbol'],
      },
      false,
    );
  }

  protected createInvocation(
    params: CallGraphFastParams,
  ): ToolInvocation<CallGraphFastParams, ToolResult> {
    return new CallGraphFastInvocation(params);
  }
}

// ============================================================================
// Trace Call Chain Tool
// ============================================================================

class TraceCallChainInvocation extends BaseToolInvocation<
  TraceCallChainParams,
  ToolResult
> {
  getDescription(): string {
    return this.params.symbol;
  }

  async execute(): Promise<ToolResult> {
    try {
      const result = await traceCallChainTool.execute(this.params);
      const output = serializeResult(result);
      return {
        llmContent: output,
        returnDisplay: output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        llmContent: message,
        returnDisplay: message,
        error: {
          message,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }
  }
}

export class TraceCallChainTool extends BaseDeclarativeTool<
  TraceCallChainParams,
  ToolResult
> {
  static readonly Name = ToolNames.TRACE_CALL_CHAIN;

  constructor() {
    super(
      TraceCallChainTool.Name,
      ToolDisplayNames.TRACE_CALL_CHAIN,
      TOOL_DESCRIPTIONS.trace_call_chain,
      Kind.Read,
      {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description:
              "Function or iterator method to trace (e.g., 'pushKeyToKmipServerForced', 'keymanager_vdek_table_iterator::create_imp'). Works for ANY function - finds tables touched and CLI entry points.",
          },
          maxDepth: {
            type: 'number',
            description:
              'Maximum depth to trace upstream (default: 2, for finding CLI entry points)',
          },
          verbose: {
            type: 'boolean',
            description:
              'Full output with all callers/callees arrays (default: true = full ~25KB, false = condensed ~6KB)',
          },
          suggestOnEmpty: {
            type: 'boolean',
            description:
              'When true and no results found, use semantic search to suggest similar symbols (Did You Mean?).',
          },
        },
        required: ['symbol'],
      },
      false,
    );
  }

  protected createInvocation(
    params: TraceCallChainParams,
  ): ToolInvocation<TraceCallChainParams, ToolResult> {
    return new TraceCallChainInvocation(params);
  }
}

// ============================================================================
// Analyze Iterator Tool
// ============================================================================

class AnalyzeIteratorInvocation extends BaseToolInvocation<
  AnalyzeIteratorParams,
  ToolResult
> {
  getDescription(): string {
    return this.params.iterator;
  }

  async execute(): Promise<ToolResult> {
    try {
      const result = await analyzeIteratorTool.execute(this.params);
      const output = serializeResult(result);
      return {
        llmContent: output,
        returnDisplay: output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        llmContent: message,
        returnDisplay: message,
        error: {
          message,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }
  }
}

export class AnalyzeIteratorTool extends BaseDeclarativeTool<
  AnalyzeIteratorParams,
  ToolResult
> {
  static readonly Name = ToolNames.ANALYZE_ITERATOR;

  constructor() {
    super(
      AnalyzeIteratorTool.Name,
      ToolDisplayNames.ANALYZE_ITERATOR,
      TOOL_DESCRIPTIONS.analyze_iterator,
      Kind.Read,
      {
        type: 'object',
        properties: {
          iterator: {
            type: 'string',
            description:
              'Iterator class name (e.g., keymanager_keystore_enable_iterator)',
          },
          maxCallers: {
            type: 'number',
            description:
              'Maximum number of direct callers to analyze for field usage (default: 10)',
          },
          maxDepth: {
            type: 'number',
            description:
              'Call graph depth: 1=direct callers only, 2=include transitive (default: 2)',
          },
          includeImpMethods: {
            type: 'boolean',
            description:
              'Analyze *_imp methods for action iterators (default: true)',
          },
          verbose: {
            type: 'boolean',
            description: 'Include source snippets and timing (default: false)',
          },
          suggestOnEmpty: {
            type: 'boolean',
            description:
              'When true and iterator not found, use semantic search to suggest similar iterators (Did You Mean?).',
          },
        },
        required: ['iterator'],
      },
      false,
    );
  }

  protected createInvocation(
    params: AnalyzeIteratorParams,
  ): ToolInvocation<AnalyzeIteratorParams, ToolResult> {
    return new AnalyzeIteratorInvocation(params);
  }
}

// ============================================================================
// Search Confluence Tool
// ============================================================================

interface SearchConfluenceParams {
  cql: string;
  limit?: number;
}

class SearchConfluenceInvocation extends BaseToolInvocation<
  SearchConfluenceParams,
  ToolResult
> {
  getDescription(): string {
    return this.params.cql;
  }

  async execute(): Promise<ToolResult> {
    try {
      if (!isConfluenceConfigured()) {
        const msg =
          'Confluence not configured. Set CONFLUENCE_TOKEN environment variable.';
        return {
          llmContent: msg,
          returnDisplay: msg,
          error: { message: msg, type: ToolErrorType.EXECUTION_FAILED },
        };
      }

      const result = await searchConfluence(this.params.cql, {
        limit: this.params.limit,
      });

      if (isConfluenceError(result)) {
        const msg = (result as { message: string }).message;
        return {
          llmContent: msg,
          returnDisplay: msg,
          error: { message: msg, type: ToolErrorType.EXECUTION_FAILED },
        };
      }

      const output = serializeResult({
        success: true,
        results: result,
        count: Array.isArray(result) ? result.length : 0,
      });
      return { llmContent: output, returnDisplay: output };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        llmContent: message,
        returnDisplay: message,
        error: { message, type: ToolErrorType.EXECUTION_FAILED },
      };
    }
  }
}

export class SearchConfluenceTool extends BaseDeclarativeTool<
  SearchConfluenceParams,
  ToolResult
> {
  static readonly Name = ToolNames.SEARCH_CONFLUENCE;

  constructor() {
    super(
      SearchConfluenceTool.Name,
      ToolDisplayNames.SEARCH_CONFLUENCE,
      TOOL_DESCRIPTIONS.search_confluence,
      Kind.Read,
      {
        type: 'object',
        properties: {
          cql: {
            type: 'string',
            description:
              'CQL query string (e.g., \'text ~ "keymanager" AND type = "page"\')',
          },
          limit: {
            type: 'number',
            description: 'Max results (default 10)',
          },
        },
        required: ['cql'],
      },
      false,
    );
  }

  protected createInvocation(
    params: SearchConfluenceParams,
  ): ToolInvocation<SearchConfluenceParams, ToolResult> {
    return new SearchConfluenceInvocation(params);
  }
}
