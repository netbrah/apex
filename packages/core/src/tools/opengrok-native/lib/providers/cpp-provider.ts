/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/* eslint-disable */
/**
 * C++ Language Provider
 *
 * Ultra-fast AST parsing for C++ code using native tree-sitter bindings.
 * Performance: ~0.5ms per file (vs ~4ms for regex-based parsing)
 *
 * This provider is extracted from the original TreeSitterNativeProvider
 * and refactored to implement the LanguageProvider interface, enabling
 * modular language support across the codebase.
 *
 * NOTE: Tree-sitter native bindings may not be available on all platforms
 * (e.g., linux/arm64 in Docker). The provider gracefully falls back to
 * regex-based extraction when native bindings aren't available.
 */

import type {
  LanguageProvider,
  NativeCallInfo,
  NativeFunctionBounds,
  NativeExtractionResult,
} from '../language-provider.js';
import { loadTreeSitterParser } from '../parser-loader.js';
import { CALL_SKIP_LIST } from '../../prompts/index.js';

// ============================================================================
// Skip Lists (aligned with prompts.ts CALL_SKIP_LIST)
// ============================================================================

const NATIVE_SKIP_PATTERNS: RegExp[] = [
  /^std::/,
  /^boost::/,
  /^__/,
  /^trace[A-Z]/,
  /^TLOG_/,
  /^MCC_LOG/,
  /^MCC_TRACE/,
  /^EMS_/,
  /^traceEntry$/,
  /^traceExit$/,
  /^traceExitRet$/,
  /^traceLog$/,
  /^traceDebug$/,
  /^traceError$/,
  /^traceWarning$/,
  /^ON_SCOPE_EXIT$/,
  /^ScopeExit$/,
];

const NATIVE_SKIP_KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'return',
  'case',
  'catch',
  'throw',
  'new',
  'delete',
  'sizeof',
  'alignof',
  'typeof',
  'decltype',
  'auto',
  'str',
  'itr',
  'nullptr',
  'true',
  'false',
]);

/**
 * Methods that should NEVER be skipped when the receiver is an iterator type.
 * These are fundamental SMDB iterator operations (SMF 4.3).
 */
const ITERATOR_ESSENTIAL_METHODS = new Set([
  // Core iterator operations (4.3)
  'get', // Fetch single row
  'create', // Insert row (or execute action)
  'modify', // Update row
  'remove', // Delete row
  'start', // Begin iteration
  'next', // Get next row
  'nextseq', // Next with sequence
  'removeAllRows', // Bulk delete
  // Error handling (4.3)
  'getError',
  'getErrorText',
  'translateError',
  // Bulk field operations (4.2)
  'clearQuery',
  'copyQuery',
  'validForQuery',
  'clearAllKeys',
  'clearAllValues',
  'clearAllFields',
  'wantAllValues',
  'needsAllValues',
  'ignoreAllValues',
  'honorWantValues',
  // Field copying (4.3)
  'copyKeyFields',
  'cmpKeyFields',
  'copySameNamedFields',
  'wantSameNamedValues',
  'querySameNamedFields',
]);

/**
 * Prefixes for iterator field access methods that should never be skipped.
 * These methods are named: prefix_fieldname (e.g., set_vserver, query_uuid)
 * Based on SMF 4.2 Field Access Methods.
 */
const ITERATOR_FIELD_PREFIXES = [
  // Get/Set (4.2)
  'set_',
  'get_',
  'have_',
  'clear_',
  // Query (4.2)
  'query_',
  'addQuery_',
  'haveQuery_',
  // Defaults/Want/Ignore (4.2)
  'want_',
  'needs_',
  'ignore_',
  'set_default_',
  // Validation (4.2)
  'invalid_',
  // String/Bytes (4.2)
  'toString_',
  'fromString_',
];

function shouldSkipNativeCall(name: string, receiverType?: string): boolean {
  // For iterator types, NEVER skip essential operations or field access methods
  if (receiverType && receiverType.includes('_iterator')) {
    // Exact match for operations like get, create, modify, remove, start, next
    if (ITERATOR_ESSENTIAL_METHODS.has(name)) {
      return false; // Keep these calls!
    }
    // Prefix match for field access: set_*, get_*, query_*, want_*
    if (ITERATOR_FIELD_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      return false; // Keep field access methods!
    }
  }

  // Check patterns
  if (NATIVE_SKIP_PATTERNS.some((p) => p.test(name))) return true;

  // Check keywords
  if (NATIVE_SKIP_KEYWORDS.has(name)) return true;

  // Check CALL_SKIP_LIST from prompts
  if (CALL_SKIP_LIST.has(name)) return true;

  // Skip very short names
  if (name.length <= 2) return true;

  // Skip underscore prefix (private/internal)
  if (name.startsWith('_') && !name.startsWith('__')) return true;

  return false;
}

// ============================================================================
// C++ Provider Implementation
// ============================================================================

// Tree-sitter has a ~32KB buffer limit in Node.js bindings for certain operations
// However, parsing entire files works fine - the limit is for incremental operations
const TREE_SITTER_MAX_CHARS = 500000; // Stay under 32KB for function slice extraction

// File size threshold for using tree-sitter queries
// Tree-sitter's JS bindings have a 32KB limit for direct string input,
// but we can use callback-based input for larger files (up to ~500KB safely)
const MAX_FILE_SIZE_FOR_QUERIES = 5000000; // 5000KB max

// Threshold to switch from direct string to callback-based parsing
// Direct string parsing has 32KB limit, callback-based has no practical limit
const CALLBACK_PARSING_THRESHOLD = 32000; // Use callback for files > 32KB

// Function detection limits (for regex fallback)
const MAX_LINES_TO_OPENING_BRACE = 10; // Lines to search for opening brace after function signature
const MAX_FUNCTION_BODY_LINES = 500; // Maximum lines for a function body (for brace matching)
const MAX_FUNCTION_SEARCH_LINES = 1000; // Maximum lines to search for function end

// ============================================================================
// Tree-sitter Query Definitions
// ============================================================================

/**
 * Tree-sitter query for finding C++ function definitions
 *
 * Captures:
 * - @function: the entire function_definition node
 * - @name: the function/method name identifier
 * - @class: the class name for method definitions (optional)
 * - @dtor: destructor_name node (for ~ClassName)
 */
const CPP_FUNCTION_QUERY = `
; Method definitions: ClassName::methodName(...)
(function_definition
  declarator: (function_declarator
    declarator: (qualified_identifier
      scope: (namespace_identifier) @class
      name: (identifier) @name))) @function

; Free function definitions with simple identifier
(function_definition
  declarator: (function_declarator
    declarator: (identifier) @name)) @function

; Destructor definitions: ~ClassName() - capture the whole destructor_name
(function_definition
  declarator: (function_declarator
    declarator: (destructor_name) @dtor)) @function

; Constructor definitions (no return type, class name as function name)
(function_definition
  declarator: (function_declarator
    declarator: (qualified_identifier
      scope: (namespace_identifier) @class
      name: (identifier) @name))
  !type) @constructor
`;

// Cache size limits
const PARSE_TREE_CACHE_SIZE = 30; // Max cached parse trees
const LIST_FUNCTIONS_CACHE_SIZE = 30; // Max cached function lists

export class CppProvider implements LanguageProvider {
  private parser: any = null;
  private language: any = null; // Language grammar for query compilation
  private parserClass: any = null; // Parser class for Query constructor
  private initialized = false;
  private available = false;
  private query: any = null; // Cached query for function detection

  // LRU caches for performance
  private parseTreeCache = new Map<string, any>(); // code hash -> parse tree
  private listFunctionsCache = new Map<string, NativeFunctionBounds[]>(); // code hash -> function list

  constructor() {
    // Attempt to load the C++ parser
    const result = loadTreeSitterParser('cpp');
    if (result) {
      this.parser = result.parser;
      this.language = result.language;
      this.available = true;

      // Pre-compile the function query for reuse
      // Native tree-sitter uses: new Parser.Query(language, queryString)
      try {
        // Get the Parser class from the parser instance's constructor
        this.parserClass = this.parser.constructor;
        if (this.parserClass.Query) {
          this.query = new this.parserClass.Query(
            this.language,
            CPP_FUNCTION_QUERY,
          );
        } else {
          console.warn(
            '[CppProvider] Parser.Query not available, using regex fallback',
          );
        }
      } catch (e) {
        // Query compilation failed - will fall back to regex
        console.warn(
          '[CppProvider] Failed to compile tree-sitter query, using regex fallback:',
          e,
        );
        this.query = null;
      }
    }
  }

