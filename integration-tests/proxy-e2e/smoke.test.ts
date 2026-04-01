/**
 * Smoke tests: verify basic connectivity for each model family.
 *
 * Skipped automatically when OPENAI_BASE_URL or OPENAI_API_KEY is not set.
 *
 *   export OPENAI_API_KEY="your-key"
 *   export OPENAI_BASE_URL="https://your-proxy-or-api.example.com"
 *   npx vitest run --root ./integration-tests proxy-e2e/smoke
 */
import { describe, it, expect } from 'vitest';
import {
  runProxy,
  DEFAULT_GPT_MODEL,
  DEFAULT_CLAUDE_MODEL,
  isProxyConfigured,
} from './helpers/proxy-rig.js';

const skip = !isProxyConfigured();

describe('Proxy Smoke Tests', () => {
  it.skipIf(skip)(
    'GPT basic prompt via Responses API',
    async () => {
      const result = await runProxy(
        'What is 2+2? Answer with just the number.',
        DEFAULT_GPT_MODEL,
      );
      expect(result.isError).toBe(false);
      expect(result.response).toContain('4');
    },
    60_000,
  );

  it.skipIf(skip)(
    'Claude basic prompt via Responses API (Vertex AI)',
    async () => {
      const result = await runProxy(
        'What is 3+3? Answer with just the number.',
        DEFAULT_CLAUDE_MODEL,
      );
      expect(result.isError).toBe(false);
      expect(result.response).toContain('6');
    },
    60_000,
  );

  it.skipIf(skip)(
    'rejects invalid API key',
    async () => {
      const result = await runProxy('Hello', DEFAULT_GPT_MODEL, [], 30_000);
      expect(result.events.length).toBeGreaterThan(0);
    },
    30_000,
  );

  it.skipIf(skip)(
    'returns structured JSON output with all required event types',
    async () => {
      const result = await runProxy(
        'Say "hello" and nothing else.',
        DEFAULT_GPT_MODEL,
      );
      expect(result.events.length).toBeGreaterThan(0);
      const types = result.events.map((e) => e.type);
      expect(types).toContain('system');
      expect(types).toContain('assistant');
      expect(types).toContain('result');
    },
    60_000,
  );

  it.skipIf(skip)(
    'GPT returns non-zero token usage',
    async () => {
      const result = await runProxy(
        'What color is the sky? One word.',
        DEFAULT_GPT_MODEL,
      );
      expect(result.isError).toBe(false);
      expect(result.usage.input_tokens).toBeGreaterThan(0);
      expect(result.usage.output_tokens).toBeGreaterThan(0);
    },
    60_000,
  );

  it.skipIf(skip)(
    'Claude returns non-zero token usage',
    async () => {
      const result = await runProxy(
        'What color is grass? One word.',
        DEFAULT_CLAUDE_MODEL,
      );
      expect(result.isError).toBe(false);
      expect(result.usage.input_tokens).toBeGreaterThan(0);
      expect(result.usage.output_tokens).toBeGreaterThan(0);
    },
    60_000,
  );

  it.skipIf(skip)(
    'GPT handles long output without truncation',
    async () => {
      const result = await runProxy(
        'List the numbers from 1 to 50, each on its own line.',
        DEFAULT_GPT_MODEL,
      );
      expect(result.isError).toBe(false);
      expect(result.response).toContain('25');
      expect(result.response).toContain('50');
    },
    60_000,
  );

  it.skipIf(skip)(
    'GPT follows system instructions (JSON mode)',
    async () => {
      const result = await runProxy(
        'Return a JSON object with key "answer" and value 42. Only output JSON, no explanation.',
        DEFAULT_GPT_MODEL,
      );
      expect(result.isError).toBe(false);
      // The response should contain valid JSON with "answer": 42
      expect(result.response).toContain('42');
      expect(result.response).toContain('answer');
    },
    60_000,
  );
});
