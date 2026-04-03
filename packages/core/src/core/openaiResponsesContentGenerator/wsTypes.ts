/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ResponsesApiInputItem,
  ResponsesApiTool,
  ResponsesApiReasoning,
  ResponsesApiTextControls,
  ResponsesApiServiceTier,
  ResponsesSSEEventType,
} from './types.js';

// ── WebSocket request (sent as JSON text frame, not HTTP POST) ────────

export interface ResponseCreateWsRequest {
  type: 'response.create';
  model: string;
  instructions?: string;
  input: ResponsesApiInputItem[];
  tools?: ResponsesApiTool[];
  tool_choice?: string;
  parallel_tool_calls?: boolean;
  reasoning?: ResponsesApiReasoning;
  text?: ResponsesApiTextControls;
  previous_response_id?: string;
  stream?: boolean;
  store?: boolean;
  truncation?: { type: 'auto' | 'disabled' };
  generate?: boolean;
  prompt_cache_key?: string;
  service_tier?: ResponsesApiServiceTier;
  include?: string[];
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  metadata?: Record<string, string>;
}

// ── WebSocket events (same schema as SSE, but JSON frames not data: lines) ──

export interface ResponsesWsEvent {
  type: ResponsesSSEEventType;
  [key: string]: unknown;
}

// ── Wrapped WebSocket error (server sends these for in-stream errors) ──

export interface WrappedWebsocketError {
  type: 'error';
  status?: number;
  error: {
    type: string;
    code: string;
    message: string;
  };
  headers?: Record<string, string>;
}

// ── Configuration ───────────────────────────────────────────────────────

export interface WebSocketOptions {
  connectTimeout?: number;
  idleTimeout?: number;
  perMessageDeflate?: boolean;
}

export interface WebSocketManagerConfig {
  baseUrl: string;
  apiKey: string;
  responsesTransport: 'auto' | 'http' | 'websocket';
  streamMaxRetries: number;
  customHeaders?: Record<string, string>;
  wsOptions?: WebSocketOptions;
}

// ── Transport outcome ───────────────────────────────────────────────────

export type WebSocketStreamOutcome =
  | { type: 'stream'; events: AsyncGenerator<ResponsesWsEvent> }
  | { type: 'fallbackToHttp' };

// ── Defaults ────────────────────────────────────────────────────────────

export const WS_DEFAULT_CONNECT_TIMEOUT = 15_000;
export const WS_DEFAULT_IDLE_TIMEOUT = 300_000;
export const WS_DEFAULT_STREAM_MAX_RETRIES = 5;
export const WS_CONNECTION_TTL = 60 * 60 * 1000; // 60 minutes

// ── Type guards ─────────────────────────────────────────────────────────

export function isWrappedWebsocketError(
  data: unknown,
): data is WrappedWebsocketError {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (obj['type'] !== 'error') return false;
  const errObj = obj['error'];
  if (typeof errObj !== 'object' || errObj === null) return false;
  return typeof (errObj as Record<string, unknown>)['message'] === 'string';
}

export function isConnectionLimitError(err: unknown): boolean {
  if (isWrappedWebsocketError(err)) {
    return err.error.code === 'websocket_connection_limit_reached';
  }
  if (err instanceof Error) {
    return (
      (err as Error & { code?: string }).code ===
      'websocket_connection_limit_reached'
    );
  }
  return false;
}

export function isUpgradeRequiredError(err: unknown): boolean {
  if (err instanceof Error && err.message.includes('426')) return true;
  if (typeof err === 'object' && err !== null) {
    const obj = err as Record<string, unknown>;
    if (obj['status'] === 426) return true;
  }
  return false;
}

export function isRetryableWsError(err: unknown): boolean {
  if (isConnectionLimitError(err)) return true;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('websocket closed') ||
      msg.includes('connection closed') ||
      msg.includes('idle timeout') ||
      msg.includes('econnreset') ||
      msg.includes('econnrefused')
    );
  }
  return false;
}