  /**
   * Get the language identifier for this provider
   */
  getLanguage(): string {
    return 'cpp';
  }

  /**
   * Check if native tree-sitter is available
   */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Extract all function calls from a specific function in the code.
   *
   * This is the KEY operation - 0.5ms vs 4ms regex!
   *
   * Note: Due to tree-sitter buffer limits, we extract just the function
   * body and parse that separately.
   *
   * Falls back to regex extraction if native bindings aren't available.
   */
  extractCallsFromFunction(
    code: string,
    functionName: string,
    maxCalls: number = 100,
  ): NativeExtractionResult {
    const startTime = performance.now();

    // If tree-sitter isn't available, use regex fallback
    if (!this.isAvailable()) {
      return this.extractCallsWithRegex(code, functionName, maxCalls);
    }

    try {
      // First, find the function boundaries using regex (fast)
      const parseStart = performance.now();
      const funcSlice = this.extractFunctionSlice(code, functionName);
      const parseMs = performance.now() - parseStart;

      if (!funcSlice) {
        return {
          success: false,
          calls: [],
          timing: {
            parseMs,
            extractMs: 0,
            totalMs: performance.now() - startTime,
          },
          error: `Function not found: ${functionName}`,
        };
      }

      // Parse just the function slice (stays under 32KB limit)
      const extractStart = performance.now();
      const tree = this.parser.parse(funcSlice.code);

      // Build variable type map for receiver type resolution
      const varTypeMap = this.buildVariableTypeMap(tree.rootNode);

      // Extract all calls
      const calls: NativeCallInfo[] = [];
      const seen = new Set<string>();

      this.walkTree(tree.rootNode, (node) => {
        if (node.type === 'call_expression' && calls.length < maxCalls) {
          const callInfo = this.extractCallInfo(
            node,
            funcSlice.lineOffset,
            varTypeMap,
          );
          if (callInfo) {
            const key = `${callInfo.callee}:${callInfo.line}`;
            if (
              !seen.has(key) &&
              !shouldSkipNativeCall(callInfo.callee, callInfo.receiverType)
            ) {
              seen.add(key);
              calls.push(callInfo);
            }
          }
        }
      });

      const extractMs = performance.now() - extractStart;

      return {
        success: true,
        calls,
        functionBounds: {
          name: functionName,
          qualifiedName: funcSlice.qualifiedName,
          startLine: funcSlice.startLine,
          endLine: funcSlice.endLine,
        },
        timing: {
          parseMs,
          extractMs,
          totalMs: performance.now() - startTime,
        },
      };
    } catch (error) {
      return {
        success: false,
        calls: [],
        timing: {
          parseMs: 0,
          extractMs: 0,
          totalMs: performance.now() - startTime,
        },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Extract just the function body for parsing (to stay under 32KB limit)
   */
  private extractFunctionSlice(
    code: string,
    functionName: string,
  ): {
    code: string;
    startLine: number;
    endLine: number;
    lineOffset: number;
    qualifiedName?: string;
  } | null {
    const lines = code.split('\n');

    // Handle qualified names like "Keyserver::pushKeyToKmipServerForced"
    // If given a qualified name, use it directly; otherwise, allow any class prefix
    const hasQualifier = functionName.includes('::');
    const baseName = hasQualifier
      ? functionName.split('::').pop()!
      : functionName;
    const expectedQualifier = hasQualifier
      ? functionName.slice(0, functionName.lastIndexOf('::'))
      : null;

    // Find function definition
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip comments
      if (
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*')
      ) {
        continue;
      }

      // Look for Class::baseName( or baseName(
      // Escape special regex chars in base name
      const escapedBaseName = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const methodMatch = line.match(
        new RegExp(`(\\w+)::${escapedBaseName}\\s*\\(`),
      );
      const freeMatch =
        !methodMatch &&
        line.match(new RegExp(`\\b${escapedBaseName}\\s*\\([^;]*$`));

      // If we have an expected qualifier (e.g., "Keyserver"), only match if it matches
      if (
        methodMatch &&
        expectedQualifier &&
        methodMatch[1] !== expectedQualifier
      ) {
        continue; // Skip - wrong class
      }

      if (methodMatch || freeMatch) {
        // Skip function CALLS (lines with `= ClassName::func(` or `return ClassName::func(`)
        // Function definitions don't have = or return directly before the class::method pattern
        const beforeMatch = methodMatch
          ? line.slice(0, line.indexOf(methodMatch[0]))
          : line.slice(
              0,
              line.match(new RegExp(`\\b${escapedBaseName}\\s*\\(`))?.index ||
                0,
            );

        // If there's an = or return on the same line before the function name, it's a call, not definition
        if (
          beforeMatch.includes('=') ||
          beforeMatch.trim().endsWith('return')
        ) {
          continue; // Skip - this is a function call, not definition
        }

        // Find the opening brace
        let braceIdx = i;
        let foundOpen = false;

        while (
          braceIdx < lines.length &&
          braceIdx < i + MAX_LINES_TO_OPENING_BRACE
        ) {
          if (lines[braceIdx].includes('{')) {
            foundOpen = true;
            break;
          }
          braceIdx++;
        }

        if (!foundOpen) continue;

        // Find matching closing brace
        let braceCount = 0;
        let endLine = braceIdx;

        for (
          let j = braceIdx;
          j < lines.length && j < braceIdx + MAX_FUNCTION_BODY_LINES;
          j++
        ) {
          for (const char of lines[j]) {
            if (char === '{') braceCount++;
            if (char === '}') braceCount--;
          }
          if (braceCount === 0) {
            endLine = j;
            break;
          }
        }

        if (endLine <= braceIdx) continue;

        // Extract function code
        const funcCode = lines.slice(i, endLine + 1).join('\n');

        // Check if it's too long - if so, just return the found bounds without parsing
        if (funcCode.length > TREE_SITTER_MAX_CHARS) {
          // Return null to fall back to regex extraction
          return null;
        }

        return {
          code: funcCode,
          startLine: i + 1,
          endLine: endLine + 1,
          lineOffset: i, // To adjust line numbers in calls
          qualifiedName: methodMatch
            ? `${methodMatch[1]}::${baseName}`
            : undefined,
        };
      }
    }

    return null;
  }

  /**
   * List all functions in a file (for caller detection)
   *
   * Uses tree-sitter queries for accurate AST-based detection.
   * Falls back to regex for:
   * - Platforms without tree-sitter bindings
   * - Very large files (>500KB)
   * - Query compilation failures
   */
  listFunctions(code: string): NativeFunctionBounds[] {
    // Check listFunctions cache first
    const cacheKey = this.hashCode(code);
    if (this.listFunctionsCache.has(cacheKey)) {
      CppProvider.stats.listFunctionsCacheHits++;
      return this.listFunctionsCache.get(cacheKey)!;
    }
    CppProvider.stats.listFunctionsCacheMisses++;

    let result: NativeFunctionBounds[];

    // Try tree-sitter first if available
    if (
      this.isAvailable() &&
      this.query &&
      code.length < MAX_FILE_SIZE_FOR_QUERIES
    ) {
      // listFunctionsWithTreeSitter handles its own stats tracking
      const treeSitterResult = this.listFunctionsWithTreeSitter(code);
      if (treeSitterResult.length > 0) {
        result = treeSitterResult;
      } else {
        // If tree-sitter found nothing or failed, try regex as backup
        CppProvider.stats.regexFallback++;
        result = this.listFunctionsRegex(code);
      }
    } else {
      // Fall back to regex-based detection
      CppProvider.stats.regexFallback++;
      result = this.listFunctionsRegex(code);
    }

    // LRU eviction and cache storage
    if (this.listFunctionsCache.size >= LIST_FUNCTIONS_CACHE_SIZE) {
      const firstKey = this.listFunctionsCache.keys().next().value;
      if (firstKey) this.listFunctionsCache.delete(firstKey);
    }
    this.listFunctionsCache.set(cacheKey, result);

    return result;
  }

  /**
   * Stats tracking for tree-sitter vs regex usage
   */
  static stats = {
    treeSitterSuccess: 0,
    treeSitterEmpty: 0,
    treeSitterFailed: 0,
    regexFallback: 0,
    parseTreeCacheHits: 0,
    parseTreeCacheMisses: 0,
    listFunctionsCacheHits: 0,
    listFunctionsCacheMisses: 0,
  };

  /**
   * Get and optionally reset stats
   */
  static getStats(reset = false): typeof CppProvider.stats {
    const result = { ...CppProvider.stats };
    if (reset) {
      CppProvider.stats.treeSitterSuccess = 0;
      CppProvider.stats.treeSitterEmpty = 0;
      CppProvider.stats.treeSitterFailed = 0;
      CppProvider.stats.regexFallback = 0;
      CppProvider.stats.parseTreeCacheHits = 0;
      CppProvider.stats.parseTreeCacheMisses = 0;
      CppProvider.stats.listFunctionsCacheHits = 0;
      CppProvider.stats.listFunctionsCacheMisses = 0;
    }
    return result;
  }

  /**
   * Clear caches (call between test runs or when memory is a concern)
   */
  clearCaches(): void {
    this.parseTreeCache.clear();
    this.listFunctionsCache.clear();
  }

  /**
   * Simple hash for cache keys (fast, not cryptographic)
   */
  private hashCode(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36) + '_' + str.length;
  }

  /**
   * Get a cached parse tree or parse and cache the code
   * Returns null if parsing fails or code has problematic characters
   */
  private getCachedParseTree(code: string): any | null {
    if (!this.isAvailable()) return null;

    const sanitized = this.sanitizeCodeForParsing(code);
    if (!sanitized) return null;

    const cacheKey = this.hashCode(sanitized);

    // Check cache
    if (this.parseTreeCache.has(cacheKey)) {
      CppProvider.stats.parseTreeCacheHits++;
      return this.parseTreeCache.get(cacheKey);
    }

    CppProvider.stats.parseTreeCacheMisses++;

    // Parse the code
    let tree;
    try {
      if (sanitized.length > CALLBACK_PARSING_THRESHOLD) {
        tree = this.parser.parse((index: number) => {
          if (index >= sanitized.length) return null;
          return sanitized.slice(index, index + 10240);
        });
      } else {
        tree = this.parser.parse(sanitized);
      }
    } catch {
      return null;
    }

    // LRU eviction: remove oldest entry if cache is full
    if (this.parseTreeCache.size >= PARSE_TREE_CACHE_SIZE) {
      const firstKey = this.parseTreeCache.keys().next().value;
      if (firstKey) this.parseTreeCache.delete(firstKey);
    }

    this.parseTreeCache.set(cacheKey, tree);
    return tree;
  }

  /**
   * Sanitize code string for tree-sitter parsing
   * Removes null chars and ensures valid UTF-8
   */
  private sanitizeCodeForParsing(code: string): string | null {
    // Quick check - if code has null chars or control chars, skip tree-sitter
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(code)) {
      return null; // Use regex fallback instead
    }
    return code;
  }

