/**
 * Wire compatibility tests: verify cross-provider behavior parity.
 *
 * These tests ensure both GPT and Claude produce equivalent
 * structured outputs and handle edge cases identically.
 */
import { describe, it, expect } from 'vitest';
import {
  runProxy,
  DEFAULT_GPT_MODEL,
  DEFAULT_CLAUDE_MODEL,
  isProxyConfigured,
} from './helpers/proxy-rig.js';

const skip = !isProxyConfigured();

describe('Wire Compatibility', () => {
  describe('Event structure parity', () => {
    it.skipIf(skip)(
      'GPT and Claude both produce system + assistant + result events',
      async () => {
        const prompt = 'Say "parity check" and nothing else.';

        const [gpt, claude] = await Promise.all([
          runProxy(prompt, DEFAULT_GPT_MODEL),
          runProxy(prompt, DEFAULT_CLAUDE_MODEL),
        ]);

        for (const result of [gpt, claude]) {
          expect(result.isError).toBe(false);
          const types = result.events.map((e) => e.type);
          expect(types).toContain('system');
          expect(types).toContain('assistant');
          expect(types).toContain('result');
        }
      },
      90_000,
    );

    it.skipIf(skip)(
      'both models report token usage',
      async () => {
        const prompt = 'What is the capital of France? One word.';

        const [gpt, claude] = await Promise.all([
          runProxy(prompt, DEFAULT_GPT_MODEL),
          runProxy(prompt, DEFAULT_CLAUDE_MODEL),
        ]);

        for (const result of [gpt, claude]) {
          expect(result.isError).toBe(false);
          expect(result.usage.input_tokens).toBeGreaterThan(0);
          expect(result.usage.output_tokens).toBeGreaterThan(0);
        }
      },
      90_000,
    );
  });

  describe('Edge cases', () => {
    it.skipIf(skip)(
      'GPT handles empty prompt gracefully',
      async () => {
        const result = await runProxy(' ', DEFAULT_GPT_MODEL);
        // Should not crash — may return an error or a response
        expect(result.events.length).toBeGreaterThan(0);
      },
      60_000,
    );

    it.skipIf(skip)(
      'GPT handles unicode and emoji',
      async () => {
        const result = await runProxy(
          'Repeat this exactly: "こんにちは 🌍". Nothing else.',
          DEFAULT_GPT_MODEL,
        );
        expect(result.isError).toBe(false);
        expect(result.response).toContain('こんにちは');
      },
      60_000,
    );

    it.skipIf(skip)(
      'Claude handles unicode and emoji',
      async () => {
        const result = await runProxy(
          'Repeat this exactly: "café ☕". Nothing else.',
          DEFAULT_CLAUDE_MODEL,
        );
        expect(result.isError).toBe(false);
        expect(result.response).toContain('café');
      },
      60_000,
    );

    it.skipIf(skip)(
      'GPT handles very long prompt without error',
      async () => {
        const longInput = 'word '.repeat(500);
        const result = await runProxy(
          `Count the approximate number of times the word "word" appears in the following text. Just give the number.\n\n${longInput}`,
          DEFAULT_GPT_MODEL,
        );
        expect(result.isError).toBe(false);
        expect(result.response.length).toBeGreaterThan(0);
      },
      90_000,
    );
  });

  describe('Tool behavior parity', () => {
    it.skipIf(skip)(
      'both models can execute shell commands',
      async () => {
        const prompt =
          'Run the command "echo PARITY_CHECK" in the shell. Tell me the exact output. Nothing else.';

        const [gpt, claude] = await Promise.all([
          runProxy(prompt, DEFAULT_GPT_MODEL),
          runProxy(prompt, DEFAULT_CLAUDE_MODEL),
        ]);

        expect(gpt.isError).toBe(false);
        expect(gpt.response).toContain('PARITY_CHECK');

        expect(claude.isError).toBe(false);
        expect(claude.response).toContain('PARITY_CHECK');
      },
      120_000,
    );
  });
});
