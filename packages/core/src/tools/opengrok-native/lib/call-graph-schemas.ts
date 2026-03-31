/* eslint-disable */
// @ts-nocheck
/**
 * Call Graph schemas for vendored OpenGrok-native tools.
 *
 * Adapted from opengrokmcp/src/lib/call-graph-schemas.ts
 * Uses zod-shim instead of real zod.
 */

import { z } from './zod-shim.js';

// ============================================================================
// Confidence & Classification
// ============================================================================

export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type SymbolKind =
  | 'function'
  | 'method'
  | 'constructor'
  | 'callback'
  | 'iterator'
  | 'macro'
  | 'unknown';
export type RelationType = 'direct' | 'transitive' | 'callback' | 'virtual';

// ============================================================================
// Core Types
// ============================================================================

export interface SymbolLocation {
  file: string;
  line?: number;
  module?: string;
}

export interface CodeContext {
  signature?: string;
  snippet?: string;
  callSite?: string;
  docstring?: string;
  functionBody?: string;
  startLine?: number;
  endLine?: number;
}

export interface SymbolRef {
  name: string;
  qualifiedName?: string;
  targetSymbol?: string;
  location?: SymbolLocation;
  kind?: SymbolKind;
  confidence?: ConfidenceLevel;
  sameModule?: boolean;
  moduleAffinity?: number;
  codeContext?: CodeContext;
}

export interface CallRelation {
  symbol: SymbolRef;
  relationType?: RelationType;
  depth: number;
  path?: string[];
}

export interface NoiseEntry {
  name: string;
  file?: string;
  reason: string;
  moduleAffinity?: number;
}

// ============================================================================
// Main Output Schema (as a zod-shim object for compatibility)
// ============================================================================

export const StructuredCallGraph = z.object({
  symbol: z.string(),
  timestamp: z.string(),
  depth: z.number(),
  direction: z.string(),
  definition: z.object({
    file: z.string(),
    line: z.number(),
    module: z.string(),
  }),
  definitionContext: z.object({}),
  kind: z.string(),
  language: z.string(),
  directCallers: z.array(z.object({})),
  directCallees: z.array(z.object({})),
  transitiveCallers: z.array(z.object({})),
  transitiveCallees: z.array(z.object({})),
  entryPoints: z.array(z.object({})),
  callPaths: z.array(z.array(z.string())),
  noise: z.array(z.object({})),
  stats: z.object({}),
});

// ============================================================================
// Helper Functions
// ============================================================================

export function extractModule(filePath: string): string {
  const parts = filePath.split('/').filter(Boolean);
  const moduleIndicators = ['src', 'lib', 'include', 'tables', 'handlers'];
  for (let i = parts.length - 2; i >= 0; i--) {
    if (moduleIndicators.includes(parts[i])) {
      return parts.slice(0, i + 1).join('/');
    }
  }
  return parts.slice(0, -1).join('/');
}

export function calculateConfidence(
  affinity: number,
  sameModule: boolean,
  isGenericName: boolean,
): ConfidenceLevel {
  if (isGenericName && affinity < 25) return 'low';
  if (sameModule || affinity >= 50) return 'high';
  if (affinity >= 25) return 'medium';
  return 'low';
}

export function isGenericName(name: string): boolean {
  const genericPatterns = [
    /^(get|set|is|has|can|do|on)_?\w*$/i,
    /^(init|create|destroy|delete|remove|add|update|clear)$/i,
    /^(ok|err|error|result|status|value|data|info)$/i,
    /^(itr|iter|iterator|callback|handler)$/i,
    /^_?imp$/,
    /^__\w+__$/,
    /^(self|cls|args|kwargs)$/,
  ];
  return genericPatterns.some((p) => p.test(name));
}

export function isNoiseFile(
  filePath: string,
  entryModule: string,
): string | null {
  const path = filePath.toLowerCase();
  const isTopLevelExternal =
    /^\/external\//i.test(path) || /^\/vendor\//i.test(path);
  if (
    path.includes('/third_party/') ||
    isTopLevelExternal ||
    path.includes('/site-packages/') ||
    path.includes('/bsd99/') ||
    path.includes('/loader/') ||
    path.includes('/gdb/')
  ) {
    return 'wrong_module';
  }
  if (
    path.includes('/offtap/deploy/') ||
    path.includes('/offtap/sdk/') ||
    path.includes('/kms_emulators')
  ) {
    return 'wrong_module';
  }
  if (path.includes('brotli')) return 'wrong_module';

  const isTestFile =
    path.includes('/test/') ||
    path.includes('/tests/') ||
    path.endsWith('.ut') ||
    path.endsWith('_test.py') ||
    path.endsWith('_test.cc') ||
    path.endsWith('_test.cpp');
  if (isTestFile) {
    if (entryModule) {
      const entrySubsystem = entryModule.split('/')[0];
      const pathSubsystem = path.replace(/^\//, '').split('/')[0];
      if (entrySubsystem && pathSubsystem && entrySubsystem === pathSubsystem) {
        return null;
      }
    }
    return 'test_file';
  }
  if (path.endsWith('.ksmdb.h') && !path.includes('adapter'))
    return 'generated_code';
  if (path.includes('__pycache__') || path.endsWith('.pyc'))
    return 'generated_code';
  if (!entryModule) return null;

  const getTopModule = (p: string): string => {
    const parts = p.replace(/^\//, '').split('/').filter(Boolean);
    return parts[0] || '';
  };
  const entryTop = getTopModule(entryModule.toLowerCase());
  const fileTop = getTopModule(path);
  if (entryTop && fileTop && entryTop === fileTop) return null;
  const infraModules = ['bsd99', 'loader', 'tools', 'gdb', 'foundation'];
  if (infraModules.includes(fileTop)) return 'wrong_module';
  return null;
}

export function inferSymbolKind(name: string, lineText?: string): SymbolKind {
  const nameLower = name.toLowerCase();
  if (nameLower.startsWith('__') && nameLower.endsWith('__')) return 'method';
  if (nameLower.startsWith('_')) return 'method';
  if (nameLower.includes('callback') || nameLower.endsWith('Impl'))
    return 'callback';
  if (nameLower.includes('itr') || nameLower.includes('iter'))
    return 'iterator';
  if (nameLower.endsWith('_imp')) return 'method';
  if (lineText?.includes('#define')) return 'macro';
  if (lineText?.includes('::') && !lineText.includes('std::')) return 'method';
  if (lineText?.includes('@staticmethod') || lineText?.includes('@classmethod'))
    return 'method';
  if (lineText?.includes('@property')) return 'method';
  return 'function';
}

export function validateCallGraph(data: unknown): any {
  return data;
}

export function safeParseCallGraph(data: unknown): {
  success: boolean;
  data?: any;
  errors?: any;
} {
  return { success: true, data };
}