  /**
   * List functions using tree-sitter AST queries (fast and accurate)
   */
  private listFunctionsWithTreeSitter(code: string): NativeFunctionBounds[] {
    const tree = this.getCachedParseTree(code);
    if (!tree) {
      // Input had control characters or parsing failed
      CppProvider.stats.treeSitterFailed++;
      return []; // Will trigger regex fallback (stats tracked by caller)
    }

    const functions: NativeFunctionBounds[] = [];
    const seen = new Set<string>(); // Dedupe by "name:startLine"

    const matches = this.query.matches(tree.rootNode);

    for (const match of matches) {
      const funcNode = match.captures.find(
        (c: any) => c.name === 'function' || c.name === 'constructor',
      )?.node;
      const nameNode = match.captures.find((c: any) => c.name === 'name')?.node;
      const classNode = match.captures.find(
        (c: any) => c.name === 'class',
      )?.node;
      const dtorNode = match.captures.find((c: any) => c.name === 'dtor')?.node;

      if (!funcNode) continue;

      // Handle destructor specially - use the whole destructor_name text (e.g., "~KeyManager")
      // Otherwise use the name node
      if (!nameNode && !dtorNode) continue;

      const name = dtorNode ? dtorNode.text : nameNode.text;
      const startLine = funcNode.startPosition.row + 1;
      const endLine = funcNode.endPosition.row + 1;

      // Skip common non-function patterns (but not destructors)
      if (!dtorNode && shouldSkipNativeCall(name)) continue;

      // Build qualified name for methods
      const qualifiedName = classNode
        ? `${classNode.text}::${name}`
        : undefined;

      // Dedupe
      const key = `${qualifiedName || name}:${startLine}`;
      if (seen.has(key)) continue;
      seen.add(key);

      functions.push({
        name,
        qualifiedName,
        startLine,
        endLine,
      });
    }

    // Track success (found at least one function via tree-sitter)
    if (functions.length > 0) {
      CppProvider.stats.treeSitterSuccess++;
    } else {
      CppProvider.stats.treeSitterEmpty++;
    }

    return functions;
  }

