/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/* eslint-disable */
/**
 * Analyze Symbol AST Tool - HYBRID APPROACH
 *
 * Combines the BEST of both worlds:
 * 1. OpenGrok references → ALL mentions (comments, headers, tests, mocks, actual calls)
 * 2. AST extraction → PRECISE callees (filtered, no trace noise)
 *
 * This is the RECOMMENDED tool for symbol analysis because:
 * - You get complete coverage of WHERE a symbol is mentioned
 * - You get precise callees WITHOUT trace/logging noise
 * - Fast: AST extraction is 10000x faster than LLM
 *
 * Performance comparison:
 * - LLM extraction: 5-10 seconds
 * - Regex AST: 1-5 milliseconds
 * - Native Tree-Sitter: 0.5 milliseconds ✨
 *
 * Uses native tree-sitter bindings for proper AST parsing:
 * - More precise function boundary detection
 * - Better handling of templates, macros
 * - Faster parsing (0.5ms vs ~4ms regex)
 */

import { createTool } from '../lib/mastra-tool-shim.js';
import { z } from '../lib/zod-shim.js';
import {
  makeOpenGrokRequest,
  getFileContent,
  scoreResult,
  inferKind,
  decodeHtmlEntities,
  DEFAULT_PROJECT,
  type OpenGrokSearchResponse,
} from '../lib/opengrok.js';
import { EXCLUDE_PATHS } from '../prompts/index.js';
import {
  CALL_SKIP_LIST,
  AGENT_CONFIG,
  TOOL_DESCRIPTIONS,
} from '../prompts/index.js';
import {
  extractCallsNative,
  findContainingFunctionNative,
  type NativeCallInfo,
  type NativeExtractionResult,
} from '../lib/tree-sitter-native.js';
import { logTool } from '../lib/logger.js';
import { classifyError } from '../lib/errors.js';
import {
  fetchSmfForIterator,
  matchCalleeToSmfField,
  type SmfField,
  type SmfLookupResult,
  type SmfEnumType,
} from './smf-iterator-fields.js';
import {
  getSymbolSuggestions,
  type SymbolSuggestion,
} from '../lib/symbol-suggester.js';

// ============================================================================
// Callee Filtering - Phase 2: Smart Relevance Filtering
// ============================================================================

/**
 * Noise patterns for callees that should be filtered out.
 * Pattern-based, NOT an ad-hoc skip list.
 *
 * Categories:
 * 1. Status/predicate methods: is_*, has_*
 * 2. String/accessor methods: text, c_str, toString, data
 * 3. Container methods: size, length, begin, end, empty, clear
 * 4. Operators
 * 5. Logging/tracing: log*, trace*, LOG_*, TRACE_*
 * 6. Simple getters: get_* (unless on iterator types)
 * 7. Conversion helpers: to_* (unless on iterator types)
 * 8. std::optional methods: value, value_or, emplace, reset
 */
const CALLEE_NOISE_PATTERNS: RegExp[] = [
  // Status/predicate - "is this thing ok/valid/empty?"
  /^(is_|has_)(ok|null|valid|empty|value|present)$/i,
  /^has_value$/, // std::optional

  // String/accessor methods
  /^(text|c_str|toString|to_string|str|data|what)$/,

  // Container methods
  /^(size|length|empty|clear|begin|end|push_back|emplace_back)$/,

  // Operators
  /^operator[\s\S]+$/,

  // Logging/tracing (case-insensitive prefix match)
  /^(log|trace|LOG_|TRACE_|debug|Debug)/i,

  // std::optional methods
  /^(value|value_or|emplace|reset)$/,

  // Simple getters - these just retrieve data, not business logic
  // (iterator get_* methods are kept because they ARE business logic)
  /^get_[a-z_]+$/,

  // Conversion helpers - just data transformation
  /^to_[a-z_]+$/,

  // Smart pointer access
  /^(get|release|reset|swap)$/,
];

/**
 * Utility types whose method calls are typically noise.
 * Methods on these types are filtered unless explicitly kept.
 */
const UTILITY_TYPES = new Set([
  'smdb_error',
  'HexString',
  'String',
  'string',
  'refp', // Smart pointer wrapper
  'std::string',
  'std::vector',
  'std::map',
  'std::optional',
  'std::unique_ptr',
  'std::shared_ptr',
]);

/**
 * Methods to always keep regardless of receiver type.
 * These are semantically important operations.
 */
const ALWAYS_KEEP_METHODS = new Set([
  'create',
  'create_imp',
  'get', // Iterator operation: fetch single row
  'get_imp',
  'modify', // Iterator operation: update row
  'modify_imp',
  'remove', // Iterator operation: delete row
  'remove_imp',
  'start', // Iterator operation: begin iteration
  'start_imp',
  'next', // Iterator operation: get next row
  'next_imp',
  'getError',
  'get_error',
]);

