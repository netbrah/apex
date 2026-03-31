/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
/**
 * Trace Call Chain Tool — native implementation.
 *
 * Bidirectional trace: function → tables → CLI commands.
 * Composes searchOpenGrok calls.
 */

import { createTool } from '../lib/mastra-tool-shim.js';
import { z } from '../lib/zod-shim.js';
import { TOOL_DESCRIPTIONS } from '../prompts/index.js';
import { logTool } from '../lib/logger.js';
import { classifyError } from '../lib/errors.js';
import { searchOpenGrok } from '../lib/opengrok.js';

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

async function findReferences(
  symbol: string,
  max: number = 15,
): Promise<any[]> {
  try {
    const { results } = await searchOpenGrok({ symbol, maxResults: max });
    return results;
  } catch {
    return [];
  }
}

function extractIteratorNames(references: any[]): string[] {
  const iterators = new Set<string>();
  for (const ref of references) {
    for (const match of ref.matches || []) {
      const text = match.text || '';
      const iterMatch = text.match(/(\w+_iterator)\b/g);
      if (iterMatch) iterMatch.forEach((i: string) => iterators.add(i));
    }
    // Also check file path
    const pathMatch = (ref.file || '').match(/(\w+_iterator)/);
    if (pathMatch) iterators.add(pathMatch[1]);
  }
  return [...iterators];
}

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

      const refs = await findReferences(sym, 10);

      for (const ref of refs) {
        if (ref.file?.includes('.smf') || ref.file?.includes('_iterator')) {
          cliTriggers.push({
            symbol: sym,
            file: ref.file,
            depth: depth + 1,
            matches: ref.matches.slice(0, 3),
          });
        }

        for (const m of ref.matches || []) {
          const funcMatch = (m.text || '').match(/(\w+(?:::\w+)*)\s*\(/);
          if (funcMatch && !visited.has(funcMatch[1])) {
            nextSymbols.push(funcMatch[1]);
          }
        }
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
    symbol: z.string().describe('Function or iterator method to trace'),
    maxDepth: z.number().optional().default(2),
    verbose: z.boolean().optional().default(true),
    suggestOnEmpty: z.boolean().optional(),
  }),

  execute: async (input) => {
    const invocationId = logTool.start('trace_call_chain', input);
    const startTime = Date.now();

    try {
      const [definition, references] = await Promise.all([
        findDefinition(input.symbol),
        findReferences(input.symbol, 15),
      ]);

      const iterators = extractIteratorNames(references);
      const cliTriggers = await findCliTriggers(
        input.symbol,
        input.maxDepth ?? 2,
      );

      const elapsed = Date.now() - startTime;
      const result = {
        success: true,
        function: {
          name: input.symbol,
          file: definition?.file || null,
          line: definition?.matches?.[0]?.line || null,
        },
        iteratorsDiscovered: iterators,
        cliTriggers,
        upstreamCallers: references.map((r: any) => ({
          file: r.file,
          matches: r.matches.slice(0, 3),
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
