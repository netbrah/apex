/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import WebSocket from 'ws';
import type {
  ResponseCreateWsRequest,
  ResponsesWsEvent,
  WebSocketOptions,
  WrappedWebsocketError,
} from './wsTypes.js';
import {
  WS_DEFAULT_CONNECT_TIMEOUT,
  WS_DEFAULT_IDLE_TIMEOUT,
  WS_CONNECTION_TTL,
  isWrappedWebsocketError,
  isConnectionLimitError,
} from './wsTypes.js';
import { createDebugLogger } from '../../utils/debugLogger.js';

const debugLogger = createDebugLogger('RESPONSES_WS');

export interface WebSocketUpgradeHeaders {
  serverReasoningIncluded: boolean;
  serverModel: string | null;
  modelsEtag: string | null;
  turnState: string | null;
}

export class ResponsesWebSocket {
  private ws: WebSocket | null = null;
  private connectTimeout: number;
  private idleTimeout: number;
  private perMessageDeflate: boolean;
  private connectionStartTime: number = 0;
  upgradeHeaders: WebSocketUpgradeHeaders = {
    serverReasoningIncluded: false,
    serverModel: null,
    modelsEtag: null,
    turnState: null,
  };

  constructor(options?: WebSocketOptions) {
    this.connectTimeout = options?.connectTimeout ?? WS_DEFAULT_CONNECT_TIMEOUT;
    this.idleTimeout = options?.idleTimeout ?? WS_DEFAULT_IDLE_TIMEOUT;
    this.perMessageDeflate = options?.perMessageDeflate ?? true;
  }

  async connect(url: string, headers: Record<string, string>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.ws) {
          this.ws.terminate();
          this.ws = null;
        }
        reject(
          new Error(`WebSocket connect timeout after ${this.connectTimeout}ms`),
        );
      }, this.connectTimeout);

      const ws = new WebSocket(url, {
        headers,
        perMessageDeflate: this.perMessageDeflate,
      });

      ws.on('open', () => {
        clearTimeout(timeout);
        this.ws = ws;
        this.connectionStartTime = Date.now();
        debugLogger.debug('WebSocket connected to %s', url);
        resolve();
      });

      ws.on('upgrade', (response) => {
        this.upgradeHeaders = {
          serverReasoningIncluded:
            response.headers['x-reasoning-included'] === 'true',
          serverModel: response.headers['openai-model'] ?? null,
          modelsEtag: response.headers['x-models-etag'] ?? null,
          turnState: response.headers['x-codex-turn-state'] ?? null,
        };
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        this.ws = null;
        reject(err);
      });
    });
  }

  isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  isConnectionExpired(): boolean {
    if (this.connectionStartTime === 0) return false;
    return Date.now() - this.connectionStartTime >= WS_CONNECTION_TTL;
  }

  async *streamRequest(
    request: ResponseCreateWsRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<ResponsesWsEvent> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    const ws = this.ws;
    const requestText = JSON.stringify(request);
    debugLogger.debug('Sending request: %s bytes', requestText.length);
    ws.send(requestText);

    const idleTimeout = this.idleTimeout;

    try {
      while (true) {
        if (signal?.aborted) {
          throw new Error('Request aborted');
        }

        const message = await this.receiveMessage(ws, idleTimeout, signal);

        if (message.type === 'close') {
          throw new Error(
            'WebSocket closed by server before response.completed',
          );
        }

        if (message.type === 'binary') {
          throw new Error('Unexpected binary WebSocket event');
        }

        if (message.type === 'text') {
          const parsed = JSON.parse(message.data) as Record<string, unknown>;

          if (isWrappedWebsocketError(parsed)) {
            if (isConnectionLimitError(parsed)) {
              const error = new Error(
                (parsed as WrappedWebsocketError).error.message,
              );
              (error as Error & { code: string }).code =
                'websocket_connection_limit_reached';
              throw error;
            }
            const wsError = parsed as WrappedWebsocketError;
            const error = new Error(wsError.error.message);
            (error as Error & { status?: number }).status = wsError.status;
            throw error;
          }

          const event: ResponsesWsEvent = {
            type: parsed.type as ResponsesWsEvent['type'],
            ...parsed,
          };
          yield event;

          if (
            event.type === 'response.completed' ||
            event.type === 'response.failed' ||
            event.type === 'response.incomplete'
          ) {
            break;
          }
        }
      }
    } catch (err) {
      debugLogger.debug('Stream error: %s', (err as Error).message);
      throw err;
    }
  }

  private receiveMessage(
    ws: WebSocket,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<
    { type: 'text'; data: string } | { type: 'binary' } | { type: 'close' }
  > {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Idle timeout waiting for WebSocket message (${timeoutMs}ms)`,
          ),
        );
      }, timeoutMs);

      const onAbort = () => {
        cleanup();
        reject(new Error('Request aborted'));
      };

      const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
        cleanup();
        if (isBinary) {
          resolve({ type: 'binary' });
        } else {
          resolve({ type: 'text', data: data.toString() });
        }
      };

      const onClose = () => {
        cleanup();
        resolve({ type: 'close' });
      };

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        clearTimeout(timer);
        ws.removeListener('message', onMessage);
        ws.removeListener('close', onClose);
        ws.removeListener('error', onError);
        signal?.removeEventListener('abort', onAbort);
      };

      ws.on('message', onMessage);
      ws.on('close', onClose);
      ws.on('error', onError);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  async close(): Promise<void> {
    if (this.ws) {
      debugLogger.debug('Closing WebSocket connection');
      const ws = this.ws;
      this.ws = null;
      return new Promise<void>((resolve) => {
        ws.on('close', () => resolve());
        ws.close(1000, 'Client closing');
        setTimeout(() => {
          ws.terminate();
          resolve();
        }, 3000);
      });
    }
  }
}
