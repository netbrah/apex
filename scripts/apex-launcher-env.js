/**
 * @license
 * Copyright 2026 NetApp
 * SPDX-License-Identifier: Apache-2.0
 */

import { join } from 'node:path';

export const DEFAULT_PROXY_ENDPOINT = 'https://llm-proxy-api.ai.eng.netapp.com';
export const DEFAULT_APEX_MODEL = 'claude-opus-4.6';

export function resolveProxyKey(env) {
  return (
    env.APEX_LLM_PROXY_KEY || env.CODEX_LLM_PROXY_KEY || env.LLM_PROXY_KEY || ''
  );
}

export function hasCliModelArg(argv) {
  return argv.includes('--model') || argv.includes('-m');
}

export function deriveConfluenceUsername(userName) {
  if (!userName) {
    return '';
  }
  return userName.includes('@') ? userName : `${userName}@netapp.com`;
}

export function trustedFoldersPayload(workspaceRoot) {
  return JSON.stringify({ [workspaceRoot]: 'TRUST_PARENT' }) + '\n';
}

export function detectPreferredCaBundle({ apexHome, fileExists }) {
  const candidates = [
    join(apexHome, 'ca-bundle.pem'),
    '/etc/pki/tls/certs/ca-bundle.crt',
    '/etc/ssl/certs/ca-certificates.crt',
  ];
  return candidates.find((candidate) => fileExists(candidate));
}

export function buildApexRuntimeEnv({
  baseEnv,
  apexHome,
  fileExists,
  versions = {},
}) {
  const env = { ...baseEnv };
  const model = env.APEX_MODEL || DEFAULT_APEX_MODEL;
  const proxyKey = resolveProxyKey(env);
  const endpoint = env.OPENAI_COMPATIBLE_ENDPOINT || DEFAULT_PROXY_ENDPOINT;

  const mastraVersion = versions.mastra || env.MASTRA_VERSION || 'latest';
  const rbVersion = versions.rb || env.RB_VERSION || 'latest';
  const citVersion = versions.cit || env.CIT_VERSION || 'latest';

  if (!env.QWEN_CODE_HOME) {
    env.QWEN_CODE_HOME = apexHome;
  }

  if (!env.OPENAI_COMPATIBLE_ENDPOINT) {
    env.OPENAI_COMPATIBLE_ENDPOINT = endpoint;
  }
  if (!env.OPENAI_COMPATIBLE_MODEL) {
    env.OPENAI_COMPATIBLE_MODEL = model;
  }

  if (proxyKey) {
    if (!env.OPENAI_COMPATIBLE_API_KEY) {
      env.OPENAI_COMPATIBLE_API_KEY = proxyKey;
    }
    if (!env.OPENAI_API_KEY) {
      env.OPENAI_API_KEY = proxyKey;
    }
    if (!env.ANTHROPIC_API_KEY) {
      env.ANTHROPIC_API_KEY = proxyKey;
    }
  }

  if (!env.OPENAI_BASE_URL) {
    env.OPENAI_BASE_URL = env.OPENAI_COMPATIBLE_ENDPOINT;
  }
  if (!env.ANTHROPIC_BASE_URL) {
    env.ANTHROPIC_BASE_URL = env.OPENAI_COMPATIBLE_ENDPOINT;
  }

  if (!env.MASTRA_BIN) {
    env.MASTRA_BIN = join(
      apexHome,
      'bin',
      `mastra-search-mcp-${mastraVersion}`,
      'mastra-search-mcp',
    );
  }
  if (!env.MASTRA_NODE_PATH) {
    env.MASTRA_NODE_PATH = join(
      apexHome,
      'bin',
      `mastra-search-mcp-${mastraVersion}`,
      'node_modules',
    );
  }
  if (!env.RB_INDEX) {
    env.RB_INDEX = join(
      apexHome,
      'bin',
      `reviewboard-mcp-${rbVersion}`,
      'index.js',
    );
  }
  if (!env.CIT_BIN) {
    env.CIT_BIN = join(apexHome, 'bin', `cit-mcp-${citVersion}`);
  }

  if (!env.NODE_EXTRA_CA_CERTS) {
    const detectedCaBundle = detectPreferredCaBundle({ apexHome, fileExists });
    if (detectedCaBundle) {
      env.NODE_EXTRA_CA_CERTS = detectedCaBundle;
    }
  }

  return { env, model, proxyKey };
}
