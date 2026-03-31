/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ToolErrorType } from './tool-error.js';
import {
  OpenGrokAnalyzeSymbolAstTool,
  OpenGrokSearchTool,
  OntapDiscoverTool,
} from './opengrok-tools.js';
import { searchTool } from './opengrok-native/tools/search.js';
import { analyzeSymbolAstTool } from './opengrok-native/tools/analyze-symbol-ast.js';
import { ontapDiscoverTool } from './opengrok-native/ontap-discover/ontap-discover.js';

vi.mock('./opengrok-native/tools/search.js', () => ({
  searchTool: {
    execute: vi.fn(),
  },
}));

vi.mock('./opengrok-native/tools/analyze-symbol-ast.js', () => ({
  analyzeSymbolAstTool: {
    execute: vi.fn(),
  },
}));

vi.mock('./opengrok-native/ontap-discover/ontap-discover.js', () => ({
  ontapDiscoverTool: {
    execute: vi.fn(),
  },
}));

// Mock all Layer 1 tools that other agents added (prevents transitive import resolution)
vi.mock('./opengrok-native/tools/jira-tools.js', () => ({
  createJiraTools: () => ({
    search_jira: { execute: vi.fn() },
    get_jira_issue: { execute: vi.fn() },
  }),
}));

vi.mock('./opengrok-native/tools/confluence-tools.js', () => ({
  createConfluenceTools: () => ({
    get_confluence_page: { execute: vi.fn() },
  }),
}));

vi.mock('./opengrok-native/tools/call-graph-fast.js', () => ({
  callGraphFastTool: { execute: vi.fn() },
}));

vi.mock('./opengrok-native/tools/trace-call-chain.js', () => ({
  traceCallChainTool: { execute: vi.fn() },
}));

vi.mock('./opengrok-native/tools/analyze-iterator.js', () => ({
  analyzeIteratorTool: { execute: vi.fn() },
}));

vi.mock('./opengrok-native/tools/smf-cli-mapping.js', () => ({
  getSmfCliMapping: vi.fn(),
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

describe('OntapDiscoverTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes ontap_discover search action and returns JSON payload', async () => {
    vi.mocked(ontapDiscoverTool.execute).mockResolvedValue({
      query: 'encryption',
      total: 5,
      returned: 2,
      moreAvailable: 3,
      results: [
        {
          source: 'swagger',
          method: 'POST',
          path: '/security/key-managers',
          summary: 'Creates a key manager',
          domain: 'security',
        },
        {
          source: 'smf-debug',
          method: 'GET',
          path: '/api/private/cli/debug/smdb/table/cluster_kdb_rdb',
          summary: 'Debug query: cluster_kdb_rdb',
          domain: 'cluster',
        },
      ],
    });

    const tool = new OntapDiscoverTool();
    const invocation = tool.build({
      action: 'search',
      query: 'encryption',
      limit: 10,
    });
    const result = await invocation.execute(new AbortController().signal);

    expect(ontapDiscoverTool.execute).toHaveBeenCalledWith({
      action: 'search',
      query: 'encryption',
      limit: 10,
    });
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('"query":"encryption"');
    expect(result.llmContent).toContain('"total":5');
    expect(result.llmContent).toContain('/security/key-managers');
  });

  it('executes ontap_discover get_smf_table action', async () => {
    vi.mocked(ontapDiscoverTool.execute).mockResolvedValue({
      tableName: 'cluster_kdb_rdb',
      storage: 'replicated',
      queryable: true,
      fieldCount: 15,
      fields: [
        { name: 'key_id', type: 'text', role: 'key', required: true },
        { name: 'key_tag', type: 'text', role: 'read', required: false },
      ],
    });

    const tool = new OntapDiscoverTool();
    const invocation = tool.build({
      action: 'get_smf_table',
      tableName: 'cluster_kdb_rdb',
    });
    const result = await invocation.execute(new AbortController().signal);

    expect(ontapDiscoverTool.execute).toHaveBeenCalledWith({
      action: 'get_smf_table',
      tableName: 'cluster_kdb_rdb',
    });
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('"tableName":"cluster_kdb_rdb"');
    expect(result.llmContent).toContain('"storage":"replicated"');
  });

  it('executes ontap_discover cli_to_rest action', async () => {
    vi.mocked(ontapDiscoverTool.execute).mockResolvedValue({
      cliCommand: 'volume snapshot create',
      method: 'POST',
      path: '/api/private/cli/volume/snapshot',
      publicRestEquivalent: {
        method: 'POST',
        path: '/storage/volumes/{uuid}/snapshots',
      },
    });

    const tool = new OntapDiscoverTool();
    const invocation = tool.build({
      action: 'cli_to_rest',
      cliCommand: 'volume snapshot create',
    });
    const result = await invocation.execute(new AbortController().signal);

    expect(ontapDiscoverTool.execute).toHaveBeenCalledWith({
      action: 'cli_to_rest',
      cliCommand: 'volume snapshot create',
    });
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain(
      '"cliCommand":"volume snapshot create"',
    );
  });

  it('executes ontap_discover stats action', async () => {
    vi.mocked(ontapDiscoverTool.execute).mockResolvedValue({
      totalEndpoints: 15000,
      swaggerEndpoints: 1253,
      smfTables: 10946,
      loadTimeMs: 150,
    });

    const tool = new OntapDiscoverTool();
    const invocation = tool.build({ action: 'stats' });
    const result = await invocation.execute(new AbortController().signal);

    expect(ontapDiscoverTool.execute).toHaveBeenCalledWith({ action: 'stats' });
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('"totalEndpoints":15000');
  });

  it('validates required action parameter', () => {
    const tool = new OntapDiscoverTool();
    expect(() =>
      tool.build({
        query: 'encryption',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    ).toThrow(/required property.*action/i);
  });

  it('returns execution_failed error when ontap_discover throws', async () => {
    vi.mocked(ontapDiscoverTool.execute).mockRejectedValue(
      new Error('Index not initialized'),
    );

    const tool = new OntapDiscoverTool();
    const invocation = tool.build({
      action: 'search',
      query: 'test',
    });
    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toEqual({
      message: 'Index not initialized',
      type: ToolErrorType.EXECUTION_FAILED,
    });
  });

  it('executes ontap_discover browse_cli action', async () => {
    vi.mocked(ontapDiscoverTool.execute).mockResolvedValue({
      path: 'security key-manager',
      children: ['external', 'onboard', 'key'],
      childCount: 3,
      totalLeafCommands: 25,
    });

    const tool = new OntapDiscoverTool();
    const invocation = tool.build({
      action: 'browse_cli',
      cliPath: 'security key-manager',
    });
    const result = await invocation.execute(new AbortController().signal);

    expect(ontapDiscoverTool.execute).toHaveBeenCalledWith({
      action: 'browse_cli',
      cliPath: 'security key-manager',
    });
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain(
      '"children":["external","onboard","key"]',
    );
  });
});