  /**
   * List functions using regex patterns (fallback)
   * Note: Less accurate but works on all platforms
   */
  private listFunctionsRegex(code: string): NativeFunctionBounds[] {
    const functions: NativeFunctionBounds[] = [];
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip comments
      if (
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*')
      ) {
        continue;
      }

      // Method definition: ClassName::methodName(
      const methodMatch = line.match(/(\w+)::(\w+)\s*\(/);
      if (methodMatch && !trimmed.endsWith(';')) {
        const className = methodMatch[1];
        const methodName = methodMatch[2];

        // Skip common non-function patterns
        if (
          ['smdb_enum', 'smdb_type', 'std', 'smf', 'smdb', 'boost'].includes(
            className,
          )
        ) {
          continue;
        }

        // Check if this is likely a function call, not a definition
        // A call has = or ( before the Class::method pattern on same line
        const beforeMatch = line.substring(0, line.indexOf(methodMatch[0]));
        if (
          beforeMatch.includes('=') ||
          beforeMatch.includes('(') ||
          beforeMatch.includes('return ')
        ) {
          continue;
        }

        // Also check for multi-line assignments: = on previous line
        const prevLine = i > 0 ? lines[i - 1].trim() : '';
        if (prevLine.endsWith('=') || prevLine.includes('= ')) {
          continue;
        }

        // CRITICAL: Check for multi-line if/while conditions
        // Pattern: "ClassName::method(args)) {" at end of a conditional
        // This is NOT a function definition - it's the end of a multi-line condition
        if (trimmed.endsWith(')) {') || trimmed.match(/\)\s*\)\s*\{$/)) {
          // Also verify by checking previous lines for unclosed control flow
          let isMultiLineCondition = false;
          for (let k = i - 1; k >= 0 && k >= i - 10; k--) {
            const previousLine = lines[k].trim();
            if (
              previousLine.match(/^\s*(if|while|for|switch)\s*\(/) &&
              !previousLine.includes('{')
            ) {
              isMultiLineCondition = true;
              break;
            }
            if (
              previousLine.includes('{') ||
              previousLine.endsWith('}') ||
              previousLine.endsWith(';')
            ) {
              break; // Hit end of previous statement, this isn't a continuation
            }
          }
          if (isMultiLineCondition) {
            continue;
          }
        }

        // Also skip if this line ends with && or || (part of multi-line condition)
        if (
          trimmed.endsWith('&&') ||
          trimmed.endsWith('||') ||
          prevLine.endsWith('&&') ||
          prevLine.endsWith('||')
        ) {
          continue;
        }

        // Skip if line ends with ; (complete statement, not a definition)
        if (trimmed.endsWith(';')) {
          continue;
        }

        // For lines ending with , - could be function call OR multi-line definition
        // A function DEFINITION has:
        // - Previous line is a return type (smdb_error, void, bool, etc.)
        // - Line starts at column 0 or with return type
        // A function CALL has:
        // - Assignment (=) or return before Class::method
        // - Significant indentation (nested inside another call/expression)
        if (trimmed.endsWith(',')) {
          // If there's an assignment or return before Class::method, it's a call
          const colonIdx = line.indexOf(className + '::' + methodName);
          const beforeMatch = colonIdx > 0 ? line.substring(0, colonIdx) : '';
          if (beforeMatch.includes('=') || beforeMatch.includes('return ')) {
            continue;
          }

          // Check if previous line is a valid return type (function definition)
          const validReturnTypes = [
            'void',
            'bool',
            'int',
            'unsigned',
            'char',
            'long',
            'double',
            'float',
            'size_t',
            'smdb_error',
            'smdb_list',
            'std::string',
            'string',
            'refp',
            'pair',
            'tuple',
            'status_t',
            'error_t',
            'auto',
            'static',
          ];
          const prevLineIsReturnType = validReturnTypes.some(
            (t) =>
              prevLine === t ||
              prevLine.startsWith(t + ' ') ||
              prevLine.startsWith(t + '<'),
          );

          // If previous line is NOT a return type, it's likely a call, not a definition
          if (!prevLineIsReturnType) {
            continue;
          }
          // Otherwise it's a multi-line function definition - continue checking
        }

        // Find end of function
        let braceCount = 0;
        let foundOpen = false;
        let endLine = i;

        for (
          let j = i;
          j < lines.length && j < i + MAX_FUNCTION_SEARCH_LINES;
          j++
        ) {
          for (const char of lines[j]) {
            if (char === '{') {
              braceCount++;
              foundOpen = true;
            }
            if (char === '}') braceCount--;
          }
          if (foundOpen && braceCount === 0) {
            endLine = j;
            break;
          }
        }

        if (endLine > i) {
          functions.push({
            name: methodName,
            qualifiedName: `${className}::${methodName}`,
            startLine: i + 1,
            endLine: endLine + 1,
          });
        }
      }

      // Free function definition: multiple patterns supported

      // Pattern 1: returnType functionName(params...) - all on SAME line
      // e.g., "smdb_error move_volume(const smdb_type_aggr_name & destination_aggregate,"
      // This also handles template functions where template<...> is on prev line
      const sameLineMatch = line.match(
        /^(\w[\w:&*<>\s]*?)\s+(\w+)\s*\([^)]*[,)]?\s*$/,
      );
      if (sameLineMatch && !trimmed.endsWith(';')) {
        const returnType = sameLineMatch[1].trim();
        const funcName = sameLineMatch[2];

        // Skip common non-function patterns
        if (
          [
            'if',
            'while',
            'for',
            'switch',
            'catch',
            'return',
            'case',
            'traceEntry',
            'traceError',
            'traceDebug',
            'traceLog',
            'logSmdbErrOnExit',
            'logNumericOnExit',
            'template',
            'BOOST_AUTO_TEST_CASE',
            'TEST_F',
            'TEST',
          ].includes(funcName)
        ) {
          continue;
        }

        // Validate it's a real return type (not a macro or control flow)
        const validReturnTypes = [
          'void',
          'bool',
          'int',
          'unsigned',
          'char',
          'long',
          'double',
          'float',
          'size_t',
          'smdb_error',
          'smdb_list',
          'std::string',
          'string',
          'refp',
          'status_t',
          'error_t',
          'auto',
        ];
        const hasValidReturnType = validReturnTypes.some(
          (t) =>
            returnType === t ||
            returnType.startsWith(t) ||
            returnType.includes(t + ' '),
        );

        // Also allow if previous line is template<...>
        const prevLine = i > 0 ? lines[i - 1].trim() : '';
        const isTemplateFunction =
          prevLine.startsWith('template<') && hasValidReturnType;

        if (hasValidReturnType || isTemplateFunction) {
          // Find end of function
          let braceCount = 0;
          let foundOpen = false;
          let endLine = i;

          for (
            let j = i;
            j < lines.length && j < i + MAX_FUNCTION_SEARCH_LINES;
            j++
          ) {
            for (const char of lines[j]) {
              if (char === '{') {
                braceCount++;
                foundOpen = true;
              }
              if (char === '}') braceCount--;
            }
            if (foundOpen && braceCount === 0) {
              endLine = j;
              break;
            }
          }

          if (endLine > i) {
            functions.push({
              name: funcName,
              startLine: i + 1,
              endLine: endLine + 1,
            });
            continue;
          }
        }
      }

      // Pattern 2: returnType on prev line, functionName( on this line
      // Pattern: smdb_error\nfunctionName(params...)
      // Also handles template functions: template<...>\nreturnType\nfunctionName(...)
      // Note: Don't filter on endsWith(",") - multi-line params are OK for definitions
      const freeFuncMatch = line.match(/^(\w+)\s*\(/);
      if (freeFuncMatch && !trimmed.endsWith(';')) {
        const funcName = freeFuncMatch[1];

        // Skip common non-function patterns
        if (
          [
            'if',
            'while',
            'for',
            'switch',
            'catch',
            'return',
            'case',
            'traceEntry',
            'traceError',
            'traceDebug',
            'traceLog',
            'logSmdbErrOnExit',
            'logNumericOnExit',
            'BOOST_AUTO_TEST_CASE',
            'TEST_F',
            'TEST',
          ].includes(funcName)
        ) {
          continue;
        }

        // Check previous line for return type
        const prevLine = i > 0 ? lines[i - 1].trim() : '';
        const prevPrevLine = i > 1 ? lines[i - 2].trim() : '';

        const validReturnTypes = [
          'void',
          'bool',
          'int',
          'unsigned',
          'char',
          'long',
          'double',
          'float',
          'size_t',
          'smdb_error',
          'smdb_list',
          'std::string',
          'string',
          'refp',
          'status_t',
          'error_t',
          'auto',
        ];
        const hasValidReturnType = validReturnTypes.some(
          (t) =>
            prevLine === t ||
            prevLine.startsWith(t + '<') ||
            prevLine.startsWith(t + ' '),
        );

        // Also check for template functions: template<...> on prevPrevLine
        const isTemplateFunction =
          prevPrevLine.startsWith('template<') &&
          validReturnTypes.some(
            (t) =>
              prevLine === t ||
              prevLine.startsWith(t + '<') ||
              prevLine.startsWith(t + ' '),
          );

        if (hasValidReturnType || isTemplateFunction) {
          // Find end of function
          let braceCount = 0;
          let foundOpen = false;
          let endLine = i;

          for (
            let j = i;
            j < lines.length && j < i + MAX_FUNCTION_SEARCH_LINES;
            j++
          ) {
            for (const char of lines[j]) {
              if (char === '{') {
                braceCount++;
                foundOpen = true;
              }
              if (char === '}') braceCount--;
            }
            if (foundOpen && braceCount === 0) {
              endLine = j;
              break;
            }
          }

          if (endLine > i) {
            functions.push({
              name: funcName,
              startLine: i + 1,
              endLine: endLine + 1,
            });
          }
        }
      }
    }

    return functions;
  }

  /**
   * Find the function containing a specific line number
   */
  findContainingFunction(
    code: string,
    lineNumber: number,
  ): NativeFunctionBounds | undefined {
    const functions = this.listFunctions(code);

    // Find function containing this line (MUST actually contain it)
    for (const func of functions) {
      if (lineNumber >= func.startLine && lineNumber <= func.endLine) {
        return func;
      }
    }

    // No fallback - if we can't find an exact match, return undefined
    // The dangerous "closest function before this line" fallback was causing
    // false positives in call graphs (e.g., returning function at line 86
    // when the actual containing function at line 171 wasn't parsed correctly)
    return undefined;
  }

  /**
   * Get internal tree-sitter parser and language objects for advanced AST operations.
   * Returns null if the native parser isn't initialized.
   */
  getParserInternals(): { parser: any; language: any } | null {
    if (!this.parser || !this.language) {
      return null;
    }
    return {
      parser: this.parser,
      language: this.language,
    };
  }

