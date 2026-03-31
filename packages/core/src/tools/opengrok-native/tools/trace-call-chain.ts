/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Trace Call Chain Tool — proxy wrapper.
 *
 * Bidirectional tracing: function/iterator -> tables -> CLI commands.
 * Proxies to the mastra-search server for orchestration.
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

export const traceCallChainTool = createTool({
  id: 'trace_call_chain',
  description: TOOL_DESCRIPTIONS.trace_call_chain,
  mcp: {
    annotations: {
      title: 'Trace Call Chain',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },

  inputSchema: z.object({
    symbol: z
      .string()
      .describe(
        "Function or iterator method to trace (e.g., 'pushKeyToKmipServerForced', 'keymanager_vdek_table_iterator::create_imp'). Works for ANY function - finds tables touched and CLI entry points.",
      ),
    maxDepth: z
      .number()
      .default(2)
      .describe(
        'Maximum depth to trace upstream (default: 2, for finding CLI entry points)',
      ),
    verbose: z
      .boolean()
      .default(true)
      .describe(
        'Full output with all callers/callees arrays (default: true = full ~25KB, false = condensed ~6KB)',
      ),
    suggestOnEmpty: z
      .boolean()
      .optional()
      .describe(
        'When true and no results found, use semantic search to suggest similar symbols.',
      ),
  }),

  execute: async (input) => {
    const invocationId = logTool.start('trace_call_chain', input);

    try {
      logTool.step('trace_call_chain', 'calling proxy', {
        symbol: input.symbol,
        maxDepth: input.maxDepth,
      });

      const result = await callProxyTool('trace_call_chain', {
        symbol: input.symbol,
        maxDepth: input.maxDepth ?? 2,
        verbose: input.verbose ?? true,
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
