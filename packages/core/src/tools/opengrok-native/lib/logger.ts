/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Lightweight logger shims for vendored OpenGrok-native tools.
 */

function isDebugEnabled(): boolean {
  return process.env.DEBUG === '1' || process.env.DEBUG === 'true';
}

function debugLog(prefix: string, message: string, data?: unknown): void {
  if (!isDebugEnabled()) {
    return;
  }
  if (data === undefined) {
    // eslint-disable-next-line no-console
    console.debug(prefix, message);
    return;
  }
  // eslint-disable-next-line no-console
  console.debug(prefix, message, data);
}

export const logTool = {
  start(tool: string, input?: unknown): string {
    const invocationId = `${tool}:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`;
    debugLog('[opengrok-native]', `start ${tool}`, { invocationId, input });
    return invocationId;
  },
  step(tool: string, step: string, data?: unknown): void {
    debugLog('[opengrok-native]', `${tool} step: ${step}`, data);
  },
  result(tool: string, data?: unknown): void {
    debugLog('[opengrok-native]', `${tool} result`, data);
  },
  end(invocationId: string, data?: unknown): void {
    debugLog('[opengrok-native]', `end ${invocationId}`, data);
  },
};

export const logOpenGrok = {
  request(operation: string, data?: unknown): void {
    debugLog('[opengrok-native]', `request ${operation}`, data);
  },
  response(operation: string, durationMs: number, count?: number): void {
    debugLog('[opengrok-native]', `response ${operation}`, {
      durationMs,
      count,
    });
  },
  error(operation: string, error: unknown): void {
    debugLog('[opengrok-native]', `error ${operation}`, error);
  },
};

export const log = {
  info(message: string, data?: unknown): void {
    debugLog('[opengrok-native]', `info: ${message}`, data);
  },
  warn(message: string, data?: unknown): void {
    debugLog('[opengrok-native]', `warn: ${message}`, data);
  },
  error(message: string, data?: unknown): void {
    debugLog('[opengrok-native]', `error: ${message}`, data);
  },
  debug(message: string, data?: unknown): void {
    debugLog('[opengrok-native]', `debug: ${message}`, data);
  },
};
