/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * OpenGrok Search Tool
 *
 * Search ONTAP source code using OpenGrok.
 */

import { createTool } from '../lib/mastra-tool-shim.js';
import { z } from '../lib/zod-shim.js';
import { searchOpenGrok, DEFAULT_PROJECT } from '../lib/opengrok.js';
import { TOOL_DESCRIPTIONS } from '../prompts/index.js';
import { logTool } from '../lib/logger.js';
import { classifyError } from '../lib/errors.js';
import { getSymbolSuggestions } from '../lib/symbol-suggester.js';

// Helper: coerce null/empty string to undefined
const toUndefined = (v: string | null | undefined): string | undefined =>
  v === null || v === '' ? undefined : v;

/** Output schema for search results */
const SearchOutputSchema = z.object({
  success: z.boolean().describe('Whether the search succeeded'),
  count: z.number().optional().describe('Total number of matches found'),
  results: z
    .array(
      z.object({
        file: z.string().describe('File path'),
        matches: z
          .array(
            z.object({
              line: z
                .number()
                .optional()
                .describe(
                  'Line number of match (undefined for definition-only results)',
                ),
              text: z.string().describe('Matched line content'),
            }),
          )
          .describe('Matched lines with context'),
      }),
    )
    .optional()
    .describe('Search results (up to 15)'),
  didYouMean: z
    .array(
      z.object({
        symbol: z.string(),
        score: z.number(),
        source: z.string(),
        language: z.string().optional(),
      }),
    )
    .optional()
    .describe(
      'Symbol suggestions when no results found (semantic search fallback)',
    ),
  error: z.string().optional().describe('Error message if search failed'),
});

export const searchTool = createTool({
  id: 'search',
  description: TOOL_DESCRIPTIONS.search,
  mcp: {
    annotations: {
      title: 'OpenGrok Search',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },

  inputSchema: z.object({
    full: z
      .string()
      .nullish()
      .describe(
        "Full text search (Lucene syntax). Use simple keywords, NOT raw code. Avoid unmatched quotes/parens — they cause errors. Prefer 'definition' or 'symbol' for function names.",
      ),
    definition: z
      .string()
      .nullish()
      .describe('Find where a symbol is DEFINED (function, class, macro name)'),
    symbol: z
      .string()
      .nullish()
      .describe('Find all REFERENCES/usages of a symbol'),
    path: z.string().nullish().describe('Filter by file path pattern'),
    type: z
      .string()
      .nullish()
      .describe('Filter by file type (c, cxx, java, python, etc.)'),
    maxResults: z
      .number()
      .default(7)
      .describe(
        'Maximum results (keep ≤10 for agent use, ≤20 for interactive)',
      ),
    suggestOnEmpty: z
      .boolean()
      .optional()
      .describe(
        'When true and no results found, use semantic search to suggest similar symbols (Did You Mean?). Only enable for interactive/agent-facing calls, not internal tool chains.',
      ),
  }),

  outputSchema: SearchOutputSchema,

  execute: async (input) => {
    // Coerce null/empty to undefined for all optional string fields
    const full = toUndefined(input.full);
    const definition = toUndefined(input.definition);
    const symbol = toUndefined(input.symbol);
    const path = toUndefined(input.path);
    const type = toUndefined(input.type);
    const { maxResults, suggestOnEmpty } = input;
    const project = DEFAULT_PROJECT;

    const params = {
      full,
      definition,
      symbol,
      path,
      type,
      project,
      maxResults,
    };
    const invocationId = logTool.start('search', params);

    if (!full && !definition && !symbol && !path) {
      logTool.end(invocationId, { success: false, error: 'No search params' });
      return {
        success: false,
        error: 'At least one search parameter required',
      };
    }

    try {
      const { results, totalCount } = await searchOpenGrok({
        full,
        definition,
        symbol,
        path,
        type,
        project,
        maxResults,
      });

      logTool.step('search', 'raw results', {
        totalCount,
        rawCount: results.length,
      });

      // Clean output for agent consumption
      const output: z.infer<typeof SearchOutputSchema> = {
        success: true,
        count: totalCount,
        results: results.slice(0, 15).map((r) => ({
          file: r.file,
          matches: r.matches.slice(0, 3),
        })),
      };

      // "Did You Mean?" fallback: when no results and suggestOnEmpty is enabled
      if (
        totalCount === 0 &&
        suggestOnEmpty &&
        process.env.CLAUDE_CONTEXT_URL
      ) {
        const queryText = definition || symbol || full;
        if (queryText) {
          logTool.step('search', 'no results — trying semantic fallback', {
            queryText,
          });

          const suggestions = await getSymbolSuggestions(queryText, {
            timeoutMs: 5000,
            limit: 5,
            minScore: 0.3,
          });

          if (suggestions.length > 0) {
            output.didYouMean = suggestions.map((s) => ({
              symbol: s.symbol,
              score: Math.round(s.score * 1000) / 1000,
              source: s.source,
              language: s.language,
            }));

            logTool.step('search', 'semantic fallback found suggestions', {
              queryText,
              count: suggestions.length,
              topMatch: suggestions[0].symbol,
              topScore: suggestions[0].score.toFixed(3),
            });
          }
        }
      }

      // Log full result at DEBUG level for debugging
      logTool.result('search', output);
      // Log summary at INFO level
      logTool.end(invocationId, {
        success: true,
        resultCount: output.results?.length ?? 0,
      });
      return output;
    } catch (error) {
      const classified = classifyError(error);

      logTool.end(invocationId, {
        success: false,
        error: classified.message,
        errorType: classified.errorType,
      });
      return {
        success: false,
        error: classified.message,
        errorType: classified.errorType,
        retryable: classified.retryable,
      };
    }
  },
});
