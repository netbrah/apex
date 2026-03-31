/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Agent Configuration
 *
 * Default configuration values and constants for code analysis agents.
 */

/**
 * Default configuration for the code analysis agent
 */
export const AGENT_CONFIG = {
  /** Maximum steps for agent reasoning */
  maxSteps: 20,

  /** Model to use */
  model: 'gpt-5.2',

  /** Default OpenGrok project */
  defaultProject: 'dev',

  /** Max callers to return from analyze_symbol_ast (reduced from 20 to prevent context blowup) */
  maxCallers: 10,

  /** Max callees to return from analyze_symbol_ast (reduced from 30 to prevent context blowup) */
  maxCallees: 15,

  /** Max depth for call graphs */
  maxCallGraphDepth: 3,

  /** Context lines around function definition */
  contextLines: 50,
};

/**
 * Skip list for call extraction - don't count these as meaningful calls
 */
export const CALL_SKIP_LIST = new Set([
  // C/C++ keywords
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'sizeof',
  'typeof',
  'alignof',
  'return',
  'else',
  'case',
  'default',
  'break',
  'continue',
  'goto',
  'do',

  // Logging/tracing (keep high-level trace functions, skip internals)
  'LOG',
  'TRACE',
  'DEBUG',
  'INFO',
  'WARN',
  'ERROR',
  'FATAL',
  'printf',
  'fprintf',
  'sprintf',
  'snprintf',
  'vprintf',
  'vfprintf',
  'traceEntry',
  'traceExit',
  'tracePrint',
  'traceLog',
  'traceWarn',
  'traceWarnAudit',
  'traceError',
  'traceDebug',
  'traceInfo',
  'traceExitRet',
  'traceWarning',
  'VIFMGR_TRACE_MACRO_',
  'configEntry',
  'configExit',
  'ENTRY_CT',
  'EXIT_CT',

  // Memory management
  'malloc',
  'free',
  'calloc',
  'realloc',
  'new',
  'delete',
  'memcpy',
  'memset',
  'memmove',
  'memcmp',

  // Assertions & test framework
  'ASSERT',
  'assert',
  'KASSERT',
  'CHECK',
  'VERIFY',
  'DCHECK',
  'TS_ASSERT',
  'TS_ASSERT_EQUALS',
  'TS_ASSERT_THROWS_NOTHING',
  'assertNull',
  'assertEquals',
  'assertTrue',
  'assertFalse',

  // String functions (C library)
  'strlen',
  'strcmp',
  'strcpy',
  'strncpy',
  'strcat',
  'strncat',
  'strftime',
  'localtime',
  'gmtime',

  // Common C++ utilities (too generic)
  'c_str',
  'str',
  'get',
  'set',
  'buf',
  'ptr',
  'data',
  'size',
  'length',
  'begin',
  'end',
  'empty',
  'clear',
  'push_back',
  'pop_back',
  'convertToString',
  'convertFromString',
  'toString',
  'to_string',

  // Reference counting internals
  'IncrementRefCount',
  'DecrementRefCount',
  'RefCountedString',
  'RefCountedStringValue',
  'as_string_view',
  'Ref',
  'Destroy',
  'Make',

  // Too generic - matches everywhere
  'insert',
  'find',
  'text',
  'value',
  'name',
  'type',
]);

/**
 * File path patterns to COMPLETELY EXCLUDE from all search results.
 * Results matching any of these patterns are dropped before scoring.
 */
export const EXCLUDE_PATHS = [
  '/bedrock/',
  '/third_party/',
  '/offtap/deploy/',
  '/offtap/sdk/',
];

/**
 * File path patterns to deprioritize in search results
 */
export const DEPRIORITIZE_PATHS = [
  '/third_party/',
  '/third-party/',
  '/test/',
  '/tests/',
  '/external/',
  '/vendor/',
  '/mock/',
  '/stub/',
  '/offtap/',
  '/kms_emulators',
];

/**
 * File path patterns to prioritize in search results
 */
export const PRIORITIZE_PATHS = [
  '/security/',
  '/keymanager/',
  '/volume/',
  '/aggregate/',
  '/cluster/',
  '/node/',
];
