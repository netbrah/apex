/* eslint-disable */
// @ts-nocheck
/**
 * Cancellation support shim for vendored OpenGrok-native tools.
 *
 * Provides the same API surface as the source project's cancellation module
 * without pulling in the full Mastra ToolExecutionContext type.
 */

/**
 * Extract AbortSignal from tool execution context.
 */
export function getAbortSignal(context?: any): AbortSignal | undefined {
  if (!context) return undefined;
  if (context.abortSignal) return context.abortSignal;
  const mcpExtra = context?.mcp?.extra;
  if (mcpExtra?.signal instanceof AbortSignal) return mcpExtra.signal;
  return undefined;
}

/**
 * Check if the request has been cancelled.
 */
export function isCancelled(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

/**
 * Error class for cancelled operations.
 */
export class CancellationError extends Error {
  constructor(message: string = 'Request cancelled by client') {
    super(message);
    this.name = 'CancellationError';
  }
}

/**
 * Throw CancellationError if request is cancelled.
 */
export function throwIfCancelled(signal?: AbortSignal): void {
  if (isCancelled(signal)) {
    throw new CancellationError();
  }
}
