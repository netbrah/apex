/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DEFAULT_GEMINI_FLASH_LITE_MODEL,
  DEFAULT_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_MODEL,
  PREVIEW_GEMINI_FLASH_MODEL,
  PREVIEW_GEMINI_MODEL,
} from '../config/models.js';

type Model = string;
type TokenCount = number;

/**
 * Token limit types for different use cases.
 * - 'input': Maximum input context window size
 * - 'output': Maximum output tokens that can be generated in a single response
 */
export type TokenLimitType = 'input' | 'output';

export function tokenLimit(model: Model): TokenCount {
  // Add other models as they become relevant or if specified by config
  // Pulled from https://ai.google.dev/gemini-api/docs/models
  switch (model) {
    case PREVIEW_GEMINI_MODEL:
    case PREVIEW_GEMINI_FLASH_MODEL:
    case DEFAULT_GEMINI_MODEL:
    case DEFAULT_GEMINI_FLASH_MODEL:
    case DEFAULT_GEMINI_FLASH_LITE_MODEL:
      return 1_048_576;
    default:
      return DEFAULT_TOKEN_LIMIT;
  }

  // remove quantization / numeric / precision suffixes common in local/community models
  s = s.replace(/-(?:\d?bit|int[48]|bf16|fp16|q[45]|quantized)$/g, '');

  return s;
}

/** Ordered regex patterns: most specific -> most general (first match wins). */
const PATTERNS: Array<[RegExp, TokenCount]> = [
  // -------------------
  // Google Gemini
  // -------------------
  [/^gemini-3/, LIMITS['1m']], // Gemini 3.x (Pro, Flash, 3.1, etc.): 1M
  [/^gemini-/, LIMITS['1m']], // Gemini fallback (1.5, 2.x): 1M

  // -------------------
  // OpenAI
  // -------------------
  [/^gpt-5/, LIMITS['272k']], // GPT-5.x: 272K input (400K total - 128K output)
  [/^gpt-/, LIMITS['128k']], // GPT fallback (4o, 4.1, etc.): 128K
  [/^o\d/, LIMITS['200k']], // o-series (o3, o4-mini, etc.): 200K

  // -------------------
  // Anthropic Claude
  // -------------------
  [/^claude-opus-4[.-]?6/, LIMITS['1m']], // Opus 4.6: 1M context (Vertex AI confirmed)
  [/^claude-opus-4[.-]?5/, LIMITS['200k']], // Opus 4.5: 200K
  [/^claude-/, LIMITS['200k']], // Claude fallback (Sonnet, Haiku, etc.): 200K

  // -------------------
  // Alibaba / Qwen
  // -------------------
  // Commercial API models (1,000,000 context)
  [/^qwen3-coder-plus/, LIMITS['1m']],
  [/^qwen3-coder-flash/, LIMITS['1m']],
  [/^qwen3\.5-plus/, LIMITS['1m']],
  [/^qwen-plus-latest$/, LIMITS['1m']],
  [/^qwen-flash-latest$/, LIMITS['1m']],
  [/^coder-model$/, LIMITS['1m']],
  // Commercial API models (256K context)
  [/^qwen3-max/, LIMITS['256k']],
  // Open-source Qwen3 variants: 256K native
  [/^qwen3-coder-/, LIMITS['256k']],
  // Qwen fallback (VL, turbo, plus, 2.5, etc.): 128K
  [/^qwen/, LIMITS['256k']],

  // -------------------
  // DeepSeek
  // -------------------
  [/^deepseek/, LIMITS['128k']],

  // -------------------
  // Zhipu GLM
  // -------------------
  [/^glm-5/, 202_752 as TokenCount], // GLM-5: exact vendor limit
  [/^glm-/, 202_752 as TokenCount], // GLM fallback: 128K

  // -------------------
  // MiniMax
  // -------------------
  [/^minimax-m2\.5/i, LIMITS['192k']], // MiniMax-M2.5: 196,608
  [/^minimax-/i, LIMITS['200k']], // MiniMax fallback: 200K

  // -------------------
  // Moonshot / Kimi
  // -------------------
  [/^kimi-/, LIMITS['256k']], // Kimi fallback: 256K

  // -------------------
  // ByteDance Seed-OSS (512K)
  // -------------------
  [/^seed-oss/, LIMITS['512k']],
];

