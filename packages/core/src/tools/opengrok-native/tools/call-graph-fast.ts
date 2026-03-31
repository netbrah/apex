/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
/**
 * Call Graph Fast Tool — native implementation.
 *
 * Builds upstream call graphs by composing OpenGrok search API calls.
 * Uses makeOpenGrokRequest to find callers via symbol search, then
 * recursively traces upstream.
 */

import { createTool } from '../lib/mastra-tool-shim.js';
import { z } from '../lib/zod-shim.js';
import { TOOL_DESCRIPTIONS } from '../prompts/index.js';
import { logTool } from '../lib/logger.js';
import { classifyError } from '../lib/errors.js';
import { makeOpenGrokRequest } from '../lib/opengrok.js';

/**
 * Find callers of a symbol using OpenGrok symbol search.
 */
async function findCallers(
  symbol: string,
  pathFilter?: string,
  maxCallers: number = 10,
): Promise<any[]> {
  const params: Record<string, unknown> = {
    symbol,
    maxresults: maxCallers,
  };
  if (pathFilter) {
    params.path = pathFilter;
  }

  try {
    const result = await makeOpenGrokRequest('search', params);
    if (!result?.results) return [];

    return result.results
      .filter((r: any) => r.path !== undefined)
      .slice(0, maxCallers)
      .map((r: any) => ({
        file: r.path,
        matches: (r.matches || []).map((m: any) => ({
          line: m.lineNumber,
          text: (m.line || '').trim(),
        })),
      }));
  } catch {
    return [];
  }
}

/**
 * Build a call graph by BFS traversal of callers.
 */
async function buildCallGraph(
  symbol: string,
  maxDepth: number,
  maxCallers: number,
  pathFilter?: string,
  filterNoise: boolean = true,
): Promise<any> {
  const noisePatterns = [
    /^std::/,
    /^trace/i,
    /^log/i,
    /^debug/i,
    /^assert/i,
    /^ON_SCOPE_EXIT/,
  ];

  const visited = new Set<string>();
  const graph: any = {
    root: symbol,
    depth: maxDepth,
    callers: [],
  };

  let currentLevel = [symbol];

  for (let depth = 0; depth < maxDepth && currentLevel.length > 0; depth++) {
    const nextLevel: string[] = [];

    for (const sym of currentLevel) {
      if (visited.has(sym)) continue;
      visited.add(sym);

      const callers = await findCallers(sym, pathFilter, maxCallers);

      for (const caller of callers) {
        const callerInfo = {
          symbol: sym,
          file: caller.file,
          depth: depth + 1,
          callSites: caller.matches,
        };

        if (filterNoise) {
          const isNoise = caller.matches.every((m: any) =>
            noisePatterns.some((p) => p.test(m.text)),
          );
          if (isNoise) continue;
        }

        graph.callers.push(callerInfo);

        // Extract function names from call sites for next level
        for (const m of caller.matches) {
          const funcMatch = m.text.match(/(\w+(?:::\w+)*)\s*\(/);
          if (funcMatch && !visited.has(funcMatch[1])) {
            nextLevel.push(funcMatch[1]);
          }
        }
      }
    }

    currentLevel = [...new Set(nextLevel)].slice(0, maxCallers);
  }

  return graph;
}

export const callGraphFastTool = createTool({
  id: 'call_graph_fast',
  description: TOOL_DESCRIPTIONS.call_graph_fast,

  inputSchema: z.object({
    symbol: z.string().describe('Entry point function to find callers for'),
    max_depth: z
      .number()
      .optional()
      .default(1)
      .describe('Maximum depth to traverse upstream (default: 1, max: 3)'),
    max_callers: z
      .number()
      .optional()
      .default(10)
      .describe('Maximum callers to find per level (default: 10)'),
    format: z
      .enum(['mermaid', 'structured', 'all'])
      .optional()
      .default('structured')
      .describe('Output format'),
    filter_noise: z
      .boolean()
      .optional()
      .default(true)
      .describe('Filter out noise functions like traceError, std::*'),
    path_filter: z
      .string()
      .optional()
      .describe('Only include callers from files matching this path'),
    include_code: z
      .boolean()
      .optional()
      .default(true)
      .describe('Include code snippets in output'),
    track_instantiations: z
      .boolean()
      .optional()
      .default(false)
      .describe('Search for iterator instantiation patterns'),
    verbose: z
      .boolean()
      .optional()
      .default(false)
      .describe('Include timing stats and debug info'),
    references: z
      .boolean()
      .optional()
      .default(false)
      .describe('Return flat file:line references array'),
    suggestOnEmpty: z
      .boolean()
      .optional()
      .describe('Suggest similar symbols when no results found'),
  }),

  execute: async (input) => {
    const invocationId = logTool.start('call_graph_fast', input);
    const startTime = Date.now();

    try {
      const graph = await buildCallGraph(
        input.symbol,
        Math.min(input.max_depth ?? 1, 3),
        input.max_callers ?? 10,
        input.path_filter,
        input.filter_noise ?? true,
      );

      const elapsed = Date.now() - startTime;
      const result = {
        success: true,
        symbol: input.symbol,
        totalCallers: graph.callers.length,
        graph,
        ...(input.verbose ? { elapsedMs: elapsed } : {}),
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
