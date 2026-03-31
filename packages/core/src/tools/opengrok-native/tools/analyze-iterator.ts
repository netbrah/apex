/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Analyze Iterator Tool — proxy wrapper.
 *
 * Unified analysis of ONTAP SMF iterators combining SMF schema, call graph,
 * REST mapping, and field usage analysis. Proxies to the mastra-search server.
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

export const analyzeIteratorTool = createTool({
  id: 'analyze_iterator',
  description: TOOL_DESCRIPTIONS.analyze_iterator,
  mcp: {
    annotations: {
      title: 'Analyze Iterator',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },

  inputSchema: z.object({
    iterator: z
      .string()
      .describe(
        'Iterator class name (e.g., keymanager_keystore_enable_iterator)',
      ),
    maxCallers: z
      .number()
      .default(10)
      .describe(
        'Maximum number of direct callers to analyze for field usage (default: 10)',
      ),
    maxDepth: z
      .number()
      .default(2)
      .describe(
        'Call graph depth: 1=direct callers only, 2=include transitive (default: 2)',
      ),
    includeImpMethods: z
      .boolean()
      .default(true)
      .describe('Analyze *_imp methods for action iterators (default: true)'),
    verbose: z
      .boolean()
      .default(false)
      .describe('Include source snippets and timing (default: false)'),
    suggestOnEmpty: z
      .boolean()
      .optional()
      .describe(
        'When true and iterator not found, use semantic search to suggest similar iterators.',
      ),
  }),

  execute: async (input) => {
    const invocationId = logTool.start('analyze_iterator', input);

    try {
      logTool.step('analyze_iterator', 'calling proxy', {
        iterator: input.iterator,
        maxDepth: input.maxDepth,
      });

      const result = await callProxyTool('analyze_iterator', {
        iterator: input.iterator,
        maxCallers: input.maxCallers ?? 10,
        maxDepth: input.maxDepth ?? 2,
        includeImpMethods: input.includeImpMethods ?? true,
        verbose: input.verbose ?? false,
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
