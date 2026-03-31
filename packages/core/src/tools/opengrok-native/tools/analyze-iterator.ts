/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
/**
 * Analyze Iterator Tool — native implementation.
 *
 * Unified analysis of ONTAP SMF iterators: schema, callers, field usage,
 * and _imp methods. Composes OpenGrok search API calls.
 */

import { createTool } from '../lib/mastra-tool-shim.js';
import { z } from '../lib/zod-shim.js';
import { TOOL_DESCRIPTIONS } from '../prompts/index.js';
import { logTool } from '../lib/logger.js';
import { classifyError } from '../lib/errors.js';
import { makeOpenGrokRequest, getFileContent } from '../lib/opengrok.js';

/**
 * Find the SMF schema file for an iterator.
 */
async function findSmfSchema(iteratorName: string): Promise<any> {
  // Strip _iterator suffix to get table name
  const tableName = iteratorName.replace(/_iterator$/, '');

  try {
    const result = await makeOpenGrokRequest('search', {
      path: `${tableName}.smf`,
      maxresults: 3,
    });

    if (result?.results?.[0]?.path) {
      const content = await getFileContent(result.results[0].path);
      return {
        path: result.results[0].path,
        content: content?.content || null,
        tableName,
      };
    }
  } catch {
    // Fall through
  }

  return { path: null, content: null, tableName };
}

/**
 * Find callers of the iterator.
 */
async function findIteratorCallers(
  iteratorName: string,
  maxCallers: number,
): Promise<any[]> {
  try {
    const result = await makeOpenGrokRequest('search', {
      symbol: iteratorName,
      maxresults: maxCallers,
    });

    return (result?.results || [])
      .filter((r: any) => r.path && !r.path.endsWith('.smf'))
      .map((r: any) => ({
        file: r.path,
        matches: (r.matches || []).slice(0, 3).map((m: any) => ({
          line: m.lineNumber,
          text: (m.line || '').trim(),
        })),
      }));
  } catch {
    return [];
  }
}

/**
 * Find _imp method implementations.
 */
async function findImpMethods(iteratorName: string): Promise<any[]> {
  const impMethods = [
    'create_imp',
    'modify_imp',
    'remove_imp',
    'get_imp',
    'next_imp',
  ];
  const found: any[] = [];

  for (const method of impMethods) {
    const qualifiedName = `${iteratorName}::${method}`;
    try {
      const result = await makeOpenGrokRequest('search', {
        definition: qualifiedName,
        maxresults: 2,
      });

      if (result?.results?.length > 0) {
        found.push({
          method,
          qualifiedName,
          file: result.results[0].path,
          line: result.results[0].matches?.[0]?.lineNumber,
        });
      }
    } catch {
      // Continue
    }
  }

  return found;
}

/**
 * Extract field usage patterns from caller code.
 */
function analyzeFieldUsage(callers: any[]): Record<string, string[]> {
  const fieldUsage: Record<string, Set<string>> = {};

  for (const caller of callers) {
    for (const match of caller.matches || []) {
      const text = match.text || '';
      const methods = text.match(/(set_|get_|query_|want_)(\w+)/g);
      if (methods) {
        for (const m of methods) {
          if (!fieldUsage[m]) fieldUsage[m] = new Set();
          fieldUsage[m].add(caller.file);
        }
      }
    }
  }

  const result: Record<string, string[]> = {};
  for (const [method, files] of Object.entries(fieldUsage)) {
    result[method] = [...files];
  }
  return result;
}

export const analyzeIteratorTool = createTool({
  id: 'analyze_iterator',
  description: TOOL_DESCRIPTIONS.analyze_iterator,

  inputSchema: z.object({
    iterator: z
      .string()
      .describe(
        'Iterator class name (e.g., keymanager_keystore_enable_iterator)',
      ),
    maxCallers: z
      .number()
      .optional()
      .default(10)
      .describe('Maximum number of direct callers to analyze (default: 10)'),
    maxDepth: z
      .number()
      .optional()
      .default(2)
      .describe(
        'Call graph depth: 1=direct callers only, 2=include transitive',
      ),
    includeImpMethods: z
      .boolean()
      .optional()
      .default(true)
      .describe('Analyze *_imp methods (default: true)'),
    verbose: z
      .boolean()
      .optional()
      .default(false)
      .describe('Include source snippets and timing'),
    suggestOnEmpty: z
      .boolean()
      .optional()
      .describe('Suggest similar iterators when not found'),
  }),

  execute: async (input) => {
    const invocationId = logTool.start('analyze_iterator', input);
    const startTime = Date.now();

    try {
      // Parallel: schema + callers + imp methods
      const [schema, callers, impMethods] = await Promise.all([
        findSmfSchema(input.iterator),
        findIteratorCallers(input.iterator, input.maxCallers ?? 10),
        input.includeImpMethods !== false
          ? findImpMethods(input.iterator)
          : Promise.resolve([]),
      ]);

      const fieldUsage = analyzeFieldUsage(callers);
      const elapsed = Date.now() - startTime;

      const result = {
        success: true,
        iterator: input.iterator,
        tableName: schema.tableName,
        smfFile: schema.path,
        callers: callers.slice(0, input.maxCallers ?? 10),
        totalCallers: callers.length,
        impMethods,
        fieldUsage,
        ...(input.verbose
          ? {
              smfContent: schema.content?.substring(0, 2000),
              elapsedMs: elapsed,
            }
          : {}),
      };

      logTool.complete(invocationId, result);
      return result;
    } catch (error) {
      const classified = classifyError(error);
      logTool.error(invocationId, classified);
      return {
        success: false,
        error: classified.message,
        errorType: classified.type,
        retryable: classified.retryable,
      };
    }
  },
});
