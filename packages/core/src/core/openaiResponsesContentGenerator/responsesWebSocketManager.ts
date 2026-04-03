/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import type {
  ResponseCreateWsRequest,
  ResponsesWsEvent,
  WebSocketManagerConfig,
} from './wsTypes.js';
import {
  WS_DEFAULT_STREAM_MAX_RETRIES,
  isUpgradeRequiredError,
  isConnectionLimitError,
  isRetryableWsError,
} from './wsTypes.js';
import { ResponsesWebSocket } from './responsesWebSocket.js';
import type { ResponsesApiRequest } from './types.js';
import { debugLogger } from '../../utils/debugLogger.js';

export class ResponsesWebSocketManager {
  private connection: ResponsesWebSocket | null = null;
  private lastRequest: ResponsesApiRequest | null = null;
  private httpFallbackActivated: boolean = false;
  private connectionReused: boolean = false;
  private retryCount: number = 0;
  /**
   * Serialises access to the shared WebSocket connection so that
   * concurrent `streamViaWebSocket()` calls don't interleave responses.
   * Each call awaits the previous one's completion before starting.
   */
  private streamLock: Promise<void> = Promise.resolve();

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly responsesTransport: 'auto' | 'http' | 'websocket';
  private readonly streamMaxRetries: number;
  private readonly customHeaders: Record<string, string>;
  private readonly wsOptions: WebSocketManagerConfig['wsOptions'];

  constructor(config: WebSocketManagerConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.responsesTransport = config.responsesTransport;
    this.streamMaxRetries =
      config.streamMaxRetries ?? WS_DEFAULT_STREAM_MAX_RETRIES;
    this.customHeaders = config.customHeaders ?? {};
    this.wsOptions = config.wsOptions;
  }

  isWebSocketEnabled(): boolean {
    return !this.httpFallbackActivated && this.responsesTransport !== 'http';
  }

  private buildWsUrl(): string {
    const base = this.baseUrl.replace(/\/$/, '');
    const wsBase = base
      .replace(/^https:\/\//, 'wss://')
      .replace(/^http:\/\//, 'ws://');
    return `${wsBase}/v1/responses`;
  }

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      ...this.customHeaders,
    };
  }

  private async ensureConnection(): Promise<ResponsesWebSocket> {
    if (
      this.connection &&
      this.connection.isOpen() &&
      !this.connection.isConnectionExpired()
    ) {
      this.connectionReused = true;
      return this.connection;
    }

    if (this.connection) {
      debugLogger.debug('Closing stale/expired connection');
      await this.connection.close();
      this.connection = null;
    }

    debugLogger.debug('Opening new WebSocket connection');
    const conn = new ResponsesWebSocket(this.wsOptions);
    await conn.connect(this.buildWsUrl(), this.buildHeaders());
    this.connection = conn;
    this.connectionReused = false;
    return conn;
  }

  isIncrementalPrefix(
    current: ResponsesApiRequest,
    last: ResponsesApiRequest,
  ): boolean {
    if (
      current.instructions !== last.instructions ||
      current.model !== last.model ||
      JSON.stringify(current.tools) !== JSON.stringify(last.tools) ||
      JSON.stringify(current.reasoning) !== JSON.stringify(last.reasoning)
    ) {
      return false;
    }

    const currentInput = current.input;
    const lastInput = last.input;
    if (currentInput.length <= lastInput.length) return false;

    for (let i = 0; i < lastInput.length; i++) {
      if (JSON.stringify(currentInput[i]) !== JSON.stringify(lastInput[i])) {
        return false;
      }
    }

    return true;
  }

