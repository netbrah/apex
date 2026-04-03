/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import type Anthropic from '@anthropic-ai/sdk';

/** Gemini-scale windows — trimming is unnecessary. */
export const CONTEXT_BUDGET_TRIM_SKIP_THRESHOLD = 1_000_000;

const CONTEXT_BUDGET_RATIO = 0.7;
const MIN_TOOL_CONTENT_CHARS = 500;

type AnthropicMessageParam = Anthropic.MessageParam;
type AnthropicContentBlockParam = Anthropic.ContentBlockParam;

/** Fixed token estimate for base64 image content (Anthropic's documented ~1600 tokens per image). */
const BASE64_IMAGE_TOKEN_ESTIMATE = 1600;

/**
 * Estimates tokens for a single content block, handling different content types
 * to avoid massively overestimating base64 image content.
 */
function estimateContentBlockTokens(block: AnthropicContentBlockParam): number {
  switch (block.type) {
    case 'image': {
      // Base64 images have a fixed token cost in Anthropic (~1600 tokens),
      // not proportional to their serialized size.
      return BASE64_IMAGE_TOKEN_ESTIMATE;
    }
    case 'text': {
      return Math.ceil((block.text?.length ?? 0) / 3);
    }
    case 'tool_use': {
      // Estimate based on the text portions (name + JSON input), skip any binary data
      const toolUse = block;
      const inputStr = JSON.stringify(toolUse.input ?? {});
      const nameLen = (toolUse.name ?? '').length;
      return Math.ceil((nameLen + inputStr.length) / 3) + 10; // +10 for overhead
    }
    case 'tool_result': {
      const toolResult = block;
      const content = toolResult.content;
      if (typeof content === 'string') {
        return Math.ceil(content.length / 3);
      }
      if (Array.isArray(content)) {
        return content.reduce(
          (
            sum: number,
            inner: Anthropic.TextBlockParam | Anthropic.ImageBlockParam,
          ) => {
            if (inner.type === 'image')
              return sum + BASE64_IMAGE_TOKEN_ESTIMATE;
            return sum + Math.ceil((inner.text?.length ?? 0) / 3);
          },
          0,
        );
      }
      return 10; // minimal overhead for empty tool results
    }
    default: {
      // Fallback: serialize and estimate, but this path shouldn't hit base64 images
      return Math.ceil(JSON.stringify(block).length / 3);
    }
  }
}

function estimateTokens(
  messages: AnthropicMessageParam[],
  system: string | Anthropic.TextBlockParam[] | undefined,
  tools?: unknown,
): number {
  let total = 0;

  for (const msg of messages) {
    // Per-message overhead (role, etc.)
    total += 4;
    if (typeof msg.content === 'string') {
      total += Math.ceil(msg.content.length / 3);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        total += estimateContentBlockTokens(block);
      }
    }
  }

  const sysLen = system ? JSON.stringify(system).length : 0;
  const toolLen = tools ? JSON.stringify(tools).length : 0;
  total += Math.ceil((sysLen + toolLen) / 3);

  return total;
}

/**
 * Estimates serialized request size vs context limit and trims large tool
 * results (then drops old message pairs) so Anthropic native API is less
 * likely to reject the request before compression runs.
 */
