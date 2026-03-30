/**
 * Smoke tests: verify basic connectivity to the proxy for each model family.
 *
 * Skipped automatically when OPENAI_BASE_URL or OPENAI_API_KEY is not set.
 * No corp URLs are hardcoded here — set env vars to run against any endpoint:
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

const proxyAvailable = isProxyConfigured();

describe('Proxy Smoke Tests', () => {
  it.skipIf(!proxyAvailable)(
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

  it.skipIf(!proxyAvailable)(
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

  it.skipIf(!proxyAvailable)(
    'rejects invalid API key',
    async () => {
      const result = await runProxy('Hello', DEFAULT_GPT_MODEL, [], 30_000);
      expect(result.events.length).toBeGreaterThan(0);
    },
    30_000,
  );

  it.skipIf(!proxyAvailable)(
    'returns structured JSON output',
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
});
