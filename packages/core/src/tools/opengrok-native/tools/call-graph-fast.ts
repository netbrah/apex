/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Call Graph Fast Tool — proxy wrapper.
 *
 * Builds upstream-only call graphs by proxying to the mastra-search server.
 * Receives params, calls the remote API, returns results.
 */

import { createTool } from '../lib/mastra-tool-shim.js';
import { z } from '../lib/zod-shim.js';
import { TOOL_DESCRIPTIONS } from '../prompts/index.js';
import { logTool } from '../lib/logger.js';
import { classifyError } from '../lib/errors.js';
import { Agent, fetch as undiciFetch } from 'undici';

// ============================================================================
// HTTP Client — direct (no proxy) undici agent for mastra-search requests
// ============================================================================

const directAgent = new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  connections: 10,
  pipelining: 1,
  connect: { timeout: 15_000 },
  headersTimeout: 120_000,
  bodyTimeout: 120_000,
});

function getProxyBaseUrl(): string {
  return (
    process.env.MASTRA_SEARCH_URL ||
    process.env.OPENGROK_PROXY_URL ||
    'http://localhost:4111'
  );
}

async function callProxyTool(
  toolName: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const baseUrl = getProxyBaseUrl();
  const url = `${baseUrl}/api/tools/${toolName}`;

  const response = await undiciFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(params),
    dispatcher: directAgent,
  });

  const text = await response.text();

  if (!response.ok) {
    const trimmed = text.trim();
    const detail =
      trimmed.length > 500 ? `${trimmed.slice(0, 500)}...` : trimmed;
    throw new Error(
      `Proxy API returned HTTP ${response.status}: ${detail || response.statusText || 'No details'}`,
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      'Proxy returned invalid JSON. Response may be an error page.',
    );
  }
}

// ============================================================================
// Tool Definition
// ============================================================================

export const callGraphFastTool = createTool({
  id: 'call_graph_fast',
  description: TOOL_DESCRIPTIONS.call_graph_fast,
  mcp: {
    annotations: {
      title: 'Call Graph Fast',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },

  inputSchema: z.object({
    symbol: z.string().describe('Entry point function to find callers for'),
    max_depth: z
      .number()
      .default(1)
      .describe(
        'Maximum depth to traverse upstream (default: 1, max: 3). Use 1 for fast iterator tracing, 2 only if needed.',
      ),
    max_callers: z
      .number()
      .default(10)
      .describe('Maximum callers to find per level (default: 10)'),
    format: z
      .enum(['mermaid', 'structured', 'all'] as const)
      .default('structured')
      .describe(
        'Output format: structured (default, machine-parseable JSON), mermaid for visual diagram, all for structured+mermaid',
      ),
    filter_noise: z
      .boolean()
      .default(true)
      .describe(
        'Filter out noise functions like traceError, std::*, ON_SCOPE_EXIT (default: true)',
      ),
    path_filter: z
      .string()
      .optional()
      .describe(
        "Only include callers from files matching this path (e.g., 'keymanager', 'security')",
      ),
    track_instantiations: z
      .boolean()
      .default(false)
      .describe(
        'For leaf nodes that are iterator _imp methods, search for instantiation patterns to discover deeper callers.',
      ),
    include_code: z
      .boolean()
      .default(true)
      .describe('Include code snippets in output for in-depth understanding.'),
    verbose: z
      .boolean()
      .default(false)
      .describe(
        'Include timing stats, noise entries, and debug info in output.',
      ),
    references: z
      .boolean()
      .default(false)
      .describe('Return only flat references array with file:line links.'),
    suggestOnEmpty: z
      .boolean()
      .optional()
      .describe(
        'When true and no callers found, use semantic search to suggest similar symbols.',
      ),
  }),

  execute: async (input) => {
    const invocationId = logTool.start('call_graph_fast', input);

    try {
      logTool.step('call_graph_fast', 'calling proxy', {
        symbol: input.symbol,
        max_depth: input.max_depth,
      });

      const result = await callProxyTool('call_graph_fast', {
        symbol: input.symbol,
        max_depth: input.max_depth ?? 1,
        max_callers: input.max_callers ?? 10,
        format: input.format ?? 'structured',
        filter_noise: input.filter_noise ?? true,
        path_filter: input.path_filter,
        track_instantiations: input.track_instantiations ?? false,
        include_code: input.include_code ?? true,
        verbose: input.verbose ?? false,
        references: input.references ?? false,
        suggestOnEmpty: input.suggestOnEmpty,
      });

      logTool.end(invocationId, { success: true });
      return result;
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