  prepareWsRequest(
    request: ResponsesApiRequest,
    responseId: string | null,
  ): ResponseCreateWsRequest {
    let input = request.input;

    if (
      responseId &&
      this.lastRequest &&
      this.isIncrementalPrefix(request, this.lastRequest)
    ) {
      input = request.input.slice(this.lastRequest.input.length);
      debugLogger.debug(
        'Incremental request: %d new items (was %d total)',
        input.length,
        request.input.length,
      );
    }

    const wsRequest: ResponseCreateWsRequest = {
      type: 'response.create',
      model: request.model,
      input,
      stream: true,
    };

    if (responseId && input !== request.input) {
      wsRequest.previous_response_id = responseId;
    }
    if (request.instructions) wsRequest.instructions = request.instructions;
    if (request.tools?.length) wsRequest.tools = request.tools;
    if (request.tool_choice) wsRequest.tool_choice = request.tool_choice;
    if (request.parallel_tool_calls !== undefined)
      wsRequest.parallel_tool_calls = request.parallel_tool_calls;
    if (request.reasoning) wsRequest.reasoning = request.reasoning;
    if (request.text) wsRequest.text = request.text;
    if (request.truncation)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      wsRequest.truncation = request.truncation as {
        type: 'auto' | 'disabled';
      };
    if (request.store !== undefined) wsRequest.store = request.store;
    if (request.prompt_cache_key)
      wsRequest.prompt_cache_key = request.prompt_cache_key;
    if (request.service_tier) wsRequest.service_tier = request.service_tier;
    if (request.include?.length) wsRequest.include = request.include;
    if (request.temperature !== undefined)
      wsRequest.temperature = request.temperature;
    if (request.top_p !== undefined) wsRequest.top_p = request.top_p;
    if (request.max_output_tokens !== undefined)
      wsRequest.max_output_tokens = request.max_output_tokens;
    if (request.metadata) wsRequest.metadata = request.metadata;

    return wsRequest;
  }

  async *streamViaWebSocket(
    request: ResponsesApiRequest,
    responseId: string | null,
    signal?: AbortSignal,
  ): AsyncGenerator<ResponsesWsEvent> {
    // Acquire the stream lock so concurrent callers don't interleave on
    // the same WebSocket connection.
     
    let releaseLock: () => void = () => {};
    const prevLock = this.streamLock;
    this.streamLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    await prevLock;

    try {
      const conn = await this.ensureConnection();
      const wsRequest = this.prepareWsRequest(request, responseId);

      try {
        yield* conn.streamRequest(wsRequest, signal);
        this.lastRequest = request;
        this.retryCount = 0;
      } catch (err) {
        if (isUpgradeRequiredError(err)) {
          debugLogger.debug('426 Upgrade Required — falling back to HTTP');
          throw err;
        }

        if (isConnectionLimitError(err)) {
          debugLogger.debug('Connection limit reached — reconnecting');
          await this.connection?.close();
          this.connection = null;
          this.lastRequest = null;
          const newConn = await this.ensureConnection();
          const freshRequest = this.prepareWsRequest(request, null);
          yield* newConn.streamRequest(freshRequest, signal);
          this.lastRequest = request;
          return;
        }

        if (isRetryableWsError(err)) {
          this.retryCount++;
          if (this.retryCount > this.streamMaxRetries) {
            debugLogger.debug(
              'Retry budget exhausted (%d/%d) — activating HTTP fallback',
              this.retryCount,
              this.streamMaxRetries,
            );
            this.activateHttpFallback();
            throw err;
          }
          debugLogger.debug(
            'Retryable error, attempt %d/%d',
            this.retryCount,
            this.streamMaxRetries,
          );
          await this.connection?.close();
          this.connection = null;
          this.lastRequest = null;
          throw err;
        }

        throw err;
      }
    } finally {
      releaseLock();
    }
  }

  activateHttpFallback(): void {
    debugLogger.debug('Permanently falling back to HTTP SSE');
    this.httpFallbackActivated = true;
    this.connection?.close().catch(() => {});
    this.connection = null;
    this.lastRequest = null;
  }

  resetAfterCompaction(): void {
    debugLogger.debug('Resetting prefix chain after compaction');
    this.lastRequest = null;
  }

  wasConnectionReused(): boolean {
    return this.connectionReused;
  }

  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }
    this.lastRequest = null;
  }
}
