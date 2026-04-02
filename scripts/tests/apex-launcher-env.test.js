/**
 * @license
 * Copyright 2026 NetApp
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildApexRuntimeEnv,
  DEFAULT_APEX_MODEL,
  DEFAULT_PROXY_ENDPOINT,
  deriveConfluenceUsername,
  hasCliModelArg,
  resolveProxyKey,
  trustedFoldersPayload,
} from '../apex-launcher-env.js';

describe('apex-launcher-env', () => {
  it('builds runtime env from proxy key and defaults', () => {
    const { env, model, proxyKey } = buildApexRuntimeEnv({
      baseEnv: {
        APEX_LLM_PROXY_KEY: 'user=palanisd&key=abc123',
      },
      apexHome: '/tmp/apex',
      fileExists: (path) => path === '/tmp/apex/ca-bundle.pem',
      versions: { mastra: 'latest', rb: 'latest', cit: 'latest' },
    });

    expect(proxyKey).toBe('user=palanisd&key=abc123');
    expect(model).toBe(DEFAULT_APEX_MODEL);
    expect(env.APEX_HOME).toBe('/tmp/apex');
    expect(env.OPENAI_COMPATIBLE_ENDPOINT).toBe(DEFAULT_PROXY_ENDPOINT);
    expect(env.OPENAI_API_KEY).toBe('user=palanisd&key=abc123');
    expect(env.ANTHROPIC_API_KEY).toBe('user=palanisd&key=abc123');
    expect(env.OPENAI_BASE_URL).toBe(DEFAULT_PROXY_ENDPOINT);
    expect(env.ANTHROPIC_BASE_URL).toBe(DEFAULT_PROXY_ENDPOINT);
    expect(env.MASTRA_BIN).toBe(
      '/tmp/apex/bin/mastra-search-mcp-latest/mastra-search-mcp',
    );
    expect(env.RB_INDEX).toBe('/tmp/apex/bin/reviewboard-mcp-latest/index.js');
    expect(env.CIT_BIN).toBe('/tmp/apex/bin/cit-mcp-latest');
    expect(env.NODE_EXTRA_CA_CERTS).toBe('/tmp/apex/ca-bundle.pem');
  });

  it('preserves explicit runtime overrides', () => {
    const { env } = buildApexRuntimeEnv({
      baseEnv: {
        OPENAI_API_KEY: 'custom-key',
        OPENAI_BASE_URL: 'https://custom.example.com',
        ANTHROPIC_API_KEY: 'anth-key',
        ANTHROPIC_BASE_URL: 'https://anthropic.example.com',
        MASTRA_BIN: '/custom/mastra',
        NODE_EXTRA_CA_CERTS: '/custom/ca.pem',
      },
      apexHome: '/tmp/apex',
      fileExists: () => false,
    });

    expect(env.OPENAI_API_KEY).toBe('custom-key');
    expect(env.OPENAI_BASE_URL).toBe('https://custom.example.com');
    expect(env.ANTHROPIC_API_KEY).toBe('anth-key');
    expect(env.ANTHROPIC_BASE_URL).toBe('https://anthropic.example.com');
    expect(env.MASTRA_BIN).toBe('/custom/mastra');
    expect(env.NODE_EXTRA_CA_CERTS).toBe('/custom/ca.pem');
  });

  it('resolves proxy key fallback order', () => {
    expect(
      resolveProxyKey({
        APEX_LLM_PROXY_KEY: 'a',
        CODEX_LLM_PROXY_KEY: 'b',
        LLM_PROXY_KEY: 'c',
      }),
    ).toBe('a');
    expect(
      resolveProxyKey({ CODEX_LLM_PROXY_KEY: 'b', LLM_PROXY_KEY: 'c' }),
    ).toBe('b');
    expect(resolveProxyKey({ LLM_PROXY_KEY: 'c' })).toBe('c');
    expect(resolveProxyKey({})).toBe('');
  });

  it('handles model flag detection and utility helpers', () => {
    expect(hasCliModelArg(['--help'])).toBe(false);
    expect(hasCliModelArg(['--model', 'claude-opus-4.6'])).toBe(true);
    expect(hasCliModelArg(['-m', 'claude-opus-4.6'])).toBe(true);
    expect(deriveConfluenceUsername('palanisd')).toBe('palanisd@netapp.com');
    expect(deriveConfluenceUsername('a@netapp.com')).toBe('a@netapp.com');
    expect(trustedFoldersPayload('/tmp/workspace')).toBe(
      '{"/tmp/workspace":"TRUST_PARENT"}\n',
    );
  });
});
