/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
/**
 * Analyze Iterator Tool — native implementation.
 *
 * Unified analysis of ONTAP SMF iterators: schema, callers, field usage,
 * and _imp methods. Composes searchOpenGrok calls.
 */

import { createTool } from '../lib/mastra-tool-shim.js';
import { z } from '../lib/zod-shim.js';
import { TOOL_DESCRIPTIONS } from '../prompts/index.js';
import { logTool } from '../lib/logger.js';
import { classifyError } from '../lib/errors.js';
import { searchOpenGrok, getFileContent } from '../lib/opengrok.js';

async function findSmfSchema(iteratorName: string): Promise<any> {
  const tableName = iteratorName.replace(/_iterator$/, '');

  try {
    const { results } = await searchOpenGrok({
      path: `${tableName}.smf`,
      maxResults: 3,
    });

    if (results[0]?.file) {
      const content = await getFileContent(results[0].file);
      return {
        path: results[0].file,
        content: content?.content || null,
        tableName,
      };
    }
  } catch {
    // Fall through
  }

  return { path: null, content: null, tableName };
}

async function findIteratorCallers(
  iteratorName: string,
  maxCallers: number,
): Promise<any[]> {
  try {
    const { results } = await searchOpenGrok({
      symbol: iteratorName,
      maxResults: maxCallers,
    });
    return results.filter((r: any) => !r.file?.endsWith('.smf'));
  } catch {
    return [];
  }
}

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
      const { results } = await searchOpenGrok({
        definition: qualifiedName,
        maxResults: 2,
      });
      if (results.length > 0) {
        found.push({
          method,
          qualifiedName,
          file: results[0].file,
          line: results[0].matches?.[0]?.line,
        });
      }
    } catch {
      // Continue
    }
  }

  return found;
}

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
    iterator: z.string().describe('Iterator class name'),
    maxCallers: z.number().optional().default(10),
    maxDepth: z.number().optional().default(2),
    includeImpMethods: z.boolean().optional().default(true),
    verbose: z.boolean().optional().default(false),
    suggestOnEmpty: z.boolean().optional(),
  }),

  execute: async (input) => {
    const invocationId = logTool.start('analyze_iterator', input);
    const startTime = Date.now();

    try {
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
        callers: callers.slice(0, input.maxCallers ?? 10).map((c: any) => ({
          file: c.file,
          matches: c.matches.slice(0, 3),
        })),
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

      logTool.step(invocationId, 'complete', result);
      return result;
    } catch (error) {
      const classified = classifyError(error);
      logTool.step(invocationId, 'error', classified);
      return {
        success: false,
        error: classified.message,
        errorType: classified.type,
        retryable: classified.retryable,
      };
    }
  },
});
