/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
/**
 * Trace Call Chain Tool — native implementation.
 *
 * Bidirectional trace: function → tables → CLI commands.
 * Composes OpenGrok search API calls to find downstream tables
 * and upstream CLI entry points.
 */

import { createTool } from '../lib/mastra-tool-shim.js';
import { z } from '../lib/zod-shim.js';
import { TOOL_DESCRIPTIONS } from '../prompts/index.js';
import { logTool } from '../lib/logger.js';
import { classifyError } from '../lib/errors.js';
import { makeOpenGrokRequest } from '../lib/opengrok.js';

/**
 * Search for a symbol's definition and callees.
 */
async function findSymbolInfo(symbol: string): Promise<any> {
  try {
    const defResult = await makeOpenGrokRequest('search', {
      definition: symbol,
      maxresults: 3,
    });

    const refResult = await makeOpenGrokRequest('search', {
      symbol,
      maxresults: 15,
    });

    return {
      definition: defResult?.results?.[0] || null,
      references: refResult?.results || [],
    };
  } catch {
    return { definition: null, references: [] };
  }
}

/**
 * Find iterator tables by looking for _iterator suffix patterns.
 */
function extractIteratorNames(references: any[]): string[] {
  const iterators = new Set<string>();
  for (const ref of references) {
    for (const match of ref.matches || []) {
      const text = match.line || '';
      const iterMatch = text.match(/(\w+_iterator)\b/g);
      if (iterMatch) {
        iterMatch.forEach((i: string) => iterators.add(i));
      }
    }
  }
  return [...iterators];
}

/**
 * Find CLI commands by searching for command strings near iterator usage.
 */
async function findCliTriggers(
  symbol: string,
  maxDepth: number,
): Promise<any[]> {
  const cliTriggers: any[] = [];
  const visited = new Set<string>();
  let currentSymbols = [symbol];

  for (let depth = 0; depth < maxDepth && currentSymbols.length > 0; depth++) {
    const nextSymbols: string[] = [];

    for (const sym of currentSymbols) {
      if (visited.has(sym)) continue;
      visited.add(sym);

      try {
        const result = await makeOpenGrokRequest('search', {
          symbol: sym,
          maxresults: 10,
        });

        for (const ref of result?.results || []) {
          // Check if this is a CLI/iterator entry point
          if (ref.path?.includes('.smf') || ref.path?.includes('_iterator')) {
            cliTriggers.push({
              symbol: sym,
              file: ref.path,
              depth: depth + 1,
              matches: (ref.matches || []).map((m: any) => ({
                line: m.lineNumber,
                text: (m.line || '').trim(),
              })),
            });
          }

          // Extract function names for next depth
          for (const m of ref.matches || []) {
            const funcMatch = (m.line || '').match(/(\w+(?:::\w+)*)\s*\(/);
            if (funcMatch && !visited.has(funcMatch[1])) {
              nextSymbols.push(funcMatch[1]);
            }
          }
        }
      } catch {
        // Continue on search failures
      }
    }

    currentSymbols = [...new Set(nextSymbols)].slice(0, 10);
  }

  return cliTriggers;
}

export const traceCallChainTool = createTool({
  id: 'trace_call_chain',
  description: TOOL_DESCRIPTIONS.trace_call_chain,

  inputSchema: z.object({
    symbol: z
      .string()
      .describe(
        'Function or iterator method to trace (e.g., "pushKeyToKmipServerForced")',
      ),
    maxDepth: z
      .number()
      .optional()
      .default(2)
      .describe('Maximum depth to trace upstream (default: 2)'),
    verbose: z
      .boolean()
      .optional()
      .default(true)
      .describe('Full output with callers/callees arrays'),
    suggestOnEmpty: z
      .boolean()
      .optional()
      .describe('Suggest similar symbols when no results found'),
  }),

  execute: async (input) => {
    const invocationId = logTool.start('trace_call_chain', input);
    const startTime = Date.now();

    try {
      const symbolInfo = await findSymbolInfo(input.symbol);
      const iterators = extractIteratorNames(symbolInfo.references);
      const cliTriggers = await findCliTriggers(
        input.symbol,
        input.maxDepth ?? 2,
      );

      const elapsed = Date.now() - startTime;
      const result = {
        success: true,
        function: {
          name: input.symbol,
          file: symbolInfo.definition?.path || null,
          line: symbolInfo.definition?.matches?.[0]?.lineNumber || null,
        },
        iteratorsDiscovered: iterators,
        cliTriggers,
        upstreamCallers: symbolInfo.references
          .filter((r: any) => r.path)
          .map((r: any) => ({
            file: r.path,
            matches: (r.matches || []).slice(0, 3).map((m: any) => ({
              line: m.lineNumber,
              text: (m.line || '').trim(),
            })),
          })),
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
