/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Error helpers for vendored OpenGrok-native tools.
 */

export class OpenGrokError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'OpenGrokError';
    this.statusCode = statusCode;
  }
}

export class FileNotFoundError extends Error {
  constructor(filePath: string) {
    super(`File not found: ${filePath}`);
    this.name = 'FileNotFoundError';
  }
}

export function classifyError(error: unknown): {
  errorType:
    | 'network_error'
    | 'auth_error'
    | 'timeout'
    | 'cancelled'
    | 'symbol_not_found'
    | 'api_error'
    | 'internal_error';
  retryable: boolean;
  message: string;
} {
  if (error instanceof OpenGrokError) {
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return {
        errorType: 'api_error',
        retryable: false,
        message: error.message,
      };
    }
    return {
      errorType: 'network_error',
      retryable: true,
      message: error.message,
    };
  }

  if (error instanceof FileNotFoundError) {
    return {
      errorType: 'api_error',
      retryable: false,
      message: error.message,
    };
  }

  const msg = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';

  if (name === 'AbortError' || name === 'CancellationError') {
    return {
      errorType: 'cancelled',
      retryable: true,
      message: `Operation cancelled: ${msg}`,
    };
  }

  if (
    msg.includes('timed out') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('TimeoutError')
  ) {
    return {
      errorType: 'timeout',
      retryable: true,
      message: msg,
    };
  }

  if (
    msg.includes('Authentication required') ||
    msg.includes('redirecting to Microsoft SSO') ||
    msg.includes('login page')
  ) {
    return {
      errorType: 'auth_error',
      retryable: false,
      message: msg,
    };
  }

  if (
    msg.includes('fetch failed') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('ECONNRESET') ||
    msg.includes('socket hang up')
  ) {
    return {
      errorType: 'network_error',
      retryable: true,
      message: msg,
    };
  }

  return {
    errorType: 'internal_error',
    retryable: false,
    message: msg,
  };
}