interface CalleeRelevance {
  callee: ExtractedCall;
  keep: boolean;
  reason:
    | 'iterator'
    | 'qualified'
    | 'important'
    | 'noise'
    | 'utility'
    | 'unknown';
}

/**
 * Determine if a callee should be kept or filtered.
 *
 * Relevance rules:
 * - KEEP: All iterator calls (receiverType ends with _iterator)
 * - KEEP: All qualified calls (Class::method)
 * - KEEP: Important methods (create, getError, etc.)
 * - FILTER: Noise methods (is_ok, text, c_str, etc.) on utility types
 * - KEEP: Everything else by default
 */
function categorizeCallee(call: ExtractedCall): CalleeRelevance {
  const { callee, receiverType, callType } = call;

  // Always keep qualified calls (static methods, namespaced functions)
  if (callType === 'qualified') {
    return { callee: call, keep: true, reason: 'qualified' };
  }

  // Always keep iterator calls - they're semantically important
  if (receiverType?.endsWith('_iterator')) {
    return { callee: call, keep: true, reason: 'iterator' };
  }

  // Always keep important methods regardless of type
  if (ALWAYS_KEEP_METHODS.has(callee)) {
    return { callee: call, keep: true, reason: 'important' };
  }

  // Check if it's a noise method on a utility type
  const isNoiseMethod = CALLEE_NOISE_PATTERNS.some((p) => p.test(callee));
  const isUtilityType = receiverType && UTILITY_TYPES.has(receiverType);

  if (isNoiseMethod) {
    // Noise methods on utility types are definitely filtered
    if (isUtilityType) {
      return { callee: call, keep: false, reason: 'utility' };
    }
    // Noise methods on unknown types are also filtered
    if (!receiverType) {
      return { callee: call, keep: false, reason: 'noise' };
    }
  }

  // Default: keep if we don't have a reason to filter
  return { callee: call, keep: true, reason: 'unknown' };
}

// ============================================================================
// Types - Re-export for compatibility
// ============================================================================

interface ExtractedCall {
  callee: string;
  receiver?: string;
  receiverType?: string;
  line: number;
  column?: number;
  callType: 'direct' | 'method' | 'macro' | 'constructor' | 'qualified';
  arguments?: string[];
  smfField?: {
    name: string;
    type: string;
    role: 'key' | 'read' | 'write' | 'unknown';
    description?: string;
  };
}

interface FunctionBounds {
  name: string;
  qualifiedName?: string;
  startLine: number;
  endLine: number;
}

interface ExtractionResult {
  success: boolean;
  calls: ExtractedCall[];
  functionBounds?: FunctionBounds;
  timing: { parseMs: number; extractMs: number };
  error?: string;
}

// ============================================================================
// Native Tree-Sitter Extraction (0.5ms!)
// ============================================================================

/**
 * Extract calls using native tree-sitter.
 * Converts NativeExtractionResult to our tool's format.
 */
function extractCallsWithTiming(
  code: string,
  functionName: string,
  _filePath?: string,
): ExtractionResult {
  const result = extractCallsNative(code, functionName);

  return {
    success: result.success,
    calls: result.calls.map((c) => ({
      callee: c.callee,
      receiver: c.receiver,
      receiverType: c.receiverType,
      line: c.line,
      column: c.column,
      callType: c.callType as ExtractedCall['callType'],
      arguments: c.arguments,
    })),
    functionBounds: result.functionBounds
      ? {
          name: result.functionBounds.name,
          qualifiedName: result.functionBounds.qualifiedName,
          startLine: result.functionBounds.startLine,
          endLine: result.functionBounds.endLine,
        }
      : undefined,
    timing: {
      parseMs: result.timing.parseMs,
      extractMs: result.timing.extractMs,
    },
    error: result.error,
  };
}

// ============================================================================
// Helper: Find containing function (for caller detection)
// Uses native tree-sitter for accuracy
// ============================================================================

interface FunctionLocation {
  name: string;
  qualifiedName?: string;
  startLine: number;
  endLine: number;
}

function findContainingFunction(
  code: string,
  lineNumber: number,
): FunctionLocation | undefined {
  // Use native tree-sitter for accurate function detection
  const result = findContainingFunctionNative(code, lineNumber);
  if (result) {
    return {
      name: result.name,
      qualifiedName: result.qualifiedName,
      startLine: result.startLine,
      endLine: result.endLine,
    };
  }
  return undefined;
}

// ============================================================================
// Caller Info Schema
// ============================================================================

