/* eslint-disable */
// @ts-nocheck
/**
 * Tool type definitions and utilities shim for vendored OpenGrok-native tools.
 */

export const EMPTY_TOOL_CONTEXT: any = {};

export function isValidationError(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const r = result as Record<string, unknown>;
  if ('issues' in r && Array.isArray(r.issues)) return true;
  return (
    r.error === true && typeof r.message === 'string' && 'validationErrors' in r
  );
}

export function isToolSuccess<T>(result: T | any): result is T {
  return !isValidationError(result);
}

/**
 * Safely execute a tool, returning typed result or null.
 */
export async function safeExecuteTool<TOutput, TInput = any>(
  tool: any,
  input: TInput,
  context: any = EMPTY_TOOL_CONTEXT,
): Promise<TOutput | null> {
  if (!tool.execute) return null;
  try {
    const result = await tool.execute(input, context);
    if (isValidationError(result)) return null;
    return result;
  } catch {
    return null;
  }
}

export interface McpCallToolResult {
  jsonrpc: '2.0';
  result?: {
    content?: Array<{ text?: string }>;
    isError?: boolean;
  };
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
  id?: number | string | null;
}

export interface MCPExtraContext {
  signal?: AbortSignal;
  [key: string]: unknown;
}
