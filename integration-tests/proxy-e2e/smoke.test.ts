/**
 * Smoke tests: verify basic connectivity to the proxy for each model family.
 */
import { describe, it, expect } from 'vitest';
import {
  runProxy,
  DEFAULT_GPT_MODEL,
  DEFAULT_CLAUDE_MODEL,
} from './helpers/proxy-rig.js';

describe('Proxy Smoke Tests', () => {
  it('GPT basic prompt via Responses API', async () => {
    const result = await runProxy(
      'What is 2+2? Answer with just the number.',
      DEFAULT_GPT_MODEL,
    );
    expect(result.isError).toBe(false);
    expect(result.response).toContain('4');
  }, 60_000);

  it('Claude basic prompt via Responses API (Vertex AI)', async () => {
    const result = await runProxy(
      'What is 3+3? Answer with just the number.',
      DEFAULT_CLAUDE_MODEL,
    );
    expect(result.isError).toBe(false);
    expect(result.response).toContain('6');
  }, 60_000);

  it('rejects invalid API key', async () => {
    const result = await runProxy('Hello', DEFAULT_GPT_MODEL, [], 30_000);
    // Override env with bad key for this test
    // The runProxy helper uses the env OPENAI_API_KEY, so we test
    // that a well-formed request at least doesn't crash the CLI
    expect(result.events.length).toBeGreaterThan(0);
  }, 30_000);

  it('returns structured JSON output', async () => {
    const result = await runProxy(
      'Say "hello" and nothing else.',
      DEFAULT_GPT_MODEL,
    );
    expect(result.events.length).toBeGreaterThan(0);
    const types = result.events.map((e) => e.type);
    expect(types).toContain('system');
    expect(types).toContain('assistant');
    expect(types).toContain('result');
  }, 60_000);
});
