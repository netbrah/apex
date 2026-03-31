/* eslint-disable */
// @ts-nocheck
/**
 * Shared Function Detection Logic for vendored OpenGrok-native tools.
 *
 * Adapted from opengrokmcp/src/lib/function-detection.ts
 */

import { CALL_SKIP_LIST } from '../prompts/index.js';
import {
  findContainingFunctionNative,
  isTreeSitterAvailable,
} from './tree-sitter-native.js';

// ============================================================================
// Types
// ============================================================================

export interface LanguageConfig {
  type: string;
  extensions: string[];
  functionNamePatterns: RegExp[];
  skipSymbols: Set<string>;
}

export interface FunctionLocation {
  name: string;
  qualifiedName?: string;
  startLine: number;
  endLine: number;
}

// ============================================================================
// Language Configurations
// ============================================================================

export const LANGUAGE_CONFIGS: Record<string, LanguageConfig> = {
  c: {
    type: 'c',
    extensions: ['.c', '.h'],
    functionNamePatterns: [
      /^\s*(?:static\s+)?(?:inline\s+)?(?:const\s+)?(?:unsigned\s+)?(?:\w+(?:\s*\*+)?)\s+(\w+)\s*\(/,
    ],
    skipSymbols: new Set([
      ...CALL_SKIP_LIST,
      'malloc',
      'free',
      'memcpy',
      'memset',
      'strlen',
      'strcpy',
      'printf',
      'fprintf',
    ]),
  },
  cxx: {
    type: 'cxx',
    extensions: ['.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx', '.h'],
    functionNamePatterns: [
      /^\s*(?:template\s*<[^>]*>\s*)?(?:[\w:<>\*&\s]+?)\s+(\w+)::(\w+)\s*\(/,
      /^\s*(?:static\s+)?(?:inline\s+)?(?:[\w:<>\*&\s]+?)\s+(\w+)\s*\([^;]*$/,
    ],
    skipSymbols: new Set([
      ...CALL_SKIP_LIST,
      'std::move',
      'std::forward',
      'traceEntry',
      'traceExit',
      'traceExitRet',
      'traceError',
      'traceDebug',
      'traceLog',
      'traceEntryNoTiming',
      'logSmdbErrOnExit',
      'dynamic_cast',
      'static_cast',
      'reinterpret_cast',
      'const_cast',
      'BOOST_AUTO_TEST_CASE',
      'TEST_F',
      'TEST',
      'BOOST_FIXTURE_TEST_CASE',
      'smdb_enum',
      'smdb_type',
      'std',
      'smf',
      'smdb',
    ]),
  },
  python: {
    type: 'python',
    extensions: ['.py'],
    functionNamePatterns: [/^\s*(?:async\s+)?def\s+(\w+)\s*\(/],
    skipSymbols: new Set([
      ...CALL_SKIP_LIST,
      'print',
      'len',
      'range',
      'str',
      'int',
      'float',
      'list',
      'dict',
      'set',
      'tuple',
      'isinstance',
      'hasattr',
      'getattr',
      'setattr',
      'super',
      'type',
      'open',
      'close',
    ]),
  },
  perl: {
    type: 'perl',
    extensions: ['.pl', '.pm', '.thpl'],
    functionNamePatterns: [/^\s*sub\s+(\w+)\s*(?:\([^)]*\))?\s*\{?/],
    skipSymbols: new Set([
      ...CALL_SKIP_LIST,
      'print',
      'printf',
      'say',
      'warn',
      'die',
    ]),
  },
  java: {
    type: 'java',
    extensions: ['.java'],
    functionNamePatterns: [
      /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?(?:[\w<>\[\]]+\s+)+(\w+)\s*\(/,
    ],
    skipSymbols: new Set([...CALL_SKIP_LIST, 'toString', 'equals', 'hashCode']),
  },
  golang: {
    type: 'golang',
    extensions: ['.go'],
    functionNamePatterns: [/^\s*func\s+(?:\([^)]+\)\s*)?(\w+)\s*\(/],
    skipSymbols: new Set([...CALL_SKIP_LIST, 'fmt.Println', 'fmt.Printf']),
  },
  javascript: {
    type: 'javascript',
    extensions: ['.js', '.ts', '.tsx', '.jsx'],
    functionNamePatterns: [
      /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/,
      /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/,
      /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/,
    ],
    skipSymbols: new Set([...CALL_SKIP_LIST, 'console.log', 'console.error']),
  },
};

// ============================================================================
// Language Detection
// ============================================================================

export function getLanguageConfig(
  filePath: string,
): LanguageConfig | undefined {
  const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
  for (const config of Object.values(LANGUAGE_CONFIGS)) {
    if (config.extensions.includes(ext)) return config;
  }
  return undefined;
}

export function matchesFileType(
  filePath: string,
  expectedType: string | undefined,
): boolean {
  if (!expectedType) return true;
  const config = getLanguageConfig(filePath);
  if (!config) return false;
  if (expectedType === 'c' || expectedType === 'cxx') {
    return config.type === 'c' || config.type === 'cxx';
  }
  return config.type === expectedType;
}

// ============================================================================
// Function Detection
// ============================================================================

function findFunctionEnd(lines: string[], startIdx: number): number {
  let braceCount = 0;
  let foundOpen = false;
  for (let j = startIdx; j < lines.length && j < startIdx + 500; j++) {
    for (const char of lines[j]) {
      if (char === '{') {
        braceCount++;
        foundOpen = true;
      }
      if (char === '}') braceCount--;
    }
    if (foundOpen && braceCount === 0) return j + 1;
  }
  return startIdx + 1;
}

export function findFunctionsInCode(
  code: string,
  langConfig: LanguageConfig,
): FunctionLocation[] {
  const functions: FunctionLocation[] = [];
  const lines = code.split('\n');
  const isPython = langConfig.type === 'python';
  const isCxx = langConfig.type === 'cxx';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      (isPython && trimmed.startsWith('#'))
    )
      continue;

    if (isCxx) {
      const methodMatch = line.match(/(\w+)::(\w+)\s*\(/);
      if (methodMatch) {
        const className = methodMatch[1];
        const methodName = methodMatch[2];
        if (
          ['smdb_enum', 'smdb_type', 'std', 'smf', 'smdb'].includes(className)
        )
          continue;
        const beforeMatch = line.substring(0, line.indexOf(methodMatch[0]));
        if (
          beforeMatch.includes('(') ||
          beforeMatch.includes('=') ||
          beforeMatch.includes('return ') ||
          beforeMatch.includes('if ') ||
          beforeMatch.includes('while ') ||
          trimmed.endsWith(';') ||
          trimmed.endsWith(',')
        )
          continue;
        const qualifiedName = `${className}::${methodName}`;
        const startLine = i + 1;
        const endLine = findFunctionEnd(lines, i);
        if (endLine > startLine) {
          functions.push({
            name: methodName,
            qualifiedName,
            startLine,
            endLine,
          });
          continue;
        }
      }
    }

    if (!isCxx) {
      for (const pattern of langConfig.functionNamePatterns) {
        const match = line.match(pattern);
        if (match) {
          const captures = match.slice(1).filter(Boolean);
          const funcName = captures[captures.length - 1];
          if (
            !funcName ||
            ['if', 'while', 'for', 'switch', 'catch'].includes(funcName)
          )
            continue;
          const startLine = i + 1;
          let endLine = startLine;
          if (isPython) {
            const defIndent = line.search(/\S/);
            for (let j = i + 1; j < lines.length && j < i + 1000; j++) {
              const nextLine = lines[j];
              const nextTrimmed = nextLine.trim();
              if (!nextTrimmed || nextTrimmed.startsWith('#')) continue;
              const nextIndent = nextLine.search(/\S/);
              if (nextIndent <= defIndent) {
                endLine = j;
                break;
              }
              endLine = j + 1;
            }
          } else {
            endLine = findFunctionEnd(lines, i);
          }
          functions.push({ name: funcName, startLine, endLine });
          break;
        }
      }
    }
  }

  const seen = new Set<string>();
  return functions
    .filter((f) => {
      const key = `${f.qualifiedName || f.name}@${f.startLine}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.startLine - b.startLine);
}

export function findContainingFunction(
  code: string,
  lineNumber: number,
  langConfig: LanguageConfig,
): FunctionLocation | undefined {
  const functions = findFunctionsInCode(code, langConfig);
  for (const func of functions) {
    if (lineNumber >= func.startLine && lineNumber <= func.endLine) return func;
  }
  return undefined;
}

export function findContainingFunctionAuto(
  code: string,
  lineNumber: number,
  langConfig?: LanguageConfig,
): FunctionLocation | undefined {
  if (isTreeSitterAvailable()) {
    try {
      const nativeResult = findContainingFunctionNative(code, lineNumber);
      if (nativeResult)
        return {
          name: nativeResult.name,
          qualifiedName: nativeResult.qualifiedName,
          startLine: nativeResult.startLine,
          endLine: nativeResult.endLine,
        };
    } catch {
      /* fallthrough */
    }
  }
  if (!langConfig) {
    if (code.includes('def ') && code.includes(':'))
      langConfig = LANGUAGE_CONFIGS['python'];
    else if (code.includes('::') || code.includes('#include'))
      langConfig = LANGUAGE_CONFIGS['cxx'];
    else langConfig = LANGUAGE_CONFIGS['cxx'];
  }
  return findContainingFunction(code, lineNumber, langConfig);
}
