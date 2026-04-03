/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import { describe, it, expect } from 'vitest';
import {
  trimAnthropicMessagesForContextBudget,
  CONTEXT_BUDGET_TRIM_SKIP_THRESHOLD,
} from './contextBudgetTrim.js';
import type Anthropic from '@anthropic-ai/sdk';

describe('trimAnthropicMessagesForContextBudget', () => {
  it('should not modify messages when context limit is Gemini-scale', () => {
    const huge = 'x'.repeat(500_000);
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: '1',
            content: huge,
          },
        ],
      },
    ];
    const out = trimAnthropicMessagesForContextBudget(
      messages,
      undefined,
      undefined,
      CONTEXT_BUDGET_TRIM_SKIP_THRESHOLD,
    );
    expect(out.messages).toBe(messages);
    expect(out.system).toBeUndefined();
  });

  it('should trim oversized tool_result string content for small context windows', () => {
    const huge = 'y'.repeat(50_000);
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'c1', name: 'read', input: {} }],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'c1',
            content: huge,
          },
        ],
      },
    ];
    const out = trimAnthropicMessagesForContextBudget(
      messages,
      undefined,
      undefined,
      8192,
    );
    // Find the user message with tool_result
    const toolMsg = out.messages.find(
      (m) => m.role === 'user' && Array.isArray(m.content),
    );
    expect(toolMsg).toBeDefined();
    if (!toolMsg || typeof toolMsg.content === 'string') {
      throw new Error('Expected array content');
    }
    const block = toolMsg.content.find(
      (b) => b.type === 'tool_result',
    ) as Anthropic.ContentBlockParam;
    expect(block).toBeDefined();
    expect(block.type).toBe('tool_result');
    if (block.type !== 'tool_result') {
      throw new Error('Expected tool_result block');
    }
    expect(typeof block.content).toBe('string');
    expect((block.content as string).length).toBeLessThan(huge.length);
    expect(block.content as string).toContain('trimmed to fit');
  });

  describe('base64 image token estimation', () => {
    it('should not massively overestimate tokens for base64 image content', () => {
      // A 1MB base64 image should estimate ~1600 tokens, not ~433K
      const base64Data = 'A'.repeat(1_000_000); // 1MB of base64 data
      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: 'describe this image' },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'I see an image' }],
        },
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: base64Data,
              },
            } as Anthropic.ImageBlockParam,
            { type: 'text', text: 'what is this?' },
          ],
        },
      ];

      // With a generous context window the image should NOT cause trimming
      // Old behavior: JSON.stringify of 1MB base64 → ~333K "tokens" → would trigger trim
      // New behavior: image = ~1600 tokens + text overhead → fits easily
      const out = trimAnthropicMessagesForContextBudget(
        messages,
        undefined,
        undefined,
        32_000, // 32K context window — plenty for a small conversation + image
      );

      // Should not have trimmed anything
      expect(out.messages.length).toBe(messages.length);
    });

    it('should handle tool_result with nested image content blocks', () => {
      const base64Data = 'B'.repeat(500_000);
      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool1',
              name: 'screenshot',
              input: {},
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool1',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: base64Data,
                  },
                } as Anthropic.ImageBlockParam,
              ],
            },
          ],
        },
      ];

      const out = trimAnthropicMessagesForContextBudget(
        messages,
        undefined,
        undefined,
        32_000,
      );

      // Image in tool_result should be estimated at ~1600 tokens, not blow up
      expect(out.messages.length).toBe(messages.length);
    });
  });

  describe('alternation validation after message dropping', () => {
    it('should maintain user/assistant alternation after aggressive trimming', () => {
      // Create a conversation that will trigger message dropping, potentially
      // leaving consecutive same-role messages
      const hugeToolResult = 'z'.repeat(100_000);
      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: 'start' },
        { role: 'assistant', content: 'ok, calling tool' },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't1',
              content: hugeToolResult,
            },
          ],
        },
        { role: 'assistant', content: 'calling another tool' },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't2',
              content: hugeToolResult,
            },
          ],
        },
        { role: 'assistant', content: 'here is the answer' },
        { role: 'user', content: 'thanks' },
      ];

      const out = trimAnthropicMessagesForContextBudget(
        messages,
        undefined,
        undefined,
        2048, // Very small window to force aggressive dropping
      );

      // Verify strict alternation: no two consecutive messages with same role
      for (let i = 1; i < out.messages.length; i++) {
        expect(out.messages[i].role).not.toBe(out.messages[i - 1].role);
      }
    });

    it('should merge consecutive user messages after dropping', () => {
      // Construct a scenario where dropping creates consecutive user messages
      const huge = 'w'.repeat(80_000);
      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'tool call 1' },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'a', content: huge }],
        },
        { role: 'assistant', content: 'tool call 2' },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'b', content: huge }],
        },
        { role: 'assistant', content: 'final answer' },
        { role: 'user', content: 'follow up' },
      ];

      const out = trimAnthropicMessagesForContextBudget(
        messages,
        undefined,
        undefined,
        1024, // Extremely small to force maximum dropping
      );

      // No consecutive same-role messages
      for (let i = 1; i < out.messages.length; i++) {
        expect(out.messages[i].role).not.toBe(out.messages[i - 1].role);
      }

      // First message should still be 'user' (Anthropic requirement)
      if (out.messages.length > 0) {
        expect(out.messages[0].role).toBe('user');
      }
    });
  });

  it('should not modify original messages array', () => {
    const huge = 'q'.repeat(50_000);
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'calling tool',
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'c1',
            content: huge,
          },
        ],
      },
    ];
    const originalLength = messages.length;
    const originalContent = JSON.stringify(messages);

    trimAnthropicMessagesForContextBudget(messages, undefined, undefined, 4096);

    expect(messages.length).toBe(originalLength);
    expect(JSON.stringify(messages)).toBe(originalContent);
  });
});
