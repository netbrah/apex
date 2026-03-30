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
import { getFileTool } from './opengrok-native/tools/get-file.js';
import { analyzeSymbolAstTool } from './opengrok-native/tools/analyze-symbol-ast.js';

interface OpenGrokSearchParams {
  full?: string | null;
  definition?: string | null;
  symbol?: string | null;
  path?: string | null;
  type?: string | null;
  maxResults?: number;
  suggestOnEmpty?: boolean;
}

interface OpenGrokGetFileParams {
  filePath: string;
  startLine?: number;
  endLine?: number;
  maxLines?: number;
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

class OpenGrokGetFileInvocation extends BaseToolInvocation<
  OpenGrokGetFileParams,
  ToolResult
> {
  getDescription(): string {
    return this.params.filePath;
  }

  async execute(): Promise<ToolResult> {
    try {
      const result = await getFileTool.execute(this.params);
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

export class OpenGrokGetFileTool extends BaseDeclarativeTool<
  OpenGrokGetFileParams,
  ToolResult
> {
  static readonly Name = ToolNames.GET_FILE;

  constructor() {
    super(
      OpenGrokGetFileTool.Name,
      ToolDisplayNames.GET_FILE,
      TOOL_DESCRIPTIONS.get_file,
      Kind.Read,
      {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description:
              'Path to the file. Supports #L100-L200 suffix for line range (startLine/endLine params take precedence)',
          },
          startLine: {
            type: 'number',
            description:
              'Start line (1-based). Use with endLine for exact range. Takes precedence over #L suffix',
          },
          endLine: {
            type: 'number',
            description:
              'End line (1-based, inclusive). Defaults to startLine + 50 if only startLine given',
          },
          maxLines: {
            type: 'number',
            description:
              'Max lines to return for non-range requests (default 1000, hard cap 2000)',
          },
        },
        required: ['filePath'],
      },
      false,
    );
  }

  protected createInvocation(
    params: OpenGrokGetFileParams,
  ): ToolInvocation<OpenGrokGetFileParams, ToolResult> {
    return new OpenGrokGetFileInvocation(params);
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
