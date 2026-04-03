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

export const DEFAULT_TOKEN_LIMIT = 1_048_576;
export const DEFAULT_OUTPUT_TOKEN_LIMIT = 16_384;

/**
 * Normalize a model string for pattern matching.
 * Strips deployment prefixes (e.g. "accounts/.../models/") and lowercases.
 */
export function normalize(model: string): string {
  // Strip Google-style prefixes: accounts/{id}/models/{model}
  let stripped = model.replace(/^(accounts\/[^/]+\/)?models\//, '');
  // Strip provider prefixes: openai/gpt-4o → gpt-4o, anthropic/claude-3 → claude-3
  stripped = stripped.replace(/^[a-zA-Z0-9_-]+\//, '');
  return stripped.toLowerCase();
}

/**
 * Known model output limits.
 * Models not listed here return DEFAULT_OUTPUT_TOKEN_LIMIT from the output path.
 */
const OUTPUT_LIMITS: Record<string, number> = {
  'claude-sonnet-4-20250514': 16_384,
  'claude-sonnet-4.5-20250514': 16_384,
  'claude-opus-4-20250514': 32_768,
  'gpt-4.1': 32_768,
  'gpt-4.1-mini': 16_384,
  'gpt-4.1-nano': 16_384,
  o3: 100_000,
  'o4-mini': 100_000,
};

/**
 * Returns true when the model has an explicit output limit in OUTPUT_LIMITS.
 */
export function hasExplicitOutputLimit(model: string): boolean {
  const norm = normalize(model);
  for (const key of Object.keys(OUTPUT_LIMITS)) {
    if (norm.startsWith(key)) return true;
  }
  return false;
}

export function tokenLimit(
  model: Model,
  kind?: 'input' | 'output',
): TokenCount {
  if (kind === 'output') {
    const norm = normalize(model);
    for (const [key, limit] of Object.entries(OUTPUT_LIMITS)) {
      if (norm.startsWith(key)) return limit;
    }
    return DEFAULT_OUTPUT_TOKEN_LIMIT;
  }

  // Input / default context window limits
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
}