export function trimAnthropicMessagesForContextBudget(
  messages: AnthropicMessageParam[],
  system: string | Anthropic.TextBlockParam[] | undefined,
  tools: unknown | undefined,
  contextTokenLimit: number,
): {
  messages: AnthropicMessageParam[];
  system: string | Anthropic.TextBlockParam[] | undefined;
} {
  const limit = contextTokenLimit;
  if (limit >= CONTEXT_BUDGET_TRIM_SKIP_THRESHOLD) {
    return { messages, system };
  }

  const budget = Math.floor(limit * CONTEXT_BUDGET_RATIO);
  let estimate = estimateTokens(messages, system, tools);
  if (estimate <= budget) {
    return { messages, system };
  }

  // Find tool_result blocks in user messages and collect indices
  const toolResultIndices: Array<{
    msgIdx: number;
    blockIdx: number;
    len: number;
  }> = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== 'user') continue;
    if (typeof msg.content === 'string') continue;
    const blocks = msg.content;
    for (let j = 0; j < blocks.length; j++) {
      const block = blocks[j];
      if (block.type === 'tool_result') {
        const content = block.content;
        if (typeof content === 'string') {
          toolResultIndices.push({
            msgIdx: i,
            blockIdx: j,
            len: content.length,
          });
        }
      }
    }
  }
  toolResultIndices.sort((a, b) => b.len - a.len);

  const trimmed = messages.map((m) => ({
    ...m,
    content:
      typeof m.content === 'string'
        ? m.content
        : m.content.map((b) => ({ ...b })),
  })) as AnthropicMessageParam[];

  for (const { msgIdx, blockIdx } of toolResultIndices) {
    if (estimate <= budget) break;

    const msg = trimmed[msgIdx];
    if (typeof msg.content === 'string') continue;
    const blocks = msg.content;
    const block = blocks[blockIdx];
    if (block.type !== 'tool_result') continue;
    const content = block.content;
    if (
      typeof content !== 'string' ||
      content.length <= MIN_TOOL_CONTENT_CHARS
    ) {
      continue;
    }

    const maxCharsPerTool = Math.max(
      MIN_TOOL_CONTENT_CHARS,
      Math.floor((budget * 3) / Math.max(toolResultIndices.length, 1)),
    );
    const keep = Math.min(
      Math.max(MIN_TOOL_CONTENT_CHARS, Math.floor(content.length * 0.05)),
      maxCharsPerTool,
    );
    const half = Math.floor(keep / 2);
    const head = content.slice(0, half);
    const tail = content.slice(-half);
    const dropped = content.length - keep;
    block.content = `${head}\n\n[... ${dropped} characters trimmed to fit ${limit} token context window ...]\n\n${tail}`;

    estimate = estimateTokens(trimmed, system, tools);
  }

  // If still over budget, drop oldest tool result pairs from the middle
  while (estimate > budget && trimmed.length > 4) {
    // Find earliest user message with tool_result after system/first-user block
    const dropIdx = trimmed.findIndex((m, i) => {
      if (i < 2) return false;
      if (m.role !== 'user') return false;
      if (typeof m.content === 'string') return false;
      const blocks = m.content;
      return blocks.some((b) => b.type === 'tool_result');
    });
    if (dropIdx === -1) break;
    // Also remove the preceding assistant message that requested this tool call
    if (dropIdx > 0 && trimmed[dropIdx - 1].role === 'assistant') {
      trimmed.splice(dropIdx - 1, 2);
    } else {
      trimmed.splice(dropIdx, 1);
    }
    estimate = estimateTokens(trimmed, system, tools);
  }

  // Validate strict user/assistant alternation required by the Anthropic API.
  // Message-dropping may have left consecutive same-role messages.
  ensureAlternation(trimmed);

  return { messages: trimmed, system };
}

/**
 * Ensures strict user/assistant alternation by merging consecutive
 * same-role messages. Anthropic rejects requests where two adjacent
 * messages share the same role.
 */
function ensureAlternation(messages: AnthropicMessageParam[]): void {
  let i = 1;
  while (i < messages.length) {
    if (messages[i].role === messages[i - 1].role) {
      // Merge messages[i] into messages[i-1]
      const prev = messages[i - 1];
      const curr = messages[i];

      const prevBlocks =
        typeof prev.content === 'string'
          ? [{ type: 'text' as const, text: prev.content }]
          : prev.content;
      const currBlocks =
        typeof curr.content === 'string'
          ? [{ type: 'text' as const, text: curr.content }]
          : curr.content;

      messages[i - 1] = {
        role: prev.role,
        content: [...prevBlocks, ...currBlocks],
      };
      messages.splice(i, 1);
    } else {
      i++;
    }
  }
}
