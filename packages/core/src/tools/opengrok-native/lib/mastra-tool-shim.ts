/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Minimal createTool shim for vendored opengrok-native sources.
 *
 * It preserves the object contract used by the wrappers in packages/core tools.
 */

export interface ShimToolDefinition<TInput = unknown, TOutput = unknown> {
  id: string;
  description: string;
  execute: (input: TInput) => Promise<TOutput>;
  [key: string]: unknown;
}

export function createTool<TInput, TOutput>(
  definition: ShimToolDefinition<TInput, TOutput>,
): ShimToolDefinition<TInput, TOutput> {
  return definition;
}