/**
 * Output token limit patterns for specific model families.
 * These patterns define the maximum number of tokens that can be generated
 * in a single response for specific models.
 */
const OUTPUT_PATTERNS: Array<[RegExp, TokenCount]> = [
  // Google Gemini
  [/^gemini-3/, LIMITS['64k']], // Gemini 3.x: 64K
  [/^gemini-/, LIMITS['8k']], // Gemini fallback: 8K

  // OpenAI
  [/^gpt-5/, LIMITS['128k']], // GPT-5.x: 128K
  [/^gpt-/, LIMITS['16k']], // GPT fallback: 16K
  [/^o\d/, LIMITS['128k']], // o-series: 128K

  // Anthropic Claude
  [/^claude-opus-4[.-]?6/, LIMITS['128k']], // Opus 4.6: 128K
  [/^claude-sonnet-4[.-]?6/, LIMITS['64k']], // Sonnet 4.6: 64K
  [/^claude-/, LIMITS['64k']], // Claude fallback: 64K

  // Alibaba / Qwen
  [/^qwen3\.5/, LIMITS['64k']],
  [/^coder-model$/, LIMITS['64k']],
  [/^qwen3-max/, LIMITS['64k']],
  [/^qwen/, LIMITS['8k']], // Qwen fallback (VL, turbo, plus, etc.): 8K

  // DeepSeek
  [/^deepseek-reasoner/, LIMITS['64k']],
  [/^deepseek-r1/, LIMITS['64k']],
  [/^deepseek-chat/, LIMITS['8k']],

  // Zhipu GLM
  [/^glm-5/, LIMITS['16k']],
  [/^glm-4\.7/, LIMITS['16k']],

  // MiniMax
  [/^minimax-m2\.5/i, LIMITS['64k']],

  // Kimi
  [/^kimi-k2\.5/, LIMITS['32k']],
];

/**
 * Check if a model has an explicitly defined output token limit.
 * This distinguishes between models with known limits in OUTPUT_PATTERNS
 * and unknown models that would fallback to DEFAULT_OUTPUT_TOKEN_LIMIT.
 *
 * @param model - The model name to check
 * @returns true if the model has an explicit output limit definition, false if it uses the default fallback
 */
export function hasExplicitOutputLimit(model: Model): boolean {
  const norm = normalize(model);
  return OUTPUT_PATTERNS.some(([regex]) => regex.test(norm));
}

/**
 * Return the token limit for a model string based on the specified type.
 *
 * This function determines the maximum number of tokens for either input context
 * or output generation based on the model and token type. It uses the same
 * normalization logic for consistency across both input and output limits.
 *
 * This function is primarily used during config initialization to auto-detect
 * token limits. After initialization, code should use contentGeneratorConfig.contextWindowSize
 * or contentGeneratorConfig.maxOutputTokens directly.
 *
 * @param model - The model name to get the token limit for
 * @param type - The type of token limit ('input' for context window, 'output' for generation)
 * @returns The maximum number of tokens allowed for this model and type
 */
export function tokenLimit(
  model: Model,
  type: TokenLimitType = 'input',
): TokenCount {
  const norm = normalize(model);

  // Choose the appropriate patterns based on token type
  const patterns = type === 'output' ? OUTPUT_PATTERNS : PATTERNS;

  for (const [regex, limit] of patterns) {
    if (regex.test(norm)) {
      return limit;
    }
  }

  // Return appropriate default based on token type
  return type === 'output' ? DEFAULT_OUTPUT_TOKEN_LIMIT : DEFAULT_TOKEN_LIMIT;
}

export function tokenEstimationScaleFactor(model: string): number {
  const m = normalize(model);
  if (/claude/.test(m)) return 1.25;
  if (/gpt|^o\d|codex/.test(m)) return 1.2;
  return 1.0;
}

export function defaultMaxOutputTokens(model: string): TokenCount {
  return tokenLimit(model, 'output');
}
