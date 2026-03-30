/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Live OpenGrok verification for vendored native tools.
 *
 * Run manually with:
 *   OPENGROK_LIVE=1 npx vitest run packages/core/src/tools/opengrok-native/opengrok.live.test.ts
 */

import { describe, expect, it } from 'vitest';
import { searchTool } from './tools/search.js';
import { getFileTool } from './tools/get-file.js';
import { analyzeSymbolAstTool } from './tools/analyze-symbol-ast.js';

const RUN_LIVE = process.env.OPENGROK_LIVE === '1';
const describeLive = RUN_LIVE ? describe : describe.skip;

describeLive('OpenGrok Native Tools (live)', () => {
  it('search returns real OpenGrok matches', async () => {
    const result = await searchTool.execute({
      definition: 'deleteKeyFromLocalCryptomod',
      maxResults: 5,
    });

    expect(result.success).toBe(true);
    expect((result.count ?? 0) > 0).toBe(true);
    expect(result.results?.length).toBeGreaterThan(0);
  }, 120_000);

  it('get_file reads content from OpenGrok', async () => {
    const search = await searchTool.execute({
      definition: 'deleteKeyFromLocalCryptomod',
      maxResults: 1,
    });
    const target = search.results?.[0]?.file;
    expect(target).toBeTruthy();

    const result = await getFileTool.execute({
      filePath: target as string,
      maxLines: 120,
    });

    expect(result.success).toBe(true);
    expect((result.content ?? '').length).toBeGreaterThan(0);
    expect((result.totalLines ?? 0) > 0).toBe(true);
  }, 120_000);

  it('analyze_symbol_ast resolves definition + callers/callees', async () => {
    const result = await analyzeSymbolAstTool.execute({
      symbol: 'deleteKeyFromLocalCryptomod',
      maxCallers: 5,
      maxCallees: 10,
      includeSource: true,
      contextLines: 30,
      includeTests: false,
      maxTestCallers: 0,
      verbose: false,
    });

    expect(result.success).toBe(true);
    expect(result.definition?.file).toBeTruthy();
    expect(Array.isArray(result.callers)).toBe(true);
    expect(Array.isArray(result.callees)).toBe(true);
  }, 180_000);
});