  // =========================================================================
  // Regex Fallback (when native tree-sitter isn't available)
  // =========================================================================

  /**
   * Regex-based call extraction fallback for platforms without native bindings
   */
  private extractCallsWithRegex(
    code: string,
    functionName: string,
    maxCalls: number = 100,
  ): NativeExtractionResult {
    const startTime = performance.now();

    // Find function boundaries
    const parseStart = performance.now();
    const funcSlice = this.extractFunctionSlice(code, functionName);
    const parseMs = performance.now() - parseStart;

    if (!funcSlice) {
      return {
        success: false,
        calls: [],
        timing: {
          parseMs,
          extractMs: 0,
          totalMs: performance.now() - startTime,
        },
        error: `Function not found: ${functionName}`,
        usedFallback: true,
      };
    }

    const extractStart = performance.now();
    const calls: NativeCallInfo[] = [];
    const seen = new Set<string>();

    // Regex patterns for call extraction
    const callPatterns = [
      // Method call: obj.method( or obj->method(
      /(\w+)(?:\.|->)(\w+)\s*\(/g,
      // Qualified call: Namespace::function(
      /([\w:]+)::(\w+)\s*\(/g,
      // Direct call: function(
      /\b(\w+)\s*\(/g,
    ];

    const funcLines = funcSlice.code.split('\n');

    for (
      let lineIdx = 0;
      lineIdx < funcLines.length && calls.length < maxCalls;
      lineIdx++
    ) {
      const line = funcLines[lineIdx];
      const actualLine = funcSlice.lineOffset + lineIdx + 1;

      // Skip comments
      const trimmed = line.trim();
      if (
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*')
      ) {
        continue;
      }

      // Method/qualified calls
      let match;

      // obj.method() or obj->method()
      const methodRegex = /(\w+)(?:\.|->)(\w+)\s*\(/g;
      while (
        (match = methodRegex.exec(line)) !== null &&
        calls.length < maxCalls
      ) {
        const receiver = match[1];
        const callee = match[2];
        const key = `${callee}:${actualLine}`;

        if (!seen.has(key) && !shouldSkipNativeCall(callee)) {
          seen.add(key);
          calls.push({
            callee,
            receiver,
            line: actualLine,
            column: match.index,
            callType: 'method',
          });
        }
      }

      // Namespace::function()
      const qualifiedRegex = /([\w]+)::(\w+)\s*\(/g;
      while (
        (match = qualifiedRegex.exec(line)) !== null &&
        calls.length < maxCalls
      ) {
        const receiver = match[1];
        const callee = match[2];
        const key = `${callee}:${actualLine}`;

        if (
          !seen.has(key) &&
          !shouldSkipNativeCall(callee) &&
          receiver !== 'std'
        ) {
          seen.add(key);
          calls.push({
            callee,
            receiver,
            line: actualLine,
            column: match.index,
            callType: 'qualified',
          });
        }
      }

      // Direct function calls (be careful not to match keywords)
      const directRegex = /\b([a-z_][a-zA-Z0-9_]*)\s*\(/g;
      while (
        (match = directRegex.exec(line)) !== null &&
        calls.length < maxCalls
      ) {
        const callee = match[1];
        const key = `${callee}:${actualLine}`;

        // Skip if already captured as method/qualified, or is a keyword
        if (!seen.has(key) && !shouldSkipNativeCall(callee)) {
          // Skip common control flow that looks like calls
          if (
            !['if', 'for', 'while', 'switch', 'return', 'sizeof'].includes(
              callee,
            )
          ) {
            seen.add(key);
            calls.push({
              callee,
              line: actualLine,
              column: match.index,
              callType: 'direct',
            });
          }
        }
      }
    }

    const extractMs = performance.now() - extractStart;

    return {
      success: true,
      calls,
      functionBounds: {
        name: functionName,
        qualifiedName: funcSlice.qualifiedName,
        startLine: funcSlice.startLine,
        endLine: funcSlice.endLine,
      },
      timing: {
        parseMs,
        extractMs,
        totalMs: performance.now() - startTime,
      },
      usedFallback: true,
    };
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  /**
   * Build a map of variable names to their types by scanning declarations in the AST.
   *
   * Handles patterns:
   * - ClassName varName;
   * - ClassName varName(args);
   * - ClassName* varName;
   * - refp<ClassName> varName(...);
   * - auto varName = make_refp<ClassName>(...);
   * - new ClassName(...)
   */
  private buildVariableTypeMap(rootNode: any): Map<string, string> {
    const varTypeMap = new Map<string, string>();

    this.walkTree(rootNode, (node) => {
      if (node.type === 'declaration') {
        // First check for auto with make_refp: auto varName = make_refp<ClassName>(...)
        // Must handle this BEFORE the early return below
        const placeholderType = node.children.find(
          (c: any) => c.type === 'placeholder_type_specifier',
        );
        if (placeholderType?.text === 'auto') {
          const initDeclarator = node.children.find(
            (c: any) => c.type === 'init_declarator',
          );
          if (initDeclarator) {
            const varNameNode = initDeclarator.children.find(
              (c: any) => c.type === 'identifier',
            );
            // Look for make_refp<ClassName> in the initializer
            const initText = initDeclarator.text;
            const makeRefpMatch = initText.match(/make_refp<(\w+)>/);
            if (makeRefpMatch && varNameNode) {
              varTypeMap.set(varNameNode.text, makeRefpMatch[1]);
            }
          }
          return; // Done with auto declarations
        }

        // Get the type from the declaration
        const typeNode =
          node.childForFieldName('type') ||
          node.children.find(
            (c: any) =>
              c.type === 'type_identifier' || c.type === 'template_type',
          );

        if (!typeNode) return;

        let typeName: string | null = null;

        if (typeNode.type === 'type_identifier') {
          // Direct type: ClassName varName
          typeName = typeNode.text;
        } else if (typeNode.type === 'template_type') {
          // Template type: refp<ClassName> varName
          const templateArgs = typeNode.children.find(
            (c: any) => c.type === 'template_argument_list',
          );
          if (templateArgs) {
            // Extract the inner type from template_argument_list
            const innerType = templateArgs.children.find(
              (c: any) =>
                c.type === 'type_descriptor' || c.type === 'type_identifier',
            );
            if (innerType) {
              // Get the type_identifier inside type_descriptor
              if (innerType.type === 'type_descriptor') {
                const typeId = innerType.children.find(
                  (c: any) => c.type === 'type_identifier',
                );
                typeName = typeId?.text || null;
              } else {
                typeName = innerType.text;
              }
            }
          }
        } else if (
          typeNode.type === 'primitive_type' ||
          typeNode.type === 'sized_type_specifier'
        ) {
          // Primitive or sized types (int, unsigned, etc.) - skip, not interesting
          return;
        }

        if (!typeName) return;

        // Find the declarator to get the variable name
        const initDeclarator = node.children.find(
          (c: any) => c.type === 'init_declarator',
        );
        if (initDeclarator) {
          // Can be: identifier, pointer_declarator, or reference_declarator
          let varNameNode = initDeclarator.children.find(
            (c: any) => c.type === 'identifier',
          );
          if (!varNameNode) {
            // Check for pointer_declarator: ClassName* varName
            const ptrDecl = initDeclarator.children.find(
              (c: any) => c.type === 'pointer_declarator',
            );
            if (ptrDecl) {
              varNameNode = ptrDecl.children.find(
                (c: any) => c.type === 'identifier',
              );
            }
          }

          if (varNameNode && varNameNode.text.length > 1) {
            varTypeMap.set(varNameNode.text, typeName);
          }
        }

        // Also check for direct declarators (not init_declarator)
        // ClassName varName; (no initializer)
        const directDeclarator = node.children.find(
          (c: any) => c.type === 'identifier' && c !== typeNode,
        );
        if (directDeclarator && directDeclarator.text.length > 1) {
          varTypeMap.set(directDeclarator.text, typeName);
        }

        // Handle constructor-style declarations: ClassName varName(args)
        // Tree-sitter parses this as function_declarator, not init_declarator
        const funcDecl = node.children.find(
          (c: any) => c.type === 'function_declarator',
        );
        if (funcDecl) {
          const varNameNode = funcDecl.children.find(
            (c: any) => c.type === 'identifier',
          );
          if (varNameNode && varNameNode.text.length > 1) {
            varTypeMap.set(varNameNode.text, typeName);
          }
        }
      }
    });

    return varTypeMap;
  }

  private extractCallInfo(
    node: any,
    lineOffset: number,
    varTypeMap?: Map<string, string>,
  ): NativeCallInfo | null {
    const funcNode = node.childForFieldName('function');
    if (!funcNode) return null;

    let callee: string | null = null;
    let receiver: string | undefined;
    let receiverType: string | undefined;
    let callType: NativeCallInfo['callType'] = 'direct';

    if (funcNode.type === 'identifier') {
      // Direct call: functionName()
      callee = funcNode.text;
    } else if (funcNode.type === 'field_expression') {
      // Method call: obj.method() or obj->method()
      const field = funcNode.childForFieldName('field');
      const obj = funcNode.childForFieldName('argument');
      callee = field?.text || null;
      receiver = obj?.text;
      // Resolve receiver type from variable map
      if (receiver && varTypeMap) {
        receiverType = varTypeMap.get(receiver);
      }
      callType = 'method';
    } else if (funcNode.type === 'qualified_identifier') {
      // Qualified call: Namespace::function()
      // Extract just the function name (after last ::) for matching
      const parts = funcNode.text.split('::');
      callee = parts[parts.length - 1]; // Base name for matching
      receiver = parts.slice(0, -1).join('::'); // Namespace as receiver
      receiverType = receiver; // For qualified calls, receiver IS the type
      callType = 'qualified';
    } else if (funcNode.type === 'template_function') {
      // Template call: func<T>()
      const nameNode = funcNode.childForFieldName('name');
      callee = nameNode?.text || funcNode.text;
    }

    if (!callee) return null;

    // Check if it's a macro (ALL_CAPS)
    if (callee === callee.toUpperCase() && callee.length > 2) {
      callType = 'macro';
    }

    // Extract arguments (optional)
    const argsNode = node.childForFieldName('arguments');
    const args: string[] = [];
    if (argsNode) {
      for (const arg of argsNode.namedChildren) {
        if (arg.type !== 'comment') {
          args.push(arg.text);
        }
      }
    }

    return {
      callee,
      receiver,
      receiverType,
      line: node.startPosition.row + 1 + lineOffset,
      column: node.startPosition.column,
      callType,
      arguments: args.length > 0 ? args : undefined,
    };
  }

  private walkTree(
    node: any, // Parser.SyntaxNode when available
    callback: (node: any) => void,
  ): void {
    callback(node);
    for (const child of node.children) {
      this.walkTree(child, callback);
    }
  }

  // =========================================================================
  // Iterator Instantiation Tracking (AST-based)
  // =========================================================================
  // These methods enable tracking deeper call chains for iterator patterns
  // where: ClassName itr(...); itr.method() triggers an _imp method internally
  //
  // Iterator method mapping: itr.create() → ClassName::create_imp
  // This is because ONTAP iterators have public methods that delegate to _imp

  /**
   * Check if a type name looks like an iterator (ends with _iterator)
   */
  private isIteratorType(typeName: string): boolean {
    return typeName.endsWith('_iterator');
  }

  /**
   * Map an instance method call to its actual implementation.
   * For iterator types: itr.create() → ClassName::create_imp
   * For non-iterators: itr.create() → ClassName::create
   */
  mapInstanceMethodToImpl(typeName: string, methodName: string): string {
    if (this.isIteratorType(typeName)) {
      // Iterator methods map to _imp suffix
      return `${typeName}::${methodName}_imp`;
    }
    return `${typeName}::${methodName}`;
  }

  /**
   * Find type instantiations using AST (variable declarations of a specific type)
   *
   * Handles patterns:
   * 1. ClassName varName;                    - default constructor
   * 2. ClassName varName(args);              - constructor with args
   * 3. ClassName* varName = new ClassName(); - pointer with new
   * 4. ClassName* varName;                   - pointer declaration
   * 5. refp<ClassName> varName(...);         - smart pointer
   * 6. auto varName = make_refp<ClassName>(); - auto with smart pointer
   */
  findTypeInstantiations(
    code: string,
    typeName: string,
  ): TypeInstantiationInfo[] {
    const results: TypeInstantiationInfo[] = [];

    // Use AST for parsing
    const tree = this.getCachedParseTree(code);
    if (!tree) {
      // Fallback to regex if AST fails
      return this.findTypeInstantiationsRegex(code, typeName);
    }

    try {
      this.walkTree(tree.rootNode, (node) => {
        // Handle declaration nodes: ClassName varName; or ClassName varName(args);
        if (node.type === 'declaration') {
          // Get the type from the declaration
          const typeNode =
            node.childForFieldName('type') ||
            node.children.find(
              (c: any) =>
                c.type === 'type_identifier' || c.type === 'template_type',
            );

          if (!typeNode) return;

          // Check if the type matches (handle both direct and template types)
          let matchesType = false;
          if (
            typeNode.type === 'type_identifier' &&
            typeNode.text === typeName
          ) {
            matchesType = true;
          } else if (typeNode.type === 'template_type') {
            // Handle refp<ClassName> or similar
            const templateName = typeNode.children.find(
              (c: any) => c.type === 'type_identifier',
            );
            const templateArgs = typeNode.children.find(
              (c: any) => c.type === 'template_argument_list',
            );
            if (
              templateName?.text === 'refp' &&
              templateArgs?.text?.includes(typeName)
            ) {
              matchesType = true;
            }
          }

          if (!matchesType) return;

          // Find the declarator to get the variable name
          const initDeclarator = node.children.find(
            (c: any) => c.type === 'init_declarator',
          );
          if (initDeclarator) {
            // Can be: identifier, pointer_declarator, or reference_declarator
            let varNameNode = initDeclarator.children.find(
              (c: any) => c.type === 'identifier',
            );
            if (!varNameNode) {
              // Check for pointer_declarator: ClassName* varName
              const ptrDecl = initDeclarator.children.find(
                (c: any) => c.type === 'pointer_declarator',
              );
              if (ptrDecl) {
                varNameNode = ptrDecl.children.find(
                  (c: any) => c.type === 'identifier',
                );
              }
            }

            if (varNameNode && varNameNode.text.length > 1) {
              const lineNum = node.startPosition.row + 1;
              const containingFunc = this.findContainingFunction(code, lineNum);
              results.push({
                varName: varNameNode.text,
                typeName,
                line: lineNum,
                column: node.startPosition.column,
                isSmartPointer: typeNode.type === 'template_type',
                scope: containingFunc
                  ? {
                      functionName:
                        containingFunc.qualifiedName || containingFunc.name,
                      startLine: containingFunc.startLine,
                      endLine: containingFunc.endLine,
                    }
                  : undefined,
              });
            }
          }
        }

        // Handle auto with make_refp: auto varName = make_refp<ClassName>(...)
        if (node.type === 'declaration') {
          const typeNode = node.children.find(
            (c: any) => c.type === 'placeholder_type_specifier',
          );
          if (typeNode?.text === 'auto') {
            const initDeclarator = node.children.find(
              (c: any) => c.type === 'init_declarator',
            );
            if (initDeclarator) {
              const varNameNode = initDeclarator.children.find(
                (c: any) => c.type === 'identifier',
              );
              const callExpr =
                initDeclarator.descendantsOfType('call_expression')[0];
              if (callExpr) {
                const callText = callExpr.text;
                if (
                  callText.includes('make_refp') &&
                  callText.includes(typeName)
                ) {
                  if (varNameNode && varNameNode.text.length > 1) {
                    const lineNum = node.startPosition.row + 1;
                    const containingFunc = this.findContainingFunction(
                      code,
                      lineNum,
                    );
                    results.push({
                      varName: varNameNode.text,
                      typeName,
                      line: lineNum,
                      column: node.startPosition.column,
                      isSmartPointer: true,
                      scope: containingFunc
                        ? {
                            functionName:
                              containingFunc.qualifiedName ||
                              containingFunc.name,
                            startLine: containingFunc.startLine,
                            endLine: containingFunc.endLine,
                          }
                        : undefined,
                    });
                  }
                }
              }
            }
          }
        }
      });
    } catch {
      // Fallback to regex on error
      return this.findTypeInstantiationsRegex(code, typeName);
    }

    return results;
  }

  /**
   * Regex fallback for findTypeInstantiations (used when AST fails)
   */
  private findTypeInstantiationsRegex(
    code: string,
    typeName: string,
  ): TypeInstantiationInfo[] {
    const results: TypeInstantiationInfo[] = [];
    const lines = code.split('\n');

    // Pattern: ClassName [*&]? varName ( | = | ;
    const directPattern = new RegExp(
      `\\b${typeName}\\s*[*&]?\\s+(\\w+)\\s*(?:\\(|=|;)`,
      'g',
    );
    // refp<ClassName> varName
    const refpPattern = new RegExp(
      `refp<${typeName}>\\s+(\\w+)\\s*(?:\\(|=|;)`,
      'g',
    );
    // auto varName = make_refp<ClassName>
    const autoPattern = new RegExp(
      `auto\\s+(\\w+)\\s*=\\s*(?:smdb::)?make_refp<${typeName}>`,
      'g',
    );

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      const lineNum = lineIdx + 1;
      const trimmed = line.trim();
      if (
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*')
      ) {
        continue;
      }

      for (const [pattern, isSmartPointer] of [
        [directPattern, false],
        [refpPattern, true],
        [autoPattern, true],
      ] as const) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) !== null) {
          const varName = match[1];
          if (varName && varName.length > 1) {
            const containingFunc = this.findContainingFunction(code, lineNum);
            results.push({
              varName,
              typeName,
              line: lineNum,
              column: match.index,
              isSmartPointer,
              scope: containingFunc
                ? {
                    functionName:
                      containingFunc.qualifiedName || containingFunc.name,
                    startLine: containingFunc.startLine,
                    endLine: containingFunc.endLine,
                  }
                : undefined,
            });
          }
        }
      }
    }
    return results;
  }

  /**
   * Find method calls on a specific variable within a scope
   */
  findMethodCallsOnVariable(
    code: string,
    varName: string,
    methodName?: string,
    scopeStartLine?: number,
    scopeEndLine?: number,
  ): MethodCallOnVariableInfo[] {
    const results: MethodCallOnVariableInfo[] = [];
    const lines = code.split('\n');

    // Determine scope (default to entire file)
    const startIdx = scopeStartLine ? scopeStartLine - 1 : 0;
    const endIdx = scopeEndLine
      ? Math.min(scopeEndLine, lines.length)
      : lines.length;

    // Patterns for method calls:
    // varName.method( or varName->method(
    const methodPattern = methodName
      ? new RegExp(`\\b${varName}\\s*(?:\\.|->)\\s*${methodName}\\s*\\(`, 'g')
      : new RegExp(`\\b${varName}\\s*(?:\\.|->)\\s*(\\w+)\\s*\\(`, 'g');

    for (let lineIdx = startIdx; lineIdx < endIdx; lineIdx++) {
      const line = lines[lineIdx];
      const lineNum = lineIdx + 1;

      // Skip comments
      const trimmed = line.trim();
      if (
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*')
      ) {
        continue;
      }

      methodPattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = methodPattern.exec(line)) !== null) {
        const calledMethod = methodName || match[1];
        const isArrowCall = line
          .substring(match.index, match.index + match[0].length)
          .includes('->');

        results.push({
          varName,
          methodName: calledMethod,
          line: lineNum,
          column: match.index,
          isArrowCall,
          context: trimmed.substring(0, 100), // First 100 chars for context
        });
      }
    }

    return results;
  }

  /**
   * Combined function: Find instantiation + method call pattern
   * This is the main entry point for iterator tracking
   *
   * Returns functions that:
   * 1. Instantiate the given type (e.g., svm_kdb_iterator)
   * 2. Call a specific method on that instance (e.g., create_svm_key)
   */
  findInstantiationAndMethodCall(
    code: string,
    typeName: string,
    methodName: string,
  ): InstantiationCallPattern[] {
    const results: InstantiationCallPattern[] = [];

    // Step 1: Find all instantiations of the type
    const instantiations = this.findTypeInstantiations(code, typeName);

    // Step 2: For each instantiation, look for method calls within its scope
    for (const inst of instantiations) {
      if (!inst.scope) continue;

      // Look for method calls on this variable within its function scope
      const methodCalls = this.findMethodCallsOnVariable(
        code,
        inst.varName,
        methodName,
        inst.scope.startLine,
        inst.scope.endLine,
      );

      // Only include if we found at least one matching method call
      if (methodCalls.length > 0) {
        results.push({
          instantiation: inst,
          methodCalls,
          containingFunction: inst.scope.functionName,
        });
      }
    }

    return results;
  }

  /**
   * AST-based verification: Check if a specific line contains an actual function call to a symbol
   *
   * This is much more accurate than regex-based detection because it uses the actual
   * parse tree to identify call_expression nodes.
   *
   * @param code - Full file content
   * @param lineNum - 1-based line number to check
   * @param symbol - Symbol name to look for (e.g., "keymanager_vdek_table_iterator" or "Class::method")
   * @returns true if the line contains an actual call to the symbol
   */
  isActualCallToSymbol(
    code: string,
    lineNum: number,
    symbol: string,
  ): boolean | null {
    const tree = this.getCachedParseTree(code);
    if (!tree) {
      return null; // Signal fallback to regex
    }

    // Extract the method/function name from the symbol
    // "Class::method" -> "method", "function" -> "function"
    const methodName = symbol.includes('::')
      ? symbol.split('::').pop()!
      : symbol;

    // Also get the class name if qualified
    const className = symbol.includes('::')
      ? symbol.split('::').slice(0, -1).join('::')
      : null;

    const sanitized = this.sanitizeCodeForParsing(code);
    if (!sanitized) {
      return null;
    }

    try {
      // Track if we found any call
      let foundCall = false;

      // Walk the tree looking for call expressions near the target line
      // We check lines lineNum-2 to lineNum+2 to handle multi-line calls
      this.walkTree(tree.rootNode, (node) => {
        if (foundCall) return; // Early exit

        // Check call expressions
        if (node.type === 'call_expression') {
          const nodeLine = node.startPosition.row + 1;

          // Only check if this call is near our target line
          if (Math.abs(nodeLine - lineNum) <= 2) {
            const callInfo = this.extractCallInfo(node, 0);
            if (callInfo) {
              // Match the callee name
              const callee = callInfo.callee;

              // Direct match
              if (callee === symbol || callee === methodName) {
                foundCall = true;
                return;
              }

              // For qualified symbols, check if callee ends with the method name
              // and context suggests it's the right class
              if (className && callee === methodName) {
                // Check if context contains the class name (for obj.method or ptr->method patterns)
                const lineText = sanitized.split('\n')[nodeLine - 1] || '';
                if (lineText.includes(className)) {
                  foundCall = true;
                  return;
                }
              }

              // Check qualified callee like "ClassName::methodName"
              if (callee.includes('::') && callee.endsWith(methodName)) {
                if (!className || callee.includes(className)) {
                  foundCall = true;
                  return;
                }
              }

              // Check if symbol appears as SCOPE in a static method call
              // e.g., symbol="SomeClass", callee="SomeClass::someMethod" => should match
              // This handles: keymanager_vdek_table_iterator::xcDeleteVdekFromCryptomod()
              if (callee.includes('::') && callee.startsWith(symbol + '::')) {
                foundCall = true;
                return;
              }
            }

            // Fallback: check the line text for "symbol::" pattern with function call
            // This catches cases where extractCallInfo might not capture the full qualified name
            const lineText = sanitized.split('\n')[nodeLine - 1] || '';
            if (lineText.includes(symbol + '::') && lineText.includes('(')) {
              foundCall = true;
              return;
            }
          }
        }

        // Also check constructor calls: "ClassName varName(" or "new ClassName("
        // These appear as declaration nodes or new_expression nodes
        if (node.type === 'declaration' || node.type === 'new_expression') {
          const nodeLine = node.startPosition.row + 1;
          if (Math.abs(nodeLine - lineNum) <= 2) {
            const nodeText = node.text;
            // Check for constructor pattern: ClassName varName( or new ClassName(
            if (nodeText.includes(symbol) || nodeText.includes(methodName)) {
              const constructorPattern = new RegExp(
                `\\b${methodName}\\s+(\\w+\\s*\\(|\\()`,
                'i',
              );
              const newPattern = new RegExp(`new\\s+${methodName}\\s*\\(`, 'i');
              if (
                constructorPattern.test(nodeText) ||
                newPattern.test(nodeText)
              ) {
                foundCall = true;
                return;
              }
            }
          }
        }

        // Also check instance method calls: var.method() or var->method()
        // where var is declared as our symbol type
        if (node.type === 'call_expression') {
          const nodeLine = node.startPosition.row + 1;
          // Check lines within ±2 to handle cases where declaration and call are on different lines
          if (Math.abs(nodeLine - lineNum) <= 2) {
            const lineText = sanitized.split('\n')[nodeLine - 1] || '';

            // Match patterns like: varName->method( or varName.method(
            const instanceCallMatch = lineText.match(
              /\b(\w+)\s*(?:->|\.)\s*(\w+)\s*\(/,
            );
            if (instanceCallMatch) {
              const varName = instanceCallMatch[1];

              // Reuse existing findTypeInstantiations to check if varName is declared as symbol type
              const instantiations = this.findTypeInstantiations(code, symbol);
              if (instantiations.some((inst) => inst.varName === varName)) {
                foundCall = true;
                return;
              }
            }
          }
        }
      });

      CppProvider.stats.treeSitterSuccess++;
      return foundCall;
    } catch (e) {
      CppProvider.stats.treeSitterFailed++;
      return null; // Signal fallback to regex
    }
  }

  /**
   * Extract the actual callee name at a given line when searching for a symbol.
   * For static method calls like `Class::method(...)`, returns `Class::method` (NO _imp).
   * For instance method calls like `var.method()` where var is of type Class, returns:
   *   - `Class::method_imp` if Class is an iterator type (ends with _iterator)
   *   - `Class::method` otherwise
   * For constructor calls like `Class var(...)`, returns `Class`.
   * Returns null if no call found or AST unavailable.
   */
  extractActualCalleeAtLine(
    code: string,
    lineNum: number,
    symbol: string,
  ): string | null {
    const tree = this.getCachedParseTree(code);
    if (!tree) {
      return null;
    }

    const sanitized = this.sanitizeCodeForParsing(code);
    if (!sanitized) {
      return null;
    }

    try {
      // Collect all potential matches with their line distances
      const candidates: {
        callee: string;
        distance: number;
        priority: number;
      }[] = [];

      // Pre-compute instantiations once (for instance method detection)
      const instantiations = this.findTypeInstantiations(code, symbol);

      // PHASE 1: Check for static/direct calls near the target line (±2)
      // These are cases like Class::method() where OpenGrok found the actual call
      this.walkTree(tree.rootNode, (node) => {
        if (node.type === 'call_expression') {
          const nodeLine = node.startPosition.row + 1;
          const distance = Math.abs(nodeLine - lineNum);

          // Only consider static/direct calls within ±2 lines
          if (distance > 2) return;

          const callInfo = this.extractCallInfo(node, 0);
          const lineText = sanitized.split('\n')[nodeLine - 1] || '';

          // Case 1: Static method call - Class::method() - NO _imp suffix!
          if (callInfo) {
            const callee = callInfo.callee;

            if (callee.includes('::') && callee.startsWith(symbol + '::')) {
              // Static call - return as-is, NO _imp
              candidates.push({ callee, distance, priority: 1 });
              return;
            }

            if (callee === symbol) {
              candidates.push({ callee: symbol, distance, priority: 2 });
              return;
            }
          }

          // Case 2: Check for symbol:: pattern in line text (static call fallback)
          const staticCallMatch = lineText.match(
            new RegExp(`${symbol}::(\\w+)\\s*\\(`),
          );
          if (staticCallMatch) {
            // Static call - return as-is, NO _imp
            candidates.push({
              callee: `${symbol}::${staticCallMatch[1]}`,
              distance,
              priority: 3,
            });
            return;
          }
        }

        // Constructor calls (±2 lines)
        if (node.type === 'declaration' || node.type === 'new_expression') {
          const nodeLine = node.startPosition.row + 1;
          const distance = Math.abs(nodeLine - lineNum);

          if (distance > 2) return;

          const nodeText = node.text;
          const constructorPattern = new RegExp(
            `\\b${symbol}\\s+(\\w+\\s*\\(|\\()`,
            'i',
          );
          const newPattern = new RegExp(`new\\s+${symbol}\\s*\\(`, 'i');

          if (constructorPattern.test(nodeText) || newPattern.test(nodeText)) {
            candidates.push({ callee: symbol, distance, priority: 5 });
          }
        }
      });

      // PHASE 2: Check for instance method calls in the containing function
      // Run Phase 2 if:
      // - No candidates found (OpenGrok found a bare reference)
      // - OR only found constructor candidates (priority 5) - instance method calls are more interesting
      const onlyConstructors =
        candidates.length > 0 && candidates.every((c) => c.priority === 5);

      if (
        (candidates.length === 0 || onlyConstructors) &&
        instantiations.length > 0
      ) {
        // Find the containing function for the target line
        const containingFunc = this.findContainingFunction(code, lineNum);

        // DEBUG: Log Phase 2 activation

        if (containingFunc) {
          // Search within the entire function scope for instance method calls
          for (const inst of instantiations) {
            // Only consider instances declared in this function
            if (inst.scope?.functionName !== containingFunc.name) continue;

            // Find all method calls on this variable within its scope
            const methodCalls = this.findMethodCallsOnVariable(
              code,
              inst.varName,
              undefined, // any method
              inst.scope.startLine,
              inst.scope.endLine,
            );

            // Add each method call as a candidate
            for (const call of methodCalls) {
              const distance = Math.abs(call.line - lineNum);
              candidates.push({
                callee: this.mapInstanceMethodToImpl(symbol, call.methodName),
                distance,
                priority: 4,
              });
            }
          }
        }
      }

      // Pick the best candidate
      // Priority order:
      // 1. Static method calls (Class::method) - most specific
      // 2. Instance method calls (itr.method → Class::method_imp) - shows what's actually called
      // 3. Constructors - least informative (just "class was instantiated")
      if (candidates.length === 0) return null;

      // Separate by type: static (p1-3), instance (p4), constructor (p5)
      const staticCandidates = candidates.filter((c) => c.priority <= 3);
      const instanceCandidates = candidates.filter((c) => c.priority === 4);
      const constructorCandidates = candidates.filter((c) => c.priority === 5);

      // Prefer static calls on the exact line first (these are the actual calls OpenGrok found)
      const exactStatic = staticCandidates.filter((c) => c.distance === 0);
      if (exactStatic.length > 0) {
        return exactStatic[0].callee;
      }

      // Prefer instance method calls (more informative than just "instantiated the class")
      if (instanceCandidates.length > 0) {
        // Sort by distance (closest first)
        instanceCandidates.sort((a, b) => a.distance - b.distance);
        return instanceCandidates[0].callee;
      }

      // Fall back to nearby static calls or constructors
      candidates.sort((a, b) => {
        if (a.distance !== b.distance) return a.distance - b.distance;
        return a.priority - b.priority;
      });

      return candidates[0].callee;
    } catch {
      return null;
    }
  }
}

// ============================================================================
// Types for Iterator Instantiation Tracking
// ============================================================================

export interface TypeInstantiationInfo {
  varName: string;
  typeName: string;
  line: number;
  column: number;
  isSmartPointer?: boolean;
  scope?: {
    functionName: string;
    startLine: number;
    endLine: number;
  };
}

export interface MethodCallOnVariableInfo {
  varName: string;
  methodName: string;
  line: number;
  column: number;
  isArrowCall: boolean;
  context: string;
}

export interface InstantiationCallPattern {
  instantiation: TypeInstantiationInfo;
  methodCalls: MethodCallOnVariableInfo[];
  containingFunction: string;
}
