/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
/**
 * Call Graph Fast Tool — native implementation.
 *
 * Builds upstream call graphs by composing searchOpenGrok calls.
 * Uses symbol search to find callers, then BFS traversal upstream.
 */

import { createTool } from '../lib/mastra-tool-shim.js';
import { z } from '../lib/zod-shim.js';
import { TOOL_DESCRIPTIONS } from '../prompts/index.js';
import { logTool } from '../lib/logger.js';
import { classifyError } from '../lib/errors.js';
import { searchOpenGrok } from '../lib/opengrok.js';

async function findCallers(
  symbol: string,
  pathFilter?: string,
  maxCallers: number = 10,
): Promise<any[]> {
  try {
    const { results } = await searchOpenGrok({
      symbol,
      path: pathFilter,
      maxResults: maxCallers,
    });
    return results.slice(0, maxCallers);
  } catch {
    return [];
  }
}

async function findDefinition(symbol: string): Promise<any> {
  try {
    const { results } = await searchOpenGrok({
      definition: symbol,
      maxResults: 3,
    });
    return results[0] || null;
  } catch {
    return null;
  }
}

const NOISE_PATTERNS = [
  /^std::/,
  /^trace/i,
  /^log/i,
  /^debug/i,
  /^assert/i,
  /^ON_SCOPE_EXIT/,
];

async function buildCallGraph(
  symbol: string,
  maxDepth: number,
  maxCallers: number,
  pathFilter?: string,
  filterNoise: boolean = true,
): Promise<any> {
  const visited = new Set<string>();
  const graph: any = {
    root: symbol,
    depth: maxDepth,
    definition: await findDefinition(symbol),
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
        if (filterNoise) {
          const isNoise = caller.matches.every((m: any) =>
            NOISE_PATTERNS.some((p) => p.test(m.text || '')),
          );
          if (isNoise) continue;
        }

        graph.callers.push({
          symbol: sym,
          file: caller.file,
          depth: depth + 1,
          callSites: caller.matches.slice(0, 5),
        });

        // Extract containing function names for next BFS level
        for (const m of caller.matches) {
          const funcMatch = (m.text || '').match(/(\w+(?:::\w+)*)\s*\(/);
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
    max_depth: z.number().optional().default(1),
    max_callers: z.number().optional().default(10),
    format: z
      .enum(['mermaid', 'structured', 'all'])
      .optional()
      .default('structured'),
    filter_noise: z.boolean().optional().default(true),
    path_filter: z.string().optional(),
    include_code: z.boolean().optional().default(true),
    track_instantiations: z.boolean().optional().default(false),
    verbose: z.boolean().optional().default(false),
    references: z.boolean().optional().default(false),
    suggestOnEmpty: z.boolean().optional(),
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
        definition: graph.definition,
        totalCallers: graph.callers.length,
        graph,
        ...(input.verbose ? { elapsedMs: elapsed } : {}),
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
