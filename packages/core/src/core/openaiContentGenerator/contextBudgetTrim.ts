/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import type OpenAI from 'openai';

/** Gemini-scale windows — trimming is unnecessary. */
export const CONTEXT_BUDGET_TRIM_SKIP_THRESHOLD = 1_000_000;

const CONTEXT_BUDGET_RATIO = 0.7;
const MIN_TOOL_CONTENT_CHARS = 500;

/** Fixed token estimate for base64 image content (~1600 tokens per image). */
const BASE64_IMAGE_TOKEN_ESTIMATE = 1600;

/**
 * Estimates tokens for an OpenAI message, handling different content types
 * to avoid massively overestimating base64 image content.
 */
function estimateMessageTokens(
  msg: OpenAI.Chat.ChatCompletionMessageParam,
): number {
  // Per-message overhead (role, name, etc.)
  let tokens = 4;

  const content = (msg as { content?: unknown }).content;
  if (typeof content === 'string') {
    tokens += Math.ceil(content.length / 3);
  } else if (Array.isArray(content)) {
    for (const part of content) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const p = part as Record<string, unknown>;
      if (p['type'] === 'image_url') {
        // Base64 images have a fixed token cost, not proportional to serialized size
        tokens += BASE64_IMAGE_TOKEN_ESTIMATE;
      } else if (p['type'] === 'text') {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        tokens += Math.ceil(((p['text'] as string) ?? '').length / 3);
      } else {
        tokens += Math.ceil(JSON.stringify(p).length / 3);
      }
    }
  }

  // Account for tool_calls in assistant messages
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const toolCalls = (msg as { tool_calls?: unknown[] }).tool_calls;
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const call = tc as Record<string, unknown>;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const fn = call['function'] as Record<string, string> | undefined;
      if (fn) {
        tokens +=
          Math.ceil(
            ((fn['name'] ?? '').length + (fn['arguments'] ?? '').length) / 3,
          ) + 10;
      }
    }
  }

  return tokens;
}

function estimateTokens(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  tools?: unknown,
): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateMessageTokens(msg);
  }
  const toolLen = tools ? JSON.stringify(tools).length : 0;
  total += Math.ceil(toolLen / 3);
  return total;
}

/**
 * Estimates serialized request size vs context limit and trims large tool
 * results (then drops old tool pairs) so OpenAI-compatible backends are less
 * likely to reject the request before compression runs.
 */
export function trimMessagesForContextBudget(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  tools: unknown | undefined,
  contextTokenLimit: number,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const limit = contextTokenLimit;
  if (limit >= CONTEXT_BUDGET_TRIM_SKIP_THRESHOLD) {
    return messages;
  }

  const budget = Math.floor(limit * CONTEXT_BUDGET_RATIO);
  let estimate = estimateTokens(messages, tools);
  if (estimate <= budget) {
    return messages;
  }

  const toolIndices: Array<{ idx: number; len: number }> = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== 'tool') continue;
    const content = msg.content;
    if (typeof content === 'string') {
      toolIndices.push({ idx: i, len: content.length });
    }
  }
  toolIndices.sort((a, b) => b.len - a.len);

  const trimmed = messages.map((m) => ({ ...m }));

  for (const { idx } of toolIndices) {
    if (estimate <= budget) break;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const tm = trimmed[idx] as OpenAI.Chat.ChatCompletionToolMessageParam;
    const content = tm.content;
    if (
      typeof content !== 'string' ||
      content.length <= MIN_TOOL_CONTENT_CHARS
    ) {
      continue;
    }

    const maxCharsPerTool = Math.max(
      MIN_TOOL_CONTENT_CHARS,
      Math.floor((budget * 3) / Math.max(toolIndices.length, 1)),
    );
    const keep = Math.min(
      Math.max(MIN_TOOL_CONTENT_CHARS, Math.floor(content.length * 0.05)),
      maxCharsPerTool,
    );
    const half = Math.floor(keep / 2);
    const head = content.slice(0, half);
    const tail = content.slice(-half);
    const dropped = content.length - keep;
    tm.content = `${head}\n\n[... ${dropped} characters trimmed to fit ${limit} token context window ...]\n\n${tail}`;

    estimate = estimateTokens(trimmed, tools);
  }

  while (estimate > budget && trimmed.length > 4) {
    const dropIdx = trimmed.findIndex((m, i) => i >= 2 && m.role === 'tool');
    if (dropIdx === -1) break;
    if (dropIdx > 0 && trimmed[dropIdx - 1].role === 'assistant') {
      trimmed.splice(dropIdx - 1, 2);
    } else {
      trimmed.splice(dropIdx, 1);
    }
    estimate = estimateTokens(trimmed, tools);
  }

  // Clean up orphaned tool_call references: after dropping tool messages,
  // assistant messages may reference tool_call IDs that no longer have
  // corresponding tool results, causing OpenAI to return errors.
  removeOrphanedToolCalls(trimmed);

  return trimmed;
}

/**
 * Scans for assistant messages with tool_calls whose IDs don't have
 * corresponding tool result messages, and removes the orphaned tool_calls.
 * If all tool_calls on an assistant message are orphaned, drops the entire message.
 */
function removeOrphanedToolCalls(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): void {
  // Collect all tool result IDs present in the conversation
  const presentToolResultIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role === 'tool') {
      const toolMsg = msg;
      if (toolMsg.tool_call_id) {
        presentToolResultIds.add(toolMsg.tool_call_id);
      }
    }
  }

  // Walk backwards so splice indices stay valid
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;

    const assistantMsg = msg;
    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0)
      continue;

    const validCalls = assistantMsg.tool_calls.filter((tc) =>
      presentToolResultIds.has(tc.id),
    );

    if (validCalls.length === 0) {
      // All tool_calls are orphaned — drop the entire assistant message
      messages.splice(i, 1);
    } else if (validCalls.length < assistantMsg.tool_calls.length) {
      // Some tool_calls are orphaned — keep only the valid ones
      assistantMsg.tool_calls = validCalls;
    }
  }
}
