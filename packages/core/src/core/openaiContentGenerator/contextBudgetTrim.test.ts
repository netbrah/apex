/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  trimMessagesForContextBudget,
  CONTEXT_BUDGET_TRIM_SKIP_THRESHOLD,
} from './contextBudgetTrim.js';
import type OpenAI from 'openai';

describe('trimMessagesForContextBudget', () => {
  it('should not modify messages when context limit is Gemini-scale', () => {
    const huge = 'x'.repeat(500_000);
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'ok' },
      {
        role: 'tool',
        tool_call_id: '1',
        content: huge,
      },
    ];
    const out = trimMessagesForContextBudget(
      messages,
      undefined,
      CONTEXT_BUDGET_TRIM_SKIP_THRESHOLD,
    );
    expect(out).toBe(messages);
  });

  it('should trim oversized tool string content for small context windows', () => {
    const huge = 'y'.repeat(50_000);
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'tool', arguments: '{}' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'c1',
        content: huge,
      },
    ];
    const out = trimMessagesForContextBudget(messages, undefined, 8192);
    const toolMsg = out.find(
      (msg) => msg.role === 'tool',
    ) as OpenAI.Chat.ChatCompletionToolMessageParam;
    expect(toolMsg).toBeDefined();
    expect(toolMsg.role).toBe('tool');
    expect(typeof toolMsg.content).toBe('string');
    expect((toolMsg.content as string).length).toBeLessThan(huge.length);
    expect(toolMsg.content as string).toContain('trimmed to fit');
  });

  it('should not leave orphaned tool messages after dropping old tool pairs', () => {
    const huge = 'z'.repeat(80_000);
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'run tools' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_a',
            type: 'function',
            function: { name: 'toolA', arguments: '{}' },
          },
          {
            id: 'call_b',
            type: 'function',
            function: { name: 'toolB', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_a', content: huge },
      { role: 'tool', tool_call_id: 'call_b', content: 'small' },
    ];

    const out = trimMessagesForContextBudget(messages, undefined, 4096);

    // The trimmed history must not contain orphan tool responses.
    for (let i = 0; i < out.length; i++) {
      const msg = out[i];
      if (msg.role !== 'tool') {
        continue;
      }

      const toolMsg = msg as OpenAI.Chat.ChatCompletionToolMessageParam;
      const foundAssistant = out.slice(0, i).some((previous) => {
        if (
          previous.role !== 'assistant' ||
          !('tool_calls' in previous) ||
          !previous.tool_calls
        ) {
          return false;
        }
        return previous.tool_calls.some(
          (call) => call.id && call.id === toolMsg.tool_call_id,
        );
      });

      expect(foundAssistant).toBe(true);
    }
  });
});
