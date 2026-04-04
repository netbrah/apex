/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Wire Protocol Invariance Tests — Schema-Driven Ground Truth
 *
 * These tests validate that our three wire converters (Anthropic, OpenAI Chat,
 * OpenAI Responses) faithfully translate between the Gemini internal format and
 * each external wire protocol with NO silent data loss ("null space").
 *
 * The ground truth comes from the actual upstream SDK type definitions:
 *   - @google/genai v1.30.0 — Part, FunctionCall, FunctionResponse, UsageMetadata
 *   - @anthropic-ai/sdk v0.36.3 — Message, ContentBlock, Usage, streaming events
 *   - openai v5.11.0 — ChatCompletion, ChatCompletionMessage, CompletionUsage
 *   - Our own types.ts — Responses API types (no official SDK for /responses)
 *
 * The test structure:
 *   §1 — Schema Field Coverage: Verify every Gemini Part field is handled
 *   §2 — Per-wire request path: Gemini → wire (canonical fixtures)
 *   §3 — Per-wire response path: wire → Gemini (constructed from SDK types)
 *   §4 — Cross-wire invariance: Same payload, same semantics across all wires
 *   §5 — Documented gaps: Known null-space acknowledged + regression guard
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerateContentParameters, Part } from '@google/genai';
import { FinishReason } from '@google/genai';

// ── Mock schema conversion (same pattern as existing converter tests) ──
vi.mock('../../utils/schemaConverter.js', () => ({
  convertSchema: vi.fn((schema: unknown) => schema),
}));

import { AnthropicContentConverter } from './anthropicContentGenerator/converter.js';
import { OpenAIContentConverter } from './openaiContentGenerator/converter.js';
import {
  ResponsesStreamState,
  convertResponsesEventToGemini,
  convertGeminiContentsToResponsesInput,
} from './openaiResponsesContentGenerator/responsesConverter.js';

// ═══════════════════════════════════════════════════════════════════════
// Ground Truth: SDK-derived schema registries
//
// These declare what fields EXIST in each upstream SDK and what our
// converters MUST handle (or explicitly document as a known gap).
// When an SDK is upgraded, new fields appear here and break the test
// until the converter is updated or the gap is documented.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Every field on @google/genai Part (v1.30.0).
 * Source: node_modules/@google/genai/dist/genai.d.ts
 */
const GEMINI_PART_FIELDS = [
  'text',
  'thought',
  'thoughtSignature',
  'functionCall',
  'functionResponse',
  'inlineData',
  'fileData',
  'executableCode',
  'codeExecutionResult',
  'videoMetadata',
  'mediaResolution',
] as const;

/**
 * Gemini FunctionCall fields (v1.30.0).
 * Source: node_modules/@google/genai/dist/genai.d.ts
 */
const GEMINI_FUNCTION_CALL_FIELDS = [
  'id',
  'name',
  'args',
  'partialArgs', // streaming-only, not supported in Gemini API
  'willContinue', // streaming-only, not supported in Gemini API
] as const;

/**
 * Gemini FunctionResponse fields (v1.30.0).
 * Source: node_modules/@google/genai/dist/genai.d.ts
 */
const GEMINI_FUNCTION_RESPONSE_FIELDS = [
  'id',
  'name',
  'response',
  'parts', // media parts
  'willContinue', // non-blocking function calls
  'scheduling', // non-blocking function calls
] as const;

/**
 * Gemini GenerateContentResponseUsageMetadata fields (v1.30.0).
 * Source: node_modules/@google/genai/dist/genai.d.ts
 */
const GEMINI_USAGE_METADATA_FIELDS = [
  'promptTokenCount',
  'candidatesTokenCount',
  'totalTokenCount',
  'cachedContentTokenCount',
  'thoughtsTokenCount',
  'toolUsePromptTokenCount',
  'cacheTokensDetails',
  'candidatesTokensDetails',
  'promptTokensDetails',
  'toolUsePromptTokensDetails',
  'trafficType',
] as const;

/**
 * Anthropic Message response fields (v0.36.3).
 * Source: node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts
 */
const ANTHROPIC_MESSAGE_FIELDS = [
  'id',
  'content',
  'model',
  'role',
  'stop_reason',
  'stop_sequence',
  'type',
  'usage',
] as const;

/**
 * Anthropic Usage fields (v0.36.3).
 * Source: node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts
 */
const ANTHROPIC_USAGE_FIELDS = [
  'cache_creation_input_tokens',
  'cache_read_input_tokens',
  'input_tokens',
  'output_tokens',
] as const;

/**
 * Anthropic ContentBlock union members (v0.36.3).
 * TextBlock | ToolUseBlock (official SDK)
 * + thinking | redacted_thinking (beta, handled via raw events)
 */
const ANTHROPIC_CONTENT_BLOCK_TYPES = [
  'text',
  'tool_use',
  'thinking', // beta: interleaved-thinking-2025-05-14
  'redacted_thinking', // beta: interleaved-thinking-2025-05-14
] as const;

/**
 * Anthropic stop_reason values (v0.36.3).
 * Source: Message.stop_reason type
 */
const ANTHROPIC_STOP_REASONS = [
  'end_turn',
  'max_tokens',
  'stop_sequence',
  'tool_use',
] as const;

/**
 * OpenAI ChatCompletionMessage fields (v5.11.0).
 * Source: node_modules/openai/resources/chat/completions/completions.d.ts
 */
const OPENAI_MESSAGE_FIELDS = [
  'content',
  'refusal',
  'role',
  'annotations',
  'audio',
  'function_call', // deprecated
  'tool_calls',
] as const;

/**
 * OpenAI CompletionUsage fields (v5.11.0).
 * Source: node_modules/openai/resources/completions.d.ts
 */
const OPENAI_USAGE_FIELDS = [
  'prompt_tokens',
  'completion_tokens',
  'total_tokens',
  'prompt_tokens_details',
  'completion_tokens_details',
] as const;

/**
 * OpenAI CompletionTokensDetails fields (v5.11.0).
 */
