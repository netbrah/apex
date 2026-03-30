/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/* eslint-disable */
/**
 * Language Provider Interface
 *
 * Unified abstraction for AST parsing across multiple languages (C++, Python, Perl).
 * Each language provider implements the same interface, allowing seamless switching
 * between languages while maintaining consistent behavior.
 *
 * This design is ported from claude-context's AST architecture, adapted for ONTAP
 * code analysis with OpenGrok integration.
 */

// ============================================================================
// Shared Types (portable across all language providers)
// ============================================================================

export interface NativeCallInfo {
  callee: string;
  receiver?: string;
  receiverType?: string; // Resolved type of the receiver (e.g., "keymanager_external_show_status_iterator")
  line: number;
  column: number;
  callType: 'direct' | 'method' | 'qualified' | 'macro';
  arguments?: string[];
}

export interface NativeFunctionBounds {
  name: string;
  qualifiedName?: string;
  startLine: number;
  endLine: number;
  signature?: string;
}

export interface NativeExtractionResult {
  success: boolean;
  calls: NativeCallInfo[];
  functionBounds?: NativeFunctionBounds;
  timing: {
    parseMs: number;
    extractMs: number;
    totalMs: number;
  };
  error?: string;
  usedFallback?: boolean; // True if regex fallback was used
}

// ============================================================================
// AST Node Type Configurations (per language)
// ============================================================================

export interface ASTNodeConfig {
  callExpression: string[]; // Node types for function calls
  functionDefinition: string[]; // Node types for function definitions
  classDefinition?: string[]; // Node types for class/struct definitions
  identifier: string; // Node type for identifiers
  fieldExpression?: string[]; // Node types for field/method access (obj.field)
}

/**
 * AST node types for each supported language
 * Based on tree-sitter grammar definitions
 */
export const AST_NODE_TYPES: Record<string, ASTNodeConfig> = {
  cpp: {
    callExpression: ['call_expression'],
    functionDefinition: ['function_definition', 'function_declarator'],
    classDefinition: ['class_specifier', 'struct_specifier'],
    identifier: 'identifier',
    fieldExpression: ['field_expression'],
  },
  c: {
    callExpression: ['call_expression'],
    functionDefinition: ['function_definition', 'function_declarator'],
    classDefinition: ['struct_specifier'],
    identifier: 'identifier',
    fieldExpression: ['field_expression'],
  },
  python: {
    callExpression: ['call'],
    functionDefinition: [
      'function_definition',
      'async_function_definition',
      'decorated_definition',
    ],
    classDefinition: ['class_definition'],
    identifier: 'identifier',
    fieldExpression: ['attribute'],
  },
  perl: {
    callExpression: ['method_invocation', 'function_call'],
    functionDefinition: ['function_definition', 'subroutine_declaration'],
    classDefinition: ['package_statement'],
    identifier: 'identifier',
    fieldExpression: ['method_invocation'],
  },
};

// ============================================================================
// Language Provider Interface
// ============================================================================

/**
 * Unified interface for language-specific AST providers
 *
 * Each language (C++, Python, Perl) implements this interface to provide:
 * - Function call extraction from specific functions
 * - Function boundary detection (start/end lines)
 * - Containing function lookup for a given line number
 * - Availability checking (some parsers are optional)
 */
export interface LanguageProvider {
  /**
   * Get the language identifier for this provider
   */
  getLanguage(): string;

  /**
   * Check if the native tree-sitter parser is available
   * Returns false if native bindings aren't available on this platform
   */
  isAvailable(): boolean;

  /**
   * Extract all function calls from a specific function in the code.
   *
   * This is the KEY operation for call graph construction.
   * Performance target: <5ms per function (native), <50ms (regex fallback)
   *
   * @param code - Full source code text
   * @param functionName - Name of function to analyze
   * @param maxCalls - Maximum number of calls to extract (default 100)
   * @returns Extraction result with calls, bounds, timing, and error info
   */
  extractCallsFromFunction(
    code: string,
    functionName: string,
    maxCalls?: number,
  ): NativeExtractionResult;

  /**
   * List all functions in a file (for caller detection)
   *
   * Returns function boundaries (name, start line, end line) for all
   * functions/methods defined in the code.
   *
   * @param code - Full source code text
   * @returns Array of function bounds
   */
  listFunctions(code: string): NativeFunctionBounds[];

  /**
   * Find the function containing a specific line number
   *
   * Given a line number (e.g., from a call site reference), find which
   * function it belongs to.
   *
   * @param code - Full source code text
   * @param lineNumber - 1-indexed line number
   * @returns Function bounds if found, undefined otherwise
   */
  findContainingFunction(
    code: string,
    lineNumber: number,
  ): NativeFunctionBounds | undefined;

