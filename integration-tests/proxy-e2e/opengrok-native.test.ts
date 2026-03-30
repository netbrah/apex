/**
 * Proxy harness test for native OpenGrok tools.
 *
 * Run manually with:
 *   PROXY_OPENGROK_E2E=1 npx vitest run --root ./integration-tests proxy-e2e/opengrok-native.test.ts
 */

import { describe, expect, it } from 'vitest';
import { runProxy, DEFAULT_GPT_MODEL } from './helpers/proxy-rig.js';

const RUN_PROXY_OPENGROK = process.env.PROXY_OPENGROK_E2E === '1';
const describeProxy = RUN_PROXY_OPENGROK ? describe : describe.skip;

describeProxy('Proxy Native OpenGrok Tools', () => {
  it('GPT uses native search tool for symbol definition lookup', async () => {
    const result = await runProxy(
      'Use the search tool with definition "deleteKeyFromLocalCryptomod" and return only the first matching file path.',
      DEFAULT_GPT_MODEL,
    );

    expect(result.isError).toBe(false);
    expect(result.response).toContain('/');
    expect(result.response.toLowerCase()).toContain('keymanager');
  }, 120_000);
});