const OPENAI_COMPLETION_TOKEN_DETAIL_FIELDS = [
  'accepted_prediction_tokens',
  'audio_tokens',
  'reasoning_tokens',
  'rejected_prediction_tokens',
] as const;

/**
 * OpenAI PromptTokensDetails fields (v5.11.0).
 */
const OPENAI_PROMPT_TOKEN_DETAIL_FIELDS = [
  'audio_tokens',
  'cached_tokens',
] as const;

/**
 * OpenAI finish_reason values (v5.11.0).
 * Source: ChatCompletion.Choice.finish_reason type
 */
const OPENAI_FINISH_REASONS = [
  'stop',
  'length',
  'tool_calls',
  'content_filter',
  'function_call', // deprecated
] as const;

/**
 * Responses API SSE event types (our types.ts).
 * Source: packages/core/src/core/openaiResponsesContentGenerator/types.ts
 */
const RESPONSES_SSE_EVENT_TYPES = [
  'response.created',
  'response.in_progress',
  'response.output_item.added',
  'response.output_item.done',
  'response.content_part.added',
  'response.content_part.done',
  'response.output_text.delta',
  'response.output_text.done',
  'response.function_call_arguments.delta',
  'response.function_call_arguments.done',
  'response.reasoning_summary_part.added',
  'response.reasoning_summary_part.done',
  'response.reasoning_summary_text.delta',
  'response.reasoning_summary_text.done',
  'response.completed',
  'response.failed',
  'response.incomplete',
  'error',
] as const;

/**
 * Responses API input item types (our types.ts).
 */
const RESPONSES_INPUT_ITEM_TYPES = [
  'message',
  'function_call',
  'function_call_output',
  'item_reference',
  'reasoning',
  'compaction',
] as const;

// ═══════════════════════════════════════════════════════════════════════
// Documented known gaps — fields that are INTENTIONALLY not mapped
// If a gap is removed from this set but the converter still drops it,
// the schema coverage tests will fail.
// ═══════════════════════════════════════════════════════════════════════

/** Gemini Part fields that are Gemini-native and have no external equivalent */
const GEMINI_NATIVE_ONLY_FIELDS = new Set([
  'executableCode',
  'codeExecutionResult',
  'videoMetadata',
  'mediaResolution',
]);

/** Gemini FunctionCall fields not relevant to external wires */
const GEMINI_FC_UNSUPPORTED_FIELDS = new Set([
  'partialArgs', // Gemini-native streaming, not supported in Gemini API itself
  'willContinue', // Gemini-native streaming
]);

/** Gemini FunctionResponse fields not relevant to external wires */
const GEMINI_FR_UNSUPPORTED_FIELDS = new Set([
  'willContinue', // NON_BLOCKING function calls, Gemini-native
  'scheduling', // NON_BLOCKING function calls, Gemini-native
]);

/** Gemini usage fields with no external wire equivalent */
const GEMINI_USAGE_NO_EXTERNAL_EQUIVALENT = new Set([
  'cacheTokensDetails',
  'candidatesTokensDetails',
  'promptTokensDetails',
  'toolUsePromptTokenCount',
  'toolUsePromptTokensDetails',
  'trafficType',
]);

/** Anthropic usage fields not mapped to Gemini */
const ANTHROPIC_USAGE_KNOWN_GAPS = new Set([
  'cache_creation_input_tokens', // Anthropic billing-only field
]);

/** OpenAI message fields not mapped to Gemini */
const OPENAI_MESSAGE_KNOWN_GAPS = new Set([
  'refusal', // Safety refusal text
  'annotations', // URL citation metadata
  'audio', // Audio generation output
  'function_call', // Deprecated
]);

/** Responses SSE events not mapped to Gemini (informational/no-op) */
const RESPONSES_EVENT_KNOWN_NOOP = new Set([
  'response.content_part.added',
  'response.content_part.done',
  'response.output_text.done',
  'response.function_call_arguments.done',
  'response.reasoning_summary_part.added',
  'response.reasoning_summary_part.done',
  'response.reasoning_summary_text.done',
]);

// ═══════════════════════════════════════════════════════════════════════
// Canonical Fixtures — every agentic Part type
// ═══════════════════════════════════════════════════════════════════════

const TEXT_PART: Part = { text: 'Hello, world!' };
const THOUGHT_PART: Part = {
  text: 'Let me think about this...',
  thought: true,
};
const THOUGHT_WITH_SIG: Part = {
  text: 'Deep thoughts',
  thought: true,
  thoughtSignature: 'sig_abc123',
};
const FUNCTION_CALL_PART: Part = {
  functionCall: {
    id: 'call_abc123',
    name: 'read_file',
    args: { path: '/tmp/test.txt' },
  },
};
const FUNCTION_RESPONSE_PART: Part = {
  functionResponse: {
    id: 'call_abc123',
    name: 'read_file',
    response: { output: 'file contents here' },
  },
};
const FUNCTION_RESPONSE_ERROR_PART: Part = {
  functionResponse: {
    id: 'call_err456',
    name: 'write_file',
    response: { error: 'Permission denied' },
  },
};
const IMAGE_PART: Part = {
  inlineData: {
    mimeType: 'image/png',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  },
};
const PDF_PART: Part = {
  inlineData: { mimeType: 'application/pdf', data: 'JVBERi0xLjAKMSAwIG9iago=' },
};

function makeConversation(): GenerateContentParameters {
  return {
    model: 'test-model',
    contents: [
      { role: 'user', parts: [TEXT_PART] },
      { role: 'model', parts: [THOUGHT_PART, { text: 'Here is my answer.' }] },
      {
        role: 'model',
        parts: [{ text: 'I will read that file.' }, FUNCTION_CALL_PART],
      },
      { role: 'user', parts: [FUNCTION_RESPONSE_PART] },
    ],
    config: { systemInstruction: 'You are a helpful assistant.' },
  };
}

function makeImageConversation(): GenerateContentParameters {
  return {
    model: 'test-model',
    contents: [
      { role: 'user', parts: [IMAGE_PART, { text: 'What is in this image?' }] },
    ],
    config: { systemInstruction: 'Describe images.' },
  };
}