  /**
   * Get internal tree-sitter parser and language objects for advanced AST operations.
   *
   * This is used for low-level AST operations like dumping the parse tree or
   * executing custom tree-sitter queries. Returns null if the native parser
   * isn't initialized or isn't available on this platform.
   *
   * @returns Object with parser and language, or null if unavailable
   */
  getParserInternals(): { parser: any; language: any } | null;
}

// ============================================================================
// Language Detection and Factory
// ============================================================================

/**
 * Language extension mappings
 * Used by factory to select the correct provider
 *
 * NOTE: .h files are mapped to both 'c' and 'cpp'. Since object iteration
 * order is deterministic in modern JS, 'cpp' will be selected first for .h files.
 * This is intentional - most ONTAP headers use C++ features (classes, namespaces).
 * For pure C headers, explicit language="c" should be passed to getLanguageProvider().
 */
export const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
  cpp: ['.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx', '.h'],
  c: ['.c', '.h'],
  python: ['.py'],
  perl: ['.pl', '.pm', '.thpl'], // CRITICAL: .thpl for ONTAP Perl files
};

/**
 * Get language identifier from file extension
 */
export function getLanguageFromExtension(filePath: string): string | undefined {
  const lastDotIndex = filePath.lastIndexOf('.');
  if (lastDotIndex === -1) {
    return undefined; // No extension
  }
  const ext = filePath.substring(lastDotIndex).toLowerCase();
  for (const [lang, exts] of Object.entries(LANGUAGE_EXTENSIONS)) {
    if (exts.includes(ext)) {
      return lang;
    }
  }
  return undefined;
}

/**
 * Factory function to get the appropriate language provider
 *
 * This is the main entry point for obtaining a language-specific provider.
 * Providers are lazily instantiated and cached.
 *
 * @param language - Language identifier ("cpp", "python", "perl", etc.) or file path
 * @returns Language provider or undefined if language not supported
 */
export function getLanguageProvider(
  language: string,
): LanguageProvider | undefined {
  // If language looks like a file path, extract extension
  if (
    language.includes('/') ||
    language.includes('\\') ||
    language.includes('.')
  ) {
    const detected = getLanguageFromExtension(language);
    if (!detected) return undefined;
    language = detected;
  }

  // Normalize language name
  const lang = language.toLowerCase();

  // Lazy-load providers to avoid circular dependencies
  switch (lang) {
    case 'cpp':
    case 'cxx':
    case 'c++':
      return getCppProvider();

    case 'c':
      // NOTE: C uses the same CppProvider because:
      // 1. tree-sitter-cpp handles both C and C++ syntax
      // 2. ONTAP codebase mixes C and C++ features
      // 3. The provider's regex patterns work for both languages
      // If pure C-specific behavior is needed, create a separate CProvider
      return getCppProvider();

    case 'python':
    case 'py':
      return getPythonProvider();

    case 'perl':
    case 'pl':
      return getPerlProvider();

    default:
      return undefined;
  }
}

// ============================================================================
// Provider Cache (lazy instantiation)
// ============================================================================

import { CppProvider } from './providers/cpp-provider.js';
import { PythonProvider } from './providers/python-provider.js';
import { PerlProvider } from './providers/perl-provider.js';

let cppProviderInstance: LanguageProvider | undefined;
let pythonProviderInstance: LanguageProvider | undefined;
let perlProviderInstance: LanguageProvider | undefined;

function getCppProvider(): LanguageProvider | undefined {
  if (!cppProviderInstance) {
    try {
      cppProviderInstance = new CppProvider();
    } catch (e) {
      console.error(
        '[language-provider] Failed to load C++ provider:',
        (e as Error).message,
      );
      return undefined;
    }
  }
  return cppProviderInstance;
}

function getPythonProvider(): LanguageProvider | undefined {
  if (!pythonProviderInstance) {
    try {
      pythonProviderInstance = new PythonProvider();
    } catch (e) {
      console.error(
        '[language-provider] Failed to load Python provider:',
        (e as Error).message,
      );
      return undefined;
    }
  }
  return pythonProviderInstance;
}

function getPerlProvider(): LanguageProvider | undefined {
  if (!perlProviderInstance) {
    try {
      perlProviderInstance = new PerlProvider();
    } catch (e) {
      console.error(
        '[language-provider] Failed to load Perl provider:',
        (e as Error).message,
      );
      return undefined;
    }
  }
  return perlProviderInstance;
}
