/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Native Tree-Sitter AST Provider (Backward Compatibility Layer)
 *
 * Ultra-fast AST parsing using native tree-sitter bindings.
 * Performance: ~0.5ms per file (vs ~4ms for regex-based parsing)
 *
 * This module now acts as a backward compatibility layer that wraps
 * the new CppProvider implementation. All existing exports continue
 * to work exactly as before, but internally use the new architecture.
 *
 * For new code, prefer using getLanguageProvider() from language-provider.ts
 * to automatically select the correct provider based on file type.
 *
 * NOTE: Tree-sitter native bindings may not be available on all platforms
 * (e.g., linux/arm64 in Docker). The module gracefully falls back to
 * regex-based extraction when native bindings aren't available.
 */

import { CppProvider } from './providers/cpp-provider.js';

// ============================================================================
// Re-export Types (for backward compatibility)
// ============================================================================

export type {
  NativeCallInfo,
  NativeFunctionBounds,
  NativeExtractionResult,
} from './language-provider.js';

// Re-export iterator tracking types
export type {
  TypeInstantiationInfo,
  MethodCallOnVariableInfo,
  InstantiationCallPattern,
} from './providers/cpp-provider.js';

// Import types for use in this file
import type {
  NativeExtractionResult,
  NativeFunctionBounds,
} from './language-provider.js';

import type {
  TypeInstantiationInfo,
  MethodCallOnVariableInfo,
  InstantiationCallPattern,
} from './providers/cpp-provider.js';

// ============================================================================
// Singleton C++ Provider Instance
// ============================================================================

let providerInstance: CppProvider | null = null;

export function getNativeTreeSitterProvider(): CppProvider {
  if (!providerInstance) {
    providerInstance = new CppProvider();
  }
  return providerInstance;
}

// ============================================================================
// Convenience Functions (Backward Compatibility)
// ============================================================================

/**
 * Extract calls from a function using native tree-sitter (0.5ms!)
 *
 * This is a backward compatibility wrapper that uses CppProvider internally.
 */
export function extractCallsNative(
  code: string,
  functionName: string,
  maxCalls: number = 100,
): NativeExtractionResult {
  return getNativeTreeSitterProvider().extractCallsFromFunction(
    code,
    functionName,
    maxCalls,
  );
}

/**
 * Find the function containing a line number using native tree-sitter
 *
 * This is a backward compatibility wrapper that uses CppProvider internally.
 */
export function findContainingFunctionNative(
  code: string,
  lineNumber: number,
): NativeFunctionBounds | undefined {
  return getNativeTreeSitterProvider().findContainingFunction(code, lineNumber);
}

/**
 * List all functions in code using native tree-sitter
 *
 * This is a backward compatibility wrapper that uses CppProvider internally.
 */
export function listFunctionsNative(code: string): NativeFunctionBounds[] {
  return getNativeTreeSitterProvider().listFunctions(code);
}

/**
 * Check if native tree-sitter is available
 *
 * This is a backward compatibility wrapper that uses CppProvider internally.
 */
export function isTreeSitterAvailable(): boolean {
  return getNativeTreeSitterProvider().isAvailable();
}

// ============================================================================
// Iterator Instantiation Tracking Functions (NEW)
// ============================================================================

/**
 * Find type instantiations in code (e.g., ClassName varName(...))
 *
 * Detects patterns like:
 * - Direct instantiation: `ClassName varName;` or `ClassName varName(...)`
 * - refp<>: `refp<ClassName> varName`
 * - make_refp<>: `auto varName = make_refp<ClassName>(...)`
 */
export function findTypeInstantiations(
  code: string,
  typeName: string,
): TypeInstantiationInfo[] {
  return getNativeTreeSitterProvider().findTypeInstantiations(code, typeName);
}

/**
 * Find method calls on a specific variable
 *
 * Detects both `varName.method()` and `varName->method()` patterns.
 * Optionally filters by method name and/or scope (line range).
 */
export function findMethodCallsOnVariable(
  code: string,
  variableName: string,
  methodName?: string,
  scopeStartLine?: number,
  scopeEndLine?: number,
): MethodCallOnVariableInfo[] {
  return getNativeTreeSitterProvider().findMethodCallsOnVariable(
    code,
    variableName,
    methodName,
    scopeStartLine,
    scopeEndLine,
  );
}

/**
 * Combined search: find instantiations of a type and calls to a method on those instances
 *
 * This is the main function for tracking iterator instantiation patterns.
 * For a pattern like:
 *   svm_kdb_iterator itr;
 *   itr.create_svm_key();
 *
 * Call: findInstantiationAndMethodCall(code, "svm_kdb_iterator", "create_svm_key")
 */
export function findInstantiationAndMethodCall(
  code: string,
  typeName: string,
  methodName: string,
): InstantiationCallPattern[] {
  return getNativeTreeSitterProvider().findInstantiationAndMethodCall(
    code,
    typeName,
    methodName,
  );
}

/**
 * AST-based verification: Check if a specific line contains an actual function call
 *
 * Returns:
 * - true: AST confirms there's a call to the symbol on/near this line
 * - false: AST confirms there's NO call to the symbol
 * - null: AST parsing failed or unavailable (use regex fallback)
 *
 * Much more accurate than regex because it uses the actual parse tree.
 */
export function isActualCallToSymbol(
  code: string,
  lineNum: number,
  symbol: string,
): boolean | null {
  return getNativeTreeSitterProvider().isActualCallToSymbol(
    code,
    lineNum,
    symbol,
  );
}

/**
 * Extract the actual callee name at a given line when searching for a symbol.
 *
 * For static method calls like `Class::method(...)`, returns `Class::method`.
 * For constructor calls like `Class var(...)`, returns `Class`.
 * Returns null if no call found or AST unavailable.
 *
 * This is useful for building accurate call graphs where we want to show
 * the specific method being called, not just the class name.
 */
export function extractActualCalleeAtLine(
  code: string,
  lineNum: number,
  symbol: string,
): string | null {
  return getNativeTreeSitterProvider().extractActualCalleeAtLine(
    code,
    lineNum,
    symbol,
  );
}
