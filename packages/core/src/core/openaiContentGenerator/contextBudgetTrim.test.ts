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
        role: 'tool',
        tool_call_id: 'c1',
        content: huge,
      },
    ];
    const out = trimMessagesForContextBudget(messages, undefined, 8192);
    const toolMsg = out[2] as OpenAI.Chat.ChatCompletionToolMessageParam;
    expect(toolMsg.role).toBe('tool');
    expect(typeof toolMsg.content).toBe('string');
    expect((toolMsg.content as string).length).toBeLessThan(huge.length);
    expect(toolMsg.content as string).toContain('trimmed to fit');
  });

  describe('base64 image token estimation', () => {
    it('should not massively overestimate tokens for base64 image content', () => {
      const base64Data = 'A'.repeat(1_000_000);
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: 'sys' },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${base64Data}`,
              },
            },
            { type: 'text', text: 'what is this?' },
          ],
        },
        { role: 'assistant', content: 'I see an image.' },
      ];

      // With 32K context, a small conversation with an image should fit
      // Old behavior: JSON.stringify of 1MB → ~333K "tokens" → over budget
      // New behavior: image = ~1600 tokens → fits easily
      const out = trimMessagesForContextBudget(messages, undefined, 32_000);

      expect(out.length).toBe(messages.length);
    });
  });

  describe('orphaned tool_call cleanup', () => {
    it('should remove orphaned tool_calls from assistant messages after dropping', () => {
      const huge = 'z'.repeat(80_000);
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function' as const,
              function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
            },
            {
              id: 'call_2',
              type: 'function' as const,
              function: { name: 'read_file', arguments: '{"path":"b.txt"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: huge },
        { role: 'tool', tool_call_id: 'call_2', content: 'small result' },
        { role: 'assistant', content: 'here is the result' },
        { role: 'user', content: 'thanks' },
      ];

      const out = trimMessagesForContextBudget(messages, undefined, 4096);

      // After trimming, verify no orphaned tool_call IDs exist
      const toolResultIds = new Set<string>();
      for (const msg of out) {
        if (msg.role === 'tool') {
          const toolMsg = msg as OpenAI.Chat.ChatCompletionToolMessageParam;
          toolResultIds.add(toolMsg.tool_call_id);
        }
      }

      for (const msg of out) {
        if (msg.role === 'assistant') {
          const assistantMsg =
            msg as OpenAI.Chat.ChatCompletionAssistantMessageParam;
          if (assistantMsg.tool_calls) {
            for (const tc of assistantMsg.tool_calls) {
              expect(toolResultIds.has(tc.id)).toBe(true);
            }
          }
        }
      }
    });

    it('should drop assistant message when all its tool_calls are orphaned', () => {
      const huge = 'w'.repeat(100_000);
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_only',
              type: 'function' as const,
              function: { name: 'search', arguments: '{"q":"test"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_only', content: huge },
        { role: 'assistant', content: 'final answer' },
        { role: 'user', content: 'ok' },
      ];

      const out = trimMessagesForContextBudget(messages, undefined, 2048);

      // No assistant message should reference a missing tool result
      const toolResultIds = new Set<string>();
      for (const msg of out) {
        if (msg.role === 'tool') {
          toolResultIds.add(
            (msg as OpenAI.Chat.ChatCompletionToolMessageParam).tool_call_id,
          );
        }
      }
      for (const msg of out) {
        if (msg.role === 'assistant') {
          const asst = msg as OpenAI.Chat.ChatCompletionAssistantMessageParam;
          if (asst.tool_calls) {
            for (const tc of asst.tool_calls) {
              expect(toolResultIds.has(tc.id)).toBe(true);
            }
          }
        }
      }
    });

    it('should keep assistant tool_calls that have matching tool results', () => {
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'keep_me',
              type: 'function' as const,
              function: { name: 'read', arguments: '{}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'keep_me', content: 'small' },
        { role: 'assistant', content: 'done' },
        { role: 'user', content: 'great' },
      ];

      // Large enough context that nothing gets dropped
      const out = trimMessagesForContextBudget(messages, undefined, 100_000);

      // All messages preserved
      expect(out.length).toBe(messages.length);

      // tool_calls intact
      const assistantMsg =
        out[2] as OpenAI.Chat.ChatCompletionAssistantMessageParam;
      expect(assistantMsg.tool_calls).toHaveLength(1);
      expect(assistantMsg.tool_calls![0].id).toBe('keep_me');
    });
  });

  it('should not modify original messages array', () => {
    const huge = 'q'.repeat(50_000);
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'tc1',
            type: 'function' as const,
            function: { name: 'test', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'tc1', content: huge },
    ];
    const originalLength = messages.length;

    trimMessagesForContextBudget(messages, undefined, 4096);

    expect(messages.length).toBe(originalLength);
  });
});
