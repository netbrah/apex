/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Semantic symbol-suggestion fallback shim.
 *
 * Native core-tool mode keeps this optional; when not configured, we return no
 * suggestions instead of failing the primary deterministic OpenGrok flow.
 */

export interface SymbolSuggestion {
  symbol: string;
  score: number;
  source: string;
  language?: string;
}

export interface SuggestOptions {
  limit?: number;
  minScore?: number;
  timeoutMs?: number;
  searchLimit?: number;
}

export async function getSymbolSuggestions(
  _query: string,
  _options?: SuggestOptions,
): Promise<SymbolSuggestion[]> {
  return [];
}