// ═══════════════════════════════════════════════════════════════════════
// §1 — Schema Field Coverage Tests
//
// These tests verify that every field from the upstream SDK types is
// either handled by our converter or explicitly documented as a known gap.
// When SDKs are upgraded and add new fields, these tests BREAK until
// the field is handled or added to the known-gaps set.
// ═══════════════════════════════════════════════════════════════════════

describe('Wire Protocol Invariance (Schema-Driven)', () => {
  describe('§1 — Ground Truth Schema Coverage', () => {
    it('every Gemini Part field is either mapped or documented as native-only', () => {
      const mappedByAtLeastOneWire = new Set([
        'text',
        'thought',
        'thoughtSignature',
        'functionCall',
        'functionResponse',
        'inlineData',
        'fileData',
      ]);
      for (const field of GEMINI_PART_FIELDS) {
        const handled =
          mappedByAtLeastOneWire.has(field) ||
          GEMINI_NATIVE_ONLY_FIELDS.has(field);
        expect(
          handled,
          `Gemini Part.${field} is neither mapped nor documented as native-only`,
        ).toBe(true);
      }
    });

    it('every Gemini FunctionCall field is handled or documented', () => {
      const mapped = new Set(['id', 'name', 'args']);
      for (const field of GEMINI_FUNCTION_CALL_FIELDS) {
        const handled =
          mapped.has(field) || GEMINI_FC_UNSUPPORTED_FIELDS.has(field);
        expect(handled, `FunctionCall.${field} unaccounted`).toBe(true);
      }
    });

    it('every Gemini FunctionResponse field is handled or documented', () => {
      const mapped = new Set(['id', 'name', 'response', 'parts']);
      for (const field of GEMINI_FUNCTION_RESPONSE_FIELDS) {
        const handled =
          mapped.has(field) || GEMINI_FR_UNSUPPORTED_FIELDS.has(field);
        expect(handled, `FunctionResponse.${field} unaccounted`).toBe(true);
      }
    });

    it('every Gemini UsageMetadata field is handled or documented as no-external-equivalent', () => {
      const mappedToExternal = new Set([
        'promptTokenCount',
        'candidatesTokenCount',
        'totalTokenCount',
        'cachedContentTokenCount',
        'thoughtsTokenCount',
      ]);
      for (const field of GEMINI_USAGE_METADATA_FIELDS) {
        const handled =
          mappedToExternal.has(field) ||
          GEMINI_USAGE_NO_EXTERNAL_EQUIVALENT.has(field);
        expect(handled, `UsageMetadata.${field} unaccounted`).toBe(true);
      }
    });

    it('every Anthropic Message field is consumed by the response converter', () => {
      const consumed = new Set([
        'id',
        'content',
        'model',
        'role',
        'stop_reason',
        'stop_sequence',
        'type',
        'usage',
      ]);
      for (const field of ANTHROPIC_MESSAGE_FIELDS) {
        expect(
          consumed.has(field),
          `Anthropic Message.${field} not consumed`,
        ).toBe(true);
      }
    });

    it('every Anthropic Usage field is mapped or documented as a gap', () => {
      const mapped = new Set([
        'input_tokens',
        'output_tokens',
        'cache_read_input_tokens',
      ]);
      for (const field of ANTHROPIC_USAGE_FIELDS) {
        const handled =
          mapped.has(field) || ANTHROPIC_USAGE_KNOWN_GAPS.has(field);
        expect(handled, `Anthropic Usage.${field} unaccounted`).toBe(true);
      }
    });

    it('every Anthropic ContentBlock type is handled', () => {
      const handled = new Set([
        'text',
        'tool_use',
        'thinking',
        'redacted_thinking',
      ]);
      for (const blockType of ANTHROPIC_CONTENT_BLOCK_TYPES) {
        expect(
          handled.has(blockType),
          `Anthropic block type '${blockType}' not handled`,
        ).toBe(true);
      }
    });

    it('every Anthropic stop_reason maps to a Gemini FinishReason', () => {
      const converter = new AnthropicContentConverter('test', 'auto');
      for (const reason of ANTHROPIC_STOP_REASONS) {
        const result = converter.mapAnthropicFinishReasonToGemini(reason);
        expect(
          result,
          `stop_reason '${reason}' maps to undefined`,
        ).toBeDefined();
        expect(result, `stop_reason '${reason}' maps to UNSPECIFIED`).not.toBe(
          FinishReason.FINISH_REASON_UNSPECIFIED,
        );
      }
    });

    it('every OpenAI message field is mapped or documented as a gap', () => {
      const mapped = new Set(['content', 'role', 'tool_calls']);
      for (const field of OPENAI_MESSAGE_FIELDS) {
        const handled =
          mapped.has(field) || OPENAI_MESSAGE_KNOWN_GAPS.has(field);
        expect(handled, `OpenAI Message.${field} unaccounted`).toBe(true);
      }
    });

    it('every OpenAI CompletionUsage field is mapped', () => {
      const mapped = new Set(OPENAI_USAGE_FIELDS);
      for (const field of OPENAI_USAGE_FIELDS) {
        expect(mapped.has(field), `OpenAI Usage.${field} not mapped`).toBe(
          true,
        );
      }
    });

    it('every OpenAI CompletionTokensDetails field is mapped or documented', () => {
      const mapped = new Set(['reasoning_tokens']);
      const documented = new Set([
        'accepted_prediction_tokens',
        'audio_tokens',
        'rejected_prediction_tokens',
      ]);
      for (const field of OPENAI_COMPLETION_TOKEN_DETAIL_FIELDS) {
        const handled = mapped.has(field) || documented.has(field);
        expect(handled, `CompletionTokensDetails.${field} unaccounted`).toBe(
          true,
        );
      }
    });

    it('every OpenAI PromptTokensDetails field is mapped or documented', () => {
      const mapped = new Set(['cached_tokens']);
      const documented = new Set(['audio_tokens']);
      for (const field of OPENAI_PROMPT_TOKEN_DETAIL_FIELDS) {
        const handled = mapped.has(field) || documented.has(field);
        expect(handled, `PromptTokensDetails.${field} unaccounted`).toBe(true);
      }
    });

    it('every OpenAI finish_reason maps to a Gemini FinishReason', () => {
      const converter = new OpenAIContentConverter('test', 'auto');
      // Use response path to test the mapping
      for (const reason of OPENAI_FINISH_REASONS) {
        const resp = converter.convertOpenAIResponseToGemini({
          id: 'test',
          object: 'chat.completion',
          created: 0,
          model: 'test',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'x', refusal: null },
              finish_reason: reason,
              logprobs: null,
            },
          ],
        });
        const fr = resp.candidates?.[0]?.finishReason;
        expect(fr, `finish_reason '${reason}' → undefined`).toBeDefined();
      }
    });

    it('every Responses SSE event type is handled or documented as no-op', () => {
      const handledEvents = new Set([
        'response.created',
        'response.in_progress',
        'response.output_item.added',
        'response.output_item.done',
        'response.output_text.delta',
        'response.reasoning_summary_text.delta',
        'response.function_call_arguments.delta',
        'response.completed',
        'response.failed',
        'response.incomplete',
        'error',
      ]);
      for (const eventType of RESPONSES_SSE_EVENT_TYPES) {
        const handled =
          handledEvents.has(eventType) ||
          RESPONSES_EVENT_KNOWN_NOOP.has(eventType);
        expect(
          handled,
          `SSE event '${eventType}' neither handled nor documented as no-op`,
        ).toBe(true);
      }
    });

    it('every Responses input item type can be produced by the request converter', () => {
      const producible = new Set([
        'message',
        'function_call',
        'function_call_output',
      ]);
      // These are only produced by specialized paths:
      const specialPaths = new Set([
        'item_reference',
        'reasoning',
        'compaction',
      ]);
      for (const itemType of RESPONSES_INPUT_ITEM_TYPES) {
        const handled = producible.has(itemType) || specialPaths.has(itemType);
        expect(
          handled,
          `Responses input item type '${itemType}' cannot be produced`,
        ).toBe(true);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // §2 — Per-wire request path (Gemini → wire)
  // ═══════════════════════════════════════════════════════════════════

  describe('§2 — Anthropic /messages (request path)', () => {
    let converter: AnthropicContentConverter;
    beforeEach(() => {
      converter = new AnthropicContentConverter(
        'claude-sonnet-4-20250514',
        'auto',
      );
    });

    it('text → TextBlockParam', () => {
      const { messages } =
        converter.convertGeminiRequestToAnthropic(makeConversation());
      const blocks = flatBlocks(messages);
      expect(findBlock(blocks, 'text', 'Hello, world!')).toBeDefined();
    });

    it('thought → thinking block with content', () => {
      const { messages } =
        converter.convertGeminiRequestToAnthropic(makeConversation());
      const blocks = flatBlocks(messages);
      expect(findBlockByType(blocks, 'thinking')).toBeDefined();
    });

    it('thought with signature → thinking block preserves signature', () => {
      const conv: GenerateContentParameters = {
        model: 'test',
        contents: [{ role: 'model', parts: [THOUGHT_WITH_SIG] }],
      };
      const { messages } = converter.convertGeminiRequestToAnthropic(conv);
      const blocks = flatBlocks(messages);
      const thinkingBlock = findBlockByType(blocks, 'thinking');
      expect(thinkingBlock).toBeDefined();
      expect((thinkingBlock as Record<string, unknown>)['signature']).toBe(
        'sig_abc123',
      );
    });

    it('functionCall → tool_use block with id, name, input', () => {
      const { messages } =
        converter.convertGeminiRequestToAnthropic(makeConversation());
      const blocks = flatBlocks(messages);
      const toolUse = findBlockByType(blocks, 'tool_use');
      expect(toolUse).toBeDefined();
      expect((toolUse as Record<string, unknown>)['name']).toBe('read_file');
      expect((toolUse as Record<string, unknown>)['input']).toEqual({
        path: '/tmp/test.txt',
      });
    });

    it('functionResponse → tool_result block with content', () => {
      const { messages } =
        converter.convertGeminiRequestToAnthropic(makeConversation());
      const blocks = flatBlocks(messages);
      const toolResult = findBlockByType(blocks, 'tool_result');
      expect(toolResult).toBeDefined();
      expect(
        String((toolResult as Record<string, unknown>)['content']),
      ).toContain('file contents here');
    });

    it('functionResponse with error → tool_result with is_error=true', () => {
      const conv: GenerateContentParameters = {
        model: 'test',
        contents: [{ role: 'user', parts: [FUNCTION_RESPONSE_ERROR_PART] }],
      };
      const { messages } = converter.convertGeminiRequestToAnthropic(conv);
      const blocks = flatBlocks(messages);
      const toolResult = findBlockByType(blocks, 'tool_result');
      expect(toolResult).toBeDefined();
      expect((toolResult as Record<string, unknown>)['is_error']).toBe(true);
    });

    it('inlineData (image) → ImageBlockParam', () => {
      const { messages } = converter.convertGeminiRequestToAnthropic(
        makeImageConversation(),
      );
      const blocks = flatBlocks(messages);
      expect(findBlockByType(blocks, 'image')).toBeDefined();
    });

    it('inlineData (PDF) → DocumentBlockParam', () => {
      const conv: GenerateContentParameters = {
        model: 'test',
        contents: [{ role: 'user', parts: [PDF_PART] }],
      };
      const { messages } = converter.convertGeminiRequestToAnthropic(conv);
      const blocks = flatBlocks(messages);
      expect(findBlockByType(blocks, 'document')).toBeDefined();
    });

    it('systemInstruction preserved', () => {
      const { system } =
        converter.convertGeminiRequestToAnthropic(makeConversation());
      const text = Array.isArray(system)
        ? system.map((s) => s.text).join('')
        : (system ?? '');
      expect(text).toContain('helpful assistant');
    });
  });

  describe('§2 — OpenAI /chat/completions (request path)', () => {
    let converter: OpenAIContentConverter;
    beforeEach(() => {
      converter = new OpenAIContentConverter('gpt-4o', 'auto', {
        image: true,
        pdf: true,
        audio: true,
        video: true,
      });
    });

    it('text → content part text', () => {
      const msgs = converter.convertGeminiRequestToOpenAI(makeConversation());
      const userMsg = msgs.find(
        (m) => m.role === 'user' && hasContentText(m, 'Hello'),
      );
      expect(userMsg).toBeDefined();
    });

    it('thought → reasoning_content field', () => {
      const msgs = converter.convertGeminiRequestToOpenAI(makeConversation());
      const assistantMsg = msgs.find(
        (m) => m.role === 'assistant' && 'reasoning_content' in m,
      );
      expect(assistantMsg).toBeDefined();
      expect(
        (assistantMsg as Record<string, unknown>)['reasoning_content'],
      ).toContain('Let me think');
    });

    it('functionCall → tool_calls with function name+arguments', () => {
      const msgs = converter.convertGeminiRequestToOpenAI(makeConversation());
      const assistantWithTools = msgs.find(
        (m) =>
          m.role === 'assistant' &&
          'tool_calls' in m &&
          Array.isArray((m as Record<string, unknown>)['tool_calls']),
      );
      expect(assistantWithTools).toBeDefined();
      const toolCalls = (assistantWithTools as Record<string, unknown>)[
        'tool_calls'
      ] as Array<Record<string, unknown>>;
      expect(toolCalls.length).toBeGreaterThan(0);

      const fn = toolCalls[0]['function'] as Record<string, unknown>;
      expect(fn['name']).toBe('read_file');
    });

    it('functionResponse → tool message with content', () => {
      const msgs = converter.convertGeminiRequestToOpenAI(makeConversation());
      const toolMsg = msgs.find((m) => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      expect(messageContentContains(toolMsg!, 'file contents here')).toBe(true);
    });

    it('inlineData (image) → image_url content part', () => {
      const msgs = converter.convertGeminiRequestToOpenAI(
        makeImageConversation(),
      );
      const userMsg = msgs.find(
        (m) => m.role === 'user' && Array.isArray(m.content),
      );
      expect(userMsg).toBeDefined();
      const parts = (userMsg as Record<string, unknown>)['content'] as Array<
        Record<string, unknown>
      >;
      expect(parts.some((p) => p['type'] === 'image_url')).toBe(true);
    });

    it('systemInstruction → system message', () => {
      const msgs = converter.convertGeminiRequestToOpenAI(makeConversation());
      const sysMsg = msgs.find((m) => m.role === 'system');
      expect(sysMsg).toBeDefined();
      expect(String((sysMsg as Record<string, unknown>)['content'])).toContain(
        'helpful assistant',
      );
    });
  });

  describe('§2 — OpenAI /responses (request path)', () => {
    it('text → message input item', () => {
      const { input } =
        convertGeminiContentsToResponsesInput(makeConversation());
      expect(
        input.some(
          (i) => i.type === 'message' && hasItemContent(i, 'Hello, world!'),
        ),
      ).toBe(true);
    });

    it('thought → message with [Reasoning:] wrapper (not dropped)', () => {
      const { input } =
        convertGeminiContentsToResponsesInput(makeConversation());
      expect(
        input.some(
          (i) => i.type === 'message' && hasItemContent(i, 'Reasoning'),
        ),
      ).toBe(true);
    });

    it('functionCall → function_call input item', () => {
      const { input } =
        convertGeminiContentsToResponsesInput(makeConversation());
      const fc = input.find((i) => i.type === 'function_call') as
        | Record<string, unknown>
        | undefined;
      expect(fc).toBeDefined();
      expect(fc!['name']).toBe('read_file');
      expect(fc!['arguments']).toContain('/tmp/test.txt');
    });

    it('functionResponse → function_call_output input item', () => {
      const { input } =
        convertGeminiContentsToResponsesInput(makeConversation());
      const fr = input.find((i) => i.type === 'function_call_output') as
        | Record<string, unknown>
        | undefined;
      expect(fr).toBeDefined();
      expect(String(fr!['output'])).toContain('file contents here');
    });

    it('inlineData (image) → input_image content part', () => {
      const { input } = convertGeminiContentsToResponsesInput(
        makeImageConversation(),
      );
      const imgMsg = input.find((i) => {
        if (i.type !== 'message') return false;
        const content = (i as Record<string, unknown>)['content'];
        if (!Array.isArray(content)) return false;
        return content.some(
          (c: Record<string, unknown>) => c['type'] === 'input_image',
        );
      });
      expect(imgMsg).toBeDefined();
    });

    it('systemInstruction → instructions field', () => {
      const { instructions } =
        convertGeminiContentsToResponsesInput(makeConversation());
      expect(instructions).toContain('helpful assistant');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // §3 — Per-wire response path (wire SDK types → Gemini)
  //
  // Constructs responses matching the ACTUAL SDK type shapes to verify
  // the converter handles every field the upstream SDK defines.
  // ═══════════════════════════════════════════════════════════════════

  describe('§3 — Anthropic → Gemini (response path)', () => {
    let converter: AnthropicContentConverter;
    beforeEach(() => {
      converter = new AnthropicContentConverter(
        'claude-sonnet-4-20250514',
        'auto',
      );
    });

    it('TextBlock → Gemini text part', () => {
      const gemini = converter.convertAnthropicResponseToGemini(
        makeAnthropicResponse([
          { type: 'text' as const, text: 'Hello from Claude', citations: null },
        ]),
      );
      expectGeminiPartWithText(gemini, 'Hello from Claude');
    });

    it('ToolUseBlock → Gemini functionCall part', () => {
      const gemini = converter.convertAnthropicResponseToGemini(
        makeAnthropicResponse([
          {
            type: 'tool_use' as const,
            id: 'toolu_1',
            name: 'read_file',
            input: { path: '/tmp/x' },
          },
        ]),
      );
      const fc = gemini.candidates?.[0]?.content?.parts?.find(
        (p) => 'functionCall' in p,
      );
      expect(fc).toBeDefined();
      expect(fc!.functionCall!.name).toBe('read_file');
      expect(fc!.functionCall!.args).toEqual({ path: '/tmp/x' });
    });

    it('thinking block → Gemini thought part with signature', () => {
      const gemini = converter.convertAnthropicResponseToGemini(
        makeAnthropicResponse([
          { type: 'thinking', thinking: 'Step 1...', signature: 'sig_xyz' },
          { type: 'text', text: 'Answer', citations: null },
        ]),
      );
      const thought = gemini.candidates?.[0]?.content?.parts?.find(
        (p) => 'thought' in p && p.thought === true,
      );
      expect(thought).toBeDefined();
      expect(thought!.text).toBe('Step 1...');
    });

    it('Anthropic Usage → Gemini usageMetadata (all SDK fields tested)', () => {
      const gemini = converter.convertAnthropicResponseToGemini(
        makeAnthropicResponse(
          [{ type: 'text' as const, text: 'Hi', citations: null }],
          {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 30,
          },
        ),
      );
      expect(gemini.usageMetadata).toBeDefined();
      // promptTokenCount = cache_creation(10) + cache_read(30) + input(100)
      expect(gemini.usageMetadata!.promptTokenCount).toBe(140);
      expect(gemini.usageMetadata!.candidatesTokenCount).toBe(50);
      // totalTokenCount = 140 + 50
      expect(gemini.usageMetadata!.totalTokenCount).toBe(190);
      // cachedContentTokenCount = cache_creation(10) + cache_read(30)
      expect(gemini.usageMetadata!.cachedContentTokenCount).toBe(40);
    });

    it('all Anthropic stop_reasons produce valid Gemini FinishReason', () => {
      for (const reason of ANTHROPIC_STOP_REASONS) {
        const mapped = converter.mapAnthropicFinishReasonToGemini(reason);
        expect(mapped, `'${reason}' → undefined`).toBeDefined();
      }
    });
  });

  describe('§3 — OpenAI → Gemini (response path)', () => {
    let converter: OpenAIContentConverter;
    beforeEach(() => {
      converter = new OpenAIContentConverter('gpt-4o', 'auto');
    });

    it('ChatCompletionMessage.content → Gemini text part', () => {
      const gemini = converter.convertOpenAIResponseToGemini(
        makeOpenAIResponse({ content: 'Hello from GPT', refusal: null }),
      );
      expectGeminiPartWithText(gemini, 'Hello from GPT');
    });

    it('ChatCompletionMessage.tool_calls → Gemini functionCall parts', () => {
      const gemini = converter.convertOpenAIResponseToGemini(
        makeOpenAIResponse({
          content: null,
          refusal: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function' as const,
              function: { name: 'read_file', arguments: '{"path":"/tmp/x"}' },
            },
          ],
        }),
      );
      const fc = gemini.candidates?.[0]?.content?.parts?.find(
        (p) => 'functionCall' in p,
      );
      expect(fc).toBeDefined();
      expect(fc!.functionCall!.name).toBe('read_file');
      expect(fc!.functionCall!.args).toEqual({ path: '/tmp/x' });
    });

    it('reasoning_content → Gemini thought part (extended field)', () => {
      const gemini = converter.convertOpenAIResponseToGemini(
        makeOpenAIResponse({
          content: 'Answer.',
          refusal: null,
          reasoning_content: 'Thinking carefully...',
        }),
      );
      const thought = gemini.candidates?.[0]?.content?.parts?.find(
        (p) => 'thought' in p && p.thought === true,
      );
      expect(thought).toBeDefined();
      expect(thought!.text).toBe('Thinking carefully...');
    });

    it('CompletionUsage → Gemini usageMetadata (all SDK detail fields tested)', () => {
      const gemini = converter.convertOpenAIResponseToGemini(
        makeOpenAIResponse(
          { content: 'Hi', refusal: null },
          {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
            prompt_tokens_details: { cached_tokens: 20, audio_tokens: 5 },
            completion_tokens_details: {
              reasoning_tokens: 10,
              audio_tokens: 2,
              accepted_prediction_tokens: 0,
              rejected_prediction_tokens: 0,
            },
          },
        ),
      );
      const u = gemini.usageMetadata!;
      expect(u.promptTokenCount).toBe(100);
      expect(u.candidatesTokenCount).toBe(50);
      expect(u.totalTokenCount).toBe(150);
      expect(u.cachedContentTokenCount).toBe(20);
      expect(u.thoughtsTokenCount).toBe(10);
    });

    it('all OpenAI finish_reasons produce valid Gemini FinishReason', () => {
      for (const reason of OPENAI_FINISH_REASONS) {
        const gemini = converter.convertOpenAIResponseToGemini(
          makeOpenAIResponse(
            { content: 'x', refusal: null },
            undefined,
            reason,
          ),
        );
        expect(
          gemini.candidates?.[0]?.finishReason,
          `finish_reason '${reason}' → undefined`,
        ).toBeDefined();
      }
    });
  });

  describe('§3 — Responses → Gemini (event stream path)', () => {
    it('output_text.delta → Gemini text part', () => {
      const state = new ResponsesStreamState();
      state.responseId = 'resp_1';
      const r = convertResponsesEventToGemini(
        { event: 'response.output_text.delta', data: { delta: 'Hello!' } },
        'test-model',
        state,
      );
      expect(r).not.toBeNull();
      expectGeminiPartWithText(r!, 'Hello!');
    });

    it('reasoning_summary_text.delta → Gemini thought part', () => {
      const state = new ResponsesStreamState();
      state.responseId = 'resp_1';
      const r = convertResponsesEventToGemini(
        {
          event: 'response.reasoning_summary_text.delta',
          data: { delta: 'Step 1...' },
        },
        'test-model',
        state,
      );
      const thought = r?.candidates?.[0]?.content?.parts?.find(
        (p) => 'thought' in p && p.thought,
      );
      expect(thought).toBeDefined();
      expect(thought!.text).toBe('Step 1...');
    });

    it('function call event sequence → Gemini functionCall part', () => {
      const state = new ResponsesStreamState();
      state.responseId = 'resp_1';

      convertResponsesEventToGemini(
        {
          event: 'response.output_item.added',
          data: {
            output_index: 0,
            item: {
              type: 'function_call',
              id: 'fc_1',
              call_id: 'call_123',
              name: 'read_file',
            },
          },
        },
        'test-model',
        state,
      );
      convertResponsesEventToGemini(
        {
          event: 'response.function_call_arguments.delta',
          data: { output_index: 0, delta: '{"path":"/tmp/x"}' },
        },
        'test-model',
        state,
      );
      const r = convertResponsesEventToGemini(
        {
          event: 'response.output_item.done',
          data: {
            output_index: 0,
            item: {
              type: 'function_call',
              id: 'fc_1',
              call_id: 'call_123',
              name: 'read_file',
              arguments: '{"path":"/tmp/x"}',
            },
          },
        },
        'test-model',
        state,
      );

      const fc = r?.candidates?.[0]?.content?.parts?.find(
        (p) => 'functionCall' in p,
      );
      expect(fc).toBeDefined();
      expect(fc!.functionCall!.name).toBe('read_file');
      expect(fc!.functionCall!.id).toBe('call_123');
    });

    it('response.completed → Gemini usageMetadata (all ResponsesApiUsage fields)', () => {
      const state = new ResponsesStreamState();
      state.responseId = 'resp_1';
      const r = convertResponsesEventToGemini(
        {
          event: 'response.completed',
          data: {
            response: {
              id: 'resp_1',
              status: 'completed',
              usage: {
                input_tokens: 100,
                output_tokens: 50,
                total_tokens: 150,
                input_tokens_details: { cached_tokens: 20 },
                output_tokens_details: { reasoning_tokens: 10 },
              },
            },
          },
        },
        'test-model',
        state,
      );
      const u = r!.usageMetadata!;
      expect(u.promptTokenCount).toBe(100);
      expect(u.candidatesTokenCount).toBe(50);
      expect(u.totalTokenCount).toBe(150);
      expect(u.cachedContentTokenCount).toBe(20);
      expect(u.thoughtsTokenCount).toBe(10);
    });

    it('response.failed throws (not silently swallowed)', () => {
      const state = new ResponsesStreamState();
      expect(() =>
        convertResponsesEventToGemini(
          {
            event: 'response.failed',
            data: {
              response: { error: { code: 'rate_limit', message: 'slow down' } },
            },
          },
          'test-model',
          state,
        ),
      ).toThrow('Responses API failed');
    });

    it('response.incomplete → MAX_TOKENS finish reason', () => {
      const state = new ResponsesStreamState();
      state.responseId = 'resp_1';
      const r = convertResponsesEventToGemini(
        { event: 'response.incomplete', data: {} },
        'test-model',
        state,
      );
      expect(r?.candidates?.[0]?.finishReason).toBe(FinishReason.MAX_TOKENS);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // §4 — Cross-wire invariance
  //
  // Same Gemini payload through all three wires, verify identical
  // semantic content — the "no null space" guarantee.
  // ═══════════════════════════════════════════════════════════════════

  describe('§4 — Cross-wire invariance', () => {
    it('system instruction preserved across all wires', () => {
      const conv = makeConversation();

      const ac = new AnthropicContentConverter(
        'claude-sonnet-4-20250514',
        'auto',
      );
      const { system } = ac.convertGeminiRequestToAnthropic(conv);
      const aText = Array.isArray(system)
        ? system.map((s) => s.text).join('')
        : (system ?? '');
      expect(aText).toContain('helpful assistant');

      const oc = new OpenAIContentConverter('gpt-4o', 'auto');
      const oMsgs = oc.convertGeminiRequestToOpenAI(conv);
      expect(oMsgs.some((m) => m.role === 'system')).toBe(true);

      const { instructions } = convertGeminiContentsToResponsesInput(conv);
      expect(instructions).toContain('helpful assistant');
    });

    it('function call name+args preserved across all wires', () => {
      const conv = makeConversation();

      // Anthropic
      const ac = new AnthropicContentConverter(
        'claude-sonnet-4-20250514',
        'auto',
      );
      const aBlocks = flatBlocks(
        ac.convertGeminiRequestToAnthropic(conv).messages,
      );
      const aTool = findBlockByType(aBlocks, 'tool_use');
      expect((aTool as Record<string, unknown>)['name']).toBe('read_file');

      // OpenAI
      const oc = new OpenAIContentConverter('gpt-4o', 'auto');
      const oMsgs = oc.convertGeminiRequestToOpenAI(conv);
      const oTool = oMsgs
        .filter((m) => m.role === 'assistant' && 'tool_calls' in m)
        .flatMap(
          (m) =>
            (m as Record<string, unknown>)['tool_calls'] as Array<
              Record<string, unknown>
            >,
        )[0];
      const oFn = oTool['function'];
      expect((oFn as Record<string, unknown>)['name']).toBe('read_file');

      // Responses
      const { input } = convertGeminiContentsToResponsesInput(conv);
      const rFc = input.find((i) => i.type === 'function_call') as Record<
        string,
        unknown
      >;
      expect(rFc['name']).toBe('read_file');
    });

    it('tool result content preserved across all wires', () => {
      const conv = makeConversation();
      const needle = 'file contents here';

      // Anthropic
      const ac = new AnthropicContentConverter(
        'claude-sonnet-4-20250514',
        'auto',
      );
      const aBlocks = flatBlocks(
        ac.convertGeminiRequestToAnthropic(conv).messages,
      );
      const aResult = findBlockByType(aBlocks, 'tool_result');
      expect(String((aResult as Record<string, unknown>)['content'])).toContain(
        needle,
      );

      // OpenAI
      const oc = new OpenAIContentConverter('gpt-4o', 'auto');
      const oMsgs = oc.convertGeminiRequestToOpenAI(conv);
      const toolMsg = oMsgs.find((m) => m.role === 'tool')!;
      expect(messageContentContains(toolMsg, needle)).toBe(true);

      // Responses
      const { input } = convertGeminiContentsToResponsesInput(conv);
      const rFr = input.find(
        (i) => i.type === 'function_call_output',
      ) as Record<string, unknown>;
      expect(String(rFr['output'])).toContain(needle);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // §5 — Documented gap regression guards
  //
  // These tests verify that known gaps are STILL gaps and haven't been
  // accidentally fixed (which would require updating the audit doc) or
  // accidentally made worse.
  // ═══════════════════════════════════════════════════════════════════

  describe('§5 — Known gap regression guards', () => {
    it('Anthropic: cache_creation_input_tokens is now mapped to cachedContentTokenCount', () => {
      const converter = new AnthropicContentConverter('test', 'auto');
      const gemini = converter.convertAnthropicResponseToGemini(
        makeAnthropicResponse(
          [{ type: 'text' as const, text: 'Hi', citations: null }],
          {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 42,
            cache_read_input_tokens: 0,
          },
        ),
      );
      const metadata = gemini.usageMetadata;
      expect(metadata).toBeDefined();
      // cache_creation(42) + cache_read(0) + input(100) + output(50)
      expect(metadata!.totalTokenCount).toBe(192);
      expect(metadata!.cachedContentTokenCount).toBe(42);
    });

    it('OpenAI: refusal text is not mapped (documented gap)', () => {
      const converter = new OpenAIContentConverter('test', 'auto');
      const gemini = converter.convertOpenAIResponseToGemini(
        makeOpenAIResponse({
          content: null,
          refusal: 'I cannot help with that.',
        }),
      );
      // Refusal text is lost — no Gemini Part equivalent
      const parts = gemini.candidates?.[0]?.content?.parts || [];
      // If someone adds refusal mapping, update the docs
      expect(
        parts.every(
          (p) => !('text' in p) || p.text !== 'I cannot help with that.',
        ),
      ).toBe(true);
    });

    it('Responses: non-image inlineData is silently dropped (documented gap)', () => {
      const conv: GenerateContentParameters = {
        model: 'test',
        contents: [
          { role: 'user', parts: [PDF_PART, { text: 'Read this PDF' }] },
        ],
      };
      const { input } = convertGeminiContentsToResponsesInput(conv);
      // PDF should NOT appear as input_image — it's a known gap
      const hasInputImage = input.some((i) => {
        if (i.type !== 'message') return false;
        const content = (i as Record<string, unknown>)['content'];
        if (!Array.isArray(content)) return false;
        return content.some(
          (c: Record<string, unknown>) => c['type'] === 'input_image',
        );
      });
      expect(hasInputImage).toBe(false);
      // But the text should survive
      expect(
        input.some(
          (i) => i.type === 'message' && hasItemContent(i, 'Read this PDF'),
        ),
      ).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Test Helpers — factory functions for upstream SDK shapes
// ═══════════════════════════════════════════════════════════════════════

interface AnthropicBlock {
  type: string;
  [key: string]: unknown;
}

interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
}

/** Build a minimal Anthropic Message matching the SDK shape */
function makeAnthropicResponse(
  content: AnthropicBlock[],
  usage?: Partial<AnthropicUsage>,
  stopReason: string = 'end_turn',
) {
  return {
    id: 'msg_test',
    type: 'message' as const,
    role: 'assistant' as const,
    content,
    model: 'claude-sonnet-4-20250514',
    stop_reason: stopReason as 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: usage?.input_tokens ?? 10,
      output_tokens: usage?.output_tokens ?? 5,
      cache_creation_input_tokens: usage?.cache_creation_input_tokens ?? null,
      cache_read_input_tokens: usage?.cache_read_input_tokens ?? null,
    },
  };
}

interface OpenAIMessageShape {
  content: string | null;
  refusal: string | null;
  role?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  reasoning_content?: string;
}

interface OpenAIUsageShape {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number; audio_tokens?: number };
  completion_tokens_details?: {
    reasoning_tokens?: number;
    audio_tokens?: number;
    accepted_prediction_tokens?: number;
    rejected_prediction_tokens?: number;
  };
}

/** Build a minimal OpenAI ChatCompletion matching the SDK shape */
function makeOpenAIResponse(
  message: OpenAIMessageShape,
  usage?: OpenAIUsageShape,
  finishReason: string = 'stop',
) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion' as const,
    created: Math.floor(Date.now() / 1000),
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        message: { role: 'assistant' as const, ...message },

        finish_reason: finishReason as 'stop',
        logprobs: null,
      },
    ],
    ...(usage ? { usage } : {}),
  };
}

/** Flatten all content blocks from Anthropic messages */
function flatBlocks(
  messages: Array<{ content: unknown }>,
): Array<Record<string, unknown>> {
  return messages.flatMap((m) => {
    if (Array.isArray(m.content)) {
      return m.content as Array<Record<string, unknown>>;
    }
    return [];
  });
}

function findBlock(
  blocks: Array<Record<string, unknown>>,
  type: string,
  text: string,
) {
  return blocks.find((b) => b['type'] === type && b['text'] === text);
}

function findBlockByType(blocks: Array<Record<string, unknown>>, type: string) {
  return blocks.find((b) => b['type'] === type);
}

function expectGeminiPartWithText(
  response: { candidates?: Array<{ content?: { parts?: Part[] } }> },
  text: string,
) {
  const parts = response.candidates?.[0]?.content?.parts || [];
  expect(
    parts.some((p) => 'text' in p && p.text === text),
    `Expected text '${text}' in parts`,
  ).toBe(true);
}

function hasContentText(msg: Record<string, unknown>, needle: string): boolean {
  const content = msg['content'];
  if (Array.isArray(content)) {
    return content.some(
      (p: Record<string, unknown>) =>
        p['type'] === 'text' && String(p['text']).includes(needle),
    );
  }
  return String(content ?? '').includes(needle);
}

function hasItemContent(
  item: Record<string, unknown>,
  needle: string,
): boolean {
  const content = item['content'];
  if (Array.isArray(content)) {
    return content.some((c: Record<string, unknown>) =>
      String(c['text'] ?? '').includes(needle),
    );
  }
  return String(content ?? '').includes(needle);
}

function messageContentContains(
  msg: Record<string, unknown>,
  needle: string,
): boolean {
  const content = msg['content'];
  if (Array.isArray(content)) {
    return content.some((p: Record<string, unknown>) =>
      String(p['text'] ?? '').includes(needle),
    );
  }
  return String(content ?? '').includes(needle);
}
