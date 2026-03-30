/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ToolErrorType } from './tool-error.js';
import {
  OpenGrokAnalyzeSymbolAstTool,
  OpenGrokGetFileTool,
  OpenGrokSearchTool,
} from './opengrok-tools.js';
import { searchTool } from './opengrok-native/tools/search.js';
import { getFileTool } from './opengrok-native/tools/get-file.js';
import { analyzeSymbolAstTool } from './opengrok-native/tools/analyze-symbol-ast.js';

vi.mock('./opengrok-native/tools/search.js', () => ({
  searchTool: {
    execute: vi.fn(),
  },
}));

vi.mock('./opengrok-native/tools/get-file.js', () => ({
  getFileTool: {
    execute: vi.fn(),
  },
}));

vi.mock('./opengrok-native/tools/analyze-symbol-ast.js', () => ({
  analyzeSymbolAstTool: {
    execute: vi.fn(),
  },
}));

describe('OpenGrokTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes native search tool and returns JSON payload', async () => {
    vi.mocked(searchTool.execute).mockResolvedValue({
      success: true,
      count: 1,
      results: [
        {
          file: '/security/keymanager/keymanager_utils.cc',
          matches: [{ line: 101, text: 'deleteKeyFromLocalCryptomod();' }],
        },
      ],
    });

    const tool = new OpenGrokSearchTool();
    const invocation = tool.build({
      definition: 'deleteKeyFromLocalCryptomod',
      maxResults: 5,
    });
    const result = await invocation.execute(new AbortController().signal);

    expect(searchTool.execute).toHaveBeenCalledWith({
      definition: 'deleteKeyFromLocalCryptomod',
      maxResults: 5,
    });
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('"success":true');
    expect(result.llmContent).toContain('deleteKeyFromLocalCryptomod');
  });

  it('returns execution_failed error when native search throws', async () => {
    vi.mocked(searchTool.execute).mockRejectedValue(
      new Error('OpenGrok unavailable'),
    );

    const tool = new OpenGrokSearchTool();
    const invocation = tool.build({ symbol: 'foo', maxResults: 2 });
    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toEqual({
      message: 'OpenGrok unavailable',
      type: ToolErrorType.EXECUTION_FAILED,
    });
  });

  it('executes get_file wrapper', async () => {
    vi.mocked(getFileTool.execute).mockResolvedValue({
      success: true,
      content: 'line1\nline2',
      lines: 2,
      totalLines: 2,
      truncated: false,
    });

    const tool = new OpenGrokGetFileTool();
    const invocation = tool.build({
      filePath: '/security/keymanager/foo.cc#L10-L20',
    });
    const result = await invocation.execute(new AbortController().signal);

    expect(getFileTool.execute).toHaveBeenCalledWith({
      filePath: '/security/keymanager/foo.cc#L10-L20',
    });
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('"totalLines":2');
  });

  it('validates required get_file filePath', () => {
    const tool = new OpenGrokGetFileTool();
    expect(() =>
      tool.build({
        startLine: 10,
      } as unknown as { filePath: string }),
    ).toThrow(/required property.*filePath/i);
  });

  it('executes analyze_symbol_ast wrapper', async () => {
    vi.mocked(analyzeSymbolAstTool.execute).mockResolvedValue({
      success: true,
      symbol: 'pushKeyToKmipServerIfNeeded',
      callers: [{ file: '/security/keymanager/keyserver.cc', line: 200 }],
      callees: [{ callee: 'set_vserver', line: 220, callType: 'method' }],
    });

    const tool = new OpenGrokAnalyzeSymbolAstTool();
    const invocation = tool.build({
      symbol: 'pushKeyToKmipServerIfNeeded',
      maxCallers: 10,
      maxCallees: 20,
      includeSource: true,
      contextLines: 50,
      includeTests: true,
      maxTestCallers: 10,
      verbose: true,
    });

    const result = await invocation.execute(new AbortController().signal);

    expect(analyzeSymbolAstTool.execute).toHaveBeenCalledWith({
      symbol: 'pushKeyToKmipServerIfNeeded',
      maxCallers: 10,
      maxCallees: 20,
      includeSource: true,
      contextLines: 50,
      includeTests: true,
      maxTestCallers: 10,
      verbose: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain(
      '"symbol":"pushKeyToKmipServerIfNeeded"',
    );
  });

  it('returns execution_failed error when analyze_symbol_ast throws', async () => {
    vi.mocked(analyzeSymbolAstTool.execute).mockRejectedValue(
      new Error('analysis timeout'),
    );

    const tool = new OpenGrokAnalyzeSymbolAstTool();
    const invocation = tool.build({
      symbol: 'foo',
      maxCallers: 1,
      maxCallees: 1,
      includeSource: false,
      contextLines: 10,
      includeTests: false,
      maxTestCallers: 0,
      verbose: false,
    });

    const result = await invocation.execute(new AbortController().signal);
    expect(result.error).toEqual({
      message: 'analysis timeout',
      type: ToolErrorType.EXECUTION_FAILED,
    });
  });
});