const CallerInfoSchema = z.object({
  file: z.string().describe('File path'),
  line: z
    .number()
    .optional()
    .describe('Line number (undefined when not available from search)'),
  function: z.string().optional().describe('Containing function name'),
  qualifiedFunction: z
    .string()
    .optional()
    .describe('Fully qualified function name'),
  context: z.string().optional().describe('Line of code'),
});

type CallerInfo = z.infer<typeof CallerInfoSchema>;

// ============================================================================
// Tool Definition
// ============================================================================

export const analyzeSymbolAstTool = createTool({
  id: 'analyze_symbol_ast',
  description: TOOL_DESCRIPTIONS.analyze_symbol_ast,
  mcp: {
    annotations: {
      title: 'Analyze Symbol (AST)',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },

  inputSchema: z.object({
    symbol: z.string().describe('Function/method name to analyze'),
    maxCallers: z
      .number()
      .default(15)
      .describe('Maximum callers to return (keep low to avoid token overflow)'),
    maxCallees: z
      .number()
      .default(20)
      .describe('Maximum callees to return (keep low to avoid token overflow)'),
    includeSource: z.boolean().default(true).describe('Include source snippet'),
    contextLines: z
      .number()
      .default(50)
      .describe(
        'Lines of source to include (keep ≤50 to avoid token overflow)',
      ),
    includeTests: z
      .boolean()
      .default(true)
      .describe('Include test file callers (*.ut, /test/, _test.) in output'),
    maxTestCallers: z
      .number()
      .default(10)
      .describe('Maximum test file callers to return'),
    verbose: z
      .boolean()
      .default(true)
      .describe(
        'Include allReferences, filteredCallees, and timing in output (default: true for full context)',
      ),
    suggestOnEmpty: z
      .boolean()
      .optional()
      .describe(
        'When true and no results found, use semantic search to suggest similar symbols (Did You Mean?). Only enable for interactive/agent-facing calls, not internal tool chains.',
      ),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    symbol: z.string(),
    error: z.string().optional(),
    cacheHit: z
      .enum(['response', 'graph'])
      .optional()
      .describe('If set, result was served from cache layer'),

    // Definition info
    definition: z
      .object({
        file: z.string(),
        line: z.number(),
        endLine: z.number().optional(),
        kind: z.string(),
        signature: z.string().optional(),
        source: z.string().optional(),
      })
      .optional(),

    // ALL references from OpenGrok (includes comments, headers, tests, mocks)
    // Only included when verbose=true
    allReferences: z
      .array(
        z.object({
          file: z.string(),
          line: z.number().optional(),
          context: z.string().optional(),
          type: z
            .enum(['call', 'declaration', 'comment', 'test', 'mock', 'other'])
            .optional(),
        }),
      )
      .optional()
      .describe('All mentions of the symbol (only when verbose=true)'),

    // Callers deduplicated by containing function (production code only)
    callers: z
      .array(CallerInfoSchema)
      .describe('Production callers (excludes test files)'),

    // Test file callers (*.ut, /test/, _test.)
    testCallers: z
      .array(CallerInfoSchema)
      .optional()
      .describe('Test file callers (*.ut, /test/, _test.)'),

    // Callees (from AST - precise, no trace noise!)
    callees: z
      .array(
        z.object({
          callee: z.string(),
          receiver: z
            .string()
            .optional()
            .describe('Variable/expression the method is called on'),
          receiverType: z
            .string()
            .optional()
            .describe(
              'Resolved type of the receiver (e.g., keymanager_external_show_status_iterator)',
            ),
          line: z.number(),
          callType: z.string(),
          arguments: z
            .array(z.string())
            .optional()
            .describe('Arguments passed to the callee (from AST extraction)'),
          smfField: z
            .object({
              name: z.string(),
              type: z.string(),
              role: z.enum(['key', 'read', 'write', 'unknown']),
              description: z.string().optional(),
            })
            .optional()
            .describe('SMF field info if this is a set_*/get_* on an iterator'),
        }),
      )
      .describe(
        'Relevant function calls (iterator ops, qualified calls, important methods)',
      ),

    // Filtered callees (only when verbose=true)
    filteredCallees: z
      .array(z.string())
      .optional()
      .describe('Noise callees that were filtered (only when verbose=true)'),

    // SMF schemas fetched for iterator types
    smfSchemas: z
      .array(
        z.object({
          iterator: z.string(),
          tableName: z.string().optional(),
          smfFile: z.string().optional(),
          fieldCount: z.number(),
          // Custom types (domain-specific enums, not standard SMF types)
          customTypes: z
            .array(
              z.object({
                name: z.string().describe('Enum type name'),
                description: z.string().describe('Enum description'),
                values: z.array(
                  z.object({
                    name: z
                      .string()
                      .describe("Enum value name (e.g., 'onboard')"),
                    value: z.number().describe('Numeric value'),
                    description: z
                      .string()
                      .describe('Human-readable description'),
                  }),
                ),
              }),
            )
            .optional()
            .describe('Custom enum types defined in referenced SMF files'),
        }),
      )
      .optional()
      .describe('SMF schemas fetched for iterator types in callees'),

    // "Did You Mean?" suggestions (only when definition not found)
    didYouMean: z
      .array(
        z.object({
          symbol: z.string(),
          score: z.number(),
          source: z.string(),
          language: z.string().optional(),
        }),
      )
      .optional()
      .describe(
        'Symbol suggestions when definition not found (semantic search fallback)',
      ),

    // Timing breakdown (only when verbose=true)
    timing: z
      .object({
        totalMs: z.number(),
        searchMs: z.number(),
        fetchMs: z.number(),
        astMs: z.number(),
        smfMs: z
          .number()
          .optional()
          .describe('Time spent fetching SMF schemas'),
        calleeCount: z.number(),
        callerCount: z.number(),
        referenceCount: z.number(),
      })
      .optional()
      .describe('Timing breakdown (only when verbose=true)'),
  }),

  execute: async ({
    symbol,
    maxCallers = 15,
    maxCallees = 20,
    includeSource = true,
    contextLines = 50,
    includeTests = true,
    maxTestCallers = 10,
    verbose = false,
    suggestOnEmpty = false,
  }) => {
    const project = DEFAULT_PROJECT;
    const startTime = performance.now();
    let searchMs = 0;
    let fetchMs = 0;
    let astMs = 0;
    let smfMs = 0;

    // Log tool start with input params
    const invocationId = logTool.start('analyze_symbol_ast', {
      symbol,
      project,
      maxCallers,
      maxCallees,
      includeSource,
      contextLines,
      verbose,
    });

    const callers: CallerInfo[] = [];
    const testCallers: CallerInfo[] = []; // Separate test file callers (*.ut, /test/)
    const callees: ExtractedCall[] = [];
    let filteredCallees: string[] = []; // Track filtered noise callees
    let smfSchemas: Array<{
      iterator: string;
      tableName?: string;
      smfFile?: string;
      fieldCount: number;
      customTypes?: SmfEnumType[];
    }> = [];
    const allReferences: Array<{
      file: string;
      line: number | undefined;
      context?: string;
      type?: 'call' | 'declaration' | 'comment' | 'test' | 'mock' | 'other';
    }> = [];
    let definition:
      | {
          file: string;
          line: number;
          endLine?: number;
          kind: string;
          signature?: string;
          source?: string;
        }
      | undefined;

    // File content cache
    const fileCache = new Map<string, string>();

    try {
      // ========================================
      // Step 1: PARALLEL - Search definition AND references simultaneously
      // Saves ~500ms by not waiting for def search before ref search
      // ========================================
      const searchStart = performance.now();

      // For qualified names like "Keyserver::pushKeyToKmipServerForced",
      // OpenGrok only indexes the base name, so we search with just "pushKeyToKmipServerForced"
      const defSearchSymbol = symbol.includes('::')
        ? symbol.split('::').pop()!
        : symbol;
      const qualifiedPrefix = symbol.includes('::')
        ? symbol.slice(0, symbol.lastIndexOf('::'))
        : null;

      // Common method names that need disambiguation with full text search.
      // These methods exist in hundreds of iterators, so def: search alone finds wrong files.
      // Adding full: with the class name narrows to exactly the right definition.
      const AMBIGUOUS_METHOD_NAMES = new Set([
        'create_imp',
        'modify_imp',
        'remove_imp',
        'get_imp',
        'start_imp',
        'next_imp',
        'validate_op_imp',
        'forceSyncTaskExecution_imp',
        // Base iterator operations (without _imp suffix)
        'create',
        'modify',
        'remove',
        'start',
        'next',
      ]);

      // Use full text search for disambiguation when:
      // 1. We have a qualified symbol (Class::method)
      // 2. The base method name is common/ambiguous
      const needsFullTextDisambiguation =
        qualifiedPrefix && AMBIGUOUS_METHOD_NAMES.has(defSearchSymbol);

      // Skip reference search when maxCallers === 0 (callers not needed).
      // This avoids expensive global symbol searches for common names like
      // "create_imp" (5253 results) when we only need the definition + callees.
      const skipRefSearch = maxCallers === 0;

      const [defData, refData] = await Promise.all([
        makeOpenGrokRequest('search', {
          projects: project,
          def: defSearchSymbol,
          // Add full text filter to disambiguate common method names
          ...(needsFullTextDisambiguation ? { full: qualifiedPrefix } : {}),
          maxresults: qualifiedPrefix ? 20 : 10, // Fetch more if we need to filter
        }),
        skipRefSearch
          ? Promise.resolve({
              results: {},
              resultCount: 0,
            } as OpenGrokSearchResponse)
          : makeOpenGrokRequest('search', {
              projects: project,
              symbol: defSearchSymbol, // Also use base name for references
              maxresults: maxCallers * 2,
            }),
      ]);

      searchMs = performance.now() - searchStart;
      logTool.step('analyze_symbol_ast', 'search complete', {
        searchMs: Math.round(searchMs),
        defResults: Object.keys(defData.results || {}).length,
        refResults: Object.keys(refData.results || {}).length,
        ...(needsFullTextDisambiguation
          ? { disambiguation: qualifiedPrefix }
          : {}),
      });

      // Score and sort definition results
      // If we have a qualified prefix like "Keyserver", prefer results containing it
      const excludePathsLower = (EXCLUDE_PATHS ?? []).map((p) =>
        p.toLowerCase(),
      );
      const defResults = Object.entries(defData.results || {})
        .filter(([file]) => {
          const clean = file.replace(`/${project}/`, '/').toLowerCase();
          return !excludePathsLower.some((p) => clean.includes(p));
        })
        .map(([file, matches]) => {
          const cleanFile = file.replace(`/${project}/`, '/');
          let score = scoreResult(file, defSearchSymbol);

          // Boost score for results matching the qualified prefix
          if (qualifiedPrefix) {
            for (const match of matches) {
              const lineText = decodeHtmlEntities(match.line || '');
              if (lineText.includes(`${qualifiedPrefix}::`)) {
                score += 200; // Strong boost for matching class prefix
                break;
              }
            }
            // Modest boost if filename contains the class name
            const className = qualifiedPrefix.split('::').pop();
            if (
              className &&
              cleanFile.toLowerCase().includes(className.toLowerCase())
            ) {
              score += 50;
            }
          }

          return {
            file: cleanFile,
            matches,
            score,
          };
        })
        .sort((a, b) => b.score - a.score);

      let definitionFile: string | null = null;
      let definitionLine = 0;

      if (defResults.length > 0 && defResults[0].matches.length > 0) {
        definitionFile = defResults[0].file;

        // Find the best match within this file
        // Priority: match that contains the full qualified name > match with base method name
        let bestMatch = defResults[0].matches[0];
        if (qualifiedPrefix) {
          // Look for match containing "Class::method"
          const fullQualified = `${qualifiedPrefix}::${defSearchSymbol}`;
          const matchWithQualified = defResults[0].matches.find((m) => {
            const lineText = decodeHtmlEntities(m.line || '');
            return lineText.includes(fullQualified);
          });
          if (matchWithQualified) {
            bestMatch = matchWithQualified;
          } else {
            // Fall back to match containing just the base method name (not constructor)
            const matchWithMethod = defResults[0].matches.find((m) => {
              const lineText = decodeHtmlEntities(m.line || '');
              // Exclude constructor matches (Class::Class)
              const isConstructor = lineText.includes(
                `${qualifiedPrefix}::${qualifiedPrefix.split('::').pop()}`,
              );
              return !isConstructor && lineText.includes(defSearchSymbol);
            });
            if (matchWithMethod) {
              bestMatch = matchWithMethod;
            }
          }
        }

        definitionLine = parseInt(bestMatch.lineNumber, 10) || 0;
        const lineText = decodeHtmlEntities(bestMatch.line || '');

        definition = {
          file: definitionFile,
          line: definitionLine,
          kind: inferKind(lineText),
          signature: lineText.trim(),
        };
      }

      // ========================================
      // Step 1.5: "Did You Mean?" fallback when nothing found
      // If no definition AND no references, try semantic search
      // ========================================
      const hasNoResults =
        !definition && Object.keys(refData.results || {}).length === 0;
      let didYouMean: SymbolSuggestion[] | undefined;

      if (hasNoResults && suggestOnEmpty && process.env.CLAUDE_CONTEXT_URL) {
        logTool.step(
          'analyze_symbol_ast',
          'no results — trying semantic fallback',
          { symbol },
        );

        const suggestions = await getSymbolSuggestions(symbol, {
          timeoutMs: 5000,
          limit: 5,
          minScore: 0.3,
        });

        if (suggestions.length > 0) {
          didYouMean = suggestions;

          logTool.step(
            'analyze_symbol_ast',
            'semantic fallback found suggestions',
            {
              symbol,
              count: suggestions.length,
              topMatch: suggestions[0].symbol,
              topScore: suggestions[0].score.toFixed(3),
            },
          );

          const totalMs = performance.now() - startTime;
          logTool.end(invocationId, {
            success: true,
            didYouMean: suggestions.length,
            totalMs: Math.round(totalMs),
          });

          return {
            success: true,
            symbol,
            definition: undefined,
            allReferences: undefined,
            callers: [],
            testCallers: undefined,
            callees: [],
            didYouMean: suggestions.map((s) => ({
              symbol: s.symbol,
              score: Math.round(s.score * 1000) / 1000,
              source: s.source,
              language: s.language,
            })),
            timing: verbose
              ? {
                  totalMs: Math.round(totalMs),
                  searchMs: Math.round(searchMs),
                  fetchMs: 0,
                  astMs: 0,
                  calleeCount: 0,
                  callerCount: 0,
                  referenceCount: 0,
                }
              : undefined,
          };
        }
      }

      // ========================================
      // Step 2: Collect unique files to fetch
      // ========================================
      const filesToFetch = new Set<string>();

      // Add definition file
      if (definitionFile && includeSource) {
        filesToFetch.add(definitionFile);
      }

      // Add reference files (only C/C++ source files for function detection)
      for (const [file] of Object.entries(refData.results || {})) {
        const cleanFile = file.replace(`/${project}/`, '/');
        // Skip excluded paths (third_party, bedrock, etc.)
        if (excludePathsLower.some((p) => cleanFile.toLowerCase().includes(p)))
          continue;
        // Only fetch source files where we need function context
        if (cleanFile.match(/\.(cc|cpp|cxx|c|h|hpp)$/)) {
          filesToFetch.add(cleanFile);
        }
      }

      // ========================================
      // Step 3: PARALLEL - Batch fetch all files at once
      // Saves ~1000ms+ by fetching N files in parallel instead of sequentially
      // ========================================
      const fetchStart = performance.now();

      const fetchPromises = Array.from(filesToFetch).map(async (file) => {
        try {
          const content = await getFileContent(file, project);
          return { file, content };
        } catch {
          return { file, content: null };
        }
      });

      const fetchResults = await Promise.all(fetchPromises);
      fetchMs = performance.now() - fetchStart;
      logTool.step('analyze_symbol_ast', 'files fetched', {
        fetchMs: Math.round(fetchMs),
        filesRequested: filesToFetch.size,
        filesLoaded: fetchResults.filter((r) => r.content).length,
      });

      // Populate cache
      for (const { file, content } of fetchResults) {
        if (content) {
          fileCache.set(file, content);
        }
      }

      // ========================================
      // Step 4: Extract callees from definition file (AST - FAST!)
      // ========================================
      if (definitionFile && includeSource) {
        const fileContent = fileCache.get(definitionFile);

        if (fileContent) {
          // Extract source snippet
          const lines = fileContent.split('\n');
          const startLine = Math.max(0, definitionLine - 1);
          const endLine = Math.min(lines.length, startLine + contextLines);
          const snippet = lines.slice(startLine, endLine).join('\n');

          if (definition) {
            definition.source = snippet;
          }

          // ✨ AST-based call extraction (THE FAST PART!)
          const astStart = performance.now();
          const extractionResult = extractCallsWithTiming(
            fileContent,
            symbol,
            definitionFile,
          );
          astMs = performance.now() - astStart;
          logTool.step('analyze_symbol_ast', 'AST extraction', {
            astMs: Math.round(astMs * 100) / 100,
            callsFound: extractionResult.calls.length,
            success: extractionResult.success,
          });

          if (extractionResult.success) {
            // Phase 2: Smart filtering - categorize each callee
            const categorized = extractionResult.calls.map(categorizeCallee);
            const keptCallees = categorized
              .filter((c) => c.keep)
              .map((c) => c.callee);
            const filteredCalleeNames = categorized
              .filter((c) => !c.keep)
              .map(
                (c) =>
                  `${c.callee.callee}${c.callee.receiverType ? ` [${c.callee.receiverType}]` : ''}`,
              );

            callees.push(...keptCallees.slice(0, maxCallees));
            filteredCallees = filteredCalleeNames; // Store for return

            logTool.step('analyze_symbol_ast', 'Callee filtering', {
              total: extractionResult.calls.length,
              kept: keptCallees.length,
              filtered: filteredCalleeNames.length,
              filteredNames: filteredCalleeNames.slice(0, 5), // Log first 5
            });

            // Update definition with accurate bounds
            if (extractionResult.functionBounds && definition) {
              definition.endLine = extractionResult.functionBounds.endLine;
            }
          }

          // ========================================
          // Step 4b: SMF Enrichment - fetch schema for iterator types
          // ========================================
          const smfStart = performance.now();

          // Collect unique iterator types from callees
          const iteratorTypes = new Set<string>();
          for (const call of callees) {
            if (call.receiverType?.endsWith('_iterator')) {
              iteratorTypes.add(call.receiverType);
            }
          }

          if (iteratorTypes.size > 0) {
            // Fetch SMF schemas in parallel
            const smfPromises = Array.from(iteratorTypes).map(
              async (iteratorType) => {
                const smfResult = await fetchSmfForIterator(
                  iteratorType,
                  project,
                );
                return { iteratorType, smfResult };
              },
            );

            const smfResults = await Promise.all(smfPromises);

            // Build a map for quick lookup
            const smfMap = new Map<string, SmfLookupResult>();
            for (const { iteratorType, smfResult } of smfResults) {
              if (smfResult.success && smfResult.fields) {
                smfMap.set(iteratorType, smfResult);
                smfSchemas.push({
                  iterator: iteratorType,
                  tableName: smfResult.tableName,
                  smfFile: smfResult.smfFile,
                  fieldCount: smfResult.fields.length,
                  // Include custom types (enum definitions) if present
                  customTypes: smfResult.customTypes,
                });
              }
            }

            // Enrich callees with SMF field info
            for (const call of callees) {
              if (call.receiverType && smfMap.has(call.receiverType)) {
                const smfResult = smfMap.get(call.receiverType)!;
                const field = matchCalleeToSmfField(
                  call.callee,
                  smfResult.fields!,
                );
                if (field) {
                  call.smfField = {
                    name: field.name,
                    type: field.type,
                    role:
                      field.role === 'key' ||
                      field.role === 'read' ||
                      field.role === 'write'
                        ? field.role
                        : field.role.startsWith('key')
                          ? 'key'
                          : 'unknown',
                    description: field.description,
                  };
                }
              }
            }

            logTool.step('analyze_symbol_ast', 'SMF enrichment', {
              iteratorTypes: iteratorTypes.size,
              schemasFound: smfSchemas.length,
              enrichedCallees: callees.filter((c) => c.smfField).length,
            });
          }

          smfMs = performance.now() - smfStart;
        }
      }

      // ========================================
      // Step 5: Process references and find callers
      // ========================================
      const seenCallers = new Set<string>();

      for (const [file, matches] of Object.entries(refData.results || {})) {
        const cleanFile = file.replace(`/${project}/`, '/');
        // Skip excluded paths (third_party, bedrock, etc.)
        if (excludePathsLower.some((p) => cleanFile.toLowerCase().includes(p)))
          continue;
        const fileContent = fileCache.get(cleanFile) || '';

        for (const match of matches) {
          const line = parseInt(match.lineNumber, 10) || undefined;
          const context = decodeHtmlEntities(match.line || '').trim();

          // Classify the reference type
          // Extract base name for matching (e.g., "create_imp" from "ClassName::create_imp")
          const symbolBaseForRef = symbol.includes('::')
            ? symbol.split('::').pop()!
            : symbol;
          let refType:
            | 'call'
            | 'declaration'
            | 'comment'
            | 'test'
            | 'mock'
            | 'other' = 'other';
          if (
            cleanFile.includes('/test/') ||
            cleanFile.includes('_test.') ||
            cleanFile.includes('test_')
          ) {
            refType = 'test';
          } else if (
            cleanFile.includes('mock') ||
            context.toLowerCase().includes('mock')
          ) {
            refType = 'mock';
          } else if (
            context.startsWith('//') ||
            context.startsWith('/*') ||
            context.startsWith('*')
          ) {
            refType = 'comment';
          } else if (
            context.includes(`${symbol}(`) ||
            context.includes(`${symbol} (`)
          ) {
            refType = 'call';
          } else if (
            context.includes(`${symbol}::`) ||
            context.includes(`${symbol};`) ||
            context.includes(`::${symbol}`) ||
            context.match(new RegExp(`\\b${symbol}\\s*\\(`))
          ) {
            refType = 'declaration';
          } else if (cleanFile.endsWith('.h') || cleanFile.endsWith('.hpp')) {
            // Header files typically contain declarations, not calls
            // Check for declaration patterns: "type funcName(...)" or "funcName() override"
            if (
              context.includes('override') ||
              context.includes('virtual') ||
              context.match(
                new RegExp(`\\b${symbolBaseForRef}\\s*\\([^)]*\\)\\s*;`),
              ) ||
              context.match(
                new RegExp(`\\b${symbolBaseForRef}\\s*\\([^)]*\\)\\s*override`),
              )
            ) {
              refType = 'declaration';
            }
          }

          // Add to allReferences (all mentions)
          allReferences.push({
            file: cleanFile,
            line,
            context,
            type: refType,
          });

          // Skip definition itself for caller detection
          if (
            cleanFile === definitionFile &&
            line != null &&
            Math.abs(line - definitionLine) < 3
          ) {
            continue;
          }

          // Skip references where the context doesn't actually contain the symbol
          // OpenGrok sometimes returns matches based on the class name, not the method
          const symbolBaseName = symbol.includes('::')
            ? symbol.split('::').pop()!
            : symbol;
          if (!context.includes(symbolBaseName)) {
            continue; // Context doesn't mention the symbol at all
          }

          // Skip declarations (function signatures, not calls)
          // These show up as "ClassName::methodName" without a call pattern
          if (refType === 'declaration') {
            continue;
          }

          // Find containing function
          let containingFunc: FunctionLocation | undefined;
          if (fileContent && line != null) {
            containingFunc = findContainingFunction(fileContent, line);
          }

          // Skip self-references: when the containing function IS the symbol being searched
          // e.g., searching for `create_imp` shouldn't show `create_imp` as a caller of itself
          if (containingFunc) {
            const funcBaseName = containingFunc.name;
            const funcQualified = containingFunc.qualifiedName || '';
            if (
              funcBaseName === symbolBaseName ||
              funcQualified.endsWith(`::${symbolBaseName}`)
            ) {
              continue; // Skip - this is the function itself, not a caller
            }
          }

          // Dedupe by function
          const funcKey = containingFunc
            ? `${cleanFile}:${containingFunc.qualifiedName || containingFunc.name}`
            : `${cleanFile}:${line}`;

          if (seenCallers.has(funcKey)) continue;
          seenCallers.add(funcKey);

          const callerInfo: CallerInfo = {
            file: cleanFile,
            line,
            function: containingFunc?.name,
            qualifiedFunction: containingFunc?.qualifiedName,
            context,
          };

          // Separate test callers from production callers
          const isTestFile =
            cleanFile.endsWith('.ut') ||
            cleanFile.includes('/test/') ||
            cleanFile.includes('_test.') ||
            cleanFile.includes('.test.');

          if (isTestFile) {
            testCallers.push(callerInfo);
          } else {
            callers.push(callerInfo);
            if (callers.length >= maxCallers) break;
          }
        }
        if (callers.length >= maxCallers) break;
      }

      logTool.step('analyze_symbol_ast', 'callers processed', {
        callers: callers.length,
        testCallers: testCallers.length,
        references: allReferences.length,
      });

      const totalMs = performance.now() - startTime;

      // Log tool end
      logTool.end(invocationId, {
        success: true,
        callers: callers.length,
        callees: callees.length,
        totalMs: Math.round(totalMs),
      });

      return {
        success: true,
        symbol,
        definition,
        // Only include allReferences when verbose=true (saves ~2KB per call)
        allReferences: verbose ? allReferences : undefined,
        callers: callers.slice(0, maxCallers).map((c) => ({
          file: c.file,
          line: c.line,
          function: c.function,
          qualifiedFunction: c.qualifiedFunction,
          // Context is useful - shows HOW the function is called
          context: c.context,
        })),
        // Test callers separated (*.ut, /test/, _test.)
        testCallers:
          includeTests && testCallers.length > 0
            ? testCallers.slice(0, maxTestCallers).map((c) => ({
                file: c.file,
                line: c.line,
                function: c.function,
                qualifiedFunction: c.qualifiedFunction,
                context: c.context,
              }))
            : undefined,
        callees: callees.map((c) => ({
          callee: c.callee,
          receiver: c.receiver,
          receiverType: c.receiverType,
          line: c.line,
          callType: c.callType,
          arguments: c.arguments,
          smfField: c.smfField,
        })),
        // filteredCallees only when verbose (debug info)
        filteredCallees:
          verbose && filteredCallees.length > 0 ? filteredCallees : undefined,
        // smfSchemas always included (useful context about which tables)
        smfSchemas: smfSchemas.length > 0 ? smfSchemas : undefined,
        // timing only when verbose (debug info)
        timing: verbose
          ? {
              totalMs: Math.round(totalMs),
              searchMs: Math.round(searchMs),
              fetchMs: Math.round(fetchMs),
              astMs: Math.round(astMs * 100) / 100,
              smfMs: smfMs > 0 ? Math.round(smfMs) : undefined,
              calleeCount: callees.length,
              callerCount: callers.length,
              referenceCount: allReferences.length,
            }
          : undefined,
      };
    } catch (error) {
      const classified = classifyError(error);

      // Log tool end with error
      logTool.end(invocationId, {
        success: false,
        error: classified.message,
        errorType: classified.errorType,
      });

      return {
        success: false,
        symbol,
        error: classified.message,
        errorType: classified.errorType,
        retryable: classified.retryable,
        allReferences: undefined,
        callers: [],
        callees: [],
        timing: {
          totalMs: Math.round(performance.now() - startTime),
          searchMs: Math.round(searchMs),
          fetchMs: Math.round(fetchMs),
          astMs: 0,
          calleeCount: 0,
          callerCount: 0,
          referenceCount: 0,
        },
      };
    }
  },
});
